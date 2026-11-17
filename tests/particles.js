/* r94 fluid particle sandbox host harness: pure logic + real prelude drawing.
 * Standalone CommonJS script (not node --test), same pattern as tests/fishtank.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const app = fs.readFileSync('examples/particles/app.js', 'utf8');
const logic = vm.createContext({});
vm.runInContext(app.split('/* GAME UI */')[0], logic);

/* 1. Particle budget: 200..300, one flat fixed-length array + palette. */
assert.ok(logic.PN >= 200 && logic.PN <= 300, `particle count ${logic.PN}`);
assert.equal(logic.PSTRIDE, 4, 'interleaved x/y/vx/vy stride');
const s = logic.particleState(1);
assert.equal(s.p.length, logic.PN * logic.PSTRIDE, 'flat array length');
assert.equal(s.ci.length, logic.PN, 'palette index length');
console.log(`PASS particle count ${logic.PN} in [200,300]; array length ${s.p.length}`);

function assertInBounds(st, where) {
  const stride = logic.PSTRIDE, PN = logic.PN, p = st.p;
  for (let i = 0; i < PN; i++) {
    const o = i * stride;
    assert.ok(Number.isFinite(p[o]) && Number.isFinite(p[o + 1]) &&
              Number.isFinite(p[o + 2]) && Number.isFinite(p[o + 3]),
      `${where}: finite particle ${i}`);
    assert.ok(p[o] >= 0 && p[o] <= logic.PW - logic.PSIZE, `${where}: x bound ${i} = ${p[o]}`);
    assert.ok(p[o + 1] >= 0 && p[o + 1] <= logic.PH - logic.PSIZE, `${where}: y bound ${i} = ${p[o + 1]}`);
  }
}
assertInBounds(s, 'init');

/* 2. IMU helpers: m/s^2 units, null fallback, deviation is NOT in g. */
assert.equal(logic.gravityFromImu(null), null);
assert.equal(logic.gravityFromImu(undefined), null);
assert.equal(logic.gravityFromImu({ ax: 0, ay: 0 }), null, 'near-zero vector = no sample');
assert.equal(logic.gravityFromImu({ ax: NaN, ay: 1 }), null);
const imuG = logic.gravityFromImu({ ax: 3, ay: -2, az: 9.8, gx: 0, gy: 0, gz: 0 });
assert.ok(imuG && Math.abs(imuG[0] - 3) < 1e-9 && Math.abs(imuG[1] + 2) < 1e-9,
  'lateral gravity mapped straight from m/s^2');
assert.ok(Math.abs(logic.imuDeviation({ ax: 0, ay: 0, az: 9.80665 })) < 1e-6, 'rest deviation ~0');
assert.ok(logic.imuDeviation({ ax: 0, ay: 0, az: 0 }) > 9, 'free-fall deviation is m/s^2 not g');
console.log('PASS IMU m/s^2 mapping, null fallback and m/s^2 shake deviation');

/* 3. Demo mode (no IMU): rotating gravity, 30 s = 600 x 50 ms steps.
 *    Particles stay in bounds, stay finite, array never grows, and most of
 *    them visibly move (gravity is actually applied). */
const before = Array.from(s.p);
for (let tick = 0; tick < 600; tick++) {
  const g = logic.gravityDemo(tick);
  assert.ok(Number.isFinite(g[0]) && Number.isFinite(g[1]), `finite demo gravity ${tick}`);
  assert.ok(Math.abs(Math.hypot(g[0], g[1]) - 9.81) < 1e-9, `demo magnitude ${tick}`);
  logic.particleStep(s, g[0] * logic.GAIN, g[1] * logic.GAIN, logic.DT);
  assert.equal(s.p.length, logic.PN * logic.PSTRIDE, `array length tick ${tick}`);
  assertInBounds(s, `demo tick ${tick}`);
}
let moved = 0;
for (let i = 0; i < logic.PN; i++) {
  const o = i * logic.PSTRIDE;
  if (Math.abs(s.p[o] - before[o]) + Math.abs(s.p[o + 1] - before[o + 1]) > 1) moved++;
}
assert.ok(moved > logic.PN * 0.8, `demo gravity moves most particles, moved=${moved}`);
console.log(`PASS 30 s demo smoke: bounded/finite, constant length, moved=${moved}/${logic.PN}`);

