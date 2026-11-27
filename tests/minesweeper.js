/*
 * r76 host harness for examples/minesweeper (Minesweeper logic).
 *
 *   node tests/minesweeper.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * like tests/memory.js / tests/sokoban.js. lume.storage.kv is mocked so the
 * best-time path is exercised without NVS.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

let kvStore = {};
const mockLume = {
  storage: { kv: {
    get: (k) => (k in kvStore ? kvStore[k] : null),
    set: (k, v) => { kvStore[k] = v; return 0; },
    remove: (k) => { delete kvStore[k]; return 0; },
  } },
  log: () => {},
};

function logic() {
  const src = fs.readFileSync('examples/minesweeper/app.js', 'utf8').split('/* ------------------------------ GAME UI')[0];
  const ctx = vm.createContext({
    lume: mockLume,
    Math, JSON, console,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object,
  });
  vm.runInContext(src, ctx);
  return ctx;
}
const s = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); } // vm-realm arrays -> host realm

// 1. deal: fresh board has no mines yet (first tap decides the safe zone)
{
  const st = s.mineDeal();
  assert.equal(st.mines, null);
  assert.equal(st.counts, null);
  assert.equal(st.started, false);
  assert.equal(st.over, false);
  assert.equal(st.won, false);
  assert.equal(st.time, 0);
  assert.equal(plain(st.mask).length, 100, 'mask pre-sized, all hidden');
  assert.equal(plain(st.mask).every((m) => m === 0), true);
  console.log('PASS minesweeper deal: fresh board, mines pending first tap');
}

// 2. neighbors: interior 8, edge 5, corner 3; all within bounds
{
  assert.equal(plain(s.mineNeighbors(0)).length, 3);                  // top-left corner
  assert.equal(plain(s.mineNeighbors(9)).length, 3);                  // top-right corner
  assert.equal(plain(s.mineNeighbors(90)).length, 3);                 // bottom-left corner
  assert.equal(plain(s.mineNeighbors(99)).length, 3);                 // bottom-right corner
  assert.equal(plain(s.mineNeighbors(5)).length, 5);                  // top edge
  assert.equal(plain(s.mineNeighbors(45)).length, 8);                 // interior
  for (const n of s.mineNeighbors(0)) assert.ok(n >= 0 && n < 100);
  assert.equal(s.mineNeighbors(45).includes(45), false, 'self excluded');
  console.log('PASS minesweeper neighbors: corner=3 edge=5 interior=8, in bounds');
}

// 3. placement: exactly 15 mines, none in the first-tap safe zone
{
  for (let n = 0; n < 10; n++) {
    const st = s.mineDeal();
    const safeC = n * 7 % 100;
    s.minePlace(st, safeC, Math.random);
    const mines = plain(st.mines);
    assert.equal(mines.length, 100);
    assert.equal(mines.filter(Boolean).length, 15, 'exactly 15 mines');
    assert.equal(mines[safeC], false, 'safe cell has no mine');
    for (const nb of s.mineNeighbors(safeC)) assert.equal(mines[nb], false, 'safe zone neighbour has no mine');
    const counts = plain(st.counts);
    for (let c = 0; c < 100; c++) {
      if (mines[c]) continue;
      let k = 0;
      for (const nb of s.mineNeighbors(c)) if (mines[nb]) k++;
      assert.equal(counts[c], k, 'count[' + c + '] matches adjacency');
    }
  }
  console.log('PASS minesweeper placement: 15 mines, first-tap 3x3 safe, counts correct (10 boards)');
}

// 4. first tap is always a dig (never a boom), determinism under injected rnd
{
  const st = s.mineDeal();
  const r = s.mineTap(st, 55);
  assert.equal(r, 'dig');
  assert.equal(st.started, true);
  assert.equal(st.over, false);
  const st2 = s.mineDeal();
  const seq = [];
  for (let i = 0; i < 85; i++) seq.push((i * 37) % 97 / 97);
  let step = 0;
  const rnd = () => seq[step++ % seq.length];
  s.minePlace(st2, 10, rnd);
  const m1 = plain(st2.mines);
  const st3 = s.mineDeal();
  step = 0;
  s.minePlace(st3, 10, rnd);
  assert.equal(JSON.stringify(m1), JSON.stringify(plain(st3.mines)), 'same rnd seed -> same board');
  console.log('PASS minesweeper first tap: always digs, placement deterministic under seed');
}

// 5. flood fill: a zero cell opens a connected region through the explicit stack
{
  const st = s.mineDeal();
  s.mineTap(st, 0);                                    // place mines avoiding cell 0 area
  // dig a cell with count 0 -> region must include it and all reachable zeros
  let zeroC = -1;
  for (let c = 0; c < 100; c++) if (st.counts[c] === 0 && st.mask[c] === 0) { zeroC = c; break; }
  assert.ok(zeroC >= 0, 'board has a reachable zero cell');
  const before = st.mask.filter((m) => m === 1).length;
  const opened = s.mineFlood(st, zeroC);
  assert.ok(opened >= 1);
  assert.equal(st.mask[zeroC], 1);
  // every opened zero cell has all its non-mine neighbours revealed too
  for (let c = 0; c < 100; c++) {
    if (st.counts[c] !== 0 || st.mask[c] !== 1) continue;
    for (const nb of s.mineNeighbors(c)) {
      if (!st.mines[nb]) assert.equal(st.mask[nb] !== 0, true, 'flood reaches zero-cell neighbours');
    }
  }
  assert.ok(st.mask.filter((m) => m === 1).length >= before);
  console.log('PASS minesweeper flood: zero region opens, boundary counts stay closed');
}

// 6. flood does not open flagged cells (the player keeps their flag)
{
  const st = s.mineDeal();
  s.mineTap(st, 40);
  let zeroC = -1;
  for (let c = 0; c < 100; c++) if (st.counts[c] === 0 && st.mask[c] === 0) { zeroC = c; break; }
  assert.ok(zeroC >= 0);
  // flag a hidden neighbour of the zero cell
  const nb = s.mineNeighbors(zeroC).find((n) => st.mask[n] === 0 && !st.mines[n]);
  if (nb !== undefined) {
    assert.equal(s.mineFlag(st, nb), 'flag');
    const opened = s.mineFlood(st, zeroC);
    assert.equal(st.mask[nb], 2, 'flag survives the flood');
    assert.equal(plain(st.mines).filter(Boolean).length, 15);
  }
  console.log('PASS minesweeper flood vs flags: flagged cells are not auto-opened');
}

// 7. flag / unflag: toggle on hidden cells, revealed and out-of-range rejected
{
  const st = s.mineDeal();
  assert.equal(s.mineFlag(st, 3), 'flag');
  assert.equal(st.mask[3], 2);
  assert.equal(s.mineFlag(st, 3), 'unflag');
  assert.equal(st.mask[3], 0);
  assert.equal(s.mineFlag(st, -1), 'ignore');
  assert.equal(s.mineFlag(st, 100), 'ignore');
  s.mineTap(st, 50);
  let revealedC = -1;
  for (let c = 0; c < 100; c++) if (st.mask[c] === 1) { revealedC = c; break; }
  assert.ok(revealedC >= 0);
  assert.equal(s.mineFlag(st, revealedC), 'ignore', 'revealed cell cannot be flagged');
  console.log('PASS minesweeper flag: toggle + guards on revealed/out-of-range');
}

// 8. flagged cell cannot be dug; unflag re-enables digging
{
  const st = s.mineDeal();
  s.mineTap(st, 60);
  let hiddenC = -1;
  for (let c = 0; c < 100; c++) if (st.mask[c] === 0) { hiddenC = c; break; }
  assert.equal(s.mineFlag(st, hiddenC), 'flag');
  assert.equal(s.mineTap(st, hiddenC), 'ignore', 'dig on flagged cell rejected');
  assert.equal(st.mask[hiddenC], 2);
  assert.equal(s.mineFlag(st, hiddenC), 'unflag');
  assert.equal(s.mineTap(st, hiddenC), st.mines[hiddenC] ? 'boom' : 'dig');
  console.log('PASS minesweeper dig-vs-flag: flag blocks the dig, unflag re-opens');
}

// 9. boom: digging a mine ends the round, reveals all mines, keeps markers
{
  let hit = false;
  for (let n = 0; n < 30 && !hit; n++) {
    const st = s.mineDeal();
    s.mineTap(st, (n * 11) % 100);                    // safe first tap, mines placed
    const mineC = st.mines.findIndex((m) => m && st.mask[st.mines.indexOf(m)] !== 1);
    const mc = st.mines.map((m, i) => (m ? i : -1)).filter((i) => i >= 0 && st.mask[i] === 0)[0];
    if (mc === undefined) continue;
    const flags = [];
    st.mask[mc] = 0;
    const r = s.mineTap(st, mc);
    if (r !== 'boom') continue;
    hit = true;
    assert.equal(st.over, true);
    assert.equal(st.won, false);
    const mines = plain(st.mines);
    for (let c = 0; c < 100; c++) if (mines[c]) assert.equal(st.mask[c] !== 0, true, 'mine revealed');
    assert.equal(st.mask[mc], 2, 'the hit mine keeps its marker');
    assert.ok(st.events.some((e) => e.startsWith('boom c=' + mc)));
    // further taps are ignored ('done')
    let hidden = st.mask.findIndex((m) => m === 0);
    if (hidden >= 0) assert.equal(s.mineTap(st, hidden), 'done');
  }
  assert.equal(hit, true, 'at least one boom exercised in 30 boards');
  console.log('PASS minesweeper boom: round over, mines revealed, hit cell marked');
}

// 10. win: dig every safe cell (flags irrelevant) -> WIN + best time saved
{
  kvStore = {};
  const st = s.mineDeal();
  s.mineTap(st, 45);
  let guard = 0;
  while (!st.over && guard++ < 200) {
    const c = st.mask.findIndex((m) => m === 0 && !st.mines[st.mask.indexOf(m)]);
    const next = st.mask.map((m, i) => (m === 0 && !st.mines[i] ? i : -1)).filter((i) => i >= 0)[0];
    if (next === undefined) break;
    const r = s.mineTap(st, next);
    assert.ok(r === 'dig' || r === 'ignore');
  }
  assert.equal(st.over, true);
  assert.equal(st.won, true);
  assert.equal(plain(st.mines).filter(Boolean).length, 15);
  assert.equal(s.mineRevealed(st), 85, '85 safe cells revealed');
  assert.ok(st.events.some((e) => e.startsWith('WIN time=')));
  assert.equal(typeof kvStore['hisc.mine'], 'number', 'best persisted under 9-char NVS key');
  console.log('PASS minesweeper win: 85 safe cells, WIN event, best time saved');
}

// 11. best-time policy: only a strictly lower time overwrites
{
  // (a) worse round: stored best=50, win at 60 -> no overwrite
  kvStore = { 'hisc.mine': 50 };
  const stW = s.mineDeal();
  stW.time = 60;
  s.minePlace(stW, 45, null);
  // reveal all safe cells directly, then check win
  for (let c = 0; c < 100; c++) if (!stW.mines[c]) stW.mask[c] = 1;
  s.mineCheckWin(stW);
  assert.equal(stW.won, true);
  assert.equal(kvStore['hisc.mine'], 50, 'worse time does NOT overwrite');

  // (b) better round: stored best=90, win at 30 -> overwritten
  kvStore = { 'hisc.mine': 90 };
  const stB = s.mineDeal();
  stB.time = 30;
  s.minePlace(stB, 45, null);
  for (let c = 0; c < 100; c++) if (!stB.mines[c]) stB.mask[c] = 1;
  s.mineCheckWin(stB);
  assert.equal(stB.won, true);
  assert.equal(kvStore['hisc.mine'], 30, 'strictly lower time overwrites');

  // (c) equal time: stored best=30, win at 30 -> 30 < 30 is false, no write
  kvStore = { 'hisc.mine': 30 };
  const stE = s.mineDeal();
  stE.time = 30;
  s.minePlace(stE, 45, null);
  for (let c = 0; c < 100; c++) if (!stE.mines[c]) stE.mask[c] = 1;
  s.mineCheckWin(stE);
  assert.equal(stE.won, true);
  assert.equal(kvStore['hisc.mine'], 30, 'equal time keeps the old best');
  console.log('PASS minesweeper best: worse keeps / lower overwrites / equal keeps');
}

// 12. tick: clock advances only while the round is live
{
  const st = s.mineDeal();
  assert.equal(s.mineTick(st), false, 'not started -> no tick');
  s.mineTap(st, 22);
  assert.equal(s.mineTick(st), true);
  assert.equal(st.time, 1);
  assert.equal(s.mineTick(st), true);
  assert.equal(st.time, 2);
  st.over = true;
  assert.equal(s.mineTick(st), false, 'over -> no tick');
  console.log('PASS minesweeper tick: clock runs only between start and end');
}

// 13. span precompute integrity: 10 sprites, palette refs all valid
{
  assert.equal(Object.keys(s.SPANS).length, s.spanBuilds);
  assert.equal(s.spanBuilds, 10, '8 digits + flag + mine');
  for (const k in s.SPANS) {
    assert.ok(s.SPANS[k].length >= 4, k + ' has spans');
    for (const sp of s.SPANS[k]) {
      assert.equal(sp.length, 4);
      assert.ok(s.PAL[sp[3]] !== undefined, 'palette colour ' + sp[3] + ' exists');
      assert.ok(sp[2] >= 1 && sp[0] >= 0 && sp[1] >= 0);
    }
  }
  console.log('PASS minesweeper spans: 10 sprites decoded, palette refs all valid');
}

// 14. canvas budget: 480x480 single canvas = exactly the 230,400 px cap
{
  const src = fs.readFileSync('examples/minesweeper/app.js', 'utf8');
  const iw = src.match(/var IW=(\d+), IH=(\d+), CELL=(\d+), GAP=(\d+), GX=(\d+), GY=(\d+)/);
  assert.ok(iw, 'layout constants found');
  const IW = +iw[1], IH = +iw[2], CELL = +iw[3], GAP = +iw[4], GX = +iw[5], GY = +iw[6];
  assert.equal(IW * IH, 230400, 'single full-screen canvas is the whole budget');
  assert.equal(CELL * s.COLS + GAP * (s.COLS - 1), 268, 'grid width 10x25 + 9x2');
  const gridR = GX + s.COLS * (CELL + GAP) - GAP;   // 106 + 270 - 2 = 374
  const gridB = GY + s.ROWS * (CELL + GAP) - GAP;   // 132 + 270 - 2 = 400
  assert.ok(GX >= 75 && gridR <= 405, 'grid x inside round safe square [75,405]');
  assert.ok(GY >= 132 && gridB <= 405, 'grid y clears HUD/RESTART and stays inside [75,405]');
  console.log('PASS minesweeper canvas budget: 230400 px single canvas, grid in safe square');
}

// 15. every board is complete: 15 mines + 85 safe cells, and fully diggable
{
  for (let n = 0; n < 20; n++) {
    const st = s.mineDeal();
    s.mineTap(st, (n * 13) % 100);
    const mines = plain(st.mines).filter(Boolean).length;
    assert.equal(mines, 15);
    // greedy dig of all safe cells must reach the win
    let guard = 0;
    while (!st.over && guard++ < 200) {
      const next = st.mask.map((m, i) => (m === 0 && !st.mines[i] ? i : -1)).filter((i) => i >= 0)[0];
      if (next === undefined) break;
      s.mineTap(st, next);
    }
    assert.equal(st.won, true, 'board ' + n + ' fully diggable to a win');
  }
  console.log('PASS minesweeper solvability: 20 random boards all diggable to a win');
}

// 16. r212 frame-budget discipline: 8 retained tile sprites, incremental dirty cells, 0 idle draws
{
  const draws = ms => ms.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : 0), 0);
  const totalOps = ms => ms.reduce((n, m) => n + (m[0] === 'draw' ? 1 : m[0] === 'batch' ? m[2].length / 6 : m[0] === 'spriteDraw' ? 1 : 0), 0);
  const ui = runApp(fs.readFileSync('examples/minesweeper/app.js', 'utf8'));
  const bootOps = totalOps(ui.messages);
  assert.equal(ui.messages.filter(m => m[0] === 'spriteDefine').length, 8, '8 retained tile sprites');
  assert.ok(bootOps <= 240, `boot ops ${bootOps}`);
  // single flag toggle: 1 cell dirty rect, 1 spriteDraw, 0 draw calls
  let from = ui.messages.length;
  ui.gesture(1, 0, 106 + 10, 132 + 10, 0);
  ui.gesture(1, 1, 106 + 10, 132 + 10, 500);
  ui.gesture(1, 2, 106 + 10, 132 + 10, 520);
  const flagSlice = ui.messages.slice(from);
  assert.equal(draws(flagSlice), 0, 'flag toggle emits 0 draw calls');
  assert.equal(totalOps(flagSlice), 1, 'flag toggle emits 1 spriteDraw');
  assert.equal(flagSlice.filter(m => m[0] === 'invalidate').length, 1, 'flag toggle emits 1 dirty rect');
  // dig (flood fill) stays <=240 ops
  from = ui.messages.length;
  ui.gesture(1, 0, 106 + 5 * 27 + 10, 132 + 5 * 27 + 10, 600);
  ui.gesture(1, 2, 106 + 5 * 27 + 10, 132 + 5 * 27 + 10, 640);
  const digSlice = ui.messages.slice(from);
  const digOps = totalOps(digSlice);
  assert.ok(digOps > 0 && digOps <= 240, `dig ops ${digOps}`);
  // 10 idle ticks (1 Hz clock) emit 0 canvas draws
  from = ui.messages.length;
  for (let i = 0; i < 10; i++) ui.ctx.tick();
  assert.equal(totalOps(ui.messages.slice(from)), 0, 'idle clock ticks emit 0 canvas ops');
  assert.equal(ui.messages.filter(m => m[0] === 'spriteDefine').length, 8, 'tiles uploaded once');
  console.log(`EVIDENCE minesweeper boot ${bootOps} ops, flag 1 op, dig ${digOps} ops (<=240), idle 0 ops in 10 ticks, 8 spriteDefine`);
  console.log('PASS minesweeper r212 frame-budget and idle 0-draw discipline');
}

console.log('ALL tests/minesweeper.js PASS');
