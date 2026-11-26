/* Lume r94 - fluid particle sandbox. Pure app layer: no firmware/prelude/types
 * changes. A single 480x480 RGB565 canvas (230,400 px = the whole per-app
 * canvas budget, cf. examples/memory) holds 220 particles that drift under a
 * gravity vector and push each other apart via a cheap grid-neighbourhood
 * approximation (NOT a real SPH / fluid solver).
 *
 * Rendering: each particle is one small fillRect square with a precomputed
 * palette colour. No per-particle fillCircle / full-frame redraw. Between
 * frames we clear the union dirty box (old + new particle positions) with a
 * single fillRect and replay every particle: 1 + PN draw calls per frame,
 * well under the 250/frame harness budget.
 *
 * Input: lume.imu.read() returns m/s^2 (gravity ~9.81 on +Z at rest), NOT g.
 * Lateral gravity is mapped straight from ax/ay with a px/s^2 gain; shake
 * detection compares |a| against 9.80665 in m/s^2 (never a g threshold).
 * No board / no IMU -> demo mode with a slowly rotating gravity vector, the
 * same honest fallback pattern as examples/compass. Touch tap/swipe inject a
 * velocity field; a STIR button exposes the same path via onPress.
 *
 * Conservative global script: var / function only, no import/export.
 * All on-device text is ASCII (firmware font has no decorative glyphs). */

/* ---------- pure logic (host harness splits at /* GAME UI * /) ---------- */
var PW = 480, PH = 480;
var PN = 220;                       /* 200..300 particles; harness locks upper bound */
var PSTRIDE = 4;                    /* x, y, vx, vy interleaved in one Float32Array */
var PSIZE = 6;                      /* particle square edge in pixels */
var BG = '#080E1A';
var PAL = ['#3FD0C9', '#5AE0D0', '#2FA8C8', '#8FE8D8', '#267FBF', '#B7F0E4'];
var PCELL = 16, PGW = 30, PGH = 30; /* uniform grid: 480 / 16 = 30 */
var SEP = 11, SEP2 = SEP * SEP;     /* separation radius */
var DRAG = 1.5, MAX_SPEED = 260, WALL_REST = 0.45, STATIC_G = 2.0;
var GAIN = 18;                      /* px/s^2 per m/s^2 of measured acceleration */
var DEMO_TURN = 0.012;              /* demo gravity angle, radians per 50 ms tick */
var DT = 0.05;                      /* 20 Hz physics step (r83 emu budget) */

function pClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function pRnd(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }

/* Fresh state. Positions start as a dense central "drop" so gravity visibly
 * spreads them. head/next are preallocated and reused: no per-frame arrays. */
function particleState(seed) {
  var s = { seed: (seed >>> 0) || 1, p: new Float32Array(PN * PSTRIDE),
    ci: new Uint8Array(PN), head: new Int32Array(PGW * PGH),
    next: new Int32Array(PN), tick: 0 };
  var i;
  for (i = 0; i < PN; i++) {
    var col = i % 22, row = Math.floor(i / 22), o = i * PSTRIDE;
    s.p[o] = 120 + col * 11 + (pRnd(s) - 0.5) * 6;
    s.p[o + 1] = 140 + row * 18 + (pRnd(s) - 0.5) * 6;
    s.p[o + 2] = 0; s.p[o + 3] = 0;
    s.ci[i] = i % PAL.length;
  }
  return s;
}

/* Demo gravity: constant magnitude 9.81 m/s^2, direction rotating slowly. */
function gravityDemo(tick) {
  var a = tick * DEMO_TURN;
  return [9.81 * Math.cos(a), 9.81 * Math.sin(a)];
}

/* IMU sample (m/s^2) -> lateral gravity [ax, ay] or null on no sensor / a
 * near-zero vector (sensor not ready at emu boot, see examples/pet). */
