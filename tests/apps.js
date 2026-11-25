/*
 * r30 host harness: multi-app JS surface (lume.apps) + launcher integration.
 *
 *   node tests/apps.js
 *
 * Runs the firmware's REAL prelude (extracted from lume_scripts.c) over the
 * host natives in tests/lib/prelude_runner.js. The host never tears a runtime
 * down: launch()/home() only record the request, which is exactly the contract
 * the firmware native has (it POSTS a switch, the engine loop does the cycle).
 *
 * On-device install/launch/uninstall and the LittleFS layout are NOT tested
 * here — see tests/apps_protocol.c for the wire half and docs for what is
 * still deferred to board bring-up.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS apps ' + name); }
function app(code, options) { return runApp(shell + '\n' + code, options); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

check('entries merges meta.json and falls back per field', () => {
  const s = app('globalThis.list = lume.apps.entries();', {
    apps: {
      clock: { label: '时钟', icon: 'C', color: '#123456' },
      calc: {},
    },
  });
  assert.deepEqual(plain(s.ctx.list), [
    { id: 'clock', label: '时钟', icon: 'C', color: '#123456' },
    { id: 'calc', label: 'calc', icon: 'c', color: '#385CA5' },
  ]);
});

check('entries tolerates a store without native metadata', () => {
  const s = runApp('delete lume.apps.list; globalThis.list = lume.apps.entries();');
  assert.deepEqual(plain(s.ctx.list), []);
});

check('entries ignores malformed meta instead of throwing', () => {
  const s = runApp('lume.apps.meta = () => "{not json"; globalThis.list = lume.apps.entries();', {
    apps: { clock: { label: '时钟' } },
  });
  assert.deepEqual(plain(s.ctx.list), [{ id: 'clock', label: 'clock', icon: 'c', color: '#385CA5' }]);
});

check('current() reports the running app id', () => {
  const s = runApp('globalThis.before = lume.apps.current(); globalThis.code = lume.apps.launch("clock"); globalThis.after = lume.apps.current();', {
    apps: { clock: {} },
  });
  assert.equal(s.ctx.before, '');
  assert.equal(s.ctx.code, 0);
  assert.equal(s.ctx.after, 'clock');
});

check('launch/home/remove return the native status codes', () => {
  const s = runApp('globalThis.missing = lume.apps.remove("nope"); globalThis.home = lume.apps.home();', {
    apps: { clock: {} },
  });
  assert.equal(s.ctx.missing, -4);
  assert.equal(s.ctx.home, 0);
  assert.ok(s.messages.some(m => m[0] === 'home'));
});

check('setBoot pins independently of launch and home, then clears', () => {
  const s = runApp('globalThis.pin = lume.apps.setBoot("launcher");' +
    'globalThis.launch = lume.apps.launch("clock");' +
    'globalThis.home = lume.apps.home();' +
    'globalThis.boot = lume.apps.setBoot("");', { apps: { launcher: {}, clock: {} } });
  assert.deepEqual([s.ctx.pin, s.ctx.launch, s.ctx.home, s.ctx.boot], [0, 0, 0, 0]);
  assert.deepEqual(s.messages.filter(m => m[0] === 'setBoot'),
    [['setBoot', 'launcher'], ['setBoot', '']]);
  assert.equal(s.bootPin(), '');
});

check('setBoot reports invalid ids and storage errors', () => {
  const s = runApp('globalThis.bad = lume.apps.setBoot(".boot");' +
    'globalThis.failed = lume.apps.setBoot("launcher");', { setBootStatus: -3 });
  assert.equal(s.ctx.bad, -5);
  assert.equal(s.ctx.failed, -3);
  assert.deepEqual(s.messages.filter(m => m[0] === 'setBoot'), []);
  assert.match(fs.readFileSync('firmware/components/lume-engine/lume_engine.c', 'utf8'),
    /JS_SetPropertyStr\(ctx, apps, "setBoot"/);
});

check('launcher pins itself and its edit exit clears the pin before home', () => {
  const source = fs.readFileSync('examples/launcher/app.js', 'utf8');
  const s = runApp(source, { apps: { launcher: {}, clock: {} } });
  assert.equal(s.bootPin(), 'launcher');
  vm.runInContext('editing.set(true); exitLauncher();', s.ctx);
  assert.equal(s.bootPin(), '');
  assert.deepEqual(s.messages.filter(m => m[0] === 'setBoot'),
    [['setBoot', 'launcher'], ['setBoot', '']]);
  assert.deepEqual(s.messages.filter(m => m[0] === 'home'), [['home']]);
});

check('Launcher defaults to the installed app set', () => {
  const s = app('globalThis.root = lume.ui.shell.Launcher({columns: 2});', {
    apps: { clock: { label: '时钟' }, calc: { label: '计算器' } },
  });
  const texts = s.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => m[3]);
  assert.ok(texts.includes('时钟'), 'installed label rendered');
  assert.ok(texts.includes('计算器'), 'second installed label rendered');
});

check('Launcher tap launches the app by default (no host callback)', () => {
  const s = app('globalThis.root = lume.ui.shell.Launcher({columns: 2});', {
    apps: { clock: { label: '时钟' } },
  });
  const pressIds = s.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.ok(pressIds.length >= 2, 'edit button + one app tile are pressable');
  s.press(pressIds[pressIds.length - 1]);
  const launched = s.messages.filter(m => m[0] === 'launch').at(-1);
  assert.deepEqual(launched, ['launch', 'clock']);
});

check('explicit apps + onLaunch still override the store', () => {
  const s = app('globalThis.hits=[];globalThis.root=lume.ui.shell.Launcher({apps:[{id:"x",label:"X"}],onLaunch:id=>hits.push(id)});', {
    apps: { clock: { label: '时钟' } },
  });
  const pressIds = s.messages.filter(m => m[0] === 'press').map(m => m[1]);
  s.press(pressIds[pressIds.length - 1]);
  assert.deepEqual([...s.ctx.hits], ['x']);
  assert.ok(!s.messages.some(m => m[0] === 'launch'), 'store launch not called');
});

check('Launcher rejects a non-array app list', () => {
  assert.throws(() => app('lume.ui.shell.Launcher({apps: 1});'), /apps must be an array/);
});

/* ---- the firmware's built-in home screen (lume_scripts.c:lume_home_js) ---- */
const homeJs = fs.readFileSync(
  path.join(__dirname, '..', 'firmware/components/lume-engine/prelude/home.js'), 'utf8');

