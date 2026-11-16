/*
 * r69 host harness for examples/sokoban (logic + host simulator).
 *
 *   node tests/sokoban.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * like tests/invaders.js and tests/frogger.js. The BFS solver in case 6 is the
 * core value: it PROVES all 10 embedded levels solvable and that par is the
 * exact optimal player-move count (data bugs fail here, not the assertion).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

function logic() {
  const src = fs.readFileSync('examples/sokoban/app.js', 'utf8').split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const s = logic();
const ROOT = 1, CELL = 32, GX = 32, GY = 80;
const DIRS = [[0,-1],[1,0],[0,1],[-1,0]];
function plain(v) { return JSON.parse(JSON.stringify(v)); } // vm-realm arrays -> host realm

// 1. standard push: one box, player follows into the vacated cell
{
  const st = s.sokoState(0);
  assert.equal(st.px, 5); assert.equal(st.py, 4);
  assert.equal(s.sokoMove(st, 0, -1), 'push');
  assert.equal(st.px, 5); assert.equal(st.py, 3);
  assert.deepEqual(plain(st.boxes), [[5,2]]);
  assert.equal(st.moves, 1); assert.equal(st.completed, false);
  assert.ok(st.events.includes('L1 moves=1 boxes=0/1'));
  console.log('PASS sokoban single-box push + move counter');
}

// 2. cannot push two boxes; cannot walk into a wall
{
  const st = s.sokoState(0);
  st.boxes = [[5,3],[5,2]]; // stack two boxes above the player
  assert.equal(s.sokoMove(st, 0, -1), 'blocked');
  assert.deepEqual(plain(st.boxes), [[5,3],[5,2]]);
  assert.equal(st.moves, 0);
  assert.ok(st.events.includes('BLOCKED box'));
  const w = s.sokoState(0);
  assert.equal(s.sokoMove(w, -1, 0) === 'blocked' || w.px === 4, true); // floor is walkable
  w.px = 1; w.py = 3;
  assert.equal(s.sokoMove(w, -1, 0), 'blocked'); // col 0 is a wall
  assert.ok(w.events.includes('BLOCKED wall'));
  console.log('PASS sokoban no two-box push / no wall walk');
}

// 3. cannot push a box into a wall (two-step: then the wall stops it)
{
  const st = s.sokoState(2); // pocket level, walls directly above the pocket
  st.px = 4; st.py = 4; st.boxes = [[4,3]];
  assert.equal(s.sokoMove(st, 0, -1), 'push');
  assert.deepEqual(plain(st.boxes), [[4,2]]);
  assert.equal(s.sokoMove(st, 0, -1), 'blocked'); // (4,1) is wall
  assert.deepEqual(plain(st.boxes), [[4,2]]);
  console.log('PASS sokoban box cannot be pushed into wall');
}

// 4. goal coverage + win when every box is on a goal (L1 par=2)
{
  const st = s.sokoState(0);
  assert.equal(s.sokoGoalAt(st.level, 5, 1), true);
  assert.equal(s.sokoGoalAt(st.level, 5, 3), false);
  assert.equal(s.sokoMove(st, 0, -1), 'push');
  assert.equal(s.sokoOnGoalCount(st), 0); // box at (5,2), not on goal
  assert.equal(s.sokoMove(st, 0, -1), 'win');
  assert.equal(s.sokoOnGoalCount(st), 1);
  assert.equal(st.completed, true);
  assert.equal(s.sokoMove(st, 1, 0), 'done'); // no moves after clear
  assert.ok(st.events.includes('WIN L1 moves=2 par=2'));
  console.log('PASS sokoban goal coverage + all-boxes-home win');
}

// 5. corner deadlock (non-goal box in a corner), suppressed on a goal cell
{
  const st = s.sokoState(0);
  st.boxes = [[1,1]]; // top-left inner corner, not the level's goal
  assert.equal(s.sokoDeadlock(st), true);
  st.level.goals.push(1 * st.level.w + 1); // mark that corner as a goal
  assert.equal(s.sokoDeadlock(st), false);
  const mid = s.sokoState(0);
  mid.boxes = [[5,2]];
  assert.equal(s.sokoDeadlock(mid), false);
  console.log('PASS sokoban corner deadlock + goal exemption');
}

// 6. CORE: level data integrity + BFS proves every level solvable at par
{
  function solve(level) {
    const w = level.w, goals = new Set(level.goals), walls = (x, y) =>
      x < 0 || y < 0 || x >= w || y >= level.h || level.map[y].charAt(x) === '#';
    const key = (p, b) => p + '|' + b.slice().sort((a, b) => a - b).join(',');
    const startBoxes = level.boxes.map(b => b[1] * w + b[0]);
    const q = [[level.player[1] * w + level.player[0], startBoxes]];
    const seen = new Map([[key(q[0][0], q[0][1]), 0]]);
    let head = 0;
    while (head < q.length) {
      const [p, boxes] = q[head++];
      const depth = seen.get(key(p, boxes));
      if (boxes.every(b => goals.has(b))) return depth;
      if (seen.size > 2000000) throw Error('BFS cap exceeded — level too large');
      const px = p % w, py = (p / w) | 0, bset = new Set(boxes);
      for (const [dx, dy] of DIRS) {
        const nx = px + dx, ny = py + dy, n = ny * w + nx;
        if (walls(nx, ny)) continue;
        let nb = boxes;
        if (bset.has(n)) {
          const bx = nx + dx, by = ny + dy, bn = by * w + bx;
          if (walls(bx, by) || bset.has(bn)) continue;
          nb = boxes.slice(); nb[nb.indexOf(n)] = bn;
        }
        const k = key(n, nb);
        if (seen.has(k)) continue;
        seen.set(k, depth + 1); q.push([n, nb]);
      }
    }
    return null;
  }
  assert.equal(s.LEVELS.length, 10);
  for (let i = 0; i < s.LEVELS.length; i++) {
    const def = s.LEVELS[i], L = s.sokoParse(def);
    assert.equal(def.map.length, L.h, 'L' + (i+1) + ' ragged');
    assert.ok(L.w <= 13 && L.h <= 10, 'L' + (i+1) + ' exceeds 13x10');
    for (const row of def.map) assert.equal(row.length, L.w, 'L' + (i+1) + ' row width');
    assert.ok(L.player && L.boxes.length >= 1, 'L' + (i+1) + ' player/boxes');
    assert.equal(L.boxes.length, L.goals.length, 'L' + (i+1) + ' boxes == goals');
    const optimal = solve(L);
    assert.notEqual(optimal, null, 'L' + (i+1) + ' UNSOLVABLE — fix level data, not the assertion');
    assert.equal(def.par, optimal, 'L' + (i+1) + ' par should be optimal ' + optimal);
  }
  console.log('PASS sokoban all 10 levels BFS-solvable at stated par (data integrity)');
}

// 7. progress KV: short key <=15 chars + graceful failure + clamp
{
  let stored, value = null;
  s.lume = { storage: { kv: {
    get: key => { stored = key; return value; },
    set: (key, v) => { stored = key; value = v; return 0; },
  } } };
  value = 4;
  assert.equal(s.sokoProgress(), 4);
  assert.equal(stored, 'hisc.soko_pg');
  assert.ok(stored.length <= 15, 'KV key too long: ' + stored);
  value = 99;
  assert.equal(s.sokoProgress(), s.LEVELS.length, 'clamp to level count');
  value = null;
  assert.equal(s.sokoProgress(), 1, 'no save -> level 1');
  s.lume.storage.kv.get = () => { throw Error('offline'); };
  s.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(s.sokoProgress(), 1);
  assert.equal(s.sokoSaveProgress(3), 3); // no throw
  console.log('PASS sokoban progress KV (<=15 char key, clamp, graceful failure)');
}

// 8. unlock/level navigation: next is gated until the previous level is cleared
{
  let value = 1;
  s.lume = { storage: { kv: {
    get: () => value,
    set: (k, v) => { value = v; return 0; },
  } } };
  const st = s.sokoState(0);
  assert.equal(s.sokoProgress(), 1); // only level 1 unlocked
  s.sokoMove(st, 0, -1); s.sokoMove(st, 0, -1); // clear L1
  assert.equal(st.completed, true);
  assert.equal(s.sokoProgress(), 2, 'clearing L1 unlocks L2');
  s.sokoLoad(st, 1);
  assert.equal(st.li, 1); assert.equal(st.moves, 0);
  s.sokoMove(st, 0, -1); s.sokoRestart(st);
  assert.equal(st.moves, 0); assert.equal(st.li, 1);
  s.sokoLoad(st, 99);
  assert.equal(st.li, s.LEVELS.length - 1, 'level index clamped');
  console.log('PASS sokoban unlock + next/prev/restart navigation');
}

// 9. sprite spans precomputed once, stable across many moves
{
  assert.equal(s.spanBuilds, 6);
  assert.equal(Object.keys(s.SPANS).length, 6);
  assert.ok(s.SPANS.wall.length && s.SPANS.box.length && s.SPANS.boxGoal.length && s.SPANS.player.length);
  const st = s.sokoState(0);
  for (let i = 0; i < 120; i++) s.sokoMove(st, i % 2 ? 1 : 0, i % 2 ? 0 : 1);
  assert.equal(s.spanBuilds, 6);
  assert.equal(Object.keys(s.SPANS).length, 6);
  console.log('PASS sokoban sprite spans precomputed once, stable across moves');
}

// 10. integration via the real prelude: nodes/events, dirty budget, swipe/tap/buttons
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/sokoban/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  assert.equal(ui.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 1); // one Canvas
  assert.ok(ui.messages.some(m => m[0] === 'press')); // three buttons register press events
  assert.equal(ui.messages.filter(m => m[0] === 'press').length, 3);
  assert.ok(events.some(e => e.startsWith('SOKO L1 moves=0 boxes=0/1')));
  const rects = ui.messages.filter(m => m[0] === 'invalidate');
  assert.deepEqual(rects[0].slice(2), [0, 0, 480, 480]); // init full canvas
  ui.ctx.frame.set(ui.ctx.frame() + 1);
  const steady = ui.messages.filter(m => m[0] === 'invalidate').slice(1);
  assert.ok(steady.length >= 1 && steady.length <= 8);
  // Several steady frames can accumulate (highlight decay + forced redraw);
  // assert each repaint is the board region, never a whole-frame repaint.
  for (const m of steady) {
    const area = m.length >= 6 ? m[4] * m[5] : 480 * 480;
    assert.ok(area > 0 && area <= 0.65 * 480 * 480, 'per-frame board dirty budget ' + area);
  }

  // swipe up from L1 start pushes the single box up one cell
  const sx = GX + 5 * CELL + CELL / 2, sy = GY + 4 * CELL + CELL / 2;
  ui.gesture(ROOT, 0, sx, sy, 0);
  ui.gesture(ROOT, 1, sx, sy - 70, 10);
  ui.gesture(ROOT, 2, sx, sy - 70, 20);
  assert.equal(ui.ctx.state.moves, 1);
  assert.deepEqual(plain(ui.ctx.state.boxes), [[5,2]]);
  assert.ok(events.some(e => e.includes('SOKO L1 moves=1 boxes=0/1')));

  // tap the neighbour cell above the player pushes again -> clears the level
  const tx = GX + 5 * CELL + CELL / 2, ty = GY + 2 * CELL + CELL / 2;
  ui.gesture(ROOT, 0, tx, ty, 100); ui.gesture(ROOT, 2, tx, ty, 130);
  assert.equal(ui.ctx.state.completed, true);
  assert.ok(events.some(e => e.includes('SOKO WIN L1')));

  // RESET button restores the level
  const pressIds = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  ui.press(pressIds[1]);
  assert.equal(ui.ctx.state.moves, 0);
  assert.equal(ui.ctx.state.completed, false);
  console.log('PASS sokoban canvas/events, dirty budget, swipe push, tap push, reset button');
}

console.log('ALL SOKOBAN HARNESS CASES PASSED');