function gravityFromImu(sample) {
  if (!sample || typeof sample.ax !== 'number' || typeof sample.ay !== 'number') return null;
  if (!isFinite(sample.ax) || !isFinite(sample.ay)) return null;
  if (sample.ax * sample.ax + sample.ay * sample.ay < 0.25) return null;
  return [sample.ax, sample.ay];
}

/* Magnitude deviation from stationary gravity, in m/s^2 (NOT g). */
function imuDeviation(sample) {
  if (!sample || typeof sample.ax !== 'number' || typeof sample.ay !== 'number' ||
      typeof sample.az !== 'number') return 0;
  var m = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az);
  return Math.abs(m - 9.80665);
}

/* One physics step. gx/gy are px/s^2. Separation is a capped positional
 * push (symmetric, 3x3 grid cells) - stable and cheap, no SPH pressure solve.
 * Then velocity damping, speed clamp, wall bounce and position integration. */
function particleStep(s, gx, gy, dt) {
  var p = s.p, i, o, c, j, q, cx, cy, nx, ny, gxx, gyy;
  s.head.fill(-1);
  for (i = 0; i < PN; i++) {
    o = i * PSTRIDE;
    cx = pClamp((p[o] / PCELL) | 0, 0, PGW - 1);
    cy = pClamp((p[o + 1] / PCELL) | 0, 0, PGH - 1);
    c = cy * PGW + cx;
    s.next[i] = s.head[c];
    s.head[c] = i;
  }
  for (i = 0; i < PN; i++) {
    o = i * PSTRIDE;
    var xi = p[o], yi = p[o + 1];
    cx = pClamp((xi / PCELL) | 0, 0, PGW - 1);
    cy = pClamp((yi / PCELL) | 0, 0, PGH - 1);
    for (gyy = cy - 1; gyy <= cy + 1; gyy++) {
      if (gyy < 0 || gyy >= PGH) continue;
      for (gxx = cx - 1; gxx <= cx + 1; gxx++) {
        if (gxx < 0 || gxx >= PGW) continue;
        j = s.head[gyy * PGW + gxx];
        while (j !== -1) {
          if (j > i) {
            q = j * PSTRIDE;
            var dx = xi - p[q], dy = yi - p[q + 1], d2 = dx * dx + dy * dy;
            if (d2 > 0.01 && d2 < SEP2) {
              var d = Math.sqrt(d2), push = (SEP - d) * 0.25 / d;
              if (push > 0.18) push = 0.18;
              xi += dx * push; yi += dy * push;
              p[q] -= dx * push; p[q + 1] -= dy * push;
            }
          }
          j = s.next[j];
        }
      }
    }
    p[o] = xi; p[o + 1] = yi;
  }
  var damp = Math.max(0, 1 - DRAG * dt);
  for (i = 0; i < PN; i++) {
    o = i * PSTRIDE;
    var vx = (p[o + 2] + gx * dt) * damp;
    var vy = (p[o + 3] + gy * dt) * damp;
    var sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > MAX_SPEED) { var k = MAX_SPEED / sp; vx *= k; vy *= k; }
    var x = p[o] + vx * dt, y = p[o + 1] + vy * dt;
    if (x < 0) { x = 0; vx = -vx * WALL_REST; }
    else if (x > PW - PSIZE) { x = PW - PSIZE; vx = -vx * WALL_REST; }
    if (y < 0) { y = 0; vy = -vy * WALL_REST; }
    else if (y > PH - PSIZE) { y = PH - PSIZE; vy = -vy * WALL_REST; }
    p[o] = x; p[o + 1] = y; p[o + 2] = vx; p[o + 3] = vy;
  }
  s.tick++;
  return s;
}

/* Inject a velocity field near (cx, cy): a directional component (swipe)
 * plus a radial burst (tap / shake). Returns the number of affected particles. */
