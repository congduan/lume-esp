/* r95 voice_assistant host harness — runs the app against the firmware prelude.
 * Standalone CommonJS script (not node --test), same pattern as tests/compass.js.
 * Honesty scope: legacy sync transport / DEMO fallback only; no board timing,
 * no ASR/TTS, no hardware acceptance. Run: node tests/voice_assistant.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/voice_assistant/app.js', 'utf8');
const logs = [];
const ui = runApp(source, { onLog: (...a) => logs.push(a.join(' ')) });
const c = ui.ctx;

const paintCalls = msgs => msgs.reduce((n, m) =>
  n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
const drive = () => { c.vaActivate(); c.vaActivate(); c.vaDeferredSend(); };
const reset = () => {
  if (c.vaState() === 'SPEAK') c.vaBargeIn();
  else if (c.vaState() === 'LISTEN') c.vaListenTimeout();
};

/* 1. boot: honest DEMO mode, single small canvas, no backend assumption */
assert.equal(c.vaState(), 'IDLE');
assert.equal(c.vaMode, 'DEMO');
assert.equal(c.vaModeLabel(), 'DEMO');
assert.ok(logs.includes('VA MODE DEMO'), logs.join('\n'));
assert.ok(logs.some(l => /^VA READY mode=DEMO canned=4 canvas=70560$/.test(l)), logs.join('\n'));
console.log('PASS boot IDLE + honest DEMO badge (no key / no IP)');

/* 2. transition table: every legal edge, explicit illegal rejection */
assert.equal(c.vaCan('IDLE', 'LISTEN'), true);
assert.equal(c.vaCan('LISTEN', 'THINK'), true);
assert.equal(c.vaCan('LISTEN', 'IDLE'), true);
assert.equal(c.vaCan('THINK', 'SPEAK'), true);
assert.equal(c.vaCan('THINK', 'IDLE'), true);
assert.equal(c.vaCan('SPEAK', 'IDLE'), true);
for (const [from, to] of [['IDLE', 'THINK'], ['IDLE', 'SPEAK'], ['LISTEN', 'SPEAK'],
  ['THINK', 'LISTEN'], ['SPEAK', 'LISTEN'], ['SPEAK', 'THINK'], ['IDLE', 'IDLE']]) {
  assert.equal(c.vaCan(from, to), false, `${from}->${to} must be illegal`);
}
assert.equal(c.vaSet('SPEAK'), false, 'no IDLE->SPEAK jump');
assert.equal(c.vaState(), 'IDLE');
assert.ok(logs.some(l => l === 'VA ILLEGAL IDLE-SPEAK'), logs.join('\n'));
console.log('PASS state table: 6 legal edges, illegal jumps rejected + logged');

/* 3. full happy path with frame deferral: THINK renders before transport runs */
c.vaActivate();
assert.equal(c.vaState(), 'LISTEN');
assert.equal(c.vaPendingPrompt, 'HELLO LUME');
const callsAfterWake = c.vaTransportCalls;
c.vaActivate();
assert.equal(c.vaState(), 'THINK');
assert.equal(c.vaTransportCalls, callsAfterWake, 'transport not called in the input frame');
assert.equal(c.vaFullText, '');
c.vaDeferredSend();
assert.equal(c.vaState(), 'SPEAK');
assert.equal(c.vaTransportCalls, callsAfterWake + 1);
assert.equal(c.vaFullText, 'HI. I AM LISTENING ON THE WATCH.');
assert.equal(c.vaPlayCount, 1, 'one PCM broadcast played on reply');
console.log('PASS IDLE->LISTEN->THINK->(next frame)transport->SPEAK + play');

/* 4. barge-in: SPEAK tap returns to IDLE immediately and cancels timers */
assert.equal(c.vaBargeIn(), true);
assert.equal(c.vaState(), 'IDLE');
assert.equal(c.vaBargeIn(), false, 'second barge-in is a no-op');
assert.equal(c.vaState(), 'IDLE');
assert.ok(logs.includes('VA BARGE IN ok=true'));
console.log('PASS barge-in SPEAK->IDLE, repeat tap is harmless no-op');

