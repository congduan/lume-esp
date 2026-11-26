/* INERTIAL HEADING DIAL — NO magnetometer on this board; geographic north is
 * NOT claimed. The QMI8658 here is a six-axis IMU (accelerometer + gyroscope)
 * with no compass sensor; a true magnetic-north / geographic-bearing compass
 * is physically impossible on this hardware. This app is a RELATIVE heading
 * instrument only:
 *   - demo mode animates a synthetic heading (emu/browser default, no IMU);
 *   - IMU mode integrates gyro Z (deg/s) into a relative angle that DRIFTS
 *     without an absolute reference (DRIFT badge warns when this is likely).
 * No "point north", magnetic-north or geographic-bearing promise is made in
 * the UI, README or reports. A real compass needs an external magnetometer
 * firmware round (roadmap P2).
 *
 * Rendering: the static tick ring / cardinal ring are uploaded ONCE via
 * retainSegments/retainPath and replayed from C; only the needle, the rotating
 * heading marker and the dirty-region backdrop are redrawn per frame. The
 * numeric heading is a native Text node — always upright, never rotated with
 * the dial. The retained-path API only translates (drawPath dx/dy), so the
 * tick ring stays fixed while the needle/marker carry the heading; this is an
 * honest adaptation of the "dial turns, digits don't" brief.
 *
 * Conservative global script: var / function only, no import/export. HUD ASCII. */
var CW = 360, CH = 360, CX = 180, CY = 180;
var CANVAS_X = 60, CANVAS_Y = 64;
var BG = '#0A1020', RING = '#2C4468', INNER = '#1C3449', TICK = '#5B7BA8';
var HUB = '#132435', NEEDLE = '#40D8B0', MARK = '#FFD166', INK = '#E9F5FF';
var R_OUT = 162, R_TICK_OUT = 158, R_MAJOR_IN = 132, R_MINOR_IN = 142;
var R_INNER = 126, R_NEEDLE_IN = 58, R_NEEDLE_OUT = 134, R_HUB = 54, R_CARD = 112;
var DEMO_DPS = 18;              /* demo angular speed, degrees per second */
var POLL_MS = 50;               /* engine-drain tick; 20 ms quantised */
var DRIFT_SPUN_DEG = 30;        /* |accumulated IMU spin| before DRIFT badge */
var CARDINALS = ['N', 'E', 'S', 'W'];

/* ---- pure helpers (host-harness visible) ------------------------------- */
function headingWrap(d) { d = d % 360; return d < 0 ? d + 360 : d; }
function demoHeading(ms) { return headingWrap(DEMO_DPS * ms / 1000); }
function integrateHeading(prev, gz, dtMs) { return headingWrap(prev + gz * dtMs / 1000); }
/* Badge means "relative estimate, uncorrected" — shown in IMU mode once the
 * gyro has integrated enough spin for drift to plausibly matter. */
function driftBadge(mode, spunDeg) {
  return mode === 'imu' && Math.abs(spunDeg) > DRIFT_SPUN_DEG ? 'DRIFT' : '';
}
function compassSegments() {
  var segs = [], i, a, ca, sa;
  for (i = 0; i < 36; i++) {
    a = (i * 10 - 90) * Math.PI / 180; ca = Math.cos(a); sa = Math.sin(a);
    var inner = i % 9 === 0 ? R_MAJOR_IN : R_MINOR_IN;
    segs.push([Math.round(CX + inner * ca), Math.round(CY + inner * sa),
               Math.round(CX + R_TICK_OUT * ca), Math.round(CY + R_TICK_OUT * sa)]);
  }
  return segs;                  /* 36 segments (<= 240) */
}
function compassRingPoints(r, n) {
  var pts = [], i, a;
  for (i = 0; i < n; i++) { a = (i * 360 / n) * Math.PI / 180; pts.push([Math.round(CX + r * Math.cos(a)), Math.round(CY + r * Math.sin(a))]); }
  return pts;
}
function compassMode(s) { return s && typeof s.gz === 'number' ? 'imu' : 'demo'; }
var RING_SEGMENTS = compassSegments();

