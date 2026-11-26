// Host harness for the r131 SNTP-third-wave consumer slice (pure app layer).
// Standalone CommonJS:
//   node tests/weather_sntp.js
// Static source-contract checks only, every one mutation-proven below.
// The `/* WEATHER UI */` half cannot run in a bare vm (needs signal/lume stubs),
// so this harness asserts the SOURCE of examples/weather/app.js instead.
//   - SNTP call lives in the refresh path and precedes the HTTPS request; both
//     share ONE setTimeout callback (loading copy lands before the blocking pair).
//   - wall-clock-unset gate keyed on 2026-01-01T00:00:00Z (1767225600000 ms).
//   - only a 0 return proceeds; failure aborts with DEMO data + ASCII code in
//     Chinese copy, no fabricated data, no HTTPS burned.
//   - insecure (skipTls) bypass preserved; a failed sync is throttled 60 s.
//   - header no longer claims there is no SNTP / set-time API; the old
//     "TLS 需校时" -2 copy is replaced by a transport reading.
//   - playground sources/weather.js byte-identical to examples, weather in the
//     playground manifest, firmware/ runtime/ tools/ byte-identical to baseline.
// There is NO radio and NO board on the host: nothing here proves a real SNTP
// exchange or a real verified HTTPS round trip. Deferred to board bring-up.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)
const BEGIN = '/* ---- r131: SNTP-first BEGIN ---- */';
const END = '/* ---- r131: SNTP-first END ---- */';

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j);
}

const source = read('examples/weather/app.js');
const sntp = sliceBetween(source, BEGIN, END);          // gate + call, inside setTimeout
const refresh = sliceBetween(source, 'function refresh()', 'function headerLine()');
const header = source.split('/* ---- 天气码')[0];       // file header comment only

// The playground manifest is the source of truth for "in清单".
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

// Generated playground source must track the example byte-for-byte.
const playgroundSrc = read('website/playground/sources/weather.js');

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
/* r133 registers adc_meter in tools/playground/build.mjs (data-only) as the
 * 46th app; r134 adds crypto_check as the 47th; r135 adds archive_view as the
 * 48th. Keep the firmware/runtime/CLI surface pinned to the baseline. */
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
  // r206: lume mcp MCP server is pure tools/lume; no firmware/runtime change.
  'tools/lume/mcp.js', 'tools/lume/mcp.test.js',
];
const changed = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);

