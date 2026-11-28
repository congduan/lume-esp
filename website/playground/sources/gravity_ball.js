
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

/* Gravity Ball: minimal IMU demo. Pure physics occupies the first section.
 * 倾斜板子 -> 球按重力方向加速滚动；撞到屏幕四边按 RESTITUTION 回弹；
 * 改变倾斜方向 -> 重力方向改变 -> 球按新方向加速。只画一个球。 */
var W = 480, H = 480, BALL_R = 24;
/* Play area = the whole canvas, so the ball bounces off the screen edges. */
var BOUNDS = { left: 0, top: 0, right: W, bottom: H };
/* 真机调参点: read() returns m/s^2 (QMI8658 +/-4g); tune axis/sign and gain.
 * 真机现象：向左倾斜球却向右跑，说明 ax 与屏幕 +x 同向，故 X 取 -1。
 * Y 尚未在板子上核对，若上下也反了就同样把 SIGN_Y 改成 -1。 */
var AXIS_X = 'ax', AXIS_Y = 'ay', SIGN_X = -1, SIGN_Y = 1;
var GAIN = 55;              /* px/s^2 per measured m/s^2 */
var DEAD_ZONE = 0.5;        /* m/s^2: ignore noise so a resting board keeps still */
/* 真机调参点: ball feel, rebound, damping, maximum speed. */
var RESTITUTION = 0.55, DRAG = 1.2, MAX_SPEED = 420;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/* dt in seconds. Returns an independent ball plus event flags; no device/UI access. */
function physicsStep(ball, ax, ay, dt) {
  var b = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  var event = { ball: b, hitWall: false, impactSpeed: 0 };
  var steps = Math.max(1, Math.ceil(clamp(dt, 0, 0.1) / 0.01));
  var h = clamp(dt, 0, 0.1) / steps;
  for (var n = 0; n < steps; n++) {
    b.vx = (b.vx + ax * h) * Math.max(0, 1 - DRAG * h);
    b.vy = (b.vy + ay * h) * Math.max(0, 1 - DRAG * h);
    var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > MAX_SPEED) { b.vx *= MAX_SPEED / speed; b.vy *= MAX_SPEED / speed; }
    b.x += b.vx * h; b.y += b.vy * h;
    if (b.x < BOUNDS.left + BALL_R) { b.x = BOUNDS.left + BALL_R; if (b.vx < 0) { event.impactSpeed = Math.max(event.impactSpeed, -b.vx); b.vx *= -RESTITUTION; } event.hitWall = true; }
    if (b.x > BOUNDS.right - BALL_R) { b.x = BOUNDS.right - BALL_R; if (b.vx > 0) { event.impactSpeed = Math.max(event.impactSpeed, b.vx); b.vx *= -RESTITUTION; } event.hitWall = true; }
    if (b.y < BOUNDS.top + BALL_R) { b.y = BOUNDS.top + BALL_R; if (b.vy < 0) { event.impactSpeed = Math.max(event.impactSpeed, -b.vy); b.vy *= -RESTITUTION; } event.hitWall = true; }
    if (b.y > BOUNDS.bottom - BALL_R) { b.y = BOUNDS.bottom - BALL_R; if (b.vy > 0) { event.impactSpeed = Math.max(event.impactSpeed, b.vy); b.vy *= -RESTITUTION; } event.hitWall = true; }
  }
  return event;
}

