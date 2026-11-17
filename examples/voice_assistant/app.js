/* r95 — VOICE ASSISTANT / walkie-talkie card (legacy sync mode, pure app layer).
 *
 * State machine IDLE -> LISTEN -> THINK -> SPEAK is signal-driven and lives
 * entirely in JS so the whole interaction can be hot-reloaded without a
 * firmware rebuild. Barge-in: a tap during SPEAK returns to IDLE at once.
 *
 * LEGACY MODE (this round): `lume.ai.chat` and `lume.audio.record` are
 * synchronous and block the single engine task. We therefore never call them
 * from the input handler: entering THINK/LISTEN only flips signals, and the
 * blocking work is deferred with `lume.system.setTimeout(..., 0)` so the card
 * gets at least one rendered frame first. Full-duplex / non-blocking streaming
 * is the job of the async gateway (roadmap knife D), not this demo.
 *
 * The "send -> reply" path is a single replaceable `vaTransport` slot: the
 * default legacy transport uses lume.ai.chat; a future WS/gateway transport
 * plugs in through vaSetTransport() with no change to the state machine.
 *
 * No backend / no mic (browser playground, host harness): auto-degrade to
 * DEMO mode with canned Q&A rotation (compass precedent). The mode badge
 * always states the active mode honestly. All UI text is pure ASCII (r64
 * firmware glyph discipline). */
var darkTheme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(darkTheme);

var VA_CW = 320, VA_CH = 160;          /* one canvas, 51,200 px << 230,400 budget */
var LISTEN_MS = 4000;                  /* LISTEN watchdog -> IDLE (no send) */
var TYPE_MS = 33;                      /* ~30 cps typewriter (typewriter precedent) */
var CURSOR_MS = 300;

var VA_CANNED = [
  { q: 'HELLO LUME',   a: 'HI. I AM LISTENING ON THE WATCH.' },
  { q: 'WHAT TIME',    a: 'THE CLOCK FACE HAS THE LOCAL TIME.' },
  { q: 'BATTERY',      a: 'OPEN THE POWER PAGE FOR LEVEL.' },
  { q: 'TELL A JOKE',  a: 'A BYTE WALKED INTO A BAR. IT DID NOT COMPUTE.' }
];

var vaState = signal('IDLE');
var vaModeLabel = signal('DEMO');
var vaTypingPos = signal(0);
var vaTyping = signal(false);
var vaCursor = signal(true);
var vaLevel = signal(0.08);
var vaRev = signal(0);

var vaMode = 'DEMO';
var vaFullText = '';
var vaCannedIndex = 0;
var vaPendingPrompt = '';
var vaWavePhase = 0;
var vaPlayCount = 0;
var vaTransportCalls = 0;
var vaWatchTimer = null, vaSendTimer = null, vaTypeTimer = null, vaSpeakTimer = null, vaCursorTimer = null;

/* ---- transition table (harness-visible pure helpers) ------------------- */
var VA_LEGAL = {
  IDLE:   ['LISTEN'],
  LISTEN: ['IDLE', 'THINK'],
  THINK:  ['SPEAK', 'IDLE'],
  SPEAK:  ['IDLE']
};
function vaCan(from, to) {
  var list = VA_LEGAL[from];
  return !!(list && list.indexOf(to) >= 0);
}
function vaSet(next) {
  var from = vaState();
  if (from === next) return false;
  if (!vaCan(from, next)) { lume.log('VA ILLEGAL ' + from + '-' + next); return false; }
  vaState.set(next);
  return true;
}

