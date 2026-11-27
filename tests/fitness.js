/*
 * r204 host harness for examples/fitness (triple concentric activity rings,
 * thousands-formatted hero value, IMU peak-threshold pedometer, honest SIM
 * tagging for battery/HR, companion card focus switching, frame draw <= 240).
 *
 *   node tests/fitness.js
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
const BASE = '3514c76';
const source = read('examples/fitness/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/fitness.js');

function stripImport(x) {
  return x.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function literals(x) {
  return [...x.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
function gitChanged(paths, base) {
  const b = base || BASE;
  const head = execFileSync('git', ['diff', '--name-only', b, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git', ['diff', '--name-only', b, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}

const R166_ALLOWED = ['firmware/components/lume-engine/lume_scripts.c', 'firmware/components/lume-engine/gen_lume_scripts.py', 'firmware/components/lume-engine/prelude/demo.js', 'firmware/components/lume-engine/prelude/home.js', 'firmware/components/lume-engine/prelude/prelude.js', 'runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js',
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_svg_cache.c',
  'firmware/components/lume-engine/include/lume_svg_cache.h',
  'tools/lume/scan.js', 'firmware/components/lume-ui-bridge/lume_ui_bridge.c',
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js',
  'firmware/components/lume-svg/lume_svg.c',
  'firmware/components/lvgl/lv_conf.h',
  'firmware/components/lume-net/lume_net.c', 'firmware/sdkconfig',
  'firmware/sdkconfig.defaults',
  'tools/lume/context.js', 'tools/lume/context.test.js',
  'tools/lume/mcp.js', 'tools/lume/mcp.test.js',
  'tools/lume/examples.js', 'tools/lume/examples.test.js',
];
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

const checks = [
  ['shell.js imported by documented relative path', [source, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['triple concentric rings drawn at r=207/187/167 with fine 12-o-clock tick lines', [source, s =>
    s.includes("drawRing(c, 207, fracs.steps, '#0E2926', '#40D8B0'") &&
    s.includes("drawRing(c, 187, fracs.cal,   '#2A2417', '#FFD78E'") &&
    s.includes("drawRing(c, 167, fracs.hr,    '#2C151C', '#FF6B79'") &&
    s.includes("c.line(240, 240 - r - 6, 240, 240 - r + 6, '#0D1420', 2);")]],

  ['companion cards display target/context values (ZONE2 avg and 410/500 kcal)', [source, s =>
    s.includes("'ZONE2 avg'") && s.includes("kc + '/' + KCAL_GOAL") && s.includes("'kcal'")]],

  ['honest SIM battery fallback (85% SIM when lume.system.battery absent)', [source, s =>
    s.includes('lume.system.battery') && s.includes('batteryPct.set(85);') &&
    s.includes("var simSuffix = (batSim || !liveImu) ? ' SIM' : '';")]],

  ['thousands formatter and IMU step threshold algorithm present', [source, s =>
    s.includes('function fmtThousands(n)') && s.includes('function processImuSample(') &&
    s.includes('lume.imu.read()')]],

  ['entire app file is ASCII-only (r64)', [source, s =>
    s.length > 0 && /^[\x00-\x7F]*$/.test(s)]],

  ['UI string literals ASCII-only (r64)', [literals(source),
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['playground sources/fitness.js byte-identical to example', [playgroundSrc, x => x === source]],

  [`fitness is in the ${apps.length}-app playground manifest`, [apps, list => list.includes('fitness')]],

  ['firmware/ runtime/ tools/lume/ identical to 3514c76', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [subject, test]] of checks) {
  assert.ok(test(subject), 'FAIL fitness static: ' + name);
  console.log('PASS fitness static: ' + name);
}

function must(name, mutation, checkName, subject) {
  const mutated = mutation(subject);
  assert.notEqual(mutated, subject, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false, 'assertion is decorative: ' + name);
  console.log('PASS fitness mutation: ' + name + ' -> FAIL as expected');
}

must('drop shell import', x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"),
  'shell.js imported by documented relative path', source);
must('inner ring dropped', x => x.replace("drawRing(c, 167, fracs.hr,", "/* dropped */("),
  'triple concentric rings drawn at r=207/187/167 with fine 12-o-clock tick lines', source);
must('ZONE2 avg target removed', x => x.replace("'ZONE2 avg'", "'--'"),
  'companion cards display target/context values (ZONE2 avg and 410/500 kcal)', source);
must('SIM label removed from battery readout', x => x.replace("? ' SIM' : ''", "? '' : ''"),
  'honest SIM battery fallback (85% SIM when lume.system.battery absent)', source);
must('thousands formatter dropped', x => x.replace('function fmtThousands(n)', 'function fmtRaw(n)'),
  'thousands formatter and IMU step threshold algorithm present', source);
must('playground source drifts', x => x + '\n// drift',
  'playground sources/fitness.js byte-identical to example', playgroundSrc);
