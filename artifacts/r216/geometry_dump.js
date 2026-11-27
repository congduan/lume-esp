/* r216 reproducible geometry evidence for dashboard, invaders, frogger, minesweeper.
 * Usage: node artifacts/r216/geometry_dump.js
 *
 * Runs each real app source through tests/lib/prelude_runner.js (firmware
 * prelude in a Node vm), prepending runtime/shell.js when imported.
 * Reports:
 *   1. All UI nodes with resolved screen-space [x0..x1, y0..y1], corner R_max
 *      from display center (240,240), and safe-square [75,405] status.
 *   2. Canvas / playfield geometry (dashboard tabs + SYSTEM/TRACE canvas text &
 *      retained lines; invaders formation/cannon/ground/UFO bounds; frogger
 *      grid/lanes/frog bounds; minesweeper grid/HUD/RESTART bounds).
 * Host-only evidence; no firmware/board needed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = path.resolve(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'runtime/shell.js'), 'utf8');
const ATTR = { TEXT: 0, WIDTH: 2, HEIGHT: 3, VISIBLE: 5, PARENT: 6, RADIUS: 12, X: 18, Y: 19 };
const KIND = ['View', 'Text', 'Btn', 'Canvas', 'Img', 'Arc', 'Slider', 'Switch'];
const SAFE_MIN = 75, SAFE_MAX = 405, CX = 240, CY = 240, R_SCREEN = 240;

function maxCornerR(x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  let m = 0;
  for (const [x, y] of pts) {
    const r = Math.hypot(x - CX, y - CY);
    if (r > m) m = r;
  }
  return +m.toFixed(1);
}

function safeTag(x0, y0, x1, y1) {
  const inSq = x0 >= SAFE_MIN && x1 <= SAFE_MAX && y0 >= SAFE_MIN && y1 <= SAFE_MAX;
  const rMax = maxCornerR(x0, y0, x1, y1);
  const inCircle = rMax <= R_SCREEN;
  return `Rmax=${rMax} ${inSq ? 'IN_SAFE' : 'OUT_SAFE'} ${inCircle ? 'IN_R240' : 'OUT_R240'}`;
}

function loadApp(name) {
  const raw = fs.readFileSync(path.join(root, 'examples', name, 'app.js'), 'utf8');
  const hasShell = /runtime\/shell\.js/.test(raw);
  const src = raw.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
  const s = runApp((hasShell ? shell + '\n' : '') + src, { filename: name + '/app.js' });
  if (typeof s.ctx.__lume_tick === 'function') s.ctx.__lume_tick();
  return { raw, s };
}

function dumpNodes(name, s) {
  const nodes = new Map();
  const pressSet = new Set();
  for (const m of s.messages) {
    if (m[0] === 'create') nodes.set(m[1], { kind: m[2], parent: m[3], w: m[4], h: m[5], vis: 1 });
    else if (m[0] === 'attr') {
      const n = nodes.get(m[1]);
      if (!n) continue;
      if (m[2] === ATTR.X) n.x = m[3];
      else if (m[2] === ATTR.Y) n.y = m[3];
      else if (m[2] === ATTR.WIDTH) n.w = m[3];
      else if (m[2] === ATTR.HEIGHT) n.h = m[3];
      else if (m[2] === ATTR.VISIBLE) n.vis = m[3];
      else if (m[2] === ATTR.TEXT) n.text = m[3];
      else if (m[2] === ATTR.PARENT) n.parent = m[3];
      else if (m[2] === ATTR.RADIUS) n.r = m[3];
    } else if (m[0] === 'press') pressSet.add(m[1]);
  }
  function absPos(n) {
    let x = n.x || 0, y = n.y || 0, cur = n.parent, seen = new Set();
    while (cur && nodes.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = nodes.get(cur);
      x += (p.x || 0);
      y += (p.y || 0);
      cur = p.parent;
    }
    return [x, y];
  }
  console.log('=== ' + name.toUpperCase() + ' ===');
  for (const [id, n] of nodes) {
    const [ax, ay] = absPos(n);
    const w = n.w || 0, h = n.h || 0;
    const press = pressSet.has(id) ? ' [PRESS]' : '';
    const vis = n.vis === 0 ? ' [HIDDEN]' : '';
    const tag = (w > 0 || h > 0) ? ' ' + safeTag(ax, ay, ax + w, ay + h) : '';
    console.log(
      'node ' + id + ' (' + (KIND[n.kind] || n.kind) + ', p=' + n.parent + '):' +
      ' x=' + n.x + ' y=' + n.y + ' w=' + n.w + ' h=' + n.h +
      ' abs=[' + ax + '..' + (ax + w) + ',' + ay + '..' + (ay + h) + ']' +
      ' r=' + n.r + press + vis + tag +
      ' text="' + String(n.text === undefined ? '' : n.text).replace(/\n/g, '\\n') + '"'
    );
  }
  return nodes;
}

// 1. DASHBOARD
{
  const { s } = loadApp('dashboard');
  dumpNodes('dashboard', s);
  const c = s.ctx;
  const cx0 = c.SAFE, cy0 = c.SAFE, cw = c.W, ch = c.H;
  console.log(`  [canvas] local=[0..${cw}, 0..${ch}] screen=[${cx0}..${cx0 + cw}, ${cy0}..${cy0 + ch}]`);

  // Inspect systemStaticLines()
  const sysLines = c.systemStaticLines();
  console.log(`  [SYSTEM systemStaticLines] count=${sysLines.length}`);
  for (let i = 0; i < sysLines.length; i++) {
    const [x1, y1, x2, y2] = sysLines[i];
    const sx1 = cx0 + x1, sy1 = cy0 + y1, sx2 = cx0 + x2, sy2 = cy0 + y2;
    console.log(`    sep[${i}]: local=(${x1},${y1})-(${x2},${y2}) screen=[${sx1}..${sx2}, y=${sy1}] ${safeTag(sx1, sy1, sx2, sy2)}`);
  }

  // Switch to SYSTEM page and capture canvas text calls
  c.readSlow();
  const sysTexts = [];
  const fakeCtx = {
    text(x, y, str, col, sz) { sysTexts.push({ x, y, str, sz }); },
    fillColor() {}, fillRect() {}, line() {}, polyline() {}, clear() {}
  };
  c.drawSystem(fakeCtx, { info: c.slow.info });
  console.log(`  [SYSTEM drawSystem] texts=${sysTexts.length} (info rows=${c.slow.info.length})`);
  for (const t of sysTexts) {
    const sx = cx0 + t.x, sy = cy0 + t.y;
    const estW = String(t.str).length * 8;
    const estH = t.sz || 14;
    console.log(`    text("${t.str}"): local=(${t.x},${t.y}) screen=(${sx},${sy}) estBox=[${sx}..${sx + estW},${sy}..${sy + estH}] ${safeTag(sx, sy, sx + estW, sy + estH)}`);
  }

  // Switch to TRACE page and capture canvas text + static lines
  const traceLines = c.traceStaticLines();
  const trTexts = [];
  c.drawTrace({ text(x, y, str, col, sz) { trTexts.push({ x, y, str, sz }); }, fillColor() {}, fillRect() {} },
    { trace: [[0,0,0]], ax: 0, ay: 0, az: 0 });
  let txMin = 1e9, tyMin = 1e9, txMax = -1e9, tyMax = -1e9;
  for (const [x1, y1, x2, y2] of traceLines) {
    txMin = Math.min(txMin, cx0 + x1, cx0 + x2); txMax = Math.max(txMax, cx0 + x1, cx0 + x2);
    tyMin = Math.min(tyMin, cy0 + y1, cy0 + y2); tyMax = Math.max(tyMax, cy0 + y1, cy0 + y2);
  }
  console.log(`  [TRACE grid] screen=[${txMin}..${txMax}, ${tyMin}..${tyMax}] ${safeTag(txMin, tyMin, txMax, tyMax)}`);
  for (const t of trTexts) {
    const sx = cx0 + t.x, sy = cy0 + t.y;
    const estW = String(t.str).length * 8, estH = t.sz || 14;
    console.log(`    traceText("${t.str}"): local=(${t.x},${t.y}) screen=(${sx},${sy}) estBox=[${sx}..${sx + estW},${sy}..${sy + estH}] ${safeTag(sx, sy, sx + estW, sy + estH)}`);
  }
}

// 2. INVADERS
{
  const { raw, s } = loadApp('invaders');
  dumpNodes('invaders', s);
  const c = s.ctx;
  const st = c.invaderState();
  const fb = c.invaderFormationBox(st, st.fx, st.fy, null);
  const leftM = raw.match(/left<(\d+)/);
  const rightM = raw.match(/right>(IW-\d+|\d+)/);
  const ufoM = raw.match(/ufo=\{x:[^,]+,y:(\d+)\}/);
  const cannonMinM = raw.match(/Math\.max\((\d+),Math\.min\(([^,]+),/);
  const leftEdge = leftM ? +leftM[1] : (c.PLAY_L ?? 16);
  const rightEdge = c.PLAY_R ?? (rightM && rightM[1].startsWith('IW-') ? c.IW - +rightM[1].slice(3) : +rightM?.[1]);
  const ufoY = c.UFO_Y ?? (ufoM ? +ufoM[1] : 44);
  const cannonMin = c.PLAY_L ?? (cannonMinM ? +cannonMinM[1] : 0);
  const cannonMax = (c.PLAY_R ?? c.IW);
  console.log(`  [playfield] COLS=${c.COLS} ROWS=${c.ROWS} CELL_W=${c.CELL_W} CELL_H=${c.CELL_H} FORM=(${c.FORM_X},${c.FORM_Y}) GROUND_Y=${c.GROUND_Y} CANNON_Y=${c.CANNON_Y} CANNON=${c.CANNON_PX}x${c.CANNON_H}`);
  console.log(`  [init formation] [${fb.x}..${fb.x + fb.w}, ${fb.y}..${fb.y + fb.h}] ${safeTag(fb.x, fb.y, fb.x + fb.w, fb.y + fb.h)}`);
  console.log(`  [horizontal travel] formation x=[${leftEdge}..${rightEdge}] cannon x=[${cannonMin}..${cannonMax}]`);
  console.log(`  [vertical bounds] UFO y=${ufoY}..${ufoY + 10}, CANNON y=${c.CANNON_Y}..${c.CANNON_Y + c.CANNON_H}, GROUND y=${c.GROUND_Y}..${c.GROUND_Y + 2}`);
  const overallX0 = Math.min(leftEdge, cannonMin);
  const overallX1 = Math.max(rightEdge, cannonMax);
  const overallY0 = Math.min(ufoY, fb.y);
  const overallY1 = Math.max(c.CANNON_Y + c.CANNON_H, c.GROUND_Y + 2);
  console.log(`  [playfield bbox] [${overallX0}..${overallX1}, ${overallY0}..${overallY1}] ${safeTag(overallX0, overallY0, overallX1, overallY1)}`);
}

// 3. FROGGER
{
  const { s } = loadApp('frogger');
  dumpNodes('frogger', s);
  const c = s.ctx;
  const x0 = c.GX, y0 = c.GY;
  const x1 = c.GX + c.COLS * c.CELL;
  const y1 = c.GY + c.ROWS * c.CELL;
  const st = c.froggerState();
  const fStart = c.froggerBox(st.frog);
  const fTopLeft = c.froggerBox({ row: 0, col: 0, ox: 0 });
  const fBotRight = c.froggerBox({ row: c.ROWS - 1, col: c.COLS - 1, ox: 0 });
  console.log(`  [grid] COLS=${c.COLS} ROWS=${c.ROWS} CELL=${c.CELL} GX=${c.GX} GY=${c.GY} bbox=[${x0}..${x1}, ${y0}..${y1}] ${safeTag(x0, y0, x1, y1)}`);
  console.log(`  [frog start(12,6)] [${fStart.x}..${fStart.x + fStart.w}, ${fStart.y}..${fStart.y + fStart.h}] ${safeTag(fStart.x, fStart.y, fStart.x + fStart.w, fStart.y + fStart.h)}`);
  console.log(`  [frog corners] TL=[${fTopLeft.x}..${fTopLeft.x + fTopLeft.w},${fTopLeft.y}..${fTopLeft.y + fTopLeft.h}] BR=[${fBotRight.x}..${fBotRight.x + fBotRight.w},${fBotRight.y}..${fBotRight.y + fBotRight.h}]`);
}

// 4. MINESWEEPER
{
  const { s } = loadApp('minesweeper');
  dumpNodes('minesweeper', s);
  const c = s.ctx;
  const x0 = c.GX, y0 = c.GY;
  const x1 = c.GX + c.COLS * (c.CELL + c.GAP) - c.GAP;
  const y1 = c.GY + c.ROWS * (c.CELL + c.GAP) - c.GAP;
  console.log(`  [grid] COLS=${c.COLS} ROWS=${c.ROWS} CELL=${c.CELL} GAP=${c.GAP} GX=${c.GX} GY=${c.GY} bbox=[${x0}..${x1}, ${y0}..${y1}] ${safeTag(x0, y0, x1, y1)}`);
}
