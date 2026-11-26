/*
 * r157: timer_kit -- countdown + stopwatch on the r151 shell form controls.
 * Pure app layer: no firmware / runtime / tools/lume / .d.ts change.
 * r200: aligned to docs/DESIGN-TOKENS.md for round 480x480 screens:
 *   - Wrapped in shell.SafeArea (339x339 inscribed square; all controls inside
 *     global [80, 400] <= [75, 405]).
 *   - State-machine driven buttons (section 3.1): READY shows only START;
 *     RUNNING shows PAUSE + RESET (danger, 24 px gap); PAUSED shows RESUME +
 *     RESET; OVER shows only RESTART. Illegal actions are not rendered.
 *   - State/value consistency (section 3.3): READY displays the configured
 *     minutes (default 05:00) and 100% remaining bar rather than 00:00 + 0%.
 *   - Distinct input vs display bars: interactive circular-thumb slider
 *     (32 px circular thumb, bordered input track, 48 px touch height) vs thin
 *     8 px thumb-free shell.Progress bar.
 *   - BEST records moved to a secondary STATS panel to declutter the main view.
 *
 * CLOCK CONTRACT:
 *   All elapsed values are ABSOLUTE-TIME DIFFERENCES via lume.system.time(),
 *   never setInterval counters, so skipped engine ticks cannot accumulate drift.
 *
 * RECORD KEYS (NVS key cap 15 chars; both keys are 10 chars):
 *   - hisc.timer : shortest CONFIGURED countdown duration (whole minutes) ever
 *                  run to completion. 0 means "no completed countdown yet".
 *   - timer.best : fastest STOPWATCH 3-lap drill finished within 60 s, in ms.
 *
 * Text sizes use only the bridge's 14/20/32 faces. All UI copy is ASCII (r64).
 * Touch feel and audible beep are deferred to board bring-up.
 * Conservative global script: var / function only, one shell.js import.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#0D1420', primary:'#0D1420', surface:'#16202E',
  surfaceAlt:'#1F2C3D', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var KV_TIMER_BEST = 'hisc.timer';   /* 10 chars */
var KV_STOP_BEST = 'timer.best';    /* 10 chars */
var LAP_LIMIT = 3;                  /* shown / scored lap rows */
var DRILL_CAP_MS = 60000;           /* 3-lap drill must finish inside 1 minute */
var TICK_MS = 100;                  /* engine drain cadence; not a time source */
var SLIDER_W = 312;
var SLIDER_H = 48;
var THUMB_R = 16;                   /* 32 px circular thumb (DESIGN-TOKENS 1.5) */

/* ---- state: every value lives in a signal ----------------------------- */
var mode = signal(false);           /* false = TIMER, true = STOPWATCH */
var showStats = signal(false);      /* secondary records view */
var minutes = signal(5);            /* Slider value, whole minutes 0..60 */
var running = signal(false);
var status = signal('READY');
var cdPhase = signal('READY');      /* READY | RUNNING | PAUSED | OVER */
var swPhase = signal('READY');      /* READY | RUNNING | PAUSED */
var remainingMs = signal(0);        /* countdown, absolute-time derived */
var elapsedMs = signal(0);          /* stopwatch, absolute-time derived */
var laps = signal([]);              /* last LAP_LIMIT split times (ms) */
var timerBest = signal(0);          /* hisc.timer */
var stopBest = signal(0);           /* timer.best */

/* Absolute-time anchors (plain vars: they are instants, not UI state). */
var cdEndAt = 0, cdPausedMs = 0, cdSetMin = 0;
var swStartAt = 0, swAccum = 0;
var tickTimer = null;

