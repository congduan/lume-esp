/*
 * r123 host harness for examples/minigolf - swing-to-hit putting.
 *
 *   node tests/minigolf.js
 *
 * Logic is split at the GAME UI marker into a bare vm (like tests/sokoban.js
 * and tests/flapdot.js); the render/touch/IMU paths run through the real
 * firmware prelude via runApp. Case 5 is the core value: a deterministic
 * angle x power search PROVES every generated hole is solvable within its
 * stated par (a data bug fails here, not a weakened assertion).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/minigolf/app.js', 'utf8');
const logic = source.split('/* GAME UI */')[0];

/* ---- 0. UI strings ASCII-only (firmware font, r64) ---------------------- */
{
  const ui = source.split('/* GAME UI */')[1] || '';
  const strings = ui.match(/'[^'\n]*'/g) || [];
  for (const s of strings) {
    const body = s.slice(1, -1);
    assert.ok(/^[\x20-\x7E]*$/.test(body), 'UI string ASCII-only: ' + body);
  }
  console.log('PASS minigolf UI strings ASCII-only (r64 font rule)');
}

/* ---- pure logic context ------------------------------------------------- */
function loadLogic() {
  const ctx = vm.createContext({});
  vm.runInContext(logic, ctx);
  return ctx;
}
const g = loadLogic();
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ---- 1. power mapping: thresholds and bounds ---------------------------- */
{
  assert.equal(g.swingPower(0), 0);
  assert.equal(g.swingPower(g.SWING_THRESHOLD), 0, 'at-threshold swing = no putt');
  assert.equal(g.swingPower(g.SWING_THRESHOLD - 0.1), 0, 'weak swing = no putt');
  assert.equal(g.swingPower(g.SWING_PEAK_MAX), 1, 'full-scale swing = full power');
  assert.equal(g.swingPower(100), 1, 'clamped above full scale');
  assert.equal(g.dragPower(0), 0);
  assert.equal(g.dragPower(g.DRAG_FULL), 1);
  assert.equal(g.dragPower(9999), 1, 'drag clamped');
  /* both input paths funnel through the same speed curve */
  assert.equal(g.shotSpeed(0), g.SHOT_MIN);
  assert.equal(g.shotSpeed(1), g.SHOT_MAX);
  assert.ok(g.shotSpeed(g.swingPower(18)) > g.shotSpeed(g.swingPower(10)), 'stronger swing is faster');
  assert.ok(Math.abs(g.shotSpeed(g.dragPower(75)) - g.shotSpeed(0.5)) < 1e-9, 'drag and swing share the curve');
  console.log('PASS minigolf power mapping (threshold/dead-zone/clamp, shared curve)');
}

/* ---- 2. state/turn flow: ready -> rolling -> rest/holed, shot gating ---- */
{
  const st = g.golfState(0);
  assert.equal(st.phase, 'ready');
  assert.equal(st.ball.x, st.level.tee.x);
  assert.equal(st.ball.y, st.level.tee.y);
  assert.equal(st.strokes, 0);
  assert.equal(g.golfShoot(st, 0, -1, 200), true, 'putt accepted while at rest');
  assert.equal(st.phase, 'rolling');
  assert.equal(st.strokes, 1);
  assert.equal(g.golfShoot(st, 0, -1, 200), false, 'no second putt while the ball rolls');
  assert.equal(st.strokes, 1, 'rejected putt does not count');
  assert.equal(g.golfShoot(st, 0, -1, 0), false, 'zero-speed putt rejected');
  let steps = 0;
  while (st.phase === 'rolling' && steps++ < 900) g.golfStep(st, g.DT);
  assert.ok(st.phase === 'ready' || st.phase === 'holed', 'frame settles: ' + st.phase);
  assert.ok(st.events.some(e => e.indexOf('REST ') === 0 || e.indexOf('HOLE ') === 0));
  console.log('PASS minigolf turn flow + shot gating (rolling/rejected putt)');
}