function particlePerturb(s, cx, cy, dirX, dirY, radius) {
  var p = s.p, n = 0, i, o;
  if (!(radius > 0)) radius = 70;
  var r2 = radius * radius;
  for (i = 0; i < PN; i++) {
    o = i * PSTRIDE;
    var dx = p[o] - cx, dy = p[o + 1] - cy, d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    var d = Math.sqrt(d2), fall = 1 - d / radius;
    var rx = d > 0.001 ? dx / d : 1, ry = d > 0.001 ? dy / d : 0;
    p[o + 2] += (dirX * 0.9 + rx * 90) * fall;
    p[o + 3] += (dirY * 0.9 + ry * 90) * fall;
    n++;
  }
  return n;
}

/* GAME UI */
var pstate = particleState(9173);
var particleRoot = View({ style: { width: PW, height: PH, background: BG, scroll: 'none' } });
var pframe = signal(0), pMode = signal('DEMO'), pShake = signal(0);
var MODE_KEY = 'pt.mode';                 /* 7 chars <= NVS 15-char limit */
var pref = 'auto';
try { var savedMode = lume.storage.kv.get(MODE_KEY); if (savedMode === 'demo' || savedMode === 'auto') pref = savedMode; } catch (e) { /* volatile preference still works */ }
var imuMode = false, tickCount = 0, shakeArmed = true, shakeTicks = 0;
var paused = false, ptimer = null, painted = false, lastBox = null;
var perfCount = 0, perfSum = 0, perfMax = 0;

function pFullBox() { return { x: 0, y: 0, w: PW, h: PH }; }
function currentBox() {
  var minx = PW, miny = PH, maxx = 0, maxy = 0, p = pstate.p, i, o, x, y;
  for (i = 0; i < PN; i++) {
    o = i * PSTRIDE; x = p[o]; y = p[o + 1];
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (x + PSIZE > maxx) maxx = x + PSIZE;
    if (y + PSIZE > maxy) maxy = y + PSIZE;
  }
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}
function unionBox(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y };
}
/* Dirty rects must be integers fully inside the canvas (the handle validates). */
function snapBox(r) {
  var x = pClamp(Math.round(r.x), 0, PW - 1), y = pClamp(Math.round(r.y), 0, PH - 1);
  return { x: x, y: y, w: pClamp(Math.round(r.x + r.w) - x, 1, PW - x),
    h: pClamp(Math.round(r.y + r.h) - y, 1, PH - y) };
}

var scene = Canvas({ parent: particleRoot, width: PW, height: PH,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    pframe();
    var now = currentBox();
    /* Clear old+new union once, then replay every particle: PN+1 draw calls. */
    var area = painted ? snapBox(unionBox(lastBox, now)) : pFullBox();
    ctx.fillColor(BG); ctx.fillRect(area.x, area.y, area.w, area.h);
    var p = pstate.p;
    for (var i = 0; i < PN; i++) {
      var o = i * PSTRIDE;
      ctx.fillColor(PAL[pstate.ci[i]]);
      ctx.fillRect(Math.round(p[o]), Math.round(p[o + 1]), PSIZE, PSIZE);
    }
    painted = true; lastBox = now;
    return [area];
  } });

/* r202: HUD and both controls moved into the 480-round safe square
   ([84,396]); particle simulation and full-bleed canvas are unchanged. */
Text({ parent: particleRoot, text: 'FLUID PARTICLES',
  style: { position: 'absolute', x: 84, y: 80, width: 312, height: 28, fontSize: 20, color: '#F2F7FB', borderRadius: 0 } });
Text({ parent: particleRoot, text: function () { return pMode() + '  N=' + PN + (pShake() ? '  SHAKE' : ''); },
  style: { position: 'absolute', x: 84, y: 110, width: 312, height: 24, fontSize: 16, color: '#40D8B0', borderRadius: 0 } });
Text({ parent: particleRoot, text: 'TAP=BURST  SWIPE=STIR  SHAKE DEVICE',
  style: { position: 'absolute', x: 84, y: 134, width: 312, height: 22, fontSize: 13, color: '#9EB3C6', borderRadius: 0 } });