function tkNow() { return lume.system.time(); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtClock(ms) {
  var s = Math.floor(ms / 1000);
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}
function fmtStop(ms) {
  return fmtClock(ms) + '.' + pad2(Math.floor(ms / 10) % 100);
}
function fmtMin(m) { return (m < 10 ? '0' : '') + m; }

/* ---- KV: try/catch everywhere, accept only non-negative finite numbers - */
function kvLoad(key) {
  try {
    var v = lume.storage.kv.get(key);
    return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0;
  } catch (e) { return 0; }
}
function kvSave(key, value) {
  try { lume.storage.kv.set(key, value); } catch (e) { /* NVS failure is silent */ }
  return value;
}

/* ---- settlement bell: short synchronous stereo PCM, envelope per piano - */
function ring() {
  try {
    if (!lume.audio || !lume.audio.play) return;
    var frames = 640;               /* 40 ms at 16 kHz = 2560 B < 4096 B chunk */
    var pcm = new ArrayBuffer(frames * 4), v = new DataView(pcm);
    for (var i = 0; i < frames; i++) {
      var t = i / 16000;
      var env = Math.min(1, t / 0.003) * Math.exp(-t / 0.035);
      var s = Math.round(9000 * Math.sin(2 * Math.PI * 880 * t) * env);
      v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
    }
    lume.audio.play(pcm);
  } catch (e) { /* audio unavailable: fail silent, never break the tick */ }
}

/* ---- countdown -------------------------------------------------------- */
function displayCdMs() {
  if (cdPhase() === 'READY') return minutes() * 60000;
  return remainingMs();
}
function remainFrac() {
  if (cdPhase() === 'READY') return minutes() > 0 ? 1 : 0;
  var total = cdSetMin * 60000;
  return total > 0 ? Math.max(0, Math.min(1, remainingMs() / total)) : 0;
}
function cdStart() {
  var m = minutes();
  if (m <= 0) { status.set('SET MINUTES'); return; }
  cdSetMin = m; cdPausedMs = 0;
  cdEndAt = tkNow() + m * 60000;
  remainingMs.set(m * 60000);
  running.set(true); cdPhase.set('RUNNING'); status.set('RUNNING'); startTicker();
}
function cdPause() {
  if (!running()) return;
  cdPausedMs = Math.max(0, cdEndAt - tkNow());
  stopTicker(); running.set(false); cdPhase.set('PAUSED'); status.set('PAUSED');
}
function cdResume() {
  if (running() || cdPausedMs <= 0) return;
  cdEndAt = tkNow() + cdPausedMs;   /* re-anchor: paused wall time is excluded */
  startTicker(); running.set(true); cdPhase.set('RUNNING'); status.set('RUNNING');
}
function cdReset() {
  stopTicker(); cdEndAt = 0; cdPausedMs = 0; cdSetMin = 0;
  remainingMs.set(0); running.set(false); cdPhase.set('READY'); status.set('READY');
}
function cdTick() {
  var left = Math.max(0, cdEndAt - tkNow());
  remainingMs.set(left);
  if (left === 0) {
    stopTicker(); running.set(false); cdPhase.set('OVER'); ring();
    var done = cdSetMin;
    var best = timerBest();
    if (done > 0 && (best === 0 || done < best)) timerBest.set(kvSave(KV_TIMER_BEST, done));
    status.set('DONE - ' + fmtMin(done) + ' MIN');
  }
}

/* ---- stopwatch -------------------------------------------------------- */
function swStart() {
  swAccum = 0; swStartAt = tkNow();
  elapsedMs.set(0); laps.set([]);
  running.set(true); swPhase.set('RUNNING'); status.set('RUNNING'); startTicker();
}
function swPause() {
  if (!running()) return;
  swAccum += tkNow() - swStartAt;
  stopTicker(); running.set(false); swPhase.set('PAUSED'); status.set('PAUSED');
}
function swResume() {
  if (running()) return;
  swStartAt = tkNow();              /* re-anchor: paused wall time is excluded */
  startTicker(); running.set(true); swPhase.set('RUNNING'); status.set('RUNNING');
}
function swReset() {
  stopTicker(); swAccum = 0; swStartAt = 0;
  elapsedMs.set(0); laps.set([]); running.set(false); swPhase.set('READY'); status.set('READY');
}
function swTick() { elapsedMs.set(swAccum + tkNow() - swStartAt); }
function swLap() {
  if (!running()) return;
  var ms = elapsedMs(), all = laps().slice(), third = all.length + 1;
  all.push(ms);
  laps.set(all.slice(-LAP_LIMIT));  /* keep only the most recent three rows */
  if (third === LAP_LIMIT && ms <= DRILL_CAP_MS) {
    var best = stopBest();
    if (best === 0 || ms < best) stopBest.set(kvSave(KV_STOP_BEST, ms));
  }
}

/* ---- shared ticker + mode switch -------------------------------------- */
function startTicker() {
  if (tickTimer === null) tickTimer = lume.system.setInterval(tick, TICK_MS);
}
function stopTicker() {
  if (tickTimer !== null) { lume.system.clearInterval(tickTimer); tickTimer = null; }
}
/* A stray tick (engine drain racing a pause) must not advance a frozen
 * measurement: every elapsed value is recomputed from an absolute anchor. */
function tick() { if (!running()) return; if (mode()) swTick(); else cdTick(); }
function setMode(v) {
  stopTicker();
  cdEndAt = 0; cdPausedMs = 0; cdSetMin = 0;
  swAccum = 0; swStartAt = 0;
  remainingMs.set(0); elapsedMs.set(0); laps.set([]);
  running.set(false); cdPhase.set('READY'); swPhase.set('READY'); status.set('READY');
  showStats.set(false);
  mode.set(!!v);
}
function setMinutes(v) {
  if (!running() && !mode()) {
    var clamped = Math.max(0, Math.min(60, Math.round(v)));
    minutes.set(clamped);
    if (cdPhase() === 'OVER') { cdSetMin = 0; cdPhase.set('READY'); status.set('READY'); }
  }
}
function primary() { if (running()) cdPause(); else cdResume(); }
function swPrimary() {
  if (running()) swPause();
  else if (swAccum > 0) swResume();
  else swStart();
}
function reset() { if (mode()) swReset(); else cdReset(); }

timerBest.set(kvLoad(KV_TIMER_BEST));
stopBest.set(kvLoad(KV_STOP_BEST));

/* ---- UI: round-screen SafeArea (global [80, 400] x [76, 398]) ---------- */
var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: 'primary', scroll: 'none' } });
var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480, children: [] });

