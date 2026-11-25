/* r108 voice_assistant WS transport host harness.
 * Boots r107's zero-dependency mock gateway, bridges the prelude's
 * lume.net.ws stub (_connect/_send/_close) to the real gateway client, and
 * drives the app's WS transport through a full dialog turn plus negatives.
 * Honesty scope: protocol + app logic only; no board, no real ASR/LLM/TTS.
 * Run: node tests/va_ws.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const { createGateway, connect: gwConnect, MockUpstream } = require('../tools/gateway');

const source = fs.readFileSync('examples/voice_assistant/app.js', 'utf8');
const CANNED = ['HI. I AM LISTENING ON THE WATCH.', 'THE CLOCK FACE HAS THE LOCAL TIME.',
  'OPEN THE POWER PAGE FOR LEVEL.', 'A BYTE WALKED INTO A BAR. IT DID NOT COMPUTE.'];
/* r195: the r119 open-LAN hello, frozen byte-for-byte for the no-token case. */
const OPEN_LAN_HELLO = {
  v: 1, type: 'hello',
  device: { model: 'lume', fw: 'r108', app: 'voice_assistant' },
  /* r117: device opts in to the v1.1 transcript-delta downlink. */
  caps: { audioFormats: ['pcm_s16le_16000_2ch'], streamTranscript: true }
};
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };

/* ---- zero-dep bridge: prelude WS stub <-> real gateway client ----------- */
function makeBridge() {
  const clients = new Map();
  let nextId = 1;
  const bridge = {
    ctx: null,
    /* r195: record the upgrade URL and the headers string built by the
     * prelude, plus the raw text frames, so handshake auth and byte-identical
     * hello can be asserted at the live boundary. */
    stats: { connects: 0, text: [], textRaw: [], headers: [], connectUrls: [],
      binary: [], closes: 0, dispatchErrors: [] },
    _connect(url, headers) {
      bridge.stats.connects++;
      bridge.stats.connectUrls.push(url);
      bridge.stats.headers.push(headers);
      const id = nextId++;
      const fire = (kind, ref) => {
        try {
          vm.runInContext('__lume_dispatchWS(' + id + ',' + kind + (ref ? ',' + ref : '') + ')',
            bridge.ctx);
        } catch (e) { bridge.stats.dispatchErrors.push(String(e)); }
      };
      const cli = gwConnect(url, {
        onOpen() { fire(1); },
        onMessage(data) {
          /* Node Buffer is the host analog of the device ArrayBuffer. */
          bridge.ctx.__wsData = Buffer.isBuffer(data)
            ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            : data;
          fire(2, '__wsData');
        },
        onClose() { fire(3); },
        onError() { fire(4); }
      });
      clients.set(id, cli);
      return id;
    },
    _send(id, data) {
      const cli = clients.get(id);
      if (!cli) return -1;
      if (typeof data === 'string') {
        bridge.stats.text.push(JSON.parse(data));
        bridge.stats.textRaw.push(data);
        cli.sendText(data);
      } else {
        const buf = Buffer.from(data);
        bridge.stats.binary.push(buf.length);
        cli.sendBinary(buf);
      }
      return 0;
    },
    _close(id) {
      const cli = clients.get(id);
      if (!cli) return -1;
      bridge.stats.closes++;
      cli.close(1000, 'device');
      clients.delete(id);
      return 0;
    }
  };
  return bridge;
}

function boot(url, opts = {}) {
  const bridge = makeBridge();
  const logs = [], play = [];
  /* r195: counting token KV reads lets the live reuse assertion catch a
   * regression that starts reading/building the handshake token even without
   * opening a new connection. */
  const kvGets = { voice_gateway_token: 0, voice_gateway_handshake_token: 0 };
  const audio = Object.assign({
    _recordStream: () => 0,           /* prelude wraps this into recordStream */
    _stopStream: () => 0,
    playStream: (pcm, o) => { play.push({ bytes: pcm.byteLength, opts: o }); return 0; },
    streamFinished: () => true
  }, opts.audio || {});
  const netStub = Object.assign({
    GOT_IP: 3, status: () => ({ state: 3, ip: '127.0.0.1' }), ws: bridge
  }, opts.net || {});
  const ui = runApp(source, {
    onLog: (...a) => logs.push(a.join(' ')),
    kv: { get: k => {
      if (k === 'voice_gateway_token') kvGets.voice_gateway_token++;
      if (k === 'voice_gateway_handshake_token') kvGets.voice_gateway_handshake_token++;
      return (k === 'voice_gateway_url' && url) ? url : ((opts.keys && opts.keys[k]) || null);
    } },
    net: netStub,
    audio
  });
  bridge.ctx = ui.ctx;
  return { ui, bridge, logs, play, kvGets, c: ui.ctx };
}

/* Feed one native 1024-stereo-frame (4096 B) recordStream chunk into the
 * engine task exactly as the firmware sink would. */
function feedChunk(ui, bytes = 4096, fill = 0x5a) {
  const ab = new ArrayBuffer(bytes);
  new Uint8Array(ab).fill(fill);
  ui.ctx.__chunk = ab;
  vm.runInContext('__lume_dispatchAudioChunk(__chunk,' + (bytes / 4) + ')', ui.ctx);
}

