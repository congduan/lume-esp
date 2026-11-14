// Exercise the exact embedded prelude and the shipped idle-sleep example.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const block = source.match(/const char lume_prelude_js\[\] =\n([\s\S]*?)\n\nconst char lume_demo_js/);
assert(block);
const prelude = [...block[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
let now = 0, sleeps = 0, sleepResult = 0, deinit = 0, nextNode = 1;
const lume = {
  _nowMs: () => now, log: () => {}, createNode: () => nextNode++,
  setAttr: () => {}, setPressEvent: () => {}, nativeAnimate: () => 1,
  nativeAnimateCancel: () => {}, canvasDraw: () => {}, canvasInvalidate: () => {},
  net: {deinit: () => { deinit++; return 0; }},
  power: {_sleepNow: () => { sleeps++; return sleepResult; }, _wake: () => 0}
};
const ctx = vm.createContext({lume});
vm.runInContext(prelude, ctx);
function run(src) { return vm.runInContext(src, ctx); }

let wakes = 0;
const off = lume.power.onWake(() => wakes++);
assert.strictEqual(lume.power.sleepNow(), 0);
assert.strictEqual(wakes, 1);
off(); off();
assert.strictEqual(lume.power.sleepNow(), 0);
assert.strictEqual(wakes, 1);
sleepResult = -1;
assert.strictEqual(lume.power.sleepNow(), -1);
assert.strictEqual(wakes, 1);
console.log('PASS wake registration, unregister, and success-only dispatch');

sleepResult = 0;
run(fs.readFileSync('examples/power_demo/app.js', 'utf8'));
assert.strictEqual(deinit, 1);
now = 14000; run('__lume_tick()'); assert.strictEqual(sleeps, 3);
run('touch()');
now = 28000; run('__lume_tick()'); assert.strictEqual(sleeps, 3);
now = 29000; run('__lume_tick()'); assert.strictEqual(sleeps, 4);
assert.strictEqual(run('lastActivity'), 29000);
now = 30000; run('__lume_tick()'); assert.strictEqual(sleeps, 4);
console.log('PASS touch feeds idle timer and wake resets activity');
run('__lume_shutdown()');
assert.strictEqual(run('__wakeCallbacks.length'), 0);
console.log('PASS shutdown clears wake callbacks');