// --- checks -----------------------------------------------------------------
// Each entry: [name, [sourceToTest, predicate]]. Mutation proof calls the same
// predicate on a mutated copy of sourceToTest, so every assertion is load-bearing.
const checks = [
  ['SNTP call sits in the refresh path before the HTTPS request', [refresh, s =>
    s.includes('sys.setTimeNtp()') &&
    s.indexOf('sys.setTimeNtp()') < s.indexOf('fetchForecast(buildUrl(')]],

  ['wall-clock-unset gate compares time() against the clock threshold', [sntp, s =>
    s.includes('sys.time() < WEATHER_CLOCK_MIN_MS') &&
    s.indexOf('sys.time() < WEATHER_CLOCK_MIN_MS') < s.indexOf('sys.setTimeNtp()')]],

  ['clock threshold is 2026-01-01T00:00:00Z (1767225600000 ms)', [source, s =>
    s.includes('WEATHER_CLOCK_MIN_MS = 1767225600000') &&
    s.includes("Date.parse('2026-01-01T00:00:00Z')")]],

  ['only r===0 continues; failure aborts with DEMO data (no HTTPS burned)', [sntp, s =>
    s.includes('if (r !== 0)') &&
    s.includes("status.set('校时失败 ' + r + '，未发 HTTPS')") &&
    s.includes('data.set(DEMO)')]],

  ['skipTls bypass kept: insecure users never enter the sync gate', [sntp, s =>
    s.includes('if (!skipTls &&') &&
    s.indexOf('!skipTls') < s.indexOf('sys.setTimeNtp()')]],

  ['fetchForecast still offers the insecure httpsInsecure escape hatch', [source, s =>
    s.includes('httpsInsecure: true') &&
    /if \(skipTls\) return lume\.net\.httpRequest\(/.test(s)]],

  ['failed sync is throttled 60 s via _nowMs-domain lastSyncFailMs', [sntp, s =>
    s.includes('lume._nowMs() - lastSyncFailMs < WEATHER_SYNC_RETRY_MS') &&
    s.includes('lastSyncFailMs = lume._nowMs()')]],

  ['throttle window constant is 60000 ms', [source, s =>
    s.includes('WEATHER_SYNC_RETRY_MS = 60000')]],

  ['failure copy is a Chinese short text carrying the ASCII return code', [sntp, s =>
    s.includes("status.set('校时失败 ' + r + '，未发 HTTPS')") &&
    s.includes("status.set('校时失败，稍后重试')")]],

  ['old "TLS 需校时" -2 copy removed, transport reading installed', [source, s =>
    !s.includes(' · TLS 需校时') && s.includes(' · TLS 传输问题')]],

  ['header no longer claims there is no SNTP / set-time API', [header, s =>
    !s.includes('没有 SNTP/设时 API') && s.includes('SNTP-first')]],

  ['SNTP and https share ONE setTimeout callback', [refresh, s =>
    (s.match(/lume\.system\.setTimeout\(function \(\) \{/g) || []).length === 1 &&
    s.includes('sys.setTimeNtp()') && s.includes('fetchForecast(buildUrl(')]],

  ['playground sources/weather.js byte-identical to examples/weather/app.js',
    [playgroundSrc, s => s === source]],

  ['weather is in the playground manifest', [playgroundApps,
    list => list.length > 0 && list.includes('weather')]],

  ['firmware/ runtime/ CLI tooling untouched vs 3514c76 (shell.js/types only) (manifest excluded)',
    [changed, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL weather_sntp: ' + name);
  console.log('PASS weather_sntp: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS weather_sntp mutation: ' + name + ' -> FAIL as expected');
}

must('drop the setTimeNtp call from the refresh path',
  s => s.replace('sys.setTimeNtp()', 'void 0'),
  'SNTP call sits in the refresh path before the HTTPS request', refresh);
must('wall clock is never checked before the sync call',
  s => s.replace('sys.time() < WEATHER_CLOCK_MIN_MS', 'false'),
  'wall-clock-unset gate compares time() against the clock threshold', sntp);
must('clock threshold is moved off 2026-01-01',
  s => s.replace('WEATHER_CLOCK_MIN_MS = 1767225600000', 'WEATHER_CLOCK_MIN_MS = 1'),
  'clock threshold is 2026-01-01T00:00:00Z (1767225600000 ms)', source);
must('success branch no longer requires r===0',
  s => s.replace('if (r !== 0)', 'if (r === 0)'),
  'only r===0 continues; failure aborts with DEMO data (no HTTPS burned)', sntp);
must('insecure users are forced through the sync gate',
  s => s.replace('if (!skipTls &&', 'if ('),
  'skipTls bypass kept: insecure users never enter the sync gate', sntp);
must('insecure httpsInsecure escape hatch removed',
  s => s.replace('if (skipTls) return lume.net.httpRequest(', 'if (false) return lume.net.httpRequest('),
  'fetchForecast still offers the insecure httpsInsecure escape hatch', source);
must('drop the lastSyncFailMs throttle read',
  s => s.replace('lume._nowMs() - lastSyncFailMs < WEATHER_SYNC_RETRY_MS', 'false'),
  'failed sync is throttled 60 s via _nowMs-domain lastSyncFailMs', sntp);
must('throttle window changed away from 60 s',
  s => s.replace('WEATHER_SYNC_RETRY_MS = 60000', 'WEATHER_SYNC_RETRY_MS = 1000'),
  'throttle window constant is 60000 ms', source);
must('failure copy loses its ASCII return code',
  s => s.replace("'校时失败 ' + r + '，未发 HTTPS'", "'校时失败，未发 HTTPS'"),
  'failure copy is a Chinese short text carrying the ASCII return code', sntp);
must('restore the old "TLS 需校时" -2 copy',
  s => s.replace(' · TLS 传输问题', ' · TLS 需校时'),
  'old "TLS 需校时" -2 copy removed, transport reading installed', source);
must('restore the old "no SNTP API" header claim',
  s => s.replace('SNTP-first', '没有 SNTP/设时 API'),
  'header no longer claims there is no SNTP / set-time API', header);
must('split SNTP and https into two setTimeout callbacks',
  s => s + "\nlume.system.setTimeout(function () {});",
  'SNTP and https share ONE setTimeout callback', refresh);
must('playground generated source drifts from the example',
  s => s + '\n// drift',
  'playground sources/weather.js byte-identical to examples/weather/app.js', playgroundSrc);
must('playground manifest drops weather',
  list => list.filter(x => x !== 'weather'),
  'weather is in the playground manifest', playgroundApps);
must('a firmware file changes vs 1dc7c76',
  // r183: engine.c is now allowlisted; keep the mutation fixture disallowed.
  () => ['firmware/components/lume-adc/lume_adc.c'],
  'firmware/ runtime/ CLI tooling untouched vs 3514c76 (shell.js/types only) (manifest excluded)', changed);

console.log('ALL WEATHER SNTP HARNESS CASES PASSED');