/* 5. LISTEN watchdog -> IDLE (and cannot fire outside LISTEN) */
assert.equal(c.vaStartListen(), true);
assert.equal(c.vaState(), 'LISTEN');
assert.equal(c.vaListenTimeout(), true);
assert.equal(c.vaState(), 'IDLE');
assert.ok(logs.includes('VA LISTEN TIMEOUT -> IDLE'));
assert.equal(c.vaListenTimeout(), false, 'watchdog is inert outside LISTEN');
assert.equal(c.vaState(), 'IDLE');
console.log('PASS LISTEN timeout -> IDLE; watchdog inert outside LISTEN');

/* 6. DEMO canned rotation (4 replies wrap) + typewriter tick cadence */
const canned = ['HI. I AM LISTENING ON THE WATCH.',
  'THE CLOCK FACE HAS THE LOCAL TIME.',
  'OPEN THE POWER PAGE FOR LEVEL.',
  'A BYTE WALKED INTO A BAR. IT DID NOT COMPUTE.'];
const startAt = c.vaCannedIndex % canned.length;
const seen = [];
for (let round = 0; round < 6; round++) {
  reset();
  drive();
  seen.push(c.vaFullText);
}
const expected = Array.from({ length: 6 }, (_, i) => canned[(startAt + i) % canned.length]);
assert.deepEqual(seen, expected, 'canned Q&A rotates in order and wraps at 4');
console.log(`PASS DEMO canned replies rotate across 6 turns (wrap at 4, start=${startAt})`);

reset(); drive();                       /* canned[2] is now current */
const full = c.vaFullText;
assert.equal(c.vaTypingPos(), 0);
assert.equal(c.vaAnswerText(), c.vaTyping() ? '|' : '');
const fullDuringTicks = full;
for (let n = 1; n <= 12; n++) {
  c.vaTypewriterTick();
  assert.equal(c.vaTypingPos(), n, `tick ${n} advances exactly one char`);
  assert.equal(c.vaFullText, fullDuringTicks, 'tick never rebuilds the string');
  assert.equal(c.vaAnswerText().indexOf(full.substring(0, n)), 0);
}
const posAt12 = c.vaTypingPos();
for (let n = 0; n < 200; n++) c.vaTypewriterTick();
assert.equal(c.vaTypingPos(), full.length, 'cadence clamps at full length');
assert.ok(c.vaTypingPos() >= posAt12);
console.log(`PASS typewriter advances 1 char/tick, clamps at ${full.length} (no wall-clock)`);

/* 7. canvas budget conservation + draw discipline */
const canvases = ui.messages.filter(m => m[0] === 'create' && m[4] > 0 && m[5] > 0);
assert.equal(canvases.length, 1, 'exactly one canvas');
const px = canvases[0][4] * canvases[0][5];
assert.equal(px, 392 * 180);
assert.ok(px <= 230400, `canvas ${px} <= 230400 px app budget`);
const beforeDraw = ui.messages.length;
c.vaRev.set(c.vaRev() + 1);
const frame = paintCalls(ui.messages.slice(beforeDraw));
assert.ok(frame > 0 && frame < 250, `redraw ${frame} calls/frame < 250`);
assert.ok(ui.messages.slice(beforeDraw).some(m => m[0] === 'invalidate'), 'dirty rect emitted');
console.log(`PASS canvas budget ${px}/230400 px, ${frame} draw calls/frame, dirty rect`);

/* 8. ASCII-only UI text (r64 firmware glyph discipline) */
const texts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => m[3]);
assert.ok(texts.length >= 6, 'title/mode/state/answer/hint/button text bound');
assert.ok(texts.every(t => typeof t === 'string' && /^[\x20-\x7E\n]*$/.test(t)),
  'all UI text is printable ASCII: ' + JSON.stringify(texts));
console.log(`PASS UI text pure ASCII (${texts.length} bound strings)`);

/* 9. transport slot replaceability: injected fake walks THINK->SPEAK */
let fakePrompt = null, fakeCalls = 0;
c.vaSetTransport(function (prompt, done) { fakePrompt = prompt; fakeCalls++; done('FAKE REPLY FROM GATEWAY', 0); });
reset();
c.vaActivate(); c.vaActivate();
assert.equal(c.vaState(), 'THINK');
assert.equal(fakeCalls, 0, 'fake not called before the deferred frame');
c.vaDeferredSend();
assert.equal(fakeCalls, 1);
assert.equal(fakePrompt, 'HELLO LUME');
assert.equal(c.vaState(), 'SPEAK');
assert.equal(c.vaFullText, 'FAKE REPLY FROM GATEWAY');
c.vaSetTransport(function (prompt, done) { done(null, -3); });
reset(); drive();
assert.equal(c.vaState(), 'IDLE', 'transport error -> IDLE, never SPEAK');
assert.ok(logs.includes('VA ERROR -3'));
c.vaSetTransport(c.vaTransportLegacy);
console.log('PASS transport slot: fake drives THINK->SPEAK; error path -> IDLE');

