/* Tilt Maze: standalone global script. Pure physics/levels occupy the first section. */
var W = 400, H = 400, BALL_R = 9;
var BOUNDS = { left: 40, top: 55, right: 360, bottom: 355 };
/* 真机调参点: read() returns m/s^2 (QMI8658 +/-4g); tune axis/sign and gain. */
var AXIS_X = 'ax', AXIS_Y = 'ay', SIGN_X = 1, SIGN_Y = 1;
var GAIN = 65;             /* px/s^2 per measured m/s^2 */
var DEAD_ZONE = 0.65;       /* m/s^2 */
/* 真机调参点: ball feel, rebound, damping, maximum speed. */
var RESTITUTION = 0.5, DRAG = 1.5, MAX_SPEED = 280;

var LEVELS = [
  { start: { x: 92, y: 102 }, goal: { x: 310, y: 302, r: 15 },
    walls: [{ x: 72, y: 180, w: 210, h: 12 }],
    holes: [{ x: 175, y: 275, r: 12 }] },
  { start: { x: 90, y: 92 }, goal: { x: 315, y: 315, r: 15 },
    walls: [{ x: 60, y: 155, w: 190, h: 12 }, { x: 155, y: 245, w: 195, h: 12 }],
    holes: [{ x: 290, y: 202, r: 12 }, { x: 102, y: 305, r: 12 }] },
  { start: { x: 85, y: 95 }, goal: { x: 310, y: 310, r: 15 },
    walls: [{ x: 65, y: 145, w: 205, h: 12 }, { x: 135, y: 215, w: 215, h: 12 },
      { x: 60, y: 285, w: 210, h: 12 }],
    holes: [{ x: 305, y: 183, r: 12 }, { x: 91, y: 250, r: 12 },
      { x: 296, y: 270, r: 11 }] }
];
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function insideCircle(x, y, circle, radius) {
  var dx = x - circle.x, dy = y - circle.y, limit = circle.r - radius;
  return limit >= 0 && dx * dx + dy * dy <= limit * limit;
}
function collideWall(b, wall) {
  var nearX = clamp(b.x, wall.x, wall.x + wall.w);
  var nearY = clamp(b.y, wall.y, wall.y + wall.h);
  var dx = b.x - nearX, dy = b.y - nearY;
  var d2 = dx * dx + dy * dy;
  if (d2 >= BALL_R * BALL_R) return false;
  var nx, ny, penetration;
  if (d2 > 0) {
    var d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; penetration = BALL_R - d;
  } else {
    /* Center entered rectangle: choose nearest exit face. */
    var faces = [b.x - wall.x, wall.x + wall.w - b.x,
      b.y - wall.y, wall.y + wall.h - b.y];
    var edge = 0;
    for (var i = 1; i < 4; i++) if (faces[i] < faces[edge]) edge = i;
    nx = edge === 0 ? -1 : edge === 1 ? 1 : 0;
    ny = edge === 2 ? -1 : edge === 3 ? 1 : 0;
    penetration = BALL_R + faces[edge];
  }
  b.x += nx * penetration; b.y += ny * penetration;
  var normalSpeed = b.vx * nx + b.vy * ny;
  if (normalSpeed < 0) {
    b.vx -= (1 + RESTITUTION) * normalSpeed * nx;
    b.vy -= (1 + RESTITUTION) * normalSpeed * ny;
  }
  return Math.max(0, -normalSpeed);
}
/* dt in seconds. Returns an independent ball plus event flags; no device/UI access. */
function physicsStep(ball, ax, ay, walls, dt, holes, goal) {
  var b = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  var event = { ball: b, hitWall: false, impactSpeed: 0, hole: false, goal: false };
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
    for (var j = 0; j < walls.length; j++) {
      var impact = collideWall(b, walls[j]);
      if (impact !== false) { event.hitWall = true; event.impactSpeed = Math.max(event.impactSpeed, impact); }
    }
    if (holes) for (var k = 0; k < holes.length; k++) {
      if (insideCircle(b.x, b.y, holes[k], 0)) { event.hole = true; return event; }
    }
    if (goal && insideCircle(b.x, b.y, goal, BALL_R)) { event.goal = true; return event; }
  }
  return event;
}
function startBall(level) { return { x: level.start.x, y: level.start.y, vx: 0, vy: 0 }; }

