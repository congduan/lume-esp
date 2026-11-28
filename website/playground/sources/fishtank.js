/* Lume fish tank: all geometry is drawn with the firmware Canvas API.
 * Physics steps at 33 ms (deterministic steering); the canvas repaints every
 * other step and publishes only 1..8 dirty rects around moving objects. The
 * board cannot flush a full 480x480 panel 30 times a second (gravity_ball
 * precedent), so full-screen refresh is limited to the first frame. */
var TANK_W = 480, TANK_H = 480, FISH_LEFT = 38, FISH_RIGHT = 442;
var FISH_TOP = 58, FISH_BOTTOM = 406, TANK_DT = 1 / 30;
var TANK_RENDER_EVERY = 2, TANK_PLANT_EVERY = 8;
var FISH_COLORS = [
  { body: '#F5A66B', light: '#FFD5A1', fin: '#D96A5A', deep: '#E08A4E', eye: '#142331' },
  { body: '#58C6C4', light: '#A8EBDE', fin: '#298EAE', deep: '#2F9FA8', eye: '#102C38' },
  { body: '#B692DB', light: '#E0C7F4', fin: '#775DA9', deep: '#9A74C4', eye: '#1D2038' }
];
function tankClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function tankAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function tankRandom(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
function tankBox(x0, y0, x1, y1, r) {
  var x = Math.min(x0, x1) - r, y = Math.min(y0, y1) - r;
  return { x: x, y: y, w: Math.max(x0, x1) + r - x, h: Math.max(y0, y1) + r - y };
}
function tankUnion(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y };
}
/* Fixed slots: six fish + one shared food box. Accumulating into slots keeps
 * the bridge's 8-rect cap without an O(n^2) merge inside the JS tick. */
function tankAccum(s, slot, box) {
  s.pending[slot] = s.pending[slot] ? tankUnion(s.pending[slot], box) : box;
}
function tankSnapBoxes(boxes) {
  var a = [];
  for (var i = 0; i < boxes.length; i++) {
    var r = boxes[i];
    if (!r) continue;
    var x = tankClamp(Math.round(r.x), 0, TANK_W - 1),
        y = tankClamp(Math.round(r.y), 0, TANK_H - 1);
    a.push({ x: x, y: y,
      w: tankClamp(Math.round(r.x + r.w) - x, 1, TANK_W - x),
      h: tankClamp(Math.round(r.y + r.h) - y, 1, TANK_H - y) });
  }
  return a;
}
/* Plants sway in ~267 ms steps (every 4th painted frame), not per physics tick:
 * their union box is wide, so animating at 30 Hz would undo the dirty-rect win. */
