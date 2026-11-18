/* r98 plasma: pure motion/palette contracts and the actual prelude draw path. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const app = fs.readFileSync('examples/plasma/app.js', 'utf8');
const logic = vm.createContext({});
vm.runInContext(app.split('/* GAME UI */')[0], logic);

assert.equal(logic.PL_DT, 50);
assert.ok(logic.PL_BLOBS.length >= 4 && logic.PL_BLOBS.length <= 6);
assert.ok(logic.PL_THEMES.length >= 3 && logic.PL_THEMES.length <= 4);
const state = logic.plState();
let maxNormal = 0, maxSlow = 0;
for (let tick = 0; tick < 6000; tick++) {
  const old = state.blobs.map(p => [p.x, p.y]);
  logic.plStep(state, tick < 100 ? { ax: 8, ay: -4, az: 5 } : null);
  for (let i = 0; i < logic.PL_BLOBS.length; i++) {
    const b = logic.PL_BLOBS[i], p = state.blobs[i];
    assert.ok(p.x - b.rx * 1.26 >= 0 && p.x + b.rx * 1.26 <= 480, `blob and lobe ${i} x at ${tick}`);
    assert.ok(p.y - b.ry * 1.23 >= 0 && p.y + b.ry * 1.23 <= 480, `blob and lobe ${i} y at ${tick}`);
    const v = Math.hypot(p.x - old[i][0], p.y - old[i][1]);
    if (state.slow) maxSlow = Math.max(maxSlow, v); else maxNormal = Math.max(maxNormal, v);
    for (let theme = 0; theme < logic.PL_THEMES.length; theme++) {
      for (const kind of ['body', 'core', 'middle', 'edge']) {
        assert.equal(logic.PL_RINGS[theme][kind].length, 48);
        assert.ok(logic.PL_RINGS[theme][kind].includes(logic.plColor(theme, i, state.colorPhase, kind)));
      }
    }
  }
}
assert.equal(state.slow, true);
assert.ok(maxNormal <= Math.SQRT2 * 1.8 + 0.001, `normal cap ${maxNormal}`);
assert.ok(maxSlow <= Math.SQRT2 * 0.55 + 0.001, `slow cap ${maxSlow}`);
assert.ok(maxSlow < maxNormal * 0.4, `speed reduced ${maxSlow} vs ${maxNormal}`);
assert.ok(logic.plGravity({ ax: 3, ay: -2 })[0] > 0 && logic.plGravity({ ax: 3, ay: -2 })[1] < 6);
assert.ok(logic.plGravity({ ax: -3, ay: 2 })[0] < 0 && logic.plGravity({ ax: -3, ay: 2 })[1] > 6);
assert.equal(logic.plGravity(null)[0], 0);
assert.equal(logic.plGravity(null)[1], 6);
const tilt = logic.plState();
for (let i = 0; i < 50; i++) logic.plStep(tilt, { ax: 5, ay: -3 });
assert.ok(tilt.gx > 0 && tilt.gy < 6, 'eased gravity follows IMU');
logic.plStep(state, { ax: 8, ay: 0 });
assert.equal(state.slow, false, 'large IMU change wakes');
logic.plTouch(state, 240, 240);
assert.equal(state.idle, 0);
assert.equal(state.theme, 1);
assert.ok(state.ripple);
for (let i = 0; i < 3; i++) logic.plStep(state, null);
assert.equal(state.ripple, null, 'ripple expires after three painted frames');
console.log(`PASS motion bounds 6000 ticks, speed ${maxNormal.toFixed(2)} -> ${maxSlow.toFixed(2)} px/tick`);
console.log('PASS palette lookup, IMU direction/fallback, idle wake and ripple expiry');

const ui = runApp(app);
const rings = [];
ui.ctx.plSoftEllipse({ fillEllipse: (...args) => rings.push(args) }, 200, 210, 100, 80,
  '#111111', '#222222', '#333333');
assert.equal(rings.length, 3, 'one blob silhouette has three concentric rings');
assert.deepEqual(rings.map(r => r.slice(0, 4).join(',')),
  ['200,210,100,80', '200,210,90,72', '200,210,79,63']);
assert.deepEqual(rings.map(r => r[4]), ['#111111', '#222222', '#333333']);
function drawCount(messages) {
  return messages.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
}
let maxCalls = drawCount(ui.messages);
assert.ok(maxCalls > 0 && maxCalls <= 60, `initial draw ${maxCalls}`);
for (let i = 0; i < 100; i++) {
  const start = ui.messages.length;
  ui.ctx.plTick();
  const calls = drawCount(ui.messages.slice(start));
  assert.ok(calls > 0 && calls <= 60, `frame ${i}: ${calls}`);
  maxCalls = Math.max(maxCalls, calls);
}
assert.equal(ui.ctx.pl.gx, 0, 'no IMU keeps x gravity zero');
assert.ok(ui.ctx.pl.gy > 0, 'no IMU keeps downward bias');
/* Force all ten pairs to overlap; the renderer must stop at four bridges. */
for (const p of ui.ctx.pl.blobs) { p.x = 240; p.y = 240; }
ui.ctx.pl.ripple = { x: 240, y: 240, age: 0 };
const worstStart = ui.messages.length;
ui.ctx.plFrame.set(ui.ctx.plFrame() + 1);
const worstCalls = drawCount(ui.messages.slice(worstStart));
assert.equal(worstCalls, 47, `worst case budget ${worstCalls}`);
ui.gesture(ui.ctx.plRoot, 0, 240, 240, 1000);
ui.gesture(ui.ctx.plRoot, 2, 240, 240, 1050);
assert.equal(ui.ctx.pl.theme, 1, 'tap changes theme');
assert.ok(ui.ctx.pl.ripple, 'tap creates ripple');
console.log(`PASS concentric three-ring ellipses; real prelude <=60 calls/frame (normal max ${maxCalls}; overlap+ripple ${worstCalls}), no-IMU fallback, gesture`);
console.log('ALL PLASMA HARNESS CASES PASSED');
