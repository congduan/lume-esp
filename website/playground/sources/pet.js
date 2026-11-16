/* 桌面宠物 — pixel electronic pet (feeding / petting / sleep-wake).
 * Pure app layer: no firmware, protocol or prelude changes. The pixel sprite
 * is a 2-D palette-index grid; horizontal runs are precomputed into fillRect
 * spans (gravity_ball pattern), and each frame clears + repaints only the
 * CELL-sized box where the previous and next sprite differ.
 *
 * Interactions: tap = pet (happy+), longpress = feed (hunger-), a wrist flip
 * (IMU magnitude spike) = startle/wake. Tap the SKIN button to swap the whole
 * pixel creature + palette; the choice lives in lume.storage.kv so a hot
 * reload (`lume dev`) changes skins without a rebuild — the "skin store"
 * demo for app authors.
 *
 * Conservative global script: var / function only, no import/export.
 * HUD text stays ASCII + Chinese: the board font has no symbol glyphs. */
var W = 480, H = 480;
var GRID = 16, CELL = 12, SPRITE_PX = GRID * CELL;
var OX = 144, OY = 120;                 /* sprite origin on the 480x480 canvas */
var BG = '#101826';

/* palette indices (0 = transparent) */
var C_EMPTY = 0, C_LINE = 1, C_BODY = 2, C_BELLY = 3, C_EYE = 4, C_CHEEK = 5;

/* ---- skins: two creatures with different geometry AND palettes ----------
 * Switching a skin is pure data + one KV write, pushed by hot reload. This is
 * the whole point of the demo: no C rebuild to "buy" a new pet. */
function buildCat() {
  var g = blankGrid(), i;
  var rows = [[3,6,9],[4,4,11],[5,3,12],[6,2,13],[7,2,13],[8,2,13],
              [9,2,13],[10,2,13],[11,3,12],[12,4,11],[13,5,10]];
  for (i = 0; i < rows.length; i++) {
    var y = rows[i][0], x0 = rows[i][1], x1 = rows[i][2], x;
    g[y][x0] = C_LINE; g[y][x1] = C_LINE;
    for (x = x0 + 1; x < x1; x++) g[y][x] = C_BODY;
  }
  /* pointy ears */
  g[1][4] = C_LINE; g[2][4] = C_LINE; g[2][5] = C_BODY; g[3][5] = C_LINE;
  g[1][11] = C_LINE; g[2][11] = C_LINE; g[2][10] = C_BODY; g[3][10] = C_LINE;
  face(g);
  return g;
}
function buildSlime() {
  var g = blankGrid(), i;
  var rows = [[2,6,9],[3,4,11],[4,3,12],[5,2,13],[6,2,13],[7,2,13],
              [8,2,13],[9,2,13],[10,3,12],[11,4,11],[12,5,10],[13,7,8]];
  for (i = 0; i < rows.length; i++) {
    var y = rows[i][0], x0 = rows[i][1], x1 = rows[i][2], x;
    g[y][x0] = C_LINE; g[y][x1] = C_LINE;
    for (x = x0 + 1; x < x1; x++) g[y][x] = C_BODY;
  }
  /* round tuft instead of ears */
  g[1][7] = C_LINE; g[1][8] = C_LINE; g[2][7] = C_BODY; g[2][8] = C_BODY;
  face(g);
  return g;
}
function face(g) {
  g[7][5] = C_EYE; g[7][6] = C_EYE; g[7][9] = C_EYE; g[7][10] = C_EYE;
  g[9][7] = C_CHEEK; g[9][8] = C_CHEEK;
  g[10][6] = C_BELLY; g[10][7] = C_BELLY; g[10][8] = C_BELLY; g[10][9] = C_BELLY;
}
var SKINS = [
  { name: 'CAT', build: buildCat,
    colors: ['#00000000', '#20161F', '#F4C86A', '#FFF0C0', '#20161F', '#E8846B'] },
  { name: 'SLIME', build: buildSlime,
    colors: ['#00000000', '#0C2B33', '#57D6B4', '#CFF4E8', '#0C2B33', '#2E9C8A'] }
];

