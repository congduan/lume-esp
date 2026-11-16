/* r66 host harness for examples/game_of_life/app.js.
 *
 * Runs the pure B3/S23 core in a bare vm and the full app through the exact
 * C-embedded prelude via tests/lib/prelude_runner.js. Asserts:
 *   - B3/S23 rules: birth on 3, survive on 2-3, die on 0-1 or 4+, stable block
 *   - torus edges: neighbour counts wrap across all four borders
 *   - budget: GRID <= 60, 9px cells, single canvas <= 300x300
 *   - layering: retainSegments uploaded exactly once; each generation emits a
 *     dirty-rect invalidate whose area is < full frame and < 30% of it
 *   - interactions: tap seed (glider / single toggle), swipe up play/pause,
 *     swipe left/right speed cycle, longpress clear, PATTERN cycling
 * Host-only: no hardware claim. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/game_of_life/app.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS life ' + name); }

/* ---- pure core (everything before the UI section) ---------------------- */
const c = vm.createContext({});
vm.runInContext(source.split('/* GAME UI */')[0], c);
const GRID = vm.runInContext('GRID', c);
const CELL = vm.runInContext('CELL', c);
const CW = vm.runInContext('CW', c), CH = vm.runInContext('CH', c);
const blank = () => vm.runInContext('lifeBlank()', c);
function evolve(g) { c.__g = g; return vm.runInContext('lifeNext(__g)', c); }
function neighbors(g, x, y) {
  c.__g = g;
  return vm.runInContext('lifeNeighbors(__g,' + x + ',' + y + ')', c);
}

check('budget: GRID<=60, 9px cells, single canvas <=300x300', () => {
  assert.ok(GRID <= 60, 'GRID <= 60');
  assert.equal(CELL, 9);
  assert.ok(GRID * CELL <= CW, 'GRID*CELL fits canvas width');
  assert.ok(CW * CH <= 300 * 300, 'canvas <= 90,000 px');
});

check('B3 birth: dead cell with exactly 3 live neighbours comes alive', () => {
  const g = blank();
  g[9][9] = 1; g[9][10] = 1; g[9][11] = 1;   /* three neighbours north of (10,10) */
  assert.equal(evolve(g)[10][10], 1);
});

check('B3/S23 survival 2-3, death 0-1 and 4+', () => {
  let g = blank();
  g[10][10] = 1; g[9][9] = 1; g[9][10] = 1;
  assert.equal(evolve(g)[10][10], 1, 'survive on 2');
  g = blank();
  g[10][10] = 1; g[9][9] = 1; g[9][10] = 1; g[9][11] = 1;
  assert.equal(evolve(g)[10][10], 1, 'survive on 3');
  g = blank();
  g[10][10] = 1; g[9][9] = 1; g[9][10] = 1; g[9][11] = 1; g[10][9] = 1;
  assert.equal(evolve(g)[10][10], 0, 'die on 4 (overcrowding)');
  g = blank();
  g[10][10] = 1; g[9][10] = 1;
  assert.equal(evolve(g)[10][10], 0, 'die on 1 (isolation)');
  g = blank();
  g[10][10] = 1;
  assert.equal(evolve(g)[10][10], 0, 'die on 0');
});

check('stable 2x2 block is unchanged', () => {
  const g = blank();
  [[10,10],[10,11],[11,10],[11,11]].forEach(p => { g[p[0]][p[1]] = 1; });
  const n = evolve(g);
  for (let y = 9; y <= 12; y++) for (let x = 9; x <= 12; x++)
    assert.equal(n[y][x], g[y][x], 'cell ' + y + ',' + x);
});

check('torus edges wrap neighbour counts across all four borders', () => {
  const g = blank();
  g[GRID-1][GRID-1] = 1; g[GRID-1][0] = 1; g[0][GRID-1] = 1;
  assert.equal(neighbors(g, 0, 0), 3, 'top-left wraps to bottom/right edges');
  assert.equal(evolve(g)[0][0], 1, 'wrapped dead corner is born');
  const h = blank();
  h[0][0] = 1; h[0][GRID-1] = 1; h[GRID-1][0] = 1;
  assert.equal(neighbors(h, GRID-1, GRID-1), 3, 'bottom-right wraps too');
});

/* ---- full app session -------------------------------------------------- */
const logs = [];
const ui = runApp(source, {
  filename: 'examples/game_of_life/app.js',
  onLog: (...a) => logs.push(a.join(' ')),
});
const sceneId = ui.messages.find(m => m[0] === 'create' && m[2] === 3 && m[4] === 300 && m[5] === 300)?.[1];
assert.ok(sceneId, '300x300 scene canvas created');
const CANVAS_X = vm.runInContext('CANVAS_X', ui.ctx);
const CANVAS_Y = vm.runInContext('CANVAS_Y', ui.ctx);
const SPEEDS = vm.runInContext('SPEEDS', ui.ctx);
const alive = () => vm.runInContext('lifeAlive(grid)', ui.ctx);
const val = expr => vm.runInContext(expr, ui.ctx);
const run = expr => { vm.runInContext(expr, ui.ctx); };
function tapCell(gx, gy, t) {
  const x = CANVAS_X + 1 + gx * CELL + 4, y = CANVAS_Y + 1 + gy * CELL + 4;
  ui.gesture(sceneId, 0, x, y, t);
  ui.gesture(sceneId, 2, x, y, t + 80);
}
function swipe(dx, dy, t) {
  const x = CANVAS_X + 150, y = CANVAS_Y + 150;
  ui.gesture(sceneId, 0, x, y, t);
  ui.gesture(sceneId, 1, x + dx, y + dy, t + 200);
  ui.gesture(sceneId, 2, x + dx, y + dy, t + 240);
}

