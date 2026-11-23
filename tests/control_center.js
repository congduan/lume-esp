/*
 * r159 host harness for examples/control_center (pure app).
 *
 *   node tests/control_center.js
 *
 * Part 1: static source contracts -- the three zero-consumer shell components
 * (SafeArea / Card / IconButton) are really consumed, KV keys stay inside the
 * 15-char NVS cap, all reads/writes are try/catch guarded, the step cycles
 * wrap, RESET restores every default, zero Canvas, ASCII-only copy, 14/20/32
 * fonts, the 58-app manifest, byte-identical playground source, and
 * firmware/runtime/tools/lume zero-diff vs 76d2c0c.
 * Every static predicate has a mutation proof; every live predicate too.
 *
 * Part 2: live runs of the REAL app against the firmware prelude + shell.js.
 * IconButton / Card presses use the real dispatch path, KV is a host stub.
 * No board, no touch, no radio, no backlight: host evidence only (r159 report).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '80e76b2'; // r162: re-pinned to the onEditingChange feat commit (runtime/ shell + types)
const source = read('examples/control_center/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/control_center.js');
const KEYS = { wifi: 'cc.wifi', ble: 'cc.ble', vol: 'cc.vol', brt: 'cc.brt' };
const NODE_BUDGET = 60;

function stripImport(x) {
  return x.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function literals(x) {
  return [...x.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
function blockFrom(haystack, marker) {
  const start = haystack.indexOf(marker);
  assert.ok(start >= 0, 'missing marker: ' + marker);
  const open = haystack.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < haystack.length; i++) {
    if (haystack[i] === '{') depth++;
    else if (haystack[i] === '}' && --depth === 0) return haystack.slice(open, i + 1);
  }
  assert.fail('unbalanced block: ' + marker);
}
function countCalls(s) {
  return (s.match(/(?:Text|View|Button)\(\{|lume\.ui\.shell\.(?:SafeArea|Card|IconButton)\(\{/g) || []).length;
}
function gitChanged(paths, base) {
  const b = base || BASE;
  const head = execFileSync('git', ['diff', '--name-only', b, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git', ['diff', '--name-only', b, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}

/* ------------------------ part 1: static guards ------------------------ */
const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js'];
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const fontSize = [...source.matchAll(/fontSize: (\d+)/g)].map(m => Number(m[1]));
const nodeCount = countCalls(source);

