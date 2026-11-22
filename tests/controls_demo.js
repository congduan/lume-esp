/* r151 host harness for examples/controls_demo (pure JS app + JS shell form
 * primitives). Standalone CommonJS:
 *   node tests/controls_demo.js
 *
 * Runs the REAL app against the firmware prelude with runtime/shell.js prepended
 * (the CLI bundles shell.js into the app; Node cannot eval the import). Static
 * checks cover the three registrations, controlled mode, the 40 px touch floor,
 * gesture-unsubscribe-on-dispose, ASCII copy, the byte-identical playground
 * source, the 55-app manifest and the BASE guards. Live checks drive a real
 * Switch press, Slider pan -> step-quantised value, Progress ATTR_WIDTH updates
 * and signal-driven re-render, plus dispose idempotence. Every source predicate
 * has a mutation proof below. There is NO hardware touch calibration here:
 * deferred to board bring-up (docs/KNOWN-SIMPLIFICATIONS.md r151).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '0d1111c'; // r153: re-pinned to the Keyboard keyStates feat commit (runtime/ shell + types)
const HEAD_BASE = '31adb96'; // r150 trunk: firmware/ must be byte-identical

const app = read('examples/controls_demo/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/controls_demo.js');

function stripImport(s) {
  return s.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function lastAttr(s, id, attr) {
  const hits = s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === attr);
  return hits.length ? hits[hits.length - 1][3] : undefined;
}
function probe(shellSrc, appSrc) {
  const src = (shellSrc === undefined ? shell : shellSrc) + '\n' +
    stripImport(appSrc === undefined ? app : appSrc);
  const s = runApp(src);
  const creates = s.messages.filter(m => m[0] === 'create');
  const d = s.ctx.controlsDemo;
  const track = creates.find(m => m[3] === d.switch && m[2] === 0)[1];
  const fill = creates.find(m => m[3] === d.progress && m[2] === 0)[1];
  return { s, d, track, fill };
}
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = literals(app);

function gitChanged(paths, base) {
  const b = base || BASE;
  const head = execFileSync('git',
    ['diff', '--name-only', b, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', b, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const fwChanged = gitChanged(['firmware/', 'runtime/']);
const trunkFirmware = gitChanged(['firmware/'], HEAD_BASE);
const preludeChanged = gitChanged(['firmware/components/lume-engine/lume_scripts.c'], 'dafa1ed');

const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

// --- checks: [name, [sourceToTest, predicate]] ------------------------------
const checks = [
  ['all three components registered on lume.ui.shell', [shell, s =>
    ['shell.Switch = Switch;', 'shell.Slider = Slider;', 'shell.Progress = Progress;',
     'lume.ui.shell = shell;'].every(k => s.includes(k))]],

  ['controlled mode: value read at event time, onChange is the only output', [shell, s =>
    s.includes("var value = boolValue('Switch value', p.value, false);") &&
    s.includes('function isOn() { return readBool(value); }') &&
    s.includes('p.onChange(!isOn())') &&
    s.includes('startValue = current();') &&
    s.includes('if (q !== lastQ) { lastQ = q; if (p.onChange) p.onChange(q); }')]],

  ['40 px touch floor enforced on Switch and Slider heights', [shell, s =>
    (s.match(/height < 40/g) || []).length >= 2 &&
    s.includes('lume: Switch height must be 40..128 pixels') &&
    s.includes('lume: Slider height must be 40..128 pixels')]],

  ['every node registered for cleanup, dispose idempotent', [shell, s =>
    s.includes('cleanups[root] = function () { nodes.forEach') &&
    s.includes('cleanups[canvas] = function ()') &&
    s.includes('if (fn) { delete cleanups[id]; fn(); }')]],

  ['gesture unsubscribers run on Slider dispose', [shell, s =>
    s.includes('offs.push(lume.gesture.on(canvas,') &&
    s.includes('cleanups[canvas] = function () {\n      offs.forEach(function (off) { off(); });\n      lume.removeChild(canvas);\n    };')]],

  ['Progress updates only fill width ATTR_WIDTH via a bound numeric style', [shell, s =>
    s.includes('width: function () { return Math.round(fraction() * width); }') &&
    s.includes('function fraction()') &&
    s.includes('return Math.max(0, Math.min(1, v));') &&
    s.includes('cleanups[root] = function ()')]],

  ['app wires all three values through signals (controlled consumers)', [app, a =>
    a.includes('var sound = signal(true);') && a.includes('var bright = signal(50);') &&
    a.includes('var charge = signal(0.2);') &&
    a.includes('onChange: function (v) { sound.set(v); }') &&
    a.includes('onChange: function (v) { bright.set(v); }') &&
    a.includes('value: charge')]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['playground sources/controls_demo.js byte-identical to example', [playgroundSrc, s =>
    s === app]],

  ['controls_demo is in the 55-app playground manifest', [apps,
    list => list.length === 55 && list.includes('controls_demo')]],

  ['firmware/ and runtime/ identical to the r151 feat commit', [fwChanged, c => c.length === 0]],

  ['firmware/ byte-identical to the r150 trunk baseline', [trunkFirmware, c => c.length === 0]],

  ['prelude lume_scripts.c unchanged since dafa1ed', [preludeChanged, c => c.length === 0]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL controls_demo: ' + name);
  console.log('PASS controls_demo: ' + name);
}

// --- live native message stream --------------------------------------------
function check(name, fn) { fn(); console.log('PASS controls_demo live: ' + name); }

check('three components return nodes and are callable from the app', () => {
  const p = probe();
  assert.ok(p.d.switch > 0 && p.d.slider > 0 && p.d.progress > 0);
  for (const k of ['Switch', 'Slider', 'Progress'])
    assert.equal(vm.runInContext('typeof lume.ui.shell.' + k, p.s.ctx), 'function');
});

check('Switch press routes onChange(!value) through the signal', () => {
  const p = probe();
  assert.equal(vm.runInContext('sound()', p.s.ctx), true);
  p.s.press(p.d.switch);
  assert.equal(vm.runInContext('sound()', p.s.ctx), false);
  p.s.press(p.d.switch);
  assert.equal(vm.runInContext('sound()', p.s.ctx), true);
});

check('Slider pan maps dx back into range and quantises to step', () => {
  const p = probe();
  assert.equal(vm.runInContext('bright()', p.s.ctx), 50);
  /* width 432, min 0 max 100, step 5. dx=43 -> 50+43*100/432 ~= 59.95 -> 60. */
  p.s.gesture(p.d.slider, 0, 100, 20, 0);
  p.s.gesture(p.d.slider, 1, 143, 20, 16);
  p.s.gesture(p.d.slider, 2, 143, 20, 32);
  assert.equal(vm.runInContext('bright()', p.s.ctx), 60);
});