check('boot: glider seeded, RUN at 350ms, LIFE READY logged', () => {
  assert.equal(alive(), 5);
  assert.equal(val('SPEEDS[speedIndex]'), 350);
  assert.equal(val('running'), true);
  assert.ok(logs.some(s => s.startsWith('LIFE READY grid=')), 'LIFE READY log');
});

check('STATIC layer: retainSegments uploaded exactly once (72 segments)', () => {
  const defs = ui.messages.filter(m => m[0] === 'pathDefine');
  assert.equal(defs.length, 1, 'one retainSegments upload');
  assert.equal(defs[0][2], 1, 'path id 1');
  assert.equal(defs[0][3].length, (GRID + 1) * 2 * 6 + 4 * 6, '72 segments * 6 values');
});

check('LIVE layer: each generation logs LIFE GEN and invalidates <30% of frame', () => {
  const from = ui.messages.length;
  for (let i = 0; i < 4; i++) run('stepGen()');
  const invs = ui.messages.slice(from).filter(m => m[0] === 'invalidate' && m[1] === sceneId);
  assert.ok(invs.length >= 4, 'one invalidate per generation');
  const fullFrame = CW * CH;
  for (const inv of invs) {
    assert.equal(inv.length, 6, 'dirty-rect invalidate (x,y,w,h)');
    const area = inv[4] * inv[5];
    assert.ok(area < fullFrame, 'dirty < full frame (' + area + ' < ' + fullFrame + ')');
    assert.ok(area < fullFrame * 0.30, 'dirty < 30% of frame (' + area + ')');
  }
  const genLogs = logs.filter(s => s.startsWith('LIFE GEN '));
  assert.ok(genLogs.length >= 4);
  assert.match(genLogs[0], /^LIFE GEN \d+ alive=\d+ dirty_px=\d+$/);
  assert.equal(ui.messages.filter(m => m[0] === 'pathDefine').length, 1, 'still one upload after 4 gens');
});

check('glider translates while conserving 5 live cells', () => {
  run('clearGrid(); applyPattern(0);');
  assert.equal(alive(), 5);
  for (let i = 0; i < 4; i++) run('stepGen()');
  assert.equal(alive(), 5, 'glider keeps 5 cells');
});

check('tap: empty cell plants glider; live cell toggles off', () => {
  run('clearGrid()');
  assert.equal(alive(), 0);
  tapCell(5, 5, 1000);
  assert.equal(alive(), 5, 'glider planted');
  const cell = val('(function(){for(var y=0;y<GRID;y++)for(var x=0;x<GRID;x++)if(grid[y][x])return [x,y];return null;})()');
  assert.ok(cell, 'a live cell exists');
  tapCell(cell[0], cell[1], 1200);
  assert.equal(alive(), 4, 'single live cell toggled off');
});

check('swipe up toggles play/pause; left/right cycle 200/350/500ms', () => {
  run('if(!running) toggleRun(); setSpeed(1);');
  assert.equal(val('SPEEDS[speedIndex]'), 350);
  swipe(0, -120, 2000);
  assert.equal(val('running'), false, 'swipe up pauses');
  swipe(0, -120, 3000);
  assert.equal(val('running'), true, 'swipe up resumes');
  swipe(-120, 0, 4000);
  assert.equal(val('SPEEDS[speedIndex]'), 500, 'left -> 500ms');
  swipe(120, 0, 5000);
  assert.equal(val('SPEEDS[speedIndex]'), 350, 'right -> 350ms');
  swipe(120, 0, 6000);
  assert.equal(val('SPEEDS[speedIndex]'), 200, 'right -> 200ms');
});

check('longpress clears the grid', () => {
  run('applyPattern(0)');
  assert.ok(alive() >= 5);
  const x = CANVAS_X + 50, y = CANVAS_Y + 50;
  ui.gesture(sceneId, 0, x, y, 7000);
  ui.gesture(sceneId, 1, x, y, 7500);   /* stationary 500ms -> longpress */
  ui.gesture(sceneId, 2, x, y, 7560);
  assert.equal(alive(), 0, 'grid cleared');
});

check('PATTERN cycles GLIDER -> LWSS -> PULSAR(48) -> RANDOM', () => {
  const names = [];
  for (let i = 0; i < 4; i++) {
    run('applyPattern(patternIndex + 1)');
    names.push(val('PATTERNS[patternIndex].name'));
  }
  assert.deepEqual(names, ['LWSS', 'PULSAR', 'RANDOM', 'GLIDER']);
  run('applyPattern(2)');                /* PULSAR */
  assert.equal(alive(), 48, 'pulsar has 48 live cells');
});

console.log('life harness: ' + cases + ' cases passed');
