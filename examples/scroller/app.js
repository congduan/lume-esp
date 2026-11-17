/* r83 horizontal sprite-scrolling POC. Original pixel approximations only -
 * no third-party artwork, no named commercial title. Every visible element
 * (sky, terrain bands, runner, spikes, coins) is uploaded once with
 * ctx.retainImage() and replayed each frame with ctx.drawImage(); the JS path
 * never redraws a sprite pixel-by-pixel. Dirty rects are the two camera-swept
 * terrain bands plus the moving sprites' old+new boxes - see docs/r83-*. */
var MW = 480, MH = 352, TOP = 56;
var SKY_HEX = '#83D9F5', HUD_BG = '#132435', ROOT_BG = '#173250';
var HILL_Y = 120, HILL_H = 40, GROUND_Y = 290, GROUND_H = 62;
var HERO_SX = 48, HERO_W = 16, HERO_H = 20, CROUCH_H = 12;
var SPIKE_W = 16, SPIKE_H = 24, COIN_W = 12, COIN_H = 12;
var CAM_STEP = 3, GRAV = 0.55, JUMP_V = -9, INVULN = 24;
var WORLD_LEN = 8000;

function rgb565(r, g, b) { return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); }
var PAL = {
  R: rgb565(212, 54, 60), F: rgb565(248, 196, 140), B: rgb565(30, 86, 140),
  W: rgb565(255, 255, 255), Y: rgb565(233, 169, 21), y: rgb565(255, 228, 132),
  K: rgb565(58, 58, 74), k: rgb565(138, 138, 160)
};

/* Original 2-frame runner + crouch + spike + coin. '.' is transparent (0x0000). */
var SPRITE_ROWS = {
  hero: ['..RRRR..', '.RRRRRR.', '..FFFF..', '.FBBBF..', '..BBBB..',
         '..BBBB..', '.RBBBBR.', '.RBBBBR.', '..BB.BB.', '.BB..BB.'],
  jump: ['..RRRR..', '.RRRRRR.', '..FFFF..', '.FBBBF..', '..BBBB..',
         '.RBBBBR.', 'R.BBBB.R', '..BBBB..', '.BB..BB.', 'BB....BB'],
  crouch: ['..RRRR..', '.RFFFFR.', '.FBBBBF.', '.BBBBBB.', '.BB..BB.', 'BB....BB'],
  spike: ['...KK...', '..KkkK..', '.KkkkkK.', 'KkkkkkkK', 'KkkkkkkK',
          '.KKKKKK.'],
  coin: ['..YYYY..', '.YyyyyY.', 'YyyWWyyY', 'YyWWWWyY', 'YyyWWyyY',
         '.YyyyyY.', '..YYYY..']
};

/* r68 invaders precedent: decode each sprite into runs ONCE, then materialise
 * a Uint16Array RGB565 bitmap. spanBuilds/pixelBuilds are stable across ticks
 * and asserted by the harness (upload idempotency). */
var SPANS = {}, PIXELS = {}, spanBuilds = 0, pixelBuilds = 0, TOTAL_SPANS = 0;
function spansToPixels(rows, pal) {
  var h = rows.length, w = rows[0].length, runs = [], px = new Uint16Array(w * h);
  for (var y = 0; y < h; y++) {
    var row = rows[y], x = 0;
    while (x < w) {
      var ch = row.charAt(x), st = x;
      while (x < w && row.charAt(x) === ch) x++;
      if (ch !== '.' && ch !== ' ') { runs.push([st, y, x - st, ch]); }
    }
  }
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i], c = pal[r[3]] || PAL.W;
    for (var k = 0; k < r[2]; k++) px[r[1] * w + r[0] + k] = c;
  }
  return { w: w, h: h, px: px, runs: runs.length };
}
for (var sk in SPRITE_ROWS) {
  spanBuilds++;
  var built = spansToPixels(SPRITE_ROWS[sk], PAL);
  PIXELS[sk] = built; SPANS[sk] = built.runs;
  TOTAL_SPANS += built.runs;
  pixelBuilds++;
}

/* Background bands are generated bitmaps (no per-frame JS geometry). The hill
 * keeps transparent 0x0000 sky above its silhouette; ground is opaque. */
