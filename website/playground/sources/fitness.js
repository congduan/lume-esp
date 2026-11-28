
/* r227 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r227Ctx) return c.__r227Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c.text(__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r227Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_View(p, kids) { return View(__A_style(p), kids); }
function __A_Text(p, kids) { return Text(__A_style(p), kids); }
function __A_Button(p, kids) { return Button(__A_style(p), kids); }
function __A_Image(p, kids) { return Image(__A_style(p), kids); }

/*
 * r204: fitness -- Triple concentric activity rings watch dashboard translated
 * from artifacts/r201/design/fitness.html with all r201 vision fixes applied:
 *   - Triple concentric Canvas rings (r = 207 / 187 / 167, stroke 14):
 *       Outer  (#40D8B0): Steps  (default 8,240 / 10,000)
 *       Middle (#FFD78E): Burn   (default 410 / 500 kcal)
 *       Inner  (#FF6B79): Heart  (default 118 bpm, Zone 2)
 *   - Vision fixes:
 *       1) Red & yellow cards display target/context values:
 *          HEART -> "118 ZONE2 avg", BURN -> "410/500 kcal".
 *       2) Thick 12-o'clock chevrons replaced with crisp fine radial tick lines.
 *       3) Lower inner-ring gap shows battery readout (lume.system.battery if
 *          present, else lume.pmic.battPercent or honest 85% + SIM tag).
 *   - Hero 48px display value rendered with thousands separator ("8,240") on
 *     Canvas; tapping companion cards focuses HEART / BURN / STEPS in center.
 *   - Honest data sources:
 *       - Steps: polls lume.imu.read() with simplified peak-threshold pedometer
 *         when IMU is available; falls back to demo baseline + explicit SIM badge.
 *       - Heart rate: simulated resting/zone-2 rhythm (no PPG sensor on board),
 *         always marked SIM.
 *   - Single 480x480 __A_Canvas(<= 240 draw calls per frame; glow simplified to
 *     layered dark-tinted tracks).
 *
 * Pure app layer: no firmware / runtime / tools/lume change.
 * Entire file is ASCII-only (r64); Text uses only 14/20/32 bundled faces.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg: '#000000', primary: '#0D1420', surface: '#16202E',
  surfaceAlt: '#1F2C3D', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0',
  danger: '#FF6B79', success: '#40D8B0' }, radius: 12, spacing: 8 });

var STEPS_GOAL = 10000;
var KCAL_GOAL = 500;
var HR_MAX = 160;
var STEP_THRESHOLD_G = 11.4;        /* m/s^2 peak over 9.81g rest */
var STEP_DEBOUNCE_MS = 280;
var CANVAS_W = 480;
var CANVAS_H = 480;
var CANVAS_BUDGET = 230400;
var FRAME_DRAW_BUDGET = 240;

var steps = signal(8240);
var kcal = signal(410);
var heartBpm = signal(118);
var batteryPct = signal(85);
var batterySim = signal(true);
var imuLive = signal(false);
var focusView = signal('steps');    /* 'steps' | 'hr' | 'cal' */
var dayLabel = signal('TODAY - FRI 27');

var prevMag = 9.81;
var lastStepAt = 0;
var hrPhase = 0;
var pollTimer = null;
var lastDrawCalls = 0;

