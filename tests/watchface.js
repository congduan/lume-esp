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
/* r225: createNode flags bit 0 marks a 1x singleBuffer canvas; the prelude
 * charges half the 2x pool cost for those. */
const isSingle = m => ((m[6] || 0) & 1) === 1;
const canvasPixels = canvases.reduce((sum, m) => sum + m[4] * m[5] * (isSingle(m) ? 0.5 : 1), 0);
assert.equal(canvases.length, 4);
assert.equal(canvasPixels, 183472);
assert.ok(canvasPixels <= 230400);
assert.ok(canvases.every(m => m[3] !== evalJs('modular')));
/* Only the two repaint-safe faces are 1x: static digital + full-frame analog.
 * rings (async IMU repaint) and goals (dirty rect) stay double-buffered. */
const singleCanvases = canvases.filter(isSingle);
assert.deepEqual(singleCanvases.map(m => [m[4], m[5]]), [[12, 12], [300, 300]]);
assert.equal(singleCanvases.reduce((s, m) => s + m[4] * m[5], 0), 90144);
assert.equal(canvases.filter(m => !isSingle(m)).reduce((s, m) => s + m[4] * m[5], 0), 138400);
console.log(`PASS watchface canvas budget ${canvasPixels}/230400 px (1x: digital 12x12 + analog 300x300); modular uses zero canvas`);

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

/* ---- r174: retained-path coverage (static + live + mutation) --------------
 * The r49 #6 migration is the shipped state. These assertions guard it: the
 * 60 analog ticks and the three full ring backgrounds must be uploaded once
 * and replayed with drawPath; the three dynamic progress arcs and the three
 * hands stay in immediate mode (they deform/rotate every frame). */
function assertRetainedSource(s) {
  assert.ok(s.includes("c.retainSegments(minor, '#667F8B', 1)"), 'minor ticks retained');
  assert.ok(s.includes("c.retainSegments(major, '#E9F5F8', 2)"), 'major ticks retained');
  assert.ok(s.includes('c.drawPath(c.minorTicks)') && s.includes('c.drawPath(c.majorTicks)'),
    'ticks replay via drawPath');
  for (const r of [136, 111, 86]) {
    assert.ok(s.includes(`c.retainPath(faceArcPoints(0, 360, ${r}), '#1C3449', 8)`),
      `background ring ${r} retained`);
  }
  assert.ok(s.includes('for (var i = 0; i < c.bgRings.length; i++) c.drawPath(c.bgRings[i])'),
    'background rings replay via drawPath');
  // The old per-frame geometry rebuilds must be gone (no assertion loosening).
  assert.ok(!s.includes("i % 5 ? '#667F8B' : '#E9F5F8'"), 'ticks not rebuilt per frame');
  assert.ok(!s.includes("faceArc(c, 0, 360, 136, '#1C3449', 8)"), 'bg rings not rebuilt per frame');
}
assertRetainedSource(source);
console.log('PASS watchface retained-path static contract (ticks + 3 bg rings)');

const defs = h.messages.filter(m => m[0] === 'pathDefine');
const draws = h.messages.filter(m => m[0] === 'pathDraw');
assert.deepEqual(defs.map(d => [d[1], d[2], d[3].length / 6]),
  [[10, 1, 48], [10, 2, 12], [14, 1, 121], [14, 2, 121], [14, 3, 121]]);
assert.equal(draws.length, 5);
assert.deepEqual(draws.map(d => [d[1], d[2], d[3], d[4]]),
  [[10, 1, 0, 0], [10, 2, 0, 0], [14, 1, 0, 0], [14, 2, 0, 0], [14, 3, 0, 0]]);
/* Signal-driven redraws must replay geometry, never re-upload it. faceNow
 * redraws the analog and ring canvases (5 replays); faceBatt redraws only the
 * ring canvas (3 replays). */
const beforeRetainedRedraw = h.messages.length;
vm.runInContext('faceNow.set(new Date(2026,0,1,10,31,0))', h.ctx);
const analogRedraw = h.messages.slice(beforeRetainedRedraw);
assert.equal(analogRedraw.filter(m => m[0] === 'pathDefine').length, 0, 'geometry uploaded only once');
assert.deepEqual(analogRedraw.filter(m => m[0] === 'pathDraw').map(m => [m[1], m[2]]),
  [[10, 1], [10, 2], [14, 1], [14, 2], [14, 3]]);
const beforeBattRedraw = h.messages.length;
vm.runInContext('faceBatt.set(55)', h.ctx);
const ringRedraw = h.messages.slice(beforeBattRedraw);
assert.equal(ringRedraw.filter(m => m[0] === 'pathDefine').length, 0, 'geometry uploaded only once');
assert.deepEqual(ringRedraw.filter(m => m[0] === 'pathDraw').map(m => [m[1], m[2]]),
  [[14, 1], [14, 2], [14, 3]]);
console.log('PASS watchface retained paths defined once, replayed on every redraw');

/* Mutation: removing EACH retained-path block must make its guard fail. */
const noTicks = source.replace(/if \(!c\.minorTicks\) \{[\s\S]*?c\.drawPath\(c\.majorTicks\);/,
  "for (var i = 0; i < 60; i++) c.line(150,150,151,151,'#ffffff',1);");
assert.throws(() => assertRetainedSource(noTicks), /minor ticks retained/);
const noRings = source.replace(/if \(!c\.bgRings\) \{[\s\S]*?for \(var i = 0; i < c\.bgRings\.length; i\+\+\) c\.drawPath\(c\.bgRings\[i\]\);/,
  "for (var i = 0; i < 3; i++) faceArc(c, 0, 360, 136 - i * 25, '#1C3449', 8);");
assert.throws(() => assertRetainedSource(noRings), /background ring 136 retained/);
console.log('PASS watchface retained-path mutation guards (ticks, rings)');
