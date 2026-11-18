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

async function runCase(label, factory, fn) {
  const logs = [];
  const gw = createGateway({
    port: 0,
    log: (event, fields) => logs.push({ event, fields }),
    upstreamFactory: factory || (() => new MockUpstream())
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

const hasType = (type) => (d) => {
  if (typeof d !== 'string') return false;
  try { return JSON.parse(d).type === type; } catch (e) { return false; }
};
const ctrl = (d) => JSON.parse(d);
const HELLO = { v: 1, type: 'hello', device: { model: 'lume', fw: 'r107' },
  caps: { audioFormats: ['pcm_s16le_16000_2ch'] } };

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

  console.log(`ALL GATEWAY HARNESS CASES PASSED (${checks} cases)`);
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
