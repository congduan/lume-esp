/* r87 fish tank: deterministic movement, feeding, and real prelude drawing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const app = fs.readFileSync('examples/fishtank/app.js', 'utf8');
const logic = vm.createContext({});
vm.runInContext(app.split('/* GAME UI */')[0], logic);

const state = logic.tankState();
assert.equal(state.fish.length, 6);
assert.equal(new Set(state.fish.map(f => f.color)).size, 3);
for (let tick = 0; tick < 1800; tick++) {
  if (tick % 240 === 0) logic.tankFeed(state, 240, 200);
  const before = state.fish.map(f => ({ x: f.x, y: f.y, angle: f.angle }));
  logic.tankStep(state);
  for (let i = 0; i < state.fish.length; i++) {
    const f = state.fish[i], old = before[i];
    assert.ok(Number.isFinite(f.x + f.y + f.angle + f.phase + f.speed), `finite fish ${i} tick ${tick}`);
    assert.ok(f.x >= logic.FISH_LEFT && f.x <= logic.FISH_RIGHT, `x bound ${tick}`);
    assert.ok(f.y >= logic.FISH_TOP && f.y <= logic.FISH_BOTTOM, `y bound ${tick}`);
    assert.ok(Math.hypot(f.x - old.x, f.y - old.y) < 2.5, `continuous fish ${i} tick ${tick}`);
    assert.ok(Math.abs(logic.tankAngle(f.angle - old.angle)) <= 0.07501, `turn limit ${tick}`);
  }
  for (const p of state.food) assert.ok(Number.isFinite(p.x + p.y), `finite food ${tick}`);
}
console.log(`PASS 60 s smoke: six fish bounded, finite, continuous, capped turn; eaten=${state.eaten}`);

const pursuit = logic.tankState();
const fish = pursuit.fish[0];
pursuit.fish = [fish];
fish.x = 190; fish.y = 200; fish.angle = 0; fish.tx = 390; fish.ty = 200;
logic.tankFeed(pursuit, 190, 285);
const firstAngle = fish.angle;
for (let i = 0; i < 35; i++) logic.tankStep(pursuit);
assert.ok(fish.angle > firstAngle + 0.3, 'fish turns toward food below');
assert.ok(fish.y > 205, 'fish swims toward food');
console.log('PASS food pursuit changes heading and position');

const meal = logic.tankState();
meal.fish = [meal.fish[0]];
const eater = meal.fish[0];
meal.food.push({ x: eater.x + 2, y: eater.y, age: 0 });
logic.tankStep(meal);
assert.equal(meal.eaten, 1);
assert.equal(meal.food.length, 0);
assert.ok(eater.burst > 0 && eater.speed > 0.9, 'eating starts burst');
const phaseStep = eater.phase;
logic.tankStep(meal);
assert.ok(eater.phase - phaseStep > 0.12 + 0.9 * 0.19, 'tail rate rises with speed');
console.log('PASS eating removes pellet and accelerates swimming/tail');

const ui = runApp(app);
for (const [size, expected] of [[1.25, 19], [0.92, 13], [0.64, 14]]) {
  let calls = 0;
  const sample = { ...ui.ctx.tank.fish[0], size };
  ui.ctx.tankFish({ fillEllipse: () => calls++, fillCircle: () => calls++ }, sample);
  assert.equal(calls, expected, `size ${size} uses its station tier and detail budget`);
}
function paintCalls(messages) {
  return messages.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
}
const firstCalls = paintCalls(ui.messages);
assert.ok(firstCalls > 0 && firstCalls <= 250, `initial paint calls ${firstCalls}`);
const firstInvalidate = ui.messages.find(m => m[0] === 'invalidate');
assert.ok(firstInvalidate && firstInvalidate.length === 6, 'first paint emits one rect');
assert.deepEqual(firstInvalidate.slice(2), [0, 0, 480, 480], 'first paint covers the whole panel');
let maxDraws = firstCalls, frames = 0, maxDirty = 0, plantFrames = 0;
for (let i = 0; i < 90; i++) {
  const start = ui.messages.length;
  ui.ctx.tankTick();
  const batch = ui.messages.slice(start);
  const count = paintCalls(batch);
  const areas = batch.filter(m => m[0] === 'invalidate');
  if (!areas.length) {
    assert.equal(count, 0, `skipped tick ${i} emits no draw`);
    continue;
  }
  frames++;
  maxDraws = Math.max(maxDraws, count);
  assert.ok(count > 0 && count <= 250, `frame ${i} draw calls ${count}`);
  assert.ok(areas.length <= 8, `frame ${i} emits <=8 dirty rects (${areas.length})`);
  maxDirty = Math.max(maxDirty, areas.length);
  let wide = false;
  for (const r of areas) {
    const [, id, x, y, w, h] = r;
    assert.ok(id > 0 && x >= 0 && y >= 0 && w >= 1 && h >= 1 &&
              x + w <= 480 && y + h <= 480, `frame ${i} dirty rect in canvas`);
    assert.ok(!(x === 0 && y === 0 && w === 480 && h === 480),
              `frame ${i} is not a full-panel refresh`);
    if (w * h > 40000) wide = true;
  }
  if (wide) plantFrames++;
}
assert.equal(frames, 45, '30 Hz simulation repaints at 15 Hz (every other tick)');
assert.equal(plantFrames, 11, 'plants sway every 8 physics ticks, not every frame');
assert.ok(ui.ctx.tankPlantPhase(8) > ui.ctx.tankPlantPhase(0), 'plant phase advances');
const root = ui.ctx.tankRoot;
const tapStart = ui.messages.length;
ui.gesture(root, 0, 240, 190, 1000);
ui.gesture(root, 2, 240, 190, 1060);
assert.equal(ui.ctx.tank.food.length, 5, 'tap creates five pellets');
const tapBatch = ui.messages.slice(tapStart);
assert.ok(tapBatch.some(m => m[0] === 'invalidate'), 'tap forces an immediate repaint');
assert.ok(paintCalls(tapBatch) > 0, 'tap repaint emits draw commands');
console.log(`PASS size tiers 6/5/6 stations; 15 Hz dirty-rect paint (max ${maxDirty} rects), ` +
            `${plantFrames} plant sway frames, tap feeding, no errors, ` +
            `max draw calls/frame=${maxDraws} (limit 250)`);
console.log('ALL FISHTANK HARNESS CASES PASSED');
