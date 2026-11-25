/* r107 gateway host harness - simulated device client over the vendored WS
 * codec, driven against the real gateway server. Follows lume.net.ws callback
 * semantics (onOpen / onMessage(string|Buffer) / onClose / onError).
 * Honesty scope: mock upstream only; no real ASR/LLM/TTS, no board, no TLS.
 * Run: node tests/gateway.js */
const assert = require('node:assert/strict');
const {
  createGateway, connect, encodeFrame,
  MockUpstream, UPLINK_BYTES, AUDIO_HEADER_LENGTH
} = require('../tools/gateway');

const LIMIT_MS = 3000;
let checks = 0;
function pass(label) { checks++; console.log('PASS ' + label); }

async function runCase(label, factory, fn, opts = {}) {
  const logs = [];
  const gw = createGateway({
    port: 0,
    deviceToken: opts.deviceToken || '',
    log: (event, fields) => logs.push({ event, fields }),
    upstreamFactory: factory || (() => new MockUpstream()),
    /* r120: pass session-history / keep-alive config through to the gateway. */
    historyLimit: opts.historyLimit,
    historyCharBudget: opts.historyCharBudget,
    multiturn: opts.multiturn,
    /* r122: bounded resume store (small TTL in the expiry case). */
    resumeTtlMs: opts.resumeTtlMs,
    resumeMaxEntries: opts.resumeMaxEntries
  });
  await gw.start();
  const url = 'ws://127.0.0.1:' + gw.address().port + '/';
  try {
    await fn({ gw, url, logs });
    pass(label);
  } finally {
    await gw.close();
  }
}

function device(url) {
  const st = {
    opened: false, closed: false, errors: [], msgs: [], client: null,
    closeFrames: []
  };
  st.client = connect(url, {
    onOpen() { st.opened = true; },
    onMessage(data) { st.msgs.push(data); },
    onClose() { st.closed = true; },
    onError(code) { st.errors.push(code); }
  });
  return st;
}

function summary(st) {
  return JSON.stringify(st.msgs.map(d => typeof d === 'string'
    ? d.slice(0, 120)
    : { binary: d.length }));
}

async function until(st, predicate, label, timeout = LIMIT_MS) {
  const started = Date.now();
  for (;;) {
    const hit = st.msgs.find(predicate);
    if (hit) return hit;
    if (st.closed) throw new Error('socket closed before ' + label + '; msgs=' + summary(st));
    if (Date.now() - started > timeout) throw new Error('timeout waiting ' + label + '; msgs=' + summary(st));
    await new Promise(r => setTimeout(r, 5));
  }
}

