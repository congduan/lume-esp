/* MINI GOLF - swing-to-hit putting on a watch.
 *
 * Two input modes, mirroring examples/compass/app.js:
 *   - demo (default, also auto-fallback on browser / emu where no IMU sample
 *     exists): drag on the green to set direction + power, press HIT to putt.
 *   - imu: read the QMI8658 (lume.imu.read(), m/s^2 - NOT g, see
 *     examples/gravity_ball/app.js:7), detect an acceleration peak above a
 *     threshold, take the horizontal swing vector as direction and the peak
 *     excess as power; one swing = one putt with a debounce.
 * No IMU sample -> demo fallback with a log line, as in compass.
 *
 * Physics is an intentionally simplified 2D green: Coulomb friction (constant
 * deceleration) + a per-level constant slope vector + wall/guard restitution.
 * Lessons are generated from the level index; no external art or tile maps.
 *
 * Rendering: the static layer (fairway border, guard rings, hole ring, hazard
 * borders) is uploaded ONCE per level as retained paths (retainSegments, one
 * path per level, <=240 segments each, <=8 paths total) and replayed from C.
 * Ball, aim line and hole centre redraw in a snapped dirty rect each frame
 * (gravity_ball precedent); first paint invalidates the whole 480x480 canvas.
 * Canvas budget: 480*480 = 230400 px = the whole budget, stated explicitly.
 * HUD strings are ASCII only (firmware font has no decorative glyphs, r64).
 * Record key 'hisc.golf' is 9 chars (NVS cap 15, lume_kv.c:42).
 */
