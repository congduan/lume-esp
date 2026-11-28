/* Conway's Game of Life — "emergence on a round screen" demo (roadmap P1).
 * Pure app layer: no firmware / protocol / prelude changes.
 *
 * Rendering is split into two layers (roadmap 康威行指定口径):
 *   - STATIC layer (grid lines + HUD frame) is uploaded ONCE with
 *     retainSegments and replayed from C with drawPath on every redraw;
 *   - LIVE cells live on a persistent RGB565 bitmap: each generation only
 *     the bounding box of changed cells is cleared and the surviving / born
 *     live cells are fillRect'd. Dead cells are never painted, and there is
 *     no full clear() after the first frame (pet / tetris dirty-rect pattern).
 *
 * Interactions: tap seeds (dead cell -> glider, live cell -> toggle off),
 * swipe up toggles play/pause, swipe left/right cycles 200/350/500 ms,
 * longpress clears. The PATTERN button cycles glider / LWSS / pulsar /
 * random 25%. Edges wrap (torus) so there are no boundary artefacts.
 *
 * Conservative global script: var / function only, no import/export.
 * HUD text stays ASCII: the board font has no symbol glyphs. */
var CW = 300, CH = 300;          /* single canvas: 90,000 px of the 230,400 budget */
var CANVAS_X = 90, CANVAS_Y = 76;/* canvas origin on the 480x480 screen */
var GRID = 33;                   /* <= 60x60; 33 * 9 = 297 px fits the 300 px canvas */
var CELL = 9;                    /* 8 px cell + 1 px gap */
var OX = 1, OY = 1;              /* grid origin inside the canvas */
var BG = '#0D1420', LINE = '#1F2C3D', LIVE = '#40D8B0';
var SPEEDS = [200, 350, 500];    /* generation interval, ms (below frame pressure) */

/* ---- B3/S23 core (pure; torus neighbour wrap) -------------------------- */
function lifeBlank() {
  var g = [], y, x;
  for (y = 0; y < GRID; y++) { var r = []; for (x = 0; x < GRID; x++) r.push(0); g.push(r); }
  return g;
}
function lifeNeighbors(g, x, y) {
  var n = 0, dy, dx;
  for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    var nx = (x + dx + GRID) % GRID, ny = (y + dy + GRID) % GRID;
    n += g[ny][nx];
  }
  return n;
}
/* B3/S23: a dead cell is born with exactly 3 neighbours; a live cell
 * survives with 2 or 3, otherwise it dies of isolation or overcrowding. */