/* 10. LIVE mode detects key + GOT_IP and delegates to legacy lume.ai.chat */
const logs2 = [];
let chatReq = null;
const ui2 = runApp(source, {
  onLog: (...a) => logs2.push(a.join(' ')),
  kv: { get: k => k === 'ai_api_key' ? 'test-key' : null },
  net: { GOT_IP: 3, status: () => ({ state: 3, ip: '10.0.0.2' }) }
});
const c2 = ui2.ctx;
assert.equal(c2.vaMode, 'LIVE');
assert.equal(c2.vaModeLabel(), 'LIVE');
assert.equal(c2.vaDetectMode(), 'LIVE');
ui2.lume.ai.chat = function (opts) { chatReq = opts; return { content: 'LIVE ANSWER', usage: null, finishReason: 'stop' }; };
c2.vaActivate(); c2.vaActivate(); c2.vaDeferredSend();
assert.equal(c2.vaState(), 'SPEAK');
assert.equal(c2.vaFullText, 'LIVE ANSWER');
assert.ok(chatReq && chatReq.messages[0].content === 'HELLO LUME', 'legacy chat got the prompt');
assert.equal(chatReq.maxTokens, 256);
console.log('PASS LIVE detection + legacy lume.ai.chat delegation through transport');

/* 11. record() failure degrades safely; a real PCM buffer drives the level */
const logs3 = [];
const ui3 = runApp(source, { onLog: (...a) => logs3.push(a.join(' ')),
  audio: { record: () => -3 } });
const c3 = ui3.ctx;
c3.vaStartListen(); c3.vaRecordOnce();
assert.ok(logs3.includes('VA MIC UNAVAILABLE -3'), 'no mic -> logged, no crash');
assert.equal(c3.vaState(), 'LISTEN');
const ui4 = runApp(source, { audio: { record: () => new ArrayBuffer(8192) } });
const c4 = ui4.ctx;
c4.vaStartListen();
const lvl0 = c4.vaLevel();
c4.vaRecordOnce();
assert.ok(c4.vaLevel() >= 0.1 && c4.vaLevel() <= 1, 'RMS level clamped');
assert.ok(c4.vaLevel() !== lvl0, 'recorded PCM changes the waveform level');
c4.vaBargeIn();
console.log('PASS record() -3 degrades to demo level; real PCM drives bounded VU');

/* 12. wave tick stays bounded across a full animation cycle */
c.vaBargeIn();
for (let i = 0; i < 120; i++) {
  c.vaWaveTick();
  assert.ok(c.vaLevel() >= 0 && c.vaLevel() <= 1, `level bounded at tick ${i}`);
}
c.vaStartListen();
for (let i = 0; i < 120; i++) { c.vaWaveTick(); assert.ok(c.vaLevel() >= 0 && c.vaLevel() <= 1); }
assert.equal(c.vaListenTimeout(), true);
console.log('PASS waveform level bounded [0,1] in IDLE and LISTEN over 240 ticks');

/* ---- r124 push-to-talk (GATEWAY only) ---------------------------------- */
/* Minimal stub WS: records text frames; tests fire open/message explicitly so
 * the whole PTT turn is deterministic (no real network, no wall-clock). */
