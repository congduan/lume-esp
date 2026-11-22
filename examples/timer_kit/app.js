/*
 * r157: timer_kit -- countdown + stopwatch on the r151 shell form controls.
 * Pure app layer: no firmware / runtime / tools/lume / .d.ts change.
 *
 * SHELL CONSUMPTION (the first real consumer of r151's form primitives):
 *   - shell.Slider  : set the countdown length, 0..60 whole minutes (step 1).
 *   - shell.Progress: remaining fraction of the running countdown.
 *   - shell.Switch  : TIMER / STOPWATCH mode toggle.
 *
 * CLOCK CONTRACT (corrected against the code -- see the r157 report):
 *   The brief said `lume.system.now()`; that member does NOT exist. The real
 *   millisecond wall clock is `lume.system.time()` (runtime/types/lume.d.ts:451,
 *   backed by lume._systemTime / gettimeofday). All elapsed values here are
 *   ABSOLUTE-TIME DIFFERENCES, never setInterval counters, so skipped engine
 *   ticks cannot accumulate drift.
 *
 * PAUSE SEMANTICS: pausing snapshots the remaining/accumulated ms; resuming
 * re-anchors endAt/startAt to `tkNow() + snapshot`. Wall-clock time spent
 * paused is therefore excluded from every measurement.
 *
 * RECORD KEYS (NVS key cap 15 chars; both keys are 10 chars):
 *   - hisc.timer : shortest CONFIGURED countdown duration (whole minutes) ever
 *                  run to completion. 0 means "no completed countdown yet".
 *                  ("shortest used-up setting" -- counted only on a real zero.)
 *   - timer.best : fastest STOPWATCH 3-lap drill finished within 60 s, in ms.
 *                  0 means "no qualifying drill yet". A "drill" is START ->
 *                  three LAP taps; only a third LAP at elapsed <= 60000 ms
 *                  qualifies, and smaller is better.
 *
 * Layout is native View/Text/Button. The only Canvas is the one shell.Slider
 * allocates internally (432x40 = 17280 px), well under the 230400 px budget;
 * no ring/gauge canvas is used. Text sizes use only the bridge's 14/20/32 faces.
 * All UI copy is ASCII (r64). Touch feel and audible beep are deferred to board
 * bring-up: this round has host / build evidence only, not hardware acceptance.
 *
 * Conservative global script: var / function only, one shell.js import.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435',
  surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 12 });

var KV_TIMER_BEST = 'hisc.timer';   /* 10 chars */
var KV_STOP_BEST = 'timer.best';    /* 10 chars */
var LAP_LIMIT = 3;                  /* shown / scored lap rows */
var DRILL_CAP_MS = 60000;           /* 3-lap drill must finish inside 1 minute */
var TICK_MS = 100;                  /* engine drain cadence; not a time source */