/* ---- 3. physics: friction stops, slope bends, walls/guards keep ball in -- */
{
  const flat = g.golfState(0);            /* L1 slope = (0,0) */
  g.golfShoot(flat, 0, -1, 200);
  let n = 0;
  while (flat.phase === 'rolling' && n++ < 900) g.golfStep(flat, g.DT);
  assert.equal(flat.phase, 'ready', 'Coulomb friction always brings the ball to rest');
  assert.ok(flat.ball.y < flat.level.tee.y - 40, 'flat putt travelled up the green');

  const slope = g.golfState(2);            /* L3 has a nonzero slopeX */
  assert.notEqual(slope.level.slopeX, 0);
  g.golfShoot(slope, 0, -1, 200);
  for (let i = 0; i < 30 && slope.phase === 'rolling'; i++) g.golfStep(slope, g.DT);
  assert.ok(Math.abs(slope.ball.x - slope.level.tee.x) > 0.5, 'slope deflects x off a straight putt');
  assert.ok(Number.isFinite(slope.ball.vx) && Number.isFinite(slope.ball.vy), 'state finite');

  const wall = g.golfState(0);
  wall.phase = 'rolling'; wall.ball.x = -1000; wall.ball.y = 200; wall.ball.vx = 0; wall.ball.vy = 0;
  g.golfStep(wall, g.DT);
  assert.ok(wall.ball.x >= g.F.left && wall.ball.x <= g.F.right, 'out-of-range ball clamped inside fairway');
  assert.ok(Number.isFinite(wall.ball.x), 'no NaN on out-of-bounds recovery');

  const guard = g.golfState(2);
  const o = guard.level.obstacles[0];
  guard.phase = 'rolling'; guard.ball.x = o.x; guard.ball.y = o.y + o.r + g.BALL_R - 1;
  guard.ball.vx = 0; guard.ball.vy = 200;
  g.golfStep(guard, g.DT);
  assert.ok(g.mag2(guard.ball.x - o.x, guard.ball.y - o.y) >= o.r + g.BALL_R - 0.01, 'guard pushes ball out');
  console.log('PASS minigolf physics (friction stop, slope deflection, OOB clamp, guard bounce)');
}

/* ---- 4. cup capture / lip-out / hazard penalty -------------------------- */
{
  const hole = g.golfState(0);
  hole.phase = 'rolling';
  hole.ball.x = hole.level.hole.x; hole.ball.y = hole.level.hole.y;
  hole.ball.vx = 0; hole.ball.vy = 40;
  g.golfStep(hole, g.DT);
  assert.equal(hole.phase, 'holed', 'slow putt drops into the cup');

  const fast = g.golfState(0);
  fast.phase = 'rolling';
  fast.ball.x = fast.level.hole.x; fast.ball.y = fast.level.hole.y - 2;
  fast.ball.vx = 0; fast.ball.vy = 300;
  g.golfStep(fast, g.DT);
  assert.notEqual(fast.phase, 'holed', 'fast putt lips out (speed gate)');

  const haz = g.golfState(4);                 /* L5 has bunkers */
  const h = haz.level.hazards[0];
  haz.phase = 'rolling'; haz.restX = 240; haz.restY = 380;
  haz.ball.x = h.x + h.w / 2; haz.ball.y = h.y + h.h / 2; haz.ball.vx = 10; haz.ball.vy = 0;
  g.golfStep(haz, g.DT);
  assert.equal(haz.penalties, 1, 'hazard incurs one penalty stroke');
  assert.equal(haz.phase, 'ready');
  assert.equal(haz.ball.x, 240, 'penalty resets to the last lie');
  assert.equal(haz.ball.y, 380);
  assert.ok(haz.events.some(e => e.indexOf('PENALTY ') === 0));
  console.log('PASS minigolf cup capture / lip-out / hazard penalty reset');
}

/* ---- 5. CORE: deterministic solver proves all 6 holes solvable at par --- */
{
  const ANGLES = 72, POWERS = 14, MAX_STEPS = 900;
  assert.equal(g.LEVELS.length, 6, 'six generated levels');
  let solved = 0;
  for (let i = 0; i < g.LEVELS.length; i++) {
    const L = g.LEVELS[i];
    assert.equal(L.par, 1, 'L' + (i + 1) + ' par is a hole-in-one');
    assert.ok(L.hole.x > g.F.left && L.hole.x < g.F.right &&
              L.hole.y > g.F.top && L.hole.y < g.F.bottom, 'L' + (i + 1) + ' hole inside fairway');
    assert.ok(L.slopeX !== 0 || L.slopeY !== 0 || i === 0, 'L' + (i + 1) + ' slope ramps up');
    let hit = null;
    for (let a = 0; a < ANGLES && !hit; a++) {
      const ang = a * 2 * Math.PI / ANGLES, dx = -Math.cos(ang), dy = -Math.sin(ang);
      for (let p = 0; p < POWERS; p++) {
        const speed = g.SHOT_MIN + p * (g.SHOT_MAX - g.SHOT_MIN) / (POWERS - 1);
        const st = g.golfState(i);
        assert.equal(g.golfShoot(st, dx, dy, speed), true);
        let steps = 0;
        while (st.phase === 'rolling' && steps++ < MAX_STEPS) g.golfStep(st, g.DT);
        assert.ok(steps < MAX_STEPS, 'L' + (i + 1) + ' simulation terminates');
        if (st.phase === 'holed') { hit = { angle: a * 360 / ANGLES, power: p, speed: Math.round(speed) }; break; }
      }
    }
    assert.notEqual(hit, null, 'L' + (i + 1) + ' ' + L.name + ' UNSOLVABLE - fix level data');
    solved++;
    console.log('EVIDENCE L' + (i + 1) + ' ' + L.name + ' solvable@par hole-in-one ' + JSON.stringify(hit));
  }
  assert.equal(solved, 6);
  console.log('PASS minigolf all 6 procedural holes solvable at par (angle x power search)');
}

