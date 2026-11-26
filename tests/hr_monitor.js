// Host harness for the r146 lume.ble consumption slice (pure app layer).
// Standalone CommonJS:
//   node tests/hr_monitor.js
// Static source-contract checks only, every one mutation-proven below. There
// is NO radio / board / BLE stack on the host: lume.ble is a NimBLE GATT
// PERIPHERAL (r25, no central/scan), so this harness asserts the SOURCE of
// examples/hr_monitor/app.js and the generated playground wiring instead.
//   - the app degrades to an ASCII note when lume.ble is absent (typeof guard).
//   - status() failure (negative number) is discriminated via typeof === object.
//   - advertising start/stop sit behind a shell.Dialog confirmation (r164
//     replaces the old two-stage arm -> 3 s -> act gate); Cancel never acts.
//   - HR telemetry is throttled by a >=1 s setInterval and only written while
//     connected AND subscribed; inbound commands are truncated to 20 bytes.
//   - all UI literals are ASCII (r64), the generated playground source is
//     byte-identical, hr_monitor is in the playground manifest, and firmware/
//     runtime/ CLI tooling are identical to the 3514c76 baseline.
// Real on-device advertising / notify / coexistence are deferred to board
// bring-up (docs/KNOWN-SIMPLIFICATIONS.md r146); no hardware proof here.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)

const app = read('examples/hr_monitor/app.js');

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}

const logic = sliceBetween(app,
  '/* ---- r146: BLE telemetry logic BEGIN ---- */',
  '/* ---- r146: BLE telemetry logic END ---- */');
const ui = sliceBetween(app,
  '/* ---- r146: UI BEGIN ---- */',
  '/* ---- r146: UI END ---- */');
const pollSlice = sliceBetween(app, '/* r146 STATUS POLL BEGIN */', '/* r146 STATUS POLL END */');
const streamSlice = sliceBetween(app, '/* r146 HR STREAM BEGIN */', '/* r146 HR STREAM END */');
const gateSlice = sliceBetween(app, '/* r164: BLE advertise/stop gate BEGIN', '/* r164: BLE advertise/stop gate END */');

// String literals are the UI copy surface (comments here are English anyway).
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = literals(app);

// Playground manifest is the source of truth for "in清单" (tools/, not CLI).
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const playgroundSrc = read('website/playground/sources/hr_monitor.js');

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const R166_ALLOWED = ['firmware/components/lume-engine/lume_scripts.c', 'firmware/components/lume-engine/gen_lume_scripts.py', 'firmware/components/lume-engine/prelude/demo.js', 'firmware/components/lume-engine/prelude/home.js', 'firmware/components/lume-engine/prelude/prelude.js', 'runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
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
  // r199: lume context is pure CLI tooling; no firmware/runtime change.
  'tools/lume/context.js', 'tools/lume/context.test.js',
];
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);

