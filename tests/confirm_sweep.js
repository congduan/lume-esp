/*
 * r164 host harness: the two-stage confirm sweep (pure app layer).
 *
 *   node tests/confirm_sweep.js
 *
 * Part 1 (static, every predicate mutation-proven): the last two two-stage
 * arm/confirm gates in examples/ -- settings power off and hr_monitor BLE
 * advertise/stop -- are shell.Dialog modals with a plain Cancel and a danger
 * button. Both binding guards live INSIDE the danger callback; Cancel / mask /
 * card / a stub without Dialog can never call powerOff / startAdv / stopAdv.
 * No powerConfirm / toggleArm signal survives in any example app, UI copy is
 * ASCII, and firmware/ runtime/ are byte-identical to the r164 feat commit.
 *
 * Part 2 (live): run the REAL apps against the firmware prelude + shell.js and
 * press the generated dialog handler nodes. Cancel/mask -> 0 actions; danger
 * -> powerOff / startAdv / stopAdv exactly once; a missing binding or a Dialog
 * stub degrades to an ASCII note with 0 actions. A Cancel with an injected
 * onPress is used to prove each live Cancel assertion is load-bearing.
 *
 * No board here: real power-off, BLE radio, dialog touch feel and contrast stay
 * deferred to board bring-up (docs/KNOWN-SIMPLIFICATIONS.md r164).
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
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)

const settings = read('examples/settings/app.js');
const hrSrc = read('examples/hr_monitor/app.js');
const harness = read('tests/confirm_sweep.js');
const exampleDirs = fs.readdirSync(path.join(root, 'examples'))
  .filter(d => fs.existsSync(path.join(root, 'examples', d, 'app.js')));
const allApps = exampleDirs.map(d => read('examples/' + d + '/app.js'));
const settingsIdx = allApps.indexOf(settings);
const hrIdx = allApps.indexOf(hrSrc);
assert.ok(settingsIdx >= 0 && hrIdx >= 0, 'both target apps must be in examples/');

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

const POWER = sliceBetween(settings,
  '/* ---- r164: power off consumer (pure app layer) BEGIN',
  '/* ---- r164: power off consumer END ---- */');
const BLE = sliceBetween(hrSrc,
  '/* r164: BLE advertise/stop gate BEGIN',
  '/* r164: BLE advertise/stop gate END */');
const lits = [...literals(settings), ...literals(hrSrc), ...literals(harness)];
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
  // r179: WiFi PS/coexist knife -- lume-net PS call + sdkconfig (incl. generated).
  'firmware/components/lume-net/lume_net.c', 'firmware/sdkconfig',
  'firmware/sdkconfig.defaults',
];
const fwChanged = gitChanged(['firmware/', 'runtime/']);

