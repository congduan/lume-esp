/* r74 host harness: voice_assistant state machine over mocked ws/audio/ai.
 * 12 checks: legacy chat path, streaming session lifecycle, barge-in,
 * delta ordering, binary routing, disconnect fallbacks, callback lightness. */
const assert = require('node:assert/strict');
const { buildSync } = require('../tools/lume/node_modules/esbuild');
const { runApp } = require('./lib/prelude_runner');

const bundled = buildSync({ entryPoints: ['examples/voice_assistant/app.js'], bundle: true,
  format: 'iife', platform: 'neutral', write: false }).outputFiles[0].text;

function pcm(n, level = 0.5) {
  const b = new ArrayBuffer(n * 4), v = new DataView(b);
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin(2 * Math.PI * 440 * i / n) * level * 32767);
    v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
  }
  return b;
}

let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS voice ' + name); }

function makeEnv(opts = {}) {
  const env = { micActive: false, micStopped: 0, sent: [], played: [], resets: 0, wsId: 7 };
  const ui = runApp(bundled, {
    kv: { get: k => (opts.kv || {})[k] ?? null },
    net: {
      connect: () => 0,
      ws: {
        _connect: (url, headers) => { env.wsUrl = url; return ++env.wsId; },
        _send: (id, data) => { env.sent.push(data); return 0; },
        _close: () => 0,
      },
      ...(opts.net || {}),
    },
    audio: {
      _recordStream: n => { env.micActive = true; env.micN = n; return 0; },
      _stopStream: () => { env.micActive = false; env.micStopped++; return 0; },
      playStream: (chunk, o) => { env.played.push([chunk.byteLength, o.sampleRate]); return 0; },
      streamReset: () => { env.resets++; return 0; },
      recordStreamDropped: () => 0,
    },
    onLog: () => {},
  });
  env.ui = ui;
  env.vaState = () => ui.ctx.__va.state();
  env.vaTranscript = () => ui.ctx.__va.transcript();
  env.vaErr = () => ui.ctx.__va.err();
  env.vaVu = () => ui.ctx.__va.vu();
  env.vaPending = () => ui.ctx.__va.pending();
  env.vaPendingOfs = () => ui.ctx.__va.pendingOfs();
  env.rootId = ui.messages.findLast(m => m[0] === 'gesture')[1];
  env.tap = () => { ui.gesture(env.rootId, 0, 240, 400, 0); ui.gesture(env.rootId, 2, 240, 400, 100); };
  return env;
}

/* ---- legacy mode (no gw_url) ---- */
check('legacy: tap runs one synchronous chat turn', () => {
  const env = makeEnv({ kv: { ai_api_key: 'k', wifi_ssid: 's', wifi_pass: 'p' } });
  env.ui.lume.net.httpRequest = () => ({ status: 200,
    body: JSON.stringify({ choices: [{ message: { content: 'ESP32 answer' }, finish_reason: 'stop' }] }), truncated: false });
  env.tap();
  assert.equal(env.vaState(), 'IDLE');
  assert.equal(env.vaTranscript(), 'ESP32 answer');
  env.tap();  /* second tap -> next question */
  assert.match(env.vaTranscript(), /^ESP32 answer|./);
});

check('legacy: missing key surfaces error, state stays IDLE', () => {
  const env = makeEnv({ kv: { wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  assert.equal(env.vaState(), 'IDLE');
  assert.match(env.vaErr(), /ai key/);
});

check('legacy: chat error code surfaces and clears transcript', () => {
  const env = makeEnv({ kv: { ai_api_key: 'k', wifi_ssid: 's', wifi_pass: 'p' } });
  env.ui.lume.net.httpRequest = () => -5;
  env.tap();
  assert.equal(env.vaState(), 'IDLE');
  assert.match(env.vaErr(), /CHAT ERR -5/);
  assert.equal(env.vaTranscript(), '');
});

/* ---- streaming mode (gw_url provisioned) ---- */
check('streaming: session opens, tap starts mic + LISTEN', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', ai_api_key: 'k', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);            /* onOpen */
  assert.equal(env.vaState(), 'LISTEN');
  assert.equal(env.micActive, true);
  assert.equal(env.wsUrl, 'ws://gw/voice');
});

check('streaming: mic chunks forward bytes upstream + VU signal', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  const before = env.sent.length;
  env.ui.ctx.__lume_dispatchAudioChunk(pcm(64), 64);
  assert.equal(env.sent.length, before + 1);
  assert.ok(env.sent[before] instanceof ArrayBuffer);
  assert.ok(env.vaVu() > 0 && env.vaVu() <= 1);
  /* second chunk -> forwarded too; state gate keeps LISTEN-only */
  env.ui.ctx.__lume_dispatchAudioChunk(pcm(64), 64);
  assert.equal(env.sent.length, before + 2);
});

check('streaming: tap in LISTEN sends end and flips THINK', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.sent.length = 0;
  env.tap();
  assert.equal(env.vaState(), 'THINK');
  assert.deepEqual(env.sent, ['{"type":"end"}']);
  assert.equal(env.micActive, false);
});

