/*
 * r157 host harness for examples/timer_kit (countdown + stopwatch, pure app).
 *
 *   node tests/timer_kit.js
 *
 * Part 1: static source contracts -- the three r151 shell controls are really
 * consumed, the absolute-time pause semantics, the KV / bell try-catch, the
 * ASCII / font / canvas discipline, the byte-identical playground source, the
 * playground manifest, and firmware/runtime/tools/lume zero-diff vs 6426f7b.
 * Every predicate has a mutation proof (18 static + 3 live).
 *
 * Part 2: live runs of the REAL app against the firmware prelude + shell.js.
 * A fake millisecond clock is injected through lume._systemTime/_nowMs; the
 * gesture / press / dispose paths are the real ones. No board, no touch, no
 * audible acceptance -- host / compile evidence only (r157 report).
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
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)
const source = read('examples/timer_kit/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/timer_kit.js');
const KV_TIMER = 'hisc.timer', KV_STOP = 'timer.best';
const CANVAS_PX = 432 * 40;

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

  ['Switch consumed with mode signal and setMode onChange', [source, s =>
    s.includes('lume.ui.shell.Switch({') && s.includes('value: mode') &&
    s.includes('onChange: function (v) { setMode(v); }')]],

  ['Slider consumed 0..60 step 1, minutes value, setMinutes onChange', [source, s =>
    s.includes('lume.ui.shell.Slider({') && s.includes('min: 0, max: 60, step: 1') &&
    s.includes('value: minutes') &&
    s.includes('onChange: function (v) { setMinutes(v); }')]],

  ['Progress consumed with remainFrac getter', [source, s =>
    s.includes('lume.ui.shell.Progress({') && s.includes('value: remainFrac')]],

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
    arr => arr.length > 0 && arr.every(v => v === 14 || v === 20 || v === 32)]],

  ['canvas budget locked: slider only, 17280 <= 230400 px', [source, s =>
    s.includes('CANVAS_BUDGET: 230400') && s.includes('SLIDER_W: 432') &&
    s.includes('SLIDER_H: 40') && CANVAS_PX <= 230400]],

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

const IMPORT = 'shell.js imported by the documented relative path';
const SWITCH = 'Switch consumed with mode signal and setMode onChange';
const SLIDER = 'Slider consumed 0..60 step 1, minutes value, setMinutes onChange';
const PROGRESS = 'Progress consumed with remainFrac getter';
const CLOCK = 'clock is lume.system.time() (no nonexistent system.now)';
const ABSDIFF = 'countdown advances from an absolute-time difference';
const PAUSE = 'pause snapshots remaining then re-anchors on resume';
const SWPAUSE = 'stopwatch pause accumulates absolute delta then re-anchors';
const KVGET = 'KV get wrapped in try/catch, accepts only non-negative finite number';
const KVSET = 'KV set wrapped in try/catch (failure silent)';
const BELL = 'bell synthesised PCM under try/catch, 40 ms budget';
const KEYS = 'KV keys within the 15-char NVS cap';
const LAPS = 'LAP_LIMIT is three and laps keep only the last three';
const ASCII = 'all source literals ASCII-only (r64)';
const FONT = 'Text fontSize limited to bundled 14/20/32 faces';
const BUDGET = 'canvas budget locked: slider only, 17280 <= 230400 px';
const SRC = 'playground sources/timer_kit.js byte-identical to the example';
const MANIFEST = 'timer_kit is in the playground manifest';
const GUARD = 'firmware/ runtime/ tools/lume/ identical to 3514c76';

must('drop the shell import',
  x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"), IMPORT, source);
must('app stops consuming Switch',
  x => x.replace('lume.ui.shell.Switch({', 'View({'), SWITCH, source);
must('app stops consuming Slider',
  x => x.replace('lume.ui.shell.Slider({', 'View({'), SLIDER, source);
must('app stops consuming Progress',
  x => x.replace('lume.ui.shell.Progress({', 'View({'), PROGRESS, source);
must('clock drifts back to a nonexistent system.now',
  x => x.replace('lume.system.time(); }', 'lume.system.now(); }'), CLOCK, source);
must('countdown becomes a decrementing counter',
  x => x.replace('var left = Math.max(0, cdEndAt - tkNow());', 'var left = remainingMs() - 100;'),
  ABSDIFF, source);
must('pause forgets the snapshot',
  x => x.replace('cdEndAt = tkNow() + cdPausedMs;', 'cdEndAt = tkNow() + m * 60000;'),
  PAUSE, source);
must('stopwatch pause discards accumulated time',
  x => x.replace('swAccum += tkNow() - swStartAt;', 'swAccum = 0;'), SWPAUSE, source);
must('KV get loses try/catch',
  x => x.replace('catch (e) { return 0; }', 'catch (e) { throw e; }'), KVGET,
  blockFrom(source, 'function kvLoad(key)'));
must('KV set loses try/catch',
  x => x.replace('catch (e) { /* NVS failure is silent */ }', '/* removed */'), KVSET,
  blockFrom(source, 'function kvSave(key, value)'));
