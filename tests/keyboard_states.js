/* r153 host harness for shell.Keyboard per-key keyStates tint.
 * Standalone CommonJS:
 *   node tests/keyboard_states.js
 *
 * Runs the REAL firmware prelude plus runtime/shell.js with a minimal host app
 * that mounts a Keyboard with keyStates. It observes the native message stream
 * (ATTR_BG_COLOR = 1) to prove: the three verdicts tint the matching key caps,
 * unknown letters / control keys are ignored, an absent keyStates keeps the
 * r148 colours, a signal publish rewrites only key backgrounds (no node
 * rebuild), and dispose + re-mount applies fresh state. Every source predicate
 * has a mutation proof and the live tint path has a live mutation proof, so no
 * assertion is decorative. No on-device touch feel: deferred to board bring-up
 * (docs/KNOWN-SIMPLIFICATIONS.md r153).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)
const shell = read('runtime/shell.js');
const types = read('runtime/types/lume.d.ts');

const TINT = {
  hit: 0x166B3E, present: 0x8A6A12, miss: 0x30343E,
  DEFAULT: 0x132435, ACCENT: 0x40D8B0, DANGER: 0xFF6B79,
};

function lastAttr(s, id, attr) {
  const hits = s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === attr);
  return hits.length ? hits[hits.length - 1][3] : undefined;
}

/* Build the host app. `noStates` omits the prop entirely (r148 contract);
 * `getter` uses a plain function instead of a signal; otherwise a signal is
 * created from the given initial map literal. */
function appSrc(init, noStates, getter) {
  const prop = noStates ? '' : 'keyStates: sts';
  const decl = getter
    ? 'var sts = function () { return ' + (init || '{}') + '; };'
    : 'var sts = signal(' + (init || '{}') + ');';
  return decl + '\nvar kb = lume.ui.shell.Keyboard({' + prop + '});\n' +
    'globalThis.KS_ST = sts; globalThis.KS_KB = kb;';
}
function probe(shellSrc, options) {
  options = options || {};
  const src = (shellSrc === undefined ? shell : shellSrc) + '\n' +
    appSrc(options.init, options.noStates, options.getter);
  const s = runApp(src);
  const creates = s.messages.filter(m => m[0] === 'create');
  const rows = creates.filter(m => m[2] === 0 && m[3] === s.ctx.KS_KB).map(m => m[1]);
  const rowSet = new Set(rows);
  const keys = creates.filter(m => m[2] === 2 && rowSet.has(m[3])).map(m => m[1]);
  const labelOf = id => lastAttr(s, id, 0);
  const bgOf = id => lastAttr(s, id, 1);
  const key = label => {
    const id = keys.find(k => labelOf(k) === label);
    assert.ok(id !== undefined, 'missing key: ' + label + ' labels=' + keys.map(labelOf).join(''));
    return id;
  };
  return { s, rows, keys, labelOf, bgOf, key };
}

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
const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r183: SVG raster-result cache (engine component only).
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_svg_cache.c',
  'firmware/components/lume-engine/include/lume_svg_cache.h',
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
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const preludeChanged = gitChanged(['firmware/components/lume-engine/lume_scripts.c'], '3514c76');