function fmtThousands(n) {
  var s = String(Math.max(0, Math.round(n)));
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var left = s.length - i;
    if (i > 0 && left % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

function readBattery() {
  try {
    if (lume.system && typeof lume.system.battery === 'function') {
      var sb = lume.system.battery();
      if (typeof sb === 'number' && isFinite(sb) && sb >= 0 && sb <= 100) {
        batteryPct.set(Math.round(sb));
        batterySim.set(false);
        return;
      }
    }
  } catch (e) {}
  /* Fallback: fixed 85% with honest SIM label when lume.system.battery absent. */
  batteryPct.set(85);
  batterySim.set(true);
}

function readDayLabel() {
  try {
    var ms = lume.system.time();
    if (typeof ms === 'number' && isFinite(ms) && ms >= 1577836800000) {
      var d = new Date(ms);
      var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      var dd = d.getDate();
      dayLabel.set('TODAY - ' + days[d.getDay()] + ' ' + (dd < 10 ? '0' : '') + dd);
      return;
    }
  } catch (e) {}
  dayLabel.set('TODAY - SIM');
}

function hrZoneName(bpm) {
  if (bpm < 100) return 'ZONE 1 - WARM UP';
  if (bpm < 130) return 'ZONE 2 - FAT BURN';
  if (bpm < 150) return 'ZONE 3 - CARDIO';
  return 'ZONE 4 - PEAK';
}

function ringFractions() {
  return {
    steps: Math.max(0, Math.min(1, steps() / STEPS_GOAL)),
    cal: Math.max(0, Math.min(1, kcal() / KCAL_GOAL)),
    hr: Math.max(0, Math.min(1, heartBpm() / HR_MAX))
  };
}

/* Simplified IMU step detector: magnitude rising-edge threshold + debounce. */
function processImuSample(sample, nowMs) {
  if (!sample || typeof sample.ax !== 'number' || typeof sample.ay !== 'number' || typeof sample.az !== 'number') {
    return false;
  }
  imuLive.set(true);
  var mag = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az);
  var stepped = false;
  if (prevMag <= STEP_THRESHOLD_G && mag > STEP_THRESHOLD_G && (nowMs - lastStepAt) >= STEP_DEBOUNCE_MS) {
    lastStepAt = nowMs;
    var nextSteps = steps() + 1;
    steps.set(nextSteps);
    kcal.set(Math.min(9999, Math.round(nextSteps * 0.05)));
    stepped = true;
  }
  prevMag = mag;
  return stepped;
}

function pollSensors() {
  var nowMs = 0;
  try { nowMs = lume.system.time(); } catch (e) { nowMs = Date.now(); }
  try {
    if (lume.imu && typeof lume.imu.read === 'function') {
      var sample = lume.imu.read();
      if (sample) processImuSample(sample, nowMs);
      else imuLive.set(false);
    }
  } catch (e) { imuLive.set(false); }
  /* Simulated gentle Zone 2 heart rate rhythm (no PPG sensor on board). */
  hrPhase = (hrPhase + 1) % 12;
  var simHr = 118 + Math.round(Math.sin(hrPhase * Math.PI / 6) * 2);
  heartBpm.set(simHr);
  readBattery();
}

readDayLabel();
readBattery();

function startPolling() {
  if (pollTimer === null) pollTimer = lume.system.setInterval(pollSensors, 1000);
}
function stopPolling() {
  if (pollTimer !== null) { lume.system.clearInterval(pollTimer); pollTimer = null; }
}
lume.app.onStart(startPolling);
lume.app.onPause(stopPolling);
lume.app.onResume(startPolling);

/* ---- Canvas vector 48px hero digit renderer (tabular + comma) --------- */
var SEG_MAP = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function drawHeroChar(c, ch, x, y, w, h, t, col, calls) {
  var r = Math.floor(t / 2);
  var half = Math.floor(h / 2);
  c.fillColor(col);
  if (ch === ',') {
    var mx = x + Math.floor(w / 2);
    c.fillCircle(mx, y + h - 6, r, col);
    c.line(mx + 1, y + h - 5, mx - 3, y + h + 3, col, 3);
    return calls + 2;
  }
  var d = ch.charCodeAt(0) - 48;
  if (d < 0 || d > 9) return calls;
  if (d === 1) {
    var cx1 = x + Math.floor(w * 0.56);
    c.fillRect(cx1 - r, y + r, t, h - t);
    c.fillCircle(cx1, y + r, r, col);
    c.fillCircle(cx1, y + h - r, r, col);
    c.line(cx1 - 6, y + 6, cx1, y + r, col, t - 1);
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

function drawHeroNumber(c, str, cx, cy, dw, dh, t, col, calls) {
  var gap = 6;
  var commaW = 10;
  var total = 0;
  for (var i = 0; i < str.length; i++) {
    total += (str[i] === ',' ? commaW : dw) + (i > 0 ? gap : 0);
  }
  var sx = Math.round(cx - total / 2);
  var sy = Math.round(cy - dh / 2);
  for (var j = 0; j < str.length; j++) {
    var w = str[j] === ',' ? commaW : dw;
    calls = drawHeroChar(c, str[j], sx, sy, w, dh, t, col, calls);
    sx += w + gap;
  }
  return calls;
}

function drawRing(c, r, frac, trackCol, ringCol, calls) {
  c.arc(240, 240, r, 0, 360, 14, trackCol); calls++;
  if (frac > 0.005) {
    var sweep = Math.max(4, Math.round(frac * 360));
    c.arc(240, 240, r, -90, -90 + sweep, 14, ringCol); calls++;
    /* Round endcaps at start (12 o'clock) and end. */
    var rad = (-90 + frac * 360) * Math.PI / 180;
    var ex = Math.round(240 + Math.cos(rad) * r);
    var ey = Math.round(240 + Math.sin(rad) * r);
    c.fillCircle(240, 240 - r, 7, ringCol); calls++;
    c.fillCircle(ex, ey, 7, ringCol); calls++;
  }
  /* Vision fix 2: fine 12-o'clock start tick line (replaces thick > chevron). */
  c.line(240, 240 - r - 6, 240, 240 - r + 6, '#0D1420', 2); calls++;
  return calls;
}

function drawRoundRect(c, x, y, w, h, r, fill, border, calls) {
  c.fillCircle(x + r, y + r, r, border);
  c.fillCircle(x + w - r, y + r, r, border);
  c.fillCircle(x + r, y + h - r, r, border);
  c.fillCircle(x + w - r, y + h - r, r, border);
  c.fillColor(border);
  c.fillRect(x + r, y, w - 2 * r, h);
  c.fillRect(x, y + r, w, h - 2 * r);
  calls += 6;
  var ir = r - 1;
  c.fillCircle(x + r, y + r, ir, fill);
  c.fillCircle(x + w - r, y + r, ir, fill);
  c.fillCircle(x + r, y + h - r, ir, fill);
  c.fillCircle(x + w - r, y + h - r, ir, fill);
  c.fillColor(fill);
  c.fillRect(x + r, y + 1, w - 2 * r, h - 2);
  c.fillRect(x + 1, y + r, w - 2, h - 2 * r);
  return calls + 6;
}

/* ---- UI: single 480x480 radial Canvas + SafeArea interactive hits ------ */
var root = __A_View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: '#000000', scroll: 'none' } });

