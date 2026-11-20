// Host harness for the r128 SNTP / wall-clock slice. Standalone CommonJS:
//   node tests/sntp.js
// Static contract checks only: .d.ts surface, C native registration / error
// codes / blocking semantics, sdkconfig + CMake wiring, JS prelude wrappers,
// host + playground stubs, generated API docs and generated playground prelude.
// There is NO radio and NO board on the host: nothing here proves a real SNTP
// exchange or that Date.now() is corrected on device. Board acceptance stays
// deferred; selected assertions are mutation-proven below so none are
// decorative.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dts = read('runtime/types/lume.d.ts');
const engine = read('firmware/components/lume-engine/lume_engine.c');
const cmake = read('firmware/components/lume-engine/CMakeLists.txt');
const defaults = read('firmware/sdkconfig.defaults');
const preludeC = read('firmware/components/lume-engine/lume_scripts.c');
const hostStub = read('tests/lib/prelude_runner.js');
const browserStub = read('website/playground/runtime.js');
const pgPrelude = read('website/playground/prelude.js');
const apiHtml = read('website/api.html');

function systemBlock(s) {
  const at = s.indexOf('declare namespace lume.system {');
  assert.ok(at >= 0, 'missing declare namespace lume.system');
  return s.slice(at, s.indexOf('\n}', at));
}
const sys = systemBlock(dts);