function drive(c) { c.vaActivate(); c.vaActivate(); c.vaDeferredSend(); }

async function waitFor(pred, label, timeout = 3000) {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return;
    if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label);
    await new Promise(r => setTimeout(r, 5));
  }
}

async function withGw(factory, logs, fn, opts = {}) {
  const gw = createGateway({ port: 0, deviceToken: opts.deviceToken || '',
    /* r121: opt-in keep-alive; default off keeps all baseline cases unchanged. */
    multiturn: !!opts.multiturn,
    log: (e, f) => logs.push({ e, f }), upstreamFactory: factory });
  await gw.start();
  const url = 'ws://127.0.0.1:' + gw.address().port + '/';
  try { await fn(gw, url); } finally { await gw.close(); }
}

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

class SlowUpstream {
  constructor() { this.stopped = false; }
  start(session) { session.sendTextDelta('W', false); session.sendTextDelta('A', false); }
  sendAudio() {}
  stop() { this.stopped = true; }
}

/* r121: deterministic keep-alive upstream. Unlike MockUpstream it does NOT
 * auto-respond on a timer; it responds only on stop() (the device 'end' frame),
 * matching the real adapter. It also snapshots historyMessages() at start() so
 * the harness can prove cross-turn accumulation and post-reconnect clearing. */
function makeMTFactory(captured, answers) {
  let n = 0;
  return () => {
    const answer = answers[n++] || 'REPLY';
    return {
      answer, stopped: false, textIn: null, fired: false, session: null,
      start(session) {
        this.session = session;
        captured.push(typeof session.historyMessages === 'function'
          ? session.historyMessages() : []);
        session.sendState('thinking');
      },
      sendAudio() {},
      sendText(t) { this.textIn = String(t); },
      stop() {
        if (this.fired) return;
        this.fired = true; this.stopped = true;
        const s = this.session;
        if (!s) return;
        for (const ch of Array.from(this.answer)) s.sendTextDelta(ch, false);
        s.sendTextDelta('', true);
        if (typeof s.historyEnabled === 'function' && s.historyEnabled() &&
            typeof s.recordTurn === 'function') {
          s.recordTurn(this.textIn || '(no input)', this.answer);
        }
        s.sendState('idle');
        s.close(1000, 'done');
      }
    };
  };
}

function smoke(b, gwLog, answer) {
  console.log('--- SMOKE gateway side (raw) ---');
  for (const l of gwLog) {
    if (['hello', 'uplink.pcm', 'turn.end', 'session.close'].indexOf(l.e) >= 0)
      console.log('[GW] ' + l.e + ' ' + JSON.stringify(l.f));
  }
  console.log('--- SMOKE device side (raw) ---');
  for (const l of b.logs) {
    if (l === 'VA MODE GATEWAY' || l.indexOf('VA WS') === 0 || l.indexOf('VA MIC') === 0)
      console.log('[DEV] ' + l);
  }
  console.log('--- SMOKE reassembled answer: ' + JSON.stringify(b.c.vaFullText) +
    ' (gateway answer ' + JSON.stringify(answer) + ') ---');
}

