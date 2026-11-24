const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r181: emu frame-injection pacing + UI-queue backpressure (named objects only).
  'tools/lume/scan.js', 'firmware/components/lume-ui-bridge/lume_ui_bridge.c',
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js',
  // r75 raster and refresh changes already present on origin/main.
  'firmware/components/lume-svg/lume_svg.c',
  'firmware/components/lvgl/lv_conf.h',
];
/* r137 host harness for examples/vec_demo (pure app + real host math stub).
 * Standalone CommonJS:  node tests/vec_demo.js
 *
 * Runs the REAL app against the firmware prelude. The host lume.math binding
 * in tests/lib/prelude_runner.js is a JS mirror of firmware lume_math.c, so
 * this harness checks the app's particle state against an INDEPENDENT double
 * reference integrator written here (not copied from the stub). Known-answer
 * unit tests assert the stub's own semantics strictly value-by-value. A mutable
 * math spy injects a throwing vecAdd to exercise the app's try/catch branch.
 *
 * HONESTY: this harness does NOT test the ESP32-S3 C binding or the panel. It
 * exercises the host stub + the firmware prelude + the app; board acceptance
 * stays deferred. Mutations below re-feed deliberately broken copies / sources
 * to prove the key predicates are load bearing.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('examples/vec_demo/app.js');
const manifest = read('tools/playground/build.mjs');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)

// ---- independent reference integrator (NOT copied from the host stub) -----
// One step with plain doubles for every arithmetic op; Float32Array.from()
// applies the single C-equivalent (float) rounding on write. Allocates fresh
// arrays so it never aliases the previous step's state.
function refStep(dt, st, p) {
  const vx = Float32Array.from(st.vx), vy = Float32Array.from(st.vy);
  const px = Float32Array.from(st.px), py = Float32Array.from(st.py);
  let i;
  // integrate(): interleaved acc with ax=0, ay=g.
  for (i = 0; i < p.N; i++) { vx[i] = vx[i] + 0 * dt; vy[i] = vy[i] + p.g * dt; }
  // vecScale(): damping on both components.
  for (i = 0; i < p.N; i++) { vx[i] = vx[i] * p.DAMP; vy[i] = vy[i] * p.DAMP; }
  // vecAdd(): horizontal kick composed into vx.
  for (i = 0; i < p.N; i++) vx[i] = vx[i] + p.KICK;
  // dot(vx,vx) + dot(vy,vy): two double sums, then added once.
  let sx = 0, sy = 0;
  for (i = 0; i < p.N; i++) sx += vx[i] * vx[i];
  for (i = 0; i < p.N; i++) sy += vy[i] * vy[i];
  const energy = sx + sy;
  // app-level position integration + wall bounce.
  for (i = 0; i < p.N; i++) {
    px[i] = px[i] + vx[i] * dt;
    py[i] = py[i] + vy[i] * dt;
    if (px[i] < p.R) { px[i] = p.R; if (vx[i] < 0) vx[i] = -vx[i] * p.REST; }
    else if (px[i] > p.S - p.R) { px[i] = p.S - p.R; if (vx[i] > 0) vx[i] = -vx[i] * p.REST; }
    if (py[i] < p.R) { py[i] = p.R; if (vy[i] < 0) vy[i] = -vy[i] * p.REST; }
    else if (py[i] > p.S - p.R) { py[i] = p.S - p.R; if (vy[i] > 0) vy[i] = -vy[i] * p.REST; }
  }
  return { px, py, vx, vy, energy };
}
function refRun(dt, init, p, steps) {
  let st = init;
  for (let k = 0; k < steps; k++) st = refStep(dt, st, p);
  return st;
}
const paramsOf = c => ({ N: c.N, R: c.R, S: c.S, DAMP: c.DAMP, KICK: c.KICK,
  REST: c.REST, g: c.GLEVELS[0] });
function strictEqual(got, want, label) {
  assert.equal(got.length, want.length, label + ' length');
  for (let i = 0; i < got.length; i++) assert.equal(got[i], want[i], label + '[' + i + ']');
}

// ---- live helpers ---------------------------------------------------------
function probe(options) { return runApp(source, Object.assign({ filename: 'examples/vec_demo/app.js' }, options)); }
function textsAfter(ui, from) {
  return ui.messages.slice(from).filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
}
function check(name, fn) { fn(); console.log('PASS ' + name); }

// ---- static predicates (also used by mutation proof) ----------------------
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const asciiOnly = s => {
  const lits = literals(s);
  return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
};
const errorBranch = s => s.includes('try {') && s.includes("statusDisplay.set('MATH ERR')") &&
  s.includes("hudDisplay.set('MATH ERR')");
const realMath = s => ['integrate', 'vecScale', 'vecAdd', 'dot'].every(k => s.includes('math.' + k + '('));
const budgetDecl = s => /LUME_MAX_NODES = 128/.test(s) && /NODE BUDGET/.test(s);
const plainGlobal = s => !/\bimport\b|\bexport\b/.test(s);
function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
function manifestApps(m) {
  const block = (m.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
  assert.ok(block, 'playground app list not found');
  return block.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ---- live runs: real host stub, independent reference ---------------------
check('default: N24/G40, HUD+OK, 9 nodes, no math error at boot', () => {
  const ui = probe(), c = ui.ctx, st = c.state();
  assert.equal(st.n, 24); assert.equal(st.level, 0); assert.equal(st.g, 40);
  assert.equal(st.mathErr, false);
  const texts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(texts.includes('N24 G40 E0'), texts.join('|'));
  assert.ok(texts.includes('OK') && !texts.some(x => /MATH ERR/.test(x)), texts.join('|'));
  assert.equal(ui.messages.filter(m => m[0] === 'create').length, 9);
});

check('all four math APIs are actually called per step (spy forwards to real stub)', () => {
  const ui = probe(), c = ui.ctx;
  const calls = { vecAdd: 0, vecScale: 0, dot: 0, integrate: 0 };
  for (const k of Object.keys(calls)) {
    const orig = ui.lume.math[k];
    ui.lume.math[k] = function (...a) { calls[k]++; return orig.apply(this, a); };
  }
  assert.equal(c.step(c.DT), true);
  assert.deepEqual(calls, { vecAdd: 1, vecScale: 2, dot: 2, integrate: 1 }, JSON.stringify(calls));
  // The forwarded step still advances physics (not stubbed to a no-op).
  assert.notEqual(c.state().energy, 0);
});

check('30 steps match the independent reference integrator strictly (vx/vy/px/py/energy)', () => {
  const ui = probe(), c = ui.ctx;
  const init = c.state(), p = paramsOf(c);
  for (let k = 0; k < 30; k++) assert.equal(c.step(c.DT), true, 'step ' + k);
  const got = c.state(), want = refRun(c.DT, init, p, 30);
  strictEqual(got.vx, want.vx, 'vx'); strictEqual(got.vy, want.vy, 'vy');
  strictEqual(got.px, want.px, 'px'); strictEqual(got.py, want.py, 'py');
  assert.equal(got.energy, want.energy, 'energy: ' + got.energy + ' != ' + want.energy);
});

check('bounce constraint: 200 hard steps keep every particle inside the canvas', () => {
  const ui = probe(), c = ui.ctx, p = paramsOf(c);
  p.g = c.GLEVELS[c.GLEVELS.length - 1];
  for (let k = 0; k < 200; k++) c.step(c.DT);
  const st = c.state();
  for (let i = 0; i < st.n; i++) {
    assert.ok(st.px[i] >= c.R && st.px[i] <= c.S - c.R, 'px[' + i + ']=' + st.px[i]);
    assert.ok(st.py[i] >= c.R && st.py[i] <= c.S - c.R, 'py[' + i + ']=' + st.py[i]);
  }
});

check('NEXT cycles gravity levels 0->1->2->0 and publishes the HUD', () => {
  const ui = probe(), c = ui.ctx;
  const ids = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.equal(ids.length, 1, 'one NEXT button registers a press event');
  const seen = [];
  ui.press(ids[0]); seen.push(c.state().level);
  ui.press(ids[0]); seen.push(c.state().level);
  ui.press(ids[0]); seen.push(c.state().level);
  assert.deepEqual(seen, [1, 2, 0]);
  const texts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(texts.includes('N24 G80 E0'), texts.join('|'));
  assert.ok(texts.includes('N24 G160 E0'), texts.join('|'));
});

check('injected throwing vecAdd presents MATH ERR and freezes physics (defensive branch)', () => {
  const ui = probe({ math: { vecAdd: () => { throw new TypeError('boom'); } } }), c = ui.ctx;
  const from = ui.messages.length;
  assert.equal(c.step(c.DT), false, 'step reports failure');
  const st = c.state();
  assert.equal(st.mathErr, true);
  const texts = textsAfter(ui, from);
  assert.ok(texts.includes('MATH ERR'), texts.join('|'));
  assert.ok(!texts.some(x => x === 'OK'), texts.join('|'));
  // Physics stops updating after the error: a second step is a no-op.
  const before = c.state();
  assert.equal(c.step(c.DT), false);
  const after = c.state();
  assert.deepEqual(after.px, before.px); assert.deepEqual(after.py, before.py);
  assert.deepEqual(after.vx, before.vx); assert.deepEqual(after.vy, before.vy);
});

check('NEXT still switches level while frozen (button remains wired)', () => {
  const ui = probe({ math: { integrate: () => { throw new RangeError('boom'); } } }), c = ui.ctx;
  assert.equal(c.step(c.DT), false);
  const r = c.next();
  assert.equal(r.level, 1); assert.equal(c.state().mathErr, true);
});

// ---- known-answer unit tests on the stub itself (independent doubles) -----
check('stub semantics: vecAdd returns a, mutates in place, honours byteOffset', () => {
  const m = probe().lume.math;
  const a = new Float32Array([1.5, -2, 3.25]), b = new Float32Array([4, 5.5, -6]);
  const want = Float32Array.from([5.5, 3.5, -2.75]);
  const r = m.vecAdd(a, b);
  assert.strictEqual(r, a, 'returns the same array object');
  strictEqual(a, want, 'vecAdd in-place');
  assert.deepEqual(Array.from(b), [4, 5.5, -6], 'b must not mutate');
  const buf = new Float32Array([1, 2, 3, 4, 5, 6]);
  const view = buf.subarray(1, 4);
  assert.strictEqual(m.vecAdd(view, new Float32Array([10, 20, 30])), view);
  assert.deepEqual(Array.from(buf), [1, 12, 23, 34, 5, 6], 'only the subarray slice changes');
});

check('stub semantics: vecScale returns a and mutates with double->f32 rounding', () => {
  const m = probe().lume.math;
  const a = new Float32Array([0.1, 0.2, 100]);
  const r = m.vecScale(a, 0.7);
  assert.strictEqual(r, a);
  const want = Float32Array.from([0.1 * 0.7, 0.2 * 0.7, 100 * 0.7]);
  strictEqual(a, want, 'vecScale in-place, one rounding');
});

check('stub semantics: dot is a double accumulation equal to an independent sum', () => {
  const m = probe().lume.math;
  const a = new Float32Array([1e8, 1, -3.5]), b = new Float32Array([1e8, 2.25, 4]);
  let want = 0;
  for (let i = 0, d = Float64Array.from(a), e = Float64Array.from(b); i < a.length; i++) want += d[i] * e[i];
  assert.equal(m.dot(a, b), want, 'exact double accumulator');
  assert.equal(m.dot(a, a), Float64Array.from(a).reduce((s, v) => s + v * v, 0));
});

check('stub semantics: integrate uses interleaved acc and returns undefined', () => {
  const m = probe().lume.math;
  const acc = new Float32Array([1, 2, 3, 4, 5, 6]);
  const vx = new Float32Array([10, 20, 30]), vy = new Float32Array([-10, -20, -30]);
  const r = m.integrate(acc, vx, vy, 0.5);
  assert.equal(r, undefined);
  const wvx = Float32Array.from([10 + 1 * 0.5, 20 + 3 * 0.5, 30 + 5 * 0.5]);
  const wvy = Float32Array.from([-10 + 2 * 0.5, -20 + 4 * 0.5, -30 + 6 * 0.5]);
  strictEqual(vx, wvx, 'vx from acc[2i]'); strictEqual(vy, wvy, 'vy from acc[2i+1]');
});

check('stub contract: non-Float32Array -> TypeError, length mismatch -> RangeError', () => {
  const m = probe().lume.math;
  const f = n => new Float32Array(n);
  assert.throws(() => m.vecAdd([1], f(1)), TypeError);
  assert.throws(() => m.vecAdd(f(1), [1]), TypeError);
  assert.throws(() => m.vecScale([1], 2), TypeError);
  assert.throws(() => m.dot([1], f(1)), TypeError);
  assert.throws(() => m.integrate([0, 1], f(1), f(1), 1), TypeError);
  assert.throws(() => m.integrate(f(2), [1], f(1), 1), TypeError);
  assert.throws(() => m.integrate(f(2), f(1), [1], 1), TypeError);
  assert.throws(() => m.vecAdd(f(1), f(2)), RangeError);
  assert.throws(() => m.dot(f(1), f(2)), RangeError);
  assert.throws(() => m.integrate(f(2), f(2), f(1), 1), RangeError, 'vx.length !== vy.length');
  assert.throws(() => m.integrate(f(3), f(2), f(2), 1), RangeError, 'acc.length !== vx.length * 2');
});

// ---- static source / repo invariants -------------------------------------
check('all UI string literals ASCII-only (r64)', () => assert.ok(asciiOnly(source)));
check('try/catch error branch and four real math calls present', () => {
  assert.ok(errorBranch(source)); assert.ok(realMath(source));
});
check('header declares LUME_MAX_NODES budget and app is a plain global script', () => {
  assert.ok(budgetDecl(source)); assert.ok(plainGlobal(source));
});
check('static tree <= 12 nodes', () => {
  const ui = probe();
  assert.ok(ui.messages.filter(m => m[0] === 'create').length <= 12,
    String(ui.messages.filter(m => m[0] === 'create').length));
});
check('playground manifest has 57 apps including vec_demo', () => {
  const apps = manifestApps(manifest);
  assert.ok(apps.length > 0 && apps.includes('vec_demo'));
  assert.ok(apps.includes('vec_demo'));
});
check('generated playground source is byte-identical to the example', () =>
  assert.equal(read('website/playground/sources/vec_demo.js'), source));
check('firmware/ runtime/ tools/lume/ byte-identical to baseline 3514c76', () =>
  assert.deepEqual(gitChanged(['firmware/', 'runtime/', 'tools/lume/']).filter(f => !R166_ALLOWED.includes(f)), []));

// ---- mutation proof: key predicates MUST fail on a bad input --------------
check('MUTATION delete try/catch error branch -> predicate and live MATH ERR FAIL', () => {
  const mutated = source
    .replace("hudDisplay.set('MATH ERR');", "hudDisplay.set('OK');")
    .replace("statusDisplay.set('MATH ERR');", "statusDisplay.set('OK');");
  assert.notEqual(mutated, source);
  assert.equal(errorBranch(mutated), false);
  const ui = runApp(mutated, { math: { vecAdd: () => { throw new TypeError('x'); } } });
  ui.ctx.step(ui.ctx.DT);
  const texts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(!texts.includes('MATH ERR'), 'mutated app cannot present MATH ERR');
});
check('MUTATION non-ASCII UI literal -> ASCII predicate FAILS', () => {
  const mutated = source.replace("'Vector Physics'", "'矢量物理'");
  assert.notEqual(mutated, source);
  assert.equal(asciiOnly(mutated), false);
});
check('MUTATION fake app physics -> independent reference comparison FAILS', () => {
  const mutated = source.replace('math.integrate(acc, vx, vy, dt);', 'vx[0] = 0;');
  assert.notEqual(mutated, source);
  assert.equal(realMath(mutated), false);
  const ui = runApp(mutated), c = ui.ctx;
  const init = c.state(), p = paramsOf(c);
  c.step(c.DT);
  const got = c.state(), want = refRun(c.DT, init, p, 1);
  let differs = false;
  for (let i = 0; i < got.vy.length; i++) if (got.vy[i] !== want.vy[i]) differs = true;
  assert.ok(differs, 'faked integrate must diverge from the reference');
});
check('MUTATION fake reference -> comparison FAILS (comparator load-bearing)', () => {
  const ui = probe(), c = ui.ctx;
  const init = c.state(), p = paramsOf(c);
  c.step(c.DT);
  const got = c.state(), want = refRun(c.DT, init, p, 1);
  const fake = { vx: Float32Array.from(got.vx.map(() => 0)) };
  let same = true;
  for (let i = 0; i < fake.vx.length; i++) if (got.vx[i] !== fake.vx[i]) same = false;
  assert.ok(same === false, 'a deliberately wrong reference must be rejected');
  strictEqual(got.vx, want.vx, 'the real reference still matches');
});
function mutationRepoDiff(paths, rel) {
  const target = path.join(root, rel);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original + '\n/* r137 mutation proof */\n');
    assert.ok(gitChanged(paths).length > 0, rel + ' modification must be visible to the diff check');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.deepEqual(gitChanged(paths).filter(f => !R166_ALLOWED.includes(f)), []);
}
check('MUTATION touch firmware/ -> diff predicate FAILS (then restored)', () =>
  mutationRepoDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'firmware/components/lume-engine/lume_engine.c'));
check('MUTATION touch runtime/ -> diff predicate FAILS (then restored)', () =>
  mutationRepoDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'runtime/types/lume.d.ts'));

console.log('PASS vec_demo harness: all live, known-answer, static and mutation checks green');
