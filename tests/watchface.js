/* Fourth face integration over the firmware prelude's real canvas bridge. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/watchface/app.js', 'utf8');
const h = runApp(source);
const evalJs = code => vm.runInContext(code, h.ctx);
const page = () => evalJs('facePage');
assert.equal(evalJs('facePages.length'), 4);
assert.equal(page(), 0);
for (const expected of [1, 2, 3, 0]) {
  evalJs("faceSwipe({dir:'left'})");
  assert.equal(page(), expected);
}
evalJs("faceSwipe({dir:'right'})");
assert.equal(page(), 3);
assert.equal(h.messages.filter(m => m[0] === 'attr' && m[2] === 5).at(-1)[3], 1);
console.log('PASS watchface four-page swipe cycle');

const id = evalJs('goalCanvas');
const arcs = h.messages.filter(m => m[0] === 'draw' && m[1] === id && m[2] === 5);
assert.equal(arcs.length, 6);
assert.deepEqual(arcs.map(m => m[5]), [100, 100, 81, 81, 62, 62]);
assert.ok(arcs.every(m => m[3] === 110 && m[4] === 110 && m[8] === 16 && m[9] === 270));
assert.deepEqual(arcs.filter((_, i) => i % 2 === 0).map(m => m[10]), [630, 630, 630]);
assert.deepEqual(h.messages.filter(m => m[0] === 'invalidate' && m[1] === id).at(-1),
  ['invalidate', id, 2, 2, 216, 216]);
console.log('PASS watchface six native AA arcs; dirty area 46656 px');

assert.deepEqual([evalJs('goalClamp(-1)'), evalJs('goalClamp(101)'), evalJs('goalClamp(NaN)')], [0, 100, 0]);
evalJs('goalProgress.set([99.9, 100, 200])');
const beforeTick = h.messages.filter(m => m[0] === 'draw' && m[1] === id && m[2] === 5).length;
evalJs('goalTick()');
assert.ok(Array.from(evalJs('goalProgress()')).every(n => n >= 0 && n <= 100));
const updated = h.messages.filter(m => m[0] === 'draw' && m[1] === id && m[2] === 5);
assert.equal(updated.length - beforeTick, 6);
assert.ok(updated.every(m => m[10] <= 630));
console.log('PASS watchface progress clamps 0..100');
