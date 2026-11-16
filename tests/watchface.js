/* Five faces over the firmware prelude's real UI and canvas bridge. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/watchface/app.js', 'utf8');
const logs = [];
const h = runApp(source, { onLog: (...args) => logs.push(args.join(' ')) });
const evalJs = code => vm.runInContext(code, h.ctx);
const page = () => evalJs('facePage');
assert.equal(evalJs('facePages.length'), 5);
assert.equal(page(), 0);
for (const expected of [1, 2, 3, 4, 0]) {
  evalJs("faceSwipe({dir:'left'})");
  assert.equal(page(), expected);
}
evalJs("faceSwipe({dir:'right'})");
assert.equal(page(), 4);
assert.equal(h.messages.filter(m => m[0] === 'attr' && m[2] === 5).at(-1)[3], 1);
console.log('PASS watchface five-page swipe cycle');

const canvases = h.messages.filter(m => m[0] === 'create' && m[2] === 3);
const canvasPixels = canvases.reduce((sum, m) => sum + m[4] * m[5], 0);
assert.equal(canvases.length, 4);
assert.equal(canvasPixels, 228544);
assert.ok(canvasPixels <= 230400);
assert.ok(h.messages.filter(m => m[0] === 'create' && m[2] === 3)
  .every(m => m[3] !== evalJs('modular')));
console.log(`PASS watchface canvas budget ${canvasPixels}/230400 px; modular uses zero canvas`);

assert.equal(evalJs('faceTheme.spacing'), 12);
assert.equal(evalJs('modularBatteryCard.card') !== evalJs('modularWeatherCard.card'), true);
assert.equal(evalJs('modularCalendarCard.card') !== evalJs('modularStepsCard.card'), true);
const weatherValue = evalJs('modularWeatherCard.value');
const otherValues = ['modularBatteryCard', 'modularCalendarCard', 'modularStepsCard']
  .map(name => evalJs(`${name}.value`));
const beforeWeather = h.messages.length;
h.lume.net.httpRequest = () => ({ status: 200, truncated: false, body: JSON.stringify({current_condition:[{temp_C:'23',weatherCode:'113'}]}) });
evalJs('modularPollWeather()');
assert.equal(evalJs('modularWeather()'), '23°');
const weatherUpdates = h.messages.slice(beforeWeather).filter(m => m[0] === 'attr' && m[2] === 0);
assert.ok(weatherUpdates.some(m => m[1] === weatherValue));
assert.ok(weatherUpdates.every(m => !otherValues.includes(m[1])));
console.log('PASS watchface weather updates only its own complication text');

h.lume.net.httpRequest = () => -3;
evalJs('modularPollWeather()');
assert.equal(evalJs('modularWeather()'), '--°');
assert.ok(logs.some(line => line.includes('weather unavailable; showing --°')));
console.log('PASS watchface weather WiFi-down fallback --°');

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
