/*
 * r204: timer_kit -- radial watch-dial translation of artifacts/r201/design/timer.html.
 * Preserves all countdown + stopwatch + KV persistence + settlement bell semantics:
 *   - Absolute-time clock via lume.system.time() (never counter drift).
 *   - Four countdown states: READY / RUNNING / PAUSED / FINISHED with distinct
 *     semantic badges and state-machine CTAs (START -> PAUSE+RESET -> RESUME+RESET
 *     -> FINISHED bell + RESTART+RESET).
 *   - Running edit-lock: +/- steppers are locked by default while RUNNING; tap
 *     the lock pill below the digits to explicitly unlock +/- 1 min adjustment.
 *   - Monospace Canvas vector 48px hero digits (fixed advance per char -> zero
 *     horizontal jitter per second).
 *   - Single 480x480 Canvas (230400 px == budget) with retained 60-tick dial
 *     segments (<= 100 draw calls/frame, well below the 240-call budget).
 *   - Glow/blur simplified to layered low-luminance concentric rings/circles.
 *
 * RECORD KEYS (NVS key cap 15 chars):
 *   - hisc.timer : shortest configured countdown duration (whole minutes) completed.
 *   - timer.best : fastest stopwatch 3-lap drill finished within 60 s, in ms.
 *
 * Pure app layer: no firmware / runtime / tools/lume change.
 * Text nodes use only bundled 14/20/32 faces; all UI copy is ASCII (r64).
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#000000', primary:'#0D1420', surface:'#16202E',
  surfaceAlt:'#1F2C3D', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var KV_TIMER_BEST = 'hisc.timer';   /* 10 chars */
var KV_STOP_BEST = 'timer.best';    /* 10 chars */
var LAP_LIMIT = 3;
var DRILL_CAP_MS = 60000;
var TICK_MS = 100;
var CANVAS_W = 480;
var CANVAS_H = 480;
var CANVAS_BUDGET = 230400;
var FRAME_DRAW_BUDGET = 240;

/* ---- state signals ---------------------------------------------------- */
var mode = signal(false);           /* false = COUNTDOWN, true = STOPWATCH */
var showStats = signal(false);      /* secondary records view */
var minutes = signal(5);            /* configured minutes 0..60 */
var running = signal(false);
var status = signal('READY');
var cdPhase = signal('READY');      /* READY | RUNNING | PAUSED | FINISHED */
var swPhase = signal('READY');      /* READY | RUNNING | PAUSED */
var editLocked = signal(true);      /* RUNNING +/- edit lock (default locked) */
var remainingMs = signal(0);
var elapsedMs = signal(0);
var laps = signal([]);
var timerBest = signal(0);
var stopBest = signal(0);

/* Absolute-time anchors & frame-draw telemetry. */
var cdEndAt = 0, cdPausedMs = 0, cdSetMin = 0;
var swStartAt = 0, swAccum = 0;
var tickTimer = null;
var lastDrawCalls = 0;

function tkNow() { return lume.system.time(); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtClock(ms) {
  var s = Math.floor(Math.max(0, ms) / 1000);
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}
function fmtClockCeil(ms) {
  var s = Math.ceil(Math.max(0, ms) / 1000);
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}
function fmtStop(ms) {
  return fmtClock(ms) + '.' + pad2(Math.floor(Math.max(0, ms) / 10) % 100);
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

/* ---- settlement bell: 40 ms stereo PCM under try/catch ---------------- */
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
  } catch (e) { /* audio unavailable: fail silent */ }
}