/* Header: mode switch + secondary STATS page toggle (both >= 48 px tall). */
var modeSwitch = lume.ui.shell.Switch({ parent: safe, x: 10, y: 6,
  value: mode, trackWidth: 60, height: 48, label: 'STOPWATCH',
  onChange: function (v) { setMode(v); } });
Button({ parent: safe,
  title: function () { return showStats() ? 'BACK' : 'STATS'; },
  onPress: function () { showStats.set(!showStats()); },
  style: { x: 256, y: 6, width: 74, height: 48, borderRadius: 999, fontSize: 14,
    background: '#1F2C3D', borderWidth: 1, borderColor: '#5C7794', scroll: 'none' } });

/* Mode panels: inactive panels sit off-screen at x=1000. */
var timerPanel = View({ parent: safe, style: {
  x: function () { return (mode() || showStats()) ? 1000 : 10; }, y: 60,
  width: 320, height: 270, padding: 0, gap: 0, scroll: 'none' } });
var stopPanel = View({ parent: safe, style: {
  x: function () { return (mode() && !showStats()) ? 10 : 1000; }, y: 60,
  width: 320, height: 270, padding: 0, gap: 0, scroll: 'none' } });
var statsPanel = View({ parent: safe, style: {
  x: function () { return showStats() ? 10 : 1000; }, y: 60,
  width: 320, height: 270, padding: 0, gap: 0, scroll: 'none' } });

/* ---- TIMER panel ------------------------------------------------------ */
Text({ parent: timerPanel, text: function () { return fmtClock(displayCdMs()); },
  style: { x: 0, y: 4, width: 320, height: 42, fontSize: 32,
    textAlign: 'center', color: '#F2F7FB', scroll: 'none' } });