/* APP UI */
var mode = 'demo', heading = 0, demoMs = 0, demoOffset = 0;
var imuHeading = 0, spunDeg = 0, ticks = 0, pollTimer = null;
var rev = signal(0);
var badge = signal('');
var modeLabel = signal('DEMO');
var headingText = signal('000');

function imuRead() {
  if (!lume.imu || typeof lume.imu.read !== 'function') return null;
  try { return lume.imu.read(); } catch (e) { return null; }
}
function publish() {
  heading = headingWrap(heading);
  headingText.set(('00' + Math.floor(heading)).slice(-3));
  badge.set(driftBadge(mode, spunDeg));
  rev.set(rev() + 1);
  if (ticks % 4 === 0) lume.log('COMPASS HDG ' + Math.floor(heading) + ' mode=' + mode);
  ticks++;
}
function setMode(next) {
  if (next === 'imu' && !imuRead()) {
    mode = 'demo'; modeLabel.set('DEMO (no IMU)');
    lume.log('COMPASS FALLBACK demo (no magnetometer / no IMU sample)');
    publish(); return;
  }
  mode = next;
  if (mode === 'imu') {
    imuHeading = heading; spunDeg = 0; modeLabel.set('IMU');
    lume.log('COMPASS MODE imu (relative, drifts)');
  } else {
    demoOffset = 0; modeLabel.set('DEMO');
    lume.log('COMPASS MODE demo');
  }
  publish();
}
function toggleMode() { setMode(mode === 'demo' ? 'imu' : 'demo'); }
function tick() {
  var s;
  if (mode === 'demo') {
    demoMs += POLL_MS;
    heading = headingWrap(demoHeading(demoMs) + demoOffset);
  } else {
    s = imuRead();
    if (!s) { setMode('demo'); return; }   /* no IMU -> honest demo fallback */
    imuHeading = integrateHeading(imuHeading, s.gz, POLL_MS);
    spunDeg += s.gz * POLL_MS / 1000;
    heading = imuHeading;
  }
  publish();
}

/* ---- static ring geometry uploaded ONCE, replayed from C --------------- */
var ringPath = null, innerPath = null, tickPath = null, canvasPainted = false;
var scene = Canvas({ width: CW, height: CH,
  style: { position: 'absolute', x: CANVAS_X, y: CANVAS_Y },
  onDraw: function (ctx) {
    rev();
    if (!canvasPainted) { ctx.fillColor(BG); ctx.fillRect(0, 0, CW, CH); canvasPainted = true; }
    if (ringPath === null) {
      ringPath = ctx.retainPath(compassRingPoints(R_OUT, 120), RING, 2);
      innerPath = ctx.retainPath(compassRingPoints(R_INNER, 90), INNER, 1);
      tickPath = ctx.retainSegments(RING_SEGMENTS, TICK, 2);
    }
    /* clear only the dynamic region; retained ring is replayed, not rebuilt */
    ctx.fillColor(BG); ctx.fillRect(10, 10, CW - 20, CH - 20);
    ctx.drawPath(ringPath); ctx.drawPath(innerPath); ctx.drawPath(tickPath);
    /* upright cardinal letters at fixed N/E/S/W positions */
    var labels = [[CX, CY - R_CARD - 8], [CX + R_CARD + 6, CY - 7],
                  [CX, CY + R_CARD - 7], [CX - R_CARD - 18, CY - 7]];
    for (var i = 0; i < 4; i++) ctx.text(labels[i][0], labels[i][1], CARDINALS[i], INK, 14);
    /* hub masks the needle root so the number stays readable */
    ctx.circle(CX, CY, R_HUB, HUB);
    var a = (heading - 90) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var nx = Math.round(CX + R_NEEDLE_IN * ca), ny = Math.round(CY + R_NEEDLE_IN * sa);
    var ex = Math.round(CX + R_NEEDLE_OUT * ca), ey = Math.round(CY + R_NEEDLE_OUT * sa);
    ctx.line(nx, ny, ex, ey, NEEDLE, 5);
    ctx.circle(CX, CY, 5, MARK);
    ctx.circle(Math.round(CX + R_OUT * ca), Math.round(CY + R_OUT * sa), 5, MARK); /* rotating marker */
    /* Full-canvas dirty rect: the LVGL canvas buffer shows a black rim when a
     * tight 10 px-inset rect leaves the margin unpainted after a refresh.
     * Retained ring replay keeps this cheap; the number stays upright. */
    return [{ x: 0, y: 0, w: CW, h: CH }];
  } });