/* ---- countdown -------------------------------------------------------- */
function displayCdMs() {
  if (cdPhase() === 'READY') return minutes() * 60000;
  return remainingMs();
}
function remainFrac() {
  var p = cdPhase();
  if (p === 'READY') return minutes() > 0 ? 1 : 0;
  if (p === 'FINISHED') return 0;
  var total = cdSetMin * 60000;
  return total > 0 ? Math.max(0, Math.min(1, remainingMs() / total)) : 0;
}
function cdStart() {
  var m = minutes();
  if (m <= 0) { status.set('SET MINUTES'); return; }
  cdSetMin = m; cdPausedMs = 0;
  cdEndAt = tkNow() + m * 60000;
  remainingMs.set(m * 60000);
  editLocked.set(true);
  running.set(true); cdPhase.set('RUNNING'); status.set('RUNNING'); startTicker();
}
function cdPause() {
  if (!running()) return;
  cdPausedMs = Math.max(0, cdEndAt - tkNow());
  stopTicker(); running.set(false); editLocked.set(true);
  cdPhase.set('PAUSED'); status.set('PAUSED');
}
function cdResume() {
  if (running() || cdPausedMs <= 0) return;
  cdEndAt = tkNow() + cdPausedMs;   /* re-anchor: paused wall time is excluded */
  editLocked.set(true);
  startTicker(); running.set(true); cdPhase.set('RUNNING'); status.set('RUNNING');
}
function cdReset() {
  stopTicker(); cdEndAt = 0; cdPausedMs = 0; cdSetMin = 0;
  remainingMs.set(0); running.set(false); editLocked.set(true);
  cdPhase.set('READY'); status.set('READY');
}
function cdTick() {
  var left = Math.max(0, cdEndAt - tkNow());
  remainingMs.set(left);
  if (left === 0) {
    stopTicker(); running.set(false); editLocked.set(true);
    cdPhase.set('FINISHED'); ring();
    var done = cdSetMin;
    var best = timerBest();
    if (done > 0 && (best === 0 || done < best)) timerBest.set(kvSave(KV_TIMER_BEST, done));
    status.set('DONE - ' + fmtMin(done) + ' MIN');
  }
}
function toggleEditLock() {
  if (!mode() && cdPhase() === 'RUNNING') editLocked.set(!editLocked());
}
function stepMinutes(delta) {
  if (mode()) return;
  var p = cdPhase();
  if (p === 'READY') {
    var next = Math.max(1, Math.min(60, minutes() + delta));
    minutes.set(next);
    return;
  }
  if (p === 'RUNNING' && !editLocked()) {
    var cur = Math.max(0, cdEndAt - tkNow());
    var adj = Math.max(1000, Math.min(60 * 60000, cur + delta * 60000));
    cdEndAt = tkNow() + adj;
    if (adj > cdSetMin * 60000) cdSetMin = Math.ceil(adj / 60000);
    remainingMs.set(adj);
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
function tick() { if (!running()) return; if (mode()) swTick(); else cdTick(); }
function setMode(v) {
  stopTicker();
  cdEndAt = 0; cdPausedMs = 0; cdSetMin = 0;
  swAccum = 0; swStartAt = 0;
  remainingMs.set(0); elapsedMs.set(0); laps.set([]);
  running.set(false); editLocked.set(true);
  cdPhase.set('READY'); swPhase.set('READY'); status.set('READY');
  showStats.set(false);
  mode.set(!!v);
}
function setMinutes(v) {
  if (!running() && !mode()) {
    var clamped = Math.max(0, Math.min(60, Math.round(v)));
    minutes.set(clamped);
    if (cdPhase() === 'FINISHED') { cdSetMin = 0; cdPhase.set('READY'); status.set('READY'); }
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

/* ---- Canvas vector helpers (monospace 48px digits + capsules) --------- */
/* Segment bitmask per digit: a(1) b(2) c(4) d(8) e(16) f(32) g(64). */
var SEG_MAP = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function drawMonoDigit(c, ch, x, y, w, h, t, col, calls) {
  var r = Math.floor(t / 2);
  var half = Math.floor(h / 2);
  c.fillColor(col);
  if (ch === ':') {
    var mx = x + Math.floor(w / 2);
    c.fillCircle(mx, y + Math.floor(h * 0.32), r, col);
    c.fillCircle(mx, y + Math.floor(h * 0.68), r, col);
    return calls + 2;
  }
  if (ch === '.') {
    c.fillCircle(x + Math.floor(w / 2), y + h - r - 1, r, col);
    return calls + 1;
  }
  var d = ch.charCodeAt(0) - 48;
  if (d < 0 || d > 9) return calls;
  if (d === 1) {
    var cx1 = x + Math.floor(w * 0.56);
    c.fillRect(cx1 - r, y + r, t, h - t);
    c.fillCircle(cx1, y + r, r, col);
    c.fillCircle(cx1, y + h - r, r, col);
    c.line(cx1 - 7, y + 7, cx1, y + r, col, t - 1);
    return calls + 4;
  }
  var mask = SEG_MAP[d];
  if (mask & 1)  { c.fillRect(x + r, y, w - t, t); calls++; }
  if (mask & 2)  { c.fillRect(x + w - t, y + r, t, half - r); calls++; }
  if (mask & 4)  { c.fillRect(x + w - t, y + half, t, h - half - r); calls++; }
  if (mask & 8)  { c.fillRect(x + r, y + h - t, w - t, t); calls++; }
  if (mask & 16) { c.fillRect(x, y + half, t, h - half - r); calls++; }
  if (mask & 32) { c.fillRect(x, y + r, t, half - r); calls++; }
  if (mask & 64) { c.fillRect(x + r, y + half - r, w - t, t); calls++; }
  /* Rounded corners at active junctions for smooth watch-face typography. */
  if ((mask & 1) || (mask & 32)) { c.fillCircle(x + r, y + r, r, col); calls++; }
  if ((mask & 1) || (mask & 2))  { c.fillCircle(x + w - r, y + r, r, col); calls++; }
  if ((mask & 8) || (mask & 16)) { c.fillCircle(x + r, y + h - r, r, col); calls++; }
  if ((mask & 8) || (mask & 4))  { c.fillCircle(x + w - r, y + h - r, r, col); calls++; }
  if (mask & 64) {
    c.fillCircle(x + r, y + half, r, col);
    c.fillCircle(x + w - r, y + half, r, col);
    calls += 2;
  }
  return calls;
}

function drawMonoTime(c, str, cx, cy, dw, dh, t, col, calls) {
  var gap = 7;
  var colonW = Math.max(10, Math.floor(dw * 0.45));
  var total = 0;
  for (var i = 0; i < str.length; i++) {
    var cw = (str[i] === ':' || str[i] === '.') ? colonW : dw;
    total += cw + (i > 0 ? gap : 0);
  }
  var sx = Math.round(cx - total / 2);
  var sy = Math.round(cy - dh / 2);
  for (var j = 0; j < str.length; j++) {
    var ch = str[j];
    var w = (ch === ':' || ch === '.') ? colonW : dw;
    calls = drawMonoDigit(c, ch, sx, sy, w, dh, t, col, calls);
    sx += w + gap;
  }
  return calls;
}

function drawPill(c, x, y, w, h, fill, border, calls) {
  var r = Math.floor(h / 2);
  if (border) {
    c.fillCircle(x + r, y + r, r, border);
    c.fillCircle(x + w - r, y + r, r, border);
    c.fillColor(border);
    c.fillRect(x + r, y, w - 2 * r, h);
    calls += 3;
    var ir = r - 1;
    c.fillCircle(x + r, y + r, ir, fill);
    c.fillCircle(x + w - r, y + r, ir, fill);
    c.fillColor(fill);
    c.fillRect(x + r, y + 1, w - 2 * r, h - 2);
    calls += 3;
  } else {
    c.fillCircle(x + r, y + r, r, fill);
    c.fillCircle(x + w - r, y + r, r, fill);
    c.fillColor(fill);
    c.fillRect(x + r, y, w - 2 * r, h);
    calls += 3;
  }
  return calls;
}

/* Precompute 60 radial dial ticks (12 major + 48 minor) for retainSegments. */
var MAJOR_SEGS = [], MINOR_SEGS = [];
for (var ti = 0; ti < 60; ti++) {
  var isMaj = (ti % 5) === 0;
  var rad = ((ti * 6) - 90) * Math.PI / 180;
  var r1 = isMaj ? 204 : 208;
  var r2 = 213;
  var seg = [
    Math.round(240 + Math.cos(rad) * r1),
    Math.round(240 + Math.sin(rad) * r1),
    Math.round(240 + Math.cos(rad) * r2),
    Math.round(240 + Math.sin(rad) * r2)
  ];
  if (isMaj) MAJOR_SEGS.push(seg); else MINOR_SEGS.push(seg);
}

/* ---- UI: radial 480x480 Canvas + SafeArea transparent press targets ---- */
var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: '#000000', scroll: 'none' } });

var majorPathId = 0, minorPathId = 0;
var dialCanvas = Canvas({ parent: root, width: CANVAS_W, height: CANVAS_H,
  style: { position: 'absolute', x: 0, y: 0, scroll: 'none' },
  onDraw: function (c) {
    var calls = 0;
    var isStop = mode();
    var isStats = showStats();
    var cp = cdPhase();
    var sp = swPhase();
    var locked = editLocked();
    var mVal = minutes();
    var rem = remainingMs();
    var elap = elapsedMs();
    var lapList = laps();
    var tBest = timerBest();
    var sBest = stopBest();

    if (!majorPathId) {
      majorPathId = c.retainSegments(MAJOR_SEGS, '#5C7794', 2);
      minorPathId = c.retainSegments(MINOR_SEGS, '#253547', 1);
    }

    c.clear(); calls++;
    /* Layered ambient radial watch dial background (glow/gradient simplification). */
    c.fillCircle(240, 240, 238, '#050910'); calls++;
    c.fillCircle(240, 240, 218, '#09111B'); calls++;
    c.fillCircle(240, 240, 178, '#0C1724'); calls++;
    c.circle(240, 240, 238, '#1B2838'); calls++;

    /* Retained 60 precision ticks (2 draw calls total). */
    c.drawPath(minorPathId, 0, 0); calls++;
    c.drawPath(majorPathId, 0, 0); calls++;

    /* Recessed track at r = 188. */
    c.arc(240, 240, 188, 0, 360, 14, '#16202E'); calls++;
    c.arc(240, 240, 188, 0, 360, 10, '#1F2C3D'); calls++;

    /* Active progress ring + round caps + crown dot. */
    var frac = isStop ? ((elap % 60000) / 60000) : remainFrac();
    var ringCol = '#40D8B0', haloCol = '#14423A';
    if (!isStop && cp === 'PAUSED') { ringCol = '#FFD78E'; haloCol = '#3F3420'; }
    else if (!isStop && cp === 'FINISHED') { ringCol = '#FF6B79'; haloCol = '#421C24'; }
    if (isStats) frac = 1;

    if (frac > 0.005) {
      var sweep = Math.max(2, Math.round(frac * 360));
      /* Layered outer glow approximation + crisp 10px main arc. */
      c.arc(240, 240, 188, -90, -90 + sweep, 14, haloCol); calls++;
      c.arc(240, 240, 188, -90, -90 + sweep, 10, ringCol); calls++;
      /* Round endcaps at 12 o'clock and progress tip. */
      var endRad = (-90 + frac * 360) * Math.PI / 180;
      var ex = Math.round(240 + Math.cos(endRad) * 188);
      var ey = Math.round(240 + Math.sin(endRad) * 188);
      c.fillCircle(240, 52, 5, ringCol); calls++;
      c.fillCircle(ex, ey, 5, ringCol); calls++;
      /* Glowing crown marker dot at progress tip (12 o'clock at 100%). */
      c.fillCircle(ex, ey, 7, ringCol); calls++;
      c.fillCircle(ex, ey, 4, '#F2F7FB'); calls++;
    } else if (!isStop && cp === 'FINISHED') {
      /* Subtle danger accent ring at 12 o'clock on FINISHED. */
      c.arc(240, 240, 188, 0, 360, 4, '#6A2833'); calls++;
      c.fillCircle(240, 52, 5, '#FF6B79'); calls++;
    }

    if (isStats) {
      /* Secondary STATS view inside dial. */
      c.text(204, 100, 'RECORDS', '#9EB3C6'); calls++;
      calls = drawPill(c, 114, 140, 252, 68, '#16202E', '#2A3B50', calls);
      c.text(136, 152, 'BEST TIMER', '#9EB3C6'); calls++;
      c.text(136, 174, fmtMin(tBest) + ' MIN', '#40D8B0'); calls++;
      calls = drawPill(c, 114, 220, 252, 68, '#16202E', '#2A3B50', calls);
      c.text(136, 232, 'BEST 3-LAP (<60S)', '#9EB3C6'); calls++;
      c.text(136, 254, fmtStop(sBest), '#FFD78E'); calls++;
      calls = drawPill(c, 166, 322, 148, 52, '#1F2C3D', '#5C7794', calls);
      c.text(219, 340, 'BACK', '#F2F7FB'); calls++;
      lastDrawCalls = calls;
      return;
    }

    /* Header eyebrow (tappable mode switch). */
    var hdr = isStop ? 'STOPWATCH' : 'COUNTDOWN';
    c.text(Math.round(240 - hdr.length * 4.5), 96, hdr, '#9EB3C6'); calls++;

    /* Status pill badge. */
    var phaseText = isStop ? sp : cp;
    var pillFill = '#102B2A', pillBorder = '#2A7A68', pillInk = '#40D8B0';
    if (phaseText === 'PAUSED') {
      pillFill = '#2D2516'; pillBorder = '#8F7642'; pillInk = '#FFD78E';
    } else if (phaseText === 'FINISHED') {
      pillFill = '#30161E'; pillBorder = '#A8424F'; pillInk = '#FF6B79';
    }
    var pillW = phaseText === 'FINISHED' ? 124 : (phaseText === 'RUNNING' ? 118 : 104);
    var pillX = Math.round(240 - pillW / 2);
    calls = drawPill(c, pillX, 144, pillW, 28, pillFill, pillBorder, calls);
    c.fillCircle(pillX + 18, 158, 3, pillInk); calls++;
    c.text(pillX + 29, 152, phaseText, pillInk); calls++;

    if (!isStop) {
      /* Center 48px monospace countdown time. */
      var showMs = cp === 'READY' ? mVal * 60000 : rem;
      var timeStr = cp === 'READY' ? fmtClock(showMs) : fmtClockCeil(showMs);
      calls = drawMonoTime(c, timeStr, 240, 236, 28, 46, 6, '#F2F7FB', calls);

      /* +/- circular steppers (active in READY, locked by default in RUNNING). */
      var showStep = (cp === 'READY' || cp === 'RUNNING');
      if (showStep) {
        var stepDim = (cp === 'RUNNING' && locked);
        var btnBg = stepDim ? '#121B27' : '#202E41';
        var btnBd = stepDim ? '#243347' : '#4C627A';
        var btnInk = stepDim ? '#4B627A' : '#F2F7FB';
        /* Minus circle at (108, 236) r = 24 */
        c.fillCircle(108, 236, 24, btnBd);
        c.fillCircle(108, 236, 23, btnBg);
        c.line(100, 236, 116, 236, btnInk, 3);
        calls += 3;
        /* Plus circle at (372, 236) r = 24 */
        c.fillCircle(372, 236, 24, btnBd);
        c.fillCircle(372, 236, 23, btnBg);
        c.line(364, 236, 380, 236, btnInk, 3);
        c.line(372, 228, 372, 244, btnInk, 3);
        calls += 4;
      }

      /* Preset / remaining / edit-lock caption. */
      if (cp === 'READY') {
        var preStr = fmtMin(mVal) + ' MIN PRESET';
        c.text(Math.round(240 - preStr.length * 4), 282, preStr, '#9EB3C6'); calls++;
      } else if (cp === 'RUNNING') {
        var capLabel = locked ? 'LOCKED - TAP EDIT' : 'UNLOCKED  +/-1M';
        var capFill = locked ? '#121C29' : '#13302E';
        var capBd = locked ? '#2B3C52' : '#40D8B0';
        var capInk = locked ? '#9EB3C6' : '#40D8B0';
        calls = drawPill(c, 152, 276, 176, 26, capFill, capBd, calls);
        c.text(Math.round(240 - capLabel.length * 4), 282, capLabel, capInk); calls++;
      } else if (cp === 'PAUSED') {
        var remStr = Math.round(frac * 100) + '% REMAINING';
        c.text(Math.round(240 - remStr.length * 4), 282, remStr, '#FFD78E'); calls++;
      } else {
        /* FINISHED: bell indicator + TIME UP */
        c.fillCircle(178, 288, 4, '#FF6B79');
        c.text(190, 281, 'TIME UP - BELL', '#FF6B79');
        calls += 2;
      }

      /* State-machine bottom CTA row (y = 322..374, h = 52). */
      if (cp === 'READY') {
        /* Subtle accent halo + bright accent CTA with dark #0D1420 ink (10.7:1). */
        calls = drawPill(c, 150, 320, 180, 56, '#133A34', null, calls);
        calls = drawPill(c, 152, 322, 176, 52, '#40D8B0', '#64ECC7', calls);
        /* Solid filled play triangle. */
        c.fillColor('#0D1420');
        c.fillRect(205, 342, 2, 12);
        c.fillRect(207, 343, 2, 10);
        c.fillRect(209, 344, 2, 8);
        c.fillRect(211, 345, 2, 6);
        c.fillRect(213, 346, 2, 4);
        c.fillRect(215, 347, 2, 2);
        c.text(224, 341, 'START', '#0D1420');
        calls += 7;
      } else if (cp === 'RUNNING') {
        calls = drawPill(c, 110, 322, 118, 52, '#213044', '#4C627A', calls);
        c.fillColor('#F2F7FB');
        c.fillRect(132, 341, 4, 14);
        c.fillRect(139, 341, 4, 14);
        c.text(151, 341, 'PAUSE', '#F2F7FB');
        calls += 3;
        calls = drawPill(c, 252, 322, 118, 52, '#2D151D', '#CC5362', calls);
        c.text(287, 341, 'RESET', '#FF6B79'); calls++;
      } else if (cp === 'PAUSED') {
        calls = drawPill(c, 110, 322, 118, 52, '#40D8B0', '#64ECC7', calls);
        c.text(138, 341, 'RESUME', '#0D1420'); calls++;
        calls = drawPill(c, 252, 322, 118, 52, '#2D151D', '#CC5362', calls);
        c.text(287, 341, 'RESET', '#FF6B79'); calls++;
      } else {
        /* FINISHED: RESTART + RESET */
        calls = drawPill(c, 110, 322, 118, 52, '#40D8B0', '#64ECC7', calls);
        c.text(134, 341, 'RESTART', '#0D1420'); calls++;
        calls = drawPill(c, 252, 322, 118, 52, '#2D151D', '#CC5362', calls);
        c.text(287, 341, 'RESET', '#FF6B79'); calls++;
      }
    } else {
      /* STOPWATCH face inside the same radial instrument dial. */
      calls = drawMonoTime(c, fmtStop(elap), 240, 212, 20, 34, 4, '#F2F7FB', calls);
      for (var li = 0; li < LAP_LIMIT; li++) {
        var lv = lapList[lapList.length - LAP_LIMIT + li];
        var lstr = lv === undefined ? ('LAP ' + (li + 1) + '  --:--.--') : ('LAP ' + (li + 1) + '  ' + fmtStop(lv));
        c.text(168, 246 + li * 22, lstr, li === LAP_LIMIT - 1 ? '#40D8B0' : '#9EB3C6');
        calls++;
      }
      if (sp === 'READY') {
        calls = drawPill(c, 152, 322, 176, 52, '#40D8B0', '#64ECC7', calls);
        c.text(215, 340, 'START', '#0D1420'); calls++;
      } else if (sp === 'RUNNING') {
        calls = drawPill(c, 102, 322, 86, 52, '#213044', '#4C627A', calls);
        c.text(122, 340, 'PAUSE', '#F2F7FB'); calls++;
        calls = drawPill(c, 197, 322, 86, 52, '#213044', '#4C627A', calls);
        c.text(226, 340, 'LAP', '#40D8B0'); calls++;
        calls = drawPill(c, 292, 322, 86, 52, '#2D151D', '#CC5362', calls);
        c.text(312, 340, 'RESET', '#FF6B79'); calls++;
      } else {
        calls = drawPill(c, 110, 322, 118, 52, '#40D8B0', '#64ECC7', calls);
        c.text(136, 340, 'RESUME', '#0D1420'); calls++;
        calls = drawPill(c, 252, 322, 118, 52, '#2D151D', '#CC5362', calls);
        c.text(286, 340, 'RESET', '#FF6B79'); calls++;
      }
    }

    lastDrawCalls = calls;
  } });

/* SafeArea container for all interactive hit targets (global [70..409]). */
var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480, children: [] });

