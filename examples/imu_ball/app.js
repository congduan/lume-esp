/** IMU ball: a ball that falls along the device tilt direction. Gravity is
 * taken from lume.imu ax/ay each tick (screen-axis mapping is a board bring-up
 * item; see G_AXIS constants). Without an IMU (host simulator) it falls down. */
var W = 400, H = 400;
var DT = 0.05;            /* 50 ms tick, ~20 fps */
var R = 18;               /* ball radius, px */
var G_SCALE = 55;         /* px/s^2 per m/s^2 of measured acceleration */
var REST = 0.72;          /* bounce restitution */
var V_MAX = 700;          /* speed clamp, px/s */

/* Screen-axis mapping of the IMU axes. Calibrate on the board: hold the panel
 * upright and tilt it; if the ball runs the wrong way, flip a sign or swap
 * the pair (x/y). */
var GX = function (s) { return s.ax; };
var GY = function (s) { return s.ay; };

var frame = signal(0);
var statusSig = signal('IMU: waiting');
var ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
var trail = [];           /* last positions, oldest first */
var pollId = null, paused = false;

function tick() {
  if (paused) return;
  var s = lume.imu.read();
  var gx, gy;
  if (s) {
    gx = GX(s) * G_SCALE;
    gy = GY(s) * G_SCALE;
    if (frame() % 20 === 0)
      statusSig.set('a: ' + s.ax.toFixed(1) + ', ' + s.ay.toFixed(1) + ' m/s2');
  } else {
    gx = 0; gy = 9.81 * G_SCALE;   /* simulator / no board: falls straight down */
    if (frame() % 20 === 0) statusSig.set('IMU unavailable - gravity down');
  }

  ball.vx += gx * DT;
  ball.vy += gy * DT;
  var v = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (v > V_MAX) { ball.vx *= V_MAX / v; ball.vy *= V_MAX / v; }
  ball.x += ball.vx * DT;
  ball.y += ball.vy * DT;

  /* walls: bounce + a little floor friction */
  if (ball.x < R) { ball.x = R; ball.vx = -ball.vx * REST; }
  if (ball.x > W - R) { ball.x = W - R; ball.vx = -ball.vx * REST; }
  if (ball.y < R) { ball.y = R; ball.vy = -ball.vy * REST; }
  if (ball.y > H - R) {
    ball.y = H - R; ball.vy = -ball.vy * REST;
    ball.vx *= 0.96;
    if (Math.abs(ball.vy) < 20) ball.vy = 0;
  }

  trail.push([ball.x, ball.y]);
  if (trail.length > 6) trail.shift();
  frame.set(frame() + 1);
}

function startPolling() {
  if (pollId === null) pollId = lume.system.setInterval(tick, 50);
}
function stopPolling() {
  if (pollId !== null) lume.system.clearInterval(pollId);
  pollId = null;
}
/* Start at top level: the simulator never fires lifecycle events; on device
 * onStart fires too, but pollId guards against a double interval. */
lume.app.onStart(startPolling);
lume.app.onPause(function () { paused = true; stopPolling(); });
lume.app.onResume(function () { paused = false; startPolling(); });
startPolling();

var scene = Canvas({ width: W, height: H, onDraw: function (ctx) {
  frame();                        /* subscribe: redraw on every physics tick */
  ctx.clear();
  ctx.fillColor('#0B1724');
  ctx.fillRect(0, 0, W, H);

  /* gravity direction indicator */
  var s = lume.imu.read();
  if (s) {
    var gx = GX(s), gy = GY(s);
    var n = Math.sqrt(gx * gx + gy * gy);
    if (n > 0.5)
      ctx.line(W / 2, H / 2, Math.round(W / 2 + gx / n * 40),
               Math.round(H / 2 + gy / n * 40), '#46617A', 2);
  }

  /* trail: shrinking dim circles, oldest first */
  for (var i = 0; i < trail.length; i++) {
    var t = 1 - (trail.length - i) / (trail.length + 1);
    ctx.circle(Math.round(trail[i][0]), Math.round(trail[i][1]),
               Math.max(2, Math.round(R * 0.5 * t)), '#1E3A55');
  }

  ctx.circle(Math.round(ball.x), Math.round(ball.y), R, '#47E0B1');
  ctx.circle(Math.round(ball.x - R / 3), Math.round(ball.y - R / 3),
             Math.round(R / 4), '#DCECF5');
  ctx.text(8, 6, statusSig(), '#5C7794', 14);
} });

View({ style: {
  width: '100%', height: '100%', background: '#0B1724',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  alignItems: 'center', padding: 40, gap: 8
} }, [scene]);