/* ------------------------- part 1: static source ----------------------- */
const checks = [
  ['three-state tint table maps Wordle verdicts to green/yellow/grey', [shell, s =>
    s.includes("var KEY_STATE_TINTS = { hit: '#166B3E', present: '#8A6A12', miss: '#30343E' };")]],

  ['keyStates validated as object or signal function before any node', [shell, s =>
    s.includes("typeof keyStates !== 'function' &&") &&
    s.includes("throw new TypeError('lume: Keyboard keyStates must be an object or a signal function')")]],

  ['each letter key binds its own per-key background getter', [shell, s =>
    s.includes('function letterBackground(ch) {') &&
    s.includes('KEY_STATE_TINTS[states[ch]]') &&
    s.includes('return key(ch.toUpperCase(), keySize, function () { if (p.onKey) p.onKey(ch); },\n          letterBackground(ch));')]],

  ['absent keyStates returns the exact r148 colour helper', [shell, s =>
    s.includes('if (keyStates === undefined) return fallback;')]],

  ['SPACE / BKSP / ENTER keep their fixed control backgrounds', [shell, s =>
    s.includes("key('SPACE', spaceWidth") &&
    s.includes("key('BKSP', keySize, function () { if (p.onBackspace) p.onBackspace(); }, color('danger', '#FF6B79'))") &&
    s.includes("key('ENTER', keySize, function () { if (p.onSubmit) p.onSubmit(); }, color('accent', '#40D8B0'))")]],

  ['cleanup chain still removes every keyboard node idempotently', [shell, s =>
    s.includes('cleanups[root] = function () { nodes.forEach(function (id) { lume.removeChild(id); }); };')]],

  ['lume.d.ts declares the three states and the keyStates prop', [types, s =>
    s.includes("type KeyboardKeyState = 'hit' | 'present' | 'miss';") &&
    s.includes('keyStates?: KeyboardKeyStates | (() => KeyboardKeyStates);')]],

  ['firmware/ runtime/ tools/lume/ identical to the feat commit', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
  ['prelude lume_scripts.c unchanged since 3514c76', [preludeChanged, c => c.length === 0]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL keyboard_states static: ' + name);
  console.log('PASS keyboard_states static: ' + name);
}
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS keyboard_states mutation: ' + name + ' -> FAIL as expected');
}
const TABLE = checks[0][0];
const VALID = checks[1][0];
const BIND = checks[2][0];
const ABSENT = checks[3][0];
const CONTROL = checks[4][0];
const TYPES = checks[6][0];

must('recolour the present verdict',
  s => s.replace("present: '#8A6A12'", "present: '#000000'"), TABLE, shell);
must('drop keyStates type validation',
  s => s.replace("throw new TypeError('lume: Keyboard keyStates must be an object or a signal function')", ''), VALID, shell);
must('query the wrong (uppercase) key name',
  s => s.replace('KEY_STATE_TINTS[states[ch]]', 'KEY_STATE_TINTS[states[ch.toUpperCase()]]'), BIND, shell);
must('drop the absent-prop r148 fallback',
  s => s.replace('if (keyStates === undefined) return fallback;', ''), ABSENT, shell);
must('tint the ENTER control key',
  s => s.replace(', color(\'accent\', \'#40D8B0\'))', ')'), CONTROL, shell);
must('drop keyStates from the type contract',
  s => s.replace('keyStates?: KeyboardKeyStates | (() => KeyboardKeyStates);', ''), TYPES, types);
must('a firmware/runtime/CLI file changes after the feat commit',
  () => ['firmware/components/lume-engine/lume_scripts.c'], checks[7][0], fwChanged);
must('the prelude changes vs 3514c76',
  () => ['firmware/components/lume-engine/lume_scripts.c'], checks[8][0], preludeChanged);

/* -------------------------- part 2: live stream ------------------------ */
function check(name, fn) { fn(); console.log('PASS keyboard_states live: ' + name); }

check('hit / present / miss tint the matching key caps only', () => {
  const p = probe(shell, { init: "{a:'hit', b:'present', c:'miss', z:'hit'}" });
  assert.equal(p.bgOf(p.key('A')), TINT.hit);
  assert.equal(p.bgOf(p.key('B')), TINT.present);
  assert.equal(p.bgOf(p.key('C')), TINT.miss);
  assert.equal(p.bgOf(p.key('Z')), TINT.hit);
  assert.equal(p.bgOf(p.key('D')), TINT.DEFAULT, 'unlisted letter keeps default');
});

check('unknown map keys and uppercase keys are ignored', () => {
  const p = probe(shell, { init: "{'1':'hit', ENTER:'hit', A:'hit'}" });
  assert.equal(p.bgOf(p.key('A')), TINT.DEFAULT, 'uppercase A must not match lowercase a');
  assert.equal(p.bgOf(p.key('ENTER')), TINT.ACCENT);
  assert.equal(p.bgOf(p.key('BKSP')), TINT.DANGER);
  assert.equal(p.bgOf(p.key('SPACE')), TINT.DEFAULT);
});

check('absent keyStates keeps every r148 letter colour and control key', () => {
  const p = probe(shell, { noStates: true });
  const letters = p.keys.filter(id => /^[A-Z]$/.test(p.labelOf(id)));
  assert.equal(letters.length, 26);
  for (const id of letters) assert.equal(p.bgOf(id), TINT.DEFAULT);
  assert.equal(p.bgOf(p.key('ENTER')), TINT.ACCENT);
  assert.equal(p.bgOf(p.key('BKSP')), TINT.DANGER);
});

check('a plain getter (non-signal) also supplies the tint', () => {
  const p = probe(shell, { init: "{a:'miss'}", getter: true });
  assert.equal(p.bgOf(p.key('A')), TINT.miss);
  assert.equal(p.bgOf(p.key('B')), TINT.DEFAULT);
});

check('publishing a new state map rewrites only key backgrounds, no nodes', () => {
  const p = probe(shell, { init: "{a:'hit', b:'miss'}" });
  const A = p.key('A'), B = p.key('B'), C = p.key('C');
  assert.equal(p.bgOf(A), TINT.hit);
  assert.equal(p.bgOf(B), TINT.miss);
  const before = p.s.messages.length;
  const createsBefore = p.s.messages.filter(m => m[0] === 'create').length;
  vm.runInContext("KS_ST.set({a:'hit', b:'hit'})", p.s.ctx);
  const fresh = p.s.messages.slice(before);
  assert.equal(p.bgOf(A), TINT.hit, 'unchanged key stays green');
  assert.equal(p.bgOf(B), TINT.hit, 'changed key turns green');
  assert.equal(p.bgOf(C), TINT.DEFAULT);
  assert.equal(p.s.messages.filter(m => m[0] === 'create').length, createsBefore,
    'no node was rebuilt on state publish');
  const bgWrites = fresh.filter(m => m[0] === 'attr' && m[2] === 1);
  assert.ok(bgWrites.length > 0, 'background ATTRs were written');
  assert.ok(bgWrites.every(m => m[1] !== p.key('ENTER')), 'no control key was written');
});

check('dispose then re-mount applies fresh state; dispose stays idempotent', () => {
  const p = probe(shell, { init: "{a:'hit'}" });
  const removed0 = p.s.messages.filter(m => m[0] === 'remove').length;
  vm.runInContext('lume.ui.shell.dispose(KS_KB)', p.s.ctx);
  const removed1 = p.s.messages.filter(m => m[0] === 'remove').length;
  assert.equal(removed1 - removed0, 33, 'all 33 nodes removed once');
  vm.runInContext('lume.ui.shell.dispose(KS_KB)', p.s.ctx);
  assert.equal(p.s.messages.filter(m => m[0] === 'remove').length, removed1, 'second dispose no-op');
  const mark = p.s.messages.length;
  vm.runInContext("var st2=signal({b:'present'}); var kb2=lume.ui.shell.Keyboard({keyStates:st2}); globalThis.KS_KB2=kb2;", p.s.ctx);
  const creates = p.s.messages.slice(mark).filter(m => m[0] === 'create');
  const rows = creates.filter(m => m[2] === 0 && m[3] === p.s.ctx.KS_KB2).map(m => m[1]);
  const keys = creates.filter(m => m[2] === 2 && new Set(rows).has(m[3])).map(m => m[1]);
  const labelOf = id => p.s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === 0).pop()[3];
  const bgOf = id => p.s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === 1).pop()[3];
  const B = keys.find(id => labelOf(id) === 'B'), A = keys.find(id => labelOf(id) === 'A');
  assert.equal(bgOf(B), TINT.present, 're-mounted keyboard applies the new state');
  assert.equal(bgOf(A), TINT.DEFAULT, 'old state is gone after re-mount');
});

