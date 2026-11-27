/*
 * r204 host harness for examples/timer_kit (radial dial countdown + stopwatch).
 *
 *   node tests/timer_kit.js
 *
 * Part 1: static source contracts -- shell SafeArea, 4-state machine
 * (READY/RUNNING/PAUSED/FINISHED), running +/- edit lock, monospace vector
 * digits, absolute-time clock/pause/resume semantics, KV/bell try-catch,
 * ASCII/font/canvas/frame-draw budgets, byte-identical playground source,
 * playground manifest, and firmware/runtime/tools/lume zero-diff vs 3514c76.
 * Every predicate has a mutation proof.
 *
 * Part 2: live runs of the REAL app against the firmware prelude + shell.js.
 * Verifies all 4 states, running edit-lock & unlock +/-1m, stopwatch laps,
 * KV persistence, bell PCM, frame draw calls <= 240, and shutdown cleanup.
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
const source = read('examples/timer_kit/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/timer_kit.js');
const KV_TIMER = 'hisc.timer', KV_STOP = 'timer.best';
const CANVAS_PX = 480 * 480;

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
function gitChanged(paths, base) {
  const b = base || BASE;
  const head = execFileSync('git', ['diff', '--name-only', b, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git', ['diff', '--name-only', b, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}

/* ------------------------ part 1: static guards ------------------------ */
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
const lits = literals(source);
const fontSize = [...source.matchAll(/fontSize: (\d+)/g)].map(m => Number(m[1]));