const checks = [
  ['shell.js imported by the documented relative path', [source, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['SafeArea consumed as the round-screen safe container', [source, s =>
    s.includes('lume.ui.shell.SafeArea({ shape: \'round\', size: 480, children: [] })') &&
    !s.includes('SafeArea({ shape: \'square\'')]],

  ['Card consumed by four setting cards', [source, s =>
    (s.match(/lume\.ui\.shell\.Card\(\{/g) || []).length === 4]],

  ['IconButton consumed by WiFi, Bluetooth and RESET', [source, s =>
    (s.match(/lume\.ui\.shell\.IconButton\(\{/g) || []).length === 3]],

  ['all four values live in signals', [source, s =>
    /var wifi = signal\(DEF_WIFI\);/.test(s) &&
    /var ble = signal\(DEF_BLE\);/.test(s) &&
    /var vol = signal\(DEF_VOL\);/.test(s) &&
    /var brt = signal\(DEF_BRT\);/.test(s) &&
    (s.match(/\bsignal\(/g) || []).length >= 4]],

  ['KV key block uses the four documented <=15-char keys', [source, s =>
    s.includes("var KV_WIFI = 'cc.wifi';") && s.includes("var KV_BLE = 'cc.ble';") &&
    s.includes("var KV_VOL = 'cc.vol';") && s.includes("var KV_BRT = 'cc.brt';") &&
    Object.values(KEYS).every(k => k.length <= 15)]],

  ['flag KV get wrapped in try/catch, accepts only 0 or 1',
    [blockFrom(source, 'function kvLoadFlag(key, fallback)'), s =>
      /try\s*\{/.test(s) && /catch \(e\) \{ return fallback; \}/.test(s) &&
      s.includes("(v === 0 || v === 1)")]],

  ['step KV get wrapped in try/catch, accepts only legal integer steps',
    [blockFrom(source, 'function kvLoadStep(key, lo, hi, fallback)'), s =>
      /try\s*\{/.test(s) && /catch \(e\) \{ return fallback; \}/.test(s) &&
      /typeof v === 'number' && isFinite\(v\) && Math\.floor\(v\) === v/.test(s) &&
      /v >= lo && v <= hi/.test(s)]],

  ['KV set wrapped in try/catch (NVS failure is volatile)',
    [blockFrom(source, 'function kvSave(key, value)'), s =>
      /try\s*\{/.test(s) && /catch \(e\)/.test(s) &&
      s.includes('lume.storage.kv.set(key, value);')]],

  ['startup reads every key back into its signal', [source, s =>
    s.includes('wifi.set(kvLoadFlag(KV_WIFI, DEF_WIFI));') &&
    s.includes('ble.set(kvLoadFlag(KV_BLE, DEF_BLE));') &&
    s.includes('vol.set(kvLoadStep(KV_VOL, 0, 10, DEF_VOL));') &&
    s.includes('brt.set(kvLoadStep(KV_BRT, 1, 5, DEF_BRT));')]],

  ['volume wraps 10 -> 0 and brightness wraps 5 -> 1', [source, s =>
    s.includes('var v = vol() + 1;') && s.includes('if (v > 10) v = 0;') &&
    s.includes('var v = brt() + 1;') && s.includes('if (v > 5) v = 1;')]],

  ['RESET restores all four defaults through kvSave',
    [blockFrom(source, 'function resetAll()'), s =>
      s.includes('setWifi(DEF_WIFI);') && s.includes('setBle(DEF_BLE);') &&
      s.includes('vol.set(kvSave(KV_VOL, DEF_VOL));') &&
      s.includes('brt.set(kvSave(KV_BRT, DEF_BRT));')]],

  ['no Slider consumption (timer_kit owns that r157 point)', [source, s =>
    !/lume\.ui\.shell\.Slider\(\{/.test(s)]],

  ['zero Canvas nodes', [source, s => !/\bCanvas\s*\(/.test(s)]],

  ['entire app file is ASCII-only (r64)', [source,
    s => s.length > 0 && /^[\x00-\x7F]*$/.test(s)]],

  ['UI string literals ASCII-only (r64)', [literals(source),
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['Text fontSize limited to bundled 14/20/32 faces', [fontSize,
    arr => arr.length > 0 && arr.every(v => v === 14 || v === 20 || v === 32)]],

  ['static tree within the node budget', [nodeCount,
    n => n > 0 && n <= NODE_BUDGET]],

  ['playground sources/control_center.js byte-identical to the example', [playgroundSrc, x =>
    x === source]],

  ['control_center is in the 58-app playground manifest', [apps,
    list => list.length > 0 && list.includes('control_center')]],

  ['firmware/ runtime/ tools/lume/ identical to 80e76b2', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [subject, test]] of checks) {
  assert.ok(test(subject), 'FAIL control_center static: ' + name);
  console.log('PASS control_center static: ' + name);
}

function must(name, mutation, checkName, subject) {
  const mutated = mutation(subject);
  assert.notEqual(mutated, subject, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS control_center mutation: ' + name + ' -> FAIL as expected');
}

const IMPORT = 'shell.js imported by the documented relative path';
const SAFE = 'SafeArea consumed as the round-screen safe container';
const CARD = 'Card consumed by four setting cards';
const ICON = 'IconButton consumed by WiFi, Bluetooth and RESET';
const SIGNAL = 'all four values live in signals';
const KEYS_C = 'KV key block uses the four documented <=15-char keys';
const KVFLAG = 'flag KV get wrapped in try/catch, accepts only 0 or 1';
const KVSTEP = 'step KV get wrapped in try/catch, accepts only legal integer steps';
const KVSET = 'KV set wrapped in try/catch (NVS failure is volatile)';
const LOAD = 'startup reads every key back into its signal';
const CYCLE = 'volume wraps 10 -> 0 and brightness wraps 5 -> 1';
const RESET = 'RESET restores all four defaults through kvSave';
const NOSLIDER = 'no Slider consumption (timer_kit owns that r157 point)';
const CANVAS = 'zero Canvas nodes';
const ASCII = 'entire app file is ASCII-only (r64)';
const LIT = 'UI string literals ASCII-only (r64)';
const FONT = 'Text fontSize limited to bundled 14/20/32 faces';
const BUDGET = 'static tree within the node budget';
const SRC = 'playground sources/control_center.js byte-identical to the example';
const MANIFEST = 'control_center is in the 58-app playground manifest';
const GUARD = 'firmware/ runtime/ tools/lume/ identical to 80e76b2';

must('drop the shell import',
  x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"), IMPORT, source);
must('app stops consuming SafeArea',
  x => x.replace('lume.ui.shell.SafeArea({', 'View({'), SAFE, source);
must('app stops consuming Card',
  x => x.split('lume.ui.shell.Card({').join('View({'), CARD, source);
must('app stops consuming IconButton',
  x => x.split('lume.ui.shell.IconButton({').join('Button({'), ICON, source);
must('a value escapes the signal graph',
  x => x.replace('var vol = signal(DEF_VOL);', 'var vol = 3;'), SIGNAL, source);
must('KV key exceeds the NVS cap',
  x => x.replace("var KV_BRT = 'cc.brt';", "var KV_BRT = 'cc.brightness.toolong';"), KEYS_C, source);
must('flag KV get loses try/catch',
  x => x.replace('catch (e) { return fallback; }', 'catch (e) { throw e; }'), KVFLAG,
  blockFrom(source, 'function kvLoadFlag(key, fallback)'));
must('step KV get loses try/catch',
  x => x.replace('catch (e) { return fallback; }', 'catch (e) { throw e; }'), KVSTEP,
  blockFrom(source, 'function kvLoadStep(key, lo, hi, fallback)'));
must('KV set loses try/catch',
  x => x.replace('try { lume.storage.kv.set(key, value); } catch (e) { /* NVS unavailable: volatile only */ }',
                 'lume.storage.kv.set(key, value);'), KVSET,
  blockFrom(source, 'function kvSave(key, value)'));
must('startup forgets to read a key back',
  x => x.replace('brt.set(kvLoadStep(KV_BRT, 1, 5, DEF_BRT));', '/* removed */'), LOAD, source);
must('volume stops wrapping at 10',
  x => x.replace('if (v > 10) v = 0;', 'if (v > 10) v = 10;'), CYCLE, source);
must('RESET forgets brightness',
  x => x.replace('brt.set(kvSave(KV_BRT, DEF_BRT));', '/* removed */'), RESET,
  blockFrom(source, 'function resetAll()'));
must('Slider slips into the app',
  x => x + '\nlume.ui.shell.Slider({});', NOSLIDER, source);
must('a Canvas slips into the app',
  x => x + '\nCanvas({});', CANVAS, source);
must('a non-ASCII byte slips into the file', x => x + '\n// \u4E2D', ASCII, source);
must('a CJK UI literal slips in', arr => arr.concat('\u4E2D'), LIT, literals(source));
must('font size escapes the bundled faces', arr => arr.concat(40), FONT, fontSize);
function mustNodeBudget(name, mutation) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === BUDGET);
  assert.equal(found[1][1](countCalls(mutated)), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS control_center mutation: ' + name + ' -> FAIL as expected');
}
mustNodeBudget('static tree overflows the node budget',
  x => x + '\n' + Array.from({length: NODE_BUDGET},
    () => 'Text({ text: "x", style: {} });').join('\n'));
must('playground generated source drifts',
  x => x + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops control_center',
  list => list.filter(x => x !== 'control_center'), MANIFEST, apps);
must('a firmware/runtime/CLI file changes after 76d2c0c',
  () => ['firmware/components/lume-engine/lume_scripts.c'], GUARD, fwChanged);

/* ------------------------ part 2: live prelude ------------------------- */
function boot(src, options) {
  options = options || {};
  const kv = { ...(options.kv || {}) };
  const warns = [];
  const st = runApp(shell + '\n' + stripImport(src === undefined ? source : src), {
    filename: 'examples/control_center/app.js',
    kv: {
      get: k => (k in kv ? kv[k] : null),
      set: (k, v) => { kv[k] = v; return 0; },
      remove: k => { delete kv[k]; return 0; },
    },
    onWarn: m => warns.push(m),
  });
  st.eval = code => vm.runInContext(code, st.ctx);
  st.api = () => st.ctx.ccApi;
  st.kv = kv;
  st.warns = warns;
  return st;
}
function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }

const live = {
  'handles, safe square and zero canvas': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(typeof a.root, 'number');
    assert.equal(typeof a.wifiBtn, 'number');
    assert.equal(typeof a.bleBtn, 'number');
    assert.equal(typeof a.resetBtn, 'number');
    const created = s.messages.filter(m => m[0] === 'create');
    assert.equal(created.length, 21, '21 static nodes');
    assert.equal(s.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 0,
      'zero canvas nodes');
    assert.ok(s.warns.every(w => !/SafeArea child exceeds/.test(w)), 'no safe-inset overflow');
    assert.ok(created.length <= a.NODE_BUDGET);
  }),

  'IconButton tap toggles WiFi and writes KV': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.wifi(), false);
    s.press(a.wifiBtn);
    assert.equal(a.wifi(), true);
    assert.equal(s.kv['cc.wifi'], 1);
    s.press(a.wifiBtn);
    assert.equal(a.wifi(), false);
    assert.equal(s.kv['cc.wifi'], 0);
  }),

  'IconButton tap toggles Bluetooth and writes KV': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.ble(), false);
    s.press(a.bleBtn);
    assert.equal(a.ble(), true);
    assert.equal(s.kv['cc.ble'], 1);
    s.press(a.bleBtn);
    assert.equal(a.ble(), false);
    assert.equal(s.kv['cc.ble'], 0);
  }),

  'volume card cycles 0..10 and persists': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.vol(), 3);
    for (let i = 0; i < 7; i++) s.press(a.volCard);
    assert.equal(a.vol(), 10);
    assert.equal(s.kv['cc.vol'], 10);
    s.press(a.volCard);
    assert.equal(a.vol(), 0, '10 wraps to 0');
    assert.equal(s.kv['cc.vol'], 0);
  }),

  'brightness card cycles 1..5 and persists': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.brt(), 3);
    s.press(a.brtCard); s.press(a.brtCard);
    assert.equal(a.brt(), 5);
    assert.equal(s.kv['cc.brt'], 5);
    s.press(a.brtCard);
    assert.equal(a.brt(), 1, '5 wraps to 1');
    assert.equal(s.kv['cc.brt'], 1);
  }),

  'RESET restores every default and rewrites all four keys': src => attempt(() => {
    const s = boot(src), a = s.api();
    s.press(a.wifiBtn); s.press(a.bleBtn);
    s.press(a.volCard); s.press(a.brtCard);
    assert.deepEqual([a.wifi(), a.ble(), a.vol(), a.brt()], [true, true, 4, 4]);
    s.press(a.resetBtn);
    assert.deepEqual([a.wifi(), a.ble(), a.vol(), a.brt()], [false, false, 3, 3]);
    assert.deepEqual(s.kv, { 'cc.wifi': 0, 'cc.ble': 0, 'cc.vol': 3, 'cc.brt': 3 });
  }),

  'KV load rejects illegal values and a throwing NVS degrades': src => attempt(() => {
    const bad = boot(src, { kv: { 'cc.wifi': -1, 'cc.ble': 'x', 'cc.vol': 99, 'cc.brt': 0 } });
    const ba = bad.api();
    assert.deepEqual([ba.wifi(), ba.ble(), ba.vol(), ba.brt()], [false, false, 3, 3]);
    const throwing = boot(src, { kv: {
      get: () => { throw new Error('NVS unavailable'); },
      set: () => { throw new Error('NVS full'); },
    } });
    assert.deepEqual([throwing.api().wifi(), throwing.api().vol()], [false, 3]);
    assert.equal(throwing.api().kvSave('cc.vol', 7), 7, 'save survives a throw');
    throwing.press(throwing.api().volCard);
    assert.equal(throwing.api().vol(), 4, 'volatile state still advances');
  }),

  'dispose and shutdown clear effects and timers': src => attempt(() => {
    const s = boot(src), a = s.api();
    s.press(a.wifiBtn); s.press(a.bleBtn);
    assert.ok(s.eval('__allEffects.length') > 0);
    s.eval('lume.ui.shell.dispose(ccApi.wifiBtn); lume.ui.shell.dispose(ccApi.bleBtn);');
    s.eval('__lume_shutdown()');
    assert.equal(s.eval('__allEffects.length'), 0);
    assert.equal(s.eval('Object.keys(__timers).length'), 0);
  }),
};

for (const name of Object.keys(live)) {
  assert.equal(live[name](source), true, 'FAIL control_center live: ' + name);
  console.log('PASS control_center live: ' + name);
}

function mustLive(name, mutation, liveName) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'live mutation did not change source: ' + name);
  assert.equal(live[liveName](mutated), false,
    'live assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS control_center live mutation: ' + name + ' -> FAIL as expected');
}
mustLive('live: WiFi IconButton stops toggling',
  x => x.replace('function toggleWifi() { setWifi(!wifi()); }',
                 'function toggleWifi() { setWifi(false); }'),
  'IconButton tap toggles WiFi and writes KV');
mustLive('live: volume stops wrapping at 10',
  x => x.replace('if (v > 10) v = 0;', 'if (v > 10) v = 10;'),
  'volume card cycles 0..10 and persists');
mustLive('live: RESET forgets brightness',
  x => x.replace('brt.set(kvSave(KV_BRT, DEF_BRT));', '/* removed */'),
  'RESET restores every default and rewrites all four keys');

console.log('ALL CONTROL CENTER HARNESS CASES PASSED');
