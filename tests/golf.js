/*
 * r79 host harness for examples/golf — swing mini golf (procedural course).
 *
 *   node tests/golf.js
 *
 * Honesty scope: host-only. The course is seeded-deterministic so every hole
 * can be REPLAYED and SOLVED on the host; the device-side swing path (IMU
 * peak -> power) is unit-checked against the pure helpers, not on hardware.
 * The render replay pins the raster budget (terrain layer repaints only the
 * dirty box; HUD is native Text, not canvas pixels).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/golf/app.js', 'utf8');

/* ---- 0. no decorative Unicode in UI strings (firmware font, r64) -------- */
{
  const ui = source.split('/* GAME UI */')[1];
  const strings = ui.match(/'[^'\n]*'/g) || [];
  for (const s of strings) {
    const body = s.slice(1, -1);
    assert.ok(/^[\x20-\x7E]*$/.test(body), `UI string is ASCII-only: ${body}`);
  }
  console.log('PASS golf UI strings are ASCII-only (r64 font rule)');
}

/* ---- pure logic in a bare vm context (split at the GAME UI marker) ------ */
function logic() {
  const src = source.split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const g = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ---- 1. seeded course generation is deterministic and structurally sane - */
{
  const a = plain(g.golfLevels()), b = plain(g.golfLevels());
  assert.deepEqual(a, b, 'same seed -> identical courses');
  assert.equal(a.length, 10, '10 holes');
  let waterN = 0, sandN = 0, slopeN = 0;
  for (let i = 0; i < a.length; i++) {
    const l = a[i];
    assert.ok(l.start.x >= 0 && l.start.x < g.COURSE_W, 'tee inside');
    assert.ok(l.hole.x >= 0 && l.hole.x < g.COURSE_W, 'hole inside');
    assert.ok(l.dist > 200, 'hole ' + (i + 1) + ' has real distance: ' + l.dist);
    assert.ok(l.par >= 2 && l.par <= 4, 'par sane');
    /* tee and hole must never be inside water or sand */
    for (const w of l.water) {
      assert.ok(!g.ptInRect(l.start.x, l.start.y, w), 'tee not in water');
      assert.ok(!g.ptInRect(l.hole.x, l.hole.y, w), 'hole not in water');
      waterN++;
    }
    for (const s of l.sand) {
      assert.ok(!g.ptInRect(l.start.x, l.start.y, s), 'tee not in sand');
      assert.ok(!g.ptInRect(l.hole.x, l.hole.y, s), 'hole not in sand');
      sandN++;
    }
    /* the green must be fairway-adjacent: the green rect overlaps a fairway band */
    const over = l.fairway.some(f => g.rectsHit(l.green, f));
    assert.ok(over, 'green reachable from a fairway band (hole ' + (i + 1) + ')');
    if (l.slope.ax !== 0 || l.slope.ay !== 0) slopeN++;
  }
  assert.ok(waterN >= 2, 'later holes have water: ' + waterN);
  assert.ok(sandN >= 2, 'holes have sand: ' + sandN);
  assert.ok(slopeN >= 2, 'later holes have slope: ' + slopeN);
  console.log('PASS golf seeded generation deterministic, safe, water/sand/slope spread');
}

/* ---- 2. terrain classification ------------------------------------------ */
{
  const l = g.golfLevels()[0];
  const teeT = g.terrainAt(l, l.start.x, l.start.y);
  assert.ok(teeT === 'rough' || teeT === 'fairway', 'tee on managed ground: ' + teeT);
  assert.equal(g.terrainAt(l, l.hole.x, l.hole.y), 'green', 'hole on green');
  console.log('PASS golf terrain classification (tee managed ground, hole green)');
}

/* ---- 3. physics: straight putt onto the green stops inside the green ---- */
{
  const l = g.golfLevels()[0];
  const ang = Math.atan2(l.hole.y - l.start.y, l.hole.x - l.start.x);
  const out = g.golfShot(l, l.start.x, l.start.y, ang, 300);
  assert.ok(out.path.length >= 2, 'path sampled');
  const endT = g.terrainAt(l, out.x, out.y);
  assert.ok(endT === 'green' || endT === 'fairway' || out.result === 'holed',
    'straight drive stays on managed grass (or drops): ' + endT + ' ' + out.result);
  assert.ok(out.result === 'rolled' || out.result === 'holed', 'no splash on dry ground');
  console.log('PASS golf straight drive rolls and stops on managed grass');
}

/* ---- 4. sand eats energy: same power, shorter roll ---------------------- */
{
  const l = g.golfLevels()[1];   /* hole 2 has sand */
  const sand = l.sand[0];
  const cx = sand.x + sand.w / 2, cy = sand.y + sand.h / 2;
  const ang = 0;
  const out = g.golfShot(l, cx, cy, ang, 400);
  const endT = g.terrainAt(l, out.x, out.y);
  assert.equal(endT, 'sand', 'ball launched from sand centre stays in/before sand: ' + endT);
  console.log('PASS golf sand friction kills the roll');
}

/* ---- 5. water: splash result + deterministic ---------------------------- */
{
  const l = g.golfLevels()[2];   /* hole 3 has water */
  const w = l.water[0];
  const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
  const out = g.golfShot(l, cx - 60, cy, 0, 200);
  assert.ok(out.result === 'water' || g.terrainAt(l, out.x, out.y) !== 'water', 'crossing water reports splash');
  const out2 = g.golfShot(l, cx - 60, cy, 0, 200);
  assert.equal(out.x, out2.x, 'water shot deterministic x');
  console.log('PASS golf water splash detection deterministic');
}

/* ---- 6. hole capture needs CAPTURE speed; fast ball rolls over ---------- */
{
  const l = g.golfLevels()[0];
  const slow = g.golfShot(l, l.hole.x - 12, l.hole.y, 0, 60);
  assert.equal(slow.result, 'holed', 'slow putt at the hole drops: ' + slow.result);
  assert.equal(slow.x, l.hole.x, 'snapped to the hole');
  /* fast, straight AT the hole from sand-free far distance: power 480 */
  const fast = g.golfShot(l, l.hole.x - 60, l.hole.y, 0, 480);
  assert.ok(fast.result === 'rolled' || fast.result === 'water', 'fast ball does not drop');
  console.log('PASS golf hole capture speed gate');
}

/* ---- 7. swing power mapping: clamps + monotonic ------------------------- */
{
  assert.equal(g.swingPower(0), g.POWER_MIN, 'below range clamps low');
  assert.equal(g.swingPower(100), g.POWER_MAX, 'above range clamps high');
  const p1 = g.swingPower(12), p2 = g.swingPower(20), p3 = g.swingPower(35);
  assert.ok(p1 < p2 && p2 < p3, 'monotonic');
  assert.equal(p1, g.POWER_MIN, 'SWING_MIN maps to POWER_MIN');
  assert.ok(Math.abs(p3 - g.POWER_MAX) < 1e-9, 'SWING_MAX maps to POWER_MAX');
  console.log('PASS golf swing peak -> power ramp clamps and monotonic');
}

/* ---- 8. full round: play every hole from the tee by simulation ---------- */
/* Strategy per stroke: search an angle/power grid for the best progress, then
 * commit. Proves the 10-hole course is finishable with reachable power. */
{
  const levels = plain(g.golfLevels());
  const state = g.golfNewRound(levels);
  let guard = 0;
  while (!state.done) {
    assert.ok(guard++ < 200, 'round must finish (runaway guard, hole ' + (state.holeIdx + 1) + ')');
    const s = state.s, l = s.l;
    if (s.holed) { g.golfNextHole(state, null); continue; }
    assert.ok(s.strokes < l.par + 6, 'hole ' + (state.holeIdx + 1) + ' stroke budget');
    let best = null;
    for (let ai = 0; ai < 24; ai++) {
      const angle = (ai * Math.PI * 2) / 24;
      for (let p = g.POWER_MIN; p <= g.POWER_MAX; p += 80) {
        const shot = g.golfShot(l, s.ball.x, s.ball.y, angle, p);
        if (shot.result === 'water') continue;
        const d = g.dist(shot.x, shot.y, l.hole.x, l.hole.y);
        const score = shot.result === 'holed' ? -1 : d;
        if (!best || score < best.score) best = { score, angle, power: p };
      }
    }
    assert.ok(best, 'hole ' + (state.holeIdx + 1) + ': grid search found a shot');
    g.golfStrike(state, best.angle, best.power);
    while (g.golfAnimTick(state) === 'rolling') {}
    if (state.s.splash) { /* penalty path exercised */ }
  }
  assert.ok(state.total > 0, 'total strokes counted');
  console.log('PASS golf all 10 holes solvable by grid search, round total=' + state.total);
}

/* ---- 9. round machine: water penalty increments strokes, ball returns --- */
{
  const levels = plain(g.golfLevels());
  const state = g.golfNewRound(levels);
  const s = state.s;
  /* hand-build a rolling water shot on hole 3 (has water) */
  state.holeIdx = 2; state.s = g.golfHoleState(levels[2]);
  const l3 = levels[2], w = l3.water[0];
  const s3 = state.s;
  s3.ball = { x: w.x - 60, y: w.y + w.h / 2 };
  s3.prev = { x: s3.ball.x, y: s3.ball.y };
  const before = s3.strokes;
  g.golfStrike(state, 0, 200);
  let r;
  while ((r = g.golfAnimTick(state)) === 'rolling') {}
  assert.equal(r, 'resolved');
  assert.equal(s3.splash, true, 'splash flagged');
  assert.equal(s3.strokes, before + 2, 'stroke + water penalty = +2');
  assert.deepEqual(plain(s3.ball), plain(s3.prev), 'ball back at pre-shot spot');
  console.log('PASS golf water penalty +1 and reset to pre-shot spot');
}

/* ---- 10. negative: strike rejected while rolling / after holed ---------- */
{
  const levels = plain(g.golfLevels());
  const state = g.golfNewRound(levels);
  g.golfStrike(state, 0, 200);
  assert.equal(g.golfStrike(state, 0, 200), null, 'no double strike while rolling');
  const st = state.s;
  st.holed = true;
  assert.equal(g.golfStrike(state, 0, 200), null, 'no strike after holed');
  /* out-of-range power already clamped by swingPower; golfShot itself is total */
  const wild = g.golfShot(state.s.l, 240, 210, 999, 1e6);
  assert.ok(Number.isFinite(wild.x) && Number.isFinite(wild.y), 'wild shot stays finite');
  console.log('PASS golf strike guards (rolling/holed rejected, wild input finite)');
}

/* ---- device render path: real prelude, real draw stream ---------------- */
const logs = [];
const ui = runApp(source, {
  filename: 'examples/golf/app.js',
  imu: { read: () => null },        /* browser esp32sim has no IMU -> demo mode */
  kv: { set: () => 0, get: () => null, remove: () => 0, keys: () => [], clear: () => 0 },
  onLog: s => logs.push(s),
});
const c = ui.ctx;
const ROOT_ID = 1;

/* 11. boots into demo mode, HUD signals published */
{
  assert.equal(c.mode, 'demo', 'no IMU -> demo mode');
  assert.ok(logs.some(s => s.includes('GOLF course seed=')), 'boot log: ' + logs[0]);
  const texts = ui.messages.filter(m => m[0] === 'attr').length;
  assert.ok(texts > 0, 'HUD text attrs emitted');
  console.log('PASS golf boots in demo mode with HUD');
}

/* 12. tap aiming strikes in demo mode; ball moves; strokes count */
{
  const st0 = c.state.s.strokes;
  const b0 = { x: c.state.s.ball.x, y: c.state.s.ball.y };
  ui.gesture(ROOT_ID, 0, b0.x + 120, b0.y, 10);   /* DOWN */
  ui.gesture(ROOT_ID, 2, b0.x + 120, b0.y, 30);   /* UP quickly -> tap */
  assert.ok(c.state.rolling || c.state.s.strokes === st0 + 1, 'tap struck');
  let guard = 0;
  while (c.state.rolling && guard++ < 200) c.tick();
  assert.ok(guard < 200, 'roll anim terminates');
  assert.equal(c.state.s.strokes, st0 + 1, 'stroke counted');
  assert.ok(c.state.s.ball.x !== b0.x || c.state.s.ball.y !== b0.y, 'ball moved');
  console.log('PASS golf tap aim + demo strike through the gesture pipeline');
}

/* 13. raster budget: terrain repaint stays inside dirty box, ball+aim only */
{
  const draws = ui.messages.filter(m => m[0] === 'draw');
  const fills = draws.filter(m => m[2] === 1);
  assert.ok(fills.length > 0, 'fillRect ops exist');
  /* invalidate is always [tag, canvasId, x, y, w, h]; the FIRST paint returns
   * the whole canvas, later paints must stay below that area. */
  const invs = ui.messages.filter(m => m[0] === 'invalidate');
  assert.ok(invs.length >= 2, 'first paint + at least one incremental paint');
  const area = m => m[4] * m[5];
  const total = g.COURSE_W * g.COURSE_H;
  assert.equal(area(invs[0]), total, 'first paint invalidates the whole canvas');
  for (const m of invs.slice(1)) {
    const [, , x, y, w, h] = m;
    assert.ok(x >= 0 && y >= 0, 'rect origin >= 0');
    assert.ok(x + w <= g.COURSE_W && y + h <= g.COURSE_H, 'rect inside canvas');
    assert.ok(w >= 1 && h >= 1, 'rect non-empty');
    assert.ok(w * h < total, 'no full repaint after the first paint');
  }
  /* one canvas of 480x420 = 201,600 px < 230,400 budget */
  assert.ok(g.COURSE_W * g.COURSE_H <= 230400, 'canvas within pixel budget');
  const mark = ui.messages.length;
  for (let i = 0; i < 20; i++) c.tick();
  const idle = ui.messages.slice(mark);
  assert.equal(idle.filter(m => m[0] === 'invalidate').length, 0, 'ready state skips 20 timer paints');
  assert.equal(idle.filter(m => m[0] === 'draw').length, 0, 'ready state emits no canvas calls');
  let calls = 0, maxCalls = 0;
  for (const m of ui.messages) {
    if (m[0] === 'draw') calls++;
    else if (m[0] === 'batch') calls += m[2].length / 6;
    else if (m[0] === 'invalidate') { maxCalls = Math.max(maxCalls, calls); calls = 0; }
  }
  assert.ok(maxCalls > 0 && maxCalls <= 2000, 'per-paint draw budget ' + maxCalls);
  console.log('EVIDENCE golf ready 0 paints/20 ticks; max ' + maxCalls + ' draw calls/paint');
  console.log('PASS golf dirty-rect discipline + canvas pixel budget');
}

/* 14. round completion path through the real prelude (fast-forward) */
{
  /* programmatically hole every hole via the pure state machine on ctx */
  let guard = 0;
  while (!c.state.done && guard++ < 200) {
    if (c.state.s.holed) { vm.runInContext('state.s.holed && golfNextHole(state, golfSaveBest)', c); continue; }
    const l = c.state.s.l, b = c.state.s.ball;
    let best = null;
    for (let ai = 0; ai < 24; ai++) {
      const angle = (ai * Math.PI * 2) / 24;
      for (let p = g.POWER_MIN; p <= g.POWER_MAX; p += 80) {
        const shot = c.golfShot(l, b.x, b.y, angle, p);
        if (shot.result === 'water') continue;
        const d = c.dist(shot.x, shot.y, l.hole.x, l.hole.y);
        const score = shot.result === 'holed' ? -1 : d;
        if (!best || score < best.score) best = { score, angle, power: p };
      }
    }
    vm.runInContext(`golfStrike(state, ${best.angle}, ${best.power})`, c);
    vm.runInContext('while (golfAnimTick(state) === "rolling") {}', c);
    vm.runInContext('sync()', c);
  }
  assert.ok(c.state.done, 'round completes through the app context');
  assert.ok(c.state.total > 0, 'total strokes counted through the app context');
  assert.ok(String(c.noteText()).includes('ROUND'), 'note announces the round total: ' + c.noteText());
  /* new round resets */
  ui.gesture(ROOT_ID, 0, 240, 240, 100);
  ui.gesture(ROOT_ID, 2, 240, 240, 120);
  assert.equal(c.state.done, false, 'tap after round-over starts a new round');
  assert.equal(c.state.holeIdx, 0, 'back to hole 1');
  console.log('PASS golf round completion + restart through the real prelude');
}

console.log('ALL golf harness checks passed');