/* Rendering and device integration. */
var BG = '#102026', BALL_INK = '#F5F4E9';
var frame = signal(0), ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
var lastTick = Date.now(), timer = null, paused = false;
function mappedAcceleration(sample, axis, sign) {
  var value = sample[axis] * sign;
  return Math.abs(value) < DEAD_ZONE ? 0 : value * GAIN;
}
function tick() {
  if (paused) return;
  var now = Date.now(), dt = clamp((now - lastTick) / 1000, 0, 0.1);
  lastTick = now;
  var sample = lume.imu.read(), ax = 0, ay = 0;
  if (sample && typeof sample.ax === 'number' && typeof sample.ay === 'number') {
    ax = mappedAcceleration(sample, AXIS_X, SIGN_X);
    ay = mappedAcceleration(sample, AXIS_Y, SIGN_Y);
  } else ay = 9.80665 * GAIN; /* simulator: visible downward motion */
  var oldX = ball.x, oldY = ball.y;
  ball = physicsStep(ball, ax, ay, dt).ball;
  if (Math.round(ball.x) !== Math.round(oldX) || Math.round(ball.y) !== Math.round(oldY))
    frame.set(frame() + 1);
}
function start() { if (timer === null) { lastTick = Date.now(); timer = lume.system.setInterval(tick, 50); } }
function stop() { if (timer !== null) lume.system.clearInterval(timer); timer = null; }
lume.app.onStart(start);
lume.app.onPause(function () { paused = true; stop(); });
lume.app.onResume(function () { paused = false; start(); });
start();

/* ---- raster ------------------------------------------------------------
 * A full repaint of this canvas is 230k pixels; at 20 fps the board cannot
 * flush that, the UI queue backs up and post() fails inside onDraw, so the
 * panel keeps a half-painted frame (streaks, ghost ball). The background is
 * one flat colour, so a frame erases only the ball's old+new box, redraws the
 * disc and returns that rectangle as a dirty rect: ~1k pixels per frame. */
function boxOf(cx, cy) {
  return { x: cx - BALL_R - 1, y: cy - BALL_R - 1, w: 2 * BALL_R + 2, h: 2 * BALL_R + 2 };
}
function unionBox(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y };
}
/* Dirty rects must be integers fully inside the canvas (the handle validates). */
function snapBox(r) {
  var x = clamp(Math.round(r.x), 0, W - 1), y = clamp(Math.round(r.y), 0, H - 1);
  return { x: x, y: y, w: clamp(Math.round(r.x + r.w) - x, 1, W - x),
    h: clamp(Math.round(r.y + r.h) - y, 1, H - y) };
}
/* r49 #6: the ball disc has a fixed shape; only its position changes. Its
 * 2*BALL_R+1 horizontal rows are precomputed once (retained geometry) instead
 * of recomputing sqrt()/floor()/max()/min() in JS on every frame. The rows are
 * still drawn with fillRect (cheap span raster): a filled disc is not
 * line-segment geometry, so C-side retained paths (which replay via the AA
 * canvas_line) would cost far more core0 raster work than they save in JS. */
var BALL_SPANS = [];
for (var sy = -BALL_R; sy <= BALL_R; sy++) {
  BALL_SPANS.push([sy, Math.floor(Math.sqrt(BALL_R * BALL_R - sy * sy))]);
}
function disc(ctx, cx, cy) {
  ctx.fillColor(BALL_INK);
  for (var i = 0; i < BALL_SPANS.length; i++) {
    var sy = BALL_SPANS[i][0], half = BALL_SPANS[i][1], y = cy + sy;
    if (y < 0 || y >= H) continue;
    var x1 = cx - half, x2 = cx + half + 1;
    if (x1 < 0) x1 = 0;
    if (x2 > W) x2 = W;
    if (x2 > x1) ctx.fillRect(x1, y, x2 - x1, 1);
  }
}
var painted = false, ballBox = null;
var scene = __A_Canvas({ width: W, height: H, onDraw: function (ctx) {
  frame();                                  /* redraw signal: tick() bumps it */
  var bx = Math.round(ball.x), by = Math.round(ball.y);
  var box = boxOf(bx, by);
  if (!painted) {
    ctx.clear();
    ctx.fillColor(BG); ctx.fillRect(0, 0, W, H);
    disc(ctx, bx, by);
    painted = true; ballBox = box;
    return;                                 /* first frame: whole-canvas invalidate */
  }
  /* One rect covers the old and the new ball box, so a bounce teleport or a
   * single-pixel step both leave no trail. */
  var area = snapBox(unionBox(ballBox, box));
  ctx.fillColor(BG);
  ctx.fillRect(area.x, area.y, area.w, area.h);
  disc(ctx, bx, by);
  ballBox = box;
  return [area];
} });
__A_View({ style: { width: '100%', height: '100%', background: BG } }, [scene]);