check('streaming: deltas concatenate in arrival order', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'delta', text: '你好' }));
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'delta', text: '，世界' }));
  assert.equal(env.vaTranscript(), '你好，世界');
});

check('streaming: state SPEAK + binary routed to playStream via tick', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'state', value: 'SPEAK' }));
  assert.equal(env.vaState(), 'SPEAK');
  const buf = pcm(3000);                                /* 12000 B > 4608 */
  env.ui.ctx.__lume_dispatchWS(id, 2, buf);
  vm_run(env, '__lume_tick()');                          /* feed in tick */
  assert.equal(env.played.length, Math.ceil(12000 / 4608));   /* 3 chunks */
  assert.equal(env.played[0][1], 16000);
  assert.equal(env.ui.ctx.vaPending, null);
});

check('streaming: playStream -3 defers feed to a later tick', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  let full = true;
  env.ui.lume.audio.playStream = (chunk, o) => {
    if (full) return -3;
    env.played.push([chunk.byteLength, o.sampleRate]); return 0;
  };
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'state', value: 'SPEAK' }));
  env.ui.ctx.__lume_dispatchWS(id, 2, pcm(100));        /* 400 B */
  vm_run(env, '__lume_tick()');                          /* still full */
  assert.equal(env.played.length, 0);
  assert.equal(env.vaPendingOfs(), 0);
  full = false;
  vm_run(env, '__lume_tick()');                          /* retried whole chunk */
  assert.equal(env.played.length, 1);
  assert.equal(env.ui.ctx.vaPending, null);
});

check('streaming: barge-in from SPEAK resets playback, returns to LISTEN', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw://gw/voice'.replace('://gw://', '://'), wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'state', value: 'SPEAK' }));
  env.ui.ctx.__lume_dispatchWS(id, 2, pcm(10));
  vm_run(env, '__lume_tick()');
  env.sent.length = 0;
  env.tap();                                             /* barge */
  assert.equal(env.vaState(), 'LISTEN');
  assert.equal(env.micActive, true);                     /* mic back up */
  assert.deepEqual(env.sent, ['{"type":"barge"}']);
  assert.equal(env.resets, 1);
  assert.equal(env.ui.ctx.vaPending, null);
});

check('streaming: DONE ends session, transcript stays, no mic', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(.0 + env.wsId, 1, null);
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'delta', text: 'done text' }));
  env.ui.ctx.__lume_dispatchWS(id, 2, JSON.stringify({ type: 'state', value: 'DONE' }));
  assert.equal(env.vaState(), 'IDLE');
  assert.equal(env.vaTranscript(), 'done text');   /* stays up */
  assert.equal(env.micActive, false);
  /* a tap restarts a fresh session (IDLE -> connect again) */
  env.tap();
  assert.ok(env.wsId > id);                              /* new _connect */
});

check('streaming: ws drop during THINK falls back to IDLE error', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  env.tap();                                             /* LISTEN -> THINK */
  env.ui.ctx.__lume_dispatchWS(id, 3, null);             /* onClose */
  assert.equal(env.vaState(), 'IDLE');
  assert.match(env.vaErr(), /GW CLOSED/);
  assert.equal(env.micActive, false);
  /* late mic chunk after teardown is ignored */
  const before = env.sent.length;
  env.ui.ctx.__lume_dispatchAudioChunk(pcm(8), 8);
  assert.equal(env.sent.length, before);
});

check('streaming: connect failure surfaces error, stays IDLE', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.ui.lume.net.ws._connect = () => -3;                /* prelude -> cb(-3,null) */
  env.tap();
  assert.equal(env.vaState(), 'IDLE');
  assert.match(env.vaErr(), /GW CONNECT ERR -3/);
});

function vm_run(env, code) {
  /* timers are due-gated on lume._nowMs(); jump the clock so the 50 ms
   * playback tick actually fires (spectrum.js precedent). */
  env.ui.lume._nowMs = () => Date.now() + 10000;
  return require('node:vm').runInContext(code, env.ui.ctx);
}

check('mic callback stays light: no strings built, only forward + VU', () => {
  const env = makeEnv({ kv: { gw_url: 'ws://gw/voice', wifi_ssid: 's', wifi_pass: 'p' } });
  env.tap();
  const id = env.wsId;
  env.ui.ctx.__lume_dispatchWS(id, 1, null);
  const before = env.ui.messages.length;
  env.ui.ctx.__lume_dispatchAudioChunk(pcm(128), 128);
  /* attr emissions stay at the single VU signal update (no transcript churn) */
  const after = env.ui.messages.length;
  assert.ok(after - before <= 2, 'callback emitted ' + (after - before) + ' messages');
  env.ui.ctx.__lume_dispatchAudioChunk(pcm(128), 128);
  assert.ok(env.ui.messages.length - after <= 2);
});

assert.equal(checks, 12);
console.log('voice_assistant host harness: ' + checks + ' checks PASS');