var CW = 480, CH = 480;
var F = { left: 30, top: 64, right: 450, bottom: 424 };
var BALL_R = 8, HOLE_R = 16;
var FRICTION_DECEL = 150;       /* px/s^2, Coulomb (speed-independent) drag */
var RESTITUTION = 0.6, MAX_SPEED = 420;
var REST_SPEED = 8;             /* px/s: below this the ball is considered still */
var CAPTURE_SPEED = 140;        /* px/s: faster than this lips out over the cup */
var DT = 0.02;                  /* harness/engine physics step, seconds */
var SWING_THRESHOLD = 6;        /* m/s^2 horizontal magnitude (dead zone) */
var SWING_PEAK_MAX = 30;        /* m/s^2, near QMI8658 +/-4g full scale */
var SWING_WINDOW_MS = 160;      /* peak settle window */
var SWING_COOLDOWN_MS = 240;    /* one swing -> at most one putt */
var SHOT_MIN = 90, SHOT_MAX = 380;   /* px/s */
var SIGN_X = -1, SIGN_Y = 1;    /* board-tunable axis mapping (gravity_ball:8-10) */
var DRAG_FULL = 150;            /* px drag for full power in demo mode */
var POLL_MS = 50;               /* engine drain tick, 20 ms quantised */
var KV_BEST = 'hisc.golf';
var LEVEL_TAGS = ['OPEN PUTT', 'SLOPE', 'ONE GUARD', 'TWO GUARDS', 'BUNKERS', 'GAUNTLET'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mag2(x, y) { return Math.sqrt(x * x + y * y); }
function swingPower(peak) { return clamp((peak - SWING_THRESHOLD) / (SWING_PEAK_MAX - SWING_THRESHOLD), 0, 1); }
function dragPower(dist) { return clamp(dist / DRAG_FULL, 0, 1); }
function shotSpeed(frac) { return SHOT_MIN + clamp(frac, 0, 1) * (SHOT_MAX - SHOT_MIN); }

/* ---- deterministic procedural courses (no assets, no hand-copied maps) ---- */
var SLOPES = [[0, 0], [0, -16], [14, -20], [-18, -24], [22, -28], [-26, -32]];
var HOLES = [[240, 140], [240, 150], [188, 130], [300, 128], [158, 112], [318, 104]];
var GUARDS = [
  [],
  [],
  [[170, 252, 22]],
  [[178, 258, 24], [320, 226, 20]],
  [[166, 252, 22], [302, 242, 24], [240, 196, 18]],
  [[160, 268, 20], [326, 252, 22], [244, 196, 18], [206, 150, 16]]
];
var BUNKERS = [
  [], [], [], [],
  [[30, 210, 22, 150], [428, 210, 22, 150]],
  [[30, 200, 22, 170], [428, 200, 22, 170], [232, 64, 16, 30]]
];
function golfLevel(i) {
  var L = clamp(i | 0, 0, 5);
  var obs = [], g = GUARDS[L], k;
  for (k = 0; k < g.length; k++) obs.push({ x: g[k][0], y: g[k][1], r: g[k][2] });
  var haz = [], b = BUNKERS[L];
  for (k = 0; k < b.length; k++) haz.push({ x: b[k][0], y: b[k][1], w: b[k][2], h: b[k][3] });
  return {
    idx: L, name: LEVEL_TAGS[L], par: 1,
    slopeX: SLOPES[L][0], slopeY: SLOPES[L][1],
    tee: { x: 240, y: 380 }, hole: { x: HOLES[L][0], y: HOLES[L][1] },
    obstacles: obs, hazards: haz
  };
}
var LEVELS = [];
for (var _li = 0; _li < 6; _li++) LEVELS.push(golfLevel(_li));

function golfInHazard(level, x, y) {
  for (var i = 0; i < level.hazards.length; i++) {
    var h = level.hazards[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return true;
  }
  return false;
}
function golfRoundTotal(st) { return st.total + st.strokes + st.penalties; }

function golfState(li, total) {
  var idx = clamp(li | 0, 0, LEVELS.length - 1);
  var st = {
    li: idx, level: LEVELS[idx],
    ball: { x: 0, y: 0, vx: 0, vy: 0 }, restX: 0, restY: 0,
    strokes: 0, penalties: 0, total: total || 0, phase: 'ready',
    events: [], msg: '', event: ''
  };
  st.ball.x = st.restX = st.level.tee.x;
  st.ball.y = st.restY = st.level.tee.y;
  return st;
}
function golfAdvance(st) {
  if (st.li + 1 >= LEVELS.length) return null;
  return golfState(st.li + 1, golfRoundTotal(st));
}
function golfShoot(st, dx, dy, speed) {
  if (st.phase !== 'ready') return false;
  var d = mag2(dx, dy);
  if (d < 0.0001 || !(speed > 0)) return false;
  st.ball.vx = dx / d * speed; st.ball.vy = dy / d * speed;
  st.phase = 'rolling'; st.strokes++;
  st.events.push('SHOT L' + (st.li + 1) + ' strokes=' + st.strokes + ' speed=' + Math.round(speed));
  return true;
}
function golfPenalty(st) {
  st.penalties++;
  st.ball.x = st.restX; st.ball.y = st.restY; st.ball.vx = 0; st.ball.vy = 0;
  st.phase = 'ready';
  st.events.push('PENALTY L' + (st.li + 1) + ' count=' + st.penalties);
}
/* Integrate one frame. Updates st in place; pure with respect to device/UI. */
function golfStep(st, dt) {
  if (st.phase !== 'rolling') return st;
  var d = clamp(dt, 0, 0.1);
  var steps = Math.max(1, Math.ceil(d / 0.01));
  var h = d / steps;
  for (var n = 0; n < steps; n++) {
    var b = st.ball, L = st.level, i, o, ddx, ddy, dd, minD, nx, ny, dot;
    b.vx += L.slopeX * h; b.vy += L.slopeY * h;
    var sp = mag2(b.vx, b.vy), lose = FRICTION_DECEL * h;
    if (sp <= lose) { b.vx = 0; b.vy = 0; sp = 0; }
    else { b.vx *= (sp - lose) / sp; b.vy *= (sp - lose) / sp; sp -= lose; }
    if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; sp = MAX_SPEED; }
    b.x += b.vx * h; b.y += b.vy * h;
    /* fairway walls */
    if (b.x < F.left + BALL_R) { b.x = F.left + BALL_R; if (b.vx < 0) { b.vx *= -RESTITUTION; st.event = 'WALL'; } }
    if (b.x > F.right - BALL_R) { b.x = F.right - BALL_R; if (b.vx > 0) { b.vx *= -RESTITUTION; st.event = 'WALL'; } }
    if (b.y < F.top + BALL_R) { b.y = F.top + BALL_R; if (b.vy < 0) { b.vy *= -RESTITUTION; st.event = 'WALL'; } }
    if (b.y > F.bottom - BALL_R) { b.y = F.bottom - BALL_R; if (b.vy > 0) { b.vy *= -RESTITUTION; st.event = 'WALL'; } }
    /* circular guards: push out along normal, reflect normal component */
    for (i = 0; i < L.obstacles.length; i++) {
      o = L.obstacles[i]; ddx = b.x - o.x; ddy = b.y - o.y; dd = mag2(ddx, ddy);
      minD = o.r + BALL_R;
      if (dd < minD && dd > 0.0001) {
        nx = ddx / dd; ny = ddy / dd;
        b.x = o.x + nx * minD; b.y = o.y + ny * minD;
        dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= (1 + RESTITUTION) * dot * nx; b.vy -= (1 + RESTITUTION) * dot * ny; }
        st.event = 'GUARD';
      }
    }
    /* hazard or numeric escape: penalty, back to the last lie */
    if (golfInHazard(L, b.x, b.y) ||
        b.x < F.left - 1 || b.x > F.right + 1 || b.y < F.top - 1 || b.y > F.bottom + 1) {
      golfPenalty(st); return st;
    }
    /* cup capture (speed gate makes fast putts lip out) */
    ddx = b.x - L.hole.x; ddy = b.y - L.hole.y;
    if (mag2(ddx, ddy) <= HOLE_R && mag2(b.vx, b.vy) <= CAPTURE_SPEED) {
      st.phase = 'holed'; b.x = L.hole.x; b.y = L.hole.y; b.vx = 0; b.vy = 0;
      st.events.push('HOLE L' + (st.li + 1) + ' strokes=' + st.strokes); return st;
    }
    /* came to rest on the green: this is the next lie */
    if (mag2(b.vx, b.vy) < REST_SPEED) {
      st.phase = 'ready'; b.vx = 0; b.vy = 0; st.restX = b.x; st.restY = b.y;
      st.events.push('REST L' + (st.li + 1) + ' x=' + Math.round(b.x) + ' y=' + Math.round(b.y));
      return st;
    }
  }
  return st;
}