/* Rendering and device integration. */
var frame = signal(0), levelIndex = 0, ball = startBall(LEVELS[0]);
var elapsed = 0, totalElapsed = 0, best = [], deaths = 0, finished = false;
var hintUntil = Date.now() + 2000, notice = '', noticeUntil = 0;
var lastTick = Date.now(), timer = null, paused = false, lastWallSound = 0;
for (var bi = 0; bi < LEVELS.length; bi++) {
  var saved = lume.storage.kv.get('maze.best.' + (bi + 1));
  best[bi] = typeof saved === 'number' && saved > 0 ? saved : 0;
}
function beep(hz, ms, endHz) {
  if (!lume.audio || !lume.audio.play) return;
  var count = Math.floor(16000 * ms / 1000), pcm = new ArrayBuffer(count * 4);
  var data = new DataView(pcm), phase = 0;
  for (var i = 0; i < count; i++) {
    var freq = hz + (endHz - hz) * i / count;
    phase += freq / 16000;
    var amp = i < 80 || i > count - 80 ? 900 : 1800;
    var sample = phase % 1 < 0.5 ? amp : -amp;
    data.setInt16(i * 4, sample, true); data.setInt16(i * 4 + 2, sample, true);
  }
  lume.audio.play(pcm);
}
function mappedAcceleration(sample, axis, sign) {
  var value = sample[axis] * sign;
  return Math.abs(value) < DEAD_ZONE ? 0 : value * GAIN;
}
function tick() {
  if (paused) return;
  var now = Date.now(), dt = clamp((now - lastTick) / 1000, 0, 0.1);
  lastTick = now;
  if (finished) { frame.set(frame() + 1); return; }
  var sample = lume.imu.read(), ax = 0, ay = 0;
  if (sample && typeof sample.ax === 'number' && typeof sample.ay === 'number') {
    ax = mappedAcceleration(sample, AXIS_X, SIGN_X);
    ay = mappedAcceleration(sample, AXIS_Y, SIGN_Y);
  } else ay = 9.80665 * GAIN; /* simulator: visible downward motion */
  var result = physicsStep(ball, ax, ay, LEVELS[levelIndex].walls, dt,
    LEVELS[levelIndex].holes, LEVELS[levelIndex].goal);
  ball = result.ball; elapsed += dt; totalElapsed += dt;
  if (result.hole) {
    deaths++; ball = startBall(LEVELS[levelIndex]);
    notice = 'HOLE - TRY AGAIN'; noticeUntil = now + 900;
    beep(500, 65, 160);
  } else if (result.goal) {
    var seconds = Math.round(elapsed * 10) / 10;
    if (!best[levelIndex] || seconds < best[levelIndex]) {
      best[levelIndex] = seconds;
      lume.storage.kv.set('maze.best.' + (levelIndex + 1), seconds);
    }
    beep(660, 40, 660); beep(990, 40, 990);
    if (levelIndex === LEVELS.length - 1) {
      finished = true; notice = 'FINISH ' + totalElapsed.toFixed(1) + 's'; noticeUntil = Infinity;
    } else {
      levelIndex++; elapsed = 0; ball = startBall(LEVELS[levelIndex]);
      notice = 'LEVEL ' + (levelIndex + 1); noticeUntil = now + 1200;
    }
  } else if (result.impactSpeed > 25 && now - lastWallSound > 120) {
    lastWallSound = now; beep(180, 25, 180);
  }
  frame.set(frame() + 1);
}
function start() { if (timer === null) { lastTick = Date.now(); timer = lume.system.setInterval(tick, 50); } }
function stop() { if (timer !== null) lume.system.clearInterval(timer); timer = null; }
lume.app.onStart(start);
lume.app.onPause(function () { paused = true; stop(); });
lume.app.onResume(function () { paused = false; start(); });
start();
function solidCircle(ctx, cx, cy, r, color) {
  ctx.fillColor(color);
  for (var y = -r; y <= r; y++) {
    var half = Math.floor(Math.sqrt(r * r - y * y));
    ctx.fillRect(cx - half, cy + y, 2 * half + 1, 1);
  }
}
var scene = Canvas({ width: W, height: H, onDraw: function (ctx) {
  frame();
  ctx.clear(); ctx.fillColor('#102026'); ctx.fillRect(0, 0, W, H);
  var level = LEVELS[levelIndex];
  ctx.fillColor('#21383D'); ctx.fillRect(BOUNDS.left, BOUNDS.top,
    BOUNDS.right - BOUNDS.left, BOUNDS.bottom - BOUNDS.top);
  ctx.line(40, 55, 360, 55, '#8CA9A7', 2);
  ctx.line(360, 55, 360, 355, '#8CA9A7', 2);
  ctx.line(360, 355, 40, 355, '#8CA9A7', 2);
  ctx.line(40, 355, 40, 55, '#8CA9A7', 2);
  for (var i = 0; i < level.walls.length; i++) {
    var w = level.walls[i];
    ctx.fillColor('#A97855'); ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.line(w.x, w.y, w.x + w.w, w.y, '#D3A77A', 2);
  }
  for (var j = 0; j < level.holes.length; j++) {
    var hole = level.holes[j];
    solidCircle(ctx, hole.x, hole.y, hole.r, '#061014');
    ctx.circle(hole.x, hole.y, hole.r + 2, '#648080');
  }
  solidCircle(ctx, level.goal.x, level.goal.y, level.goal.r, '#164D39');
  ctx.circle(level.goal.x, level.goal.y, level.goal.r, '#64E6A2');
  ctx.circle(level.goal.x, level.goal.y, level.goal.r - 5, '#64E6A2');
  solidCircle(ctx, Math.round(ball.x), Math.round(ball.y), BALL_R, '#F5F4E9');
  ctx.text(43, 20, 'LEVEL ' + (levelIndex + 1) + '/' + LEVELS.length, '#F5F4E9', 14);
  ctx.text(215, 20, elapsed.toFixed(1) + 's', '#F5F4E9', 14);
  ctx.text(45, 369, 'BEST ' + (best[levelIndex] ? best[levelIndex].toFixed(1) + 's' : '--'), '#A9C5C0', 14);
  ctx.text(260, 369, 'HOLES ' + deaths, '#A9C5C0', 14);
  if (Date.now() < hintUntil) ctx.text(139, 195, 'TILT TO MOVE', '#FFFFFF', 14);
  if (Date.now() < noticeUntil) ctx.text(119, 198, notice, '#FFFFFF', 14);
} });
View({ style: { width: '100%', height: '100%', background: '#102026',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  alignItems: 'center', padding: 40 } }, [scene]);