/* Top mode toggle hit area (global x:170..310, y:78..126 -> local x:100, y:8). */
var modeSwitch = View({ parent: safe,
  style: { position: 'absolute', x: 100, y: 8, width: 140, height: 48, borderRadius: 999, scroll: 'none' },
  onPress: function () {
    if (showStats()) { showStats.set(false); return; }
    setMode(!mode());
  } });

/* Long-press top header toggles secondary STATS records view. */
var statsGestureOff = lume.gesture.on(modeSwitch, 'longpress', function () {
  showStats.set(!showStats());
});

/* Circular +/- stepper hit targets (global (84,212) and (348,212) -> 48x48). */
var btnMinus = View({ parent: safe,
  style: { position: 'absolute', x: 14, y: 142, width: 48, height: 48, borderRadius: 999, scroll: 'none' },
  onPress: function () { stepMinutes(-1); } });
var btnPlus = View({ parent: safe,
  style: { position: 'absolute', x: 278, y: 142, width: 48, height: 48, borderRadius: 999, scroll: 'none' },
  onPress: function () { stepMinutes(1); } });

/* Running edit-lock toggle hit zone (global x:152..328, y:265..313 -> 48px tall). */
var btnEditLock = View({ parent: safe,
  style: { position: 'absolute', x: 82, y: 195, width: 176, height: 48, borderRadius: 999, scroll: 'none' },
  onPress: function () { toggleEditLock(); } });