function bootGW(opts = {}) {
  const sends = { text: [], binary: [] };
  let peer = null, nextId = 1;
  const ws = {
    _connect() { peer = nextId++; return peer; },
    _send(id, data) {
      if (typeof data === 'string') sends.text.push(JSON.parse(data));
      else sends.binary.push(data.byteLength);
      return 0;
    },
    _close() { return 0; }
  };
  const logs = [];
  const ui = runApp(source, {
    onLog: (...a) => logs.push(a.join(' ')),
    kv: { get: k => k === 'voice_gateway_url' ? 'ws://stub/' : ((opts.keys && opts.keys[k]) || null) },
    net: { GOT_IP: 3, status: () => ({ state: 3, ip: '1.2.3.4' }), ws },
    audio: { _recordStream: () => 0, _stopStream: () => 0, playStream: () => 0, streamFinished: () => true }
  });
  const c = ui.ctx;
  let now = 100000;
  ui.lume._nowMs = () => now;
  const fire = (kind, ref) => vm.runInContext(
    `__lume_dispatchWS(${peer},${kind}${ref ? ',' + ref : ''})`, c);
  const sendMsg = obj => { c.__wsMsg = JSON.stringify(obj); fire(2, '__wsMsg'); };
  const rootId = ui.messages.find(m => m[0] === 'create')[1];
  return {
    ui, c, logs, sends, rootId,
    setNow: v => { now = v; },
    open: () => fire(1),
    ack: () => sendMsg({ v: 1, type: 'hello-ack', audioFormat: 'pcm_s16le_16000_2ch', sessionId: 'SID-1' }),
    finish: () => sendMsg({ v: 1, type: 'state', state: 'idle' }),
    openMic: () => c.vaDeferredSend('LISTEN'),  /* deferred frame: WS + mic */
    panDown: () => { ui.gesture(rootId, 0, 240, 240, now);
                     ui.gesture(rootId, 1, 240, 260, now);
                     ui.gesture(rootId, 1, 240, 280, now); },
    panUp: () => ui.gesture(rootId, 2, 240, 280, now),
    endCount: () => sends.text.filter(m => m.type === 'end').length,
    helloCount: () => sends.text.filter(m => m.type === 'hello').length
  };
}

/* 13. panstart -> panend drives the LISTEN window (downward drag: no swipe). */
{
  const g = bootGW();
  assert.equal(g.c.vaMode, 'GATEWAY');
  g.panDown();
  assert.equal(g.c.vaState(), 'LISTEN', 'panstart enters LISTEN');
  assert.equal(g.c.vaPTTActive, true);
  assert.ok(g.logs.includes('VA PTT START'), g.logs.join('\n'));
  assert.ok(g.ui.messages.some(m => m[0] === 'attr' && m[2] === 0 &&
    m[3] === 'HOLDING - RELEASE TO SEND'), 'hold hint visible during LISTEN');
  g.openMic(); g.open(); g.ack();
  assert.ok(g.helloCount() >= 1, 'WS opened on panstart');
  assert.equal(g.c.vaStreamSession.active, true, 'mic live while held');
  g.setNow(100500);                                  /* 500 ms valid hold */
  g.panUp();
  assert.equal(g.c.vaState(), 'THINK', 'panend sends -> THINK');
  assert.equal(g.c.vaPTTActive, false);
  assert.equal(g.endCount(), 1, 'one end frame on release');
  assert.equal(g.c.vaStreamSession.active, false, 'mic stopped on release');
  assert.ok(g.logs.includes('VA PTT END 500ms'), g.logs.join('\n'));
  g.finish();
  assert.equal(g.c.vaState(), 'SPEAK');
  console.log('PASS r124: panstart opens LISTEN+mic, panend sends end -> THINK/SPEAK');
}

/* 14. shortest window: <400 ms hold is a mis-touch -> IDLE, no end frame. */
{
  const g = bootGW();
  g.panDown(); g.openMic(); g.open(); g.ack();
  g.setNow(100150);                                  /* 150 ms < 400 */
  g.panUp();
  assert.equal(g.c.vaState(), 'IDLE', 'mis-touch back to IDLE');
  assert.equal(g.c.vaPTTActive, false);
  assert.equal(g.endCount(), 0, 'no end frame on mis-touch');
  assert.equal(g.c.vaStreamSession.active, false, 'mic still stopped');
  assert.ok(g.logs.includes('VA PTT DISCARD 150ms'), g.logs.join('\n'));
  console.log('PASS r124: <400 ms hold discarded -> IDLE, no end, mic stopped');
}

/* 15. watchdog cap: a 15 s stuck hold is force-sent, never hangs. */
{
  const g = bootGW();
  g.panDown(); g.openMic(); g.open(); g.ack();
  g.setNow(115000);                                  /* +15 s */
  g.c.vaPTTWatchdog();
  assert.equal(g.c.vaState(), 'THINK');
  assert.equal(g.endCount(), 1);
  assert.ok(g.logs.includes('VA PTT WATCHDOG 15000ms'), g.logs.join('\n'));
  assert.ok(g.logs.includes('VA PTT END 15000ms'), g.logs.join('\n'));
  console.log('PASS r124: 15 s watchdog force-sends (end frame) instead of hanging');
}

