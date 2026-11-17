/* Golf — r79, swing mini golf, procedically generated 10-hole course.
 * 2D top-down course on one 480x420 canvas (201,600 px, under the 230,400
 * budget; HUD is native Text nodes, never canvas pixels). Terrain: rough /
 * fairway / green / sand / water; friction per terrain, constant slope
 * acceleration on later holes. Deterministic seeded generation (mulberry32)
 * so the host harness can replay and SOLVE every hole (BFS over shot grid).
 *
 * Input: tap aims (direction to the tap point; distance maps to power).
 * IMU mode (QMI8658 present): swing peak acceleration fires the shot —
 *   stronger swing, harder strike. No IMU (browser esp32sim) falls back to
 *   DEMO mode where the tap also strikes (compass fallback precedent).
 *   The mode badge says which one is live.
 * Water: stroke +1 penalty, ball back to the pre-shot spot. Hole capture
 * needs the ball to arrive slow enough (CAPTURE), else it rolls over.
 * Best 10-hole total goes to lume.storage.kv — NVS keys cap at 15 chars
 * (lume_kv.c), so the key is 'hisc.golf' (9 chars). UI text is ASCII only
 * (firmware font has no decorative Unicode — r64). */

/* ------------------- logic (host harness splits at the GAME UI marker) -- */
var COURSE_W = 480, COURSE_H = 420;
var BALL_R = 7, HOLE_R = 10, CAPTURE = 150;   /* px, px, px/s */
var STOP = 8;                                  /* px/s below which the ball rests */
var DT = 1 / 60, MAX_STEPS = 900;              /* physics substep, bail-out */
var SAMPLE_EVERY = 3;                          /* anim path samples (20 fps) */
var FRICTION = { green: 70, fairway: 120, rough: 210 }; /* px/s^2, linear */
var SAND_DRAG = 14;                            /* 1/s, exponential: traps hard */
var POWER_MIN = 80, POWER_MAX = 480;           /* px/s launch speed */
var SWING_MIN = 12, SWING_MAX = 35;            /* m/s^2 peak -> power ramp */
var SEED = 20261117;
var LEVELS = 10;

