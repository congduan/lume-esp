/*
 * r204 host harness for examples/launcher_grid v2 (3x4 = 12 real repo apps,
 * 12 vector Canvas icons, SNTP wall clock / '--:--', EDIT tile swap, page dots).
 *
 *   node tests/launcher_grid.js
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
const source = read('examples/launcher_grid/app.js');
const shell = read('runtime/shell.js');
const dts = read('runtime/types/lume.d.ts');
const harness = read('tests/launcher_grid.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/launcher_grid.js');
const APPS_N = 12;
const ICON_PX = 48;
const ICON_AREA = ICON_PX * ICON_PX;         // 2304
const TOTAL_AREA = APPS_N * ICON_AREA;       // 27648
const FRAME_AREA = 480 * 480;                // 230400

function stripImport(x) {
  return x.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function literals(x) {
  return [...x.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
function appsBlock(s) {
  const start = s.indexOf('var INITIAL_APPS = [');
  assert.ok(start >= 0, 'missing INITIAL_APPS block');
  const end = s.indexOf('];', start);
  assert.ok(end > start, 'unterminated INITIAL_APPS block');
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
function propsBlock(s, name) {
  const start = s.indexOf('interface ' + name + ' {');
  assert.ok(start >= 0, 'missing interface ' + name);
  const end = s.indexOf('\n  }', start);
  assert.ok(end > start, 'unterminated interface ' + name);
  return s.slice(start, end);
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
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/shot.js', 'tools/lume/transport.js',
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
const fontSize = [...source.matchAll(/fontSize: (\d+)/g)].map(m => Number(m[1]));
const realExampleDirs = new Set(fs.readdirSync(path.join(root, 'examples'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name));
function idsOf(s) { return [...appsBlock(s).matchAll(/\{ id: '([^']+)'/g)].map(m => m[1]); }
function iconsOf(s) { return [...appsBlock(s).matchAll(/icon: '([^']+)'/g)].map(m => m[1]); }

const checks = [
  ['shell.js imported by the documented relative path', [source, s =>
    s.includes("import '../../runtime/shell.js';") &&
    (s.match(/^\s*import\s/gm) || []).length === 1]],

  ['round SafeArea and vector Canvas icons (no single-letter c.text glyphs)', [source, s =>
    s.includes("lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: SW") &&
    s.includes('function drawIconGlyph(') && !s.includes('c.text(')]],

  ['explicit 12-app literal list rendered in 3x4 grid, all real examples', [source, s => {
    const ids = idsOf(s);
    return s.includes('var COLUMNS = 3;') && s.includes('var ROWS = 4;') &&
      ids.length === APPS_N && new Set(ids).size === APPS_N &&
      ids.every(id => realExampleDirs.has(id)) && !s.includes('lume.apps.entries');
  }]],

  ['12 distinct vector icons with staggered greens and unified tonal rings', [source, s => {
    const block = appsBlock(s), icons = iconsOf(s);
    return icons.length === APPS_N && new Set(icons).size === APPS_N &&
      (block.match(/ring: '#/g) || []).length === APPS_N &&
      s.includes("ink: '#40D8B0'") && s.includes("ink: '#7CE850'") && s.includes("ink: '#38C8E8'");
  }]],

  ['SNTP wall clock falls back honestly to --:-- when unsynced', [source, s =>
    s.includes('var WALL_MIN_MS = 1577836800000;') &&
    s.includes("return '--:--';") && s.includes('lume.system.time()')]],

  ['EdgeNavigation indicator disabled (canvas lock)', [source, s =>
    s.includes('lume.ui.shell.EdgeNavigation({ parent: root, indicator: false,')]],

  ['canvas budget constants are explicit and correct (12 x 48x48 = 27648 <= 230400)', [source, s =>
    s.includes('var ICON_PX = 48;') &&
    s.includes('var ICON_AREA = ICON_PX * ICON_PX;') &&
    s.includes('var FRAME_AREA = 480 * 480;') &&
    ICON_AREA === 2304 && TOTAL_AREA === 27648 && TOTAL_AREA <= FRAME_AREA]],

  ['onLaunch host callback records id and updates status', [source, s =>
    s.includes("function onLaunch(id) { lastAction.set('launch ' + id); }") &&
    !s.includes('lume.apps.launch')]],

  ['onBack host handler returns true (editing-state fallback)', [source, s =>
    s.includes("function onBack() { lastAction.set('BACK'); return true; }")]],

  ['status header shows EDIT when editing and clock otherwise', [source, s =>
    s.includes("return editing() ? 'EDIT' : clockText();") &&
    s.includes("var lastAction = signal('READY');")]],

  ['shell.Launcher setEditing notifies onEditingChange at both change points', [shell, s =>
    s.includes('function setEditing(v) { editing.set(v); if (p.onEditingChange) p.onEditingChange(v); }') &&
    (s.match(/editing\.set\(/g) || []).length === 1 &&
    s.includes('onPress: function () { setEditing(!editing()); }') &&
    s.includes('if (editing()) { setEditing(false); return true; }')]],

  ['LauncherProps declares the onEditingChange callback', [dts, s => {
    const b = propsBlock(s, 'LauncherProps');
    return b.includes('onEditingChange?: (editing: boolean) => void;') &&
      b.includes('/** Fires when edit mode toggles (edit button or back-out-of-edit). */');
  }]],

  ['app wires edit toggle, tile swap, and back-out into editing signal', [source, s =>
    s.includes('var editing = signal(false);') &&
    s.includes('function swapTiles(a, b)') &&
    s.includes('if (editing()) { setEditing(false); return true; }')]],

  ['custom theme sets primary / surface / accent / text', [source, s =>
    s.includes('lume.theme.set({') && /primary: '#/.test(s) && /surface: '#/.test(s) &&
    /accent: '#/.test(s) && /text: '#/.test(s)]],

  ['entire app file is ASCII-only (r64)', [source,
    s => s.length > 0 && /^[\x00-\x7F]*$/.test(s)]],

  ['entire harness file is ASCII-only (r64)', [harness,
    s => s.length > 0 && /^[\x00-\x7F]*$/.test(s)]],

  ['UI string literals ASCII-only (r64)', [literals(source),
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['Text fontSize limited to bundled 14/20/32 faces', [fontSize,
    arr => arr.length > 0 && arr.every(v => v === 14 || v === 20 || v === 32)]],

  ['playground sources/launcher_grid.js byte-identical to the example', [playgroundSrc, x =>
    x === source]],

  [`launcher_grid is in the ${apps.length}-app playground manifest`, [apps,
    list => list.length === apps.length && list.includes('launcher_grid')]],

  ['firmware/ runtime/ tools/lume/ identical to 3514c76', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],
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

must('drop the shell import',
  x => x.replace("import '../../runtime/shell.js';", "import './shell.js';"),
  'shell.js imported by the documented relative path', source);
must('letter placeholder returns',
  x => x.replace('function drawIconGlyph(', 'c.text(19, 17, "A"); function drawIconGlyph('),
  'round SafeArea and vector Canvas icons (no single-letter c.text glyphs)', source);
must('nonexistent fake app slips into list',
  x => x.replace("id: 'settings'", "id: 'fake_nonexistent_app'"),
  'explicit 12-app literal list rendered in 3x4 grid, all real examples', source);
must('three greens collapse to one shade',
  x => x.replace("ink: '#7CE850'", "ink: '#40D8B0'"),
  '12 distinct vector icons with staggered greens and unified tonal rings', source);
must('unsynced wall clock fallback removed',
  x => x.replace("return '--:--';", "return '10:09';"),
  'SNTP wall clock falls back honestly to --:-- when unsynced', source);
must('indicator re-enabled (two extra edge canvases)',
  x => x.replace('indicator: false,', 'indicator: true,'),
  'EdgeNavigation indicator disabled (canvas lock)', source);
must('icon size drifts off 48',
  x => x.replace('var ICON_PX = 48;', 'var ICON_PX = 64;'),
  'canvas budget constants are explicit and correct (12 x 48x48 = 27648 <= 230400)', source);
must('drop onLaunch host callback',
  x => x.replace("function onLaunch(id) { lastAction.set('launch ' + id); }", ''),
  'onLaunch host callback records id and updates status', source);
must('drop onBack host handler',
  x => x.replace("function onBack() { lastAction.set('BACK'); return true; }", ''),
  'onBack host handler returns true (editing-state fallback)', source);
must('status stops following EDIT/clock',
  x => x.replace("return editing() ? 'EDIT' : clockText();", "return 'STATIC';"),
  'status header shows EDIT when editing and clock otherwise', source);
must('shell drops onEditingChange notification',
  x => x.replace('if (p.onEditingChange) p.onEditingChange(v);', ''),
  'shell.Launcher setEditing notifies onEditingChange at both change points', shell);
must('LauncherProps drops onEditingChange declaration',
  x => x.replace('    onEditingChange?: (editing: boolean) => void;\n', ''),
  'LauncherProps declares the onEditingChange callback', dts);
must('app drops back-out edit reset',
  x => x.replace('if (editing()) { setEditing(false); return true; }', 'if (editing()) return false;'),
  'app wires edit toggle, tile swap, and back-out into editing signal', source);
must('custom theme is dropped',
  x => x.replace('lume.theme.set(', 'lume.noTheme('),
  'custom theme sets primary / surface / accent / text', source);
must('a non-ASCII byte slips into file', x => x + '\n// \u4E2D',
  'entire app file is ASCII-only (r64)', source);
must('a non-ASCII byte slips into harness', x => x + '\n// \u4E2D',
  'entire harness file is ASCII-only (r64)', harness);
must('a CJK UI literal slips in', arr => arr.concat('\u4E2D'),
  'UI string literals ASCII-only (r64)', literals(source));
must('font size escapes bundled faces', arr => arr.concat(40),
  'Text fontSize limited to bundled 14/20/32 faces', fontSize);
must('playground generated source drifts', x => x + '\n// drift',
  'playground sources/launcher_grid.js byte-identical to the example', playgroundSrc);
must('playground manifest drops launcher_grid', list => list.filter(x => x !== 'launcher_grid'),
  `launcher_grid is in the ${apps.length}-app playground manifest`, apps);
must('a firmware/runtime/CLI file changes after 3514c76',
  () => ['firmware/components/lume-engine/lume_math.c'],
  'firmware/ runtime/ tools/lume/ identical to 3514c76', fwChanged);

/* ------------------------ part 2: live prelude ------------------------- */
function bootWith(shellSrc, appSrc, sysTime) {
  const st = runApp(shellSrc + '\n' + stripImport(appSrc === undefined ? source : appSrc), {
    filename: 'examples/launcher_grid/app.js',
  });
  if (sysTime !== undefined) {
    st.lume._systemTime = () => sysTime;
    st.ctx.lgApi.refreshClock();
  }
  st.eval = code => vm.runInContext(code, st.ctx);
  st.api = () => st.ctx.lgApi;
  return st;
}
function boot(src, shellSrc, sysTime) {
  return bootWith(shellSrc === undefined ? shell : shellSrc, src, sysTime);
}
function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }
function pressIds(s) { return s.messages.filter(m => m[0] === 'press').map(m => m[1]); }
function canvasNodes(s) { return s.messages.filter(m => m[0] === 'create' && m[2] === 3); }
function gestureIds(s) { return s.messages.filter(m => m[0] === 'gesture').map(m => m[1]); }
function statusText(s) {
  const id = s.api().statusNode;
  const attrs = s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === 0);
  return attrs.length ? attrs[attrs.length - 1][3] : undefined;
}
function drag(s, id, from, to, t0) {
  t0 = t0 || 0;
  s.gesture(id, 0, from, 200, t0);
  s.gesture(id, 1, to, 200, t0 + 50);
  s.gesture(id, 2, to, 200, t0 + 100);
}

const live = {
  'root node exists with an exact 12-icon canvas budget (27648 px <= 230400 px)': src => attempt(() => {
    const s = boot(src), a = s.api();
    assert.equal(typeof a.root, 'number');
    assert.equal(a.appList.length, APPS_N);
    const canvases = canvasNodes(s);
    assert.equal(canvases.length, APPS_N, 'one 48x48 Canvas per app');
    assert.ok(canvases.every(m => m[4] === ICON_PX && m[5] === ICON_PX), 'every icon is 48x48');
    const area = canvases.reduce((sum, m) => sum + m[4] * m[5], 0);
    assert.equal(area, TOTAL_AREA, '27648 px');
    assert.ok(area <= a.FRAME_AREA, 'within 480x480 frame budget');
  }),

  'SNTP wall clock displays HH:MM when synced and --:-- when unsynced': src => attempt(() => {
    const unsynced = boot(src, undefined, 42000);
    assert.equal(unsynced.api().clockText(), '--:--');
    const synced = boot(src, undefined, new Date(2026, 10, 27, 10, 9, 0).getTime());
    assert.equal(synced.api().clockText(), '10:09');
  }),

  'tile onPress drives onLaunch host callback for all 12 real apps': src => attempt(() => {
    const s = boot(src), a = s.api();
    const ids = pressIds(s);
    assert.equal(ids.length, APPS_N + 1, '12 tiles + 1 edit button');
    assert.equal(a.status(), 'READY');
    s.press(a.tileNodes[0]);
    assert.equal(a.status(), 'launch clock');
    assert.equal(s.messages.filter(m => m[0] === 'launch').length, 0);
    s.press(a.tileNodes[4]);
    assert.equal(a.status(), 'launch fitness');
    s.press(a.tileNodes[11]);
    assert.equal(a.status(), 'launch settings');
  }),

  'edit mode swaps two tiles and EdgeNavigation back exits edit mode': src => attempt(() => {
    const s = boot(src), a = s.api();
    const left = gestureIds(s)[1];
    assert.equal(a.editing(), false);
    s.press(a.editBtn);
    assert.equal(a.editing(), true);
    assert.equal(statusText(s), 'EDIT');
    const firstBefore = a.order()[0].id;
    const secondBefore = a.order()[1].id;
    s.press(a.tileNodes[0]);
    assert.equal(a.editPick(), 0);
    s.press(a.tileNodes[1]);
    assert.equal(a.order()[0].id, secondBefore, 'tile 0 swapped with tile 1');
    assert.equal(a.order()[1].id, firstBefore, 'tile 1 swapped with tile 0');
    assert.equal(a.status(), 'READY', 'editing suppresses launches');
    drag(s, left, 10, 90, 0);
    assert.equal(a.editing(), false, 'EdgeNavigation back exits edit mode');
    drag(s, left, 10, 90, 200);
    assert.equal(a.status(), 'BACK', 'host onBack fallback fires after exit');
  }),

  'shutdown clears all effects and timers': src => attempt(() => {
    const s = boot(src);
    s.press(s.api().tileNodes[0]);
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
mustLive('live: indicator re-enabled -> two extra canvases',
  x => x.replace('indicator: false,', 'indicator: true,'),
  'root node exists with an exact 12-icon canvas budget (27648 px <= 230400 px)');
mustLive('live: onLaunch host callback dropped -> status stays READY',
  x => x.replace("function onLaunch(id) { lastAction.set('launch ' + id); }", 'function onLaunch() {}'),
  'tile onPress drives onLaunch host callback for all 12 real apps');
mustLive('live: tile swap disabled in edit mode',
  x => x.replace('swapTiles(picked, slot);', '/* disabled */'),
  'edit mode swaps two tiles and EdgeNavigation back exits edit mode');

console.log('ALL LAUNCHER GRID HARNESS CASES PASSED');