/* ---- state: every value lives in a signal ----------------------------- */
var mode = signal(false);           /* false = TIMER, true = STOPWATCH */
var minutes = signal(5);            /* Slider value, whole minutes 0..60 */
var running = signal(false);
var status = signal('READY');
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
function remainFrac() {
  var total = cdSetMin * 60000;
  return total > 0 ? Math.max(0, Math.min(1, remainingMs() / total)) : 0;
}
function cdStart() {
  var m = minutes();
  if (m <= 0) { status.set('SET MINUTES'); return; }
  cdSetMin = m; cdPausedMs = 0;
  cdEndAt = tkNow() + m * 60000;
  remainingMs.set(m * 60000);
  running.set(true); status.set('RUNNING'); startTicker();
}
function cdPause() {
  if (!running()) return;
  cdPausedMs = Math.max(0, cdEndAt - tkNow());
  stopTicker(); running.set(false); status.set('PAUSED');
}
function cdResume() {
  if (running() || cdPausedMs <= 0) return;
  cdEndAt = tkNow() + cdPausedMs;   /* re-anchor: paused wall time is excluded */
  startTicker(); running.set(true); status.set('RUNNING');
}
function cdReset() {
  stopTicker(); cdEndAt = 0; cdPausedMs = 0; cdSetMin = 0;
  remainingMs.set(0); running.set(false); status.set('READY');
}
function cdTick() {
  var left = Math.max(0, cdEndAt - tkNow());
  remainingMs.set(left);
  if (left === 0) {
    stopTicker(); running.set(false); ring();
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
  running.set(true); status.set('RUNNING'); startTicker();
}
function swPause() {
  if (!running()) return;
  swAccum += tkNow() - swStartAt;
  stopTicker(); running.set(false); status.set('PAUSED');
}
function swResume() {
  if (running()) return;
  swStartAt = tkNow();              /* re-anchor: paused wall time is excluded */
  startTicker(); running.set(true); status.set('RUNNING');
}
function swReset() {
  stopTicker(); swAccum = 0; swStartAt = 0;
  elapsedMs.set(0); laps.set([]); running.set(false); status.set('READY');
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
  running.set(false); status.set('READY');
  mode.set(!!v);
}
function setMinutes(v) { if (!running() && !mode()) minutes.set(v); }
/* TIMER middle button: PAUSE <-> RESUME. STOPWATCH first button:
 * START -> PAUSE -> RESUME, with LAP and RESET alongside. */
function primary() { if (running()) cdPause(); else cdResume(); }
function swPrimary() {
  if (running()) swPause();
  else if (swAccum > 0) swResume();
  else swStart();
}
function reset() { if (mode()) swReset(); else cdReset(); }

timerBest.set(kvLoad(KV_TIMER_BEST));
stopBest.set(kvLoad(KV_STOP_BEST));

/* ---- UI --------------------------------------------------------------- */
var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  background: 'primary', scroll: 'none' } });
Text({ parent: root, text: 'TIMER KIT',
  style: { x: 24, y: 14, width: 432, height: 38, fontSize: 32,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: root, text: 'COUNTDOWN / STOPWATCH',
  style: { x: 24, y: 54, width: 432, height: 20, fontSize: 14,
    color: '#9EB3C6', scroll: 'none' } });

/* Switch: the first r151 primitive consumed by an app. */
var modeSwitch = lume.ui.shell.Switch({ parent: root, x: 24, y: 82,
  value: mode, trackWidth: 72, height: 48, label: 'STOPWATCH',
  onChange: function (v) { setMode(v); } });
Text({ parent: root, text: function () {
    return 'BEST SET ' + fmtMin(timerBest()) + ' MIN  LAP ' + fmtStop(stopBest());
  },
  style: { x: 304, y: 82, width: 152, height: 48, fontSize: 14,
    color: '#9EB3C6', textAlign: 'right', scroll: 'none' } });

/* Two mode panels: the inactive one is moved off-screen via a bound x getter
 * (signal-driven, no manual remove/rebuild). __pixel requires a nonnegative
 * integer, so the hidden x is 1000 -- fully outside a 480 px screen and thus
 * never a touch target on device. */
var timerPanel = View({ parent: root, style: {
  x: function () { return mode() ? 1000 : 0; }, y: 138,
  width: 432, height: 330, scroll: 'none' } });
var stopPanel = View({ parent: root, style: {
  x: function () { return mode() ? 0 : 1000; }, y: 138,
  width: 432, height: 330, scroll: 'none' } });

/* TIMER: Slider (step-quantised minutes) + Progress (remaining fraction). */
Text({ parent: timerPanel, text: function () { return 'SET ' + fmtMin(minutes()) + ' MIN'; },
  style: { x: 0, y: 0, width: 432, height: 26, fontSize: 20,
    color: '#40D8B0', scroll: 'none' } });
var setSlider = lume.ui.shell.Slider({ parent: timerPanel, x: 0, y: 30,
  width: 432, height: 40, min: 0, max: 60, step: 1, value: minutes,
  onChange: function (v) { setMinutes(v); } });
var remainBar = lume.ui.shell.Progress({ parent: timerPanel, x: 0, y: 82,
  width: 432, height: 20, value: remainFrac, label: 'REMAINING' });
Text({ parent: timerPanel, text: function () { return fmtClock(remainingMs()); },
  style: { x: 0, y: 116, width: 432, height: 60, fontSize: 32,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: timerPanel, text: status,
  style: { x: 0, y: 182, width: 432, height: 24, fontSize: 14,
    color: '#9EB3C6', scroll: 'none' } });
Button({ parent: timerPanel, title: 'START',
  onPress: function () { cdStart(); },
  style: { x: 0, y: 214, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Button({ parent: timerPanel, title: function () { return running() ? 'PAUSE' : 'RESUME'; },
  onPress: function () { primary(); },
  style: { x: 148, y: 214, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Button({ parent: timerPanel, title: 'RESET',
  onPress: function () { reset(); },
  style: { x: 296, y: 214, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Text({ parent: timerPanel, text: 'SLIDE TO SET MINUTES | START TO RUN',
  style: { x: 0, y: 284, width: 432, height: 20, fontSize: 14,
    color: '#9EB3C6', scroll: 'none' } });

/* STOPWATCH: mm:ss.cc big readout + the last three lap rows. */
Text({ parent: stopPanel, text: function () { return fmtStop(elapsedMs()); },
  style: { x: 0, y: 0, width: 432, height: 60, fontSize: 32,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: stopPanel, text: status,
  style: { x: 0, y: 64, width: 432, height: 24, fontSize: 14,
    color: '#9EB3C6', scroll: 'none' } });
for (var li = 0; li < LAP_LIMIT; li++) {
  (function (row) {
    Text({ parent: stopPanel, text: function () {
        var a = laps(), v = a[a.length - LAP_LIMIT + row];
        return v === undefined ? 'LAP ' + (row + 1) + '  --:--.--'
                               : 'LAP ' + (row + 1) + '  ' + fmtStop(v);
      },
      style: { x: 0, y: 96 + row * 32, width: 432, height: 26, fontSize: 20,
        color: row === LAP_LIMIT - 1 ? '#40D8B0' : '#9EB3C6', scroll: 'none' } });
  })(li);
}
Button({ parent: stopPanel, title: function () {
    return running() ? 'PAUSE' : (swAccum > 0 ? 'RESUME' : 'START');
  },
  onPress: function () { swPrimary(); },
  style: { x: 0, y: 206, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Button({ parent: stopPanel, title: 'LAP',
  onPress: function () { swLap(); },
  style: { x: 148, y: 206, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Button({ parent: stopPanel, title: 'RESET',
  onPress: function () { reset(); },
  style: { x: 296, y: 206, width: 136, height: 52, fontSize: 14, scroll: 'none' } });
Text({ parent: stopPanel, text: function () {
    return 'BEST 3-LAP ' + fmtStop(stopBest()) + ' (UNDER 60 S)';
  },
  style: { x: 0, y: 274, width: 432, height: 20, fontSize: 14,
    color: '#9EB3C6', scroll: 'none' } });

/* Pause clears the ticker; resume re-anchors from the saved snapshot. */
lume.app.onPause(function () { stopTicker(); });
lume.app.onResume(function () {
  if (!running()) return;
  if (mode()) swResume(); else cdResume();
});

/* Harness / simulator introspection surface (same convention as controls_demo). */
globalThis.timerKit = {
  mode: mode, minutes: minutes, running: running, status: status,
  remainingMs: remainingMs, elapsedMs: elapsedMs, laps: laps,
  timerBest: timerBest, stopBest: stopBest,
  switchNode: modeSwitch, sliderNode: setSlider, progressNode: remainBar,
  tick: tick, ring: ring, now: tkNow,
  cdStart: cdStart, cdPause: cdPause, cdResume: cdResume, cdReset: cdReset,
  swStart: swStart, swPause: swPause, swResume: swResume, swReset: swReset,
  swLap: swLap, swPrimary: swPrimary, primary: primary, reset: reset,
  setMode: setMode, setMinutes: setMinutes,
  kvLoad: kvLoad, kvSave: kvSave, fmtClock: fmtClock, fmtStop: fmtStop,
  KV_TIMER_BEST: KV_TIMER_BEST, KV_STOP_BEST: KV_STOP_BEST,
  LAP_LIMIT: LAP_LIMIT, DRILL_CAP_MS: DRILL_CAP_MS, TICK_MS: TICK_MS,
  SLIDER_W: 432, SLIDER_H: 40, CANVAS_BUDGET: 230400
};
lume.log('TIMER KIT READY');
