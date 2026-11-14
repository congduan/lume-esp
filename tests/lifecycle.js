// Execute the firmware's embedded prelude, with a controllable monotonic clock.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const block = source.match(/const char lume_prelude_js\[\] =\n([\s\S]*?)\n\nconst char lume_demo_js/);
assert(block);
const prelude = [...block[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
let now = 0, nativeCalls = [];
const lume = {
  _nowMs: () => now, log: () => {}, createNode: () => 1,
  setAttr: (...a) => nativeCalls.push(['set', ...a]),
  canvasDraw: () => {}, canvasInvalidate: () => {},
  nativeAnimate: () => 7,
  nativeAnimateCancel: (...a) => nativeCalls.push(['cancel', ...a]),
  setPressEvent: () => {}
};
const ctx = vm.createContext({lume});
vm.runInContext(prelude, ctx);
function run(src) { return vm.runInContext(src, ctx); }
const seq = [];
lume.app.onStart(() => seq.push('start1'));
const off = lume.app.onStart(() => seq.push('start2'));
off();
lume.app.onPause(() => seq.push('pause'));
lume.app.onResume(() => seq.push('resume'));
run('__lume_start(); __lume_pause(); __lume_pause(); __lume_resume(); __lume_resume()');
assert.deepStrictEqual(seq, ['start1', 'pause', 'resume']);
console.log('PASS registration, unregistration and start/pause/resume sequence');
assert.strictEqual(run('__lume_back()'), false);
console.log('PASS onBack unregistered selects default');
const offBack = lume.app.onBack(() => false);
assert.strictEqual(run('__lume_back()'), false);
offBack();
console.log('PASS onBack false selects default');
lume.app.onBack(() => true);
assert.strictEqual(run('__lume_back()'), true);
console.log('PASS onBack true intercepts');
let shots = 0, repeats = 0;
const once = lume.system.setTimeout(() => shots++, 40);
const interval = lume.system.setInterval(() => repeats++, 30);
now = 20; run('__lume_tick()'); assert.deepStrictEqual([shots,repeats],[0,0]);
now = 40; run('__lume_tick()'); assert.deepStrictEqual([shots,repeats],[1,1]);
now = 100; run('__lume_tick()'); assert.deepStrictEqual([shots,repeats],[1,2]);
console.log('PASS timeout once and interval skips missed periods');
lume.system.clearInterval(interval); lume.system.clearTimeout(once);
now = 200; run('__lume_tick()'); assert.deepStrictEqual([shots,repeats],[1,2]);
console.log('PASS timer clear is idempotent');
let pausedTicks = 0;
const pausedTimer = lume.system.setInterval(() => pausedTicks++, 10);
run('__lume_pause()'); now = 220; run('__lume_tick()');
assert.strictEqual(pausedTicks, 0);
run('__lume_resume(); __lume_tick()');
assert.strictEqual(pausedTicks, 1);
lume.system.clearInterval(pausedTimer);
console.log('PASS paused timer waits and resumes without catch-up burst');
const count = run('var count = signal(0); var seen = 0; effect(function(){ count(); seen++; }); seen');
assert.strictEqual(count,1);
run('var canvas = Canvas({width:2,height:2,onDraw:function(c){count(); c.clear();}})');
lume.anim.to(1, {attr:'x',to:1,durationMs:100});
let oldTicks = 0;
lume.system.setInterval(() => oldTicks++, 10);
const before = nativeCalls.length;
run('__lume_shutdown(); count.set(1)');
now = 300; run('__lume_tick()');
assert.strictEqual(run('seen'),1);
assert.strictEqual(oldTicks,0);
assert.strictEqual(nativeCalls.filter(c => c[0] === 'cancel').length,1);
assert.strictEqual(nativeCalls.slice(before).some(c => c[0] === 'set'),false);
assert.strictEqual(run('__lume_back()'),false);
console.log('PASS hot replacement disposes effect, canvas onDraw, animation and timer');
assert.strictEqual(run('Object.keys(__lifecycle.start).length'),0);
assert.strictEqual(run('Object.keys(__timers).length'),0);
console.log('PASS shutdown clears lifecycle and timer registries');

// A replacement creates a fresh prelude/runtime; old closures stay inert.
const replacement = vm.createContext({lume: {...lume, _nowMs: () => now}});
vm.runInContext(prelude, replacement);
vm.runInContext('var fresh = 0; lume.app.onStart(function(){fresh++}); __lume_start()', replacement);
assert.strictEqual(vm.runInContext('fresh', replacement), 1);
now = 500; run('__lume_tick()');
assert.strictEqual(oldTicks, 0);
console.log('PASS replacement starts fresh app without old callbacks');