/* Countdown state-machine CTA hit targets (global y:322..374 -> local y:252). */
var btnStart = View({ parent: safe,
  style: { position: 'absolute', x: 82, y: 252, width: 176, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { cdStart(); } });
var btnPause = View({ parent: safe,
  style: { position: 'absolute', x: 40, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { cdPause(); } });
var btnResume = View({ parent: safe,
  style: { position: 'absolute', x: 40, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { cdResume(); } });
var btnReset = View({ parent: safe,
  style: { position: 'absolute', x: 182, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { cdReset(); } });
var btnRestart = View({ parent: safe,
  style: { position: 'absolute', x: 40, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { cdStart(); } });

/* Stopwatch CTA hit targets. */
var swBtnStart = View({ parent: safe,
  style: { position: 'absolute', x: 82, y: 252, width: 176, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swStart(); } });
var swBtnPause = View({ parent: safe,
  style: { position: 'absolute', x: 32, y: 252, width: 86, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swPause(); } });
var swBtnLap = View({ parent: safe,
  style: { position: 'absolute', x: 127, y: 252, width: 86, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swLap(); } });
var swBtnResume = View({ parent: safe,
  style: { position: 'absolute', x: 40, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swResume(); } });
var swBtnReset = View({ parent: safe,
  style: { position: 'absolute', x: 222, y: 252, width: 86, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swReset(); } });
var swBtnResetPaused = View({ parent: safe,
  style: { position: 'absolute', x: 182, y: 252, width: 118, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { swReset(); } });
var statsBtnBack = View({ parent: safe,
  style: { position: 'absolute', x: 96, y: 252, width: 148, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { showStats.set(false); } });

effect(function () {
  var isStop = mode(), isStats = showStats();
  var cp = cdPhase(), sp = swPhase();
  var inCd = !isStop && !isStats;
  var inSw = isStop && !isStats;
  lume.setAttr(btnMinus, 5, (inCd && (cp === 'READY' || cp === 'RUNNING')) ? 1 : 0);
  lume.setAttr(btnPlus, 5, (inCd && (cp === 'READY' || cp === 'RUNNING')) ? 1 : 0);
  lume.setAttr(btnEditLock, 5, (inCd && cp === 'RUNNING') ? 1 : 0);
  lume.setAttr(btnStart, 5, (inCd && cp === 'READY') ? 1 : 0);
  lume.setAttr(btnPause, 5, (inCd && cp === 'RUNNING') ? 1 : 0);
  lume.setAttr(btnResume, 5, (inCd && cp === 'PAUSED') ? 1 : 0);
  lume.setAttr(btnRestart, 5, (inCd && cp === 'FINISHED') ? 1 : 0);
  lume.setAttr(btnReset, 5, (inCd && (cp === 'RUNNING' || cp === 'PAUSED' || cp === 'FINISHED')) ? 1 : 0);

  lume.setAttr(swBtnStart, 5, (inSw && sp === 'READY') ? 1 : 0);
  lume.setAttr(swBtnPause, 5, (inSw && sp === 'RUNNING') ? 1 : 0);
  lume.setAttr(swBtnLap, 5, (inSw && sp === 'RUNNING') ? 1 : 0);
  lume.setAttr(swBtnReset, 5, (inSw && sp === 'RUNNING') ? 1 : 0);
  lume.setAttr(swBtnResume, 5, (inSw && sp === 'PAUSED') ? 1 : 0);
  lume.setAttr(swBtnResetPaused, 5, (inSw && sp === 'PAUSED') ? 1 : 0);
  lume.setAttr(statsBtnBack, 5, isStats ? 1 : 0);
});

function disposeGestures() {
  if (statsGestureOff) { statsGestureOff(); statsGestureOff = null; }
}

lume.app.onPause(function () { stopTicker(); });
lume.app.onResume(function () {
  if (!running()) return;
  if (mode()) swResume(); else cdResume();
});

globalThis.timerKit = {
  mode: mode, showStats: showStats, minutes: minutes, running: running, status: status,
  cdPhase: cdPhase, swPhase: swPhase, editLocked: editLocked,
  remainingMs: remainingMs, elapsedMs: elapsedMs, laps: laps,
  timerBest: timerBest, stopBest: stopBest,
  dialCanvas: dialCanvas, switchNode: modeSwitch,
  btnMinus: btnMinus, btnPlus: btnPlus, btnEditLock: btnEditLock,
  btnStart: btnStart, btnPause: btnPause, btnResume: btnResume,
  btnReset: btnReset, btnRestart: btnRestart,
  disposeGestures: disposeGestures,
  displayCdMs: displayCdMs, remainFrac: remainFrac,
  tick: tick, ring: ring, now: tkNow,
  cdStart: cdStart, cdPause: cdPause, cdResume: cdResume, cdReset: cdReset,
  toggleEditLock: toggleEditLock, stepMinutes: stepMinutes,
  swStart: swStart, swPause: swPause, swResume: swResume, swReset: swReset,
  swLap: swLap, swPrimary: swPrimary, primary: primary, reset: reset,
  setMode: setMode, setMinutes: setMinutes,
  kvLoad: kvLoad, kvSave: kvSave, fmtClock: fmtClock, fmtStop: fmtStop,
  getLastDrawCalls: function () { return lastDrawCalls; },
  KV_TIMER_BEST: KV_TIMER_BEST, KV_STOP_BEST: KV_STOP_BEST,
  LAP_LIMIT: LAP_LIMIT, DRILL_CAP_MS: DRILL_CAP_MS, TICK_MS: TICK_MS,
  CANVAS_W: CANVAS_W, CANVAS_H: CANVAS_H,
  CANVAS_BUDGET: CANVAS_BUDGET, FRAME_DRAW_BUDGET: FRAME_DRAW_BUDGET
};
lume.log('TIMER KIT READY');