Button({ parent: particleRoot, title: 'STIR', onPress: function () { stirRandom(); },
  style: { position: 'absolute', x: 84, y: 348, width: 148, height: 48, background: '#1F2C3D', borderRadius: 8, fontSize: 16, color: '#F2F7FB' } });
Button({ parent: particleRoot, title: 'MODE', onPress: function () { cycleMode(); },
  style: { position: 'absolute', x: 240, y: 348, width: 148, height: 48, background: '#1F2C3D', borderRadius: 8, fontSize: 16, color: '#F2F7FB' } });

function stirRandom() {
  particlePerturb(pstate, PW / 2, PH / 2,
    (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, PH * 0.55);
  shakeTicks = 20; pShake.set(1); pframe.set(pframe() + 1);
}
function cycleMode() {
  pref = pref === 'auto' ? 'demo' : 'auto';
  try { lume.storage.kv.set(MODE_KEY, pref); } catch (e) { /* volatile preference still works */ }
  pMode.set(pref === 'demo' ? 'DEMO (forced)' : 'AUTO');
}

lume.gesture.on(particleRoot, 'tap', function (e) {
  particlePerturb(pstate, e.x, e.y, 0, 0, 70);
  pframe.set(pframe() + 1);
});
lume.gesture.on(particleRoot, 'swipe', function (e) {
  particlePerturb(pstate, e.x, e.y, (e.dx || 0) * 2.2, (e.dy || 0) * 2.2, 90);
  pframe.set(pframe() + 1);
});

function imuSample() {
  try { if (lume.imu && typeof lume.imu.read === 'function') return lume.imu.read(); } catch (e) { /* no IMU */ }
  return null;
}
function particleTick() {
  if (paused) return;
  var t0 = Date.now(), gx, gy, s = imuSample(), m = gravityFromImu(s);
  if (m && pref !== 'demo') {
    /* m/s^2 straight from the sensor: lateral tilt + small resting bias. */
    imuMode = true;
    gx = m[0] * GAIN; gy = m[1] * GAIN + STATIC_G * GAIN;
    var dev = imuDeviation(s);
    if (dev > 4 && shakeArmed) {
      shakeArmed = false;
      particlePerturb(pstate, PW / 2, PH / 2,
        (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, PH * 0.55);
      shakeTicks = 20;
    } else if (dev < 1.5) shakeArmed = true;
  } else {
    imuMode = false; shakeArmed = true;
    var g = gravityDemo(tickCount);
    gx = g[0] * GAIN; gy = g[1] * GAIN;
  }
  particleStep(pstate, gx, gy, DT);
  tickCount++;
  if (shakeTicks > 0 && --shakeTicks === 0) pShake.set(0);
  pMode.set(imuMode ? 'IMU' : (pref === 'demo' ? 'DEMO (forced)' : 'DEMO (no IMU)'));
  pframe.set(pframe() + 1);
  perfCount++; perfSum += Date.now() - t0; perfMax = Math.max(perfMax, Date.now() - t0);
  if (perfCount === 25) {
    lume.log('PARTICLES PERF js_avg_ms=' + (perfSum / 25).toFixed(2) + ' js_max_ms=' + perfMax);
    perfCount = 0; perfSum = 0; perfMax = 0;
  }
}
function startTimer() { if (ptimer === null) ptimer = lume.system.setInterval(particleTick, 50); }
function stopTimer() { if (ptimer !== null) lume.system.clearInterval(ptimer); ptimer = null; }

lume.app.onStart(function () { startTimer(); });
lume.app.onPause(function () { paused = true; stopTimer(); });
lume.app.onResume(function () { paused = false; startTimer(); });
lume.log('PARTICLES READY n=' + PN + ' mode=' + pref + ' imu=' + (imuSample() ? 'present' : 'absent'));
pMode.set(pref === 'demo' ? 'DEMO (forced)' : 'DEMO (no IMU)');
startTimer();
