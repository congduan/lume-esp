/* Lume fish tank: all geometry is drawn with the firmware Canvas API.
 * One fixed 33 ms step keeps steering deterministic even when a frame is late. */
var TANK_W = 480, TANK_H = 480, FISH_LEFT = 38, FISH_RIGHT = 442;
var FISH_TOP = 58, FISH_BOTTOM = 406, TANK_DT = 1 / 30;
var FISH_COLORS = [
  { body: '#F5A66B', light: '#FFD5A1', fin: '#D96A5A', eye: '#142331' },
  { body: '#58C6C4', light: '#A8EBDE', fin: '#298EAE', eye: '#102C38' },
  { body: '#B692DB', light: '#E0C7F4', fin: '#775DA9', eye: '#1D2038' }
];
function tankClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function tankAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function tankRandom(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
function tankTarget(s, f) {
  f.tx = 64 + tankRandom(s) * 352;
  f.ty = 80 + tankRandom(s) * 292;
  f.wander = 90 + Math.floor(tankRandom(s) * 120);
}
function tankState() {
  var s = { seed: 87, ticks: 0, fish: [], food: [], bubbles: [], eaten: 0 };
  var sizes = [1.25, 0.92, 0.68, 1.18, 0.86, 0.64];
  for (var i = 0; i < 6; i++) {
    var f = { x: 82 + (i % 3) * 151, y: 113 + Math.floor(i / 3) * 164,
      angle: i % 2 ? Math.PI - 0.35 : 0.35, speed: 0.9, size: sizes[i],
      color: i % 3, phase: i * 1.3, burst: 0, tx: 0, ty: 0, wander: 0 };
    tankTarget(s, f); s.fish.push(f);
  }
  for (i = 0; i < 10; i++) s.bubbles.push({ x: 43 + (i % 3) * 178 + (i % 2) * 7,
    y: 35 + i * 43, r: 2 + i % 3, drift: i * 1.7 });
  return s;
}
function tankFeed(s, x, y) {
  x = tankClamp(x, FISH_LEFT + 8, FISH_RIGHT - 8);
  y = tankClamp(y, FISH_TOP, FISH_BOTTOM - 40);
  for (var i = 0; i < 5; i++) s.food.push({ x: x + (i - 2) * 6, y: y - (i % 2) * 5, age: 0 });
  if (s.food.length > 20) s.food.splice(0, s.food.length - 20);
}
function tankStep(s) {
  s.ticks++;
  var i, j, f, dx, dy, d, nearest, nearestD;
  for (i = s.food.length - 1; i >= 0; i--) {
    var p = s.food[i]; p.y = Math.min(FISH_BOTTOM + 13, p.y + 0.52); p.age++;
    if (p.age > 660) s.food.splice(i, 1);
  }
  for (i = 0; i < s.fish.length; i++) {
    f = s.fish[i]; nearest = null; nearestD = 150 * 150;
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
  }
  for (i = 0; i < s.bubbles.length; i++) {
    var b = s.bubbles[i]; b.y -= 0.48 + b.r * 0.15;
    if (b.y < 26) b.y = 427 + (i % 3) * 16;
    b.drift += 0.025;
  }
  return s;
}

/* GAME UI */
var tank = tankState(), tankFrame = signal(0), tankTimer = null;
var tankRoot = View({ style: { width: 480, height: 480, background: '#071C29', scroll: 'none' } });
function tankLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.line(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), color, width);
}
function tankFish(ctx, f) {
  var c = FISH_COLORS[f.color], ca = Math.cos(f.angle), sa = Math.sin(f.angle);
  var length = 20 * f.size, half = 10 * f.size;
  function point(x, y) { return [f.x + x * ca - y * sa, f.y + x * sa + y * ca]; }
  function stroke(x1, y1, x2, y2, ink, width) {
    var a = point(x1, y1), b = point(x2, y2);
    tankLine(ctx, a[0], a[1], b[0], b[1], ink, Math.max(1, Math.round(width * f.size)));
  }
  var sway = Math.sin(f.phase) * 7;
  /* A broad, swinging triangular tail; its tip follows the phase. */
  stroke(-length * 0.75, 0, -length * 1.7, -half + sway, c.fin, 3);
  stroke(-length * 0.75, 0, -length * 1.7, half + sway, c.fin, 3);
  stroke(-length * 1.7, -half + sway, -length * 1.7, half + sway, c.fin, 2);
  /* Five variable-width strokes form an oval body without pixel loops. */
  stroke(-length * 0.63, -half * 0.48, length * 0.52, -half * 0.48, c.body, 6);
  stroke(-length * 0.82, -half * 0.22, length * 0.72, -half * 0.22, c.body, 9);
  stroke(-length * 0.88, 0, length * 0.82, 0, c.body, 12);
  stroke(-length * 0.82, half * 0.22, length * 0.72, half * 0.22, c.body, 9);
  stroke(-length * 0.63, half * 0.48, length * 0.52, half * 0.48, c.body, 6);
  stroke(-length * 0.42, -half * 0.32, length * 0.35, -half * 0.32, c.light, 2);
  stroke(-length * 0.2, -half * 0.74, length * 0.1, -half * 1.12, c.fin, 3);
  stroke(-length * 0.05, half * 0.66, -length * 0.27, half * 1.05, c.fin, 3);
  var eye = point(length * 0.57, -half * 0.23);
  ctx.circle(Math.round(eye[0]), Math.round(eye[1]), Math.max(2, Math.round(2.4 * f.size)), c.eye);
}
var tankCanvas = Canvas({ parent: tankRoot, width: TANK_W, height: TANK_H,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    tankFrame();
    var bands = ['#071B29','#082634','#0A303D','#0C3B47','#0D4650','#10515A',
      '#125A60','#155F61','#176263','#1A6361','#1C625D','#205F58'];
    for (var i = 0; i < bands.length; i++) { ctx.fillColor(bands[i]); ctx.fillRect(0, i * 40, 480, 40); }
    /* Broad dim caustics: RGB565 has no alpha, so use nearby solid shades. */
    var shift = Math.sin(tank.ticks * 0.012) * 13;
    tankLine(ctx, 78 + shift, 118, 112 + shift, 123, '#113A47', 12);
    tankLine(ctx, 223 - shift, 79, 263 - shift, 85, '#123743', 15);
    tankLine(ctx, 356 + shift, 226, 390 + shift, 231, '#1B565A', 13);
    ctx.fillColor('#8B8264'); ctx.fillRect(0, 425, 480, 55);
    ctx.fillColor('#A59670'); ctx.fillRect(0, 425, 480, 10);
    ctx.fillColor('#766F59'); ctx.fillRect(0, 459, 480, 21);
    for (i = 0; i < 5; i++) {
      var bx = 45 + i * 98, top = 313 + i % 3 * 14;
      var wave = Math.sin(tank.ticks * 0.045 + i * 1.6) * 12;
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
    for (i = 0; i < tank.fish.length; i++) tankFish(ctx, tank.fish[i]);
  } });
function tankTick() { tankStep(tank); tankFrame.set(tankFrame() + 1); }
function tankStart() { if (tankTimer === null) tankTimer = lume.system.setInterval(tankTick, 33); }
function tankStop() { if (tankTimer !== null) lume.system.clearInterval(tankTimer); tankTimer = null; }
lume.gesture.on(tankRoot, 'tap', function (e) { tankFeed(tank, e.x, e.y); tankFrame.set(tankFrame() + 1); });
lume.app.onStart(tankStart);
lume.app.onPause(tankStop);
lume.app.onResume(tankStart);
tankStart();