check('embedded home renders a clock and one tile per installed app', () => {
  const s = runApp(homeJs, {
    apps: { clock: { label: '时钟', color: '#1E88E5', icon: 'T' },
            calc: { label: '计算器', color: '#7CB342', icon: 'C' } },
  });
  const texts = s.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => m[3]);
  assert.ok(texts.some(t => /^\d\d:\d\d$/.test(String(t))), 'clock text rendered');
  assert.ok(texts.includes('时钟') && texts.includes('计算器'), 'labels rendered');
  /* Icon tiles are rounded Views (LVGL borderRadius) with a one-letter
   * glyph, not Canvas fills — see the watch-style launcher rebuild. */
  assert.ok(texts.includes('T') && texts.includes('C'), 'icon glyphs rendered');
});

check('embedded home launches a tile and keeps BACK at the root', () => {
  const s = runApp(homeJs, { apps: { clock: { label: '时钟' } } });
  const pressIds = s.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.ok(pressIds.length >= 1, 'tile is pressable');
  s.press(pressIds[pressIds.length - 1]);
  assert.deepEqual(s.messages.filter(m => m[0] === 'launch').at(-1), ['launch', 'clock']);
  assert.equal(vm.runInContext('__lume_back()', s.ctx), true, 'home swallows BACK');
});

check('embedded home shows an empty state with no apps', () => {
  const s = runApp(homeJs, { apps: {} });
  const texts = s.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => m[3]);
  assert.ok(texts.includes('no apps installed') && texts.includes('lume deploy <app>'));
  assert.equal(s.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 0);
});

console.log('PASS ' + cases + ' multi-app cases');
