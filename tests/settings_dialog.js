/*
 * r163 host harness: examples/settings danger actions consumed via shell.Dialog.
 *
 *   node tests/settings_dialog.js
 *
 * Part 1 (static, every predicate mutation-proven): the three dangerous actions
 * (OTA token rotation, system reboot, real power off) open a shell.Dialog with a
 * plain Cancel and a danger Rotate/Reboot/Power off button; the old 3 s
 * arm/confirm signals and timers are gone; the typeof shell.Dialog and binding
 * guards stay; firmware/ runtime/ are byte-identical to the r162 baseline; UI
 * copy is ASCII.
 *
 * Part 2 (live): run the REAL app against the firmware prelude + shell.js and
 * press the generated dialog buttons. Cancel must not execute either action;
 * Rotate/Reboot must. A source mutation that gives Cancel an onPress is used to
 * prove the live Cancel assertion is load-bearing, not decorative.
 *
 * No board here: display contrast, touch feel and real esp_restart() stay
 * deferred to board bring-up (docs/KNOWN-SIMPLIFICATIONS.md r163).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('../tools/lume/node_modules/esbuild');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '9fb12d7'; // r162 baseline: r163 is pure app layer, zero firmware/runtime diff
const app = read('examples/settings/app.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/settings.js');

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}

const ROTATE = sliceBetween(app, 'function rotateOtaToken()',
  '/* ---- r132: OTA status + token rotation END ---- */');
const REBOOT = sliceBetween(app, 'function rebootNow()',
  '/* ---- r143: reboot consumer END ---- */');
const OTA_ROW = sliceBetween(app, '/* r132 OTA ROW BEGIN', '/* r132 OTA ROW END */');
const REBOOT_ROW = sliceBetween(app, '/* r143 REBOOT ROW BEGIN', '/* r143 REBOOT ROW END */');
const lits = literals(app);
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts']; // r166 ColorPicker
const fwChanged = gitChanged(['firmware/', 'runtime/']);