function makeSky(w, h) {
  var px = new Uint16Array(w * h), sky = rgb565(131, 217, 245), cloud = rgb565(234, 251, 255), x, y, k;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) px[y * w + x] = sky;
  for (y = 36; y < 170; y += 46) for (x = (y * 7) % 160; x < w; x += 160)
    for (k = 0; k < 24; k++) px[y * w + x + k] = cloud;
  return { w: w, h: h, px: px, runs: 0 };
}
function makeHill(w, h) {
  var px = new Uint16Array(w * h), lit = rgb565(74, 154, 90), dark = rgb565(46, 107, 63), x, y;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var top = Math.floor(18 - 12 * Math.abs(Math.sin((x / w) * Math.PI * 2)));
    if (y >= top) px[y * w + x] = (y < top + 4) ? lit : dark;
  }
  return { w: w, h: h, px: px, runs: 0 };
}
function makeGround(w, h) {
  var px = new Uint16Array(w * h), grass = rgb565(96, 184, 76),
      soil = rgb565(139, 74, 43), dark = rgb565(90, 46, 27), x, y;
  for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
    var c = y < 6 ? grass : soil;
    if (y >= 6 && ((x * 3 + y * 7) % 11 === 0)) c = dark;
    px[y * w + x] = c;
  }
  return { w: w, h: h, px: px, runs: 0 };
}
var BG = { sky: makeSky(MW, MH), hill: makeHill(48, HILL_H), ground: makeGround(48, GROUND_H) };
var SLOT = { sky: 1, hill: 2, ground: 3, hero: 4, jump: 5, crouch: 6, spike: 7, coin: 8 };
var UPLOADS = 8;