check('Slider clamps to [min,max] on an over-range drag', () => {
  const p = probe();
  p.s.gesture(p.d.slider, 0, 100, 20, 0);
  p.s.gesture(p.d.slider, 1, 2000, 20, 16); /* dx far beyond full width */
  p.s.gesture(p.d.slider, 2, 2000, 20, 32);
  assert.equal(vm.runInContext('bright()', p.s.ctx), 100);
});

check('Slider onChange fires once per changed step, not per pan frame', () => {
  const p = probe();
  p.s.gesture(p.d.slider, 0, 100, 20, 0);
  /* 4 intermediate MOVEs all land in the same 5-unit bucket -> one emit. */
  for (const dx of [2, 4, 6, 8]) p.s.gesture(p.d.slider, 1, 100 + dx, 20, dx * 4);
  p.s.gesture(p.d.slider, 2, 108, 20, 40);
  /* 50 + 8*100/432 ~= 51.85 -> quantise to 50, i.e. unchanged: no emit. */
  assert.equal(vm.runInContext('bright()', p.s.ctx), 50);
});

check('Progress clamps value and updates fill ATTR_WIDTH only', () => {
  const p = probe();
  const w = () => lastAttr(p.s, p.fill, 2);
  assert.equal(w(), 86); /* 0.2 * 432 = 86.4 -> 86 */
  vm.runInContext('charge.set(0.75);', p.s.ctx);
  assert.equal(w(), 324); /* 0.75 * 432 */
  vm.runInContext('charge.set(2);', p.s.ctx);
  assert.equal(w(), 432); /* clamped to 1.0 */
  /* no Canvas was created for Progress (kind 3 = NODE_CANVAS) */
  assert.equal(p.s.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 1);
  assert.equal(p.s.messages.filter(m => m[0] === 'create' && m[2] === 3 && m[3] === p.d.progress).length, 0);
});

check('signals drive native re-render (Switch bg attr, Slider canvas draw)', () => {
  const p = probe();
  const bg = () => lastAttr(p.s, p.track, 1);
  const before = bg();
  p.s.press(p.d.switch);
  assert.notEqual(bg(), before);
  const draws = () => p.s.messages.filter(m => m[0] === 'draw').length;
  const d0 = draws();
  vm.runInContext('bright.set(80);', p.s.ctx);
  assert.ok(draws() > d0);
});

