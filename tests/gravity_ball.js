'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('examples/gravity_ball/app.js', 'utf8');
const pure = source.split('/* Rendering and device integration. */')[0];
const game = vm.createContext({});
vm.runInContext(pure, game);
const R = game.BALL_R;
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
}
function check(name, fn) { fn(); console.log('PASS gravity_ball ' + name); }
check('gravity accelerates and displaces', () => {
  const out = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 100, 0, 0.01);
  assert.ok(out.ball.vx > 0 && out.ball.x > 100, 'accelerated +x');
  near(out.ball.x, 100 + out.ball.vx * 0.01, 'x = x0 + vx*dt after the step');
  near(out.ball.y, 100, 'y');
});
check('the screen edge clamps and reflects normal velocity', () => {
  const damped = 10 * (1 - game.DRAG * 0.01);
  const out = game.physicsStep({ x: R + 0.05, y: 100, vx: -10, vy: 0 }, 0, 0, 0.01);
  assert.equal(out.hitWall, true);
  near(out.ball.x, R, 'edge x');
  near(out.ball.vx, damped * game.RESTITUTION, 'rebound vx');
  near(out.impactSpeed, damped, 'impact speed');
});
check('tilting the other way reverses the fall direction', () => {
  const still = { x: 200, y: 200, vx: 0, vy: 0 };
  assert.ok(game.physicsStep(still, 40, 0, 0.05).ball.x > 200, 'tilt right -> +x');
  assert.ok(game.physicsStep(still, -40, 0, 0.05).ball.x < 200, 'tilt left -> -x');
  assert.ok(game.physicsStep(still, 0, 40, 0.05).ball.y > 200, 'tilt down -> +y');
  assert.ok(game.physicsStep(still, 0, -40, 0.05).ball.y < 200, 'tilt up -> -y');
});
check('dt cap limits delayed tick', () => {
  const a = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 10, 0, 1);
  const b = game.physicsStep({ x: 100, y: 100, vx: 0, vy: 0 }, 10, 0, 0.1);
  near(a.ball.x, b.ball.x, 'capped x'); near(a.ball.vx, b.ball.vx, 'capped vx');
});
check('a hard tilt keeps the ball inside the screen', () => {
  let b = { x: 240, y: 240, vx: 0, vy: 0 };
  for (let i = 0; i < 400; i++) b = game.physicsStep(b, 600, -420, 0.05).ball;
  assert.ok(b.x >= R && b.x <= game.W - R, 'x inside: ' + b.x);
  assert.ok(b.y >= R && b.y <= game.H - R, 'y inside: ' + b.y);
});

/* ---- device render path: the real prelude, a fake clock, real ticks --------
 * The board cannot flush a full-screen repaint 20 times a second: the UI queue
 * backs up, post() fails inside onDraw and the panel keeps a half-painted frame
 * (streaks, ghost ball). These cases pin the per-frame raster budget and replay
 * the rect commands to prove the canvas holds exactly one ball. */
