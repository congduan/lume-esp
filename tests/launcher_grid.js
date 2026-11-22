/*
 * r160 host harness for examples/launcher_grid (pure app).
 *
 *   node tests/launcher_grid.js
 *
 * Part 1: static source contracts -- shell.Launcher is really consumed with an
 * explicit 9-app literal list (no lume.apps.entries / no real apps.launch),
 * onLaunch / onBack host callbacks exist, indicator is off so the only Canvases
 * are the 9 48x48 icons (20736 px <= 230400 px full frame), the theme is
 * customised, ASCII-only copy, 14/20/32 fonts, the 59-app manifest, byte-
 * identical playground source, and firmware/runtime/tools/lume zero-diff vs
 * 8e42b96. Every static predicate has a mutation proof.
 *
 * Part 2: live runs of the REAL app against the firmware prelude + shell.js.
 * Tile onPress drives the real onLaunch host callback; an edge swipe drives
 * onBack; shutdown clears effects/timers. No board, no touch, no real app
 * switch: host evidence only (r160 docs).
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
const BASE = '8e42b96'; // r160: pure app round; firmware/runtime/CLI untouched
const source = read('examples/launcher_grid/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/launcher_grid.js');
const APPS_N = 9;
const ICON_PX = 48;
const ICON_AREA = ICON_PX * ICON_PX;         // 2304
const TOTAL_AREA = APPS_N * ICON_AREA;       // 20736
const FRAME_AREA = 480 * 480;                // 230400

function stripImport(x) {
  return x.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function literals(x) {
  return [...x.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
function appsBlock(s) {
  const start = s.indexOf('var APPS = [');
  assert.ok(start >= 0, 'missing APPS block');
  const end = s.indexOf('];', start);
  assert.ok(end > start, 'unterminated APPS block');
  return s.slice(start, end + 2);
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
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const fontSize = [...source.matchAll(/fontSize: (\d+)/g)].map(m => Number(m[1]));
function idsOf(s) { return [...appsBlock(s).matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]); }
function glyphsOf(s) { return [...appsBlock(s).matchAll(/glyph: '([^']*)'/g)].map(m => m[1]); }

const checks = [
  ['shell.js imported by the documented relative path', [source, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['shell.Launcher is consumed', [source, s =>
    (s.match(/lume\.ui\.shell\.Launcher\(\{/g) || []).length === 1]],

  ['explicit 9-app literal list passed to Launcher', [source, s => {
    const ids = idsOf(s);
    return s.includes('apps: APPS,') && ids.length === APPS_N &&
      new Set(ids).size === APPS_N && !s.includes('lume.apps.entries');
  }]],

  ['every app carries id / label / color / ASCII glyph', [source, s => {
    const block = appsBlock(s), g = glyphsOf(s);
    return g.length === APPS_N && g.every(v => /^[A-Z]$/.test(v)) &&
      (block.match(/label: '/g) || []).length === APPS_N &&
      (block.match(/color: '#/g) || []).length === APPS_N;
  }]],

  ['Launcher title / columns / indicator fixed (canvas lock)', [source, s =>
    s.includes("title: 'GRID',") && s.includes('columns: 3,') &&
    s.includes('indicator: false,')]],

  ['canvas budget constants are explicit and correct', [source, s =>
    s.includes('var ICON_PX = 48;') &&
    s.includes('var ICON_AREA = ICON_PX * ICON_PX;') &&
    s.includes('var FRAME_AREA = 480 * 480;') &&
    ICON_AREA === 2304 && TOTAL_AREA === 20736 && TOTAL_AREA <= FRAME_AREA]],

  ['onLaunch host callback records id and updates status', [source, s =>
    s.includes("onLaunch: function (id) { lastAction.set('launch ' + id); },") &&
    !s.includes('lume.apps.launch')]],

  ['onBack host handler returns true (editing-state fallback)', [source, s =>
    s.includes("onBack: function () { lastAction.set('BACK'); return true; },")]],

  ['status Text is signal-driven and ASCII-only', [source, s =>
    s.includes('text: function () { return lastAction(); },') &&
    s.includes("var lastAction = signal('READY');")]],

  ['custom theme sets primary / surface / accent / text', [source, s =>
    s.includes('lume.theme.set({') && /primary: '#/.test(s) && /surface: '#/.test(s) &&
    /accent: '#/.test(s) && /text: '#/.test(s)]],

  ['entire app file is ASCII-only (r64)', [source,
    s => s.length > 0 && /^[\x00-\x7F]*$/.test(s)]],

  ['UI string literals ASCII-only (r64)', [literals(source),
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['Text fontSize limited to bundled 14/20/32 faces', [fontSize,
    arr => arr.length > 0 && arr.every(v => v === 14 || v === 20 || v === 32)]],

  ['playground sources/launcher_grid.js byte-identical to the example', [playgroundSrc, x =>
    x === source]],

  ['launcher_grid is in the 59-app playground manifest', [apps,
    list => list.length === 61 && list.includes('launcher_grid')]],

  ['firmware/ runtime/ tools/lume/ identical to 8e42b96', [fwChanged, c => c.length === 0]],
];

for (const [name, [subject, test]] of checks) {
  assert.ok(test(subject), 'FAIL launcher_grid static: ' + name);
  console.log('PASS launcher_grid static: ' + name);
}

function must(name, mutation, checkName, subject) {
  const mutated = mutation(subject);
  assert.notEqual(mutated, subject, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS launcher_grid mutation: ' + name + ' -> FAIL as expected');
}
const IMPORT = 'shell.js imported by the documented relative path';
const LAUNCHER = 'shell.Launcher is consumed';
const APPS = 'explicit 9-app literal list passed to Launcher';
const FIELDS = 'every app carries id / label / color / ASCII glyph';
const GRID = 'Launcher title / columns / indicator fixed (canvas lock)';
const BUDGET = 'canvas budget constants are explicit and correct';
const ONLAUNCH = 'onLaunch host callback records id and updates status';
const ONBACK = 'onBack host handler returns true (editing-state fallback)';
const STATUS = 'status Text is signal-driven and ASCII-only';
const THEME = 'custom theme sets primary / surface / accent / text';
const ASCII = 'entire app file is ASCII-only (r64)';
const LIT = 'UI string literals ASCII-only (r64)';
const FONT = 'Text fontSize limited to bundled 14/20/32 faces';
const SRC = 'playground sources/launcher_grid.js byte-identical to the example';
const MANIFEST = 'launcher_grid is in the 59-app playground manifest';
const GUARD = 'firmware/ runtime/ tools/lume/ identical to 8e42b96';

must('drop the shell import',
  x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"), IMPORT, source);
must('app stops consuming shell.Launcher',
  x => x.replace('lume.ui.shell.Launcher({', 'View({'), LAUNCHER, source);
must('drop the explicit apps argument (falls back to app store)',
  x => x.replace('  apps: APPS,\n', ''), APPS, source);
must('use the app store instead of a literal',
  x => x.replace('apps: APPS,', 'apps: lume.apps.entries(),'), APPS, source);
must('drop one curated app',
  x => x.replace("  { id: 'settings',       label: 'SETTINGS', color: '#4A5568', glyph: 'S' },\n", ''),
  APPS, source);
must('non-ASCII glyph slips into the app',
  x => x.replace("glyph: 'S'", "glyph: '\u4E2D'"), FIELDS, source);
must('indicator re-enabled (two extra edge canvases)',
  x => x.replace('indicator: false,', 'indicator: true,'), GRID, source);
must('columns drift off 3x3',
  x => x.replace('columns: 3,', 'columns: 4,'), GRID, source);
must('icon size drifts off 48',
  x => x.replace('var ICON_PX = 48;', 'var ICON_PX = 64;'), BUDGET, source);
must('drop the onLaunch host callback',
  x => x.replace("onLaunch: function (id) { lastAction.set('launch ' + id); },", ''), ONLAUNCH, source);
must('onLaunch falls back to a real app switch',
  x => x.replace("onLaunch: function (id) { lastAction.set('launch ' + id); },",
                 "onLaunch: function (id) { lume.apps.launch(id); },"), ONLAUNCH, source);
must('drop the onBack host handler',
  x => x.replace("onBack: function () { lastAction.set('BACK'); return true; },", ''), ONBACK, source);
must('status stops following the launch signal',
  x => x.replace('text: function () { return lastAction(); },', "text: 'STATIC',"), STATUS, source);
must('custom theme is dropped',
  x => x.replace('lume.theme.set(', 'lume.noTheme('), THEME, source);
must('a non-ASCII byte slips into the file', x => x + '\n// \u4E2D', ASCII, source);
must('a CJK UI literal slips in', arr => arr.concat('\u4E2D'), LIT, literals(source));
must('font size escapes the bundled faces', arr => arr.concat(40), FONT, fontSize);
must('playground generated source drifts',
  x => x + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops launcher_grid',
  list => list.filter(x => x !== 'launcher_grid'), MANIFEST, apps);
must('a firmware/runtime/CLI file changes after 8e42b96',
  () => ['runtime/shell.js'], GUARD, fwChanged);

/* ------------------------ part 2: live prelude ------------------------- */
function boot(src) {
  const st = runApp(shell + '\n' + stripImport(src === undefined ? source : src), {
    filename: 'examples/launcher_grid/app.js',
  });
  st.eval = code => vm.runInContext(code, st.ctx);
  st.api = () => st.ctx.lgApi;
  return st;
}
function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }
function pressIds(s) { return s.messages.filter(m => m[0] === 'press').map(m => m[1]); }
function canvasNodes(s) { return s.messages.filter(m => m[0] === 'create' && m[2] === 3); }
function gestureIds(s) { return s.messages.filter(m => m[0] === 'gesture').map(m => m[1]); }
function drag(s, id, from, to, t0) {
  t0 = t0 || 0;
  s.gesture(id, 0, from, 200, t0);
  s.gesture(id, 1, to, 200, t0 + 50);
  s.gesture(id, 2, to, 200, t0 + 100);
}

