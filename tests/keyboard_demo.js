/* r148 host harness for examples/keyboard_demo (pure JS app + JS shell Keyboard).
 * Standalone CommonJS:
 *   node tests/keyboard_demo.js
 *
 * Runs the REAL app against the firmware prelude with runtime/shell.js prepended
 * (the CLI bundles shell.js into the app; Node cannot eval the import). It then
 * observes the native message stream: four rows / 29 keys, QWERTY labels, 40 px
 * touch targets, and onKey / onBackspace / onSubmit routing through real Button
 * presses. Static checks cover ASCII copy, the byte-identical playground source,
 * the 53-app manifest, and the BASE guard. Every source predicate has a mutation
 * proof below. There is NO hardware touch calibration here: deferred to
 * board bring-up (docs/KNOWN-SIMPLIFICATIONS.md r148).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = 'bbd8627'; // r148: shell Keyboard feat commit (runtime/ shell + types + api)

const app = read('examples/keyboard_demo/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/keyboard_demo.js');
const QWERTY = 'QWERTYUIOPASDFGHJKLZXCVBNM';

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}
const wiring = sliceBetween(app, 'var keyboard = lume.ui.shell.Keyboard({', '\n});');

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
  const rows = creates.filter(m => m[3] === s.ctx.kb && m[2] === 0).map(m => m[1]);
  const rowSet = new Set(rows);
  const keys = creates.filter(m => m[2] === 2 && rowSet.has(m[3])).map(m => m[1]);
  const labels = keys.map(id => lastAttr(s, id, 0));
  return { s, rows, keys, labels };
}
function press(p, label) {
  const i = p.labels.indexOf(label);
  assert.ok(i >= 0, 'missing key: ' + label);
  p.s.press(p.keys[i]);
}
const texts = (p, id) => p.s.messages
  .filter(m => m[0] === 'attr' && m[1] === id && m[2] === 0).map(m => m[3]);
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
const preludeChanged = gitChanged(['firmware/components/lume-engine/lume_scripts.c'], 'dafa1ed');

const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

const labelString = probe().labels.join('');

// --- checks: [name, [sourceToTest, predicate]] ------------------------------
// Mutation proof calls the SAME predicate on a mutated copy, so each assertion
// is load-bearing rather than decorative.
const checks = [
  ['Keyboard registered on lume.ui.shell via the existing attach point', [shell, s =>
    s.includes('shell.Keyboard = Keyboard;') && s.includes('lume.ui.shell = shell;')]],

  ['all three callbacks validated through the shell callback() helper', [shell, s =>
    ["callback('Keyboard onKey', p.onKey)", "callback('Keyboard onBackspace', p.onBackspace)",
     "callback('Keyboard onSubmit', p.onSubmit)"].every(k => s.includes(k))]],

  ['three QWERTY rows plus SPACE / BKSP / ENTER, all ASCII', [shell, s =>
    s.includes("var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];") &&
    ["key('SPACE'", "key('BKSP'", "key('ENTER'"].every(k => s.includes(k))]],

  ['40 px touch floor and theme.spacing-derived key sizing', [shell, s =>
    s.includes('keySize < 40') &&
    s.includes('Math.min(spacing === undefined ? 8 : spacing, maxGap)')]],

  ['onKey / onBackspace / onSubmit dispatch into the app callbacks', [shell, s =>
    s.includes('if (p.onKey) p.onKey(ch);') && s.includes("if (p.onKey) p.onKey(' ');") &&
    s.includes('if (p.onBackspace) p.onBackspace();') &&
    s.includes('if (p.onSubmit) p.onSubmit();')]],

  ['cleanup registered on the root through the existing dispose chain', [shell, s =>
    s.includes('cleanups[root] = function () { nodes.forEach')]],

  ['app wires onKey / onBackspace / onSubmit to its signals', [wiring, s =>
    s.includes('onKey: function (ch) { typed.set(typed() + ch); }') &&
    s.includes('onBackspace: function () { typed.set(typed().slice(0, -1)); }') &&
    s.includes("onSubmit: function () { submitted.set(typed()); typed.set(''); }")]],

  ['native nodes carry the 26 letters + SPACE + BKSP + ENTER labels', [labelString, s =>
    s === QWERTY + 'SPACEBKSPENTER']],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['playground sources/keyboard_demo.js byte-identical to example', [playgroundSrc, s =>
    s === app]],

  ['keyboard_demo is in the 53-app playground manifest', [apps,
    list => list.length === 53 && list.includes('keyboard_demo')]],

  ['firmware/ and runtime/ identical to bbd8627', [fwChanged, c => c.length === 0]],

  ['prelude lume_scripts.c unchanged since dafa1ed', [preludeChanged, c => c.length === 0]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL keyboard_demo: ' + name);
  console.log('PASS keyboard_demo: ' + name);
}

// --- live native message stream --------------------------------------------
function check(name, fn) { fn(); console.log('PASS keyboard_demo live: ' + name); }

check('Keyboard returns a root node and is callable from the app', () => {
  const p = probe();
  assert.ok(p.s.ctx.kb > 0);
  assert.equal(vm.runInContext('typeof lume.ui.shell.Keyboard', p.s.ctx), 'function');
});
check('mounts exactly 4 row Views and 29 Buttons under the keyboard root', () => {
  const p = probe();
  assert.equal(p.rows.length, 4);
  assert.equal(p.keys.length, 29);
});
check('every key keeps a >=40 px touch target; SPACE is wider', () => {
  const p = probe();
  for (let i = 0; i < p.keys.length; i++) {
    const w = lastAttr(p.s, p.keys[i], 2), h = lastAttr(p.s, p.keys[i], 3);
    assert.ok(w >= 40 && h >= 40, p.labels[i] + ' ' + w + 'x' + h);
  }
  assert.ok(lastAttr(p.s, p.keys[26], 2) > lastAttr(p.s, p.keys[0], 2));
});
check('onKey routes letter and SPACE presses through the signal', () => {
  const p = probe();
  press(p, 'Q'); assert.equal(texts(p, p.s.ctx.kbDisplay).at(-1), 'q');
  press(p, 'SPACE'); assert.equal(texts(p, p.s.ctx.kbDisplay).at(-1), 'q ');
});
check('onBackspace removes exactly one character', () => {
  const p = probe();
  press(p, 'Q'); press(p, 'W'); press(p, 'BKSP');
  assert.equal(texts(p, p.s.ctx.kbDisplay).at(-1), 'q');
});
check('onSubmit freezes the line and resets the input', () => {
  const p = probe();
  press(p, 'Q'); press(p, 'ENTER');
  assert.equal(texts(p, p.s.ctx.kbResult).at(-1), 'Submitted: q');
  assert.equal(texts(p, p.s.ctx.kbDisplay).at(-1), '_');
});
check('non-function callbacks are rejected before any node is built', () => {
  ['onKey', 'onBackspace', 'onSubmit'].forEach(opt =>
    assert.throws(() => probe(shell, 'globalThis.bad=lume.ui.shell.Keyboard({' + opt + ':1});'),
      new RegExp(opt)));
});
check('dispose removes all 33 keyboard nodes once, second call is a no-op', () => {
  const p = probe();
  const before = p.s.messages.filter(m => m[0] === 'remove').length;
  vm.runInContext('lume.ui.shell.dispose(kb)', p.s.ctx);
  const after = p.s.messages.filter(m => m[0] === 'remove').length;
  assert.equal(after - before, 33);
  vm.runInContext('lume.ui.shell.dispose(kb)', p.s.ctx);
  assert.equal(p.s.messages.filter(m => m[0] === 'remove').length, after);
});

// --- mutation proofs: every predicate MUST fail on a bad input --------------
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS keyboard_demo mutation: ' + name + ' -> FAIL as expected');
}

const REG = 'Keyboard registered on lume.ui.shell via the existing attach point';
const VALID = 'all three callbacks validated through the shell callback() helper';
const ROWS = 'three QWERTY rows plus SPACE / BKSP / ENTER, all ASCII';
const FLOOR = '40 px touch floor and theme.spacing-derived key sizing';
const DISPATCH = 'onKey / onBackspace / onSubmit dispatch into the app callbacks';
const CLEAN = 'cleanup registered on the root through the existing dispose chain';
const WIRING = 'app wires onKey / onBackspace / onSubmit to its signals';
const LABELS = 'native nodes carry the 26 letters + SPACE + BKSP + ENTER labels';
const ASCII = 'all UI string literals ASCII-only (r64)';
const SRC = 'playground sources/keyboard_demo.js byte-identical to example';
const MANIFEST = 'keyboard_demo is in the 53-app playground manifest';
const GUARD = 'firmware/ and runtime/ identical to bbd8627';
const PRELUDE = 'prelude lume_scripts.c unchanged since dafa1ed';

must('drop the shell.Keyboard registration',
  s => s.replace('shell.Keyboard = Keyboard;', ''), REG, shell);
must('drop onSubmit validation',
  s => s.replace("callback('Keyboard onSubmit', p.onSubmit);", ''), VALID, shell);
must('shrink QWERTY to two rows',
  s => s.replace("var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];",
                 "var KEY_ROWS = ['qwertyuiop', 'asdfghjkl'];"), ROWS, shell);
must('drop the ENTER control key',
  s => s.replace("key('ENTER', keySize, function () { if (p.onSubmit) p.onSubmit(); }, color('accent', '#40D8B0')),", ''), ROWS, shell);
must('lower the touch target floor below 40 px',
  s => s.replace('keySize < 40', 'keySize < 1'), FLOOR, shell);
must('drop theme.spacing derivation',
  s => s.replace('Math.min(spacing === undefined ? 8 : spacing, maxGap)', '8'), FLOOR, shell);
must('drop onBackspace dispatch',
  s => s.replace('if (p.onBackspace) p.onBackspace();', ''), DISPATCH, shell);
must('drop SPACE dispatch',
  s => s.replace("if (p.onKey) p.onKey(' ');", ''), DISPATCH, shell);
must('drop the cleanup registration',
  s => s.replace('cleanups[root] = function () { nodes.forEach(function (id) { lume.removeChild(id); }); };', ''), CLEAN, shell);
must('app stops forwarding onKey',
  s => s.replace('onKey: function (ch) { typed.set(typed() + ch); }', 'onKey: null'), WIRING, wiring);
must('a key label drifts from QWERTY',
  s => s.slice(0, -1) + 'X', LABELS, labelString);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'), ASCII, lits);
must('playground generated source drifts from the example',
  s => s + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops keyboard_demo',
  list => list.filter(x => x !== 'keyboard_demo'), MANIFEST, apps);
must('a firmware/runtime file changes after the feat commit',
  () => ['runtime/shell.js'], GUARD, fwChanged);
must('the prelude changes vs dafa1ed',
  () => ['firmware/components/lume-engine/lume_scripts.c'], PRELUDE, preludeChanged);

console.log('ALL KEYBOARD DEMO HARNESS CASES PASSED');