const { runApp } = require('./lib/prelude_runner');
const FRAME_MS = 50, FRAMES = 40;
const startedAt = Date.now();
const session = runApp(source, {
  filename: 'examples/gravity_ball/app.js',
  // Gentle tilt: the ball accelerates from the centre without reaching an edge
  // inside the run, so every frame stays on the incremental path.
  imu: { read: () => ({ ax: 1.0, ay: 1.0, az: 9.8, gx: 0, gy: 0, gz: 0 }) },
});
let clock = startedAt;
session.lume._nowMs = () => clock;
vm.runInContext(`var __now = ${startedAt}; Date.now = function () { return __now; };`, session.ctx);
vm.runInContext('stop(); start();', session.ctx);
const painted = session.messages.slice();
const frames = [];
for (let i = 0; i < FRAMES; i++) {
  clock += FRAME_MS;
  vm.runInContext(`__now += ${FRAME_MS}`, session.ctx);
  const from = session.messages.length;
  vm.runInContext('__lume_tick()', session.ctx);
  const chunk = session.messages.slice(from);
  frames.push({
    draws: chunk.filter(m => m[0] === 'draw').length,
    inv: chunk.filter(m => m[0] === 'invalidate'),
  });
}
check('the first frame paints the canvas once and invalidates all of it', () => {
  const inv = painted.filter(m => m[0] === 'invalidate');
  assert.ok(painted.filter(m => m[0] === 'draw').length >= 1 + 2 * R, 'first paint draws the ball');
  assert.equal(inv.length, 1, 'one invalidate for the first paint');
  assert.equal(inv[0].length, 2, 'first paint invalidates the whole canvas');
});
check('no frame falls back to the whole canvas', () => {
  assert.equal(frames.filter(f => f.inv.length === 0).length, 0, 'every tick redraws');
  const whole = frames.filter(f => f.inv.some(m => m.length === 2));
  assert.equal(whole.length, 0, 'full-canvas invalidates after the first paint');
  for (const m of frames.flatMap(f => f.inv)) {
    assert.equal(m.length, 6, 'dirty rect expected: ' + JSON.stringify(m));
    const [, , x, y, w, h] = m;
    assert.ok(x >= 0 && y >= 0 && w >= 1 && h >= 1, 'positive rect');
    assert.ok(x + w <= game.W && y + h <= game.H, 'rect inside canvas');
  }
});
check('per-frame raster stays far below a full repaint', () => {
  const worst = Math.max(...frames.map(f => f.draws));
  assert.ok(worst <= 2 * R + 4, 'worst frame draw records=' + worst);
});
check('the dirty rect tracks the ball and stays small', () => {
  const rects = frames.flatMap(f => f.inv);
  assert.equal(rects.length, FRAMES, 'one dirty rect per frame');
  const positions = new Set(rects.map(m => m[2] + ',' + m[3]));
  assert.ok(positions.size >= 8, 'distinct ball rects=' + positions.size);
  const worstArea = Math.max(...rects.map(m => m[4] * m[5]));
  assert.ok(worstArea <= game.W * game.H / 20, 'largest per-frame area=' + worstArea);
});
check('the canvas holds exactly one ball and no ghost', () => {
  const px = new Uint32Array(game.W * game.H);
  for (const m of session.messages) {
    if (m[0] !== 'draw') continue;
    const op = m[2], x = m[3], y = m[4], w = m[5], h = m[6], ink = m[7];
    if (op === 0) { px.fill(ink); continue; }
    if (op !== 1) continue;
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= game.H) continue;
      for (let xx = x; xx < x + w; xx++) if (xx >= 0 && xx < game.W) px[yy * game.W + xx] = ink;
    }
  }
  const bgInk = painted.find(m => m[0] === 'draw' && m[2] === 1)[7];
  const ballInk = session.messages.filter(m => m[0] === 'draw' && m[2] === 1).at(-1)[7];
  assert.notEqual(bgInk, ballInk, 'ball and background inks differ');
  const bx = Math.round(vm.runInContext('ball.x', session.ctx));
  const by = Math.round(vm.runInContext('ball.y', session.ctx));
  let wrong = 0, ballPixels = 0;
  for (let y = 0; y < game.H; y++) {
    for (let x = 0; x < game.W; x++) {
      const dy = y - by;
      const inBall = Math.abs(dy) <= R &&
        Math.abs(x - bx) <= Math.floor(Math.sqrt(R * R - dy * dy));
      if (px[y * game.W + x] !== (inBall ? ballInk : bgInk)) wrong++;
      if (inBall) ballPixels++;
    }
  }
  assert.ok(ballPixels > 400, 'ball pixels=' + ballPixels);
  assert.equal(wrong, 0, 'pixels outside the ball differ (ghost trail)=' + wrong);
});