/* ---- mode detection / honest badge (compass fallback pattern) ---------- */
function vaDetectMode() {
  var key = null;
  try { key = lume.storage.kv.get('ai_api_key'); } catch (e) { key = null; }
  var ip = (lume.net && lume.net.status) ? lume.net.status().state : 0;
  var gotIp = (lume.net && lume.net.GOT_IP !== undefined) ? lume.net.GOT_IP : 3;
  return (typeof key === 'string' && key && ip === gotIp) ? 'LIVE' : 'DEMO';
}
function vaSetMode(next) {
  vaMode = next === 'LIVE' ? 'LIVE' : 'DEMO';
  vaModeLabel.set(vaMode);
  lume.log('VA MODE ' + vaMode);
}
function vaDemoReply() {
  var a = VA_CANNED[vaCannedIndex % VA_CANNED.length].a;
  vaCannedIndex++;
  return a;
}

/* ---- transport slot: only this function knows HOW a reply is obtained ---
 * Default legacy transport is synchronous and may block. DEMO always uses the
 * canned rotation. Inject a fake with vaSetTransport() for gateway/WS/tests. */
function vaTransportLegacy(prompt, done) {
  if (vaMode !== 'LIVE' || !lume.ai || typeof lume.ai.chat !== 'function') {
    done(vaDemoReply(), 0); return;
  }
  var r = lume.ai.chat({ messages: [{ role: 'user', content: prompt }], maxTokens: 256 });
  if (typeof r === 'number') done(null, r);
  else done(r.content || '(empty)', 0);
}
var vaTransport = vaTransportLegacy;
function vaSetTransport(fn) { vaTransport = (typeof fn === 'function') ? fn : vaTransportLegacy; }

/* ---- audio helpers ----------------------------------------------------- */
function vaRecordOnce() {
  if (vaState() !== 'LISTEN') return;
  if (!lume.audio || typeof lume.audio.record !== 'function') return;
  var pcm = -3;
  try { pcm = lume.audio.record(2); } catch (e) { pcm = -3; }
  if (typeof pcm === 'number') { lume.log('VA MIC UNAVAILABLE ' + pcm); return; }
  /* Crude RMS -> level. No ASR in legacy mode; the prompt is the canned
   * utterance chosen on LISTEN, the PCM only drives the waveform. */
  var v = new DataView(pcm), sum = 0, n = Math.min(4096, Math.floor(v.byteLength / 4)), i;
  for (i = 0; i < n; i++) { var s = v.getInt16(i * 4, true) / 32768; sum += s * s; }
  vaLevel.set(Math.max(0.1, Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 6)));
  lume.log('VA MIC PCM ' + v.byteLength);
}
function vaPlayReply() {
  var frames = 2880, rate = 16000, bytes = frames * 4;   /* 0.18 s stereo 16 kHz */
  var pcm = new ArrayBuffer(bytes), v = new DataView(pcm), i;
  for (i = 0; i < frames; i++) {
    var env = Math.sin(Math.PI * i / frames);
    var s = Math.round(6000 * env * Math.sin(i * 2 * Math.PI * 660 / rate));
    v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
  }
  if (!lume.audio || typeof lume.audio.play !== 'function') return;
  var rc = lume.audio.play(pcm);
  if (rc === 0) vaPlayCount++; else lume.log('VA PLAY ERR ' + rc);
}