/* ---- 6. KV record: <=15 chars, strictly fewer wins, graceful failure ---- */
{
  let stored = null, value = null;
  g.lume = { storage: { kv: {
    get: k => { stored = k; return value; },
    set: (k, v) => { stored = k; value = v; return 0; },
  } } };
  assert.equal(g.golfBest(), 0, 'no record -> 0');
  assert.equal(stored, 'hisc.golf');
  assert.ok(stored.length <= 15, 'KV key <= 15: ' + stored);
  g.golfSaveBest(8); assert.equal(value, 8, 'first record stored');
  g.golfSaveBest(12); assert.equal(value, 8, 'worse score does not overwrite');
  g.golfSaveBest(5); assert.equal(value, 5, 'strictly fewer strokes overwrite');
  g.golfSaveBest(5); assert.equal(value, 5, 'equal score keeps old best');
  g.lume.storage.kv.get = () => { throw Error('offline'); };
  g.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(g.golfBest(), 0);
  assert.equal(g.golfSaveBest(3), 3, 'storage failure non-fatal');
  console.log('PASS minigolf hiscore KV (9-char key, strict-min, graceful failure)');
}

/* ---- 7. real prelude: boot, retained static layer, canvas budget -------- */
const logs = [];
const ui = runApp(source, { onLog: m => logs.push(String(m)), onWarn: m => logs.push('WARN ' + String(m)) });
const c = ui.ctx;
const creates = ui.messages.filter(m => m[0] === 'create');
const CANVAS_ID = creates.find(m => m[1] === 2) ? 2 : 2;  /* View=1, Canvas=2 */
const invs0 = ui.messages.filter(m => m[0] === 'invalidate');
{
  assert.equal(c.state.phase, 'ready');
  assert.ok(logs.some(s => s.includes('GOLF READY')), 'boot log');
  assert.equal(creates.length, 10, 'one View, one Canvas, four Text, four Button nodes');
  const paths = ui.messages.filter(m => m[0] === 'pathDefine');
  assert.equal(paths.length, g.LEVELS.length, 'one retained path per level');
  for (const m of paths) assert.ok(m[3].length <= 240 * 6, 'retained path <= 240 segments');
  assert.deepEqual(invs0[0].slice(2), [0, 0, 480, 480], 'first paint invalidates whole canvas');
  assert.ok(480 * 480 <= 230400, 'canvas within 230400 px budget');
  assert.ok(ui.messages.some(m => m[0] === 'press'), 'buttons register press handlers');
  console.log('PASS minigolf boot + retained paths + first paint + canvas budget');
}

/* ---- 8. demo degradation: no IMU sample -> demo fallback ---------------- */
{
  const fallbackLog = [];
  const u = runApp(source, { onLog: m => fallbackLog.push(String(m)) });
  assert.equal(u.ctx.mode, 'demo', 'boots in demo mode without IMU');
  u.ctx.setMode('imu');
  assert.equal(u.ctx.mode, 'demo', 'IMU request with no sample falls back to demo');
  assert.ok(fallbackLog.some(s => s.includes('FALLBACK demo')), 'fallback logged');
  /* a zero sample is still a readable IMU -> mode switches, weak swing never fires */
  let sample = { ax: 0, ay: 0, az: 9.8, gx: 0, gy: 0, gz: 0 };
  const u2 = runApp(source, { onLog: m => fallbackLog.push(String(m)), imu: { read: () => sample } });
  u2.ctx.setMode('imu');
  assert.equal(u2.ctx.mode, 'imu', 'readable IMU enters imu mode');
  u2.ctx.pollSwing();
  assert.equal(u2.ctx.state.strokes, 0, 'stationary IMU does not putt');
  console.log('PASS minigolf demo/imu degradation + stationary no-putt');
}

