/*
 * r68 host harness for examples/frogger (logic + host simulator).
 *
 *   node tests/frogger.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * like tests/games.js and tests/invaders.js. Integration uses the real prelude
 * via tests/lib/prelude_runner.js for dirty-rect budget, taps and events.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

function logic() {
  const src = fs.readFileSync('examples/frogger/app.js', 'utf8').split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const f = logic();
const ROOT = 1, CELL = 33, GX = 25, GY = 44;
function putItemOnFrog(s, row) {
  const ln = f.froggerLaneAt(s, row);
  const fx = f.froggerBox(s.frog).x;
  ln.items.forEach((it, i) => { it.x = i === 0 ? fx - 5 : 1000; });
  return ln;
}

// 1. four-direction hop and grid boundaries
{
  const s = f.froggerState();
  assert.equal(f.froggerHop(s, 0, -1), 'alive'); // up into bottom safe row
  assert.equal(s.frog.row, 11);
  assert.equal(f.froggerHop(s, 0, 1), 'alive'); // down
  assert.equal(s.frog.row, 12);
  assert.equal(f.froggerHop(s, -1, 0), 'alive'); // left
  assert.equal(s.frog.col, 5);
  assert.equal(f.froggerHop(s, 1, 0), 'alive'); // right
  assert.equal(s.frog.col, 6);
  for (let i = 0; i < 6; i++) f.froggerHop(s, -1, 0);
  assert.equal(s.frog.col, 0);
  assert.equal(f.froggerHop(s, -1, 0), 'blocked');
  assert.equal(s.frog.col, 0);
  assert.equal(f.froggerHop(s, 0, 1), 'blocked');
  assert.ok(s.events.includes('LANE11 hop=up state=alive'));
  console.log('PASS frogger four-direction hop + boundary clamp');
}

// 2. vehicle collision kills the frog
{
  const s = f.froggerState();
  s.frog.row = 6; s.frog.col = 6;
  putItemOnFrog(s, 6);
  assert.equal(f.froggerRoadHit(s), true);
  const st = f.froggerStep(s);
  assert.equal(st, 'dead');
  assert.equal(s.lives, 2);
  assert.ok(s.events.some(e => e.startsWith('DEAD car lives=')));
  console.log('PASS frogger vehicle collision');
}

// 3. log carries the frog horizontally
{
  const s = f.froggerState();
  s.frog.row = 1; s.frog.col = 6;
  const ln = putItemOnFrog(s, 1);
  assert.ok(f.froggerPlatformAt(s));
  const before = s.frog.ox;
  f.froggerStep(s);
  const expected = ln.dir * ln.speed; // level 1 multiplier = 1
  assert.ok(Math.abs(s.frog.ox - (before + expected)) < 1e-9, `ox ${s.frog.ox}`);
  assert.equal(s.state, 'alive');
  console.log('PASS frogger log carry displacement');
}

// 4. water death with no platform
{
  const s = f.froggerState();
  s.frog.row = 2; s.frog.col = 6;
  const ln = f.froggerLaneAt(s, 2);
  ln.items.forEach(it => { it.x = 1000; });
  assert.equal(f.froggerPlatformAt(s), null);
  const st = f.froggerStep(s);
  assert.equal(st, 'dead');
  assert.ok(s.events.some(e => e.startsWith('DEAD water lives=')));
  assert.equal(s.lives, 2);
  console.log('PASS frogger water death');
}

// 5. home fill and level-up when all five are occupied
{
  const s = f.froggerState();
  s.frog.row = 0; s.frog.col = 1;
  assert.equal(f.froggerResolve(s), 'home');
  assert.equal(s.homes[0], true);
  assert.equal(s.score, 50);
  for (let i = 1; i < 5; i++) {
    s.frog.row = 0; s.frog.col = [1, 3, 5, 7, 9][i];
    assert.equal(f.froggerResolve(s), 'home');
  }
  assert.equal(s.level, 2);
  assert.ok(s.homes.every(h => !h)); // reset for next level
  assert.ok(s.score >= 350); // 5*50 + 100 level bonus
  assert.ok(s.events.some(e => e.startsWith('LEVEL2 score=')));
  console.log('PASS frogger home fill + level up');
}

// 6. difficulty speed-up (shorter period, faster lane multiplier)
{
  assert.ok(f.froggerPeriod(2) < f.froggerPeriod(1));
  assert.equal(f.froggerPeriod(1), 90);
  assert.ok(f.froggerPeriod(99) >= 20);
  const s = f.froggerState();
  s.frog.row = 6; s.frog.col = 6;
  const ln = f.froggerLaneAt(s, 6);
  ln.items.forEach(it => { it.x = -500; });
  s.frog.row = 12; s.frog.col = 6;
  const before = f.froggerLaneAt(s, 6).items[0].x;
  s.level = 3;
  f.froggerStep(s);
  const moved = f.froggerLaneAt(s, 6).items[0].x - before;
  assert.ok(Math.abs(moved - 1.6 * 1.7) < 1e-9, `moved ${moved}`);
  console.log('PASS frogger difficulty speed-up');
}

// 7. KV hiscore with <=15-char key and graceful failure
{
  let stored;
  f.lume = { storage: { kv: {
    get: key => { stored = key; return 120; },
    set: (key, value) => { stored = key; return 0; },
  } } };
  assert.equal(f.gameHigh('frogger'), 120);
  assert.equal(stored, 'hisc.frogger');
  assert.ok(stored.length <= 15);
  assert.equal(f.gameSave('frogger', 200, 120), 200);
  assert.equal(f.gameSave('frogger', 10, 200), 200);
  f.lume.storage.kv.get = () => { throw Error('offline'); };
  f.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(f.gameHigh('frogger'), 0);
  assert.equal(f.gameSave('frogger', 300, 200), 300);
  console.log('PASS frogger high-score KV + graceful failure');
}

// 8. sprite spans built once and never rebuilt per frame
{
  assert.equal(f.spanBuilds, 8);
  assert.equal(Object.keys(f.SPANS).length, 8);
  assert.ok(f.SPANS.frog.length > 0 && f.SPANS.log.length > 0 && f.SPANS.truckR.length > 0);
  const s = f.froggerState();
  for (let i = 0; i < 120; i++) f.froggerStep(s);
  assert.equal(f.spanBuilds, 8);
  assert.equal(Object.keys(f.SPANS).length, 8);
  console.log('PASS frogger sprite spans precomputed once, stable across ticks');
}

// 9. game over restart
{
  const s = f.froggerState();
  s.score = 500; s.lives = 0; s.over = true; s.level = 4;
  f.froggerRestart(s);
  assert.equal(s.score, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.level, 1);
  assert.equal(s.frog.row, 12);
  assert.equal(s.over, false);
  assert.ok(s.homes.every(h => !h));
  assert.ok(s.events.includes('LANE12 hop=start state=alive'));
  console.log('PASS frogger game over restart');
}

// 10. integration: nodes, events, dirty-rect budget, tap direction
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/frogger/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  assert.equal(ui.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 1); // one Canvas
  assert.ok(events.includes('FROGGER LANE12 hop=start state=alive'));
  const rects = ui.messages.filter(m => m[0] === 'invalidate');
  assert.ok(rects.length >= 1 && rects.length <= 8, `rect count ${rects.length}`);

  const fx = GX + 6 * CELL + CELL / 2, fy = GY + 12 * CELL + CELL / 2;
  // tap above frog -> up; below -> down; left/right relative to frog centre
  ui.gesture(ROOT, 0, fx, fy - 60, 0); ui.gesture(ROOT, 2, fx, fy - 60, 50);
  assert.equal(ui.ctx.state.frog.row, 11);
  assert.ok(events.some(e => e.includes('hop=up state=alive')));
  ui.gesture(ROOT, 0, fx, fy, 100); ui.gesture(ROOT, 2, fx, fy, 150);
  assert.equal(ui.ctx.state.frog.row, 12); // down from row 11
  ui.gesture(ROOT, 0, fx + 60, fy, 200); ui.gesture(ROOT, 2, fx + 60, fy, 250);
  assert.equal(ui.ctx.state.frog.col, 7); // right
  ui.gesture(ROOT, 0, fx, fy, 300); ui.gesture(ROOT, 2, fx, fy, 350);
  assert.equal(ui.ctx.state.frog.col, 6); // left
  console.log('PASS frogger canvas/events + tap-direction hops');
}
console.log('ALL FROGGER HARNESS CASES PASSED');