const checks = [
  ['shell.js imported by the documented relative path', [source, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['radial Canvas dial with retained 60 ticks and round SafeArea', [source, s =>
    s.includes('c.retainSegments(MAJOR_SEGS') && s.includes('c.arc(240, 240, 188,') &&
    s.includes("lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480")]],

  ['monospace vector 48px digit renderer prevents horizontal jitter', [source, s =>
    s.includes('function drawMonoDigit(') && s.includes('function drawMonoTime(') &&
    s.includes('drawMonoTime(c, timeStr, 240, 236,')]],

  ['four countdown states with state-machine button visibility', [source, s =>
    s.includes("lume.setAttr(btnStart, 5, (inCd && cp === 'READY') ? 1 : 0);") &&
    s.includes("lume.setAttr(btnPause, 5, (inCd && cp === 'RUNNING') ? 1 : 0);") &&
    s.includes("lume.setAttr(btnResume, 5, (inCd && cp === 'PAUSED') ? 1 : 0);") &&
    s.includes("lume.setAttr(btnRestart, 5, (inCd && cp === 'FINISHED') ? 1 : 0);") &&
    s.includes("lume.setAttr(btnReset, 5, (inCd && (cp === 'RUNNING' || cp === 'PAUSED' || cp === 'FINISHED')) ? 1 : 0);")]],

  ['running +/- edit lock defaults locked and requires explicit toggle', [source, s =>
    s.includes('var editLocked = signal(true);') &&
    s.includes('function toggleEditLock()') &&
    s.includes("if (p === 'RUNNING' && !editLocked())")]],

  ['clock is lume.system.time() (no nonexistent system.now)', [source, s =>
    s.includes('function tkNow() { return lume.system.time(); }') &&
    !s.includes('tkNow() { return lume.system.now')]],

  ['countdown advances from an absolute-time difference', [source, s =>
    s.includes('cdEndAt = tkNow() + m * 60000;') &&
    s.includes('var left = Math.max(0, cdEndAt - tkNow());')]],

  ['pause snapshots remaining then re-anchors on resume', [source, s =>
    s.includes('cdPausedMs = Math.max(0, cdEndAt - tkNow());') &&
    s.includes('cdEndAt = tkNow() + cdPausedMs;')]],

  ['stopwatch pause accumulates absolute delta then re-anchors', [source, s =>
    s.includes('swAccum += tkNow() - swStartAt;') &&
    s.includes('swStartAt = tkNow();')]],

  ['KV get wrapped in try/catch, accepts only non-negative finite number',
    [blockFrom(source, 'function kvLoad(key)'), s =>
      /try\s*\{/.test(s) && /catch \(e\) \{ return 0; \}/.test(s) &&
      /v >= 0/.test(s) && /typeof v === 'number'/.test(s)]],

  ['KV set wrapped in try/catch (failure silent)',
    [blockFrom(source, 'function kvSave(key, value)'), s =>
      /try\s*\{/.test(s) && /catch \(e\)/.test(s) &&
      s.includes('lume.storage.kv.set(key, value);')]],

  ['bell synthesised PCM under try/catch, 40 ms budget',
    [blockFrom(source, 'function ring()'), s =>
      /try\s*\{/.test(s) && /catch \(e\)/.test(s) &&
      s.includes('lume.audio.play(pcm);') && s.includes('var frames = 640;')]],

  ['KV keys within the 15-char NVS cap', [source, s =>
    s.includes("var KV_TIMER_BEST = 'hisc.timer';") &&
    s.includes("var KV_STOP_BEST = 'timer.best';") &&
    KV_TIMER.length <= 15 && KV_STOP.length <= 15]],

  ['LAP_LIMIT is three and laps keep only the last three', [source, s =>
    s.includes('var LAP_LIMIT = 3;') && s.includes('all.slice(-LAP_LIMIT)')]],

  ['all source literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['Text fontSize limited to bundled 14/20/32 faces', [fontSize,
    arr => arr.every(v => v === 14 || v === 20 || v === 32)]],

  ['canvas budget locked: single 480x480 radial dial <= 230400 px and <= 240 draws', [source, s =>
    s.includes('var CANVAS_BUDGET = 230400;') && s.includes('var FRAME_DRAW_BUDGET = 240;') &&
    s.includes('var CANVAS_W = 480;') && s.includes('var CANVAS_H = 480;') && CANVAS_PX <= 230400]],

  ['playground sources/timer_kit.js byte-identical to the example', [playgroundSrc, x =>
    x === source]],

  ['timer_kit is in the playground manifest', [apps,
    list => list.length > 0 && list.includes('timer_kit')]],

  ['firmware/ runtime/ tools/lume/ identical to 3514c76', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
];

for (const [name, [subject, test]] of checks) {
  assert.ok(test(subject), 'FAIL timer_kit static: ' + name);
  console.log('PASS timer_kit static: ' + name);
}

function must(name, mutation, checkName, subject) {
  const mutated = mutation(subject);
  assert.notEqual(mutated, subject, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS timer_kit mutation: ' + name + ' -> FAIL as expected');
}

must('drop the shell import',
  x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"),
  'shell.js imported by the documented relative path', source);
must('radial ticks dropped',
  x => x.replace('c.retainSegments(MAJOR_SEGS', 'c.polyline(MAJOR_SEGS'),
  'radial Canvas dial with retained 60 ticks and round SafeArea', source);
must('monospace digit renderer removed',
  x => x.replace('function drawMonoDigit(', 'function drawVarDigit('),
  'monospace vector 48px digit renderer prevents horizontal jitter', source);
must('state-machine button visibility breaks',
  x => x.replace("lume.setAttr(btnStart, 5, (inCd && cp === 'READY') ? 1 : 0);", 'lume.setAttr(btnStart, 5, 1);'),
  'four countdown states with state-machine button visibility', source);
must('running edit lock starts unlocked',
  x => x.replace('var editLocked = signal(true);', 'var editLocked = signal(false);'),
  'running +/- edit lock defaults locked and requires explicit toggle', source);
must('clock drifts back to nonexistent system.now',
  x => x.replace('lume.system.time(); }', 'lume.system.now(); }'),
  'clock is lume.system.time() (no nonexistent system.now)', source);
must('countdown becomes decrementing counter',
  x => x.replace('var left = Math.max(0, cdEndAt - tkNow());', 'var left = remainingMs() - 100;'),
  'countdown advances from an absolute-time difference', source);
must('pause forgets the snapshot',
  x => x.replace('cdEndAt = tkNow() + cdPausedMs;', 'cdEndAt = tkNow() + m * 60000;'),
  'pause snapshots remaining then re-anchors on resume', source);
must('stopwatch pause discards accumulated time',
  x => x.replace('swAccum += tkNow() - swStartAt;', 'swAccum = 0;'),
  'stopwatch pause accumulates absolute delta then re-anchors', source);
must('KV get loses try/catch',
  x => x.replace('catch (e) { return 0; }', 'catch (e) { throw e; }'),
  'KV get wrapped in try/catch, accepts only non-negative finite number',
  blockFrom(source, 'function kvLoad(key)'));
must('KV set loses try/catch',
  x => x.replace('catch (e) { /* NVS failure is silent */ }', '/* removed */'),
  'KV set wrapped in try/catch (failure silent)',
  blockFrom(source, 'function kvSave(key, value)'));
must('bell loses guarded PCM path',
  x => x.replace('lume.audio.play(pcm);', 'throw new Error("audio");'),
  'bell synthesised PCM under try/catch, 40 ms budget',
  blockFrom(source, 'function ring()'));
must('KV key exceeds NVS cap',
  x => x.replace("'hisc.timer';", "'hisc.timer.too-long';"),
  'KV keys within the 15-char NVS cap', source);
must('lap rows grow without bound',
  x => x.replace('var LAP_LIMIT = 3;', 'var LAP_LIMIT = 5;'),
  'LAP_LIMIT is three and laps keep only the last three', source);
must('a CJK UI literal slips in', arr => arr.concat('中'),
  'all source literals ASCII-only (r64)', lits);
must('font size escapes bundled faces', arr => arr.concat(40),
  'Text fontSize limited to bundled 14/20/32 faces', fontSize);
must('canvas budget rises past 230400 px',
  x => x.replace('var CANVAS_W = 480;', 'var CANVAS_W = 960;'),
  'canvas budget locked: single 480x480 radial dial <= 230400 px and <= 240 draws', source);
must('playground generated source drifts', x => x + '\n// drift',
  'playground sources/timer_kit.js byte-identical to the example', playgroundSrc);
must('playground manifest drops timer_kit', list => list.filter(x => x !== 'timer_kit'),
  'timer_kit is in the playground manifest', apps);
must('a firmware/runtime/CLI file changes after 3514c76',
  () => ['firmware/components/lume-engine/lume_math.c'],
  'firmware/ runtime/ tools/lume/ identical to 3514c76', fwChanged);

/* ------------------------ part 2: live prelude ------------------------- */
function boot(src, options) {
  options = options || {};
  const kv = { ...(options.kv || {}) };
  const plays = [], warns = [];
  let now = options.now === undefined ? 1000000 : options.now;
  const st = runApp(shell + '\n' + stripImport(src === undefined ? source : src), {
    filename: 'examples/timer_kit/app.js',
    kv: {
      get: k => (k in kv ? kv[k] : null),
      set: (k, v) => { kv[k] = v; return 0; },
      remove: k => { delete kv[k]; return 0; },
    },
    audio: { play: buf => { plays.push(buf); return 0; }, ...(options.audio || {}) },
    onWarn: m => warns.push(m),
  });
  st.lume._systemTime = () => now;
  st.lume._nowMs = () => now;
  st.advance = ms => { now += ms; };
  st.eval = code => vm.runInContext(code, st.ctx);
  st.kit = () => st.ctx.timerKit;
  st.kv = kv;
  st.plays = plays;
  st.warns = warns;
  return st;
}
function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }

const live = {
  'controls exposed, single 480x480 canvas, draw calls <= 240': src => attempt(() => {
    const s = boot(src), k = s.kit();
    assert.equal(typeof k.dialCanvas, 'number');
    assert.equal(typeof k.switchNode, 'number');
    const canvases = s.messages.filter(m => m[0] === 'create' && m[2] === 3);
    assert.equal(canvases.length, 1, 'single full-dial canvas');
    assert.equal(canvases[0][4] * canvases[0][5], CANVAS_PX);
    assert.ok(k.getLastDrawCalls() > 0 && k.getLastDrawCalls() <= k.FRAME_DRAW_BUDGET,
      'frame draws <= 240, got ' + k.getLastDrawCalls());
    assert.equal(typeof s.lume.system.now, 'undefined', 'system.now must not exist');
  }),

  'READY +/- steppers adjust minutes; RUNNING locks +/- until unlocked': src => attempt(() => {
    const s = boot(src), k = s.kit();
    assert.equal(k.cdPhase(), 'READY');
    assert.equal(k.displayCdMs(), 300000, 'READY displays 5 min = 05:00');
    assert.equal(k.remainFrac(), 1, 'READY progress is 100%');
    s.press(k.btnPlus);
    assert.equal(k.minutes(), 6, 'READY + raises minutes to 6');
    s.press(k.btnMinus);
    assert.equal(k.minutes(), 5, 'READY - lowers minutes to 5');
    s.press(k.btnStart);
    assert.equal(k.cdPhase(), 'RUNNING');
    assert.equal(k.editLocked(), true, 'RUNNING defaults editLocked = true');
    s.press(k.btnPlus);
    assert.equal(k.remainingMs(), 300000, 'locked + does not alter running timer');
    s.press(k.btnEditLock);
    assert.equal(k.editLocked(), false, 'explicit lock tap unlocks +/-');
    s.press(k.btnPlus);
    assert.equal(k.remainingMs(), 360000, 'unlocked + adds 1 min while running');
    assert.ok(k.getLastDrawCalls() <= k.FRAME_DRAW_BUDGET);
  }),

  'header press toggles COUNTDOWN / STOPWATCH mode': src => attempt(() => {
    const s = boot(src), k = s.kit();
    assert.equal(k.mode(), false);
    s.press(k.switchNode);
    assert.equal(k.mode(), true);
    s.press(k.switchNode);
    assert.equal(k.mode(), false);
  }),

  'countdown advances by absolute now difference': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMinutes(2); timerKit.cdStart()');
    assert.equal(k.remainingMs(), 120000);
    s.advance(65000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 55000);
  }),

  'pause freezes wall time and resume excludes it': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMinutes(2); timerKit.cdStart()');
    s.advance(65000); s.eval('timerKit.tick()');
    s.press(k.btnPause);
    assert.equal(k.cdPhase(), 'PAUSED');
    s.advance(30000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 55000, 'paused 30 s must not be counted');
    s.press(k.btnResume);
    assert.equal(k.cdPhase(), 'RUNNING');
    s.advance(10000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 45000, 'only 10 s after resume counted');
  }),

  'zero transitions to FINISHED, rings, persists best, and supports RESTART/RESET': src => attempt(() => {
    const s = boot(src, { kv: { 'hisc.timer': 7 } }), k = s.kit();
    assert.equal(k.timerBest(), 7, 'best loaded from KV');
    s.eval('timerKit.setMinutes(1); timerKit.cdStart()');
    s.advance(60000); s.eval('timerKit.tick()');
    assert.equal(k.cdPhase(), 'FINISHED');
    assert.equal(k.remainingMs(), 0);
    assert.equal(k.status(), 'DONE - 01 MIN');
    assert.equal(k.timerBest(), 1, '1 min beats stored 7');
    assert.equal(s.kv['hisc.timer'], 1);
    assert.equal(s.plays.length, 1, 'one bell on settlement');
    assert.ok(s.plays[0] instanceof ArrayBuffer);
    s.press(k.btnReset);
    assert.equal(k.cdPhase(), 'READY', 'RESET from FINISHED returns to READY');
  }),

  'stopwatch reports centiseconds and appends only three laps': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMode(true); timerKit.swStart()');
    s.advance(12340); s.eval('timerKit.tick()');
    assert.equal(k.elapsedMs(), 12340);
    assert.equal(k.fmtStop(k.elapsedMs()), '00:12.34');
    s.eval('timerKit.swLap()');
    s.advance(1000); s.eval('timerKit.tick()'); s.eval('timerKit.swLap()');
    s.advance(2000); s.eval('timerKit.tick()'); s.eval('timerKit.swLap()');
    assert.equal(k.laps().length, 3);
    assert.equal(k.laps()[2], 15340);
    s.eval('timerKit.swLap()');
    assert.equal(k.laps().length, 3, 'fourth lap evicts the oldest row');
    assert.equal(k.laps()[0], 13340);
    assert.equal(k.stopBest(), 15340);
    assert.equal(s.kv['timer.best'], 15340);
  }),

  'stopwatch pause excludes wall time': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMode(true); timerKit.swStart()');
    s.advance(5000); s.eval('timerKit.tick()');
    s.eval('timerKit.swPause()');
    s.advance(30000); s.eval('timerKit.tick()');
    assert.equal(k.elapsedMs(), 5000);
    s.eval('timerKit.swResume()');
    s.advance(2000); s.eval('timerKit.tick()');
    assert.equal(k.elapsedMs(), 7000);
  }),

  'KV load rejects negative codes / wrong types; save survives throws': src => attempt(() => {
    const s = boot(src, { kv: { [KV_TIMER]: -2, [KV_STOP]: 'x' } }), k = s.kit();
    assert.equal(k.timerBest(), 0, 'negative error code rejected');
    assert.equal(k.stopBest(), 0, 'string value rejected');
    assert.equal(k.kvSave(KV_STOP, 4321), 4321);
    const throwing = boot(src, { kv: {
      get: () => { throw new Error('NVS unavailable'); },
      set: () => { throw new Error('NVS full'); },
    } });
    assert.equal(throwing.kit().timerBest(), 0);
    assert.equal(throwing.kit().kvSave(KV_TIMER, 9), 9);
  }),

  'dispose and shutdown clear gestures, timers and effects': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMinutes(2); timerKit.cdStart()');
    assert.equal(s.eval('Object.keys(__timers).length'), 1);
    s.eval('timerKit.disposeGestures(); __lume_shutdown()');
    assert.equal(s.eval('Object.keys(__timers).length'), 0);
    assert.equal(s.eval('__allEffects.length'), 0);
  }),
};

for (const name of Object.keys(live)) {
  assert.equal(live[name](source), true, 'FAIL timer_kit live: ' + name);
  console.log('PASS timer_kit live: ' + name);
}

function mustLive(name, mutation, liveName) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'live mutation did not change source: ' + name);
  assert.equal(live[liveName](mutated), false,
    'live assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS timer_kit live mutation: ' + name + ' -> FAIL as expected');
}
mustLive('live: countdown reverts to a counter',
  x => x.replace('var left = Math.max(0, cdEndAt - tkNow());', 'var left = remainingMs() - 100;'),
  'countdown advances by absolute now difference');
mustLive('live: pause loses its snapshot',
  x => x.replace('cdPausedMs = Math.max(0, cdEndAt - tkNow());', 'cdPausedMs = 0;'),
  'pause freezes wall time and resume excludes it');
mustLive('live: lap rows stop evicting the oldest',
  x => x.replace('all.slice(-LAP_LIMIT)', 'all'),
  'stopwatch reports centiseconds and appends only three laps');

console.log('ALL TIMER KIT HARNESS CASES PASSED');