/* 16. negative: panend is NOT swallowed by an upward swipe. Read-code +
 * harness proof: on UP __gestureStep emits panend BEFORE swipe:up, so the end
 * frame is queued even if the same node also reports an upward swipe. */
{
  const g = bootGW();
  const ev = [];
  ['panstart', 'pan', 'panend', 'swipe'].forEach(k =>
    g.c.lume.gesture.on(g.rootId, k, e => ev.push(k + (e.dir ? ':' + e.dir : ''))));
  g.panDown(); g.openMic(); g.open(); g.ack();
  g.setNow(100500);
  g.ui.gesture(g.rootId, 2, 240, 180, 100500);      /* UP 60 px above start -> swipe:up */
  assert.ok(ev.includes('panend'), 'panend still fired: ' + JSON.stringify(ev));
  assert.ok(ev.includes('swipe:up'), 'swipe:up co-fired: ' + JSON.stringify(ev));
  assert.ok(ev.indexOf('panend') < ev.indexOf('swipe:up'),
    'panend precedes swipe:up -> end frame not swallowed: ' + JSON.stringify(ev));
  assert.equal(g.endCount(), 1, 'end frame delivered despite swipe-up');
  /* Downward drag produces panend with NO swipe at all (clean commit path). */
  const d = bootGW();
  const dev = [];
  d.c.lume.gesture.on(d.rootId, 'swipe', e => dev.push(e.dir));
  d.c.lume.gesture.on(d.rootId, 'panend', () => dev.push('panend'));
  d.panDown(); d.openMic(); d.open(); d.ack(); d.setNow(100500); d.panUp();
  assert.deepEqual(dev, ['panend'], 'downward drag: panend only, no swipe-up');
  console.log('PASS r124: panend fires before swipe:up (not swallowed); down drag = panend only');
}

/* 17. multi-turn: two holds on one connection, no second hello. */
{
  const g = bootGW({ keys: { voice_gateway_multiturn: '1' } });
  assert.equal(g.c.vaGatewayMultiturn(), true);
  g.panDown(); g.openMic(); g.open(); g.ack();        /* turn 1 */
  g.setNow(100500); g.panUp();
  g.finish();
  assert.equal(g.helloCount(), 1);
  assert.equal(g.endCount(), 1);
  assert.equal(g.c.vaStreamIdle, true, 'connection parked for reuse');
  g.c.vaSpeakDone();
  assert.equal(g.c.vaState(), 'IDLE');

  g.setNow(200000);
  g.panDown(); g.openMic();                            /* turn 2: reuse, no connect/hello */
  assert.equal(g.helloCount(), 1, 'second hold sends NO second hello');
  assert.ok(g.logs.some(l => l === 'VA WS REUSE turn=2'), g.logs.join('\n'));
  assert.equal(g.c.vaStreamAcked, true, 'ack retained across hold');
  assert.equal(g.c.vaStreamSession.active, true, 'mic live on second hold');
  g.setNow(200500); g.panUp();
  assert.equal(g.endCount(), 2, 'one end frame per hold');
  console.log('PASS r124: two holds / one connection / one hello, mic reopens on hold 2');
}

/* 18. demo mode: pan gestures are a no-op, tap flow unchanged. */
{
  const dlogs = [];
  const d = runApp(source, { onLog: (...a) => dlogs.push(a.join(' ')) });
  const dc = d.ctx;
  d.gesture(1, 0, 240, 240, 1000);
  d.gesture(1, 1, 240, 280, 1020);
  d.gesture(1, 2, 240, 280, 1050);
  assert.equal(dc.vaState(), 'IDLE', 'pan does nothing in DEMO mode');
  dc.vaActivate(); dc.vaActivate(); dc.vaDeferredSend();
  assert.equal(dc.vaState(), 'SPEAK');
  assert.ok(canned.indexOf(dc.vaFullText) >= 0, 'tap still yields canned reply in DEMO');
  console.log('PASS r124: DEMO mode unaffected (pan no-op, tap still works)');
}

console.log('ALL VOICE ASSISTANT HARNESS CASES PASSED');