/* ---- pure sprite helpers ------------------------------------------------ */
function blankGrid() {
  var g = [], y, x;
  for (y = 0; y < GRID; y++) { var r = []; for (x = 0; x < GRID; x++) r.push(C_EMPTY); g.push(r); }
  return g;
}
function cloneGrid(g) { var o = [], y; for (y = 0; y < GRID; y++) o.push(g[y].slice()); return o; }
/* Merge each row's same-colour runs into [y, x, width, colour] fillRects. */
function buildSpans(grid) {
  var spans = [], y, x;
  for (y = 0; y < GRID; y++) {
    x = 0;
    while (x < GRID) {
      var c = grid[y][x];
      if (c === C_EMPTY) { x++; continue; }
      var x0 = x;
      while (x < GRID && grid[y][x] === c) x++;
      spans.push([y, x0, x - x0, c]);
    }
  }
  return spans;
}
var FULL_BOX = { x: 0, y: 0, w: GRID, h: GRID };
/* Tight dirty box (cell coords) between two sprites; full box if they bob. */
function changedBox(a, b) {
  if (!a || !b || a.dy !== b.dy) return FULL_BOX;
  var g1 = a.grid, g2 = b.grid;
  var minX = GRID, minY = GRID, maxX = -1, maxY = -1, x, y;
  for (y = 0; y < GRID; y++) for (x = 0; x < GRID; x++) {
    if (g1[y][x] !== g2[y][x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* ---- state-dependent sprite variants ------------------------------------ */
function makeVariant(base, state, frame) {
  var g = cloneGrid(base), dy = 0, f = frame % frameCount(state);
  if (state === 'SLEEP') {
    g[7][4] = C_EMPTY; g[7][11] = C_EMPTY;
    g[7][5] = C_LINE; g[7][6] = C_LINE; g[7][9] = C_LINE; g[7][10] = C_LINE;
    /* Zzz drawn as pixels, never a font glyph */
    g[1][13] = C_BELLY; g[2][14] = C_BELLY; g[3][13] = C_BELLY; g[3][14] = C_BELLY;
  } else if (state === 'HAPPY') {
    dy = f % 2 ? -1 : 0;
    g[7][5] = C_LINE; g[7][6] = C_LINE; g[7][9] = C_LINE; g[7][10] = C_LINE;
    g[9][7] = C_CHEEK; g[9][8] = C_CHEEK; g[9][6] = C_CHEEK; g[9][9] = C_CHEEK;
    g[10][7] = C_CHEEK; g[10][8] = C_CHEEK;
  } else if (state === 'HUNGRY') {
    g[7][5] = C_EYE; g[7][6] = C_EYE; g[7][9] = C_EYE; g[7][10] = C_EYE;
    g[8][5] = C_LINE; g[8][10] = C_LINE;
    g[9][7] = C_LINE; g[9][8] = C_LINE; g[10][6] = C_EMPTY; g[10][9] = C_EMPTY;
  } else if (state === 'SURPRISED') {
    g[7][5] = C_EYE; g[7][6] = C_EYE; g[7][9] = C_EYE; g[7][10] = C_EYE;
    g[8][5] = C_EYE; g[8][6] = C_EYE; g[8][9] = C_EYE; g[8][10] = C_EYE;
    g[9][7] = C_LINE; g[9][8] = C_LINE;
  } else { /* IDLE: 4 frames, only the eye rows change */
    if (f === 1) { g[7][5] = C_LINE; g[7][6] = C_LINE; g[7][9] = C_LINE; g[7][10] = C_LINE; }
    else if (f === 2) { g[7][4] = C_EYE; g[7][5] = C_EYE; g[7][6] = C_EMPTY; g[7][9] = C_EYE; g[7][10] = C_EYE; }
    else if (f === 3) { g[7][4] = C_EMPTY; g[7][5] = C_LINE; g[7][6] = C_LINE; g[7][9] = C_LINE; g[7][10] = C_LINE; g[7][11] = C_EMPTY; }
  }
  return { grid: g, spans: buildSpans(g), dy: dy };
}
function frameCount(state) {
  if (state === 'IDLE') return 4;
  if (state === 'HAPPY' || state === 'HUNGRY') return 2;
  return 1;                              /* SLEEP + SURPRISED are static */
}
/* Precompute every (skin, state, frame) sprite once at load time. */
var SPRITES = [];
for (var si = 0; si < SKINS.length; si++) {
  var base = SKINS[si].build(), byState = {};
  var names = ['IDLE', 'HAPPY', 'HUNGRY', 'SURPRISED', 'SLEEP'];
  for (var ns = 0; ns < names.length; ns++) {
    var frames = [], nf = frameCount(names[ns]);
    for (var fi = 0; fi < nf; fi++) frames.push(makeVariant(base, names[ns], fi));
    byState[names[ns]] = frames;
  }
  SPRITES.push(byState);
}

/* ---- pure state-machine transition rules -------------------------------- */
var HUNGRY_AT = 70, FULL_AT = 12, HAPPY_AT = 70;
/* Apply time-based decay and resolve which state the pet should settle into.
 * Transient states (HAPPY / SURPRISED) hold until `until`; SLEEP holds until an
 * explicit wake. Returns true when the state changed. */
function careStep(care, now, dtSec) {
  var decay = care.state === 'SLEEP' ? 0.5 : 1;
  care.hunger = Math.min(100, care.hunger + 2.5 * dtSec * decay);
  care.happy = Math.max(0, care.happy - 1.2 * dtSec);
  if (care.state === 'HAPPY' || care.state === 'SURPRISED') {
    if (now >= care.until) {
      care.state = care.hunger >= HUNGRY_AT ? 'HUNGRY' : 'IDLE';
      care.until = 0;
      return true;
    }
    return false;
  }
  if (care.state === 'SLEEP') return false;
  var want = care.hunger >= HUNGRY_AT ? 'HUNGRY' : 'IDLE';
  if (want !== care.state) { care.state = want; return true; }
  return false;
}

/* ---- device integration ------------------------------------------------- */
var SKIN_KEY = 'pet.skin';               /* 8 chars <= NVS 15-char limit */
var SLEEP_AFTER_MS = 15000;
var care = { state: 'IDLE', hunger: 18, happy: 55, until: 0 };
var skinIndex = 0, frameIdx = 0, lastInteract = Date.now();
var animAcc = 0, hudAcc = 0, startleArmed = true, paused = false, timer = null;
var painted = false, pendingBox = FULL_BOX, prevVariant = null;

/* Read only indices 0/1: never use `get() < 0` as an error test (a stored
 * number can be negative); anything else falls back to the first skin. */
var savedSkin = lume.storage.kv.get(SKIN_KEY);
if (savedSkin === 1) skinIndex = 1;

var stState = signal(care.state), stHunger = signal(care.hunger);
var stHappy = signal(care.happy), stSkin = signal(skinIndex), sceneRev = signal(0);

function currentVariant() {
  return SPRITES[skinIndex][care.state][frameIdx % frameCount(care.state)];
}
function requestRedraw(box) {
  pendingBox = box || FULL_BOX;
  sceneRev.set(sceneRev() + 1);
}
function syncHud() {
  stState.set(care.state); stHunger.set(Math.round(care.hunger));
  stHappy.set(Math.round(care.happy)); stSkin.set(SKINS[skinIndex].name);
}
function changeState(next, until) {
  var prev = currentVariant();
  care.state = next; care.until = until || 0; frameIdx = 0; animAcc = 0;
  requestRedraw(changedBox(prev, currentVariant()));
  syncHud();
  lume.log('PET STATE ' + next);
}
function wake(why) {
  lastInteract = Date.now();
  if (care.state === 'SLEEP') changeState(care.hunger >= HUNGRY_AT ? 'HUNGRY' : 'IDLE', 0);
  if (why) lume.log('PET WAKE ' + why);
}

/* --- interactions (also reachable as globals for the host harness) ------ */
function doPet() {
  wake('pet');
  care.happy = Math.min(100, care.happy + 22);
  care.hunger = Math.min(100, care.hunger + 2);
  changeState('HAPPY', Date.now() + 2500);
  lume.log('PET PET happy=' + Math.round(care.happy) + ' state=' + care.state);
}
function doFeed() {
  wake('feed');
  care.hunger = Math.max(0, care.hunger - 45);
  care.happy = Math.min(100, care.happy + 8);
  changeState(care.state === 'HAPPY' ? 'HAPPY' : 'IDLE', 0);
  lume.log('PET FEED hunger=' + Math.round(care.hunger) + ' state=' + care.state);
}
function doStartle(magnitude) {
  wake('startle');
  changeState('SURPRISED', Date.now() + 1500);
  lume.log('PET STARTLE mag=' + (magnitude || 0).toFixed(2) + ' state=' + care.state);
}
function enterSleep() {
  if (care.state === 'SLEEP') return;
  changeState('SLEEP', 0);
  lume.log('PET SLEEP hunger=' + Math.round(care.hunger));
}
function selectSkin(i) {
  skinIndex = ((i % SKINS.length) + SKINS.length) % SKINS.length;
  var code = lume.storage.kv.set(SKIN_KEY, skinIndex);
  frameIdx = 0;
  /* full sprite box: both palette and pixel geometry changed */
  requestRedraw(FULL_BOX);
  syncHud();
  lume.log('PET SKIN ' + skinIndex + ' ' + SKINS[skinIndex].name + ' kv=' + code);
}
function sampleImu() {
  var imu = lume.imu.read();              /* m/s^2, ~9.81 at rest; null on no board */
  if (!imu || typeof imu.ax !== 'number' || typeof imu.ay !== 'number' ||
      typeof imu.az !== 'number') return;
  var mag = Math.sqrt(imu.ax * imu.ax + imu.ay * imu.ay + imu.az * imu.az);
  /* A near-zero vector means "sensor not ready" (seen at emu boot) or free
   * fall, not a wrist flip — ignore it so boot never startles the pet. */
  if (mag < 5) return;
  if (Math.abs(mag - 9.81) < 1.2) { startleArmed = true; return; }
  if (startleArmed && Math.abs(mag - 9.81) > 4) { startleArmed = false; doStartle(mag); }
}
function tick() {
  if (paused) return;
  var now = Date.now(), dtSec = Math.min(0.1, Math.max(0, (now - (tick.last || now)) / 1000));
  tick.last = now;
  sampleImu();
  var changed = careStep(care, now, dtSec);
  if (changed) { frameIdx = 0; requestRedraw(changedBox(null, currentVariant())); syncHud(); }
  if (care.state !== 'SLEEP' && now - lastInteract >= SLEEP_AFTER_MS) enterSleep();
  /* 20 Hz timer; repaint only when the animation frame actually advances. */
  if (care.state !== 'SLEEP' && frameCount(care.state) > 1) {
    animAcc += dtSec * 1000;
    if (animAcc >= 100) {
      animAcc -= 100;
      var prev = currentVariant();
      frameIdx = (frameIdx + 1) % frameCount(care.state);
      requestRedraw(changedBox(prev, currentVariant()));
    }
  }
  hudAcc += dtSec * 1000;
  if (hudAcc >= 1000) { hudAcc = 0; stHunger.set(Math.round(care.hunger)); stHappy.set(Math.round(care.happy)); }
}
function start() {
  if (timer === null) { tick.last = Date.now(); timer = lume.system.setInterval(tick, 50); }
}
function stop() { if (timer !== null) lume.system.clearInterval(timer); timer = null; }

/* ---- renderer: precomputed spans + tight dirty box ---------------------- */
function drawVariant(ctx, v, box) {
  var pal = SKINS[skinIndex].colors, spans = v.spans, oy = OY + (v.dy || 0) * CELL, i;
  for (i = 0; i < spans.length; i++) {
    var s = spans[i], sy = s[0], sx = s[1], sw = s[2], col = s[3];
    if (box && (sy < box.y || sy >= box.y + box.h || sx + sw <= box.x || sx >= box.x + box.w)) continue;
    ctx.fillColor(pal[col]);
    ctx.fillRect(OX + sx * CELL, oy + sy * CELL, sw * CELL, CELL);
  }
}
var scene = Canvas({ width: W, height: H, onDraw: function (ctx) {
  sceneRev();
  var v = currentVariant();
  if (!painted) {
    ctx.fillColor(BG); ctx.fillRect(0, 0, W, H);
    drawVariant(ctx, v, null);
    painted = true; prevVariant = v; pendingBox = null;
    return;                               /* first paint: whole canvas */
  }
  var box = pendingBox || FULL_BOX;
  var area = {
    x: OX + box.x * CELL,
    y: OY + (v.dy || 0) * CELL + box.y * CELL,
    w: box.w * CELL, h: box.h * CELL
  };
  if (area.x + area.w > W) area.w = W - area.x;
  if (area.y + area.h > H) area.h = H - area.y;
  ctx.fillColor(BG); ctx.fillRect(area.x, area.y, area.w, area.h);
  drawVariant(ctx, v, box);
  prevVariant = v; pendingBox = null;
  return [area];
} });

/* ---- HUD (native widgets; no canvas, no font-symbol glyphs) ------------- */
var root = View({ style: { width: W, height: H, background: BG, scroll: 'none' } }, [
  scene,
  Text({ text: 'LUME PET', style: { position: 'absolute', x: 24, y: 18, width: 200, height: 32, fontSize: 26, color: '#F3F5FF' } }),
  Text({ text: function () { return stState(); }, style: { position: 'absolute', x: 24, y: 54, width: 220, height: 26, fontSize: 19, color: '#F4C86A' } }),
  Text({ text: function () { return stSkin(); }, style: { position: 'absolute', x: 320, y: 22, width: 136, height: 26, fontSize: 19, color: '#57D6B4', textAlign: 'right' } }),
  Text({ text: function () { return 'HUNGER ' + stHunger() + '   HAPPY ' + stHappy(); },
    style: { position: 'absolute', x: 24, y: 330, width: 432, height: 26, fontSize: 18, color: '#E9ECFF' } }),
  Text({ text: 'TAP=PET  HOLD=FEED  FLIP=WAKE',
    style: { position: 'absolute', x: 24, y: 366, width: 432, height: 24, fontSize: 15, color: '#9FB0CC' } }),
  Text({ text: 'TAP SKIN TO SWAP - HOT RELOAD READY',
    style: { position: 'absolute', x: 24, y: 396, width: 432, height: 24, fontSize: 15, color: '#9FB0CC' } }),
  Button({ title: 'SKIN', onPress: function () { selectSkin(skinIndex + 1); },
    style: { position: 'absolute', x: 360, y: 54, width: 96, height: 52, background: '#28344A', borderRadius: 10, fontSize: 18 } })
]);

lume.gesture.on(scene, 'tap', function (e) { doPet(); });
lume.gesture.on(scene, 'longpress', function (e) { doFeed(); });

lume.app.onStart(function () { start(); });
lume.app.onPause(function () { paused = true; stop(); });
lume.app.onResume(function () { paused = false; start(); });
lume.log('PET READY skin=' + skinIndex + ' ' + SKINS[skinIndex].name + ' state=' + care.state);
syncHud();
start();