/* ---- state machine actions --------------------------------------------- */
function vaStartListen() {
  if (!vaSet('LISTEN')) return false;
  vaFullText = ''; vaTypingPos.set(0); vaTyping.set(false);
  vaPendingPrompt = VA_CANNED[vaCannedIndex % VA_CANNED.length].q;
  vaLevel.set(0.2);
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  /* Defer the blocking record() so the LISTEN card renders one frame first. */
  if (vaMode === 'LIVE') lume.system.setTimeout(vaRecordOnce, 0);
  vaWatchTimer = lume.system.setTimeout(vaListenTimeout, LISTEN_MS);
  lume.log('VA LISTEN mode=' + vaMode + ' prompt=' + vaPendingPrompt);
  return true;
}
function vaSend() {
  if (vaState() !== 'LISTEN') { lume.log('VA SEND NOOP'); return false; }
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  return vaAsk(vaPendingPrompt);
}
function vaListenTimeout() {
  if (vaState() !== 'LISTEN') return false;
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  lume.log('VA LISTEN TIMEOUT -> IDLE');
  return vaSet('IDLE');
}
function vaAsk(prompt) {
  if (!vaSet('THINK')) return false;
  vaPendingPrompt = prompt || '';
  vaFullText = ''; vaTypingPos.set(0); vaTyping.set(false);
  if (vaSendTimer !== null) { lume.system.clearTimeout(vaSendTimer); vaSendTimer = null; }
  /* Frame deferral: THINK is rendered on this tick, transport runs on the next. */
  vaSendTimer = lume.system.setTimeout(vaDeferredSend, 0);
  return true;
}
function vaDeferredSend() {
  if (vaSendTimer !== null) { lume.system.clearTimeout(vaSendTimer); vaSendTimer = null; }
  if (vaState() !== 'THINK') return;
  var fn = vaTransport || vaTransportLegacy;
  vaTransportCalls++;
  fn(vaPendingPrompt, function (text, err) {
    if (typeof err === 'number' && err !== 0) { vaFail(err); return; }
    vaOnReply(text);
  });
}
function vaOnReply(text) {
  vaFullText = String(text === undefined || text === null ? '' : text);
  vaTypingPos.set(0);
  if (!vaSet('SPEAK')) return;
  vaTyping.set(true);
  vaPlayReply();
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  vaTypeTimer = lume.system.setInterval(vaTypewriterTick, TYPE_MS);
  if (vaSpeakTimer !== null) { lume.system.clearTimeout(vaSpeakTimer); vaSpeakTimer = null; }
  vaSpeakTimer = lume.system.setTimeout(vaSpeakDone, Math.max(1500, vaFullText.length * TYPE_MS + 1500));
  lume.log('VA SPEAK len=' + vaFullText.length);
}
function vaTypewriterTick() {
  if (vaState() !== 'SPEAK') return;
  var p = vaTypingPos();
  if (p >= vaFullText.length) { vaTyping.set(false); return; }
  /* Integer-only signal write in the timer (typewriter OOM lesson). */
  vaTypingPos.set(p + 1);
}
function vaSpeakDone() {
  if (vaState() !== 'SPEAK') return false;
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  vaTyping.set(false);
  return vaSet('IDLE');
}
function vaFail(code) {
  lume.log('VA ERROR ' + code);
  if (vaState() === 'THINK') vaSet('IDLE');
}
function vaBargeIn() {
  if (vaState() !== 'SPEAK') { lume.log('VA BARGE NOOP'); return false; }
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  if (vaSpeakTimer !== null) { lume.system.clearTimeout(vaSpeakTimer); vaSpeakTimer = null; }
  if (lume.audio && typeof lume.audio.stop === 'function') lume.audio.stop();
  vaTyping.set(false);
  var ok = vaSet('IDLE');
  lume.log('VA BARGE IN ok=' + ok);
  return ok;
}
function vaActivate() {
  var s = vaState();
  if (s === 'IDLE') { vaStartListen(); return; }
  if (s === 'LISTEN') { vaSend(); return; }
  if (s === 'SPEAK') { vaBargeIn(); return; }
  lume.log('VA BUSY ' + s);            /* THINK: no action, no illegal jump */
}
function vaLongPress() {
  lume.log('VA LONG PRESS in ' + vaState());
  vaActivate();                        /* push-to-talk wake / send / interrupt */
}
function vaWaveTick() {
  vaWavePhase = (vaWavePhase + 0.35) % 6.2832;
  var s = vaState(), target;
  if (s === 'LISTEN') target = 0.55 + 0.35 * Math.sin(vaWavePhase * 2);
  else if (s === 'SPEAK') target = 0.45 + 0.30 * Math.sin(vaWavePhase * 1.7);
  else target = 0.08;
  vaLevel.set(Math.max(0, Math.min(1, target)));
  vaRev.set(vaRev() + 1);
}
function vaAnswerText() {
  var s = vaFullText.substring(0, vaTypingPos());
  return vaTyping() ? s + (vaCursor() ? '|' : ' ') : s;
}