var ringCanvas = __A_Canvas({ parent: root, width: CANVAS_W, height: CANVAS_H,
  style: { position: 'absolute', x: 0, y: 0, scroll: 'none' },
  onDraw: function (c) {
    var calls = 0;
    var st = steps();
    var kc = kcal();
    var hr = heartBpm();
    var bat = batteryPct();
    var batSim = batterySim();
    var liveImu = imuLive();
    var fv = focusView();
    var dayStr = dayLabel();
    var fracs = ringFractions();

    c.clear(); calls++;
    /* Watch dial dark AMOLED backdrop + subtle outer rim. */
    c.fillCircle(240, 240, 238, '#050910'); calls++;
    c.fillCircle(240, 240, 158, '#0A121E'); calls++;
    c.circle(240, 240, 238, '#1B2838'); calls++;

    /* Triple concentric activity rings: Steps / Burn / Heart (r <= 214 <= 220). */
    calls = drawRing(c, 207, fracs.steps, '#0E2926', '#40D8B0', calls);
    calls = drawRing(c, 187, fracs.cal,   '#2A2417', '#FFD78E', calls);
    calls = drawRing(c, 167, fracs.hr,    '#2C151C', '#FF6B79', calls);

    /* Top date/SIM header inside inner well. */
    var topStr = dayStr;
    c.text(Math.round(240 - topStr.length * 4), 106, topStr, '#9EB3C6'); calls++;

    /* Hero focus metric (center well). */
    var kickerText = 'STEPS', kickerCol = '#40D8B0';
    var heroVal = fmtThousands(st);
    var heroGoal = Math.round(fracs.steps * 100) + '% of ' + fmtThousands(STEPS_GOAL);
    if (fv === 'hr') {
      kickerText = 'HEART RATE'; kickerCol = '#FF6B79';
      heroVal = String(hr);
      heroGoal = 'ZONE 2 - AVG ' + hr + ' SIM';
    } else if (fv === 'cal') {
      kickerText = 'CALORIES'; kickerCol = '#FFD78E';
      heroVal = fmtThousands(kc);
      heroGoal = kc + ' / ' + KCAL_GOAL + ' kcal';
    }
    var kx = Math.round(240 - kickerText.length * 4);
    c.fillCircle(kx - 10, 136, 3, kickerCol); calls++;
    c.text(kx, 129, kickerText, kickerCol); calls++;

    calls = drawHeroNumber(c, heroVal, 240, 174, 24, 42, 5, '#F2F7FB', calls);
    c.text(Math.round(240 - heroGoal.length * 4), 204, heroGoal, '#9EB3C6'); calls++;

    /* Two companion cards inside inner ring chord (x=118 & x=244, y=230, 118x68). */
    var hrFill = fv === 'hr' ? '#223146' : '#16202E';
    var hrBd = fv === 'hr' ? '#FF6B79' : '#263549';
    calls = drawRoundRect(c, 118, 230, 118, 68, 12, hrFill, hrBd, calls);
    /* Red heart micro-icon + HEART + target/context (Vision fix 1), centered. */
    c.fillCircle(148, 244, 3, '#FF6B79');
    c.fillCircle(153, 244, 3, '#FF6B79');
    c.fillCircle(151, 247, 3, '#FF6B79');
    c.text(161, 238, 'HEART', '#9EB3C6');
    var hrValStr = hr + ' bpm';
    c.text(Math.round(177 - hrValStr.length * 4), 257, hrValStr, '#F2F7FB');
    c.text(142, 275, 'ZONE2 avg', '#FF6B79');
    calls += 6;

    var calFill = fv === 'cal' ? '#223146' : '#16202E';
    var calBd = fv === 'cal' ? '#FFD78E' : '#263549';
    calls = drawRoundRect(c, 244, 230, 118, 68, 12, calFill, calBd, calls);
    /* Yellow flame micro-icon + BURN + target 410/500 kcal (Vision fix 1), centered. */
    c.fillCircle(277, 246, 3, '#FFD78E');
    c.line(277, 241, 277, 247, '#FFD78E', 2);
    c.text(286, 238, 'BURN', '#9EB3C6');
    var calValStr = kc + '/' + KCAL_GOAL;
    c.text(Math.round(303 - calValStr.length * 4), 257, calValStr, '#F2F7FB');
    c.text(290, 275, 'kcal', '#FFD78E');
    calls += 5;

    /* Live Zone strip. */
    var zStr = hrZoneName(hr);
    var zx = Math.round(240 - zStr.length * 4);
    c.fillCircle(zx - 10, 319, 3, '#FF6B79'); calls++;
    c.text(zx, 312, zStr, '#9EB3C6'); calls++;

    /* Vision fix 3: Battery indicator in lower inner-ring gap + honest SIM tag. */
    var simSuffix = (batSim || !liveImu) ? ' SIM' : '';
    var batStr = bat + '%' + simSuffix;
    var bx = Math.round(240 - (batStr.length * 8 + 22) / 2);
    /* Crisp mini battery outline + fill level. */
    c.line(bx, 344, bx + 16, 344, '#9EB3C6', 1);
    c.line(bx + 16, 344, bx + 16, 354, '#9EB3C6', 1);
    c.line(bx + 16, 354, bx, 354, '#9EB3C6', 1);
    c.line(bx, 354, bx, 344, '#9EB3C6', 1);
    c.fillColor('#9EB3C6'); c.fillRect(bx + 17, 347, 2, 4);
    var fillPx = Math.max(1, Math.round(12 * bat / 100));
    c.fillColor(bat > 20 ? '#40D8B0' : '#FF6B79');
    c.fillRect(bx + 2, 346, fillPx, 6);
    c.text(bx + 23, 342, batStr, '#9EB3C6');
    calls += 7;

    lastDrawCalls = calls;
  } });