must('bell loses its guarded PCM path',
  x => x.replace('lume.audio.play(pcm);', 'throw new Error("audio");'), BELL,
  blockFrom(source, 'function ring()'));
must('KV key exceeds the NVS cap',
  x => x.replace("'hisc.timer';", "'hisc.timer.too-long';"), KEYS, source);
must('lap rows grow without bound',
  x => x.replace('var LAP_LIMIT = 3;', 'var LAP_LIMIT = 5;'), LAPS, source);
must('a CJK UI literal slips in', arr => arr.concat('中'), ASCII, lits);
must('font size escapes the bundled faces',
  arr => arr.concat(40), FONT, fontSize);
must('canvas budget rises past 230400 px',
  x => x.replace('SLIDER_W: 432', 'SLIDER_W: 40000'), BUDGET, source);
must('playground generated source drifts',
  x => x + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops timer_kit',
  list => list.filter(x => x !== 'timer_kit'), MANIFEST, apps);
must('a firmware/runtime/CLI file changes after 6426f7b',
  () => ['firmware/components/lume-engine/lume_scripts.c'], GUARD, fwChanged);

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
  'controls exposed and canvas bounded': src => attempt(() => {
    const s = boot(src), k = s.kit();
    assert.equal(typeof k.switchNode, 'number');
    assert.equal(typeof k.sliderNode, 'number');
    assert.equal(typeof k.progressNode, 'number');
    const canvases = s.messages.filter(m => m[0] === 'create' && m[2] === 3);
    assert.equal(canvases.length, 1, 'the slider is the only canvas');
    assert.equal(canvases[0][4] * canvases[0][5], CANVAS_PX);
    assert.ok(CANVAS_PX <= k.CANVAS_BUDGET);
    assert.equal(typeof s.lume.system.now, 'undefined', 'system.now must not exist');
  }),

  'slider drag writes a step-quantised minute value': src => attempt(() => {
    const s = boot(src), k = s.kit();
    s.eval('timerKit.setMinutes(5)');
    const id = k.sliderNode;
    s.gesture(id, 0, 100, 200, 0);                       /* DOWN */
    s.gesture(id, 1, 150.4, 200, 50);                    /* dx = 50.4 px */
    s.gesture(id, 2, 150.4, 200, 100);                   /* UP */
    assert.equal(k.minutes(), 12, '5 + 50.4*60/432 = 12 at step 1');
  }),

  'switch toggles TIMER / STOPWATCH view': src => attempt(() => {
    const s = boot(src), k = s.kit();
    assert.equal(k.mode(), false);
    s.press(k.switchNode);
    assert.equal(k.mode(), true);
    assert.ok(s.messages.some(m => m[0] === 'attr' && m[3] === 1000),
      'inactive panel moved off-screen via bound x getter');
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
    s.eval('timerKit.cdPause()');
    s.advance(30000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 55000, 'paused 30 s must not be counted');
    s.eval('timerKit.cdResume()');
    s.advance(10000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 45000, 'only 10 s after resume counted');
  }),

  'zero settles, rings and persists the shortest completed setting': src => attempt(() => {
    const s = boot(src, { kv: { 'hisc.timer': 7 } }), k = s.kit();
    assert.equal(k.timerBest(), 7, 'best loaded from KV');
    s.eval('timerKit.setMinutes(1); timerKit.cdStart()');
    s.advance(60000); s.eval('timerKit.tick()');
    assert.equal(k.remainingMs(), 0);
    assert.equal(k.status(), 'DONE - 01 MIN');
    assert.equal(k.timerBest(), 1, '1 min beats stored 7');
    assert.equal(s.kv['hisc.timer'], 1);
    assert.equal(s.plays.length, 1, 'one bell on settlement');
    assert.ok(s.plays[0] instanceof ArrayBuffer);
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
    assert.equal(k.laps().length, 3, 'fourth laps evicts the oldest row');
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
    s.eval('lume.ui.shell.dispose(timerKit.sliderNode)');
    s.gesture(k.sliderNode, 0, 100, 200, 0);
    s.gesture(k.sliderNode, 1, 150.4, 200, 50);
    assert.equal(k.minutes(), 2, 'slider gesture unsubscribed on dispose');
    s.eval('__lume_shutdown()');
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