(async () => {
  /* ---- 1. happy path: full v1 turn, both sides -------------------------- */
  const ANSWER = 'HI LUME.';
  const gwLog = [];
  let adapter;
  await withGw(() => { adapter = new MockUpstream({ answer: ANSWER, audioFrames: 3, delayMs: 120 }); return adapter; },
    gwLog, async (gw, url) => {
      const b = boot(url);
      assert.equal(b.c.vaMode, 'GATEWAY');
      assert.ok(b.logs.includes('VA MODE GATEWAY'));
      assert.equal(b.c.vaState(), 'IDLE');
      b.c.vaActivate();                       /* IDLE -> LISTEN */
      assert.equal(b.c.vaState(), 'LISTEN');
      b.c.vaActivate();                       /* LISTEN -> THINK */
      assert.equal(b.c.vaState(), 'THINK');
      b.c.vaDeferredSend();                   /* deferred frame runs the transport */
      await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello sent');
      assert.deepEqual(b.bridge.stats.text[0], OPEN_LAN_HELLO);
      /* r195: no token -> no handshake headers AND the hello frame is still
       * byte-identical to the r119 frozen value (open LAN compatibility). */
      assert.equal(b.bridge.stats.headers[0], '', 'r195: open LAN sends no upgrade headers');
      assert.equal(b.bridge.stats.textRaw[0], JSON.stringify(OPEN_LAN_HELLO),
        'r195: open LAN hello frame byte-identical to r119');
      await waitFor(() => b.c.vaStreamAcked, 'hello-ack');

      /* Three native 4096 B chunks -> 3 x 3840 B wire frames, no mono 1920 B. */
      feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui);
      assert.deepEqual(b.bridge.stats.binary, [3840, 3840, 3840],
        'uplink = 60 ms stereo 3840 B frames');
      b.c.vaWSPump();                         /* push-to-talk window closed -> end */
      await waitFor(() => b.bridge.stats.text.some(m => m.type === 'end'), 'end frame');
      assert.equal(b.c.vaStreamUplinkFrames, 3);
      assert.equal(b.c.vaStreamEndSent, true);
      assert.equal(b.c.vaStreamSession.active, false, 'recordStream session stopped');

      /* Deltas reassemble char-by-char, audio plays via playStream. */
      await waitFor(() => b.c.vaStreamAudioFrames === 3 && b.c.vaStreamFinal, 'audio + final', 4000);
      assert.equal(b.c.vaFullText, ANSWER);
      assert.equal(b.c.vaTypingPos(), ANSWER.length, 'answer fully on screen');
      assert.equal(b.c.vaStreamDeltas, ANSWER.length + 1, 'one delta per char + final');
      assert.equal(b.c.vaState(), 'SPEAK');
      assert.equal(b.play.length, 3, 'three downlink frames fed to playStream');
      for (const p of b.play) assert.equal(p.bytes, 3840, 'downlink payload <=4608 B');
      assert.equal(b.play[0].opts.sampleRate, 16000);
      assert.equal(b.play[0].opts.channels, 2);
      assert.equal(b.play[0].opts.bits, 16);
      assert.ok(b.logs.some(l => l === 'VA WS AUDIO hdr=1/1/1/16000/2/16 seq=0 bytes=3840'));

      /* Gateway-side counters + close discipline. */
      const s = gw.sessions[0];
      assert.equal(s.audioFramesIn, 3);
      assert.equal(s.audioBytesIn, 3 * 3840);
      assert.equal(s.textDeltasOut, ANSWER.length + 1);
      assert.equal(s.audioFramesOut, 3);
      assert.equal(s.closeCode, 1000);
      assert.equal(s.closeReason, 'done');
      assert.equal(adapter.stopped, true, 'upstream released at turn end');
      assert.ok(gwLog.some(l => l.e === 'hello'));
      assert.ok(gwLog.some(l => l.e === 'turn.end'));
      assert.ok(gwLog.some(l => l.e === 'session.close' && l.f.code === 1000));

      await waitFor(() => b.c.vaStreamFinished, 'app finish');
      b.c.vaSpeakDone();                       /* drive the deferred speak timer */
      assert.equal(b.c.vaState(), 'IDLE');
      assert.ok(b.logs.some(l => l === 'VA WS REPLY chars=8 audio=3 deltas=9'));
      assert.equal(b.bridge.stats.dispatchErrors.length, 0);
      smoke(b, gwLog, ANSWER);
      pass('happy: hello -> 3x3840B uplink -> end -> 9 deltas -> 3 audio -> idle/close -> IDLE');
    });

  /* ---- 2. negative: gateway refuses the TCP connection ------------------ */
  const dead = await freePort();
  const refused = boot('ws://127.0.0.1:' + dead + '/');
  drive(refused.c);
  await waitFor(() => refused.logs.some(l => /^VA WS (ERR|CONNECT ERR)/.test(l)), 'connect failure');
  await waitFor(() => refused.c.vaState() === 'IDLE', 'IDLE after refuse');
  assert.equal(refused.c.vaStreamFinished, true);
  assert.equal(refused.bridge.stats.binary.length, 0, 'no uplink without a connection');
  refused.c.vaActivate();                      /* not hung: can wake again */
  assert.equal(refused.c.vaState(), 'LISTEN');
  pass('negative 1: gateway refuse -> IDLE, no uplink, not hung');

  /* ---- 3. negative: upstream disconnects mid-response ------------------- */
  const gwLog3 = [];
  await withGw(() => new MockUpstream({ answer: 'PARTIAL', fail: true, delayMs: 20 }), gwLog3,
    async (gw, url) => {
      const b = boot(url);
      drive(b.c);
      await waitFor(() => b.logs.some(l => l.startsWith('VA WS FRAME ERROR upstream_closed')),
        'fatal upstream_closed frame');
      await waitFor(() => b.c.vaState() === 'IDLE', 'IDLE after upstream close');
      assert.equal(b.c.vaStreamFinished, true);
      assert.ok(b.c.vaFullText.length > 0 && b.c.vaFullText.length < 8,
        'partial answer kept: ' + JSON.stringify(b.c.vaFullText));
      assert.equal(b.play.length, 0, 'no audio from failed upstream');
      assert.equal(gw.sessions[0].closeCode, 1011);
      pass('negative 2: mid-stream upstream disconnect -> partial text, IDLE, no hang');
    });

  /* ---- 4. negative: gateway fatal upstream_error ------------------------ */
  const gwLog4 = [];
  await withGw(() => ({ start() { throw new Error('boom'); }, sendAudio() {}, stop() {} }), gwLog4,
    async (gw, url) => {
      const b = boot(url);
      drive(b.c);
      await waitFor(() => b.logs.some(l => l.startsWith('VA WS FRAME ERROR upstream_error')),
        'fatal upstream_error frame');
      await waitFor(() => b.c.vaState() === 'IDLE', 'IDLE after upstream_error');
      assert.equal(gw.sessions[0].closeCode, 1011);
      assert.equal(b.bridge.stats.dispatchErrors.length, 0);
      pass('negative 3: gateway fatal upstream_error -> IDLE, no hang');
    });

  /* ---- 5. barge-in mid-stream: end frame delivered ---------------------- */
  const gwLog5 = [];
  let slow;
  await withGw(() => { slow = new SlowUpstream(); return slow; }, gwLog5, async (gw, url) => {
    const b = boot(url);
    drive(b.c);
    await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello');
    await waitFor(() => b.c.vaStreamAcked, 'ack');
    feedChunk(b.ui);
    await waitFor(() => b.c.vaState() === 'SPEAK', 'SPEAK on first delta');
    assert.equal(b.c.vaStreamSession.active, true, 'mic still live before barge-in');
    assert.equal(b.c.vaBargeIn(), true);
    assert.equal(b.c.vaState(), 'IDLE');
    assert.ok(b.logs.includes('VA WS ABORT'));
    await waitFor(() => b.bridge.stats.text.some(m => m.type === 'end'), 'end on barge-in');
    assert.equal(b.c.vaStreamSession.active, false, 'mic stopped on barge-in');
    await waitFor(() => slow.stopped === true, 'gateway upstream released after end');
    pass('barge-in: SPEAK -> IDLE, end frame delivered, mic stopped, upstream released');
  });

  /* ---- 6. fallback: no gateway URL / non-function restores legacy ------- */
  const fb = boot('ws://127.0.0.1:1/', { net: { status: () => ({ state: 0, ip: null }) } });
  assert.equal(fb.c.vaMode, 'DEMO');
  drive(fb.c);
  assert.equal(fb.c.vaState(), 'SPEAK');
  assert.ok(CANNED.indexOf(fb.c.vaFullText) >= 0, 'canned legacy reply used');
  assert.equal(fb.bridge.stats.connects, 0, 'no WS connection in DEMO mode');
  fb.c.vaBargeIn();
  fb.c.vaSetTransport(null);                   /* non-function -> legacy */
  drive(fb.c);
  assert.equal(fb.c.vaState(), 'SPEAK');
  assert.ok(CANNED.indexOf(fb.c.vaFullText) >= 0, 'non-function falls back to legacy');
  pass('fallback: no gateway -> legacy canned; vaSetTransport(non-fn) restores legacy');

  /* ---- 7. r117: transcript-delta consumed, answer not overwritten ------- */
  class TranscriptUpstream {
    constructor() { this.stopped = false; }
    start(session) {
      session.sendTranscriptDelta('HELLO ', false);
      session.sendTranscriptDelta('LUME', false);
      session.sendTranscriptDelta('HELLO LUME', true);   /* complete, not increment */
      session.sendTextDelta('HI.', false);
      session.sendTextDelta('', true);
      session.sendState('idle');
      session.close(1000, 'done');
    }
    sendAudio() {}
    stop() { this.stopped = true; }
  }
  const gwLog7 = [];
  await withGw(() => new TranscriptUpstream(), gwLog7, async (gw, url) => {
    const b = boot(url);
    drive(b.c);
    await waitFor(() => b.c.vaStreamFinished, 'turn finished');
    assert.equal(b.c.vaStreamTxDeltas, 3, '3 transcript frames consumed');
    assert.equal(b.c.vaTxFinal(), 'HELLO LUME', 'final transcript sealed in signal');
    assert.equal(b.c.vaFullText, 'HI.', 'chat answer kept separate from transcript');
    assert.ok(b.logs.some((l) => l === 'VA WS TRANSCRIPT n=1 chars=6'));
    assert.ok(b.logs.some((l) => l === 'VA WS TRANSCRIPT n=2 chars=4'));
    assert.ok(b.logs.some((l) => l === 'VA WS TRANSCRIPT FINAL n=3 chars=10'));
    const txFinalIdx = b.logs.findIndex((l) => l.indexOf('TRANSCRIPT FINAL') >= 0);
    const firstDeltaIdx = b.logs.findIndex((l) => l.indexOf('VA WS DELTA') >= 0);
    assert.ok(txFinalIdx >= 0 && firstDeltaIdx > txFinalIdx,
      'final transcript logged before the first chat delta');
    assert.equal(b.bridge.stats.dispatchErrors.length, 0, 'no dispatch errors');
    pass('r117: transcript consumed into signal, answer intact, final before chat delta');
  });

  /* ---- 8/9. r119: app-side shared token -------------------------------- */
  const APP_TOKEN = 'APP-TOKEN-r119-NOT-REAL';
  const gwLog8 = [];
  let adapter8;
  await withGw(() => { adapter8 = new MockUpstream({ answer: 'LOCKED OK', audioFrames: 2, delayMs: 40 }); return adapter8; },
    gwLog8, async (gw, url) => {
      const b = boot(url, { keys: { voice_gateway_token: APP_TOKEN } });
      drive(b.c);
      await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello sent');
      assert.equal(b.bridge.stats.text[0].auth && b.bridge.stats.text[0].auth.token, APP_TOKEN);
      /* r195: the same KV token also gates the upgrade request. */
      assert.equal(b.bridge.stats.headers[0], 'Authorization: Bearer ' + APP_TOKEN + '\r\n',
        'r195: token -> Authorization: Bearer on the WS upgrade');
      assert.ok(b.logs.includes('VA WS HELLO AUTH'), 'app logs auth flag (never the token value)');
      assert.equal(b.logs.some(l => l.indexOf(APP_TOKEN) >= 0), false, 'token absent from device logs');
      await waitFor(() => b.c.vaStreamFinished, 'turn finished');
      assert.equal(b.c.vaFullText, 'LOCKED OK');
      assert.equal(gw.sessions[0].closeCode, 1000);
      assert.equal(adapter8.started, true, 'locked gateway engaged upstream');
      assert.equal(gwLog8.some(l => JSON.stringify(l).includes(APP_TOKEN)), false,
        'token absent from gateway logs');
      assert.equal(b.bridge.stats.dispatchErrors.length, 0);
      pass('r119: device KV token -> hello.auth -> locked gateway full round');
    }, { deviceToken: APP_TOKEN });

  const gwLog9 = [];
  let deniedCalls = 0;
  await withGw(() => { deniedCalls++; return new MockUpstream(); }, gwLog9, async (gw, url) => {
    const b = boot(url, { keys: { voice_gateway_token: APP_TOKEN } });
    drive(b.c);
    await waitFor(() => b.logs.some(l => l.indexOf('VA WS FRAME ERROR unauthorized') >= 0),
      'device sees unauthorized fatal frame');
    await waitFor(() => b.c.vaState() === 'IDLE' && b.c.vaStreamFinished, 'app settles after denial');
    assert.equal(deniedCalls, 0, 'no upstream adapter created on denied hello');
    assert.equal(gw.sessions[0].closeCode, 1008);
    assert.equal(gw.sessions[0].phase, 'await-hello');
    assert.equal(b.logs.some(l => l.indexOf(APP_TOKEN) >= 0), false, 'token absent from device logs');
    assert.equal(gwLog9.some(l => JSON.stringify(l).includes(APP_TOKEN)), false,
      'token absent from gateway logs');
    b.c.vaActivate();                          /* not hung: can wake again */
    assert.equal(b.c.vaState(), 'LISTEN');
    pass('r119: app token mismatch -> fatal error -> IDLE, no upstream, not hung');
  }, { deviceToken: 'DIFFERENT-TOKEN-r119' });

  /* ---- 10. r121: keepalive, 2 turns on ONE connection, no re-hello ------ */
  const gwLog10 = [], mtSeen10 = [];
  const ANSWERS10 = ['FIRST-REPLY', 'SECOND-REPLY'];
  await withGw(makeMTFactory(mtSeen10, ANSWERS10), gwLog10, async (gw, url) => {
    const b = boot(url, { keys: {
      voice_gateway_multiturn: '1', voice_gateway_token: 'MT-REUSE-TOKEN-r195'
    } });
    assert.equal(b.c.vaGatewayMultiturn(), true, 'KV toggles device multiturn');
    drive(b.c);                                     /* turn 1 */
    await waitFor(() => b.c.vaStreamAcked, 'turn1 ack');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui);
    b.c.vaWSPump();
    await waitFor(() => b.c.vaStreamFinished, 'turn1 finish');
    assert.equal(b.bridge.stats.connects, 1);
    assert.equal(b.bridge.stats.text.filter(m => m.type === 'hello').length, 1);
    assert.equal(b.bridge.stats.closes, 0, 'no gateway/app close between turns');
    assert.equal(b.c.vaStreamIdle, true, 'connection parked for reuse');
    assert.ok(b.c.vaStreamConn, 'WS handle retained across turns');
    assert.ok(b.logs.includes('VA WS KEEP session'));
    assert.equal(b.c.vaTurnCount(), 1);
    assert.equal(b.c.vaLastReply(), ANSWERS10[0]);
    /* r195: tokened turn 1 builds exactly one upgrade header and reads the
     * token twice (upgrade + hello); freeze the KV read count for reuse. */
    assert.equal(b.bridge.stats.headers.length, 1, 'r195: one header on the fresh connect');
    const tokenGetsAfterT1 = b.kvGets.voice_gateway_token;
    assert.ok(tokenGetsAfterT1 >= 2, 'r195: turn 1 read the token for header + hello');
    assert.equal(b.kvGets.voice_gateway_handshake_token, 1,
      'r197: handshake key read once on the fresh connect');
    /* The clean turn-1 close re-arms a fresh adapter on the SAME session
     * synchronously, so its start() snapshot already carries turn 1 history. */
    assert.equal(mtSeen10.length, 2, 'turn1 adapter + re-armed adapter');
    assert.equal(mtSeen10[0].length, 0, 'turn 1 sees empty history');
    assert.deepEqual(mtSeen10[1].map(m => m.role), ['user', 'assistant'],
      're-armed adapter sees turn 1 user + assistant');
    b.c.vaSpeakDone();
    assert.equal(b.c.vaState(), 'IDLE');

    drive(b.c);                                     /* turn 2, same connection */
    assert.equal(b.bridge.stats.connects, 1, 'turn 2 opens no new WS');
    /* r195: reuse returns before the header is built -- no second header,
     * and no token read at all (so a future regression that builds headers
     * in the reuse branch turns this live assertion red). */
    assert.equal(b.bridge.stats.headers.length, 1, 'r195: reuse builds no handshake header');
    assert.equal(b.kvGets.voice_gateway_token, tokenGetsAfterT1,
      'r195: reuse path performs zero token reads');
    assert.equal(b.kvGets.voice_gateway_handshake_token, 1,
      'r197: reuse path performs zero handshake-key reads');
    assert.equal(b.bridge.stats.text.filter(m => m.type === 'hello').length, 1,
      'turn 2 sends no second hello');
    await waitFor(() => b.c.vaStreamSession && b.c.vaStreamSession.active, 'turn2 mic');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui);
    b.c.vaWSPump();
    await waitFor(() => b.c.vaStreamText === ANSWERS10[1], 'turn2 answer', 5000);
    await waitFor(() => b.c.vaTurnCount() === 2, 'turn2 finish', 5000);
    assert.equal(b.bridge.stats.text.filter(m => m.type === 'end').length, 2,
      'one end frame per turn');
    assert.equal(b.bridge.stats.closes, 0, 'connection still open after turn 2');
    assert.equal(gw.sessions.length, 1, 'one gateway session across both turns');
    assert.equal(gw.sessions[0].closeCode, null, 'gateway has not closed');
    assert.equal(mtSeen10.length, 3, 'turn2 re-armed a third adapter');
    assert.deepEqual(mtSeen10[2].map(m => m.role),
      ['user', 'assistant', 'user', 'assistant'],
      'turn 2 adapter sees both turns in history');
    assert.equal(gwLog10.filter(l => l.e === 'turn.end').length, 2);
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r121: 2 turns / 1 connection / 1 hello, history carries, no close');
  }, { multiturn: true });

  /* ---- 11. r122: remote close retires history; reconnect resumes it ------ */
  const GW_TOKEN11 = 'MT-TOKEN-r121-NOT-REAL';
  const gwLog11 = [], mtSeen11 = [];
  await withGw(makeMTFactory(mtSeen11, ['A1', 'A2']), gwLog11, async (gw, url) => {
    const b = boot(url, { keys: {
      voice_gateway_multiturn: '1', voice_gateway_token: GW_TOKEN11
    } });
    drive(b.c);                                     /* turn 1 */
    await waitFor(() => b.c.vaStreamAcked, 'turn1 ack');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui); b.c.vaWSPump();
    await waitFor(() => b.c.vaStreamFinished, 'turn1 finish');
    const hellos1 = b.bridge.stats.text.filter(m => m.type === 'hello');
    assert.equal(hellos1.length, 1);
    assert.equal(hellos1[0].auth.token, GW_TOKEN11, 'turn 1 hello carries token');
    assert.equal(b.logs.some(l => l.indexOf(GW_TOKEN11) >= 0), false, 'token never logged');
    assert.equal(mtSeen11.length, 2, 'turn1 adapter + re-armed adapter on old session');
    assert.deepEqual(mtSeen11[1].map(m => m.role), ['user', 'assistant'],
      'old session carried history before close');

    /* gateway closes the parked connection: history is retired, not destroyed */
    const oldSid = b.c.vaStreamSessionId;
    b.c.vaStreamConn.close();
    assert.equal(b.c.vaStreamConn, null, 'parked handle cleared on close');
    assert.equal(b.c.vaStreamIdle, false);
    await waitFor(() => gw.sessions[0].closeCode === 1000, 'gateway observed close');
    assert.ok(gwLog11.some(l => l.e === 'history.retire'), 'retire logged on close');
    b.c.vaSpeakDone();

    drive(b.c);                                     /* turn 2, fresh connection */
    await waitFor(() => b.c.vaStreamAcked && b.bridge.stats.connects === 2, 'turn2 reconnect');
    const hellos2 = b.bridge.stats.text.filter(m => m.type === 'hello');
    assert.equal(hellos2.length, 2, 'reconnect sends a fresh hello');
    assert.equal(hellos2[1].auth.token, GW_TOKEN11, 'token re-applied on reconnect');
    assert.equal(hellos2[1].resume, oldSid, 'reconnect hello carries the last sessionId');
    assert.ok(b.logs.includes('VA WS RESUME REQ'), 'app logs resume request');
    assert.equal(gw.sessions.length, 2, 'new gateway session after close');
    assert.equal(mtSeen11.length, 3, 'reconnect started a fresh adapter');
    assert.deepEqual(mtSeen11[2].map(m => m.role), ['user', 'assistant'],
      'new session resumed turn-1 history instead of starting fresh');
    assert.equal(mtSeen11[2] === mtSeen11[1], false, 'adopted copy, not the old live array');
    assert.ok(gwLog11.some(l => l.e === 'history.resume'));
    assert.ok(b.logs.includes('VA WS HELLO AUTH'));
    assert.equal(gwLog11.some(l => JSON.stringify(l).indexOf(GW_TOKEN11) >= 0), false);
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r122: close retires history, reconnect resumes it + re-sends token, no log leak');
  }, { multiturn: true, deviceToken: GW_TOKEN11 });

  /* ---- 12. r121: token gate still blocks after a multiturn reconnect ---- */
  const gwLog12 = [];
  let deniedUpstreams12 = 0;
  await withGw(() => { deniedUpstreams12++; return makeMTFactory([], [])(); }, gwLog12,
    async (gw, url) => {
      const b = boot(url, { keys: {
        voice_gateway_multiturn: '1', voice_gateway_token: 'WRONG-TOKEN'
      } });
      drive(b.c);
      await waitFor(() => b.logs.some(l => l.indexOf('VA WS FRAME ERROR unauthorized') >= 0),
        'turn1 denied');
      await waitFor(() => b.c.vaState() === 'IDLE', 'turn1 settles');
      drive(b.c);                                   /* reconnect attempt */
      await waitFor(() => b.logs.filter(l => l.indexOf('VA WS FRAME ERROR unauthorized') >= 0).length >= 2,
        'turn2 denied again');
      await waitFor(() => b.c.vaState() === 'IDLE', 'turn2 settles');
      assert.equal(b.bridge.stats.connects, 2, 'second attempt reconnected');
      assert.equal(b.bridge.stats.text.filter(m => m.type === 'hello').length, 2,
        'both attempts sent tokened hello');
      assert.equal(deniedUpstreams12, 0, 'zero upstream adapters created');
      assert.equal(gw.sessions.length, 2);
      assert.equal(gw.sessions[0].closeCode, 1008);
      assert.equal(gw.sessions[1].closeCode, 1008);
      assert.equal(b.bridge.stats.dispatchErrors.length, 0);
      pass('r121: wrong token blocked on initial + reconnect, upstream never created');
    }, { multiturn: true, deviceToken: 'RIGHT-TOKEN' });

  /* ---- 13. r122: barge-in mid-SPEAK closes WS; reconnect resumes history -- */
  const gwLog13 = [], mtSeen13 = [];
  await withGw(makeMTFactory(mtSeen13, ['B1', 'B2', 'B3']), gwLog13, async (gw, url) => {
    const b = boot(url, { keys: { voice_gateway_multiturn: '1' } });
    drive(b.c);                                     /* turn 1 */
    await waitFor(() => b.c.vaStreamAcked, 'turn1 ack');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui); b.c.vaWSPump();
    await waitFor(() => b.c.vaStreamFinished, 'turn1 finish');
    b.c.vaSpeakDone();
    assert.equal(b.c.vaStreamIdle, true, 'parked after turn 1');

    drive(b.c);                                     /* turn 2, reused connection */
    await waitFor(() => b.c.vaStreamSession && b.c.vaStreamSession.active, 'turn2 mic');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui); b.c.vaWSPump();
    await waitFor(() => b.c.vaStreamFinished && b.c.vaState() === 'SPEAK', 'turn2 SPEAK');
    assert.equal(b.bridge.stats.connects, 1, 'still one connection before barge-in');

    /* Interrupt during SPEAK: vaWSAbort closes the WS, gateway retires the
     * two completed turns instead of dropping them on the floor. */
    const oldSid = b.c.vaStreamSessionId;
    assert.equal(b.c.vaBargeIn(), true);
    assert.ok(b.logs.includes('VA WS ABORT'));
    assert.equal(b.c.vaStreamIdle, false, 'park cleared on barge-in');
    await waitFor(() => gw.sessions[0].closeCode === 1000, 'gateway observed barge-in close');
    assert.ok(gwLog13.some(l => l.e === 'history.retire' && l.f.count === 4),
      'all four accumulated messages retired');

    drive(b.c);                                     /* turn 3, fresh connection */
    await waitFor(() => b.c.vaStreamAcked && b.bridge.stats.connects === 2, 'turn3 reconnect');
    const hellos = b.bridge.stats.text.filter(m => m.type === 'hello');
    assert.equal(hellos.length, 2, 'one hello per connection');
    assert.equal(hellos[1].resume, oldSid, 'reconnect hello resumes the closed session');
    assert.equal(mtSeen13[mtSeen13.length - 1].length, 4,
      'resumed adapter sees both completed turns in history');
    feedChunk(b.ui); feedChunk(b.ui); feedChunk(b.ui); b.c.vaWSPump();
    await waitFor(() => b.c.vaTurnCount() === 3, 'turn3 finish', 5000);
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r122: barge-in close -> reconnect with resume -> history of prior turns still continues');
  }, { multiturn: true });

  /* ---- 14. r195: URL query never logged; real connect keeps full URL ---- */
  const URL_SECRET = 'URL-TOKEN-r195-NOT-REAL';
  const HDR_SECRET = 'HDR-TOKEN-r195-NOT-REAL';
  const b14 = boot('ws://127.0.0.1:' + dead + '/?token=' + URL_SECRET + '#frag', {
    keys: { voice_gateway_token: HDR_SECRET }
  });
  drive(b14.c);
  await waitFor(() => b14.logs.some(l => /^VA WS (ERR|CONNECT ERR)/.test(l)), 'connect failure');
  assert.equal(b14.bridge.stats.connectUrls[0],
    'ws://127.0.0.1:' + dead + '/?token=' + URL_SECRET + '#frag',
    'r195: the real connect still uses the full URL with query + fragment');
  assert.equal(b14.bridge.stats.headers[0], 'Authorization: Bearer ' + HDR_SECRET + '\r\n',
    'r195: upgrade header is built independently of the URL');
  assert.ok(b14.logs.includes('VA WS CONNECT ws://127.0.0.1:' + dead + '/'),
    'r195: logged URL is scheme+host+port+path only');
  assert.equal(b14.logs.some(l => l.indexOf(URL_SECRET) >= 0 || l.indexOf(HDR_SECRET) >= 0), false,
    'r195: neither URL token nor header token appears in any device log line');
  assert.equal(b14.bridge.stats.dispatchErrors.length, 0);
  pass('r195: URL query redacted in log, full URL connected, header still sent');

  /* ---- 15. r197: two keys -> split Bearer / hello device-token --------- */
  const HS15 = 'HS-TOKEN-r197-NOT-REAL';
  const DT15 = 'DT-TOKEN-r197-NOT-REAL';
  const gwLog15 = [];
  let adapter15;
  assert.notEqual(HS15, DT15, 'r197: the two test tokens must differ');
  await withGw(() => {
    adapter15 = new MockUpstream({ answer: 'SPLIT OK', audioFrames: 1, delayMs: 20 });
    return adapter15;
  }, gwLog15, async (gw, url) => {
    const b = boot(url, { keys: {
      voice_gateway_token: DT15, voice_gateway_handshake_token: HS15
    } });
    drive(b.c);
    await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello sent');
    assert.equal(b.bridge.stats.headers[0], 'Authorization: Bearer ' + HS15 + '\r\n',
      'r197: upgrade Bearer comes from the handshake key');
    assert.equal(b.bridge.stats.text[0].auth && b.bridge.stats.text[0].auth.token, DT15,
      'r197: hello.auth.token still comes from the device-token key');
    assert.ok(b.logs.includes('VA WS AUTH SPLIT=1'), 'r197: split boolean fact logged');
    assert.equal(b.logs.some(l => l.indexOf(HS15) >= 0 || l.indexOf(DT15) >= 0), false,
      'r197: neither token value appears in any device log line');
    await waitFor(() => b.c.vaStreamFinished, 'turn finished');
    assert.equal(b.c.vaFullText, 'SPLIT OK', 'r197: gateway accepted the device-token hello');
    assert.equal(gw.sessions[0].closeCode, 1000);
    assert.equal(adapter15.started, true, 'r197: upstream engaged');
    assert.equal(gwLog15.some(l => JSON.stringify(l).includes(HS15) ||
      JSON.stringify(l).includes(DT15)), false, 'r197: neither token in gateway logs');
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r197: split keys -> Bearer=handshake, hello.auth=device-token, full round');
  }, { deviceToken: DT15 });

  /* ---- 16. r197: only the r119 key -> byte-identical fallback ----------- */
  const DT16 = 'SOLO-TOKEN-r197-NOT-REAL';
  const gwLog16 = [];
  let adapter16;
  await withGw(() => {
    adapter16 = new MockUpstream({ answer: 'FALLBACK OK', audioFrames: 1, delayMs: 20 });
    return adapter16;
  }, gwLog16, async (gw, url) => {
    const b = boot(url, { keys: { voice_gateway_token: DT16 } });
    drive(b.c);
    await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello sent');
    assert.equal(b.bridge.stats.headers[0], 'Authorization: Bearer ' + DT16 + '\r\n',
      'r197 fallback: upgrade header unchanged from r195');
    assert.equal(b.bridge.stats.textRaw[0],
      JSON.stringify(Object.assign({}, OPEN_LAN_HELLO, { auth: { token: DT16 } })),
      'r197 fallback: hello frame byte-identical to the r195 single-key frame');
    assert.ok(b.logs.includes('VA WS AUTH SPLIT=0'), 'r197: fallback boolean fact logged');
    assert.equal(b.logs.some(l => l.indexOf(DT16) >= 0), false, 'r197: token absent from device logs');
    await waitFor(() => b.c.vaStreamFinished, 'turn finished');
    assert.equal(b.c.vaFullText, 'FALLBACK OK');
    assert.equal(gw.sessions[0].closeCode, 1000);
    assert.equal(adapter16.started, true);
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r197: single-KV fallback -> r195 header+hello bytes, SPLIT=0');
  }, { deviceToken: DT16 });

  /* ---- 17. r197: both keys empty -> r119 open LAN unchanged ------------- */
  const gwLog17 = [];
  let adapter17;
  await withGw(() => {
    adapter17 = new MockUpstream({ answer: 'OPEN OK', audioFrames: 1, delayMs: 20 });
    return adapter17;
  }, gwLog17, async (gw, url) => {
    const b = boot(url);
    drive(b.c);
    await waitFor(() => b.bridge.stats.text.some(m => m.type === 'hello'), 'hello sent');
    assert.equal(b.bridge.stats.headers[0], '', 'r197: no upgrade headers when both keys empty');
    assert.equal(b.bridge.stats.textRaw[0], JSON.stringify(OPEN_LAN_HELLO),
      'r197: open LAN hello byte-identical to r119');
    assert.equal('auth' in b.bridge.stats.text[0], false, 'r197: no auth field');
    assert.ok(b.logs.includes('VA WS AUTH SPLIT=0'), 'r197: open LAN logs SPLIT=0');
    await waitFor(() => b.c.vaStreamFinished, 'turn finished');
    assert.equal(b.c.vaFullText, 'OPEN OK');
    assert.equal(adapter17.started, true);
    assert.equal(b.bridge.stats.dispatchErrors.length, 0);
    pass('r197: both keys empty -> open LAN: no headers, no auth, SPLIT=0');
  });

  console.log(`ALL VA WS HARNESS CASES PASSED (${checks} cases)`);
})().catch(e => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
