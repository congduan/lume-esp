// Host harness for the r132 OTA-consumer slice (pure app layer).
// Standalone CommonJS:
//   node tests/ota_consumers.js
// Static source-contract checks only, every one mutation-proven below. The
// `lume.ota` host stub exists but the UI paths need signal/lume bindings, so
// this harness asserts the SOURCE of examples/settings/app.js and
// examples/dashboard/app.js instead.
//   - settings General page owns a 3-node OTA row driven by lume.ota.status()
//     with typeof === 'object' discrimination (a number is an error code).
//   - the 32-hex key is NEVER read: no `.token` / ['token'] anywhere in either
//     app, so it cannot reach a Text or canvas text render path.
//   - the "New token" button opens a shell.Dialog; its danger Rotate action
//     generates 32 lowercase hex chars with Math.random (non-CSPRNG, registered
//     in the header + KNOWN-SIMPLIFICATIONS.md r132; modal gate added in r163).
//   - dashboard SYSTEM canvas publishes a 10th OTA row; 9 separators fit
//     inside the 480-round safe square above the y=352..400 tab bar (r216).
//   - dashboard playground generated source matches the example, dashboard is
//     in the playground manifest, and all UI literals are ASCII (r64).
//   - the firmware/runtime/CLI-tooling surface is pinned to BASE (R166_ALLOWED).
//     The retired r132-r136 allChanged allowlist is documented in docs/r205-report.md.
// There is NO radio / board / real OTA push on the host: nothing here proves a
// real token rotation or a real HMAC exchange. Deferred to board bring-up.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '94f5d4e'; // r185: re-pinned to the docs-archive merge (round reports moved to docs/archive/) // r183: re-pinned to the baseline HEAD (r182 fw-sync moved wasm/fw/partition-table.bin after 3514c76)

const settings = read('examples/settings/app.js');
const dashboard = read('examples/dashboard/app.js');
const both = settings + '\n---\n' + dashboard;

const S_BEGIN = '/* ---- r132: OTA status + token rotation BEGIN';
const S_END = '/* ---- r132: OTA status + token rotation END ---- */';
const ROW_BEGIN = '/* r132 OTA ROW BEGIN';
const ROW_END = '/* r132 OTA ROW END */';
const D_BEGIN = '/* ---- r132: OTA status line BEGIN ---- */';
const D_END = '/* ---- r132: OTA status line END ---- */';

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}

const settingsOta = sliceBetween(settings, S_BEGIN, S_END);
const otaRow = sliceBetween(settings, ROW_BEGIN, ROW_END);
const dashOta = sliceBetween(dashboard, D_BEGIN, D_END);
const header = settings.slice(0, settings.indexOf('var settingsTheme'));
const pollSlice = sliceBetween(settings, 'function pollOnce()', 'function stopPolling()');

