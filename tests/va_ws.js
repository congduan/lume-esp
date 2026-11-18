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
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };

/* ---- zero-dep bridge: prelude WS stub <-> real gateway client ----------- */
function makeBridge() {
  const clients = new Map();
  let nextId = 1;
  const bridge = {
    ctx: null,
    stats: { connects: 0, text: [], binary: [], closes: 0, dispatchErrors: [] },
    _connect(url, headers) {
      bridge.stats.connects++;
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
    kv: { get: k => (k === 'voice_gateway_url' && url) ? url : ((opts.keys && opts.keys[k]) || null) },
    net: netStub,
    audio
  });
  bridge.ctx = ui.ctx;
  return { ui, bridge, logs, play, c: ui.ctx };
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

async function withGw(factory, logs, fn) {
  const gw = createGateway({ port: 0, log: (e, f) => logs.push({ e, f }), upstreamFactory: factory });
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
      assert.deepEqual(b.bridge.stats.text[0], {
        v: 1, type: 'hello',
        device: { model: 'lume', fw: 'r108', app: 'voice_assistant' },
        caps: { audioFormats: ['pcm_s16le_16000_2ch'] }
      });
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

  console.log(`ALL VA WS HARNESS CASES PASSED (${checks} cases)`);
})().catch(e => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