must('manifest drops fitness', list => list.filter(x => x !== 'fitness'),
  `fitness is in the ${apps.length}-app playground manifest`, apps);

/* ------------------------ part 2: live prelude ------------------------- */
function boot(src, options) {
  options = options || {};
  const st = runApp(shell + '\n' + stripImport(src === undefined ? source : src), {
    filename: 'examples/fitness/app.js',
    imu: options.imu,
  });
  st.eval = code => vm.runInContext(code, st.ctx);
  st.api = () => st.ctx.fitnessApi;
  return st;
}
function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }

const live = {
  'ring fractions, thousands formatting, SIM battery and <= 240 frame draws': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.fmtThousands(0), '0');
    assert.equal(a.fmtThousands(999), '999');
    assert.equal(a.fmtThousands(8240), '8,240');
    assert.equal(a.fmtThousands(10000), '10,000');
    assert.equal(a.fmtThousands(1234567), '1,234,567');
    const f = a.ringFractions();
    assert.ok(Math.abs(f.steps - 0.824) < 0.001, 'steps ring ~82.4%');
    assert.ok(Math.abs(f.cal - 0.82) < 0.001, 'burn ring 410/500 = 82%');
    assert.ok(Math.abs(f.hr - 118 / 160) < 0.001, 'hr ring 118/160');
    assert.equal(a.batteryPct(), 85, 'fallback battery is 85%');
    assert.equal(a.batterySim(), true, 'fallback battery marked SIM');
    const draws = a.getLastDrawCalls();
    assert.ok(draws > 0 && draws <= a.FRAME_DRAW_BUDGET, 'frame draws <= 240, got ' + draws);
    const canvases = s.messages.filter(m => m[0] === 'create' && m[2] === 3);
    assert.equal(canvases.length, 1, 'single 480x480 canvas');
    assert.equal(canvases[0][4] * canvases[0][5], a.CANVAS_BUDGET);
  }),

  'companion cards toggle hero focus between STEPS / HEART / BURN': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(a.focusView(), 'steps');
    s.press(a.cardHr);
    assert.equal(a.focusView(), 'hr');
    s.press(a.cardCal);
    assert.equal(a.focusView(), 'cal');
    s.press(a.cardCal);
    assert.equal(a.focusView(), 'steps', 'second tap returns to steps');
    s.press(a.cardHr);
    s.press(a.heroBtn);
    assert.equal(a.focusView(), 'steps', 'hero tap returns to steps');
    assert.ok(a.getLastDrawCalls() <= a.FRAME_DRAW_BUDGET);
  }),

  'IMU peak-threshold step counter increments steps with debounce': src => attempt(() => {
    const s = boot(src), a = s.api();
    const startSteps = a.steps();
    assert.equal(a.processImuSample({ ax: 0, ay: 0, az: 9.81 }, 1000), false, 'rest sample');
    assert.equal(a.imuLive(), true);
    assert.equal(a.processImuSample({ ax: 2, ay: 1, az: 13.0 }, 1500), true, 'step peak triggers');
    assert.equal(a.steps(), startSteps + 1);
    assert.equal(a.processImuSample({ ax: 0, ay: 0, az: 9.5 }, 1600), false);
    assert.equal(a.processImuSample({ ax: 2, ay: 1, az: 13.0 }, 1650), false, 'within 280ms debounce');
    assert.equal(a.steps(), startSteps + 1);
    assert.equal(a.processImuSample({ ax: 0, ay: 0, az: 9.5 }, 1700), false);
    assert.equal(a.processImuSample({ ax: 2, ay: 1, az: 13.2 }, 1900), true, 'after debounce triggers');
    assert.equal(a.steps(), startSteps + 2);
  }),

  'shutdown clears all effects and timers': src => attempt(() => {
    const s = boot(src);
    s.eval('__lume_start()');
    assert.equal(s.eval('Object.keys(__timers).length'), 1);
    s.eval('__lume_shutdown()');
    assert.equal(s.eval('Object.keys(__timers).length'), 0);
    assert.equal(s.eval('__allEffects.length'), 0);
  }),
};

for (const name of Object.keys(live)) {
  assert.equal(live[name](source), true, 'FAIL fitness live: ' + name);
  console.log('PASS fitness live: ' + name);
}

function mustLive(name, mutation, liveName) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'live mutation did not change source: ' + name);
  assert.equal(live[liveName](mutated), false, 'live assertion is decorative: ' + name);
  console.log('PASS fitness live mutation: ' + name + ' -> FAIL as expected');
}
mustLive('live: fmtThousands drops comma',
  x => x.replace("out += ',';", "out += '';"),
  'ring fractions, thousands formatting, SIM battery and <= 240 frame draws');
mustLive('live: IMU debounce removed',
  x => x.replace('(nowMs - lastStepAt) >= STEP_DEBOUNCE_MS', 'true'),
  'IMU peak-threshold step counter increments steps with debounce');

console.log('ALL FITNESS HARNESS CASES PASSED');