/* Seeded PRNG (mulberry32): deterministic courses across host and device. */
function mulberry32(seed) {
  var t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function rectsHit(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function ptInRect(x, y, r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

/* One 480x420 course per level. Fairway is a bent two-band corridor from tee
 * to green; water/sand rects are rejected if they cover tee or green. Slope
 * (constant accel) kicks in from hole 5. Par from tee->hole distance. */
function genLevel(i, rnd) {
  var start = { x: 40 + rnd() * 40, y: 60 + rnd() * 300 };
  var hole = { x: 360 + rnd() * 80, y: 60 + rnd() * 300 };
  var green = { x: clamp(hole.x - 38, 0, COURSE_W - 76), y: clamp(hole.y - 38, 0, COURSE_H - 76), w: 76, h: 76 };
  var midX = (start.x + hole.x) / 2;
  var midY = start.y + (hole.y - start.y) * (0.3 + rnd() * 0.4);
  function band(ax, ay, bx, by) {
    var x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
    var y1 = Math.min(ay, by) - 32, y2 = Math.max(ay, by) + 32;
    return { x: clamp(x1 - 8, 0, COURSE_W), y: clamp(y1, 0, COURSE_H),
             w: clamp(x2 + 8, 0, COURSE_W) - clamp(x1 - 8, 0, COURSE_W),
             h: clamp(y2, 0, COURSE_H) - clamp(y1, 0, COURSE_H) };
  }
  var fairway = [band(start.x, start.y, midX, midY), band(midX, midY, hole.x, hole.y)];
  var safe = { x: start.x - 20, y: start.y - 20, w: 40, h: 40 };
  function place(w, h, tries) {
    for (var k = 0; k < tries; k++) {
      var r = { x: 20 + rnd() * (COURSE_W - 40 - w), y: 20 + rnd() * (COURSE_H - 40 - h), w: w, h: h };
      if (rectsHit(r, safe) || rectsHit(r, green)) continue;
      return r;
    }
    return null;
  }
  var water = [], sand = [];
  if (i >= 2) { var r = place(80, 56, 24); if (r) water.push(r); }
  if (i >= 6) { var r2 = place(70, 48, 24); if (r2 && !rectsHit(r2, water[0])) water.push(r2); }
  if (i >= 1) { var r3 = place(64, 44, 24); if (r3) sand.push(r3); }
  if (i >= 6) { var r4 = place(56, 40, 24); if (r4 && !rectsHit(r4, water[0] || r4)) sand.push(r4); }
  var slope = { ax: 0, ay: 0 };
  if (i >= 4) {
    var picks = [-16, -8, 8, 16];
    slope.ax = picks[Math.floor(rnd() * picks.length)];
    slope.ay = picks[Math.floor(rnd() * picks.length)];
  }
  var d = dist(start.x, start.y, hole.x, hole.y);
  var par = 2 + Math.min(2, Math.floor(d / 180));
  return { idx: i, start: start, hole: hole, green: green, fairway: fairway,
           water: water, sand: sand, slope: slope, par: par, dist: d };
}

/* Deterministic 10-hole course set. */
function golfLevels() {
  var rnd = mulberry32(SEED), out = [];
  for (var i = 0; i < LEVELS; i++) out.push(genLevel(i, rnd));
  return out;
}

function terrainAt(l, x, y) {
  for (var i = 0; i < l.water.length; i++) if (ptInRect(x, y, l.water[i])) return 'water';
  for (i = 0; i < l.sand.length; i++) if (ptInRect(x, y, l.sand[i])) return 'sand';
  if (ptInRect(x, y, l.green)) return 'green';
  for (i = 0; i < l.fairway.length; i++) if (ptInRect(x, y, l.fairway[i])) return 'fairway';
  return 'rough';
}

/* Simulate one strike: launch at `angle` rad with `power` px/s, fixed-dt
 * substeps, per-terrain friction, constant slope accel, walls at the course
 * edge. Water splashes on entry (handled by the caller as stroke+1 and reset).
 * Hole capture only when the ball arrives under CAPTURE speed. Returns the
 * end position, a sampled animation path and the result. Pure: no device/UI. */
function golfShot(l, x, y, angle, power) {
  var vx = Math.cos(angle) * power, vy = Math.sin(angle) * power;
  var px = x, py = y, path = [[x, y]], result = 'rolled', n, t, sp, ns, dh;
  for (n = 0; n < MAX_STEPS; n++) {
    t = terrainAt(l, px, py);
    sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > 0) {
      if (t === 'sand') {
        /* exponential drag: a bunker eats speed proportional to it, so even a
         * full-power strike stops inside a ~60px trap (linear friction lets
         * 400 px/s fly 260+ px — measured, see tests/golf.js case 4). */
        var damp = Math.exp(-SAND_DRAG * DT);
        vx *= damp; vy *= damp;
      } else {
        ns = Math.max(0, sp - FRICTION[t] * DT); vx *= ns / sp; vy *= ns / sp;
      }
    }
    vx += l.slope.ax * DT; vy += l.slope.ay * DT;
    px += vx * DT; py += vy * DT;
    if (px < 8) { px = 8; vx = 0; }
    if (px > COURSE_W - 8) { px = COURSE_W - 8; vx = 0; }
    if (py < 8) { py = 8; vy = 0; }
    if (py > COURSE_H - 8) { py = COURSE_H - 8; vy = 0; }
    if (terrainAt(l, px, py) === 'water') { result = 'water'; break; }
    dh = dist(px, py, l.hole.x, l.hole.y);
    if (dh < HOLE_R && Math.sqrt(vx * vx + vy * vy) < CAPTURE) {
      px = l.hole.x; py = l.hole.y; result = 'holed'; break;
    }
    /* STOP acts as static friction: the ball rests even on a slope (the
     * slope magnitudes are far below every FRICTION tier, so rolling speed
     * always decays; resting drift is out of scope for this game). */
    if (Math.sqrt(vx * vx + vy * vy) < STOP) break;
    if (n % SAMPLE_EVERY === 0) path.push([px, py]);
  }
  path.push([px, py]);
  return { x: px, y: py, path: path, result: result };
}

/* Swing peak (m/s^2) -> launch power, clamped to [POWER_MIN, POWER_MAX]. */
function swingPower(peak) {
  return clamp(POWER_MIN + (peak - SWING_MIN) * (POWER_MAX - POWER_MIN) / (SWING_MAX - SWING_MIN),
               POWER_MIN, POWER_MAX);
}

/* ------------------- round state machine (pure) -------------------------- */
function golfHoleState(l) {
  return { l: l, ball: { x: l.start.x, y: l.start.y }, prev: { x: l.start.x, y: l.start.y },
           strokes: 0, holed: false, splash: false };
}
function golfNewRound(levels) {
  return { levels: levels, holeIdx: 0, total: 0, done: false, lastScore: '',
           s: golfHoleState(levels[0]), rolling: null, aim: { angle: 0, power: POWER_MIN } };
}
/* Aim at a course-space point: direction to it, distance IS the power. */
function golfAim(state, tx, ty) {
  var b = state.s.ball;
  var d = dist(tx, ty, b.x, b.y);
  state.aim.angle = Math.atan2(ty - b.y, tx - b.x);
  state.aim.power = clamp(d, POWER_MIN, POWER_MAX);
  return state.aim;
}
/* Commit a strike: stroke count, remember the pre-shot spot (water reset). */
function golfStrike(state, angle, power) {
  var s = state.s;
  if (s.holed || state.done || state.rolling) return null;
  s.strokes++; s.prev = { x: s.ball.x, y: s.ball.y }; s.splash = false;
  var shot = golfShot(s.l, s.ball.x, s.ball.y, angle, power);
  state.rolling = { path: shot.path, i: 0, result: shot.result };
  s.ball = { x: shot.path[0][0], y: shot.path[0][1] };
  return shot;
}
/* Advance the roll animation one sample. Returns 'rolling'|'resolved'|'idle'. */
function golfAnimTick(state) {
  if (!state.rolling) return 'idle';
  var r = state.rolling, s = state.s;
  if (r.i < r.path.length - 1) {
    r.i++;
    s.ball = { x: r.path[r.i][0], y: r.path[r.i][1] };
    return 'rolling';
  }
  if (r.result === 'holed') { s.holed = true; s.ball = { x: s.l.hole.x, y: s.l.hole.y }; }
  else if (r.result === 'water') { s.splash = true; s.strokes++; s.ball = { x: s.prev.x, y: s.prev.y }; }
  state.rolling = null;
  return 'resolved';
}
function scoreName(strokes, par) {
  var d = strokes - par;
  if (d <= -3) return 'ALBATROSS';
  if (d === -2) return 'EAGLE';
  if (d === -1) return 'BIRDIE';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE';
  return '+' + d;
}
/* Leave the finished hole; counts the total, ends the round after 10. */
function golfNextHole(state, saveBest) {
  var s = state.s;
  if (!s.holed) return 'not-holed';
  state.total += s.strokes;
  state.lastScore = scoreName(s.strokes, s.l.par);
  state.holeIdx++;
  if (state.holeIdx >= LEVELS) {
    state.done = true;
    if (typeof saveBest === 'function') saveBest(state.total);
    return 'round-over';
  }
  state.s = golfHoleState(state.levels[state.holeIdx]);
  state.rolling = null;
  return 'next';
}

/* GAME UI */
var PAL = {
  rough: '#1E2B1E', fairway: '#2E4A2A', green: '#3A6B35',
  sand: '#A89A6A', water: '#2A4A66', hole: '#101410',
  ball: '#F2E7C9', aim: '#E8D46A', flag: '#D94F3D', splash: '#9FD8F0'
};
var LEVELS_CACHE = golfLevels();

/* kv best (lowest total); try/catch so a volatile best still works. */
function golfBest() { try { var n = lume.storage.kv.get('hisc.golf');
  return typeof n === 'number' && n > 0 ? n : 0; } catch (e) { return 0; } }
function golfSaveBest(t) { try { var old = golfBest();
  if (old === 0 || t < old) { lume.storage.kv.set('hisc.golf', t); return t; } } catch (e) {}
  return golfBest(); }

var state = golfNewRound(LEVELS_CACHE);
var frame = signal(0), hudSig = signal(''), noteSig = signal(''), bestSig = signal(0), modeSig = signal('');
var root = View({ style: { width: 480, height: 480, background: '#141018', scroll: 'none' } });
function logEvent(msg) { lume.log('GOLF ' + msg); }

function hudText() {
  var s = state.s, l = s.l;
  return 'H' + (state.holeIdx + 1) + '/' + LEVELS + ' PAR ' + l.par + '  ST ' + s.strokes + '  TOT ' + state.total;
}
function noteText() {
  if (state.done) return 'ROUND ' + state.total + ' STROKES! TAP NEW ROUND';
  if (state.s.holed) return state.lastScore + '! TAP NEXT HOLE';
  if (state.s.splash) return 'WATER +1 PENALTY';
  if (state.rolling) return '...';
  return mode === 'imu' ? 'TAP AIM - SWING TO HIT' : 'TAP TO AIM AND HIT';
}
function sync() { hudSig.set(hudText()); noteSig.set(noteText()); frame.set(frame() + 1); }

/* ---- mode detection: IMU if the sensor answers, else honest DEMO --------- */
function imuRead() {
  if (!lume.imu || typeof lume.imu.read !== 'function') return null;
  try { return lume.imu.read(); } catch (e) { return null; }
}
var mode = imuRead() ? 'imu' : 'demo';

/* ---- canvas: terrain layer + ball + aim dots --------------------------- */
/* All canvas coords must be integers (prelude __canvasInt rejects fractions),
 * so every rect helper floors here — terrain rects and ball positions are
 * floats straight from the generator/physics. */
function box(x, y, w, h) {
  var x0 = Math.floor(x), y0 = Math.floor(y);
  var x1 = Math.floor(x + w), y1 = Math.floor(y + h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
function clipRect(r, a) {
  var x = Math.max(r.x, a.x), y = Math.max(r.y, a.y);
  var x2 = Math.min(r.x + r.w, a.x + a.w), y2 = Math.min(r.y + r.h, a.y + a.h);
  return x2 > x && y2 > y ? box(x, y, x2 - x, y2 - y) : null;
}
function drawRectClip(ctx, color, r, a) {
  var c = clipRect(r, a);
  if (c) { ctx.fillColor(color); ctx.fillRect(c.x, c.y, c.w, c.h); }
}
var BALL_SPANS = [];
for (var sy = -BALL_R; sy <= BALL_R; sy++) {
  BALL_SPANS.push([sy, Math.floor(Math.sqrt(BALL_R * BALL_R - sy * sy))]);
}
function disc(ctx, cx, cy, r, color, spans, a) {
  cx = Math.round(cx); cy = Math.round(cy);
  for (var i = 0; i < spans.length; i++) {
    var yy = cy + spans[i][0];
    if (yy < a.y || yy >= a.y + a.h) continue;
    var x1 = cx - spans[i][1], x2 = cx + spans[i][1] + 1;
    var cx1 = Math.max(x1, a.x), cx2 = Math.min(x2, a.x + a.w);
    if (cx2 > cx1) { ctx.fillColor(color); ctx.fillRect(cx1, yy, cx2 - cx1, 1); }
  }
}
function drawTerrain(ctx, l, a) {
  drawRectClip(ctx, PAL.rough, box(0, 0, COURSE_W, COURSE_H), a);
  for (var i = 0; i < l.fairway.length; i++) drawRectClip(ctx, PAL.fairway, l.fairway[i], a);
  drawRectClip(ctx, PAL.green, l.green, a);
  for (i = 0; i < l.sand.length; i++) drawRectClip(ctx, PAL.sand, l.sand[i], a);
  for (i = 0; i < l.water.length; i++) drawRectClip(ctx, PAL.water, l.water[i], a);
  ctx.fillColor(PAL.hole); ctx.fillRect(Math.round(l.hole.x) - HOLE_R, Math.round(l.hole.y) - HOLE_R, HOLE_R * 2, HOLE_R * 2);
  var hx = Math.round(l.hole.x), hy = Math.round(l.hole.y);
  ctx.fillColor(PAL.flag);
  ctx.fillRect(hx + 2, hy - HOLE_R - 16, 2, 16);       /* pole */
  ctx.fillRect(hx + 4, hy - HOLE_R - 16, 12, 7);       /* flag */
}
var AIM_STEP = 16, AIM_DOT = 3;
function aimLen(power) { return 30 + power * 0.25; }
function aimDots(state) {
  var pts = [], n = 3 + Math.floor(state.aim.power / 80), len = aimLen(state.aim.power);
  for (var k = 1; k <= n; k++) {
    var t = (len * k) / n;
    pts.push([state.s.ball.x + Math.cos(state.aim.angle) * t,
              state.s.ball.y + Math.sin(state.aim.angle) * t]);
  }
  return pts;
}
function ballBox(state) { return box(state.s.ball.x - BALL_R - 2, state.s.ball.y - BALL_R - 2, 2 * BALL_R + 4, 2 * BALL_R + 4); }
function aimBox(state) {
  var len = aimLen(state.aim.power) + AIM_DOT + 2;
  var cx = state.s.ball.x + Math.cos(state.aim.angle) * len / 2;
  var cy = state.s.ball.y + Math.sin(state.aim.angle) * len / 2;
  return box(cx - len / 2 - 2, cy - len / 2 - 2, len + 4, len + 4);
}
function unionBox(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return box(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
}
function snapBox(r) {
  var x = clamp(Math.round(r.x), 0, COURSE_W - 1), y = clamp(Math.round(r.y), 0, COURSE_H - 1);
  return { x: x, y: y, w: clamp(Math.round(r.x + r.w) - x, 1, COURSE_W - x),
           h: clamp(Math.round(r.y + r.h) - y, 1, COURSE_H - y) };
}
var CANVAS_X = 0, CANVAS_Y = 60;
var painted = false, prevBox = null;
var scene = Canvas({ parent: root, width: COURSE_W, height: COURSE_H,
  style: { position: 'absolute', x: CANVAS_X, y: CANVAS_Y },
  onDraw: function (ctx) {
    frame();
    var l = state.s.l;
    var aiming = !state.rolling && !state.s.holed && !state.done;
    var a = !painted ? box(0, 0, COURSE_W, COURSE_H)
                     : snapBox(unionBox(prevBox, unionBox(ballBox(state), aiming ? aimBox(state) : ballBox(state))));
    drawTerrain(ctx, l, a);
    if (aiming) {
      var dots = aimDots(state);
      for (var i = 0; i < dots.length; i++) {
        var c = clipRect(box(dots[i][0] - AIM_DOT, dots[i][1] - AIM_DOT, AIM_DOT * 2, AIM_DOT * 2), a);
        if (c) { ctx.fillColor(PAL.aim); ctx.fillRect(c.x, c.y, c.w, c.h); }
      }
    }
    if (state.s.splash) disc(ctx, state.s.ball.x, state.s.ball.y, BALL_R + 2, PAL.splash, BALL_SPANS, a);
    disc(ctx, state.s.ball.x, state.s.ball.y, BALL_R, PAL.ball, BALL_SPANS, a);
    prevBox = unionBox(ballBox(state), aiming ? aimBox(state) : ballBox(state));
    painted = true;
    return [a];
  } });

/* HUD is native Text nodes above the canvas: zero canvas-pixel cost. */
Text({ parent: root, text: 'GOLF', style: { position: 'absolute', x: 8, y: 4, fontSize: 16, color: '#F2E7C9' } });
Text({ parent: root, text: function () { return hudSig() || hudText(); },
  style: { position: 'absolute', x: 70, y: 6, width: 260, height: 20, fontSize: 14, color: '#D9A21B' } });
Text({ parent: root, text: function () { return modeSig() || mode.toUpperCase(); },
  style: { position: 'absolute', x: 340, y: 6, width: 132, height: 20, fontSize: 14, color: '#9FD8F0', textAlign: 'right' } });
Text({ parent: root, text: function () { return noteSig() || noteText(); },
  style: { position: 'absolute', x: 8, y: 28, width: 464, height: 20, fontSize: 13, color: '#8CDA4A' } });
Text({ parent: root, text: function () { return bestSig() > 0 ? 'BEST ' + bestSig() : 'BEST -'; },
  style: { position: 'absolute', x: 340, y: 28, width: 132, height: 20, fontSize: 13, color: '#7A8F4E', textAlign: 'right' } });

/* ---- input -------------------------------------------------------------- */
function coursePoint(e) { return { x: e.x - CANVAS_X, y: e.y - CANVAS_Y }; }
function tap(e) {
  var p = coursePoint(e);
  if (p.x < 0 || p.x >= COURSE_W || p.y < 0 || p.y >= COURSE_H) return;
  if (state.done) {
    state = golfNewRound(LEVELS_CACHE);
    bestSig.set(golfBest());
    painted = false;
    logEvent('new round');
    sync(); return;
  }
  if (state.s.holed) {
    var r = golfNextHole(state, golfSaveBest);
    if (r === 'round-over') logEvent('round over total=' + state.total + ' best=' + golfBest());
    else logEvent('hole done ' + state.lastScore + ' -> H' + (state.holeIdx + 1));
    painted = false; sync(); return;
  }
  if (state.rolling) return;
  golfAim(state, p.x, p.y);
  if (mode === 'demo') {
    golfStrike(state, state.aim.angle, state.aim.power);
    logEvent('strike p=' + Math.round(state.aim.power) + ' a=' + Math.round(state.aim.angle * 180 / Math.PI));
  }
  sync();
}
lume.gesture.on(root, 'tap', tap);

/* ---- tick: roll animation + IMU swing detection ------------------------ */
var peak = 0, quiet = 0;
function swingMag(s) {
  if (!s || typeof s.ax !== 'number' || typeof s.ay !== 'number') return 0;
  return Math.sqrt(s.ax * s.ax + s.ay * s.ay);
}
function tick() {
  if (state.rolling) {
    if (golfAnimTick(state) === 'resolved') logEvent('shot resolved strokes=' + state.s.strokes);
    sync();
    return;
  }
  if (mode !== 'imu' || state.s.holed || state.done) return;
  var mag = swingMag(imuRead());
  if (mag > peak) { peak = mag; quiet = 0; }
  else if (mag < 6) quiet++; else quiet = 0;
  if (peak >= SWING_MIN && quiet >= 3) {
    var power = swingPower(peak);
    golfStrike(state, state.aim.angle, power);
    logEvent('swing peak=' + peak.toFixed(1) + ' power=' + Math.round(power));
    peak = 0; quiet = 0;
    sync();
  }
}
lume.app.onPause(function () {});
lume.app.onResume(function () { painted = false; sync(); });
var timer = lume.system.setInterval(tick, 50);
bestSig.set(golfBest());
modeSig.set(mode.toUpperCase());
logEvent('course seed=' + SEED + ' mode=' + mode);
sync();
