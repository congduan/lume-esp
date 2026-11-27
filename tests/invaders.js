/*
 * r68 host harness for examples/invaders (logic + host simulator).
 *
 *   node tests/invaders.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * exactly like tests/games.js. The integration half runs the real prelude via
 * tests/lib/prelude_runner.js to check dirty-rect budget, gestures and events.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

function logic() {
  const src = fs.readFileSync('examples/invaders/app.js', 'utf8').split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
function plain(v) { return JSON.parse(JSON.stringify(v)); }
const NEVER = () => 1; // suppress random enemy fire / UFO in step tests

const a = logic();

// 1. formation direction flips at the right edge
{
  const s = a.invaderState();
  s.fx = 480 - 16 - ((11 - 1) * 28 + 24) - 1; // one pixel from the right wall
  s.fdir = 1;
  const y = s.fy;
  const ev = a.invaderStep(s, NEVER);
  assert.equal(s.fdir, -1);
  assert.equal(ev, 'descend');
  assert.equal(s.fy, y + 44);
  assert.equal(s.descents, 1);
  console.log('PASS invaders formation direction flip at right edge');
}

// 2. touching the left edge descends exactly one row and flips back
{
  const s = a.invaderState();
  s.fx = 17; s.fdir = -1;
  const y = s.fy;
  a.invaderStep(s, NEVER);
  assert.equal(s.fdir, 1);
  assert.equal(s.fx, 16);
  assert.equal(s.fy, y + 44);
  assert.ok(s.events.some(e => e.startsWith('DESCEND row=')));
  console.log('PASS invaders edge contact descends one row');
}

// 3. bullet hit removes a formation member and adds score
{
  const s = a.invaderState();
  const target = s.members[0]; // top row = small = 30 pts
  const o = a.invaderBox(target, s.fx, s.fy);
  s.bullet = { x: o.x + 2, y: o.y + 9 }; // bullet rises 7px this tick, still inside
  const ev = a.invaderStep(s, NEVER);
  assert.equal(ev, 'kill');
  assert.equal(s.members[0].alive, false);
  assert.equal(s.aliveCount, 54);
  assert.equal(s.score, 30);
  assert.ok(s.events.some(e => e === 'WAVE1 alive=54 score=30'));
  console.log('PASS invaders bullet hit removes member + score');
}

// 4. player hit decrements a life; three hits end the game
{
  const s = a.invaderState();
  for (let n = 2; n >= 0; n--) {
    s.enemyBullets.push({ x: s.cannonX + 16, y: 430 });
    a.invaderStep(s, NEVER);
    if (n > 0) assert.equal(s.lives, n);
  }
  assert.equal(s.lives, 0);
  assert.equal(s.over, true);
  assert.ok(s.events.some(e => e === 'HIT lives=0'));
  console.log('PASS invaders player hit loses lives / game over');
}

// 5. UFO bonus
{
  const s = a.invaderState();
  s.ufo = { x: 200, y: 44 };
  s.bullet = { x: 210, y: 52 }; // rises 7px -> y=45, inside the UFO band
  const ev = a.invaderStep(s, NEVER);
  assert.equal(s.score, 100);
  assert.equal(s.ufo, null);
  assert.ok(s.events.some(e => e === 'UFO +100 score=100'));
  console.log('PASS invaders UFO adds bonus score');
}

// 6. wave speed-up (shorter period, faster movement, full formation restored)
{
  assert.ok(a.invaderPeriod(2) < a.invaderPeriod(1));
  assert.equal(a.invaderPeriod(1), 60);
  assert.ok(a.invaderPeriod(99) >= 20);
  const s = a.invaderState();
  const px = s.movePx;
  for (let i = 0; i < s.members.length; i++) s.members[i].alive = false;
  s.aliveCount = 0;
  a.invaderNextWave(s);
  assert.equal(s.wave, 2);
  assert.equal(s.aliveCount, 55);
  assert.ok(s.members.every(m => m.alive));
  assert.equal(s.movePx, px + 1);
  assert.ok(s.events.some(e => e === 'WAVE2 alive=55 score=0'));
  console.log('PASS invaders wave speed-up and formation reset');
}

// 6b. clearing the last member inside step transitions to the next wave
{
  const s = a.invaderState();
  for (let i = 1; i < s.members.length; i++) s.members[i].alive = false;
  s.aliveCount = 1;
  const o = a.invaderBox(s.members[0], s.fx, s.fy);
  s.bullet = { x: o.x + 2, y: o.y + 9 };
  assert.equal(a.invaderStep(s, NEVER), 'wave');
  assert.equal(s.wave, 2);
  assert.equal(s.aliveCount, 55);
  console.log('PASS invaders last kill enters next wave');
}

// 7. KV read/write with ≤15-char key and graceful failure
{
  let stored;
  a.lume = { storage: { kv: {
    get: key => { stored = key; return 55; },
    set: (key, value) => { stored = key; return 0; },
  } } };
  assert.equal(a.gameHigh('invaders'), 55);
  assert.equal(stored, 'hisc.invaders');
  assert.ok(stored.length <= 15);
  assert.equal(a.gameSave('invaders', 100, 55), 100);
  assert.equal(a.gameSave('invaders', 10, 100), 100);
  a.lume.storage.kv.get = () => { throw Error('offline'); };
  a.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(a.gameHigh('invaders'), 0);
  assert.equal(a.gameSave('invaders', 200, 100), 200);
  console.log('PASS invaders high-score KV + graceful failure');
}

// 8. sprite spans are built once and never rebuilt per frame
{
  assert.equal(a.spanBuilds, 8);
  assert.equal(Object.keys(a.SPANS).length, 8);
  assert.ok(a.SPANS.smallA.length > 0 && a.SPANS.medA.length > 0 && a.SPANS.largeA.length > 0);
  const s = a.invaderState();
  for (let i = 0; i < 120; i++) a.invaderStep(s, NEVER);
  assert.equal(a.spanBuilds, 8);
  assert.equal(Object.keys(a.SPANS).length, 8);
  console.log('PASS invaders sprite spans precomputed once, stable across ticks');
}

// 9. game over restart resets state
{
  const s = a.invaderState();
  s.score = 500; s.lives = 0; s.over = true; s.wave = 3;
  a.invaderRestart(s);
  assert.equal(s.score, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.wave, 1);
  assert.equal(s.aliveCount, 55);
  assert.equal(s.over, false);
  assert.ok(s.events.some(e => e === 'WAVE1 alive=55 score=0'));
  console.log('PASS invaders game over restart');
}

// 10. integration via the real prelude: nodes, events, dirty budget, gestures
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/invaders/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  const rootId = 1;
  assert.ok(ui.messages.some(m => m[0] === 'create' && m[2] === 3)); // Canvas
  assert.ok(events.some(e => e === 'INVADER WAVE1 alive=55 score=0'));
  const rects = ui.messages.filter(m => m[0] === 'invalidate');
  assert.equal(rects.length, 1); // init paints the whole canvas once
  assert.deepEqual(rects[0].slice(2), [0, 0, 480, 480]);
  ui.ctx.frame.set(ui.ctx.frame() + 1); // force a steady-state redraw
  const steady = ui.messages.filter(m => m[0] === 'invalidate').slice(1);
  assert.ok(steady.length >= 2 && steady.length <= 8);
  const total = steady.reduce((n, m) => n + (m.length >= 6 ? m[4] * m[5] : 480 * 480), 0);
  assert.ok(total > 0 && total < 0.32 * 480 * 480, `dirty budget ${total}`);

  // pan follows horizontally
  ui.gesture(rootId, 0, 240, 300, 0);
  ui.gesture(rootId, 1, 360, 300, 60);
  ui.gesture(rootId, 2, 360, 300, 100);
  assert.ok(ui.ctx.state.cannonX > 480 / 2 - 32 / 2);

  // tap fires one bullet (second tap while airborne is a no-op)
  ui.ctx.state.bullet = null;
  ui.gesture(rootId, 0, 240, 300, 200); ui.gesture(rootId, 2, 240, 300, 260);
  assert.ok(ui.ctx.state.bullet);
  const first = ui.ctx.state.bullet;
  ui.gesture(rootId, 0, 240, 300, 300); ui.gesture(rootId, 2, 240, 300, 360);
  assert.equal(ui.ctx.state.bullet, first);

  // swipe up pauses, swiping up again resumes
  ui.gesture(rootId, 0, 240, 300, 400);
  ui.gesture(rootId, 1, 240, 230, 450);
  ui.gesture(rootId, 2, 240, 230, 500);
  assert.equal(ui.ctx.state.paused, true);
  ui.gesture(rootId, 0, 240, 300, 600);
  ui.gesture(rootId, 1, 240, 230, 650);
  ui.gesture(rootId, 2, 240, 230, 700);
  assert.equal(ui.ctx.state.paused, false);
  console.log('PASS invaders canvas/dirty budget, pan follow, tap fire, swipe pause');
}

// 11. r212 frame-budget discipline: retained sprites (8 once), <=240 ops/frame, 0 idle draws
{
  const draws = ms => ms.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
  const totalOps = ms => ms.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : m[0] === 'spriteDraw' ? 1 : 0), 0);
  const ui = runApp(fs.readFileSync('examples/invaders/app.js', 'utf8'));
  const bootDefs = ui.messages.filter(m => m[0] === 'spriteDefine').length;
  assert.equal(bootDefs, 8, `expected 8 retained sprites, got ${bootDefs}`);
  assert.ok(totalOps(ui.messages) <= 240, `boot ops ${totalOps(ui.messages)}`);
  let maxD = 0, maxOps = 0;
  for (let i = 0; i < 30; i++) {
    const from = ui.messages.length;
    ui.ctx.tick();
    const slice = ui.messages.slice(from);
    maxD = Math.max(maxD, draws(slice));
    maxOps = Math.max(maxOps, totalOps(slice));
    assert.ok(totalOps(slice) <= 240, `tick ${i} ops ${totalOps(slice)}`);
  }
  assert.equal(ui.messages.filter(m => m[0] === 'spriteDefine').length, 8, 'sprites uploaded once');
  ui.ctx.state.paused = true;
  let from = ui.messages.length;
  for (let i = 0; i < 10; i++) ui.ctx.tick();
  assert.equal(totalOps(ui.messages.slice(from)), 0, 'paused ticks emit 0 canvas ops');
  ui.ctx.state.paused = false; ui.ctx.state.over = true;
  from = ui.messages.length;
  for (let i = 0; i < 10; i++) ui.ctx.tick();
  assert.equal(totalOps(ui.messages.slice(from)), 0, 'game-over ticks emit 0 canvas ops');
  console.log(`EVIDENCE invaders active max ${maxD} draws / ${maxOps} total ops (<=240), paused/over 0 ops in 10 ticks, 8 spriteDefine`);
  console.log('PASS invaders r212 frame-budget and idle 0-draw discipline');
}

console.log('ALL INVADERS HARNESS CASES PASSED');
