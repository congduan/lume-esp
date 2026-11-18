/* r113 gateway upstream harness - real HTTP against a local fake OpenAI-compatible
 * endpoint (three routes). No network egress, no API key, no new npm deps.
 * Covers: multipart/WAV header + stereo->mono downmix, chat body fields,
 * independent chat base URL, TTS request body, 24k->16k resampling, frame count,
 * delta order/final, idle收口, and 401/5xx/timeout negatives (no hangs).
 * Run: node tests/gateway_upstream.js */
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  OpenAICompatibleUpstream, UPLINK_BYTES,
  pcm16StereoToWav, resample24kMonoTo16kStereo, chunkPcm, splitTextDeltas, joinUrl
} = require('../tools/gateway/upstream-openai');

let checks = 0;
const pass = (label) => { checks++; console.log('PASS ' + label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp16 = (v) => v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
const json = (obj) => ({ status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(obj)) });

const REPLY = 'FIRST ANSWER. SECOND SENTENCE THIRD!';
const TRANSCRIPT = 'TRANSCRIBED USER TEXT';

function ttsPcm(samples = 24000) {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(clamp16(2 * i - 24000), i * 2);
  return b;
}

function makeFrame(seed = 0) {
  const b = Buffer.alloc(UPLINK_BYTES);
  for (let i = 0; i < 960; i++) {
    const v = (((i * 7 + seed) & 0x7fff) - 0x4000);
    b.writeInt16LE(v, i * 4);
    b.writeInt16LE(v + 100, i * 4 + 2);
  }
  return b;
}

/* ---- fake OpenAI-compatible HTTP endpoint ------------------------------- */
function makeFake(handlers) {
  const state = { requests: [], server: null, port: 0 };
  state.server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const route = req.url.indexOf('/audio/transcriptions') >= 0 ? 'stt'
      : req.url.indexOf('/chat/completions') >= 0 ? 'chat'
      : req.url.indexOf('/audio/speech') >= 0 ? 'tts' : 'unknown';
    const rec = { route, url: req.url, method: req.method, headers: req.headers, body };
    state.requests.push(rec);
    let out;
    try {
      const h = handlers[route];
      out = typeof h === 'function' ? h(rec) : h;
    } catch (e) { out = { status: 500, body: Buffer.from(String(e.message)) }; }
    out = out || { status: 200, body: Buffer.from('{}'), contentType: 'application/json' };
    if (out.delayMs) await sleep(out.delayMs);
    try {
      res.writeHead(out.status || 200, Object.assign(
        { 'Content-Type': out.contentType || 'application/json', Connection: 'close' },
        out.headers || {}));
      res.end(out.body == null ? Buffer.alloc(0) : out.body);
    } catch (_) { /* client aborted on timeout: ignore */ }
  });
  return {
    state,
    start() {
      return new Promise((resolve) => state.server.listen(0, '127.0.0.1', () => {
        state.port = state.server.address().port;
        resolve();
      }));
    },
    close() {
      return new Promise((resolve) => {
        if (state.server.closeAllConnections) state.server.closeAllConnections();
        state.server.close(() => resolve());
      });
    }
  };
}

async function withFake(handlers, fn) {
  const fake = makeFake(handlers);
  await fake.start();
  try { return await fn(fake); }
  finally { await fake.close(); }
}

function makeUp(fake, extra = {}) {
  return new OpenAICompatibleUpstream(Object.assign({
    baseUrl: 'http://127.0.0.1:' + fake.state.port + '/v1',
    apiKey: 'test-key',
    timeoutMs: 1500,
    retryDelayMs: 5,          /* keep the 1-retry discipline but run fast */
    silenceTimeoutMs: 8000,   /* must not fire during these cases */
    deltaMaxChars: 8
  }, extra));
}

/* ---- fake session capturing everything the adapter emits ---------------- */
function makeSession() {
  const st = { open: true, calls: [] };
  const api = {
    st,
    sessionId: 's-test',
    sendState(v) { st.calls.push({ k: 'state', v }); },
    sendTextDelta(t, f) { st.calls.push({ k: 'delta', t, f: !!f }); },
    sendAudio(fmt, pcm) { st.calls.push({ k: 'audio', fmt, pcm: Buffer.from(pcm) }); },
    sendError(c, m, f) { st.calls.push({ k: 'error', c, m, f: !!f }); },
    close(c, r) { st.open = false; st.calls.push({ k: 'close', c, r }); },
    log(...a) { st.calls.push({ k: 'log', v: a.map(String).join(' ') }); },
    isOpen() { return st.open; }
  };
  return api;
}