/* ------------------------ part 1: static guards ------------------------ */
const checks = [
  ['shell.js imported once by the documented relative path', [app, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['rotate opens shell.Dialog with title + message', [ROTATE, s =>
    s.includes('shell.Dialog({') && s.includes("title: 'Rotate OTA token?'") &&
    s.includes('message:')]],

  ['Rotate is a danger button; setToken lives in its onPress only', [ROTATE, s => {
    const danger = s.indexOf("{ label: 'Rotate', style: 'danger', onPress: function ()");
    const call = s.indexOf('lume.ota.setToken(');
    return danger >= 0 && call > danger &&
      s.indexOf('Cancel', danger) < 0 &&
      (s.match(/lume\.ota\.setToken\(/g) || []).length === 1;
  }]],

  ['Cancel is plain with no onPress, ordered before the danger button', [ROTATE, s => {
    const cancel = s.indexOf("{ label: 'Cancel', style: 'plain' }");
    const danger = s.indexOf("{ label: 'Rotate', style: 'danger'");
    return cancel >= 0 && danger > cancel &&
      s.slice(cancel, danger).indexOf('onPress') < 0;
  }]],

  ['reboot opens a Dialog with a danger Reboot button', [REBOOT, s =>
    s.includes('shell.Dialog({') && s.includes("title: 'Reboot device?'") &&
    s.includes("{ label: 'Reboot', style: 'danger', onPress: function ()") &&
    s.includes("{ label: 'Cancel', style: 'plain' }")]],

  ['reboot() sits inside the danger onPress, after the typeof guard', [REBOOT, s => {
    const danger = s.indexOf("{ label: 'Reboot', style: 'danger', onPress: function ()");
    const guard = s.indexOf("typeof lume.system.reboot !== 'function'");
    const call = s.indexOf('lume.system.reboot();');
    return danger >= 0 && guard > danger && call > guard &&
      s.includes('!lume.system ||') && s.includes("rebootNote.set('reboot n/a')");
  }]],

  ['all three Dialog guards degrade to ASCII notes (no silent dangerous fallback)', [app, s =>
    (s.match(/typeof shell\.Dialog !== 'function'/g) || []).length === 3 &&
    s.includes("otaNote.set('rotate n/a (no dialog)')") &&
    s.includes("rebootNote.set('reboot n/a (no dialog)')") &&
    s.includes("powerNote.set('power off n/a (no dialog)')")]],

  ['no two-stage confirm signals or arm timers survive', [app, s =>
    !/otaConfirm|rebootConfirm|otaArmTimer|rebootArmTimer|Confirm new token\?|Confirm reboot\?/.test(s)]],

  ['OTA row stays View+Text+Button with a static New token title', [OTA_ROW, s =>
    /View\(\{/.test(s) && /Text\(\{ text: function \(\)/.test(s) &&
    s.includes("title: 'New token', onPress: rotateOtaToken") &&
    s.includes('otaLine()')]],

  ['reboot row stays View+Text+Button with a static Reboot title', [REBOOT_ROW, s =>
    /View\(\{/.test(s) && /Text\(\{ text: function \(\)/.test(s) &&
    s.includes("title: 'Reboot', onPress: rebootNow") &&
    s.includes("rebootNote() === '' ? 'Restart the device' : rebootNote()")]],

  ['playground sources/settings.js byte-identical to example', [playgroundSrc, s => s === app]],

  ['settings is in the 61-app playground manifest', [apps,
    list => list.length === 66 && list.includes('settings')]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['firmware/ runtime/ identical to 9fb12d7 (pure app layer)', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL settings_dialog: ' + name);
  console.log('PASS settings_dialog: ' + name);
}

// --- static mutation proof: every assertion MUST fail when its contract goes --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS settings_dialog mutation: ' + name + ' -> FAIL as expected');
}

must('delete the rotate Dialog call',
  s => s.replace('shell.Dialog({', 'void ({'),
  'rotate opens shell.Dialog with title + message', ROTATE);
must('downgrade Rotate from danger to plain',
  s => s.replace("{ label: 'Rotate', style: 'danger', onPress: function ()",
                 "{ label: 'Rotate', onPress: function ()"),
  'Rotate is a danger button; setToken lives in its onPress only', ROTATE);
must('give Cancel an onPress (Cancel would execute)',
  s => s.replace("{ label: 'Cancel', style: 'plain' }",
                 "{ label: 'Cancel', style: 'plain', onPress: function () {} }"),
  'Cancel is plain with no onPress, ordered before the danger button', ROTATE);
must('delete the reboot Dialog danger Reboot button',
  s => s.replace("{ label: 'Reboot', style: 'danger', onPress: function ()",
                 "{ label: 'Reboot', onPress: function ()"),
  'reboot opens a Dialog with a danger Reboot button', REBOOT);
must('move reboot() before the typeof guard',
  s => s.replace("typeof lume.system.reboot !== 'function'", 'false'),
  'reboot() sits inside the danger onPress, after the typeof guard', REBOOT);
must('harden the Dialog guard (drop all three fallbacks)',
  s => s.replace(/typeof shell\.Dialog !== 'function'/g, 'false'),
  'all three Dialog guards degrade to ASCII notes (no silent dangerous fallback)', app);
must('resurrect the two-stage confirm signal',
  s => s.replace('var otaNote', 'var otaConfirm = signal(false); var otaNote'),
  'no two-stage confirm signals or arm timers survive', app);
must('a non-ASCII UI literal slips in',
  // Built at runtime so this harness file itself stays ASCII-only.
  arr => arr.concat(String.fromCharCode(0x4E2D)),
  'all UI string literals ASCII-only (r64)', lits);
must('a firmware file changes vs 9fb12d7',
  () => ['firmware/components/lume-engine/lume_engine.c'],
  'firmware/ runtime/ identical to 9fb12d7 (pure app layer)', fwChanged);

/* ------------------------ part 2: live Dialog behavior ------------------ */
const EXPOSE = `
globalThis.__r163Rotate = rotateOtaToken;
globalThis.__r163Reboot = rebootNow;
globalThis.__r163OtaNote = otaNote;
globalThis.__r163RebootNote = rebootNote;
`;
function live(source) {
  const bundled = buildSync({
    stdin: { contents: source + EXPOSE, resolveDir: path.join(root, 'examples/settings'),
             sourcefile: 'app.js' },
    bundle: true, format: 'iife', platform: 'neutral', target: 'es2020', write: false,
  }).outputFiles[0].text;
  return runApp(bundled);
}
function openDialog(run, fn) {
  const start = run.messages.length;
  run.ctx[fn]();
  return run.messages.slice(start);
}
function dialogPressIds(msgs) {
  // shell.js registers press handlers in this order: mask, plain Cancel View,
  // danger Button, card. The label Text is a child with NO handler, so pressing
  // its id would be a vacuous test -- press the handler nodes instead.
  const ids = msgs.filter(x => x[0] === 'press').map(x => x[1]);
  assert.equal(ids.length, 4, 'expected mask + cancel + danger + card press handlers');
  return { mask: ids[0], cancel: ids[1], danger: ids[2], card: ids[3] };
}

const run = live(app);
assert.equal(typeof run.lume.ui.shell.Dialog, 'function',
  'shell.js must expose Dialog in the bundled app');

// rotate: Cancel is a no-op, Rotate executes once with a 32-hex token
let setTokenCalls = [];
run.lume.ota.setToken = tok => { setTokenCalls.push(tok); return 0; };
let msgs = openDialog(run, '__r163Rotate');
run.press(dialogPressIds(msgs).cancel);
assert.deepEqual(setTokenCalls, [], 'Cancel must NOT rotate the token');
assert.equal(run.ctx.__r163OtaNote(), '', 'Cancel must not write an ota note');
console.log('PASS settings_dialog live: rotate Cancel -> no setToken');

msgs = openDialog(run, '__r163Rotate');
run.press(dialogPressIds(msgs).danger);
assert.equal(setTokenCalls.length, 1, 'Rotate must call setToken exactly once');
assert.match(setTokenCalls[0], /^[0-9a-f]{32}$/, 'replacement token is 32 lowercase hex');
assert.equal(run.ctx.__r163OtaNote(), '', 'success clears the ota note');
console.log('PASS settings_dialog live: rotate Rotate -> setToken(32hex)');

// setToken failure keeps the ASCII error-code feedback
run.lume.ota.setToken = () => -7;
msgs = openDialog(run, '__r163Rotate');
run.press(dialogPressIds(msgs).danger);
assert.equal(run.ctx.__r163OtaNote(), 'setToken err -7',
  'danger onPress must preserve setToken error feedback');
console.log('PASS settings_dialog live: setToken failure -> ASCII err note');

// reboot: Cancel is a no-op, Reboot calls the guarded binding exactly once
let reboots = 0;
run.lume.system.reboot = () => { reboots++; };
msgs = openDialog(run, '__r163Reboot');
run.press(dialogPressIds(msgs).cancel);
assert.equal(reboots, 0, 'Cancel must NOT reboot');
console.log('PASS settings_dialog live: reboot Cancel -> no reboot');

msgs = openDialog(run, '__r163Reboot');
run.press(dialogPressIds(msgs).danger);
assert.equal(reboots, 1, 'Reboot must call the binding exactly once');
console.log('PASS settings_dialog live: reboot Reboot -> one reboot');

// reboot binding stub: the typeof guard stays inside the danger callback
delete run.lume.system.reboot;
msgs = openDialog(run, '__r163Reboot');
run.press(dialogPressIds(msgs).danger);
assert.equal(run.ctx.__r163RebootNote(), 'reboot n/a',
  'stub without reboot binding must degrade to ASCII note');
console.log('PASS settings_dialog live: reboot binding stub -> reboot n/a');

// Dialog stub: no Dialog means a note, never an auto-executed dangerous action
const stubRun = live(app);
stubRun.lume.ui.shell.Dialog = undefined;
let stubTokens = 0, stubReboots = 0;
stubRun.lume.ota.setToken = () => { stubTokens++; return 0; };
stubRun.lume.system.reboot = () => { stubReboots++; };
stubRun.ctx.__r163Rotate();
stubRun.ctx.__r163Reboot();
assert.equal(stubTokens, 0, 'Dialog stub must not rotate the token');
assert.equal(stubReboots, 0, 'Dialog stub must not reboot');
assert.equal(stubRun.ctx.__r163OtaNote(), 'rotate n/a (no dialog)');
assert.equal(stubRun.ctx.__r163RebootNote(), 'reboot n/a (no dialog)');
console.log('PASS settings_dialog live: Dialog stub -> ASCII notes, no auto action');

// live mutation proof: a Cancel with an onPress really would execute the action.
// Scope the edit to the ROTATE slice: powerOff now also owns a plain Cancel and
// sits earlier in the file, so a bare app.replace() would mutate the wrong one.
const badRotate = ROTATE.replace("{ label: 'Cancel', style: 'plain' }",
  "{ label: 'Cancel', style: 'plain', onPress: function () { lume.ota.setToken('bad'); } }");
const bad = app.replace(ROTATE, badRotate);
assert.notEqual(bad, app, 'live mutation did not change source');
const badRun = live(bad);
let badCalls = 0;
badRun.lume.ota.setToken = () => { badCalls++; return 0; };
const badMsgs = openDialog(badRun, '__r163Rotate');
badRun.press(dialogPressIds(badMsgs).cancel);
assert.ok(badCalls > 0, 'live Cancel assertion is decorative; mutation did not FAIL');
console.log('PASS settings_dialog live mutation: Cancel with onPress -> FAIL as expected');

console.log('ALL SETTINGS DIALOG HARNESS CASES PASSED');