/* ---- hiscore: strictly fewer total strokes wins; NVS key 9 chars --------- */
function golfBest() {
  try { var n = lume.storage.kv.get(KV_BEST); return typeof n === 'number' && n >= 1 ? Math.floor(n) : 0; }
  catch (e) { return 0; }
}
function golfSaveBest(n) {
  try { var old = golfBest(); if (n >= 1 && (old === 0 || n < old)) lume.storage.kv.set(KV_BEST, n); }
  catch (e) { /* volatile record still works for this session */ }
  return n;
}

/* GAME UI */
var state = golfState(0);
var mode = 'demo';
var frame = signal(0), levelSig = signal(1), strokeSig = signal(0), parSig = signal(1);
var modeSig = signal('DEMO'), bestSig = signal(golfBest()), msgSig = signal('');
var aim = { dx: 0, dy: -1, power: 0.45, visible: false, dragging: false, lastBox: null };
var swing = { active: false, peak: 0, ax: 0, ay: 0, last: 0 };
var lastShotMs = -99999, pollTimer = null, ticks = 0;
var BG = '#0B1714', FAIR = '#184D3A', FAIR_EDGE = '#57C79A', GUARD_INK = '#C7623A';
var HOLE_INK = '#08100D', HOLE_RING = '#F2D56B', BALL_INK = '#F6F3E4';
var AIM_INK = '#F2D56B', HAZARD_INK = '#8A6A32';