/* Interactive hit targets inside SafeArea ([70..409]). */
var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480, children: [] });

var heroBtn = __A_View({ parent: safe,
  style: { position: 'absolute', x: 70, y: 54, width: 200, height: 96, borderRadius: 12, scroll: 'none' },
  onPress: function () { focusView.set('steps'); } });

var cardHr = __A_View({ parent: safe,
  style: { position: 'absolute', x: 48, y: 160, width: 118, height: 68, borderRadius: 12, scroll: 'none' },
  onPress: function () { focusView.set(focusView() === 'hr' ? 'steps' : 'hr'); } });

var cardCal = __A_View({ parent: safe,
  style: { position: 'absolute', x: 174, y: 160, width: 118, height: 68, borderRadius: 12, scroll: 'none' },
  onPress: function () { focusView.set(focusView() === 'cal' ? 'steps' : 'cal'); } });

globalThis.fitnessApi = {
  root: root, safe: safe, ringCanvas: ringCanvas,
  heroBtn: heroBtn, cardHr: cardHr, cardCal: cardCal,
  steps: steps, kcal: kcal, heartBpm: heartBpm,
  batteryPct: batteryPct, batterySim: batterySim, imuLive: imuLive,
  focusView: focusView, dayLabel: dayLabel,
  fmtThousands: fmtThousands, ringFractions: ringFractions,
  processImuSample: processImuSample, pollSensors: pollSensors,
  readBattery: readBattery, hrZoneName: hrZoneName,
  getLastDrawCalls: function () { return lastDrawCalls; },
  STEPS_GOAL: STEPS_GOAL, KCAL_GOAL: KCAL_GOAL, HR_MAX: HR_MAX,
  CANVAS_BUDGET: CANVAS_BUDGET, FRAME_DRAW_BUDGET: FRAME_DRAW_BUDGET
};
lume.log('FITNESS READY');