// Text/canvas render paths must never be able to obtain the full key.
function noTokenRead(s) {
  return !/\.token\b/.test(s) && !/\[\s*['"]token['"]\s*\]/.test(s);
}

// String literals are the UI copy surface (comments are English here anyway).
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = [...literals(settings), ...literals(dashboard)];

// playground manifest is the source of truth for "in清单".
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const playgroundSrc = read('website/playground/sources/dashboard.js');

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', '-M', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', '-M', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
/* r133: the playground manifest (tools/playground/build.mjs) is DATA that now
 * registers adc_meter as a 46th app; r134 adds crypto_check as a 47th; r135
 * adds archive_view as the 48th; r136 adds img_view as the 49th; r137 adds
 * vec_demo as the 50th. The
 * firmware/runtime/CLI-tooling surface is still pinned. Scope the diff to
 * tools/lume/ so manifest registration is not misreported as a tooling
 * behaviour change. */
const R166_ALLOWED = ['firmware/components/lume-engine/lume_scripts.c', 'firmware/components/lume-engine/gen_lume_scripts.py', 'firmware/components/lume-engine/prelude/demo.js', 'firmware/components/lume-engine/prelude/home.js', 'firmware/components/lume-engine/prelude/prelude.js', 'runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r183: SVG raster-result cache (engine component only).
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_svg_cache.c',
  'firmware/components/lume-engine/include/lume_svg_cache.h',
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  // r75 follow-up: SVG rasterizer scanline fill + LVGL refresh period/cache.
  'firmware/components/lume-svg/lume_svg.c',
  'firmware/components/lvgl/lv_conf.h',
  // r177 board-id slice: lume.system.board getter (BASE 3514c76 is the perf
  // sweep's docs commit, so the board-id feat files legitimately differ).
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_scripts.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js',
  // r181: emu frame-injection pacing (scan.js) + UI-queue backpressure bridge.
  'tools/lume/scan.js',
  'firmware/components/lume-ui-bridge/lume_ui_bridge.c',
  // r179: WiFi PS/coexist knife -- lume-net PS call + sdkconfig (incl. generated).
  'firmware/components/lume-net/lume_net.c', 'firmware/sdkconfig',
  'firmware/sdkconfig.defaults',
  // r199: lume context is pure tools/lume; no firmware/runtime change.
  'tools/lume/context.js', 'tools/lume/context.test.js',
  // r206: lume mcp MCP server is pure tools/lume; no firmware/runtime change.
  'tools/lume/mcp.js', 'tools/lume/mcp.test.js',
  'tools/lume/examples.js', 'tools/lume/examples.test.js'];
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);

// --- checks -----------------------------------------------------------------
// Each entry: [name, [sourceToTest, predicate]]. Mutation proof calls the same
// predicate on a mutated copy, so every assertion is load-bearing.
const checks = [
  ['OTA helper reads lume.ota.status() locally', [settingsOta, s =>
    s.includes('var st = lume.ota.status();')]],

  ['number return discriminated via typeof === object, ASCII err code', [settingsOta, s =>
    s.includes("typeof st === 'object'") && s.includes("'ota err ' + st")]],

  ['four flags + port rendered; .token / [token] never read in either app', [both, s =>
    ['st.running', 'st.wifiReady', 'st.tokenReady', 'st.port', 'st.hmac']
      .every(k => s.includes(k)) && noTokenRead(s)]],

  ['OTA row is exactly View + Text + Button (3 nodes)', [otaRow, s =>
    /View\(\{/.test(s) && /Text\(\{ text: function \(\)/.test(s) && /Button\(\{/.test(s)]],

  ['row Text shows only status; New-token opens a Dialog', [otaRow, s =>
    s.includes('otaLine()') &&
    s.includes("title: 'New token', onPress: rotateOtaToken") &&
    noTokenRead(s)]],

  ['setToken sits in the danger Rotate onPress of a Dialog', [settingsOta, s => {
    const danger = s.indexOf("{ label: 'Rotate', style: 'danger', onPress: function ()");
    const call = s.indexOf('lume.ota.setToken(');
    return s.includes('shell.Dialog({') && danger >= 0 && call > danger;
  }]],

  ['Dialog guard degrades to an ASCII note; no 3 s arm timer remains', [settingsOta, s =>
    s.includes("typeof shell.Dialog !== 'function'") &&
    s.includes("otaNote.set('rotate n/a (no dialog)')") &&
    !s.includes('otaArmTimer')]],

  ['replacement token is 32 lowercase hex chars from Math.random', [settingsOta, s =>
    s.includes("'0123456789abcdef'") && s.includes('Math.random() * 16') &&
    s.includes('i < 32')]],

  ['setToken failure renders ASCII code; success refreshes status', [settingsOta, s =>
    s.includes("'setToken err ' + r") && s.includes('refreshOta();')]],

  ['600 ms poll refreshes OTA status', [pollSlice, s =>
    s.includes('refreshOta();') && s.includes('lume.system.setInterval(pollOnce, 600)')]],

  ['header registers Math.random as NOT cryptographically secure', [header, s =>
    s.includes('Math.random') && s.includes('NOT cryptographically secure')]],

  ['dashboard SYSTEM reads status() with typeof === object discrimination', [dashOta, s =>
    s.includes('lume.ota.status()') && s.includes("typeof ota === 'object'") &&
    s.includes("'ota err ' + ota")]],

  ['dashboard publishes OTA row with 9 separators inside safe area', [dashboard, s =>
    s.includes("['OTA', otaText]") &&
    /function systemStaticLines\(\)[\s\S]*?for \(var i = 0; i < 9; i\+\+\) segs\.push\(\[44, 81 \+ i \* 24, W - 44, 81 \+ i \* 24\]\)/.test(s)]],

  ['dashboard OTA line never reads token', [dashOta, s => noTokenRead(s)]],

  ['playground sources/dashboard.js byte-identical to example', [playgroundSrc, s =>
    s === dashboard]],

  ['dashboard is in the playground manifest', [playgroundApps,
    list => list.length > 0 && list.includes('dashboard')]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['firmware/ runtime/ CLI tooling identical to 674684a', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL ota_consumers: ' + name);
  console.log('PASS ota_consumers: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS ota_consumers mutation: ' + name + ' -> FAIL as expected');
}

must('drop the lume.ota.status() read',
  s => s.replace('var st = lume.ota.status();', 'var st = null;'),
  'OTA helper reads lume.ota.status() locally', settingsOta);
must('truthy test replaces typeof === object discrimination',
  s => s.replace("typeof st === 'object'", 'st'),
  'number return discriminated via typeof === object, ASCII err code', settingsOta);
must('render the full token straight into the status text',
  s => s.replace('otaLine()', 'otaLine() + st.token'),
  'four flags + port rendered; .token / [token] never read in either app', both);
must('drop the OTA row Text',
  s => s.replace('Text({ text: function ()', 'Dummy({ text: function ()'),
  'OTA row is exactly View + Text + Button (3 nodes)', otaRow);
must('New-token button no longer opens a Dialog',
  s => s.replace("title: 'New token', onPress: rotateOtaToken", "title: 'New token'"),
  'row Text shows only status; New-token opens a Dialog', otaRow);
must('danger Rotate button downgraded',
  s => s.replace("{ label: 'Rotate', style: 'danger', onPress: function ()",
                 "{ label: 'Rotate', onPress: function ()"),
  'setToken sits in the danger Rotate onPress of a Dialog', settingsOta);
must('Dialog guard hardened (no ASCII fallback)',
  s => s.replace("typeof shell.Dialog !== 'function'", 'false'),
  'Dialog guard degrades to an ASCII note; no 3 s arm timer remains', settingsOta);
must('token length shrinks from 32 to 16 hex chars',
  s => s.replace('i < 32', 'i < 16'),
  'replacement token is 32 lowercase hex chars from Math.random', settingsOta);
must('setToken failure loses its ASCII return code',
  s => s.replace("'setToken err ' + r", "'setToken err'"),
  'setToken failure renders ASCII code; success refreshes status', settingsOta);
must('poll no longer refreshes OTA status',
  s => s.replace('refreshOta();', ''),
  '600 ms poll refreshes OTA status', pollSlice);
must('header drops the non-CSPRNG registration',
  s => s.replace('NOT cryptographically secure', 'cryptographically secure'),
  'header registers Math.random as NOT cryptographically secure', header);
must('dashboard truthy test replaces typeof === object',
  s => s.replace("typeof ota === 'object'", 'ota'),
  'dashboard SYSTEM reads status() with typeof === object discrimination', dashOta);
must('dashboard separators revert to 8',
  s => s.replace('i < 9', 'i < 8'),
  'dashboard publishes OTA row with 9 separators inside safe area', dashboard);
must('dashboard renders the full token on canvas',
  s => s.replace("'ota off'", "'ota ' + ota.token"),
  'dashboard OTA line never reads token', dashOta);
must('playground generated source drifts from the example',
  s => s + '\n// drift',
  'playground sources/dashboard.js byte-identical to example', playgroundSrc);
must('playground manifest drops dashboard',
  list => list.filter(x => x !== 'dashboard'),
  'dashboard is in the playground manifest', playgroundApps);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'),
  'all UI string literals ASCII-only (r64)', lits);
must('a firmware file changes vs d85e69a',
  () => ['firmware/components/lume-board/lume_board.c'],
  'firmware/ runtime/ CLI tooling identical to 674684a', fwChanged);

console.log('ALL OTA CONSUMERS HARNESS CASES PASSED');