var ROOT = View({ style: { width: CW, height: CH, background: BG, scroll: 'none' } }, []);
function issue(msg) { state.msg = msg; msgSig.set(msg); }
function publish() {
  levelSig.set(state.li + 1);
  strokeSig.set(state.strokes + state.penalties);
  parSig.set(state.level.par);
  modeSig.set(mode === 'imu' ? 'IMU' : 'DEMO');
  bestSig.set(golfBest());
  frame.set(frame() + 1);
}
function drainEvents() {
  while (state.events.length) {
    var e = state.events.shift();
    lume.log('GOLF ' + e);
    if (e.indexOf('HOLE ') === 0) {
      if (state.li + 1 === LEVELS.length) {
        var total = golfRoundTotal(state), b = golfSaveBest(total);
        issue('COURSE CLEAR  TOTAL ' + total + '  BEST ' + b);
      } else issue('HOLED IN ' + state.strokes + '  PRESS NEXT');
    } else if (e.indexOf('PENALTY ') === 0) issue('HAZARD  +1 STROKE  BALL RESET');
  }
}
function imuRead() {
  if (!lume.imu || typeof lume.imu.read !== 'function') return null;
  try { return lume.imu.read(); } catch (e) { return null; }
}
function setMode(next) {
  if (next === 'imu' && !imuRead()) {
    mode = 'demo'; modeSig.set('DEMO (no IMU)');
    lume.log('GOLF FALLBACK demo (no IMU sample)'); publish(); return;
  }
  mode = next === 'imu' ? 'imu' : 'demo';
  lume.log('GOLF MODE ' + mode); publish();
}
function fireShot(dx, dy, frac) {
  if (state.phase !== 'ready') return false;
  if (frac <= 0) return false;                 /* weak putt: never fires */
  var ok = golfShoot(state, dx, dy, shotSpeed(frac));
  if (ok) { lastShotMs = Date.now(); aim.visible = false; drainEvents(); publish(); }
  return ok;
}
function fireDemo() {
  if (mode !== 'demo') { lume.log('GOLF HIT ignored (swing the watch in IMU mode)'); return false; }
  if (!aim.visible) { issue('DRAG ON THE GREEN TO AIM'); return false; }
  return fireShot(aim.dx, aim.dy, aim.power);
}
/* Poll one IMU sample; a completed swing becomes one putt. */
function pollSwing() {
  var s = imuRead();
  if (!s) { setMode('demo'); return; }
  var ax = typeof s.ax === 'number' ? s.ax : 0;
  var ay = typeof s.ay === 'number' ? s.ay : 0;
  var m = mag2(ax, ay), now = Date.now();
  if (m > SWING_THRESHOLD) {
    if (!swing.active) { swing.active = true; swing.peak = m; swing.ax = ax; swing.ay = ay; }
    else if (m > swing.peak) { swing.peak = m; swing.ax = ax; swing.ay = ay; }
    swing.last = now;
    return;
  }
  if (!swing.active || now - swing.last < SWING_WINDOW_MS) return;
  var peak = swing.peak, sx = swing.ax, sy = swing.ay;
  swing.active = false; swing.peak = 0;
  var frac = swingPower(peak), len = mag2(sx, sy);
  if (frac <= 0 || len < 0.001) { lume.log('GOLF SWING too weak peak=' + peak.toFixed(1)); return; }
  if (now - lastShotMs < SWING_COOLDOWN_MS) return;
  var dx = sx * SIGN_X / len, dy = sy * SIGN_Y / len;
  if (fireShot(dx, dy, frac)) issue('SWING PUTT  POWER ' + Math.round(frac * 100));
}