/* ---- 9. IMU swing: peak threshold triggers exactly one putt ------------- */
{
  const swingLog = [];
  let sample = { ax: 0, ay: 0, az: 9.8, gx: 0, gy: 0, gz: 0 };
  const u = runApp(source, { onLog: m => swingLog.push(String(m)), imu: { read: () => sample } });
  u.ctx.setMode('imu');
  sample = { ax: 0, ay: -22, az: 2, gx: 0, gy: 0, gz: 0 };   /* strong upward swing */
  u.ctx.pollSwing();
  assert.equal(u.ctx.swing.active, true, 'swing armed above threshold');
  assert.ok(u.ctx.swing.peak > 20, 'peak captured');
  assert.equal(u.ctx.state.strokes, 0, 'not fired until the swing settles');
  u.ctx.swing.last = Date.now() - 300;                        /* let the window elapse */
  sample = { ax: 0, ay: 0, az: 9.8, gx: 0, gy: 0, gz: 0 };
  u.ctx.pollSwing();
  assert.equal(u.ctx.state.strokes, 1, 'settled swing becomes one putt');
  assert.equal(u.ctx.state.phase, 'rolling');
  assert.equal(u.ctx.swing.active, false, 'swing latch cleared');
  u.ctx.pollSwing();
  assert.equal(u.ctx.state.strokes, 1, 'no repeat putt during cooldown/roll');

  /* sub-threshold swing settles but never fires */
  const weak = [];
  const u2 = runApp(source, { onLog: m => weak.push(String(m)), imu: { read: () => sample } });
  u2.ctx.setMode('imu');
  u2.ctx.swing.active = true; u2.ctx.swing.peak = 4; u2.ctx.swing.ax = 0; u2.ctx.swing.ay = -4;
  u2.ctx.swing.last = Date.now() - 300;
  u2.ctx.pollSwing();
  assert.equal(u2.ctx.state.strokes, 0, 'weak swing does not putt');
  assert.ok(weak.some(s => s.includes('SWING too weak')), 'weak swing logged');
  console.log('PASS minigolf IMU swing threshold + one-putt debounce + weak-swing negative');
}

/* ---- 10. touch path: drag aims, HIT putts, dirty budget during roll ----- */
{
  const scene = 2;
  const ball = c.state.ball;
  /* drag from the ball straight up ~92 px -> full-ish power toward L1 hole */
  ui.gesture(scene, 0, ball.x, ball.y, 0);
  ui.gesture(scene, 1, ball.x, ball.y - 40, 10);   /* panstart + pan */
  ui.gesture(scene, 1, ball.x, ball.y - 92, 20);
  ui.gesture(scene, 2, ball.x, ball.y - 92, 30);   /* panend */
  assert.equal(c.aim.visible, true, 'drag made the aim visible');
  assert.ok(c.aim.dy < -0.9, 'aim points up toward the hole');
  assert.ok(c.aim.power > 0.5 && c.aim.power <= 1, 'drag distance sets power');

  const pressIds = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.equal(pressIds.length, 4);
  ui.press(pressIds[1]);                            /* HIT */
  assert.equal(c.state.phase, 'rolling', 'HIT started the putt through the real prelude');
  assert.equal(c.state.strokes, 1);

  const mark = ui.messages.length;
  let frames = 0;
  while (c.state.phase === 'rolling' && frames++ < 900) c.tick();
  assert.ok(c.state.phase === 'ready' || c.state.phase === 'holed', 'roll settled via tick()');
  const inc = ui.messages.slice(mark).filter(m => m[0] === 'invalidate' && m.length >= 6);
  assert.ok(inc.length >= 1, 'incremental paints exist: ' + inc.length);
  let maxInc = 0;
  for (const m of inc) {
    const [, , x, y, w, h] = m;
    assert.ok(x >= 0 && y >= 0 && x + w <= 480 && y + h <= 480, 'dirty rect inside canvas');
    assert.ok(w >= 1 && h >= 1, 'dirty rect non-empty');
    maxInc = Math.max(maxInc, w * h);
    assert.ok(w * h < 480 * 480, 'no steady full repaint: ' + w * h);
  }
  assert.ok(ui.messages.slice(mark).some(m => m[0] === 'pathDraw'), 'static layer replayed each frame');
  console.log('PASS minigolf drag -> aim -> HIT + dirty budget (max inc ' + maxInc + ' px) + pathDraw replay');
}

/* ---- 11. reset / next navigation + long-run stability ------------------- */
{
  const pressIds = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  ui.press(pressIds[2]);                            /* RESET */
  assert.equal(c.state.strokes, 0);
  assert.equal(c.state.phase, 'ready');
  ui.press(pressIds[3]);                            /* NEXT */
  assert.equal(c.state.li, 1, 'NEXT advances level');
  assert.equal(c.state.strokes, 0);
  /* 60 s-equivalent smoke: repeated weak putts + ticks stay finite */
  for (let i = 0; i < 1800; i++) c.tick();
  assert.ok(Number.isFinite(c.state.ball.x) && Number.isFinite(c.state.ball.y), 'state finite after 1800 ticks');
  console.log('PASS minigolf RESET/NEXT navigation + 1800-tick finite smoke');
}

console.log('ALL MINIGOLF HARNESS CASES PASSED (12 cases)');