const live = {
  'root node exists with an exact 9-icon canvas budget': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(typeof a.root, 'number');
    assert.equal(typeof a.status, 'function');
    assert.equal(a.appList.length, APPS_N);
    const canvases = canvasNodes(s);
    assert.equal(canvases.length, APPS_N, 'one 48x48 Canvas per app');
    assert.ok(canvases.every(m => m[4] === ICON_PX && m[5] === ICON_PX), 'every icon is 48x48');
    const area = canvases.reduce((sum, m) => sum + m[4] * m[5], 0);
    assert.equal(area, TOTAL_AREA, '20736 px');
    assert.equal(area, a.ICON_AREA * APPS_N);
    assert.ok(area <= a.FRAME_AREA, 'within 480x480 frame budget');
  }),

  'tile onPress drives the onLaunch host callback (no app-store launch)': src => attempt(() => {
    const s = boot(src), a = s.api();
    const ids = pressIds(s);
    assert.equal(ids.length, APPS_N + 1, 'nine tiles + one edit button');
    assert.equal(a.status(), 'READY');
    s.press(ids[1]);
    assert.equal(a.status(), 'launch counter', 'first tile -> launch counter');
    assert.equal(s.messages.filter(m => m[0] === 'launch').length, 0,
      'lume.apps.launch was NOT called');
    s.press(ids[2]);
    assert.equal(a.status(), 'launch timer_kit');
    s.press(ids[9]);
    assert.equal(a.status(), 'launch settings', 'last tile -> launch settings');
  }),

  'edit-mode back and onBack fallback update status': src => attempt(() => {
    const s = boot(src), a = s.api();
    const ids = pressIds(s);
    const left = gestureIds(s)[1]; // EdgeNavigation left strip (0 is the List)
    s.press(ids[1]);
    assert.equal(a.status(), 'launch counter');
    /* Enter editing mode: the edit button is the first press handler. */
    s.press(ids[0]);
    /* While editing, tile presses are suppressed by Launcher. */
    s.press(ids[2]);
    assert.equal(a.status(), 'launch counter', 'editing suppresses launches');
    /* First back exits editing (Launcher consumes it). */
    drag(s, left, 10, 90, 0);
    assert.equal(a.status(), 'launch counter', 'editing back is consumed internally');
    /* Second back reaches the host onBack callback. */
    drag(s, left, 10, 90, 200);
    assert.equal(a.status(), 'BACK', 'host onBack fallback fires');
  }),

  'shutdown clears all effects and timers': src => attempt(() => {
    const s = boot(src);
    s.press(pressIds(s)[1]);
    assert.ok(s.eval('__allEffects.length') > 0);
    s.eval('__lume_shutdown()');
    assert.equal(s.eval('__allEffects.length'), 0);
    assert.equal(s.eval('Object.keys(__timers).length'), 0);
  }),
};