function tankPlantPhase(ticks) { return Math.floor(ticks / TANK_PLANT_EVERY) * 0.45; }
function tankTarget(s, f) {
  f.tx = 64 + tankRandom(s) * 352;
  f.ty = 80 + tankRandom(s) * 292;
  f.wander = 90 + Math.floor(tankRandom(s) * 120);
}
function tankState() {
  var s = { seed: 87, ticks: 0, fish: [], food: [], bubbles: [], eaten: 0,
    pending: [], dirty: [] };
  var sizes = [1.25, 0.92, 0.68, 1.18, 0.86, 0.64];
  for (var i = 0; i < 6; i++) {
    var f = { x: 82 + (i % 3) * 151, y: 113 + Math.floor(i / 3) * 164,
      angle: i % 2 ? Math.PI - 0.35 : 0.35, speed: 0.9, size: sizes[i],
      color: i % 3, phase: i * 1.3, burst: 0, tx: 0, ty: 0, wander: 0,
      px: 82 + (i % 3) * 151, py: 113 + Math.floor(i / 3) * 164 };
    tankTarget(s, f); s.fish.push(f);
  }
  for (i = 0; i < 10; i++) s.bubbles.push({ x: 43 + (i % 3) * 178 + (i % 2) * 7,
    y: 35 + i * 43, r: 2 + i % 3, drift: i * 1.7,
    px: 43 + (i % 3) * 178 + (i % 2) * 7, py: 35 + i * 43 });
  return s;
}
function tankFeed(s, x, y) {
  x = tankClamp(x, FISH_LEFT + 8, FISH_RIGHT - 8);
  y = tankClamp(y, FISH_TOP, FISH_BOTTOM - 40);
  for (var i = 0; i < 5; i++) {
    var fx = x + (i - 2) * 6, fy = y - (i % 2) * 5;
    s.food.push({ x: fx, y: fy, px: fx, py: fy, age: 0 });
    tankAccum(s, 6, tankBox(fx, fy, fx, fy, 5));
  }
  if (s.food.length > 20) s.food.splice(0, s.food.length - 20);
}
function tankStep(s) {
  s.ticks++;
  var i, j, f, dx, dy, d, nearest, nearestD;
  for (i = s.food.length - 1; i >= 0; i--) {
    var p = s.food[i]; p.px = p.x; p.py = p.y;
    p.y = Math.min(FISH_BOTTOM + 13, p.y + 0.52); p.age++;
    tankAccum(s, 6, tankBox(p.px, p.py, p.x, p.y, 5));
    if (p.age > 660) s.food.splice(i, 1);
  }
  for (i = 0; i < s.fish.length; i++) {
    f = s.fish[i]; f.px = f.x; f.py = f.y;
    nearest = null; nearestD = 150 * 150;
    for (j = 0; j < s.food.length; j++) {
      dx = s.food[j].x - f.x; dy = s.food[j].y - f.y; d = dx * dx + dy * dy;
      if (d < nearestD) { nearestD = d; nearest = s.food[j]; }
    }
    if (nearest && nearestD < (12 + f.size * 11) * (12 + f.size * 11)) {
      s.food.splice(s.food.indexOf(nearest), 1); s.eaten++; f.burst = 42; nearest = null;
    }
    if (--f.wander <= 0 || (!nearest && Math.abs(f.tx - f.x) + Math.abs(f.ty - f.y) < 25)) tankTarget(s, f);
    var vx = (nearest ? nearest.x : f.tx) - f.x;
    var vy = (nearest ? nearest.y : f.ty) - f.y;
    /* Soft edge force starts well before the legal center bounds. */
    if (f.x < FISH_LEFT + 56) vx += (FISH_LEFT + 56 - f.x) * 5;
    if (f.x > FISH_RIGHT - 56) vx -= (f.x - FISH_RIGHT + 56) * 5;
    if (f.y < FISH_TOP + 50) vy += (FISH_TOP + 50 - f.y) * 5;
    if (f.y > FISH_BOTTOM - 50) vy -= (f.y - FISH_BOTTOM + 50) * 5;
    for (j = 0; j < s.fish.length; j++) {
      if (j === i) continue;
      dx = f.x - s.fish[j].x; dy = f.y - s.fish[j].y; d = dx * dx + dy * dy;
      if (d > 1 && d < 38 * 38) { vx += dx * 2400 / d; vy += dy * 2400 / d; }
    }
    var desired = Math.atan2(vy, vx);
    f.angle += tankClamp(tankAngle(desired - f.angle), -0.075, 0.075);
    f.angle = tankAngle(f.angle);
    var targetSpeed = nearest ? 1.62 : 0.88 + (i % 3) * 0.12;
    if (f.burst > 0) { targetSpeed = 2.22; f.burst--; }
    f.speed += (targetSpeed - f.speed) * 0.075;
    f.x = tankClamp(f.x + Math.cos(f.angle) * f.speed, FISH_LEFT, FISH_RIGHT);
    f.y = tankClamp(f.y + Math.sin(f.angle) * f.speed, FISH_TOP, FISH_BOTTOM);
    f.phase += 0.12 + f.speed * 0.19;
    tankAccum(s, i, tankBox(f.px, f.py, f.x, f.y, 28 * f.size + 3));
  }
  if (s.ticks % TANK_PLANT_EVERY === 0)
    tankAccum(s, 7, tankBox(29, 309, 453, 443, 0));  /* wide plant band */
  /* Bubbles stay put: their old full-width union dirty box cost more panel
   * refresh than the slow drift was worth. Fish, plants and food carry motion. */
  return s;
}

