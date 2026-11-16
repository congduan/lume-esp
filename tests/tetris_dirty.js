/* r63: guard the tetris dirty-rect invariant against the line-clear residue
 * bug. C-side canvas_publish copies work->front for the rect the app returns;
 * that is only safe when EVERY pixel/cell inside the returned rect was
 * repainted this frame. A line clear used to return a full-canvas bbox while
 * repainting only the dirtyCells, so stale piece traces were memcpy'd on
 * screen. The fix forces a full 200-cell repaint on the clear frame.
 *
 * We run the real app through prelude_runner, drive a deterministic
 * "fill bottom row -> tick() locks & clears" scenario, and assert that the
 * returned rect is a subset of the cells actually drawn that frame.
 * Run with: node tests/tetris_dirty.js                                        */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');

const CELL = 16;
const source = fs.readFileSync('examples/games_tetris/app.js', 'utf8');
const logs = [];
const ui = runApp(source, { onLog: s => logs.push(s) });
const sceneId = ui.messages.find(m => m[0] === 'create' && m[2] === 3 && m[4] === 160)?.[1];
assert.ok(sceneId, 'tetris scene canvas (160px wide) not found');

const cellKey = (x, y) => x + ',' + y;

/* Collect only this canvas's draw + invalidate messages emitted since `from`. */
function frameMessages(from) {
  const draws = [], invals = [];
  for (let i = from; i < ui.messages.length; i++) {
    const m = ui.messages[i];
    if (m[0] === 'draw' && m[1] === sceneId) draws.push(m);
    else if (m[0] === 'invalidate' && m[1] === sceneId) invals.push(m);
  }
  return { draws, invals };
}

/* A cell is considered repainted when onDraw emitted its background fillRect
 * at exactly (cellX*16, cellY*16, 16, 16). The inner fill (+1,+1,14,14) is
 * deliberately ignored. */
function drawnCells(draws) {
  const set = new Set();
  for (const m of draws) {
    const op = m[2], x = m[3], y = m[4], w = m[5], h = m[6];
    if (op === 1 && w === CELL && h === CELL && x % CELL === 0 && y % CELL === 0) {
      set.add(cellKey(x / CELL, y / CELL));
    }
  }
  return set;
}

function rectOf(invals) {
  assert.equal(invals.length, 1, 'expected exactly one scene dirty rect, got ' + invals.length);
  const raw = invals[0], x = raw[2], y = raw[3], rw = raw[4], rh = raw[5];
  assert.equal(x % CELL, 0, 'rect x not cell-aligned: ' + x);
  assert.equal(y % CELL, 0, 'rect y not cell-aligned: ' + y);
  assert.equal(rw % CELL, 0, 'rect w not cell-aligned: ' + rw);
  assert.equal(rh % CELL, 0, 'rect h not cell-aligned: ' + rh);
  const cells = [];
  for (let cy = y / CELL; cy < (y + rh) / CELL; cy++) {
    for (let cx = x / CELL; cx < (x + rw) / CELL; cx++) cells.push({ x: cx, y: cy });
  }
  return { cells, raw: raw.slice(2) };
}

/* The invariant under test: rect (the region C will memcpy) must be a subset
 * of the cells redrawn this frame. On failure, print the violating cells. */
function assertCovered(label, draws, invals) {
  const drawn = drawnCells(draws);
  const { cells, raw } = rectOf(invals);
  const violations = cells.filter(c => !drawn.has(cellKey(c.x, c.y)));
  if (violations.length) {
    console.error(label + ' FAIL: rect ' + JSON.stringify(raw) + ' covers ' + cells.length +
      ' cells but only ' + drawn.size + ' were redrawn. Violating cells (rect but not drawn):');
    console.error(violations.map(c => c.x + ',' + c.y).join(' '));
  }
  assert.deepEqual(violations, [], label + ': returned rect must be a subset of redrawn cells');
  return { drawn: drawn.size, rect: cells.length, raw };
}

/* ---- Scenario 1: line clear (the regression) ----------------------------
 * Board bottom row filled except col 9; a vertical I piece at col 9 locks,
 * completes row 19 and clears it. The white-box result: dirtyRows=[16,19]
 * and a new T piece at row 0 span the whole board, so onDraw returns a
 * large/full rect. Every cell in it must be repainted.                       */
assert.equal(ui.ctx.fullBoard, false, 'first onDraw should have consumed the boot full-redraw');
ui.ctx.state.over = false;
ui.ctx.state.board = ui.ctx.tetrisBoard();
for (let x = 0; x < 9; x++) ui.ctx.state.board[19][x] = 1;
ui.ctx.state.piece = { type: 0, x: 7, y: 16, rot: 1 };
ui.ctx.state.next = 2;
ui.ctx.fullBoard = false;
ui.ctx.dirtyCells = [];

let from = ui.messages.length;
ui.ctx.tick();
assert.equal(ui.ctx.state.lines, 1, 'the lock should clear exactly one line');
assert.ok(logs.some(e => e.indexOf('TETRIS LINE 1') === 0), 'expected TETRIS LINE 1 log');
const clearFrame = frameMessages(from);
const clearResult = assertCovered('line-clear frame', clearFrame.draws, clearFrame.invals);
assert.ok(clearResult.rect >= 150,
  'this scenario should yield a large rect to actually exercise coverage, got ' + clearResult.rect);
console.log('PASS line-clear frame: rect=' + JSON.stringify(clearResult.raw) +
  ' cells=' + clearResult.rect + ' redrawn=' + clearResult.drawn + ' (rect subset of redraw)');

/* ---- Scenario 2: normal drop stays a tight, fully-painted rect ----------
 * Guard that the fix did not turn every frame into a full repaint: a plain
 * one-row move must still return a small rect whose cells were all drawn.    */
ui.ctx.state.over = false;
ui.ctx.state.board = ui.ctx.tetrisBoard();
ui.ctx.state.piece = { type: 1, x: 4, y: 5, rot: 0 };
ui.ctx.fullBoard = false;
ui.ctx.dirtyCells = [];

from = ui.messages.length;
ui.ctx.tick();
assert.equal(ui.ctx.state.piece.y, 6, 'the piece should drop exactly one row');
const dropFrame = frameMessages(from);
const dropResult = assertCovered('normal-drop frame', dropFrame.draws, dropFrame.invals);
assert.ok(dropResult.rect < 40, 'normal drop should be a small rect, got ' + dropResult.rect);
console.log('PASS normal-drop frame: rect=' + JSON.stringify(dropResult.raw) +
  ' cells=' + dropResult.rect + ' redrawn=' + dropResult.drawn + ' (still a tight dirty rect)');

console.log('ALL PASS: tetris dirty-rect coverage invariant holds');