/* 4. Touch perturbation injects a real velocity field. */
function meanVelocity(st) {
  let vx = 0, vy = 0, p = st.p;
  for (let i = 0; i < logic.PN; i++) { const o = i * logic.PSTRIDE; vx += p[o + 2]; vy += p[o + 3]; }
  return [vx / logic.PN, vy / logic.PN];
}
const s2 = logic.particleState(7);
const v0 = meanVelocity(s2);
const touched = logic.particlePerturb(s2, 240, 240, 180, 0, 90);
const v1 = meanVelocity(s2);
assert.ok(touched > 0, `perturbation touched ${touched} particles`);
assert.ok(Math.hypot(v1[0], v1[1]) > Math.hypot(v0[0], v0[1]) + 5, 'kinetic energy rises');
assert.ok(v1[0] > v1[1] + 3 && v1[0] > 0, `directional swipe bias vx=${v1[0].toFixed(1)} vy=${v1[1].toFixed(1)}`);
assert.equal(s2.p.length, logic.PN * logic.PSTRIDE, 'perturb does not allocate');
console.log(`PASS touch velocity field: touched=${touched} vx=${v1[0].toFixed(1)} vy=${v1[1].toFixed(1)}`);

/* 5. Real prelude integration: initial paint + 120 tick frames, draw-call
 *    budget <250 per frame, dirty rects only, array length constant. */
const ui = runApp(app);
function paintCalls(messages) {
  return messages.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
}
const firstCalls = paintCalls(ui.messages);
assert.ok(firstCalls > 0 && firstCalls < 250, `initial paint calls ${firstCalls}`);
let maxDraws = firstCalls, minDraws = firstCalls;
for (let i = 0; i < 120; i++) {
  const start = ui.messages.length;
  ui.ctx.particleTick();
  const count = paintCalls(ui.messages.slice(start));
  maxDraws = Math.max(maxDraws, count);
  minDraws = Math.min(minDraws, count);
  assert.ok(count > 0 && count < 250, `frame ${i} draw calls ${count}`);
}
assert.ok(ui.messages.some(m => m[0] === 'invalidate'), 'canvas repaints with dirty rects');
assert.equal(ui.ctx.pstate.p.length, logic.PN * logic.PSTRIDE, 'live state array constant');
assert.equal(ui.ctx.imuMode, false, 'no IMU -> demo mode');
assertInBounds(ui.ctx.pstate, 'live after 120 ticks');
console.log(`PASS prelude integration: draw calls/frame ${minDraws}..${maxDraws} (<250), dirty rects, no IMU -> demo`);

/* 6. Gesture path (tap + swipe) reaches the live velocity field. Target the
 *    particle nearest the canvas centre so the injected field has a definite
 *    subject even after demo gravity has spread the cloud across the screen. */
const live = ui.ctx.pstate;
const root = ui.ctx.particleRoot;
let target = 0, bestD = Infinity;
for (let i = 0; i < ui.ctx.PN; i++) {
  const o = i * logic.PSTRIDE, dx = live.p[o] - 240, dy = live.p[o + 1] - 240;
  const d = dx * dx + dy * dy;
  if (d < bestD) { bestD = d; target = i; }
}
const px = Math.round(live.p[target * logic.PSTRIDE]);
const py = Math.round(live.p[target * logic.PSTRIDE + 1]);
const startX = px >= 100 ? px - 100 : px + 100;  /* |dx| = 100 >= swipeMinPx */
const vxBefore = live.p[target * logic.PSTRIDE + 2];
ui.gesture(root, 0, startX, py, 1000);           /* DOWN */
ui.gesture(root, 2, px, py, 1100);               /* UP -> swipe into the particle */
const vxAfter = live.p[target * logic.PSTRIDE + 2];
assert.ok(Math.abs(vxAfter - vxBefore) > 10,
  `swipe reached particle ${target}: vx ${vxBefore.toFixed(1)} -> ${vxAfter.toFixed(1)}`);
const kin = () => {
  let a = 0, p = live.p;
  for (let i = 0; i < ui.ctx.PN; i++) { const o = i * logic.PSTRIDE; a += Math.hypot(p[o + 2], p[o + 3]); }
  return a;
};
const kinBeforeTap = kin();
ui.gesture(root, 0, px, py, 2000);               /* DOWN */
ui.gesture(root, 2, px, py, 2050);               /* UP -> tap (radial burst) */
const kinAfterTap = kin();
assert.ok(kinAfterTap > kinBeforeTap + 5, `tap burst raised kinetic energy ${kinBeforeTap.toFixed(1)} -> ${kinAfterTap.toFixed(1)}`);
assert.equal(live.p.length, logic.PN * logic.PSTRIDE, 'gesture path keeps array length');
console.log(`PASS gesture swipe+tap inject velocity: target ${target} vx ${vxBefore.toFixed(1)} -> ${vxAfter.toFixed(1)}`);

console.log('ALL PARTICLES HARNESS CASES PASSED');
