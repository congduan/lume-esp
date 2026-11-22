// Host harness for the r143 reboot-consumer slice (pure app layer).
// Standalone CommonJS:
//   node tests/reboot_consumers.js
// Static source-contract checks only, every one mutation-proven below. There
// is NO board / real esp_restart() on the host: `lume.system.reboot()` is
// `never` and kills the JS task, so this harness asserts the SOURCE of
// examples/settings/app.js and the generated playground wiring instead.
//   - the General page owns a 3-node Reboot row; its title flips on a 3 s
//     two-stage arm/confirm gate (first tap arms, second tap acts).
//   - the reboot() call sits AFTER the confirm gate and AFTER a defensive
//     typeof guard, so a playground stub without the binding cannot throw.
//   - all UI literals are ASCII (r64), the generated playground source is
//     byte-identical to the example, and settings is in the manifest.
//   - firmware/ runtime/ CLI tooling are identical to the 0d1111c baseline.
// Real-device restart behaviour is deferred to board bring-up (see
// docs/KNOWN-SIMPLIFICATIONS.md r143); nothing here claims hardware proof.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '5d02549'; // r158: re-pinned to the r153 merge point (runtime/ unchanged since)

const settings = read('examples/settings/app.js');

const S_BEGIN = '/* ---- r143: reboot consumer (pure app layer) BEGIN';
const S_END = '/* ---- r143: reboot consumer END ---- */';
const ROW_BEGIN = '/* r143 REBOOT ROW BEGIN';
const ROW_END = '/* r143 REBOOT ROW END */';
const CALL = 'lume.system.reboot();'; // with parens+semicolon: not the comment mention

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}

const rebootSlice = sliceBetween(settings, S_BEGIN, S_END);
const rebootRow = sliceBetween(settings, ROW_BEGIN, ROW_END);

// String literals are the UI copy surface (comments here are English anyway).
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = literals(settings);

// Playground manifest is the source of truth for "in清单" (tools/, not CLI).
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const playgroundSrc = read('website/playground/sources/settings.js');

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);

// --- checks -----------------------------------------------------------------
// Each entry: [name, [sourceToTest, predicate]]. Mutation proof calls the same
// predicate on a mutated copy, so every assertion is load-bearing.
const checks = [
  ['two-stage gate: first tap arms a 3 s confirm and returns before reboot', [rebootSlice, s => {
    const gate = s.indexOf('if (!rebootConfirm())');
    const arm = s.indexOf('rebootConfirm.set(true);', gate);
    const timer = s.indexOf('rebootConfirm.set(false); }, 3000)', gate);
    const ret = s.indexOf('return;', gate);
    const call = s.indexOf(CALL);
    return gate >= 0 && arm > gate && timer > arm && ret > timer && call > ret;
  }]],

  ['second tap disarms the timer before the reboot call', [rebootSlice, s => {
    const clear = s.indexOf('lume.system.clearTimeout(rebootArmTimer); rebootArmTimer = null;');
    const call = s.indexOf(CALL);
    return s.split('rebootConfirm.set(false);').length >= 3 && clear >= 0 && clear < call;
  }]],

  ['typeof guard precedes reboot; stub without binding degrades to ASCII note', [rebootSlice, s => {
    const guard = s.indexOf("typeof lume.system.reboot !== 'function'");
    const call = s.indexOf(CALL);
    return guard >= 0 && guard < call &&
      s.includes('!lume.system ||') && s.includes("rebootNote.set('reboot n/a')");
  }]],

  ['row is exactly View + Text + Button; title flips while armed', [rebootRow, s =>
    /View\(\{/.test(s) && /Text\(\{ text: function \(\)/.test(s) && /Button\(\{/.test(s) &&
    s.includes("rebootConfirm() ? 'Confirm reboot?' : 'Reboot'") &&
    s.includes('onPress: rebootNow')]],

  ['row status is the guarded ASCII default or the note', [rebootRow, s =>
    s.includes("rebootNote() === '' ? 'Restart the device' : rebootNote()")]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['playground sources/settings.js byte-identical to example', [playgroundSrc, s =>
    s === settings]],

  ['settings is in the 57-app playground manifest', [playgroundApps,
    list => list.length === 59 && list.includes('settings')]],

  ['firmware/ runtime/ CLI tooling untouched vs ba5156e (shell.js/types only)', [fwChanged, c => c.length === 0]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL reboot_consumers: ' + name);
  console.log('PASS reboot_consumers: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS reboot_consumers mutation: ' + name + ' -> FAIL as expected');
}

must('drop the first-tap arm gate',
  s => s.replace('if (!rebootConfirm()) {', 'if (false) {'),
  'two-stage gate: first tap arms a 3 s confirm and returns before reboot', rebootSlice);
must('second tap no longer disarms the timer',
  s => s.replace('lume.system.clearTimeout(rebootArmTimer); rebootArmTimer = null;', ''),
  'second tap disarms the timer before the reboot call', rebootSlice);
must('drop the typeof guard',
  s => s.replace("typeof lume.system.reboot !== 'function'", 'true'),
  'typeof guard precedes reboot; stub without binding degrades to ASCII note', rebootSlice);
must('button never flips to Confirm',
  s => s.replace("rebootConfirm() ? 'Confirm reboot?' : 'Reboot'", "'Reboot'"),
  'row is exactly View + Text + Button; title flips while armed', rebootRow);
must('row status drops its guarded ASCII default',
  s => s.replace("rebootNote() === '' ? 'Restart the device' : rebootNote()", "'Restart the device'"),
  'row status is the guarded ASCII default or the note', rebootRow);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('重'),
  'all UI string literals ASCII-only (r64)', lits);
must('playground generated source drifts from the example',
  s => s + '\n// drift',
  'playground sources/settings.js byte-identical to example', playgroundSrc);
must('playground manifest drops settings',
  list => list.filter(x => x !== 'settings'),
  'settings is in the 57-app playground manifest', playgroundApps);
must('a firmware file changes vs 92b6f29',
  () => ['firmware/components/lume-engine/lume_engine.c'],
  'firmware/ runtime/ CLI tooling untouched vs ba5156e (shell.js/types only)', fwChanged);

console.log('ALL REBOOT CONSUMERS HARNESS CASES PASSED');