function box(x, y, w, h) { return { x: Math.floor(x), y: Math.floor(y), w: w, h: h }; }
function clip(r) {
  var x = Math.max(0, r.x), y = Math.max(0, r.y);
  var x2 = Math.min(MW, r.x + r.w), y2 = Math.min(MH, r.y + r.h);
  return x2 > x && y2 > y ? box(x, y, x2 - x, y2 - y) : null;
}
function pad(r, n) { return box(r.x - n, r.y - n, r.w + 2 * n, r.h + 2 * n); }
function union(a, b) {
  if (!a) return b; if (!b) return a;
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return box(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
}
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function heroH(s) { return s.crouch ? CROUCH_H : HERO_H; }
function heroWorldBox(s) { return box(s.cam + HERO_SX, s.heroY, HERO_W, heroH(s)); }
function spikeBox(o) { return box(o.wx, GROUND_Y - SPIKE_H, SPIKE_W, SPIKE_H); }
function coinBox(c) { return box(c.wx, c.cy, COIN_W, COIN_H); }

var WORLD = { spikes: [], coins: [] };
for (var wx = 240; wx < WORLD_LEN; wx += 96) WORLD.spikes.push({ wx: wx });
for (var cx = 200; cx < WORLD_LEN; cx += 48)
  WORLD.coins.push({ wx: cx, cy: 208 + ((cx / 48) % 3) * 8 });

function scrollState() {
  return { cam: 0, heroY: GROUND_Y - HERO_H, vy: 0, onGround: true,
           crouch: false, dash: 0, invuln: 0, coins: 0, lives: 3,
           tick: 0, over: false, taken: {}, events: [] };
}
function scrollEmit(s, msg) { s.events.push(msg); }
function scrollRestart(s) {
  var n = scrollState(); for (var k in n) s[k] = n[k];
  scrollEmit(s, 'RESTART');
}
function scrollScore(s) { return Math.floor(s.cam / 10) + s.coins * 50; }
function scrollStep(s, input) {
  if (s.over) return 'idle';
  s.tick++;
  var ev = 'move';
  if (input && input.dash) s.dash = 20;
  var spd = s.dash > 0 ? 2 : 1;
  if (s.dash > 0) s.dash--;
  s.cam += CAM_STEP * spd;
  if (input && input.jump && s.onGround) { s.vy = JUMP_V; s.onGround = false; ev = 'jump'; scrollEmit(s, 'JUMP'); }
  s.crouch = s.dash > 0 && s.onGround;
  s.heroY += s.vy; s.vy += GRAV;
  var hh = heroH(s);
  if (s.heroY + hh >= GROUND_Y) { s.heroY = GROUND_Y - hh; s.vy = 0; s.onGround = true; }
  if (s.invuln > 0) s.invuln--;
  var hb = heroWorldBox(s), i, o, ob, c, cb;
  for (i = 0; i < WORLD.coins.length; i++) {
    c = WORLD.coins[i];
    if (c.wx < s.cam - 32 || c.wx > s.cam + MW + 32) continue;
    if (s.taken[i]) continue;
    cb = coinBox(c);
    if (overlap(hb, cb)) { s.taken[i] = true; s.coins++; ev = 'coin'; scrollEmit(s, 'COIN coins=' + s.coins); }
  }
  if (s.invuln === 0) for (i = 0; i < WORLD.spikes.length; i++) {
    o = WORLD.spikes[i];
    if (o.wx < s.cam - 32 || o.wx > s.cam + MW + 32) continue;
    ob = spikeBox(o);
    if (overlap(hb, ob)) {
      s.lives--; s.invuln = INVULN; ev = 'hit';
      scrollEmit(s, 'HIT lives=' + s.lives + ' score=' + scrollScore(s));
      if (s.lives <= 0) { s.over = true; ev = 'over'; scrollEmit(s, 'OVER score=' + scrollScore(s)); }
      break;
    }
  }
  return ev;
}

/* NVS keys cap at 15 chars (lume_kv.c); 'hisc.scroller' is 13. */
function gameHigh(name) {
  try { var n = lume.storage.kv.get('hisc.' + name); return typeof n === 'number' && n > 0 ? n : 0; }
  catch (e) { return 0; }
}
function gameSave(name, score, previous) {
  if (score <= previous) return previous;
  try { lume.storage.kv.set('hisc.' + name, score); } catch (e) { /* volatile score still works */ }
  return score;
}

/* GAME UI */
var state = scrollState();
var frame = signal(0), best = gameHigh('scroller');
var noteSig = signal('TAP JUMP   SWIPE DOWN DASH   HOLD TO RUN');
var root = View({ style: { width: 480, height: 480, background: ROOT_BG, scroll: 'none' } });
View({ parent: root, style: { position: 'absolute', x: 4, y: 4, width: 472, height: 40, background: HUD_BG, scroll: 'none' } });
View({ parent: root, style: { position: 'absolute', x: 420, y: 12, width: 40, height: 24, background: '#40D8B0', scroll: 'none' } });
Text({ parent: root, text: 'SCROLLER', style: { position: 'absolute', x: 12, y: 8, fontSize: 14, color: '#FFFFFF' } });
Text({ parent: root, text: function () {
  frame(); return 'X ' + Math.floor(state.cam) + ' C ' + state.coins + ' HI ' + best + ' L ' + state.lives;
}, style: { position: 'absolute', x: 290, y: 8, fontSize: 14, color: '#9BD8FF' } });
Text({ parent: root, text: function () { return noteSig(); }, style: { position: 'absolute', x: 12, y: 28, fontSize: 14, color: '#9BD8FF' } });

var painted = false, spriteUploaded = false;
var prevHero = null, prevSpikes = [], prevCoins = [];
var dirtyPixels = 0, dirtyMax = 0, dirtySum = 0, dirtyNLast = 0;
var blits = 0, blitSum = 0, perfCount = 0, perfSum = 0, perfMax = 0;
function screenHeroBox(s) { return box(HERO_SX, s.heroY, HERO_W, heroH(s)); }
function visibleSpikes(s) {
  var out = [], i, sx, b;
  for (i = 0; i < WORLD.spikes.length; i++) {
    sx = WORLD.spikes[i].wx - s.cam;
    if (sx < -SPIKE_W || sx > MW) continue;
    b = box(sx, GROUND_Y - SPIKE_H, SPIKE_W, SPIKE_H);
    if (clip(b)) out.push(b);
  }
  return out;
}
function visibleCoins(s) {
  var out = [], i, sx, b;
  for (i = 0; i < WORLD.coins.length; i++) {
    if (s.taken[i]) continue;
    sx = WORLD.coins[i].wx - s.cam;
    if (sx < -COIN_W || sx > MW) continue;
    b = box(sx, WORLD.coins[i].cy, COIN_W, COIN_H);
    if (clip(b)) out.push(b);
  }
  return out;
}
function paintBands(ctx, s) {
  var k, x, i, list;
  ctx.drawImage(SLOT.sky, 0, 0); blits++;
  var hillOff = Math.floor(s.cam / 2) % 48;
  for (k = -1; k <= Math.ceil(MW / 48); k++) {
    x = k * 48 - hillOff;
    ctx.drawImage(SLOT.hill, x, HILL_Y); blits++;
  }
  var groundOff = s.cam % 48;
  for (k = -1; k <= Math.ceil(MW / 48); k++) {
    x = k * 48 - groundOff;
    ctx.drawImage(SLOT.ground, x, GROUND_Y); blits++;
  }
  list = visibleCoins(s);
  for (i = 0; i < list.length; i++) { ctx.drawImage(SLOT.coin, list[i].x, list[i].y); blits++; }
  list = visibleSpikes(s);
  for (i = 0; i < list.length; i++) { ctx.drawImage(SLOT.spike, list[i].x, list[i].y); blits++; }
  var hb = screenHeroBox(s);
  ctx.drawImage(s.crouch ? SLOT.crouch : (s.onGround ? SLOT.hero : SLOT.jump), hb.x, hb.y); blits++;
}
var canvas = Canvas({ parent: root, width: MW, height: MH, style: { position: 'absolute', x: 0, y: TOP }, onDraw: function (ctx) {
  frame();
  var s = state, areas = [], i, u, b, list;
  if (!spriteUploaded) {
    ctx.retainImage(SLOT.sky, BG.sky.w, BG.sky.h, BG.sky.px);
    ctx.retainImage(SLOT.hill, BG.hill.w, BG.hill.h, BG.hill.px);
    ctx.retainImage(SLOT.ground, BG.ground.w, BG.ground.h, BG.ground.px);
    for (var key in PIXELS) {
      var p = PIXELS[key];
      ctx.retainImage(SLOT[key], p.w, p.h, p.px);
    }
    spriteUploaded = true;
  }
  blits = 0;
  paintBands(ctx, s);
  if (!painted) {
    areas.push(box(0, 0, MW, MH));
  } else {
    areas.push(box(0, HILL_Y, MW, HILL_H));
    areas.push(box(0, GROUND_Y, MW, GROUND_H));
    var hb = screenHeroBox(s);
    u = union(hb, prevHero); if (u) { b = clip(pad(u, 2)); if (b) areas.push(b); }
    /* All coin old+new boxes fold into ONE rect: the bridge caps a frame at
     * 8 dirty rects, and the band rects already consume two of them. */
    list = visibleCoins(s);
    var coinUnion = null;
    for (i = 0; i < list.length; i++) coinUnion = union(coinUnion, list[i]);
    for (i = 0; i < prevCoins.length; i++) coinUnion = union(coinUnion, prevCoins[i]);
    if (coinUnion) { b = clip(pad(coinUnion, 2)); if (b) areas.push(b); }
  }
  dirtyPixels = 0;
  var valid = [];
  for (i = 0; i < areas.length; i++) { dirtyPixels += areas[i].w * areas[i].h; valid.push(areas[i]); }
  dirtyNLast = valid.length;
  prevHero = screenHeroBox(s);
  prevCoins = visibleCoins(s);
  painted = true;
  return valid.length ? valid : [box(HERO_SX, s.heroY, 1, 1)];
} });

function logEvent(s) { lume.log('SCROLLER ' + s); }
var pending = { jump: false, dash: false };
function doJump() { pending.jump = true; }
function doDash() { pending.dash = true; }
function tick() {
  var t0 = Date.now();
  var ev = scrollStep(state, { jump: pending.jump, dash: pending.dash });
  pending.jump = false; pending.dash = false;
  while (state.events.length) logEvent(state.events.shift());
  if (ev === 'over') {
    best = gameSave('scroller', scrollScore(state), best);
    noteSig.set('GAME OVER - TAP TO RESTART');
  }
  frame.set(frame() + 1);
  var dt = Date.now() - t0;
  perfCount++; perfSum += dt; perfMax = Math.max(perfMax, dt);
  dirtySum += dirtyPixels; dirtyMax = Math.max(dirtyMax, dirtyPixels); blitSum += blits;
  if (perfCount === 25) {
    logEvent('PERF js_avg_ms=' + (perfSum / 25).toFixed(2) + ' js_max_ms=' + perfMax +
      ' dirty_avg_px=' + Math.round(dirtySum / 25) + ' dirty_max_px=' + dirtyMax +
      ' blits_avg=' + (blitSum / 25).toFixed(1) + ' dirty_n=' + dirtyNLast + ' spans=' + TOTAL_SPANS);
    perfCount = 0; perfSum = 0; perfMax = 0; dirtySum = 0; dirtyMax = 0; blitSum = 0;
  }
}
function control(x, title, act) {
  return Button({ parent: root, title: title, style: { position: 'absolute', x: x, y: 416,
    width: 232, height: 56, background: '#305978', color: '#FFFFFF', fontSize: 20 }, onPress: act });
}
control(4, 'JUMP / TAP', function () { if (state.over) { scrollRestart(state); noteSig.set('TAP JUMP   SWIPE DOWN DASH   HOLD TO RUN'); } else doJump(); });
control(244, 'DASH / SWIPE', function () { if (state.over) { scrollRestart(state); noteSig.set('TAP JUMP   SWIPE DOWN DASH   HOLD TO RUN'); } else doDash(); });
lume.gesture.on(root, 'tap', function () {
  if (state.over) { scrollRestart(state); noteSig.set('TAP JUMP   SWIPE DOWN DASH   HOLD TO RUN'); frame.set(frame() + 1); }
  else doJump();
});
lume.gesture.on(root, 'swipe', function (e) { if (e.dir === 'down') doDash(); });
var timer = null;
function start() { if (timer === null) timer = lume.system.setInterval(tick, 50); }
function stop() { if (timer !== null) { lume.system.clearInterval(timer); timer = null; } }
lume.app.onPause(stop); lume.app.onResume(start);
start();