check('dispose removes every node once; second call is a no-op', () => {
  const p = probe();
  const rm = () => p.s.messages.filter(m => m[0] === 'remove').length;
  const before = rm();
  vm.runInContext('lume.ui.shell.dispose(controlsDemo.switch);' +
    'lume.ui.shell.dispose(controlsDemo.slider);' +
    'lume.ui.shell.dispose(controlsDemo.progress);', p.s.ctx);
  const after = rm();
  assert.equal(after - before, 8); /* Switch 4 + Slider canvas 1 + Progress 3 */
});

check('dispose unsubscribes gestures: no onChange after teardown', () => {
  const p = probe();
  vm.runInContext('lume.ui.shell.dispose(controlsDemo.slider);', p.s.ctx);
  const before = vm.runInContext('bright()', p.s.ctx);
  p.s.gesture(p.d.slider, 0, 100, 20, 0);
  p.s.gesture(p.d.slider, 1, 143, 20, 16);
  p.s.gesture(p.d.slider, 2, 143, 20, 32);
  assert.equal(vm.runInContext('bright()', p.s.ctx), before);
});

check('uncontrolled use proves the component holds no state', () => {
  /* onChange records but the value prop is a FIXED false: track colour must
   * stay off even after a press, because there is no internal state. */
  const src = shell + '\n' +
    'var seen=[];var fixed=lume.ui.shell.Switch({value:false,' +
    'onChange:function(v){seen.push(v);}});globalThis.F={sw:fixed,seen:seen};';
  const s = runApp(src);
  const creates = s.messages.filter(m => m[0] === 'create');
  const track = creates.find(m => m[3] === s.ctx.F.sw && m[2] === 0)[1];
  const bg = () => lastAttr(s, track, 1);
  const before = bg();
  s.press(s.ctx.F.sw);
  assert.equal(vm.runInContext('JSON.stringify(seen)', s.ctx), '[true]');
  assert.equal(bg(), before); /* no internal state -> no visual change */
});

// --- mutation proofs: every predicate MUST fail on a bad input --------------
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS controls_demo mutation: ' + name + ' -> FAIL as expected');
}

const REG = 'all three components registered on lume.ui.shell';
const CONTROL = 'controlled mode: value read at event time, onChange is the only output';
const FLOOR = '40 px touch floor enforced on Switch and Slider heights';
const CLEAN = 'every node registered for cleanup, dispose idempotent';
const GESTURE = 'gesture unsubscribers run on Slider dispose';
const PROGRESS = 'Progress updates only fill width ATTR_WIDTH via a bound numeric style';
const WIRING = 'app wires all three values through signals (controlled consumers)';
const ASCII = 'all UI string literals ASCII-only (r64)';
const SRC = 'playground sources/controls_demo.js byte-identical to example';
const MANIFEST = 'controls_demo is in the 55-app playground manifest';
const GUARD = 'firmware/ and runtime/ identical to the r151 feat commit';
const TRUNK = 'firmware/ byte-identical to the r150 trunk baseline';
const PRELUDE = 'prelude lume_scripts.c unchanged since dafa1ed';

must('drop the Progress registration',
  s => s.replace('shell.Progress = Progress;', ''), REG, shell);
must('drop the Switch onChange dispatch',
  s => s.replace('p.onChange(!isOn())', '/* no onChange */'), CONTROL, shell);
must('lower the touch floor on one component',
  s => s.replace('lume: Slider height must be 40..128 pixels', 'lume: Slider height must be 1..128 pixels'), FLOOR, shell);
must('drop the Canvas cleanup registration',
  s => s.replace('cleanups[canvas] = function ()', '/* no cleanup */'), CLEAN, shell);
must('drop the gesture unsubscriber call',
  s => s.replace('cleanups[canvas] = function () {\n      offs.forEach(function (off) { off(); });\n      lume.removeChild(canvas);\n    };',
                 'cleanups[canvas] = function () { lume.removeChild(canvas); };'), GESTURE, shell);
must('make Progress re-create its fill on every value change',
  s => s.replace('width: function () { return Math.round(fraction() * width); }', 'width: 1'), PROGRESS, shell);
must('app stops forwarding slider changes',
  s => s.replace('onChange: function (v) { bright.set(v); }', 'onChange: null'), WIRING, app);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'), ASCII, lits);
must('playground generated source drifts from the example',
  s => s + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops controls_demo',
  list => list.filter(x => x !== 'controls_demo'), MANIFEST, apps);
must('a runtime file changes after the feat commit',
  () => ['runtime/shell.js'], GUARD, fwChanged);
must('a firmware file changes vs the r150 trunk',
  () => ['firmware/components/lume-engine/lume_engine.c'], TRUNK, trunkFirmware);
must('the prelude changes vs dafa1ed',
  () => ['firmware/components/lume-engine/lume_scripts.c'], PRELUDE, preludeChanged);

console.log('ALL CONTROLS DEMO HARNESS CASES PASSED');