check('non-object / non-function keyStates is rejected before nodes are built', () => {
  for (const expr of ['1', "'hit'", '[]', 'null']) {
    assert.throws(() => runApp(shell + '\nlume.ui.shell.Keyboard({keyStates:' + expr + '});'),
      /Keyboard keyStates must be an object or a signal function/, expr);
  }
});

/* Live mutation proof: breaking the key-name lookup must turn the live tint
 * check red, proving the assertion above is load-bearing (not decorative). */
function liveMutation(name, mutateShell, init, predicate) {
  const mutated = mutateShell(shell);
  assert.notEqual(mutated, shell, 'mutation did not change shell source: ' + name);
  const p = probe(mutated, { init });
  assert.equal(predicate(p), false, 'live assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS keyboard_states live mutation: ' + name + ' -> FAIL as expected');
}
liveMutation('wrong key name loses every cap tint',
  s => s.replace('KEY_STATE_TINTS[states[ch]]', 'KEY_STATE_TINTS[states[ch.toUpperCase()]]'),
  "{a:'hit'}", p => p.bgOf(p.key('A')) === TINT.hit);
liveMutation('dropping the verdict mapping paints no cap',
  s => s.replace('var KEY_STATE_TINTS = { hit: \'#166B3E\', present: \'#8A6A12\', miss: \'#30343E\' };',
    'var KEY_STATE_TINTS = {};'),
  "{a:'hit'}", p => p.bgOf(p.key('A')) === TINT.hit);

console.log('ALL KEYBOARD STATES HARNESS CASES PASSED');