/* ------------------------ part 1: static guards ------------------------ */
const checks = [
  ['power off opens a Dialog with title, message, plain Cancel and danger button', [POWER, s => {
    const dlg = s.indexOf('shell.Dialog({');
    const cancel = s.indexOf("{ label: 'Cancel', style: 'plain' }");
    const danger = s.indexOf("{ label: 'Power off', style: 'danger', onPress: function ()");
    const call = s.indexOf('lume.pmic.powerOff();');
    return s.includes("title: 'Power off'") && s.includes('message:') &&
      dlg >= 0 && cancel > dlg && danger > cancel && call > danger &&
      s.slice(cancel, danger).indexOf('onPress') < 0;
  }]],

  ['powerOff binding guard sits inside the danger onPress', [POWER, s => {
    const danger = s.indexOf("{ label: 'Power off', style: 'danger', onPress: function ()");
    const guard = s.indexOf("typeof lume.pmic.powerOff !== 'function'", danger);
    const call = s.indexOf('lume.pmic.powerOff();', danger);
    return danger >= 0 && guard > danger && call > guard &&
      s.includes('!lume.pmic ||') && s.includes("powerNote.set('power off n/a')");
  }]],

  ['power off Dialog guard degrades to an ASCII note', [POWER, s =>
    s.includes("typeof shell.Dialog !== 'function'") &&
    s.includes("powerNote.set('power off n/a (no dialog)')")]],

  ['BLE gate opens a Dialog with a plain Cancel and danger start/stop button', [BLE, s => {
    const dlg = s.indexOf('shell.Dialog({');
    const cancel = s.indexOf("{ label: 'Cancel', style: 'plain' }");
    const danger = s.indexOf("style: 'danger', onPress: function ()", cancel);
    const act = s.indexOf('if (advertising()) stopAdv(); else startAdv();', danger);
    return s.includes('shell.Dialog({') && s.includes('message:') &&
      dlg >= 0 && cancel > dlg && danger > cancel && act > danger &&
      s.slice(cancel, danger).indexOf('onPress') < 0;
  }]],

  ['BLE binding guard sits inside the danger onPress', [BLE, s => {
    const guard = s.indexOf("typeof lume.ble === 'undefined'");
    const act = s.indexOf('if (advertising()) stopAdv(); else startAdv();', guard);
    return guard >= 0 && act > guard &&
      s.includes("note.set('BLE n/a (no stack)')");
  }]],

  ['BLE Dialog guard degrades to an ASCII note', [BLE, s =>
    s.includes("typeof shell.Dialog !== 'function'") &&
    s.includes("note.set('BLE n/a (no dialog)')")]],

  ['no two-stage confirm signal survives in any example app', [allApps, arr =>
    arr.length > 0 && arr.every(s =>
      !/powerConfirm|toggleArm|Confirm off\?|Confirm adv\?|Confirm stop\?/.test(s))]],

  ['both buttons are free of the confirm flip; BLE title is a static-anchorable expression',
    [settings + hrSrc, s =>
      !s.includes("'Confirm off?'") && !s.includes("'Confirm adv?'") &&
      !s.includes("'Confirm stop?'") &&
      s.includes("advertising() ? 'Stop adv' : 'Start adv'") &&
      s.includes("return powerNote() === '' ? 'Power off' : powerNote();")]],

  ['all UI string literals ASCII-only in both apps and this harness', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['firmware/ runtime/ identical to the r164 feat commit', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL confirm_sweep: ' + name);
  console.log('PASS confirm_sweep: ' + name);
}

// --- static mutation proof: every assertion MUST fail when its contract goes --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS confirm_sweep mutation: ' + name + ' -> FAIL as expected');
}

must('delete the power off Dialog call',
  s => s.replace('shell.Dialog({', 'void ({'),
  'power off opens a Dialog with title, message, plain Cancel and danger button', POWER);
must('give power Cancel an onPress',
  s => s.replace("{ label: 'Cancel', style: 'plain' }",
                 "{ label: 'Cancel', style: 'plain', onPress: function () {} }"),
  'power off opens a Dialog with title, message, plain Cancel and danger button', POWER);
must('move powerOff() before the binding guard',
  s => s.replace("typeof lume.pmic.powerOff !== 'function'", 'false'),
  'powerOff binding guard sits inside the danger onPress', POWER);
must('delete the BLE Dialog call',
  s => s.replace('shell.Dialog({', 'void ({'),
  'BLE gate opens a Dialog with a plain Cancel and danger start/stop button', BLE);
must('give BLE Cancel an onPress',
  s => s.replace("{ label: 'Cancel', style: 'plain' }",
                 "{ label: 'Cancel', style: 'plain', onPress: function () {} }"),
  'BLE gate opens a Dialog with a plain Cancel and danger start/stop button', BLE);
must('drop the BLE binding guard',
  s => s.replace("typeof lume.ble === 'undefined'", 'false'),
  'BLE binding guard sits inside the danger onPress', BLE);
must('resurrect the powerConfirm signal',
  arr => arr.map((s, i) => i === settingsIdx ? s.replace('var powerNote', 'var powerConfirm = signal(false); var powerNote') : s),
  'no two-stage confirm signal survives in any example app', allApps);
must('resurrect the toggleArm signal',
  arr => arr.map((s, i) => i === hrIdx ? s.replace('var advertising', 'var toggleArm = signal(false); var advertising') : s),
  'no two-stage confirm signal survives in any example app', allApps);
must('a non-ASCII UI literal slips in',
  arr => arr.concat(String.fromCharCode(0x4E2D)),
  'all UI string literals ASCII-only in both apps and this harness', lits);
must('a firmware file changes vs the feat commit',
  // r183: engine.c is now allowlisted; keep the mutation fixture disallowed.
  () => ['firmware/components/lume-adc/lume_adc.c'],
  'firmware/ runtime/ identical to the r164 feat commit', fwChanged);

/* ------------------------ part 2: live Dialog behavior ------------------ */
const SETTINGS_EXPOSE = `
globalThis.__r164PowerOff = powerOff;
globalThis.__r164PowerNote = powerNote;
`;
const HR_EXPOSE = `
globalThis.__r164Toggle = toggleAdvert;
globalThis.__r164Adv = advertising;
globalThis.__r164Note = note;
`;
function live(source, expose, dir) {
  const bundled = buildSync({
    stdin: { contents: source + expose, resolveDir: path.join(root, dir), sourcefile: 'app.js' },
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
  // danger Button, card. The label Text has NO handler (r163 lesson), so press
  // the handler nodes, not a label id.
  const ids = msgs.filter(x => x[0] === 'press').map(x => x[1]);
  assert.equal(ids.length, 4, 'expected mask + cancel + danger + card press handlers');
  return { mask: ids[0], cancel: ids[1], danger: ids[2], card: ids[3] };
}

// --- settings power off ---
const sr = live(settings, SETTINGS_EXPOSE, 'examples/settings');
assert.equal(typeof sr.lume.ui.shell.Dialog, 'function',
  'shell.js must expose Dialog in the bundled settings app');
let powerCalls = 0;
sr.lume.pmic.powerOff = () => { powerCalls++; return 0; };

let msgs = openDialog(sr, '__r164PowerOff');
sr.press(dialogPressIds(msgs).cancel);
assert.equal(powerCalls, 0, 'Cancel must NOT power off');
assert.equal(sr.ctx.__r164PowerNote(), '', 'Cancel must not write a note');
console.log('PASS confirm_sweep live: power Cancel -> 0 powerOff');

msgs = openDialog(sr, '__r164PowerOff');
sr.press(dialogPressIds(msgs).mask);
assert.equal(powerCalls, 0, 'mask must NOT power off');
console.log('PASS confirm_sweep live: power mask -> 0 powerOff');

msgs = openDialog(sr, '__r164PowerOff');
sr.press(dialogPressIds(msgs).danger);
assert.equal(powerCalls, 1, 'danger must call powerOff exactly once');
console.log('PASS confirm_sweep live: power danger -> 1 powerOff');

delete sr.lume.pmic.powerOff;                 // simulate a stub without the binding
msgs = openDialog(sr, '__r164PowerOff');
sr.press(dialogPressIds(msgs).danger);
assert.equal(powerCalls, 1, 'missing binding must NOT call powerOff');
assert.equal(sr.ctx.__r164PowerNote(), 'power off n/a',
  'missing binding must degrade to an ASCII note');
console.log('PASS confirm_sweep live: power binding stub -> power off n/a, 0 actions');

const sstub = live(settings, SETTINGS_EXPOSE, 'examples/settings');
sstub.lume.ui.shell.Dialog = undefined;
let stubPower = 0;
sstub.lume.pmic.powerOff = () => { stubPower++; };
sstub.ctx.__r164PowerOff();
assert.equal(stubPower, 0, 'Dialog stub must not power off');
assert.equal(sstub.ctx.__r164PowerNote(), 'power off n/a (no dialog)');
console.log('PASS confirm_sweep live: power Dialog stub -> ASCII note, 0 actions');

// --- hr_monitor BLE gate ---
const hr = live(hrSrc, HR_EXPOSE, 'examples/hr_monitor');
assert.equal(typeof hr.lume.ui.shell.Dialog, 'function',
  'shell.js must expose Dialog in the bundled hr_monitor app');
let starts = 0, stops = 0;
hr.lume.ble.start = () => { starts++; return 0; };
hr.lume.ble.stop = () => { stops++; return 0; };

msgs = openDialog(hr, '__r164Toggle');
hr.press(dialogPressIds(msgs).cancel);
assert.equal(starts, 0, 'Cancel must NOT start advertising');
assert.equal(stops, 0, 'Cancel must NOT stop advertising');
console.log('PASS confirm_sweep live: BLE Cancel -> 0 start/stop');

msgs = openDialog(hr, '__r164Toggle');
hr.press(dialogPressIds(msgs).danger);
assert.equal(starts, 1, 'danger (idle) must call startAdv exactly once');
assert.equal(stops, 0, 'danger (idle) must not stop');
assert.equal(hr.ctx.__r164Adv(), true, 'startAdv must publish advertising = true');
console.log('PASS confirm_sweep live: BLE danger idle -> 1 startAdv');

msgs = openDialog(hr, '__r164Toggle');
hr.press(dialogPressIds(msgs).danger);
assert.equal(starts, 1, 'danger (advertising) must not start again');
assert.equal(stops, 1, 'danger (advertising) must call stopAdv exactly once');
assert.equal(hr.ctx.__r164Adv(), false, 'stopAdv must publish advertising = false');
console.log('PASS confirm_sweep live: BLE danger advertising -> 1 stopAdv');

delete hr.lume.ble;                           // simulate "no BLE stack" stub
msgs = openDialog(hr, '__r164Toggle');
hr.press(dialogPressIds(msgs).danger);
assert.equal(starts, 1, 'missing BLE binding must NOT start');
assert.equal(stops, 1, 'missing BLE binding must NOT stop');
assert.equal(hr.ctx.__r164Note(), 'BLE n/a (no stack)',
  'missing BLE binding must degrade to an ASCII note');
console.log('PASS confirm_sweep live: BLE binding stub -> BLE n/a, 0 actions');

const hstub = live(hrSrc, HR_EXPOSE, 'examples/hr_monitor');
hstub.lume.ui.shell.Dialog = undefined;
let stubStarts = 0, stubStops = 0;
hstub.lume.ble.start = () => { stubStarts++; return 0; };
hstub.lume.ble.stop = () => { stubStops++; };
hstub.ctx.__r164Toggle();
assert.equal(stubStarts, 0, 'Dialog stub must not start advertising');
assert.equal(stubStops, 0, 'Dialog stub must not stop advertising');
assert.equal(hstub.ctx.__r164Note(), 'BLE n/a (no dialog)');
console.log('PASS confirm_sweep live: BLE Dialog stub -> ASCII note, 0 actions');

// --- live mutation proof: a Cancel with an onPress really would act ---
const badPower = settings.replace(POWER, POWER.replace("{ label: 'Cancel', style: 'plain' }",
  "{ label: 'Cancel', style: 'plain', onPress: function () { lume.pmic.powerOff(); } }"));
assert.notEqual(badPower, settings, 'power live mutation did not change source');
const badSr = live(badPower, SETTINGS_EXPOSE, 'examples/settings');
let badPowerCalls = 0;
badSr.lume.pmic.powerOff = () => { badPowerCalls++; };
const badPMsgs = openDialog(badSr, '__r164PowerOff');
badSr.press(dialogPressIds(badPMsgs).cancel);
assert.ok(badPowerCalls > 0, 'power live Cancel assertion is decorative; mutation did not FAIL');
console.log('PASS confirm_sweep live mutation: power Cancel with onPress -> FAIL as expected');

const badHr = hrSrc.replace(BLE, BLE.replace("{ label: 'Cancel', style: 'plain' }",
  "{ label: 'Cancel', style: 'plain', onPress: function () { lume.ble.start('bad'); } }"));
assert.notEqual(badHr, hrSrc, 'BLE live mutation did not change source');
const badHrRun = live(badHr, HR_EXPOSE, 'examples/hr_monitor');
let badStarts = 0;
badHrRun.lume.ble.start = () => { badStarts++; return 0; };
const badBMsgs = openDialog(badHrRun, '__r164Toggle');
badHrRun.press(dialogPressIds(badBMsgs).cancel);
assert.ok(badStarts > 0, 'BLE live Cancel assertion is decorative; mutation did not FAIL');
console.log('PASS confirm_sweep live mutation: BLE Cancel with onPress -> FAIL as expected');

console.log('ALL CONFIRM SWEEP HARNESS CASES PASSED');
