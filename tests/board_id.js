// Host harness for the r177 board-id slice: lume.system.board as a read-only
// string sourced from the lume-board-hal registry. Standalone CommonJS:
//   node tests/board_id.js
//
// Static contract checks (.d.ts / C native / CMake / prelude / stubs / generated
// outputs) plus LIVE checks through tests/lib/prelude_runner.js: the getter
// exists, is a string, returns the injected stub value, and resists app-level
// assignment. Mutation proofs (static + live) turn red when the contract is
// deleted or its type is changed, so none of the assertions are decorative.
//
// There is NO board, HAL registration or firmware build on the host: this is
// compile/ host evidence only. On-device acceptance stays deferred; see
// docs/archive/r177-report.md and docs/KNOWN-SIMPLIFICATIONS.md.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dts = read('runtime/types/lume.d.ts');
const engine = read('firmware/components/lume-engine/lume_engine.c');
const cmake = read('firmware/components/lume-engine/CMakeLists.txt');
const preludeC = read('firmware/components/lume-engine/prelude/prelude.js');
const hostStub = read('tests/lib/prelude_runner.js');
const browserStub = read('website/playground/runtime.js');
const pgPrelude = read('website/playground/prelude.js');

function systemBlock(s) {
  const at = s.indexOf('declare namespace lume.system {');
  assert.ok(at >= 0, 'missing declare namespace lume.system');
  return s.slice(at, s.indexOf('\n}', at));
}
const sys = systemBlock(dts);

// --- contract predicates: name -> [source, predicate] --------------------
const checks = [
  ['d.ts declares readonly board: string in lume.system',
    [sys, s => /const board: string;/.test(s) && !/function board\(/.test(s)]],
  ['d.ts documents compile-time macro value domain and HAL source',
    [sys, s => /compile-time board name/.test(s) && /LUME_BOARD/.test(s) &&
               /lume_board_get\(\)->board_id/.test(s) && /generic/.test(s)]],
  ['d.ts documents no setter and both stub return values honestly',
    [sys, s => /setter and no API/.test(s) && /host-stub/.test(s) && /browser-stub/.test(s) &&
               /not verified on real hardware/.test(s)]],

  ['engine includes the board HAL header',
    [engine, s => s.includes('#include "lume_board_hal.h"')]],
  ['C native reads board_id from lume_board_get and copies into JS',
    [engine, s => /static JSValue js_system_board\(JSContext \*ctx/.test(s) &&
                  /JS_NewString\(ctx, lume_board_get\(\)->board_id\)/.test(s)]],
  ['C registers _systemBoard as a zero-arg native',
    [engine, s => /JS_SetPropertyStr\(ctx, lume, "_systemBoard",/.test(s) &&
                  /JS_NewCFunction\(ctx, js_system_board, "_systemBoard", 0\)/.test(s)]],
  ['board native stays in flash (no IRAM attribute)',
    [engine, s => !/IRAM_ATTR[\s\S]{0,80}js_system_board/.test(s)]],
  ['engine REQUIRES lume-board-hal (consumer -> registry, no reverse edge)',
    [cmake, s => /REQUIRES [^\n]*lume-board-hal/.test(s)]],

  ['prelude exposes a getter (not a function) that calls the native',
    [preludeC, s => /get board\(\) \{ return lume\._systemBoard\(\); \},/.test(s) &&
                    !/board: function/.test(s)]],
  ['host runner stubs _systemBoard with an injectable string default',
    [hostStub, s => /_systemBoard: \(\) => \(options\.board === undefined \? 'host-stub' : options\.board\)/.test(s)]],
  ['playground runtime stubs _systemBoard with an honest browser string',
    [browserStub, s => /_systemBoard: \(\) => 'browser-stub'/.test(s)]],
  ['generated playground prelude carries the getter',
    [pgPrelude, s => s.includes('get board() { return lume._systemBoard(); }')]],
];

for (const [name, [source, test]] of checks) {
  assert.ok(test(source), 'FAIL board_id: ' + name);
  console.log('PASS board_id: ' + name);
}

// --- mutation proof: static assertions MUST fail on delete / type change ---
function must(name, mutation, checkName, source) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS board_id mutation: ' + name + ' -> FAIL as expected');
}

must('drop the .d.ts board declaration',
  s => s.replace('const board: string;', '/* removed */'),
  'd.ts declares readonly board: string in lume.system', sys);
must('change the .d.ts board type to number',
  s => s.replace('const board: string;', 'const board: number;'),
  'd.ts declares readonly board: string in lume.system', sys);
must('drop the prelude board getter',
  s => s.replace('get board() { return lume._systemBoard(); },', '/* removed */'),
  'prelude exposes a getter (not a function) that calls the native', preludeC);
must('drop the C _systemBoard registration',
  s => s.replace('JS_SetPropertyStr(ctx, lume, "_systemBoard",', '/* removed */'),
  'C registers _systemBoard as a zero-arg native', engine);
must('change the C native to a non-string return',
  s => s.replace('JS_NewString(ctx, lume_board_get()->board_id)', 'JS_NewInt32(ctx, 0)'),
  'C native reads board_id from lume_board_get and copies into JS', engine);
must('change the host stub default to a number',
  s => s.replace("options.board === undefined ? 'host-stub' : options.board",
                 'options.board === undefined ? 42 : options.board'),
  'host runner stubs _systemBoard with an injectable string default', hostStub);
must('change the browser stub to a number',
  s => s.replace("_systemBoard: () => 'browser-stub'", '_systemBoard: () => 7'),
  'playground runtime stubs _systemBoard with an honest browser string', browserStub);

// --- live checks through the host prelude runner -------------------------
const INJECTED = 'waveshare_esp32_s3_touch_amoled_2_16';
function probe(options) {
  const logs = [];
  runApp('lume.system.log(typeof lume.system.board); lume.system.log(lume.system.board);',
    { ...options, onLog: v => logs.push(v) });
  return logs;
}

assert.deepEqual(probe({ board: INJECTED }), ['string', INJECTED],
  'board must exist, be a string, and equal the injected stub value');
console.log('PASS board_id live: getter exists, typeof string, value == injected stub');
assert.deepEqual(probe({}), ['string', 'host-stub'],
  'board default must be the documented host-stub string');
console.log('PASS board_id live: default host-stub value is a string');

const readonlyLogs = [];
runApp("var before = lume.system.board; lume.system.board = 'hacked'; " +
       'lume.system.log(before); lume.system.log(lume.system.board);',
  { board: INJECTED, onLog: v => readonlyLogs.push(v) });
assert.deepEqual(readonlyLogs, [INJECTED, INJECTED],
  'assignment must not mutate the read-only getter');
console.log('PASS board_id live: app assignment cannot mutate the board getter');

// Live mutation proofs: a non-string stub and a deleted backing native MUST
// turn the runtime checks red (i.e. the checks above are not decorative).
assert.notEqual(probe({ board: 123 })[0], 'string',
  'type-string assertion is decorative; a number stub did not FAIL');
console.log('PASS board_id live mutation: number stub -> type check FAIL as expected');
assert.throws(() => runApp(
  'delete lume._systemBoard; lume.system.log(typeof lume.system.board);',
  { board: INJECTED }),
  'deleting the backing native must turn the getter red');
console.log('PASS board_id live mutation: native deleted -> getter FAIL as expected');

console.log('ALL BOARD_ID HARNESS CASES PASSED');