/* GAME UI */
/* r227 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r227Ctx) return c.__r227Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c.text(__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r227Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_View(p, kids) { return View(__A_style(p), kids); }
function __A_Text(p, kids) { return Text(__A_style(p), kids); }
function __A_Button(p, kids) { return Button(__A_style(p), kids); }
function __A_Image(p, kids) { return Image(__A_style(p), kids); }


var tank = tankState(), tankFrame = signal(0), tankTimer = null, tankPainted = false;
var tankRoot = __A_View({ style: { width: 480, height: 480, background: '#071C29', scroll: 'none' } });
function tankLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.line(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), color, width);
}
function tankFish(ctx, f) {
  var c = FISH_COLORS[f.color], ca = Math.cos(f.angle), sa = Math.sin(f.angle);
  var length = 20 * f.size, half = 10 * f.size;
  function point(x, y) { return [f.x + x * ca - y * sa, f.y + x * sa + y * ca]; }
  var sway = Math.sin(f.phase) * 6;
  /* Tail: a fan of three shrinking filled ellipses from the peduncle to the
   * tip — reads as a soft fin at any width, unlike 1px polylines. The fan
   * bends with the beat (each station's lateral offset follows sway). */
  function fan(t, lat, rx, ry, ink) {
    var p = point(t * length, lat);
    ctx.fillEllipse(Math.round(p[0]), Math.round(p[1]),
      Math.max(1, Math.round(rx * f.size)), Math.max(1, Math.round(ry * f.size)), ink);
  }
  var beat = sway / 6;
  /* Fan of three ellipses spaced in PIXELS (not body-t fraction) with ~50%
   * overlap: large and small fish both get a connected fin surface. */
  var step = 2.6 * f.size;               /* ~55% of the previous ellipse ry */
  fan(-0.84, beat * -1.2, 3.4, 5.0, c.fin);
  fan((-0.84 * length - step) / length, beat * -2.6, 2.8, 4.2, c.fin);
  fan((-0.84 * length - step * 2) / length, beat * -3.8, 2.2, 3.2, c.fin);
  /* Body: a chain of filled ellipses whose radii follow the fish profile
   * (narrow nose -> broad mid -> tapered peduncle), so any heading works
   * with the axis-aligned primitive. */
  /* Large: six broad stations; medium: five; small: six narrow stations.
   * The final small station at -0.70 is a 1.8 px tail-peduncle transition. */
  var stations = f.size >= 1.1 ? [
    { t: 0.6, rx: 4.4, ry: 4.2 }, { t: 0.3, rx: 5.8, ry: 6.8 },
    { t: 0.02, rx: 6.4, ry: 8.2 }, { t: -0.26, rx: 5.8, ry: 7.4 },
    { t: -0.52, rx: 4.6, ry: 5.4 }, { t: -0.76, rx: 3.2, ry: 3.6 }
  ] : f.size >= 0.8 ? [
    { t: 0.6, rx: 4.4, ry: 4.2 }, { t: 0.28, rx: 5.8, ry: 6.8 },
    { t: -0.04, rx: 6.4, ry: 8.2 }, { t: -0.36, rx: 5.2, ry: 6.5 },
    { t: -0.72, rx: 3.2, ry: 3.6 }
  ] : [
    { t: 0.70, rx: 3.0, ry: 2.8 }, { t: 0.46, rx: 4.3, ry: 4.4 },
    { t: 0.16, rx: 5.5, ry: 6.0 }, { t: -0.16, rx: 5.4, ry: 5.8 },
    { t: -0.46, rx: 3.8, ry: 3.8 }, { t: -0.70, rx: 1.8, ry: 1.8 }
  ];
  for (var i = 0; i < stations.length; i++) {
    var st = stations[i], pt = point(st.t * length, 0);
    ctx.fillEllipse(Math.round(pt[0]), Math.round(pt[1]),
      Math.round(st.rx * f.size), Math.round(st.ry * f.size), c.body);
  }
  /* Belly: light ellipse hugging the lower body silhouette. */
  var bl = point(-0.05 * length, half * 0.5);
  ctx.fillEllipse(Math.round(bl[0]), Math.round(bl[1]),
    Math.round(9.4 * f.size), Math.round(3.8 * f.size), c.light);
  /* Back: darker band along the upper silhouette. */
  var bk = point(-0.12 * length, -half * 0.58);
  ctx.fillEllipse(Math.round(bk[0]), Math.round(bk[1]),
    Math.round(10.0 * f.size), Math.round(3.4 * f.size), c.fin);
  /* Striped variant: two dark bars across the body (large fish only). */
  if (f.size > 1.1) {
    for (i = 0; i < 2; i++) {
      var bar = point((0.26 - i * 0.3) * length, 0);
      ctx.fillEllipse(Math.round(bar[0]), Math.round(bar[1]),
        Math.round(1.6 * f.size), Math.round((i ? 5.4 : 6.6) * f.size), c.deep);
    }
    /* Three one-pixel glints track the back rather than the screen axis. */
    for (i = 0; i < 3; i++) {
      var scale = 0.26 - i * 0.25;
      var glint = point(scale * length, -half * (0.72 + i * 0.03));
      ctx.fillCircle(Math.round(glint[0]), Math.round(glint[1]), 1, c.light);
    }
  }
  /* Dorsal fin: a small ellipse standing on the back, leaning with sway. */
  var df = point(-0.1 * length, -half * 1.06 + sway * 0.3);
  ctx.fillEllipse(Math.round(df[0]), Math.round(df[1]),
    Math.round(3.6 * f.size), Math.round(2.4 * f.size), c.fin);
  /* Eye: solid AA circle with a highlight pixel. */
  var eye = point(length * 0.6, -half * 0.26);
  ctx.fillCircle(Math.round(eye[0]), Math.round(eye[1]),
    Math.max(2, Math.round(2.3 * f.size)), c.eye);
  ctx.fillCircle(Math.round(eye[0] + f.size), Math.round(eye[1] - f.size), 1, c.light);
}
var tankCanvas = __A_Canvas({ parent: tankRoot, width: TANK_W, height: TANK_H,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    tankFrame();
    var bands = ['#071B29','#082634','#0A303D','#0C3B47','#0D4650','#10515A',
      '#125A60','#155F61','#176263','#1A6361','#1C625D','#205F58'];
    for (var i = 0; i < bands.length; i++) { ctx.fillColor(bands[i]); ctx.fillRect(0, i * 40, 480, 40); }
    /* Broad dim caustics: RGB565 has no alpha, so use nearby solid shades.
     * Kept static: animating them would dirty most of the water column while
     * the fish and swaying plants already carry the motion. */
    var shift = 0;
    tankLine(ctx, 78 + shift, 118, 112 + shift, 123, '#113A47', 12);
    tankLine(ctx, 223 - shift, 79, 263 - shift, 85, '#123743', 15);
    tankLine(ctx, 356 + shift, 226, 390 + shift, 231, '#1B565A', 13);
    ctx.fillColor('#8B8264'); ctx.fillRect(0, 425, 480, 55);
    ctx.fillColor('#A59670'); ctx.fillRect(0, 425, 480, 10);
    ctx.fillColor('#766F59'); ctx.fillRect(0, 459, 480, 21);
    for (i = 0; i < 5; i++) {
      var bx = 45 + i * 98, top = 313 + i % 3 * 14;
      var wave = Math.sin(tankPlantPhase(tank.ticks) + i * 1.6) * 12;
      tankLine(ctx, bx, 439, bx + wave * 0.4, 376, '#256F5A', 7);
      tankLine(ctx, bx + wave * 0.4, 376, bx + wave, top, '#3B9371', 5);
      tankLine(ctx, bx + wave * 0.25, 395, bx - 12 + wave, 362, '#4AA37B', 3);
    }
    for (i = 0; i < tank.bubbles.length; i++) {
      var b = tank.bubbles[i], x = b.x + Math.sin(b.drift) * 7;
      ctx.circle(Math.round(x), Math.round(b.y), b.r, '#4B9FAD');
    }
    for (i = 0; i < tank.food.length; i++) {
      var p = tank.food[i]; ctx.circle(Math.round(p.x), Math.round(p.y), 3, '#E4C78F');
    }
    /* Budget without food: 12 bands + 3 caustics + 3 sand + 15 plants
     * + 10 bubbles = 43. Two large fish x 19 calls, two medium x 13,
     * two small x 14 = 135; up to 20 food circles => 155, below 250. */
    /* Paint big fish first, small fish last (near = large = on top). */
    var order = [];
    for (i = 0; i < tank.fish.length; i++) order.push(i);
    order.sort(function (a, b) { return tank.fish[b].size - tank.fish[a].size; });
    for (i = 0; i < order.length; i++) tankFish(ctx, tank.fish[order[i]]);
    if (!tankPainted) {
      tankPainted = true;
      return { x: 0, y: 0, w: TANK_W, h: TANK_H };  /* first frame: full panel */
    }
    return tank.dirty.length ? tank.dirty : { x: 0, y: 0, w: TANK_W, h: TANK_H };
  } });
function tankFlush() {
  tank.dirty = tankSnapBoxes(tank.pending);
  tank.pending = [];
  tankFrame.set(tankFrame() + 1);
}
function tankTick() {
  tankStep(tank);
  if (tank.ticks % TANK_RENDER_EVERY === 0) tankFlush();
}
function tankStart() { if (tankTimer === null) tankTimer = lume.system.setInterval(tankTick, 33); }
function tankStop() { if (tankTimer !== null) lume.system.clearInterval(tankTimer); tankTimer = null; }
lume.gesture.on(tankRoot, 'tap', function (e) { tankFeed(tank, e.x, e.y); tankFlush(); });
lume.app.onStart(tankStart);
lume.app.onPause(tankStop);
lume.app.onResume(tankStart);
tankStart();