/* ---- UI ---------------------------------------------------------------- */
function vaDraw(ctx) {
  vaRev(); vaLevel();                  /* subscribe to animation signals */
  ctx.fillColor('#0B1624'); ctx.fillRect(0, 0, VA_CW, VA_CH);
  ctx.line(8, VA_CH / 2, VA_CW - 8, VA_CH / 2, '#2C4468', 2);
  var bars = 16, bw = 12, gap = 4, lv = vaLevel();
  var x0 = Math.round((VA_CW - bars * (bw + gap)) / 2);
  var col = lv > 0.7 ? '#FF6B79' : lv > 0.4 ? '#FFD166' : '#40D8B0';
  ctx.fillColor(col);
  for (var i = 0; i < bars; i++) {
    var amp = lv * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.6 + vaWavePhase)));
    var h = Math.max(2, Math.round(amp * (VA_CH - 16)));
    ctx.fillRect(x0 + i * (bw + gap), Math.round((VA_CH - h) / 2), bw, h);
  }
  return [{ x: 0, y: 0, w: VA_CW, h: VA_CH }];
}

var vaRoot = View({ style: { width: 480, height: 480, background: '#07111D', scroll: 'none' } });
Text({ parent: vaRoot, text: 'LUME VOICE', style: { position: 'absolute', x: 0, y: 34,
  width: 480, height: 34, fontSize: 26, color: '#F2F7FB', textAlign: 'center' } });
Text({ parent: vaRoot, text: function () { return 'MODE ' + vaModeLabel(); },
  style: { position: 'absolute', x: 0, y: 72, width: 480, height: 24,
    fontSize: 14, color: '#9EB3C6', textAlign: 'center' } });
Text({ parent: vaRoot, text: vaState, style: { position: 'absolute', x: 0, y: 110,
  width: 480, height: 58, fontSize: 40, color: '#40D8B0', textAlign: 'center' } });
var vaCanvas = Canvas({ width: VA_CW, height: VA_CH, parent: vaRoot,
  style: { position: 'absolute', x: 80, y: 176 }, onDraw: vaDraw });
Text({ parent: vaRoot, text: vaAnswerText, style: { position: 'absolute', x: 40, y: 344,
  width: 400, height: 62, fontSize: 16, color: '#F2F7FB', textAlign: 'center', longMode: 'wrap' } });
Text({ parent: vaRoot, text: 'TAP TALK / TAP SEND / TAP INTERRUPT',
  style: { position: 'absolute', x: 0, y: 412, width: 480, height: 22,
    fontSize: 12, color: '#9EB3C6', textAlign: 'center' } });
Button({ parent: vaRoot, title: 'TALK', onPress: vaActivate,
  style: { position: 'absolute', x: 170, y: 436, width: 140, height: 40,
    background: '#1C3449', borderRadius: 999, fontSize: 18 } });
lume.gesture.on(vaRoot, 'tap', vaActivate);
lume.gesture.on(vaCanvas, 'tap', vaActivate);
lume.gesture.on(vaRoot, 'longpress', vaLongPress);
lume.gesture.on(vaCanvas, 'longpress', vaLongPress);

/* ---- boot -------------------------------------------------------------- */
vaSetMode(vaDetectMode());
vaCursorTimer = lume.system.setInterval(function () { vaCursor.set(!vaCursor()); }, CURSOR_MS);
var vaWaveTimer = lume.system.setInterval(vaWaveTick, 80);
lume.log('VA READY mode=' + vaMode + ' canned=' + VA_CANNED.length + ' canvas=' + (VA_CW * VA_CH));