async function untilOpen(st) {
  const started = Date.now();
  while (!st.opened && !st.closed && Date.now() - started < LIMIT_MS) {
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(st.opened, true, 'WS onOpen fired');
}

async function untilClosed(st) {
  const started = Date.now();
  while (!st.closed && Date.now() - started < LIMIT_MS) {
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(st.closed, true, 'WS onClose fired');
}

/* r120 helpers: wait for the Nth final text-delta and drive one uplink turn. */
const isFinalDelta = (d) => {
  if (typeof d !== 'string') return false;
  try { const m = JSON.parse(d); return m.type === 'text-delta' && m.final === true; }
  catch (e) { return false; }
};
async function untilFinals(st, n, label) {
  const started = Date.now();
  for (;;) {
    if (st.msgs.filter(isFinalDelta).length >= n) return;
    if (st.closed) throw new Error('socket closed before ' + label);
    if (Date.now() - started > LIMIT_MS) throw new Error('timeout waiting ' + label);
    await new Promise(r => setTimeout(r, 5));
  }
}
async function driveTurn(st, text, n) {
  st.client.sendText(JSON.stringify({ v: 1, type: 'text', text }));
  for (let i = 0; i < 3; i++) st.client.sendBinary(Buffer.alloc(UPLINK_BYTES, 0x55));
  st.client.sendText(JSON.stringify({ v: 1, type: 'end' }));
  await untilFinals(st, n, 'final delta #' + n);
}
async function untilHistoryCleared(session) {
  const started = Date.now();
  while (session.history.size() !== 0 && Date.now() - started < LIMIT_MS) {
    await new Promise(r => setTimeout(r, 5));
  }
}

/* r120: a recording upstream that builds the SAME [system, ...history, user]
 * shape the OpenAI adapter builds, using the session's history facade. Lets
 * this harness assert cross-turn injection without a real LLM endpoint. */
function historyRecorder(rec) {
  return class HistoryCaptureUpstream {
    start(session) { this.session = session; this.user = ''; this.gotAudio = false; session.sendState('thinking'); }
    sendAudio() { this.gotAudio = true; }
    sendText(t) { this.user = String(t == null ? '' : t); }
    stop() {
      const s = this.session;
      /* Mirror the real adapter's advisory-stop guard: device-close and fatal
       * paths call stop() too, and must not start a (recorded) response. */
      if (typeof s.isOpen === 'function' && !s.isOpen()) return;
      if (!this.gotAudio) { s.sendState('idle'); return; }
      const messages = [{ role: 'system', content: 'DEFAULT PERSONA' }];
      if (typeof s.historyEnabled === 'function' && s.historyEnabled() &&
          typeof s.historyMessages === 'function') {
        for (const m of s.historyMessages()) messages.push(m);
      }
      messages.push({ role: 'user', content: this.user || '(voice)' });
      rec.bodies.push(messages);
      const answer = 'A' + rec.bodies.length;
      s.sendTextDelta(answer, false);
      s.sendTextDelta('', true);
      if (typeof s.historyEnabled === 'function' && s.historyEnabled() &&
          typeof s.recordTurn === 'function') s.recordTurn(this.user || '(voice)', answer);
      s.sendState('idle');
      s.close(1000, 'done');   /* re-arms a fresh adapter when multiturn is on */
    }
  };
}

const hasType = (type) => (d) => {
  if (typeof d !== 'string') return false;
  try { return JSON.parse(d).type === type; } catch (e) { return false; }
};
const ctrl = (d) => JSON.parse(d);
const HELLO = { v: 1, type: 'hello', device: { model: 'lume', fw: 'r107' },
  caps: { audioFormats: ['pcm_s16le_16000_2ch'] } };
const HELLO_AUTH = (token) => Object.assign({}, HELLO, { auth: { token } });
/* r122: optional resume field (additive; old clients omit it). */
const HELLO_RESUME = (id, token) => Object.assign({}, HELLO, token
  ? { resume: id, auth: { token } } : { resume: id });
function assertNoTokenLeak(logs, token) {
  assert.equal(JSON.stringify(logs).includes(token), false,
    'device token must never appear in gateway logs');
}

(async () => {
  /* ---- 1. happy path: full chain + protocol fields + 60ms framing -------- */
  let adapter;
  const ANSWER = 'HI LUME.';
  await runCase('happy path: hello -> 60ms PCM -> text delta -> audio -> close',
    () => { adapter = new MockUpstream({ answer: ANSWER, audioFrames: 3, delayMs: 25 }); return adapter; },
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      const ack = ctrl(await until(st, hasType('hello-ack'), 'hello-ack'));
      assert.equal(ack.v, 1);
      assert.equal(ack.audioFormat, 'pcm_s16le_16000_2ch');
      assert.match(ack.sessionId, /^s\d+$/);

      /* 6 x 60 ms stereo frames = 6 * 960 samples = 6 * 3840 bytes */
      for (let i = 0; i < 6; i++) st.client.sendBinary(Buffer.alloc(UPLINK_BYTES, 0x11));
      st.client.sendText(JSON.stringify({ v: 1, type: 'text', text: 'PING' }));
      st.client.sendText(JSON.stringify({ v: 1, type: 'end' }));
      await untilClosed(st);

      const deltas = st.msgs.filter(hasType('text-delta')).map(ctrl);
      const audio = st.msgs.filter(d => Buffer.isBuffer(d));
      const states = st.msgs.filter(hasType('state')).map(ctrl).map(m => m.state);
      assert.equal(deltas.length, Array.from(ANSWER).length + 1, 'one delta per char + final');
      assert.equal(deltas.map(m => m.seq).join(','),
        deltas.map((_, i) => i).join(','), 'text seq strictly 0..N-1');
      assert.ok(deltas.slice(0, -1).every(m => m.final === false), 'intermediate deltas not final');
      assert.equal(deltas[deltas.length - 1].final, true, 'last delta marks final');
      assert.equal(deltas.map(m => m.text).join(''), ANSWER, 'device reassembles exact answer');
      assert.equal(audio.length, 3, '3 downlink audio frames');
      for (let i = 0; i < audio.length; i++) {
        const f = audio[i];
        assert.equal(f.length, AUDIO_HEADER_LENGTH + UPLINK_BYTES, '8-byte header + 3840 payload');
        assert.equal(f[0], 1, 'header version=1');
        assert.equal(f[1], 1, 'header type=audio');
        assert.equal(f[2], 1, 'header format=pcm_s16le');
        assert.equal(f.readUInt16LE(3), 16000, 'sampleRate=16000');
        assert.equal(f[5], 2, 'stereo');
        assert.equal(f[6], 16, '16-bit');
        assert.equal(f[7], i, 'audio seq 0..N-1');
        assert.equal(f.length - AUDIO_HEADER_LENGTH, 3840, '60ms payload fits playStream cap 4608');
      }
      assert.ok(audio[0].subarray(8).some(b => b !== 0), 'sine frame has signal');
      assert.ok(audio[1].subarray(8).every(b => b === 0), 'alternate frame is silence');
      assert.deepEqual(states, ['thinking', 'speaking', 'idle'], 'state progression');
      assert.ok(logs.some(l => l.event === 'session.close' && l.fields.code === 1000), 'close code 1000 logged');
      const session = gw.sessions[0];
      assert.equal(session.phase, 'active');
      assert.equal(session.audioFramesIn, 6, 'gateway accepted all six 60ms frames');
      assert.equal(session.audioBytesIn, 6 * 3840);
      assert.equal(session.textDeltasOut, ANSWER.length + 1);
      assert.equal(session.audioFramesOut, 3);
      assert.equal(session.closeCode, 1000);
      assert.equal(session.closeReason, 'done');
      assert.equal(adapter.audioFramesIn, 6, 'upstream got all uplink frames');
      assert.equal(adapter.textIn, 'PING', 'optional sendText routed');
      assert.equal(adapter.stopped, true, 'upstream released on turn end');
      assert.equal(st.errors.length, 0, 'no WS-level errors');
    });

  /* ---- 2. no hello: binary data first ----------------------------------- */
  await runCase('negative: uplink before hello -> not_hello + 1008', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.sendBinary(Buffer.alloc(UPLINK_BYTES));
    const err = ctrl(await until(st, hasType('error'), 'error frame'));
    assert.equal(err.v, 1);
    assert.equal(err.code, 'not_hello');
    assert.equal(err.fatal, true);
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1008);
  });

  await runCase('negative: non-hello text first -> not_hello + 1008', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.sendText(JSON.stringify({ v: 1, type: 'state', state: 'idle' }));
    const err = ctrl(await until(st, hasType('error'), 'error frame'));
    assert.equal(err.code, 'not_hello');
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1008);
  });

  /* ---- 3. bad frames ---------------------------------------------------- */
  await runCase('negative: broken JSON -> bad_json + 1002', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.sendText(JSON.stringify(HELLO));
    await until(st, hasType('hello-ack'), 'hello-ack');
    st.client.sendText('{not-json');
    const err = ctrl(await until(st, hasType('error'), 'error frame'));
    assert.equal(err.code, 'bad_json');
    assert.equal(err.fatal, true);
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1002);
  });

  await runCase('negative: 1920-byte mono frame -> bad_audio_frame + 1009', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.sendText(JSON.stringify(HELLO));
    await until(st, hasType('hello-ack'), 'hello-ack');
    st.client.sendBinary(Buffer.alloc(1920)); /* the incorrect mono size */
    const err = ctrl(await until(st, hasType('error'), 'error frame'));
    assert.equal(err.code, 'bad_audio_frame');
    assert.equal(err.fatal, true);
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1009);
  });

  await runCase('negative: unmasked WS frame rejected at WS layer + 1002', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.raw(encodeFrame(0x2, Buffer.alloc(8), { mask: false }));
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1002);
    assert.equal(st.msgs.length, 0, 'no application frames from a bad WS frame');
  });

  /* ---- 4. upstream disconnect ------------------------------------------- */
  await runCase('negative: upstream disconnect -> upstream_closed + 1011',
    () => new MockUpstream({ fail: true, delayMs: 10 }),
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      const err = ctrl(await until(st, hasType('error'), 'error frame'));
      assert.equal(err.code, 'upstream_closed');
      assert.equal(err.fatal, true);
      await untilClosed(st);
      assert.equal(gw.sessions[0].closeCode, 1011);
      assert.equal(st.msgs.filter(d => Buffer.isBuffer(d)).length, 0, 'no audio on failed upstream');
    });

  /* ---- 5. version guard ------------------------------------------------- */
  await runCase('negative: hello v=2 -> unsupported_version + 1008', null, async ({ gw, url }) => {
    const st = device(url);
    await untilOpen(st);
    st.client.sendText(JSON.stringify({ v: 2, type: 'hello' }));
    const err = ctrl(await until(st, hasType('error'), 'error frame'));
    assert.equal(err.code, 'unsupported_version');
    await untilClosed(st);
    assert.equal(gw.sessions[0].closeCode, 1008);
  });

  /* ---- 6. device-initiated close ---------------------------------------- */
  let closingAdapter;
  await runCase('device close: gateway releases upstream and echoes 1000',
    () => { closingAdapter = new MockUpstream({ delayMs: 500 }); return closingAdapter; },
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');
      st.client.sendBinary(Buffer.alloc(UPLINK_BYTES));
      st.client.close(1000, 'bye');
      await untilClosed(st);
      assert.equal(gw.sessions[0].closeCode, 1000);
      assert.equal(gw.sessions[0].closeReason, 'bye');
      assert.equal(closingAdapter.stopped, true, 'stop() called on device close');
    });

  /* ---- 7. non-fatal errors keep the session usable ---------------------- */
  let pingAdapter;
  await runCase('control: unknown_type is non-fatal, ping gets pong',
    () => { pingAdapter = new MockUpstream({ delayMs: 500 }); return pingAdapter; },
    async ({ url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');
      st.client.sendText(JSON.stringify({ v: 1, type: 'bogus' }));
      const err = ctrl(await until(st, hasType('error'), 'error frame'));
      assert.equal(err.code, 'unknown_type');
      assert.equal(err.fatal, false);
      st.client.sendText(JSON.stringify({ v: 1, type: 'ping' }));
      const pong = ctrl(await until(st, hasType('pong'), 'pong'));
      assert.equal(pong.v, 1);
      assert.equal(st.closed, false, 'non-fatal error did not close the socket');
      st.client.close(1000, 'bye');
      await untilClosed(st);
    });

  /* ---- 8. r117: real session emits transcript-delta with its own seq ---- */
  class TranscriptUpstream {
    start(session) {
      session.sendTranscriptDelta('YOU ', false);
      session.sendTranscriptDelta('SAID', false);
      session.sendTranscriptDelta('YOU SAID', true);  /* final = complete text */
      session.sendTextDelta('HI.', false);
      session.sendTextDelta('', true);
      session.sendState('idle');
      session.close(1000, 'done');
    }
    sendAudio() {}
    stop() {}
  }
  await runCase('r117: transcript seq independent of text/audio, single final',
    () => new TranscriptUpstream(), async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      const hello = Object.assign({}, HELLO, {
        caps: { audioFormats: ['pcm_s16le_16000_2ch'], streamTranscript: true }
      });
      st.client.sendText(JSON.stringify(hello));
      await untilClosed(st);
      const tx = st.msgs.filter(hasType('transcript-delta')).map(ctrl);
      const dl = st.msgs.filter(hasType('text-delta')).map(ctrl);
      assert.equal(tx.length, 3, '2 interim + 1 final');
      assert.deepEqual(tx.map((m) => m.seq), [0, 1, 2], 'transcript seq 0..N-1');
      assert.deepEqual(dl.map((m) => m.seq), [0, 1], 'text seq independent');
      assert.equal(tx.filter((m) => m.final === true).length, 1, 'exactly one final transcript');
      assert.equal(tx[2].text, 'YOU SAID', 'final carries complete transcript');
      assert.deepEqual(tx.map((m) => m.v), [1, 1, 1], 'v=1 on every control frame');
      const s = gw.sessions[0];
      assert.equal(s.transcriptDeltasOut, 3);
      assert.equal(s.textDeltasOut, 2);
      assert.equal(s.closeCode, 1000);
    });

  /* ---- 9. r119: device shared-token gate -------------------------------- */
  const TOKEN = 'SMOKE-TOKEN-r119-NOT-REAL';

  let openAdapter;
  await runCase('r119: open mode + hello without auth -> full round unchanged',
    () => { openAdapter = new MockUpstream({ answer: 'OPEN', audioFrames: 2, delayMs: 100 }); return openAdapter; },
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));           /* no auth field */
      const ack = ctrl(await until(st, hasType('hello-ack'), 'hello-ack'));
      assert.equal(ack.v, 1);
      for (let i = 0; i < 3; i++) st.client.sendBinary(Buffer.alloc(UPLINK_BYTES, 0x22));
      st.client.sendText(JSON.stringify({ v: 1, type: 'end' }));
      await untilClosed(st);
      assert.equal(st.msgs.filter(hasType('text-delta')).map(ctrl).map(d => d.text).join(''), 'OPEN');
      assert.equal(st.msgs.filter(d => Buffer.isBuffer(d)).length, 2);
      assert.equal(gw.sessions[0].closeCode, 1000);
      assert.equal(openAdapter.audioFramesIn, 3, 'upstream engaged in open mode');
      assert.equal(openAdapter.stopped, true);
    });

  let missingCalls = 0;
  await runCase('r119: locked + hello without token -> unauthorized + 1008 + zero upstream calls',
    () => { missingCalls++; return new MockUpstream(); },
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      const err = ctrl(await until(st, hasType('error'), 'error frame'));
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.fatal, true);
      assert.match(err.message, /^device token /, 'error message never echoes the token');
      await untilClosed(st);
      assert.equal(gw.sessions[0].closeCode, 1008);
      assert.equal(gw.sessions[0].phase, 'await-hello', 'session never activated');
      assert.equal(gw.sessions[0].upstream, null, 'no upstream adapter created');
      assert.equal(st.msgs.filter(hasType('hello-ack')).length, 0, 'no hello-ack');
      assert.equal(st.msgs.filter(d => Buffer.isBuffer(d)).length, 0, 'no downlink audio');
      assert.equal(missingCalls, 0, 'upstream factory never invoked');
      assertNoTokenLeak(logs, TOKEN);
    },
    { deviceToken: TOKEN });

  let wrongCalls = 0;
  await runCase('r119: locked + wrong token -> unauthorized + 1008 + zero upstream calls',
    () => { wrongCalls++; return new MockUpstream(); },
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO_AUTH('WRONG-TOKEN')));
      const err = ctrl(await until(st, hasType('error'), 'error frame'));
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.fatal, true);
      assert.match(err.message, /^device token /);
      await untilClosed(st);
      assert.equal(gw.sessions[0].closeCode, 1008);
      assert.equal(gw.sessions[0].phase, 'await-hello');
      assert.equal(gw.sessions[0].upstream, null);
      assert.equal(st.msgs.filter(hasType('hello-ack')).length, 0);
      assert.equal(st.msgs.filter(d => Buffer.isBuffer(d)).length, 0);
      assert.equal(wrongCalls, 0, 'upstream factory never invoked');
      assertNoTokenLeak(logs, TOKEN);
    },
    { deviceToken: TOKEN });

  let okAdapter;
  await runCase('r119: locked + correct token -> full round, upstream engaged',
    () => { okAdapter = new MockUpstream({ answer: 'AUTH OK', audioFrames: 2, delayMs: 100 }); return okAdapter; },
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO_AUTH(TOKEN)));
      const ack = ctrl(await until(st, hasType('hello-ack'), 'hello-ack'));
      assert.equal(ack.v, 1);
      for (let i = 0; i < 3; i++) st.client.sendBinary(Buffer.alloc(UPLINK_BYTES, 0x33));
      st.client.sendText(JSON.stringify({ v: 1, type: 'end' }));
      await untilClosed(st);
      assert.equal(st.msgs.filter(hasType('text-delta')).map(ctrl).map(d => d.text).join(''), 'AUTH OK');
      assert.equal(st.msgs.filter(d => Buffer.isBuffer(d)).length, 2);
      assert.equal(gw.sessions[0].closeCode, 1000);
      assert.equal(okAdapter.audioFramesIn, 3);
      assert.equal(okAdapter.stopped, true);
      assertNoTokenLeak(logs, TOKEN);
    },
    { deviceToken: TOKEN });

  let earlyCalls = 0;
  await runCase('r119: locked + audio before hello -> not_hello wins over token gate',
    () => { earlyCalls++; return new MockUpstream(); },
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendBinary(Buffer.alloc(UPLINK_BYTES, 0x44));
      const err = ctrl(await until(st, hasType('error'), 'error frame'));
      assert.equal(err.code, 'not_hello', 'not_hello checked before token gate');
      await untilClosed(st);
      assert.equal(gw.sessions[0].closeCode, 1008);
      assert.equal(earlyCalls, 0, 'upstream factory never invoked');
    },
    { deviceToken: TOKEN });

  /* ---- r120: per-session multi-turn history ----------------------------- */
  const rec1 = { bodies: [] };
  await runCase('r120: two turns carry user+assistant history; close clears; reconnect fresh',
    () => new (historyRecorder(rec1))(),
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');

      await driveTurn(st, 'MY NAME IS XIAOMING', 1);
      assert.equal(rec1.bodies.length, 1);
      assert.deepEqual(rec1.bodies[0], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'MY NAME IS XIAOMING' }
      ], 'turn 1 body = system + user');

      await driveTurn(st, 'WHAT IS MY NAME', 2);
      assert.equal(rec1.bodies.length, 2);
      assert.deepEqual(rec1.bodies[1], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'MY NAME IS XIAOMING' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'WHAT IS MY NAME' }
      ], 'turn 2 body injects turn 1 user+assistant before current user');

      const s1 = gw.sessions[0];
      assert.equal(s1.history.size(), 4, 'two user+assistant pairs after two turns');
      st.client.close(1000, 'bye');
      await untilClosed(st);
      await untilHistoryCleared(s1);
      assert.equal(s1.history.size(), 0, 'history cleared on ANY close');

      /* New connection = new conversation: no leakage from session s1. */
      const st2 = device(url);
      await untilOpen(st2);
      st2.client.sendText(JSON.stringify(HELLO));
      await until(st2, hasType('hello-ack'), 'hello-ack');
      await driveTurn(st2, 'FRESH CONVERSATION', 1);
      assert.deepEqual(rec1.bodies[2], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'FRESH CONVERSATION' }
      ], 'reconnected session has no prior history');
      st2.client.close(1000, 'bye');
      await untilClosed(st2);
    },
    { multiturn: true, historyLimit: 12 });

  const rec2 = { bodies: [] };
  await runCase('r120: history-limit=0 degrades to single-turn (r119 body)',
    () => new (historyRecorder(rec2))(),
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');
      assert.equal(gw.sessions[0].history.enabled(), false, 'limit=0 disables history');
      await driveTurn(st, 'FIRST', 1);
      await driveTurn(st, 'SECOND', 2);
      assert.deepEqual(rec2.bodies[0], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'FIRST' }
      ]);
      assert.deepEqual(rec2.bodies[1], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'SECOND' }
      ], 'no history injected when limit=0 (byte-for-byte r119 body)');
      st.client.close(1000, 'bye');
      await untilClosed(st);
    },
    { multiturn: true, historyLimit: 0 });

  const rec3 = { bodies: [] };
  await runCase('r120: window keeps only the most recent N pairs (oldest dropped first)',
    () => new (historyRecorder(rec3))(),
    async ({ gw, url }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');
      /* limit=4 -> at most 2 complete user+assistant pairs survive. */
      for (let t = 1; t <= 3; t++) await driveTurn(st, 'U' + t, t);
      assert.equal(gw.sessions[0].history.size(), 4, 'window capped at 4 messages');
      assert.deepEqual(gw.sessions[0].history.snapshot(), [
        { role: 'user', content: 'U2' }, { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'U3' }, { role: 'assistant', content: 'A3' }
      ], 'oldest pair (U1/A1) dropped first');
      st.client.close(1000, 'bye');
      await untilClosed(st);
    },
    { multiturn: true, historyLimit: 4 });

  /* ---- r122: disconnect-safe history via optional hello.resume ---------- */
  const rec4 = { bodies: [] };
  await runCase('r122: close retires history; reconnect with resume restores it',
    () => new (historyRecorder(rec4))(),
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      const ack = ctrl(await until(st, hasType('hello-ack'), 'hello-ack'));
      const sid = ack.sessionId;
      await driveTurn(st, 'REMEMBER ME', 1);
      assert.equal(gw.sessions[0].history.size(), 2);
      st.client.close(1000, 'bye');
      await untilClosed(st);
      await untilHistoryCleared(gw.sessions[0]);
      assert.equal(gw.sessions[0].history.size(), 0, 'live session still clears on close');
      assert.equal(gw.resumeStore.has(sid), true, 'snapshot retired under sessionId');

      const st2 = device(url);
      await untilOpen(st2);
      st2.client.sendText(JSON.stringify(HELLO_RESUME(sid)));
      await until(st2, hasType('hello-ack'), 'hello-ack #2');
      assert.equal(gw.resumeStore.has(sid), false, 'resume consumes the snapshot once');
      assert.ok(logs.some(l => l.event === 'history.resume' && l.fields.from === sid),
        'history.resume logged with source sessionId');
      await driveTurn(st2, 'DO YOU REMEMBER', 1);
      assert.deepEqual(rec4.bodies[0], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'REMEMBER ME' }
      ]);
      assert.deepEqual(rec4.bodies[1], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'REMEMBER ME' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'DO YOU REMEMBER' }
      ], 'turn 2 after resume injects turn-1 user+assistant before current user');
      assert.equal(gw.sessions[1].history.size(), 4);
      st2.client.close(1000, 'bye');
      await untilClosed(st2);
    },
    { multiturn: true, historyLimit: 12 });

  const rec5 = { bodies: [] };
  await runCase('r122: unknown resume id degrades to a fresh session',
    () => new (historyRecorder(rec5))(),
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO_RESUME('s-NOT-REAL')));
      await until(st, hasType('hello-ack'), 'hello-ack');
      assert.equal(gw.sessions[0].history.size(), 0, 'no history adopted on miss');
      assert.ok(logs.some(l => l.event === 'history.resume.miss'));
      await driveTurn(st, 'FRESH', 1);
      assert.deepEqual(rec5.bodies[0], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'FRESH' }
      ], 'miss behaves exactly like a new conversation');
      st.client.close(1000, 'bye');
      await untilClosed(st);
    },
    { multiturn: true });

  const RESUME_TOKEN = 'SMOKE-TOKEN-r122-NOT-REAL';
  const rec6 = { bodies: [] };
  let wrongResumeCalls = 0, armed = false;
  await runCase('r122: locked + wrong token + resume -> unauthorized, zero restore, zero upstream',
    () => { if (armed) wrongResumeCalls++; return new (historyRecorder(rec6))(); },
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO_AUTH(RESUME_TOKEN)));
      await until(st, hasType('hello-ack'), 'seed ack');
      await driveTurn(st, 'SEED', 1);
      const sid = gw.sessions[0].sessionId;
      st.client.close(1000, 'bye');
      await untilClosed(st);
      await untilHistoryCleared(gw.sessions[0]);
      assert.equal(gw.resumeStore.has(sid), true, 'seed retired with history');
      armed = true;

      const st2 = device(url);
      await untilOpen(st2);
      st2.client.sendText(JSON.stringify(HELLO_RESUME(sid, 'WRONG-TOKEN')));
      const err = ctrl(await until(st2, hasType('error'), 'error frame'));
      assert.equal(err.code, 'unauthorized');
      assert.equal(err.fatal, true);
      assert.match(err.message, /^device token /);
      await untilClosed(st2);
      assert.equal(gw.sessions[1].phase, 'await-hello');
      assert.equal(gw.sessions[1].upstream, null, 'no adapter on denied hello');
      assert.equal(gw.resumeStore.has(sid), true,
        'wrong token did not consume or restore the retired history');
      assert.equal(wrongResumeCalls, 0, 'upstream factory never invoked on denied hello');
      assertNoTokenLeak(logs, RESUME_TOKEN);
    },
    { deviceToken: RESUME_TOKEN, multiturn: true });

  const rec7 = { bodies: [] };
  await runCase('r122: expired resume snapshot degrades to a fresh session',
    () => new (historyRecorder(rec7))(),
    async ({ gw, url, logs }) => {
      const st = device(url);
      await untilOpen(st);
      st.client.sendText(JSON.stringify(HELLO));
      await until(st, hasType('hello-ack'), 'hello-ack');
      await driveTurn(st, 'OLD', 1);
      const sid = gw.sessions[0].sessionId;
      st.client.close(1000, 'bye');
      await untilClosed(st);
      await untilHistoryCleared(gw.sessions[0]);
      await new Promise(r => setTimeout(r, 30));
      const st2 = device(url);
      await untilOpen(st2);
      st2.client.sendText(JSON.stringify(HELLO_RESUME(sid)));
      await until(st2, hasType('hello-ack'), 'hello-ack #2');
      assert.ok(logs.some(l => l.event === 'history.resume.miss' && l.fields.from === sid));
      assert.equal(gw.resumeStore.has(sid), false, 'expired entry evicted');
      await driveTurn(st2, 'FRESH', 1);
      assert.deepEqual(rec7.bodies[1], [
        { role: 'system', content: 'DEFAULT PERSONA' },
        { role: 'user', content: 'FRESH' }
      ], 'TTL expiry starts a new conversation');
      st2.client.close(1000, 'bye');
      await untilClosed(st2);
    },
    { multiturn: true, resumeTtlMs: 10 });

  console.log(`ALL GATEWAY HARNESS CASES PASSED (${checks} cases)`);
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