const ofKind = (session, k) => session.st.calls.filter((c) => c.k === k);
const states = (session) => ofKind(session, 'state').map((c) => c.v);

async function waitFor(pred, label, timeout = 3000, st = null) {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label +
      (st ? ' calls=' + JSON.stringify(st.st.calls.map((c) => c.k + ':' + (c.v || c.t || c.c || ''))) : ''));
    await sleep(5);
  }
}
async function waitIdle(st) {
  await waitFor(() => states(st).indexOf('idle') >= 0, 'idle state', 3000, st);
}

async function drive(up, st, frames = 3) {
  up.start(st);
  for (let i = 0; i < frames; i++) up.sendAudio(makeFrame(i));
  up.stop();
  await waitIdle(st);
}

const defaultChat = () => json({ choices: [{ message: { role: 'assistant', content: REPLY } }] });
const defaultTts = () => ({ status: 200, contentType: 'application/octet-stream', body: ttsPcm() });
const defaultHandlers = () => ({
  stt: () => json({ text: TRANSCRIPT }),
  chat: defaultChat,
  tts: defaultTts
});

/* ---- multipart parser (byte-preserving latin1) -------------------------- */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('no multipart boundary');
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = {};
  for (const chunk of buf.toString('latin1').split(boundary)) {
    const t = chunk.replace(/^\r\n/, '');
    if (!t || t.indexOf('\r\n\r\n') < 0) continue;
    const idx = t.indexOf('\r\n\r\n');
    const head = t.slice(0, idx);
    const data = t.slice(idx + 4).replace(/\r\n$/, '');
    const nm = /name="([^"]+)"/.exec(head);
    if (!nm) continue;
    const fn = /filename="([^"]+)"/.exec(head);
    parts[nm[1]] = { filename: fn ? fn[1] : null, data: Buffer.from(data, 'latin1'), head };
  }
  return parts;
}