/* r201: title/subtitle/MODE row inside the 480-round safe square; dial canvas
   and heading math unchanged. The "no magnetometer" disclaimer text is kept. */
var root = View({ style: { width: 480, height: 480, background: '#0D1420', scroll: 'none' } }, [scene]);
Text({ parent: root, text: 'INERTIAL HEADING DIAL', style: { position: 'absolute', x: 84, y: 80,
  width: 312, height: 24, fontSize: 18, borderRadius: 0, color: '#F2F7FB', textAlign: 'center' } });
Text({ parent: root, text: 'relative estimate - no magnetometer (drag to nudge)', style: { position: 'absolute', x: 84, y: 106,
  width: 312, height: 20, fontSize: 11, borderRadius: 0, color: '#9EB3C6', textAlign: 'center' } });
Text({ parent: root, text: function () { return headingText(); }, style: { position: 'absolute',
  x: CANVAS_X + CX - 70, y: CANVAS_Y + CY - 23, width: 140, height: 46,
  borderRadius: 0, fontSize: 32, textAlign: 'center' } });
Text({ parent: root, text: 'DEG', style: { position: 'absolute', x: CANVAS_X + CX - 20, y: CANVAS_Y + CY + 24,
  width: 40, height: 18, borderRadius: 0, fontSize: 12, textAlign: 'center' } });
Button({ parent: root, title: 'MODE', onPress: toggleMode, style: { position: 'absolute', x: 84, y: 348,
  width: 120, height: 48, background: '#1F2C3D', borderRadius: 8, fontSize: 16, color: '#F2F7FB' } });
Text({ parent: root, text: function () { return modeLabel() + (badge() ? '   ' + badge() : ''); },
  style: { position: 'absolute', x: 212, y: 352, width: 184, height: 40,
    borderRadius: 0, fontSize: 14, textAlign: 'left' } });

var dragLastX = null;
lume.gesture.on(scene, 'panstart', function (e) { dragLastX = e.x; });
lume.gesture.on(scene, 'pan', function (e) {
  if (dragLastX === null) return;
  demoOffset = headingWrap(demoOffset + (e.x - dragLastX) * 0.6);
  dragLastX = e.x;
  if (mode === 'demo') { heading = headingWrap(demoHeading(demoMs) + demoOffset); publish(); }
});
lume.gesture.on(scene, 'panend', function () { dragLastX = null; });

lume.app.onStart(function () { if (pollTimer === null) pollTimer = lume.system.setInterval(tick, POLL_MS); });
lume.app.onPause(function () { if (pollTimer !== null) { lume.system.clearInterval(pollTimer); pollTimer = null; } });
lume.app.onResume(function () { if (pollTimer === null) pollTimer = lume.system.setInterval(tick, POLL_MS); });
lume.log('COMPASS READY mode=demo imu=' + (imuRead() ? 'present' : 'absent') + ' demo_dps=' + DEMO_DPS);
if (pollTimer === null) pollTimer = lume.system.setInterval(tick, POLL_MS);