function lifeNext(g) {
  var out = [], y, x;
  for (y = 0; y < GRID; y++) {
    var row = [];
    for (x = 0; x < GRID; x++) {
      var n = lifeNeighbors(g, x, y);
      row.push(g[y][x] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0));
    }
    out.push(row);
  }
  return out;
}
function lifeAlive(g) {
  var c = 0, y, x;
  for (y = 0; y < GRID; y++) for (x = 0; x < GRID; x++) c += g[y][x];
  return c;
}
/* Tight cell-space box of cells whose value differs between two grids. */
function lifeChangedBox(a, b) {
  var minX = GRID, minY = GRID, maxX = -1, maxY = -1, y, x;
  for (y = 0; y < GRID; y++) for (x = 0; x < GRID; x++) {
    if (a[y][x] !== b[y][x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* ---- preset patterns --------------------------------------------------- */
var PULSAR_ROWS = {
  0: [2,3,4,8,9,10], 2: [0,5,7,12], 3: [0,5,7,12], 4: [0,5,7,12],
  5: [2,3,4,8,9,10], 7: [2,3,4,8,9,10], 8: [0,5,7,12], 9: [0,5,7,12],
  10: [0,5,7,12], 12: [2,3,4,8,9,10]
};
var PULSAR_CELLS = [];
for (var _py in PULSAR_ROWS) {
  var _xs = PULSAR_ROWS[_py];
  for (var _k = 0; _k < _xs.length; _k++) PULSAR_CELLS.push([_xs[_k], +_py]);
}
var PATTERNS = [
  { name: 'GLIDER', cells: [[1,0],[2,1],[0,2],[1,2],[2,2]] },
  { name: 'LWSS',   cells: [[1,0],[2,0],[3,0],[4,0],[0,1],[4,1],[4,2],[0,3],[3,3]] },
  { name: 'PULSAR', cells: PULSAR_CELLS },
  { name: 'RANDOM', random: true }
];
function lifePlacePattern(g, p) {
  var x, y, i;
  if (p.random) {
    for (y = 0; y < GRID; y++) for (x = 0; x < GRID; x++) g[y][x] = Math.random() < 0.25 ? 1 : 0;
    return;
  }
  var maxX = 0, maxY = 0;
  for (i = 0; i < p.cells.length; i++) {
    if (p.cells[i][0] > maxX) maxX = p.cells[i][0];
    if (p.cells[i][1] > maxY) maxY = p.cells[i][1];
  }
  var cx = Math.floor((GRID - 1 - maxX) / 2), cy = Math.floor((GRID - 1 - maxY) / 2);
  for (i = 0; i < p.cells.length; i++) {
    var px = p.cells[i][0] + cx, py = p.cells[i][1] + cy;
    if (px >= 0 && px < GRID && py >= 0 && py < GRID) g[py][px] = 1;
  }
}

/* ---- STATIC layer geometry: grid lines + inset HUD frame --------------- */
function lifeGridSegments() {
  var segs = [], i, p;
  for (i = 0; i <= GRID; i++) {
    p = OX + i * CELL;
    segs.push([p, OY, p, OY + GRID * CELL]);
    segs.push([OX, p, OX + GRID * CELL, p]);
  }
  segs.push([0, 0, CW - 1, 0]);           /* HUD frame (static, canvas-local) */
  segs.push([0, CH - 1, CW - 1, CH - 1]);
  segs.push([0, 0, 0, CH - 1]);
  segs.push([CW - 1, 0, CW - 1, CH - 1]);
  return segs;                            /* 34+34+4 = 72 segments (<= 240) */
}
var GRID_SEGMENTS = lifeGridSegments();

/* GAME UI */
var grid = lifeBlank();
lifePlacePattern(grid, PATTERNS[0]);     /* boot with a glider (self-walking demo) */
var gen = 0, alive = lifeAlive(grid);
var patternIndex = 0, speedIndex = 1, running = true, timer = null;
var painted = false, pendingBox = null, dirtyArea = 0;
var sceneRev = signal(0);
var stGen = signal(gen), stAlive = signal(alive);
var stSpeed = signal(SPEEDS[speedIndex]), stRun = signal('RUN');

function requestRedraw(box) { pendingBox = box || null; sceneRev.set(sceneRev() + 1); }
function fullRedraw() { painted = false; pendingBox = null; sceneRev.set(sceneRev() + 1); }
/* Run a grid mutation, then invalidate only the cells it actually changed.
 * full=true repaints the whole canvas (pattern load / clear). */
function applyMutation(fn, full) {
  var before = full ? null : grid.map(function (r) { return r.slice(); });
  fn();
  alive = lifeAlive(grid); stAlive.set(alive);
  if (full) fullRedraw();
  else { var box = lifeChangedBox(before, grid); if (box) requestRedraw(box); }
}

/* live cells only; dead cells are never painted (the BG clear handles them) */
function lifeDrawLive(ctx, box) {
  ctx.fillColor(LIVE);
  for (var y = 0; y < GRID; y++) for (var x = 0; x < GRID; x++) {
    if (!grid[y][x]) continue;
    if (box && (x < box.x || x >= box.x + box.w || y < box.y || y >= box.y + box.h)) continue;
    ctx.fillRect(OX + x * CELL + 1, OY + y * CELL + 1, CELL - 1, CELL - 1);
  }
}
var scene = Canvas({ width: CW, height: CH, style: { position: 'absolute', x: CANVAS_X, y: CANVAS_Y },
  onDraw: function (ctx) {
    sceneRev();
    /* static geometry uploaded exactly once; replayed from C every redraw */
    if (!ctx.gridPath) ctx.gridPath = ctx.retainSegments(GRID_SEGMENTS, LINE, 1);
    if (!painted || !pendingBox) {
      ctx.fillColor(BG); ctx.fillRect(0, 0, CW, CH);
      ctx.drawPath(ctx.gridPath);
      lifeDrawLive(ctx, null);
      painted = true; pendingBox = null;
      return;                             /* first frame / full frame invalidate */
    }
    var box = pendingBox;
    var area = { x: OX + box.x * CELL, y: OY + box.y * CELL, w: box.w * CELL, h: box.h * CELL };
    /* clear ONLY last generation's changed region — not the whole canvas */
    ctx.fillColor(BG); ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.drawPath(ctx.gridPath);           /* restore grid lines in the cleared strip */
    lifeDrawLive(ctx, box);
    pendingBox = null;
    return [area];
  } });

/* ---- generation engine ------------------------------------------------- */
function stepGen() {
  var next = lifeNext(grid);
  var box = lifeChangedBox(grid, next);
  grid = next; gen++; alive = lifeAlive(grid);
  stGen.set(gen); stAlive.set(alive);
  dirtyArea = box ? box.w * box.h * CELL * CELL : 0;
  lume.log('LIFE GEN ' + gen + ' alive=' + alive + ' dirty_px=' + dirtyArea);
  requestRedraw(box);
}
function start() { if (timer === null) timer = lume.system.setInterval(stepGen, SPEEDS[speedIndex]); }
function stop() { if (timer !== null) { lume.system.clearInterval(timer); timer = null; } }
function setSpeed(i) {
  speedIndex = ((i % SPEEDS.length) + SPEEDS.length) % SPEEDS.length;
  stSpeed.set(SPEEDS[speedIndex]);
  stop(); if (running) start();
  lume.log('LIFE SPEED ' + SPEEDS[speedIndex]);
}
function toggleRun() {
  running = !running; stRun.set(running ? 'RUN' : 'PAUSE');
  if (running) start(); else stop();
  lume.log('LIFE ' + (running ? 'RUN' : 'PAUSE'));
}
function applyPattern(i) {
  patternIndex = ((i % PATTERNS.length) + PATTERNS.length) % PATTERNS.length;
  applyMutation(function () { grid = lifeBlank(); lifePlacePattern(grid, PATTERNS[patternIndex]); gen = 0; }, true);
  stGen.set(0);
  lume.log('LIFE PATTERN ' + PATTERNS[patternIndex].name);
}
function clearGrid() {
  applyMutation(function () { grid = lifeBlank(); gen = 0; }, true);
  stGen.set(0);
  lume.log('LIFE CLEAR');
}
function seedTap(gx, gy) {
  if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return;
  var glider = [[1,0],[2,1],[0,2],[1,2],[2,2]], i;
  applyMutation(function () {
    if (grid[gy][gx]) grid[gy][gx] = 0;                 /* toggle a single live cell off */
    else for (i = 0; i < glider.length; i++) {           /* tap empty area -> plant glider */
      var x = gx + glider[i][0] - 1, y = gy + glider[i][1] - 1;
      if (x >= 0 && x < GRID && y >= 0 && y < GRID) grid[y][x] = 1;
    }
  });
  lume.log('LIFE TAP ' + gx + ',' + gy);
}

/* ---- HUD (native widgets; no canvas text/font glyph issues) ------------ */
var root = View({ style: { width: 480, height: 480, background: BG, scroll: 'none' } }, [
  scene,
  /* r201: HUD/controls inside the 480-round safe square; canvas + grid logic untouched. */
  Text({ text: 'GAME OF LIFE', style: { position: 'absolute', x: 84, y: 78, width: 312, height: 26,
    fontSize: 18, color: '#F2F7FB', borderRadius: 0, textAlign: 'center' } }),
  Text({ text: function () { return 'GEN ' + stGen() + '   ALIVE ' + stAlive() + '   ' + stSpeed() + 'MS  ' + stRun(); },
    style: { position: 'absolute', x: 84, y: 106, width: 312, height: 22,
      fontSize: 13, color: '#40D8B0', borderRadius: 0, textAlign: 'center' } }),
  /* r231: bottom controls lifted into the native 466 round arc (pure coords). */
  Button({ title: 'PATTERN', onPress: function () { applyPattern(patternIndex + 1); },
    style: { position: 'absolute', x: 170, y: 310, width: 140, height: 48,
      background: '#1F2C3D', borderRadius: 8, fontSize: 16, color: '#F2F7FB' } }),
  Text({ text: 'TAP seed  SWIPE UP play/pause  SWIPE L/R speed  HOLD clear',
    style: { position: 'absolute', x: 84, y: 360, width: 312, height: 18,
      fontSize: 12, color: '#9EB3C6', borderRadius: 0, textAlign: 'center' } })
]);

lume.gesture.on(scene, 'tap', function (e) {
  /* gesture events carry absolute screen px (lv_indev_get_point) */
  seedTap(Math.floor((e.x - CANVAS_X - OX) / CELL), Math.floor((e.y - CANVAS_Y - OY) / CELL));
});
lume.gesture.on(scene, 'longpress', function (e) { clearGrid(); });
lume.gesture.on(scene, 'swipe', function (e) {
  if (e.dir === 'up') toggleRun();
  else if (e.dir === 'left') setSpeed(speedIndex + 1);
  else if (e.dir === 'right') setSpeed(speedIndex - 1);
});

lume.app.onStart(function () { if (running) start(); });
lume.app.onPause(stop);
lume.app.onResume(function () { if (running) start(); });
lume.log('LIFE READY grid=' + GRID + ' canvas=' + CW + 'x' + CH + ' speed=' + SPEEDS[speedIndex]);
start();
