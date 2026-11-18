/* r113 + r114 gateway upstream harness - real HTTP against a local fake
 * OpenAI-compatible endpoint (three routes). No network egress, no API key,
 * no new npm deps. Covers: multipart/WAV header + stereo->mono downmix, chat
 * body fields + SSE stream:true deltas, independent chat base URL, TTS request
 * body, 24k->16k resampling, frame count, delta order/final, idle收口,
 * 401/5xx/timeout negatives (no hangs), SSE split-line chunking, [DONE]
 * termination, mid-stream disconnect收口 and stop()-abort.
 * Run: node tests/gateway_upstream.js */
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  OpenAICompatibleUpstream, UPLINK_BYTES,
  pcm16StereoToWav, resample24kMonoTo16kStereo, chunkPcm, splitTextDeltas, joinUrl
} = require('../tools/gateway/upstream-openai');
const { createSentenceSplitter } = require('../tools/gateway/sentence-splitter');

let checks = 0;
const pass = (label) => { checks++; console.log('PASS ' + label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp16 = (v) => v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
const json = (obj) => ({ status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(obj)) });

/* r114: SSE event helpers — the fake endpoint speaks the same line grammar as
 * OpenAI chat streaming (verified against Node's fetch body). */
const sseEvent = (data) => 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n';
const chatChunk = (content) => ({
  id: 'chatcmpl-test', object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
});
const sseChat = (contents, opts = {}) => {
  const parts = contents.map((c) => sseEvent(chatChunk(c)));
  if (opts.done !== false) parts.push(sseEvent('[DONE]'));
  return {
    status: 200,
    contentType: opts.contentType || 'text/event-stream',
    body: Buffer.from((opts.comments ? ': keepalive\n\n' : '') + parts.join(''))
  };
};

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
      if (out.writer) {
        /* custom streaming writer: may destroy the socket mid-stream */
        await out.writer(res);
        if (!res.writableEnded && !res.destroyed) res.end();
      } else if (out.chunks) {
        /* chunked transfer: each write can land mid-line in the client parser */
        for (const c of out.chunks) {
          if (res.destroyed) break;
          res.write(c);
          if (out.chunkDelayMs) await sleep(out.chunkDelayMs);
        }
        if (!res.destroyed) res.end();
      } else {
        res.end(out.body == null ? Buffer.alloc(0) : out.body);
      }
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
  const rec = (o) => { o.ts = Date.now(); st.calls.push(o); };
  const api = {
    st,
    sessionId: 's-test',
    sendState(v) { rec({ k: 'state', v }); },
    sendTextDelta(t, f) { rec({ k: 'delta', t, f: !!f }); },
    sendAudio(fmt, pcm) { rec({ k: 'audio', fmt, pcm: Buffer.from(pcm) }); },
    sendError(c, m, f) { rec({ k: 'error', c, m, f: !!f }); },
    close(c, r) { st.open = false; rec({ k: 'close', c, r }); },
    log(...a) { rec({ k: 'log', v: a.map(String).join(' ') }); },
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

const CHAT_CHUNKS = ['FIRST ANSWER. ', 'SECOND SENTENCE ', 'THIRD!']; /* concat === REPLY */
const defaultChat = () => sseChat(CHAT_CHUNKS);
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
    assert.equal(body.stream, true, 'chat requests SSE stream:true');
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

  /* 4. TTS request body fields + per-sentence inputs (r116: was one-shot full reply) */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.equal(tts.length, 2, 'one /audio/speech per complete sentence');
    assert.deepEqual(tts.map((r) => JSON.parse(r.body.toString()).input),
      ['FIRST ANSWER.', 'SECOND SENTENCE THIRD!'], 'sentences synthesized in order');
    const body = JSON.parse(tts[0].body.toString());
    assert.equal(body.model, 'tts-1');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.response_format, 'pcm');
    assert.equal(tts[0].headers.authorization, 'Bearer test-key');
    pass('tts: one request per sentence + model/voice/format/auth');
  });

  /* 5. TTS resample + frame count, now applied per sentence (r116) */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const frames = ofKind(st, 'audio');
    assert.equal(frames.length, 34, 'two sentences x 17 frames each');
    assert.ok(frames.every((f) => f.pcm.length === 3840), 'every downlink frame is 3840 bytes');
    for (let seg = 0; seg < 2; seg++) {
      const pcm = Buffer.concat(frames.slice(seg * 17, seg * 17 + 17).map((f) => f.pcm));
      for (let i = 0; i < 16000; i++) {
        const expected = clamp16(Math.round(3 * i - 24000));
        assert.equal(pcm.readInt16LE(i * 4), expected, 'seg' + seg + ' L sample ' + i);
        assert.equal(pcm.readInt16LE(i * 4 + 2), expected, 'seg' + seg + ' R sample ' + i);
      }
      assert.ok(pcm.subarray(64000).every((b) => b === 0), 'seg' + seg + ' tail zero-padded');
    }
    pass('tts: per-sentence 24k->16k resample + 3840-byte frame sequence');
  });

  /* 6. delta order + single final + concatenation (r114: one delta per SSE chunk) */
  await withFake(defaultHandlers(), async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const deltas = ofKind(st, 'delta');
    assert.equal(deltas.filter((d) => d.f).length, 1, 'exactly one final delta');
    assert.equal(deltas[deltas.length - 1].f, true, 'final delta is last');
    assert.equal(deltas[deltas.length - 1].t, '', 'final delta carries empty text');
    assert.ok(deltas.slice(0, -1).every((d) => d.f === false), 'intermediate deltas not final');
    assert.equal(deltas.slice(0, -1).map((d) => d.t).join(''), REPLY, 'deltas concatenate to exact reply');
    assert.equal(deltas.length - 1, CHAT_CHUNKS.length, 'one delta per SSE content chunk');
    const audioIdx = st.st.calls.findIndex((c) => c.k === 'audio');
    const finalIdx = st.st.calls.findIndex((c) => c.k === 'delta' && c.f);
    assert.ok(audioIdx >= 0 && finalIdx >= 0 && finalIdx < audioIdx,
      'streamed text + final precede TTS audio (delta during chat, audio during tts)');
    pass('delta: one-per-SSE-chunk + single final marker + exact reassembly');
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
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 4,
      '2 sentences x 2 attempts; timeout retried once per sentence');
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
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 4,
      '2 sentences x 2 attempts; tts 5xx capped at 2 per sentence');
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

  /* 17. r114: SSE chunk boundaries split mid-line; CRLF + comment handled;
   *     delta order kept; [DONE] terminates (trailing event ignored); TTS uses
   *     the accumulated full text. */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => {
      const one = JSON.stringify(chatChunk('AAA '));
      const two = JSON.stringify(chatChunk('BBB'));
      return {
        status: 200, contentType: 'text/event-stream', chunkDelayMs: 5,
        chunks: [
          Buffer.from(': keepalive\r\n\r\ndata: ' + one + '\r'),
          Buffer.from('\n\r\ndata: ' + two.slice(0, 10)),
          Buffer.from(two.slice(10) + '\r\n\r\ndata: [DONE]\r\n\r\n' + sseEvent(chatChunk('AFTER DONE')))
        ]
      };
    },
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const deltas = ofKind(st, 'delta');
    assert.deepEqual(deltas.map((d) => d.t), ['AAA ', 'BBB', ''],
      'deltas in upstream chunk order incl. split-line reassembly; [DONE] terminates');
    assert.equal(deltas.filter((d) => d.f).length, 1, 'single final');
    const ttsBody = JSON.parse(fake.state.requests.find((r) => r.route === 'tts').body.toString());
    assert.equal(ttsBody.input, 'AAA BBB', 'TTS uses accumulated SSE text');
    pass('sse: split-line chunks + CRLF + comment + [DONE] + accumulated TTS text');
  });

  /* 18. r114 + r116: SSE disconnect after headers -> keep deltas, seal final,
   *     non-fatal, no retry; residual text sealed into one sentence and its
   *     audio is still synthesized + played (no queued sentence is lost). */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => ({
      status: 200, contentType: 'text/event-stream',
      writer: async (res) => {
        res.write(sseEvent(chatChunk('PART ONE ')));
        await sleep(20);
        res.write(sseEvent(chatChunk('PART TWO')));
        await sleep(10);
        res.destroy();                 /* abrupt: no [DONE] */
      }
    }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const deltas = ofKind(st, 'delta');
    assert.deepEqual(deltas.slice(0, -1).map((d) => d.t), ['PART ONE ', 'PART TWO'],
      'emitted deltas preserved on disconnect');
    assert.equal(deltas[deltas.length - 1].f, true, 'final seals the partial text');
    assert.ok(/truncated/.test(deltas[deltas.length - 1].t), 'truncation noted in final delta');
    assert.equal(fake.state.requests.filter((r) => r.route === 'chat').length, 1, 'no retry after stream broke');
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.equal(tts.length, 1, 'residual flushed at seal -> one TTS request');
    assert.equal(JSON.parse(tts[0].body.toString()).input, 'PART ONE PART TWO',
      'residual text synthesized after disconnect');
    assert.equal(ofKind(st, 'audio').length, 17, 'residual audio played to completion');
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_error' && err.f === false,
      'stream break -> non-fatal upstream_error (like 401)');
    assert.ok(states(st).indexOf('idle') >= 0, 'idle after error');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'adapter closes cleanly');
    pass('sse: mid-stream disconnect -> deltas kept + final + non-fatal + no retry');
  });

  /* 19. r114: stop() during an active chat SSE read aborts it; idempotent, no hang,
   *     no error frame, emitted deltas kept and sealed. Pipe is started by the
   *     silence timer so stop() lands AFTER streaming has begun. */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => ({
      status: 200, contentType: 'text/event-stream', chunkDelayMs: 120,
      chunks: [
        Buffer.from(sseEvent(chatChunk('EARLY '))),
        Buffer.from(sseEvent(chatChunk('LATE'))),
        Buffer.from(sseEvent('[DONE]'))
      ]
    }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake, { silenceTimeoutMs: 15 }), st = makeSession();
    up.start(st);
    up.sendAudio(makeFrame(0));         /* silence timer starts the pipe */
    await waitFor(() => ofKind(st, 'delta').length >= 1, 'first streamed delta', 3000, st);
    up.stop();                          /* device says end mid-stream */
    up.stop();                          /* idempotent */
    await waitIdle(st);
    const deltas = ofKind(st, 'delta');
    assert.equal(deltas.filter((d) => d.f).length, 1, 'single final seals text on stop');
    assert.ok(deltas.slice(0, -1).map((d) => d.t).join('').indexOf('LATE') < 0,
      'late chunk not delivered after abort');
    assert.equal(ofKind(st, 'error').length, 0, 'user stop is not an error');
    assert.deepEqual(states(st), ['thinking', 'idle'], 'clean close without speaking');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'close(1000)');
    pass('sse: stop() aborts active read, keeps prior deltas, no error/hang');
  });

  /* 20. r114: a 200 with non-SSE content-type is an error (no pseudo-delta
   *     fallback): chat stream:true got application/json. */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => json({ choices: [{ message: { content: REPLY } }] }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_error' && err.f === false,
      'non-SSE chat -> non-fatal upstream_error (like 401)');
    assert.equal(ofKind(st, 'delta').length, 0, 'no pseudo-delta fallback on wrong content-type');
    assert.equal(fake.state.requests.filter((r) => r.route === 'tts').length, 0, 'tts skipped');
    assert.ok(states(st).indexOf('idle') >= 0, 'idle after error');
    pass('sse: non-SSE 200 -> upstream_error, no fallback deltas');
  });

  /* 21. r116: sentence splitter state machine (mixed CJK/ASCII, ellipsis, closers) */
  {
    const s = createSentenceSplitter();
    assert.deepEqual(s.feed('He said "Hi." '), ['He said "Hi."'], 'closer kept with sentence');
    assert.deepEqual(s.feed('Then left. Wait... OK?!'), ['Then left.', 'Wait...'],
      'ellipsis held together, trailing ?! flushed at seal');
    assert.deepEqual(s.seal(), ['OK?!'], 'residual flushed at seal');
    assert.deepEqual(s.seal(), [], 'seal is idempotent');
    assert.deepEqual(s.feed('ignored'), [], 'feed after seal is inert');
    const c = createSentenceSplitter();
    assert.deepEqual(c.feed('\u4f60\u597d\u3002Hello! (ok.) '),
      ['\u4f60\u597d\u3002', 'Hello!', '(ok.)'], 'CJK + ASCII terminators + paren closer');
    assert.deepEqual(c.feed('A.B'), ['A.'], 'no-space boundary splits after period');
    assert.deepEqual(c.seal(), ['B'], 'tail without terminator flushed');
    pass('splitter: stateful boundaries, CJK/ASCII, ellipsis, quotes, residual');
  }

  /* 22. r116: first sentence audio goes downlink BEFORE chat SSE ends */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: (rec) => ({
      status: 200, contentType: 'text/event-stream',
      writer: async (res) => {
        res.write(sseEvent(chatChunk('FIRST. ')));
        await sleep(120);
        res.write(sseEvent(chatChunk('SECOND. ')));
        await sleep(120);
        res.write(sseEvent('[DONE]'));
        rec.chatDoneAt = Date.now();
        res.end();
      }
    }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const firstAudio = ofKind(st, 'audio')[0];
    const finalDelta = ofKind(st, 'delta').find((d) => d.f);
    const chatRec = fake.state.requests.find((r) => r.route === 'chat');
    assert.ok(firstAudio && finalDelta && chatRec && chatRec.chatDoneAt,
      'audio, final delta and chat end timestamp recorded');
    assert.ok(firstAudio.ts < chatRec.chatDoneAt,
      'first audio precedes chat SSE [DONE] (streaming benefit, direct evidence)');
    assert.ok(firstAudio.ts < finalDelta.ts, 'first audio precedes the final text delta');
    assert.equal(ofKind(st, 'audio').length, 34, 'both sentences played');
    pass('streaming: first audio before chat SSE end + final delta');
  });

  /* 23. r116: multiple sentences keep TTS request order and audio frame order */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => sseChat(['ONE. ', 'TWO. ', 'THREE. ']),
    tts: (rec) => {
      rec.hitAt = Date.now();
      return { status: 200, contentType: 'application/octet-stream', body: ttsPcm(), delayMs: 20 };
    }
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.deepEqual(tts.map((r) => JSON.parse(r.body.toString()).input),
      ['ONE.', 'TWO.', 'THREE.'], 'TTS requests in sentence order');
    assert.ok(tts[1].hitAt - tts[0].hitAt >= 15 && tts[2].hitAt - tts[1].hitAt >= 15,
      'serial: next request only after prior 20ms response completed');
    const frames = ofKind(st, 'audio');
    assert.equal(frames.length, 51, '3 sentences x 17 frames');
    for (let i = 1; i < frames.length; i++) {
      assert.ok(frames[i].ts >= frames[i - 1].ts, 'audio frames ordered by emission time');
    }
    pass('streaming: sentence order + serial TTS + 51-frame sequence');
  });

  /* 24. r116: one failing sentence is skipped, later sentences still play */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => sseChat(['GOOD ONE. ', 'BAD TWO. ', 'GOOD THREE. ']),
    tts: (rec) => {
      const input = JSON.parse(rec.body.toString()).input;
      if (input === 'BAD TWO.') return { status: 502, body: Buffer.from('boom') };
      return { status: 200, contentType: 'application/octet-stream', body: ttsPcm() };
    }
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.deepEqual(tts.map((r) => JSON.parse(r.body.toString()).input),
      ['GOOD ONE.', 'BAD TWO.', 'BAD TWO.', 'GOOD THREE.'],
      'failing sentence retried once then skipped');
    assert.equal(ofKind(st, 'audio').length, 34, 'the two good sentences played');
    assert.equal(ofKind(st, 'error').length, 0, 'a skipped sentence is not a turn error');
    assert.deepEqual(states(st), ['thinking', 'speaking', 'idle'], 'clean state progression');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'clean close');
    assert.ok(ofKind(st, 'log').some((l) => /openai\.tts\.skip/.test(l.v)), 'skip logged');
    pass('streaming: single sentence TTS failure skipped, rest continue');
  });

  /* 25. r116: chat SSE break -> already-queued sentences still finish playing */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => ({
      status: 200, contentType: 'text/event-stream',
      writer: async (res) => {
        res.write(sseEvent(chatChunk('FIRST. ')));
        await sleep(10);
        res.write(sseEvent(chatChunk('SECOND. ')));
        await sleep(10);
        res.destroy();                 /* abrupt: no [DONE] */
      }
    }),
    tts: defaultTts
  }, async (fake) => {
    const up = makeUp(fake), st = makeSession();
    await drive(up, st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.equal(tts.length, 2, 'both queued sentences synthesized despite chat break');
    assert.equal(ofKind(st, 'audio').length, 34, 'both sentences played to completion');
    const deltas = ofKind(st, 'delta');
    assert.ok(/truncated/.test(deltas[deltas.length - 1].t), 'truncated final delta retained (r114)');
    const err = ofKind(st, 'error')[0];
    assert.ok(err && err.c === 'upstream_error' && err.f === false, 'non-fatal error retained');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'clean close after audio');
    pass('streaming: chat break -> queued sentences played + truncated final');
  });

  /* 26. r116: stop() aborts in-flight TTS, drops not-started sentences, clean close */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => ({
      status: 200, contentType: 'text/event-stream', chunkDelayMs: 40,
      chunks: [
        sseEvent(chatChunk('FIRST. ')), sseEvent(chatChunk('SECOND. ')),
        sseEvent(chatChunk('THIRD. ')), sseEvent('[DONE]')
      ]
    }),
    tts: (rec) => {
      const input = JSON.parse(rec.body.toString()).input;
      return input === 'FIRST.'
        ? { status: 200, contentType: 'application/octet-stream', body: ttsPcm() }
        : { status: 200, contentType: 'application/octet-stream', body: ttsPcm(), delayMs: 400 };
    }
  }, async (fake) => {
    const up = makeUp(fake, { silenceTimeoutMs: 15 }), st = makeSession();
    up.start(st);
    up.sendAudio(makeFrame(0));         /* silence timer starts the pipe */
    await waitFor(() => ofKind(st, 'audio').length >= 17, 'first sentence audio', 3000, st);
    await waitFor(() => fake.state.requests.filter((r) => r.route === 'tts').length >= 2,
      'second TTS in flight', 3000, st);
    up.stop();
    up.stop();                          /* idempotent */
    await waitIdle(st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.equal(tts.length, 2, 'third sentence never started (queue dropped)');
    assert.equal(ofKind(st, 'audio').length, 17, 'first segment retained, second aborted');
    assert.equal(ofKind(st, 'error').length, 0, 'user stop is not an error');
    assert.deepEqual(states(st), ['thinking', 'speaking', 'idle'], 'clean state progression');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'close(1000)');
    pass('streaming: stop abort in-flight TTS + drop queue + clean close');
  });

  /* 27. r116: stop() after chat sealed but TTS in flight -> clean close, no error */
  await withFake({
    stt: () => json({ text: TRANSCRIPT }),
    chat: () => sseChat(['ONLY ONE. ']),       /* chat sealed immediately */
    tts: () => ({ status: 200, contentType: 'application/octet-stream', body: ttsPcm(), delayMs: 400 })
  }, async (fake) => {
    const up = makeUp(fake, { silenceTimeoutMs: 15 }), st = makeSession();
    up.start(st);
    up.sendAudio(makeFrame(0));               /* silence timer starts the pipe */
    await waitFor(() => ofKind(st, 'delta').some((d) => d.f), 'chat final delta', 3000, st);
    await waitFor(() => fake.state.requests.filter((r) => r.route === 'tts').length >= 1,
      'tts in flight', 3000, st);
    up.stop();
    await waitIdle(st);
    const tts = fake.state.requests.filter((r) => r.route === 'tts');
    assert.equal(tts.length, 1, 'no retry after stop');
    assert.equal(ofKind(st, 'audio').length, 0, 'aborted before any frame');
    assert.equal(ofKind(st, 'error').length, 0, 'user stop is not an error');
    assert.deepEqual(states(st), ['thinking', 'idle'], 'clean state progression');
    assert.equal(ofKind(st, 'close')[0].c, 1000, 'close(1000)');
    pass('streaming: stop after chat sealed aborts TTS -> clean close, no error');
  });

  console.log('ALL GATEWAY UPSTREAM CASES PASSED (' + checks + ' cases)');
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