(async () => {
  /* 1. WAV header + downmix + stt model/auth */
  await withFake({
    stt: (rec) => {
      rec.parts = parseMultipart(rec.body, rec.headers['content-type']);
      return json({ text: TRANSCRIPT });
    },
    chat: defaultChat, tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st, 2);
    const rec = fake.state.requests.find((r) => r.route === 'stt');
    assert.ok(rec.parts.file, 'multipart file part present');
    const wav = rec.parts.file.data;
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF', 'RIFF magic');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE', 'WAVE magic');
    assert.equal(wav.toString('ascii', 12, 16), 'fmt ', 'fmt chunk');
    assert.equal(wav.readUInt32LE(16), 16, 'fmt chunk size 16');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), 16000, '16000 Hz');
    assert.equal(wav.readUInt32LE(28), 32000, 'byte rate 16000*1*2');
    assert.equal(wav.readUInt16LE(32), 2, 'block align 2');
    assert.equal(wav.readUInt16LE(34), 16, '16-bit');
    assert.equal(wav.toString('ascii', 36, 40), 'data', 'data chunk');
    assert.equal(wav.readUInt32LE(40), 2 * 960 * 2, 'data bytes = 2 frames mono');
    assert.equal(wav.length, 44 + 3840, '44-byte header + mono payload');
    assert.equal(wav.readInt16LE(44), -16334, 'stereo (L=-16384,R=-16284) downmixed to -16334');
    assert.equal(rec.parts.model.data.toString(), 'whisper-1', 'stt model field');
    assert.equal(rec.headers.authorization, 'Bearer test-key', 'Bearer auth');
    pass('stt: multipart WAV header, downmix, model + auth');
  });

  /* 2. chat request body fields + transcript */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const rec = fake.state.requests.find((r) => r.route === 'chat');
    const body = JSON.parse(rec.body.toString());
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.length > 0, 'system prompt present');
    assert.equal(body.messages[1].role, 'user');
    assert.ok(body.messages[1].content.indexOf(TRANSCRIPT) >= 0, 'transcript in user message');
    assert.equal(rec.headers.authorization, 'Bearer test-key');
    pass('chat: model + system/user messages + transcript + auth');
  });

  /* 3. optional independent chat base URL */
  await withFake(defaultHandlers(), async (main) => {
    await withFake({ chat: defaultChat }, async (llm) => {
      const up = makeUp(main, { chatBaseUrl: 'http://127.0.0.1:' + llm.state.port + '/v1' });
      const st = makeSession();
      await drive(up, st);
      assert.equal(main.state.requests.filter((r) => r.route === 'chat').length, 0, 'main endpoint got no chat');
      assert.equal(llm.state.requests.filter((r) => r.route === 'chat').length, 1, 'llm endpoint got chat');
      pass('chat: OPENAI_CHAT_BASE_URL overrides LLM endpoint only');
    });
  });

  /* 4. TTS request body fields */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const rec = fake.state.requests.find((r) => r.route === 'tts');
    const body = JSON.parse(rec.body.toString());
    assert.equal(body.model, 'tts-1');
    assert.equal(body.input, REPLY, 'TTS input is the full reply text');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.response_format, 'pcm');
    assert.equal(rec.headers.authorization, 'Bearer test-key');
    pass('tts: model/input/voice/response_format=pcm + auth');
  });

  /* 5. TTS 24k->16k resample correctness + frame count */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const frames = ofKind(st, 'audio');
    assert.equal(frames.length, 17, '64000 stereo bytes / 3840 = 17 padded frames');
    assert.ok(frames.every((f) => f.pcm.length === 3840), 'every downlink frame is 3840 bytes');
    const pcm = Buffer.concat(frames.map((f) => f.pcm));
    for (let i = 0; i < 16000; i++) {
      const expected = clamp16(Math.round(3 * i - 24000));
      assert.equal(pcm.readInt16LE(i * 4), expected, 'L sample ' + i + ' matches 1.5x interpolation');
      assert.equal(pcm.readInt16LE(i * 4 + 2), expected, 'R sample ' + i + ' = L (mono dup)');
    }
    assert.ok(pcm.subarray(64000).every((b) => b === 0), 'tail zero-padded');
    pass('tts: 24k->16k linear resample + 3840-byte frame sequence');
  });

  /* 6. delta order + final + concatenation */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const deltas = ofKind(st, 'delta');
    assert.equal(deltas[deltas.length - 1].f, true, 'last delta is final');
    assert.equal(deltas[deltas.length - 1].t, '', 'final delta carries empty text');
    assert.ok(deltas.slice(0, -1).every((d) => d.f === false), 'intermediate deltas not final');
    assert.equal(deltas.map((d) => d.t).join(''), REPLY, 'deltas concatenate to exact reply');
    assert.ok(deltas.length > 1, 'reply split into multiple deltas');
    const audioIdx = st.st.calls.findIndex((c) => c.k === 'audio');
    const deltaIdx = st.st.calls.findIndex((c) => c.k === 'delta');
    assert.ok(audioIdx >= 0 && deltaIdx > audioIdx, 'audio frames precede text deltas (segment c then d)');
    pass('delta: ordered chunks + final marker + exact reassembly');
  });

  /* 7. state sequence + idle收口 + clean close */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    assert.deepEqual(states(st), ['thinking', 'speaking', 'idle'], 'state progression');
    const close = ofKind(st, 'close')[0];
    assert.ok(close, 'adapter closes the turn');
    assert.equal(close.c, 1000);
    assert.equal(close.r, 'done');
    assert.equal(ofKind(st, 'error').length, 0, 'no error on happy path');
    pass('turn: thinking -> speaking -> idle + close(1000, done)');
  });

  /* 8. optional device text folded into chat */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    up.sendText('DEVICE TYPED TEXT');
    await drive(up, st);
    const rec = fake.state.requests.find((r) => r.route === 'chat');
    const content = JSON.parse(rec.body.toString()).messages[1].content;
    assert.ok(content.indexOf(TRANSCRIPT) >= 0 && content.indexOf('DEVICE TYPED TEXT') >= 0,
      'transcript + device text both in user message');
    pass('sendText: device text folded into chat user message');
  });

  /* 9. 401 on stt -> no retry, idle, error, no hang */
  await withFake({
    stt: () => ({ status: 401, body: Buffer.from('invalid api key') }),
    chat: defaultChat, tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    assert.equal(fake.state.requests.filter((r) => r.route === 'stt').length, 1, '401 not retried');
    assert.equal(states(st).indexOf('idle') >= 0, true, 'returns to idle');
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_error', 'upstream_error emitted');
    assert.equal(err.f, false, '401 mapped to non-fatal');
    assert.equal(fake.state.requests.filter((r) => r.route === 'chat').length, 0, 'pipeline stopped at stt');
    pass('negative: stt 401 -> no retry, idle + non-fatal error');
  });

  /* 10. 5xx on chat -> exactly one retry, idle, fatal, no pipeline past chat */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => ({ status: 500, body: Buffer.from('boom') }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    assert.equal(fake.state.requests.filter((r) => r.route === 'chat').length, 2, 'exactly 1 retry (2 calls)');
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 0, 'tts never called');
    assert.equal(states(st).indexOf('idle') >= 0, true, 'idle收口');
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_error' && err.f === true, '5xx mapped to fatal upstream_error');
    assert.equal(ofKind(st, 'close').length, 0, 'fatal: gateway owns the close');
    pass('negative: chat 5xx -> 1 retry cap, idle + fatal error');
  });

  /* 11. timeout on tts -> 2 attempts, upstream_closed, no hang */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: defaultChat,
    tts: () => ({ status: 200, contentType: 'application/octet-stream', body: ttsPcm(), delayMs: 300 })
  }, async (fake) => {
    const up = makeUp(fake, { timeoutMs: 60 }), st = makeSession();
    await drive(up, st);
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 2, 'timeout retried once');
    assert.equal(states(st).indexOf('idle') >= 0, true, 'idle after timeout');
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_closed' && err.f === true, 'timeout -> fatal upstream_closed');
    pass('negative: tts timeout -> 1 retry, idle + upstream_closed, no hang');
  });

  /* 12. 429 then success -> retry recovers, full turn still completes */
  let sttHits = 0;
  await withFake({
    stt: () => (++sttHits === 1
      ? { status: 429, body: Buffer.from('slow down') }
      : json({ text: TRANSCRIPT })),
    chat: defaultChat, tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    assert.equal(sttHits, 2, '429 retried once');
    assert.equal(ofKind(st, 'error').length, 0, 'no error after recovery');
    assert.ok(ofKind(st, 'audio').length > 0, 'audio emitted after recovery');
    assert.deepEqual(states(st), ['thinking', 'speaking', 'idle'], 'clean state sequence');
    pass('retry: 429 -> success on second attempt, full turn completes');
  });

  /* 13. tts 5xx -> 2 attempts capped, idle, no delta/audio emitted */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: defaultChat,
    tts: () => ({ status: 502, body: Buffer.from('bad gateway') })
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 2, 'tts 5xx capped at 2');
    assert.equal(ofKind(st, 'audio').length, 0, 'no audio on failed tts');
    assert.equal(states(st).indexOf('idle') >= 0, true, 'idle收口');
    pass('negative: tts 5xx -> retry cap, idle, no audio');
  });

  /* 14. helper: WAV + resample + chunk + splitTextDeltas + joinUrl */
  {
    const wav = pcm16StereoToWav(Buffer.alloc(8, 0));
    assert.equal(wav.length, 48, '2 stereo frames -> 2 mono samples -> 44 + 4 WAV bytes');
    assert.equal(resample24kMonoTo16kStereo(Buffer.alloc(48000)).length, 64000, '24k->16k 2/3 ratio');
    assert.equal(chunkPcm(Buffer.alloc(64000)).length, 17, 'chunk count');
    assert.equal(chunkPcm(Buffer.alloc(1)).length, 1, 'short tail padded to one frame');
    const text = 'A. B C!';
    assert.equal(splitTextDeltas(text).join(''), text, 'splitTextDeltas preserves input');
    assert.equal(joinUrl('http://x/v1/', '/audio/speech'), 'http://x/v1/audio/speech');
    pass('helpers: wav/resample/chunk/split/joinUrl invariants');
  }

  /* 15. zero audio -> stop emits idle, no HTTP, no close */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    up.start(st);
    up.stop();
    await waitIdle(st);
    assert.equal(fake.state.requests.length, 0, 'no HTTP without audio');
    assert.deepEqual(states(st), ['thinking', 'idle'], 'idle without speaking');
    assert.equal(ofKind(st, 'close').length, 0, 'stop() never calls session.close()');
    pass('zero-audio: stop -> idle, no HTTP, no close (advisory stop)');
  });

  /* 16. stop() idempotency / never cancels an in-flight pipe */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    up.start(st);
    for (let i = 0; i < 3; i++) up.sendAudio(makeFrame(i));
    up.stop();
    up.stop();
    up.stop();
    await waitIdle(st);
    assert.equal(fake.state.requests.filter((r) => r.route === 'stt').length, 1, 'one pipe despite repeated stop');
    assert.deepEqual(states(st), ['thinking', 'speaking', 'idle']);
    pass('stop: idempotent, never cancels in-flight response');
  });

  console.log('ALL GATEWAY UPSTREAM CASES PASSED (' + checks + ' cases)');
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