/* ---- static layer: one retained path per level (<=8), built on first draw -- */
var STATIC_PATHS = [], staticReady = false, painted = false, prevBox = null;
function segmentForCircle(cx, cy, r, n) {
  var segs = [], i, a0, a1;
  for (i = 0; i < n; i++) {
    a0 = i * 2 * Math.PI / n; a1 = (i + 1) * 2 * Math.PI / n;
    segs.push([Math.round(cx + r * Math.cos(a0)), Math.round(cy + r * Math.sin(a0)),
               Math.round(cx + r * Math.cos(a1)), Math.round(cy + r * Math.sin(a1))]);
  }
  return segs;
}
function levelSegments(L) {
  var segs = [
    [F.left, F.top, F.right, F.top], [F.right, F.top, F.right, F.bottom],
    [F.right, F.bottom, F.left, F.bottom], [F.left, F.bottom, F.left, F.top]
  ], i, h;
  for (i = 0; i < L.obstacles.length; i++) {
    var o = L.obstacles[i];
    segs = segs.concat(segmentForCircle(o.x, o.y, o.r, 14));
  }
  segs = segs.concat(segmentForCircle(L.hole.x, L.hole.y, HOLE_R, 14));
  for (i = 0; i < L.hazards.length; i++) {
    h = L.hazards[i];
    segs.push([h.x, h.y, h.x + h.w, h.y], [h.x + h.w, h.y, h.x + h.w, h.y + h.h],
              [h.x + h.w, h.y + h.h, h.x, h.y + h.h], [h.x, h.y + h.h, h.x, h.y]);
  }
  return segs;                       /* worst case 4 + 4*14 + 14 + 3*4 = 78 <= 240 */
}
function buildStatic(ctx) {
  for (var i = 0; i < LEVELS.length; i++) STATIC_PATHS[i] = ctx.retainSegments(levelSegments(LEVELS[i]), FAIR_EDGE, 2);
  staticReady = true;
}
function boxOf(cx, cy, r) { return { x: cx - r - 1, y: cy - r - 1, w: 2 * r + 2, h: 2 * r + 2 }; }
function unionBox(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function fairwayClip(r) {
  var x = Math.max(r.x, F.left), y = Math.max(r.y, F.top);
  var x2 = Math.min(r.x + r.w, F.right), y2 = Math.min(r.y + r.h, F.bottom);
  return x2 > x && y2 > y ? { x: x, y: y, w: x2 - x, h: y2 - y } : null;
}
function snapBox(r) {
  var x = clamp(Math.round(r.x), 0, CW - 1), y = clamp(Math.round(r.y), 0, CH - 1);
  return { x: x, y: y, w: clamp(Math.round(r.x + r.w) - x, 1, CW - x),
           h: clamp(Math.round(r.y + r.h) - y, 1, CH - y) };
}
function aimEnd(bx, by) {
  var len = 18 + aim.power * 84;
  var ex = clamp(Math.round(bx + aim.dx * len), F.left + BALL_R + 1, F.right - BALL_R - 1);
  var ey = clamp(Math.round(by + aim.dy * len), F.top + BALL_R + 1, F.bottom - BALL_R - 1);
  return [ex, ey];
}
function aimBox(bx, by) {
  var e = aimEnd(bx, by);
  return { x: Math.min(bx, e[0]) - 2, y: Math.min(by, e[1]) - 2,
           w: Math.abs(e[0] - bx) + 5, h: Math.abs(e[1] - by) + 5 };
}

var scene = Canvas({ parent: ROOT, width: CW, height: CH, style: { position: 'absolute', x: 0, y: 0 },
  onDraw: function (ctx) {
    frame();
    var L = state.level, bx = Math.round(state.ball.x), by = Math.round(state.ball.y);
    var bb = boxOf(bx, by, BALL_R);
    if (!staticReady) buildStatic(ctx);
    if (!painted) {
      ctx.fillColor(BG); ctx.fillRect(0, 0, CW, CH);
      ctx.fillColor(FAIR); ctx.fillRect(F.left, F.top, F.right - F.left, F.bottom - F.top);
      ctx.drawPath(STATIC_PATHS[state.li]);
      ctx.fillCircle(L.hole.x, L.hole.y, HOLE_R, HOLE_INK);
      ctx.fillCircle(bx, by, BALL_R, BALL_INK);
      painted = true; prevBox = bb;
      return [{ x: 0, y: 0, w: CW, h: CH }];   /* first paint: whole canvas */
    }
    var area = unionBox(prevBox, bb);
    if (aim.visible) {
      var ab = aimBox(bx, by);
      area = unionBox(area, ab); aim.lastBox = ab;
    } else if (aim.lastBox) {
      area = unionBox(area, aim.lastBox); aim.lastBox = null;  /* erase old aim line */
    }
    area = unionBox(area, boxOf(L.hole.x, L.hole.y, HOLE_R));
    var clipped = fairwayClip(area);
    if (!clipped) { prevBox = bb; return []; }
    var a = snapBox(clipped);
    ctx.fillColor(FAIR); ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.drawPath(STATIC_PATHS[state.li]);    /* C replays the static green */
    ctx.fillCircle(L.hole.x, L.hole.y, HOLE_R, HOLE_INK);
    if (aim.visible) {
      var e = aimEnd(bx, by);
      ctx.line(bx, by, e[0], e[1], AIM_INK, 2);
    }
    ctx.fillCircle(bx, by, BALL_R, BALL_INK);
    prevBox = bb;
    return [a];
  } });

/* r202: HUD and all four controls moved into the 480-round safe square
   ([84,396]); course geometry, swing physics and KV keys are untouched. */
Text({ parent: ROOT, text: 'MINI GOLF', style: { position: 'absolute', x: 84, y: 80,
  width: 150, height: 20, fontSize: 14, color: '#40D8B0', borderRadius: 0 } });
Text({ parent: ROOT, text: function () { return 'L' + levelSig() + '/' + LEVELS.length + '  ' + state.level.name + '  ' + modeSig(); },
  style: { position: 'absolute', x: 250, y: 80, width: 146, height: 20, fontSize: 14,
    color: '#9EB3C6', textAlign: 'right', borderRadius: 0 } });
Text({ parent: ROOT, text: function () { return 'STROKES ' + strokeSig() + '  PAR ' + parSig() + '  BEST ' + bestSig(); },
  style: { position: 'absolute', x: 84, y: 104, width: 312, height: 20, fontSize: 14,
    color: '#F2F7FB', borderRadius: 0 } });
Text({ parent: ROOT, text: function () { return msgSig() || 'DRAG TO AIM THEN HIT  /  SWING IN IMU MODE'; },
  style: { position: 'absolute', x: 84, y: 126, width: 312, height: 20, fontSize: 13,
    color: '#FFD78E', borderRadius: 0 } });

function button(title, x, w, fn) {
  return Button({ parent: ROOT, title: title, onPress: fn,
    style: { position: 'absolute', x: x, y: 348, width: w, height: 48,
      background: '#1F2C3D', borderRadius: 8, fontSize: 14, color: '#F2F7FB' } });
}
button('MODE', 84, 72, function () { setMode(mode === 'demo' ? 'imu' : 'demo'); });
button('HIT', 164, 72, fireDemo);
button('RESET', 244, 72, function () {
  state = golfState(state.li, state.total); issue('HOLE RESET'); drainEvents(); publish();
});
button('NEXT', 324, 72, function () {
  var nx = golfAdvance(state);
  if (nx) { state = nx; painted = false; issue('HOLE ' + state.li + ' READY'); drainEvents(); publish(); }
  else issue('COURSE COMPLETE');
});

lume.gesture.on(scene, 'panstart', function (e) { aim.dragging = true; aimFrom(e.x, e.y); });
lume.gesture.on(scene, 'pan', function (e) { if (aim.dragging) aimFrom(e.x, e.y); });
lume.gesture.on(scene, 'panend', function () { aim.dragging = false; });
function aimFrom(x, y) {
  var dx = x - state.ball.x, dy = y - state.ball.y, d = mag2(dx, dy);
  if (d < 1) return;
  aim.dx = dx / d; aim.dy = dy / d; aim.power = dragPower(d); aim.visible = true;
  frame.set(frame() + 1);
}

function tick() {
  if (state.phase === 'rolling') {
    golfStep(state, DT); drainEvents(); publish();
  } else if (mode === 'imu') pollSwing();
  if (ticks++ % 20 === 0) lume.log('GOLF tick L' + (state.li + 1) + ' phase=' + state.phase + ' mode=' + mode);
}
function startTimer() { if (pollTimer === null) pollTimer = lume.system.setInterval(tick, POLL_MS); }
function stopTimer() { if (pollTimer !== null) { lume.system.clearInterval(pollTimer); pollTimer = null; } }
lume.app.onStart(startTimer);
lume.app.onPause(stopTimer);
lume.app.onResume(startTimer);
/* Host harness calls the global tick() directly; on device the timer drives it. */
lume.log('GOLF READY mode=demo imu=' + (imuRead() ? 'present' : 'absent') +
         ' levels=' + LEVELS.length + ' canvas=' + (CW * CH) + 'px key=' + KV_BEST);
updateBoot();
function updateBoot() { levelSig.set(1); strokeSig.set(0); parSig.set(1); msgSig.set(''); publish(); }