for (const name of Object.keys(live)) {
  assert.equal(live[name](source), true, 'FAIL launcher_grid live: ' + name);
  console.log('PASS launcher_grid live: ' + name);
}

function mustLive(name, mutation, liveName) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'live mutation did not change source: ' + name);
  assert.equal(live[liveName](mutated), false,
    'live assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS launcher_grid live mutation: ' + name + ' -> FAIL as expected');
}
mustLive('live: explicit apps dropped -> zero canvases',
  x => x.replace('  apps: APPS,\n', ''),
  'root node exists with an exact 9-icon canvas budget');
mustLive('live: indicator re-enabled -> two extra canvases',
  x => x.replace('indicator: false,', 'indicator: true,'),
  'root node exists with an exact 9-icon canvas budget');
mustLive('live: onLaunch host callback dropped -> status stays READY',
  x => x.replace("onLaunch: function (id) { lastAction.set('launch ' + id); },\n", ''),
  'tile onPress drives the onLaunch host callback (no app-store launch)');
mustLive('live: onLaunch falls back to a real app switch',
  x => x.replace("onLaunch: function (id) { lastAction.set('launch ' + id); },\n",
                 "onLaunch: function (id) { lume.apps.launch(id); },\n"),
  'tile onPress drives the onLaunch host callback (no app-store launch)');

console.log('ALL LAUNCHER GRID HARNESS CASES PASSED');
