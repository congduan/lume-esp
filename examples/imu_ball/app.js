/** IMU ball: a ball that falls along the device tilt direction. Gravity is
 * taken from lume.imu ax/ay each tick (screen-axis mapping is a board bring-up
 * item; see G_AXIS constants). Without an IMU (host simulator) it falls down. */
var W = 400, H = 400;
var DT = 0.05;            /* 50 ms tick, ~20 fps */
var R = 40;               /* ball radius, px */
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
var pollId = null, paused = false, flatCount = 0;

/* ctx.circle draws only a pen-width ring (no width arg in the JS contract),
 * so a solid ball is filled with per-row fillRect chords. */
function fillCircle(ctx, cx, cy, r, color) {
  ctx.fillColor(color);
  ctx.fillRect(cx - r, cy, r * 2 + 1, 1);
  for (var dy = 1; dy <= r; dy++) {
    var half = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    ctx.fillRect(cx - half, cy - dy, half * 2 + 1, 1);
  }
}

function tick() {
  if (paused) return;
  var s = lume.imu.read();
  var gx, gy;
  if (s) {
    var inplane = Math.sqrt(s.ax * s.ax + s.ay * s.ay);
    if (inplane < 1.0) {
      /* flat board -> in-plane gravity ~0. After ~2 s of flat idle, fall
       * anyway (demo gravity) so the loop is visibly alive on the board. */
      flatCount++;
      gx = 0; gy = flatCount > 40 ? 250 : 0;
    } else {
      flatCount = 0;
      gx = GX(s) * G_SCALE;
      gy = GY(s) * G_SCALE;
    }
    if (frame() % 20 === 0) {
      statusSig.set(flatCount > 40 ? 'idle fall - tilt to steer'
        : flatCount > 0 ? 'flat (' + s.az.toFixed(1) + ' z) - tilt me'
        : 'a ' + s.ax.toFixed(1) + ' / ' + s.ay.toFixed(1));
      lume.log('imu-ball f=' + frame() + ' a=' + s.ax.toFixed(2) +
        ',' + s.ay.toFixed(2) + ',' + s.az.toFixed(2) +
        ' ball=' + Math.round(ball.x) + ',' + Math.round(ball.y));
    }
  } else {
    flatCount = 0;
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

  fillCircle(ctx, Math.round(ball.x), Math.round(ball.y), R, '#47E0B1');
  /* leading frame counter: if this number stops advancing on the board,
   * the timer or the canvas redraw path is stuck, not the physics */
  ctx.text(8, 6, 'f' + frame() + ' ' + statusSig(), '#5C7794', 14);
} });

View({ style: {
  width: '100%', height: '100%', background: '#0B1724',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  alignItems: 'center', padding: 40, gap: 8
} }, [scene]);
