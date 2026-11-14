'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('examples/imu_ball/app.js', 'utf8');
const pure = source.split('/* Rendering and device integration. */')[0];
const game = vm.createContext({});
vm.runInContext(pure, game);
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
}
function check(name, fn) { fn(); console.log('PASS imu_ball ' + name); }
check('gravity accelerates and displaces', () => {
  const out = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 100, 0, [], 0.01);
  near(out.ball.vx, 0.985, 'vx'); near(out.ball.x, 100.00985, 'x');
  near(out.ball.y, 100, 'y');
});
check('wall reflects normal velocity with restitution', () => {
  const out = game.physicsStep({ x: 92, y: 100, vx: 100, vy: 0 }, 0, 0,
    [{ x: 100, y: 90, w: 10, h: 20 }], 0.01);
  assert.equal(out.hitWall, true); near(out.ball.x, 91, 'wall x');
  near(out.ball.vx, -49.25, 'rebound vx');
  near(out.impactSpeed, 98.5, 'impact speed');
});
check('hole event', () => {
  const out = game.physicsStep({ x: 120, y: 130, vx: 0, vy: 0 }, 0, 0, [], 0,
    [{ x: 120, y: 130, r: 12 }]);
  assert.equal(out.hole, true); assert.equal(out.goal, false);
});
check('goal requires entire ball inside', () => {
  const goal = { x: 200, y: 200, r: 15 };
  assert.equal(game.physicsStep({ x: 205, y: 200, vx: 0, vy: 0 }, 0, 0, [], 0, [], goal).goal, true);
  assert.equal(game.physicsStep({ x: 207, y: 200, vx: 0, vy: 0 }, 0, 0, [], 0, [], goal).goal, false);
});
check('boundary clamps and reflects', () => {
  const out = game.physicsStep({ x: 45, y: 100, vx: -10, vy: 0 }, 0, 0, [], 0.01);
  near(out.ball.x, 49, 'boundary x'); near(out.ball.vx, 4.925, 'boundary vx');
  assert.equal(out.hitWall, true);
});
check('dt cap limits delayed tick', () => {
  const a = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 10, 0, [], 1);
  const b = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 10, 0, [], 0.1);
  near(a.ball.x, b.ball.x, 'capped x'); near(a.ball.vx, b.ball.vx, 'capped vx');
});
check('resting contact has no sound impact', () => {
  const out = game.physicsStep({ x: 91.1, y: 100, vx: 0, vy: 0 }, 0, 0,
    [{ x: 100, y: 90, w: 10, h: 20 }], 0.01);
  assert.equal(out.hitWall, true);
  near(out.impactSpeed, 0, 'resting impact');
});