Text({ parent: timerPanel, text: status,
  style: { x: 0, y: 48, width: 320, height: 20, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });

/* Display-only remaining progress bar: thin 8 px, no thumb (DESIGN-TOKENS 2). */
var remainBar = lume.ui.shell.Progress({ parent: timerPanel, x: 4, y: 78,
  width: SLIDER_W, height: 8, value: remainFrac });

/* Input slider: bordered track + 32 px circular thumb (DESIGN-TOKENS 1.5/2). */
Text({ parent: timerPanel, text: function () { return 'SET ' + fmtMin(minutes()) + ' MIN'; },
  style: { x: 4, y: 98, width: SLIDER_W, height: 20, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });

var sliderOffs = [];
var sliderStartVal = 5, sliderLastQ = 5, sliderActive = false;
function quantMin(raw) {
  if (!isFinite(raw)) raw = 0;
  return Math.max(0, Math.min(60, Math.round(raw)));
}
var setSlider = Canvas({ parent: timerPanel, width: SLIDER_W, height: SLIDER_H,
  style: { x: 4, y: 122, scroll: 'none' },
  onDraw: function (c) {
    var m = minutes();
    var mid = Math.floor(SLIDER_H / 2);
    var usable = SLIDER_W - THUMB_R * 2;
    var cx = THUMB_R + Math.round((m / 60) * usable);
    c.fillColor('#0D1420'); c.fillRect(0, 0, SLIDER_W, SLIDER_H);
    /* Input rail: recessed bg-3 track with visible border (input vs display). */
    c.fillColor('#5C7794'); c.fillRect(THUMB_R - 2, mid - 5, usable + 4, 10);
    c.fillColor('#1F2C3D'); c.fillRect(THUMB_R, mid - 3, usable, 6);
    c.fillColor('#40D8B0'); c.fillRect(THUMB_R, mid - 3, Math.max(0, cx - THUMB_R), 6);
    /* Circular >=32 px thumb (radius 16 = 32 px diameter). */
    c.fillCircle(cx, mid, THUMB_R, '#F2F7FB');
    c.circle(cx, mid, THUMB_R - 1, '#40D8B0', 2);
    c.fillCircle(cx, mid, 5, '#117B69');
  } });
sliderOffs.push(lume.gesture.on(setSlider, 'panstart', function () {
  sliderActive = true; sliderStartVal = minutes(); sliderLastQ = quantMin(sliderStartVal);
}));
sliderOffs.push(lume.gesture.on(setSlider, 'pan', function (e) {
  if (!sliderActive) return;
  var q = quantMin(sliderStartVal + (e.dx || 0) * 60 / SLIDER_W);
  if (q !== sliderLastQ) { sliderLastQ = q; setMinutes(q); }
}));
sliderOffs.push(lume.gesture.on(setSlider, 'panend', function () { sliderActive = false; }));
function disposeSlider() {
  while (sliderOffs.length) { var off = sliderOffs.pop(); if (off) off(); }
}

/* State-machine driven buttons (DESIGN-TOKENS 3.1):
 *   READY   -> [START(accent)]
 *   RUNNING -> [PAUSE(bg-3)]  24px  [RESET(danger)]
 *   PAUSED  -> [RESUME(accent)] 24px [RESET(danger)]
 *   OVER    -> [RESTART(accent)] */
var btnStart = Button({ parent: timerPanel, title: 'START',
  onPress: function () { cdStart(); },
  style: { x: 76, y: 196, width: 168, height: 52, borderRadius: 999, fontSize: 14,
    background: '#117B69', borderWidth: 2, borderColor: '#40D8B0', scroll: 'none' } });
var btnPause = Button({ parent: timerPanel, title: 'PAUSE',
  onPress: function () { cdPause(); },
  style: { x: 16, y: 196, width: 132, height: 52, borderRadius: 999, fontSize: 14,
    background: '#1F2C3D', borderWidth: 1, borderColor: '#5C7794', scroll: 'none' } });
var btnResume = Button({ parent: timerPanel, title: 'RESUME',
  onPress: function () { cdResume(); },
  style: { x: 16, y: 196, width: 132, height: 52, borderRadius: 999, fontSize: 14,
    background: '#117B69', borderWidth: 2, borderColor: '#40D8B0', scroll: 'none' } });
var btnReset = Button({ parent: timerPanel, title: 'RESET',
  onPress: function () { cdReset(); },
  style: { x: 172, y: 196, width: 132, height: 52, borderRadius: 999, fontSize: 14,
    background: '#16202E', borderWidth: 2, borderColor: '#FF6B79', scroll: 'none' } });
var btnRestart = Button({ parent: timerPanel, title: 'RESTART',
  onPress: function () { cdStart(); },
  style: { x: 76, y: 196, width: 168, height: 52, borderRadius: 999, fontSize: 14,
    background: '#117B69', borderWidth: 2, borderColor: '#40D8B0', scroll: 'none' } });

effect(function () {
  var p = cdPhase();
  lume.setAttr(btnStart, 5, p === 'READY' ? 1 : 0);
  lume.setAttr(btnPause, 5, p === 'RUNNING' ? 1 : 0);
  lume.setAttr(btnResume, 5, p === 'PAUSED' ? 1 : 0);
  lume.setAttr(btnReset, 5, (p === 'RUNNING' || p === 'PAUSED') ? 1 : 0);
  lume.setAttr(btnRestart, 5, p === 'OVER' ? 1 : 0);
});

/* ---- STOPWATCH panel -------------------------------------------------- */
Text({ parent: stopPanel, text: function () { return fmtStop(elapsedMs()); },
  style: { x: 0, y: 4, width: 320, height: 42, fontSize: 32,
    textAlign: 'center', color: '#F2F7FB', scroll: 'none' } });
Text({ parent: stopPanel, text: status,
  style: { x: 0, y: 48, width: 320, height: 20, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });
for (var li = 0; li < LAP_LIMIT; li++) {
  (function (row) {
    Text({ parent: stopPanel, text: function () {
        var a = laps(), v = a[a.length - LAP_LIMIT + row];
        return v === undefined ? 'LAP ' + (row + 1) + '  --:--.--'
                               : 'LAP ' + (row + 1) + '  ' + fmtStop(v);
      },
      style: { x: 0, y: 78 + row * 32, width: 320, height: 26, fontSize: 20,
        textAlign: 'center', color: row === LAP_LIMIT - 1 ? '#40D8B0' : '#9EB3C6', scroll: 'none' } });
  })(li);
}
var swBtnStart = Button({ parent: stopPanel, title: 'START',
  onPress: function () { swStart(); },
  style: { x: 76, y: 196, width: 168, height: 52, borderRadius: 999, fontSize: 14,
    background: '#117B69', borderWidth: 2, borderColor: '#40D8B0', scroll: 'none' } });
var swBtnPause = Button({ parent: stopPanel, title: 'PAUSE',
  onPress: function () { swPause(); },
  style: { x: 0, y: 196, width: 92, height: 52, borderRadius: 999, fontSize: 14,
    background: '#1F2C3D', borderWidth: 1, borderColor: '#5C7794', scroll: 'none' } });
var swBtnLap = Button({ parent: stopPanel, title: 'LAP',
  onPress: function () { swLap(); },
  style: { x: 100, y: 196, width: 92, height: 52, borderRadius: 999, fontSize: 14,
    background: '#1F2C3D', borderWidth: 1, borderColor: '#5C7794', scroll: 'none' } });
var swBtnResume = Button({ parent: stopPanel, title: 'RESUME',
  onPress: function () { swResume(); },
  style: { x: 16, y: 196, width: 132, height: 52, borderRadius: 999, fontSize: 14,
    background: '#117B69', borderWidth: 2, borderColor: '#40D8B0', scroll: 'none' } });
var swBtnReset = Button({ parent: stopPanel, title: 'RESET',
  onPress: function () { swReset(); },
  style: { x: 216, y: 196, width: 104, height: 52, borderRadius: 999, fontSize: 14,
    background: '#16202E', borderWidth: 2, borderColor: '#FF6B79', scroll: 'none' } });

effect(function () {
  var p = swPhase();
  lume.setAttr(swBtnStart, 5, p === 'READY' ? 1 : 0);
  lume.setAttr(swBtnPause, 5, p === 'RUNNING' ? 1 : 0);
  lume.setAttr(swBtnLap, 5, p === 'RUNNING' ? 1 : 0);
  lume.setAttr(swBtnResume, 5, p === 'PAUSED' ? 1 : 0);
  lume.setAttr(swBtnReset, 5, (p === 'RUNNING' || p === 'PAUSED') ? 1 : 0);
});

/* ---- STATS secondary panel (BEST records hidden from primary screen) --- */
Text({ parent: statsPanel, text: 'RECORDS',
  style: { x: 0, y: 8, width: 320, height: 28, fontSize: 20,
    textAlign: 'center', color: '#F2F7FB', scroll: 'none' } });
lume.ui.shell.Card({ parent: statsPanel,
  style: { x: 8, y: 48, width: 304, height: 76, padding: 12, gap: 4 },
  children: [
    Text({ text: 'BEST TIMER SET', style: { height: 18, fontSize: 14, color: '#9EB3C6', scroll: 'none' } }),
    Text({ text: function () { return fmtMin(timerBest()) + ' MIN'; },
      style: { height: 26, fontSize: 20, color: '#F2F7FB', scroll: 'none' } }),
  ] });
lume.ui.shell.Card({ parent: statsPanel,
  style: { x: 8, y: 136, width: 304, height: 76, padding: 12, gap: 4 },
  children: [
    Text({ text: 'BEST 3-LAP (UNDER 60 S)', style: { height: 18, fontSize: 14, color: '#9EB3C6', scroll: 'none' } }),
    Text({ text: function () { return fmtStop(stopBest()); },
      style: { height: 26, fontSize: 20, color: '#F2F7FB', scroll: 'none' } }),
  ] });

/* Pause clears the ticker; resume re-anchors from the saved snapshot. */
lume.app.onPause(function () { stopTicker(); });
lume.app.onResume(function () {
  if (!running()) return;
  if (mode()) swResume(); else cdResume();
});

/* Harness / simulator introspection surface (same convention as controls_demo). */
globalThis.timerKit = {
  mode: mode, showStats: showStats, minutes: minutes, running: running, status: status,
  cdPhase: cdPhase, swPhase: swPhase,
  remainingMs: remainingMs, elapsedMs: elapsedMs, laps: laps,
  timerBest: timerBest, stopBest: stopBest,
  switchNode: modeSwitch, sliderNode: setSlider, progressNode: remainBar,
  btnStart: btnStart, btnPause: btnPause, btnResume: btnResume,
  btnReset: btnReset, btnRestart: btnRestart,
  disposeSlider: disposeSlider, displayCdMs: displayCdMs, remainFrac: remainFrac,
  tick: tick, ring: ring, now: tkNow,
  cdStart: cdStart, cdPause: cdPause, cdResume: cdResume, cdReset: cdReset,
  swStart: swStart, swPause: swPause, swResume: swResume, swReset: swReset,
  swLap: swLap, swPrimary: swPrimary, primary: primary, reset: reset,
  setMode: setMode, setMinutes: setMinutes,
  kvLoad: kvLoad, kvSave: kvSave, fmtClock: fmtClock, fmtStop: fmtStop,
  KV_TIMER_BEST: KV_TIMER_BEST, KV_STOP_BEST: KV_STOP_BEST,
  LAP_LIMIT: LAP_LIMIT, DRILL_CAP_MS: DRILL_CAP_MS, TICK_MS: TICK_MS,
  SLIDER_W: SLIDER_W, SLIDER_H: SLIDER_H, THUMB_R: THUMB_R, CANVAS_BUDGET: 230400
};
lume.log('TIMER KIT READY');