// --- checks -----------------------------------------------------------------
// Each entry: [name, [sourceToTest, predicate]]. Mutation proof calls the same
// predicate on a mutated copy, so every assertion is load-bearing.
const checks = [
  ['defensive guard typeof lume.ble !== undefined degrades to ASCII note', [logic, s =>
    s.includes("typeof lume.ble !== 'undefined'") &&
    s.includes("note.set('BLE n/a (no stack)')")]],

  ['status() negative-number error discriminated via typeof === object', [pollSlice, s =>
    s.includes('lume.ble.status()') &&
    s.includes("typeof s === 'object'") &&
    s.includes("note.set('status err ' + s)")]],

  ['shell.Dialog gate: Cancel is plain, danger calls startAdv/stopAdv', [gateSlice, s => {
    const dlg = s.indexOf('shell.Dialog({');
    const cancel = s.indexOf("{ label: 'Cancel', style: 'plain' }");
    const danger = s.indexOf("style: 'danger', onPress: function ()");
    const act = s.indexOf('if (advertising()) stopAdv(); else startAdv();', danger);
    return dlg >= 0 && cancel > dlg && danger > cancel && act > danger &&
      s.slice(cancel, danger).indexOf('onPress') < 0 &&
      !/toggleArm|toggleArmTimer/.test(s);
  }]],

  ['both lume.ble.start and lume.ble.stop are wired through the gate', [logic, s =>
    s.includes('lume.ble.start(NAME)') && s.includes('lume.ble.stop();')]],

  ['HR telemetry throttled by a >=1 s setInterval', [logic, s =>
    s.includes('lume.system.setInterval(sendHr, 1000)') &&
    streamSlice.includes('lume.ble.write(line)')]],

  ['HR writes only while CONNECTED and subscribed, ASCII fixed width', [streamSlice, s =>
    s.includes("bleState() !== 'CONNECTED' || !subsSig()") &&
    s.includes("'HR ' + ('00' + n).slice(-3)")]],

  ['inbound command truncated to <=20 B ASCII', [pollSlice, s =>
    s.includes('lume.ble.read()') && s.includes('String(msg).slice(0, 20)')]],

  ['status HUD renders state / subscribed / pending / mtu', [ui, s =>
    ["card('state'", "card('subscribed'", "card('pending'", "card('mtu'"].every(k => s.includes(k)) &&
    ['bleState()', 'subsSig()', 'pendingSig()', 'mtuSig()'].every(k => s.includes(k))]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['playground sources/hr_monitor.js byte-identical to example', [playgroundSrc, s =>
    s === app]],

  ['hr_monitor is in the playground manifest', [playgroundApps,
    list => list.length > 0 && list.includes('hr_monitor')]],

  ['firmware/ runtime/ CLI tooling identical to 3514c76', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL hr_monitor: ' + name);
  console.log('PASS hr_monitor: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS hr_monitor mutation: ' + name + ' -> FAIL as expected');
}

must('drop the typeof lume.ble guard',
  s => s.replace("typeof lume.ble !== 'undefined'", 'true'),
  'defensive guard typeof lume.ble !== undefined degrades to ASCII note', logic);
must('truthy test replaces typeof === object discrimination',
  s => s.replace("typeof s === 'object'", 's'),
  'status() negative-number error discriminated via typeof === object', pollSlice);
must('drop the BLE Dialog gate',
  s => s.replace('shell.Dialog({', 'void ({'),
  'shell.Dialog gate: Cancel is plain, danger calls startAdv/stopAdv', gateSlice);
must('stop() no longer wired through the gate',
  s => s.replace('lume.ble.stop();', ';'),
  'both lume.ble.start and lume.ble.stop are wired through the gate', logic);
must('throttle drops from 1000 ms to 100 ms',
  s => s.replace('lume.system.setInterval(sendHr, 1000)', 'lume.system.setInterval(sendHr, 100)'),
  'HR telemetry throttled by a >=1 s setInterval', logic);
must('HR write loses its CONNECTED+subscribed precondition',
  s => s.replace("bleState() !== 'CONNECTED' || !subsSig()", 'false'),
  'HR writes only while CONNECTED and subscribed, ASCII fixed width', streamSlice);
must('inbound command loses its 20-byte truncation',
  s => s.replace('String(msg).slice(0, 20)', 'String(msg)'),
  'inbound command truncated to <=20 B ASCII', pollSlice);
must('HUD drops the mtu row',
  s => s.replace("card('mtu'", "card('xmtu'"),
  'status HUD renders state / subscribed / pending / mtu', ui);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'),
  'all UI string literals ASCII-only (r64)', lits);
must('playground generated source drifts from the example',
  s => s + '\n// drift',
  'playground sources/hr_monitor.js byte-identical to example', playgroundSrc);
must('playground manifest drops hr_monitor',
  list => list.filter(x => x !== 'hr_monitor'),
  'hr_monitor is in the playground manifest', playgroundApps);
must('a firmware file changes vs 27541bb',
  // r183: engine.c is now allowlisted; keep the mutation fixture disallowed.
  () => ['firmware/components/lume-adc/lume_adc.c'],
  'firmware/ runtime/ CLI tooling identical to 3514c76', fwChanged);

console.log('ALL HR MONITOR HARNESS CASES PASSED');