// --- contract predicates: name -> [source, predicate] --------------------
const checks = [
  ['d.ts declares time() with unix-ms unit',
    [sys, s => /function time\(\): number;/.test(s) && /MILLISECONDS/.test(s) && /Date\.now\(\)/.test(s)]],
  ['d.ts declares setTimeNtp(server?, timeoutMs?)',
    [sys, s => /function setTimeNtp\(server\?: string, timeoutMs\?: number\): number;/.test(s)]],
  ['d.ts documents the unsynced 1970 value honestly',
    [sys, s => /1970/.test(s) && /NOT a fabricated/.test(s)]],
  ['d.ts locks error codes -1 / -2 / -3',
    [sys, s => /-1 for an invalid server/.test(s) &&
               /-2 for an SNTP/.test(s) && /-3 when WiFi has no usable IPv4/.test(s)]],
  ['d.ts states setTimeNtp BLOCKING semantics',
    [sys, s => /BLOCKING:/.test(s) && /hot[\s\S]{0,30}reload/.test(s) && /UI refresh stall/.test(s)]],
  ['d.ts pins the default SNTP server and timeout bounds',
    [sys, s => /"pool\.ntp\.org"/.test(s) && /10000 ms/.test(s) && /30000 ms/.test(s)]],
  ['d.ts documents idempotent re-sync',
    [sys, s => /Idempotent:/.test(s) && /re-sync/.test(s)]],

  ['engine includes esp_netif_sntp.h and sys/time.h',
    [engine, s => s.includes('#include "esp_netif_sntp.h"') && s.includes('#include <sys/time.h>')]],
  ['C registers _systemTime native',
    [engine, s => /JS_SetPropertyStr\(ctx, lume, "_systemTime"/.test(s) &&
                  /JS_NewCFunction\(ctx, js_system_time, "_systemTime", 0\)/.test(s)]],
  ['C registers _systemSetTimeNtp native',
    [engine, s => /JS_SetPropertyStr\(ctx, lume, "_systemSetTimeNtp"/.test(s) &&
                  /JS_NewCFunction\(ctx, js_system_set_time_ntp, "_systemSetTimeNtp", 2\)/.test(s)]],
  ['time() reads gettimeofday and returns unix ms (JS_NewInt64)',
    [engine, s => /gettimeofday\(&tv, NULL\)/.test(s) &&
                  /tv\.tv_sec \* 1000/.test(s) && /JS_NewInt64\(ctx, ms\)/.test(s)]],
  ['setTimeNtp uses esp_netif_sntp bounded wait + teardown',
    [engine, s => /esp_netif_sntp_init\(&cfg\)/.test(s) &&
                  /esp_netif_sntp_sync_wait\(pdMS_TO_TICKS\(timeout_ms\)\)/.test(s) &&
                  /esp_netif_sntp_deinit\(\)/.test(s)]],
  ['setTimeNtp gates on WiFi having an IP (-3)',
    [engine, s => /lume_net_has_ip\(\)/.test(s) && /LUME_NET_ERR_STATE/.test(s)]],
  ['setTimeNtp maps arg / transport failures to -1 / -2',
    [engine, s => /LUME_NET_ERR_ARG/.test(s) && /LUME_NET_ERR_DRIVER/.test(s) &&
                  /JS_ThrowRangeError/.test(s) && /JS_ThrowTypeError/.test(s)]],
  ['C comment states engine task blocking (httpGet precedent)',
    [engine, s => /BLOCKING:/.test(s) && /engine task/.test(s) &&
                  /httpGet/.test(s) && /UI refresh stall/.test(s)]],
  ['C comment pins default server and bounds',
    [engine, s => /#define LUME_SNTP_DEFAULT_SERVER\s+"pool\.ntp\.org"/.test(s) &&
                  /#define LUME_SNTP_TIMEOUT_DEFAULT_MS\s+10000/.test(s) &&
                  /#define LUME_SNTP_TIMEOUT_MAX_MS\s+30000/.test(s)]],
  ['no IRAM attribute added (code stays in flash)',
    [engine, s => !/IRAM_ATTR[\s\S]{0,120}js_system_/.test(s)]],

  ['engine links esp_netif',
    [cmake, s => /REQUIRES [^\n]*esp_netif [^\n]*lume-net/.test(s)]],
  ['sdkconfig.defaults enables one SNTP server slot',
    [defaults, s => /CONFIG_LWIP_SNTP_MAX_SERVERS=1/.test(s)]],

  ['firmware prelude wraps both natives into lume.system',
    [preludeC, s => /time: function \(\) \{ return lume\._systemTime\(\); \}/.test(s) &&
                   /setTimeNtp: function \(server, timeoutMs\) \{ return lume\._systemSetTimeNtp\(server, timeoutMs\); \}/.test(s)]],
  ['host prelude runner stubs both natives',
    [hostStub, s => /_systemTime: \(\) => Date\.now\(\)/.test(s) &&
                    /_systemSetTimeNtp: \(server, timeoutMs\) => -3/.test(s)]],
  ['playground runtime stubs both natives with browser semantics',
    [browserStub, s => /_systemTime: \(\) => Date\.now\(\)/.test(s) &&
                       /_systemSetTimeNtp: \(server, timeoutMs\) => -3/.test(s) &&
                       /browser semantics/.test(s) && /no SNTP daemon/.test(s)]],
  ['generated playground prelude carries the wrappers',
    [pgPrelude, s => s.includes('setTimeNtp: function') &&
                    s.includes('lume._systemTime()') && s.includes('lume._systemSetTimeNtp')]],
  ['generated API docs carry both entries',
    [apiHtml, s => s.includes('setTimeNtp') && s.includes('system.time')]],
];

for (const [name, [source, test]] of checks) {
  assert.ok(test(source), 'FAIL sntp: ' + name);
  console.log('PASS sntp: ' + name);
}

// --- mutation proof: assertions MUST fail when their contract is removed ---
function must(name, mutation, checkName, source) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS sntp mutation: ' + name + ' -> FAIL as expected');
}

must('drop d.ts time() declaration',
  s => s.replace('function time(): number;', '/* removed */'),
  'd.ts declares time() with unix-ms unit', sys);
must('drop d.ts setTimeNtp() declaration',
  s => s.replace('function setTimeNtp(server?: string, timeoutMs?: number): number;', '/* removed */'),
  'd.ts declares setTimeNtp(server?, timeoutMs?)', sys);
must('flip error code -3 to -4 in d.ts',
  s => s.replace('-3 when WiFi has no usable IPv4', '-4 when WiFi has no usable IPv4'),
  'd.ts locks error codes -1 / -2 / -3', sys);
must('drop _systemTime native registration',
  s => s.replace('JS_SetPropertyStr(ctx, lume, "_systemTime",', '/* removed */'),
  'C registers _systemTime native', engine);
must('drop the SNTP sync wait call',
  s => s.replace('esp_netif_sntp_sync_wait(pdMS_TO_TICKS(timeout_ms))', 'ESP_OK'),
  'setTimeNtp uses esp_netif_sntp bounded wait + teardown', engine);
must('change the default server away from pool.ntp.org',
  s => s.replace('#define LUME_SNTP_DEFAULT_SERVER      "pool.ntp.org"',
                 '#define LUME_SNTP_DEFAULT_SERVER      "example.invalid"'),
  'C comment pins default server and bounds', engine);
must('drop SNTP server slot from sdkconfig.defaults',
  s => s.replace('CONFIG_LWIP_SNTP_MAX_SERVERS=1', 'CONFIG_LWIP_SNTP_MAX_SERVERS=0'),
  'sdkconfig.defaults enables one SNTP server slot', defaults);
must('drop the prelude setTimeNtp wrapper',
  s => s.replace('setTimeNtp: function (server, timeoutMs) { return lume._systemSetTimeNtp(server, timeoutMs); },',
                 '/* removed */'),
  'firmware prelude wraps both natives into lume.system', preludeC);
must('drop the host _systemTime stub',
  s => s.replace('_systemTime: () => Date.now(),', '/* removed */'),
  'host prelude runner stubs both natives', hostStub);

console.log('ALL SNTP HARNESS CASES PASSED');
