/** LUME HUB — canvas-first demo, pure JS on the existing API (no firmware
 * change). One 400x360 Canvas renders three pages; three buttons and a swipe
 * gesture switch between them.
 *
 *   page 0  GAUGE   battery ring + power/temperature readouts
 *   page 1  TRACE   live 3-axis accelerometer strip chart (5 Hz)
 *   page 2  SYSTEM  device inventory + radio/storage state
 *
 * Canvas is the only drawing surface available to apps besides Views (and its
 * text is fixed at 14 px), so the "professional" look comes from layering:
 * recessed dial faces, thin tracks, round-capped arcs and hairline grids.
 *
 * MESSAGE BUDGET: each canvasDraw() is one message on the 128-slot UI queue and
 * the canvas redraws on every publish(), so every page is kept under ~100
 * primitives. polyline() expands to one line per point pair, hence the strict
 * point counts below. */
var hubTheme = { colors: {
  primary: '#060B12',
  surface: '#101B27',
  accent: '#2563EB',
  text: '#E6F0FA'
}, radius: 10, fontScale: 1 };
lume.theme.set(hubTheme);

var SAFE = 40;
var W = 400;
var H = 360;
var TRACE_POINTS = 24;

var C_TEXT = '#E6F0FA';
var C_DIM = '#5C7794';
var C_TRACK = '#1B3145';
var C_FACE = '#0F1E2C';
var C_RED = '#F87171';
var C_GREEN = '#34D399';
var C_BLUE = '#38BDF8';
var C_AMBER = '#FBBF24';

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function num(v, digits) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return '--';
  return v.toFixed(digits);
}
function polarX(cx, r, deg) { return Math.round(cx + r * Math.cos(deg * Math.PI / 180)); }
function polarY(cy, r, deg) { return Math.round(cy + r * Math.sin(deg * Math.PI / 180)); }

/* polyline() emits one line per adjacent point pair, so `step` is a direct
 * message cost: 5 deg is smooth, 10 deg is fine for a dim background ring. */
function arc(ctx, cx, cy, r, startDeg, endDeg, color, width, step) {
  var inc = step || 10;
  var pts = [];
  for (var a = startDeg; a <= endDeg; a += inc) {
    pts.push([polarX(cx, r, a), polarY(cy, r, a)]);
  }
  if (pts.length > 1) ctx.polyline(pts, color, width);
}

var CHARGE_STATES = ['trickle', 'pre-charge', 'CC', 'CV', 'done', 'idle'];
var NET_STATES = ['idle', 'joining', 'linked', 'got ip'];
var BLE_STATES = ['idle', 'adv', 'linked'];

/* Single view model: every publish() replaces it, which redraws the canvas and
 * repaints the tab highlight in one shot. */
var view = signal({
  page: 0,
  pct: 0, volts: '--', vbus: '--', charge: '--', temp: '--', uptime: '0s',
  ax: 0, ay: 0, az: 0,
  trace: [],
  info: []
});

var currentPage = 0;
var buf = [];
var lastAx = 0, lastAy = 0, lastAz = 0;
var startedMs = lume._nowMs();
var timer = null;
var tick = 0;

/* Hardware page key: the board's BOOT button sits on GPIO0 and reads low while
 * pressed. Polled from the same 200 ms loop (that is the debounce), and only
 * the 1->0 edge advances the page, so holding it down does not spin through
 * pages. */
var BTN_PIN = 0;
var btnLast = 1;
var btnReady = lume.gpio.setPin(BTN_PIN, 0, 1) === 0;
var bleProbed = false;
var bleReady = false;
var radioText = 'off';
var storageText = '--';

/* --- canvas ------------------------------------------------------------- */

/* Full-bleed backdrop: the panel is 480x480 and the canvas only covers the
 * 400x360 content area, so without this the inset showed the screen's own
 * black. Created first so it stays the bottom-most node. */
View({ style: { x: 0, y: 0, width: 480, height: 480, background: '#0B1622',
  borderWidth: 0, borderRadius: 0 } });

var canvas = Canvas({ width: W, height: H, style: { x: SAFE, y: SAFE, borderRadius: 0 },
  onDraw: function (ctx) {
    var v = view();
    ctx.clear();
    ctx.fillColor('#0B1622');
    ctx.fillRect(0, 0, W, H);
    if (v.page === 1) drawTrace(ctx, v);
    else if (v.page === 2) drawSystem(ctx, v);
    else drawGauge(ctx, v);
  } });

function drawGauge(ctx, v) {
  var cx = 112, cy = 132, r = 64;
  ctx.text(16, 8, 'BATTERY', C_DIM, 14);

  /* recessed dial face + tick ring */
  for (var t = 0; t < 5; t++) {
    var deg = 135 + 270 * t / 4;
    ctx.fillColor(t === 0 || t === 4 ? '#3E6484' : '#24405A');
    ctx.fillRect(polarX(cx, r + 11, deg) - 1, polarY(cy, r + 11, deg) - 1, 3, 3);
  }
  ctx.circle(cx, cy, r, C_TRACK);
  ctx.circle(cx, cy, r - 2, C_TRACK);
  ctx.circle(cx, cy, r - 4, C_TRACK);

  var pct = clamp(v.pct, 0, 100);
  var sweep = 270 * pct / 100;
  if (sweep > 1) {
    var color = pct >= 60 ? C_GREEN : pct >= 25 ? C_AMBER : C_RED;
    arc(ctx, cx, cy, r, 135, 135 + sweep, color, 6, 3);
    ctx.circle(polarX(cx, r, 135), polarY(cy, r, 135), 4, color);
    ctx.circle(polarX(cx, r, 135 + sweep), polarY(cy, r, 135 + sweep), 4, color);
  }
  ctx.text(cx - 20, cy - 18, Math.round(pct) + '%', C_TEXT, 14);
  ctx.text(cx - 24, cy + 4, v.volts, '#8FA6BC', 14);

  /* readout column */
  ctx.text(248, 44, 'TEMP', C_DIM, 14);
  ctx.text(248, 62, v.temp, C_TEXT, 14);
  ctx.text(248, 96, 'VBUS', C_DIM, 14);
  ctx.text(248, 114, v.vbus, C_TEXT, 14);
  ctx.text(248, 148, 'CHARGER', C_DIM, 14);
  ctx.text(248, 166, v.charge, C_TEXT, 14);
  ctx.text(248, 200, 'UPTIME', C_DIM, 14);
  ctx.text(248, 218, v.uptime, C_TEXT, 14);

  /* hairline separator + 3-axis strip */
  ctx.line(16, 268, W - 16, 268, '#1B3145', 1);
  ctx.text(16, 282, 'ACCEL', C_DIM, 14);
  ctx.text(16, 316, 'X ' + v.ax.toFixed(2), C_RED, 14);
  ctx.text(136, 316, 'Y ' + v.ay.toFixed(2), C_GREEN, 14);
  ctx.text(256, 316, 'Z ' + v.az.toFixed(2), C_BLUE, 14);

  /* miniature bar for each axis, centred on zero */
  var baseY = 300, pick = [v.ax, v.ay, v.az], cols = [C_RED, C_GREEN, C_BLUE];
  for (var i = 0; i < 3; i++) {
    var h = clamp(Math.round(pick[i] * 3), -26, 26);
    ctx.fillColor(cols[i]);
    ctx.fillRect(20 + i * 120, h >= 0 ? baseY - h : baseY, 100, Math.abs(h) || 1);
  }
}

function drawTrace(ctx, v) {
  var x0 = 44, y0 = 44, width = 340, height = 200;
  var mid = y0 + height / 2;
  ctx.text(16, 8, 'ACCEL TRACE', C_DIM, 14);
  ctx.text(300, 8, '5 Hz / +-10', '#2E4761', 14);

  /* hairline grid */
  for (var g = 0; g <= 4; g++) {
    var gy = Math.round(y0 + height * g / 4);
    ctx.line(x0, gy, x0 + width, gy, g === 2 ? '#2A4661' : '#16283A', 1);
  }
  for (var gx = 0; gx <= 4; gx++) {
    var xx = Math.round(x0 + width * gx / 4);
    ctx.line(xx, y0, xx, y0 + height, '#16283A', 1);
  }

  var data = v.trace;
  if (data.length > 1) {
    var series = [
      { key: 0, color: C_RED },
      { key: 1, color: C_GREEN },
      { key: 2, color: C_BLUE }
    ];
    for (var s = 0; s < series.length; s++) {
      var pts = [];
      for (var i = 0; i < data.length; i++) {
        pts.push([
          Math.round(x0 + width * i / (TRACE_POINTS - 1)),
          Math.round(mid - clamp(data[i][series[s].key] * 9, -100, 100))
        ]);
      }
      if (pts.length > 1) ctx.polyline(pts, series[s].color, 2);
      var last = pts[pts.length - 1];
      ctx.circle(last[0], last[1], 3, series[s].color);
    }
  }

  /* legend with live values */
  ctx.text(16, 268, 'X ' + v.ax.toFixed(2), C_RED, 14);
  ctx.text(120, 268, 'Y ' + v.ay.toFixed(2), C_GREEN, 14);
  ctx.text(224, 268, 'Z ' + v.az.toFixed(2), C_BLUE, 14);
  ctx.text(16, 300, 'samples ' + data.length + ' / ' + TRACE_POINTS, C_DIM, 14);
  ctx.text(16, 330, 'swipe left / right to change page', '#2E4761', 14);
}

function drawSystem(ctx, v) {
  ctx.text(16, 8, 'SYSTEM', C_DIM, 14);
  ctx.text(16, 26, 'runtime inventory', '#2E4761', 14);
  var rows = v.info;
  for (var i = 0; i < rows.length; i++) {
    var y = 62 + i * 30;
    ctx.text(16, y, rows[i][0], C_DIM, 14);
    ctx.text(200, y, rows[i][1], C_TEXT, 14);
    if (i < rows.length - 1) ctx.line(16, y + 20, W - 16, y + 20, '#16283A', 1);
  }
}

/* --- data --------------------------------------------------------------- */

function readSlow() {
  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var vbus = lume.pmic.vbusVoltageMv();
  var usb = lume.pmic.usbConnected();
  var charge = lume.pmic.chargingStatus();
  var raw = lume.pmic.dieTempRaw();

  var net = lume.net.status();
  var netText = 'off';
  var ipText = '--';
  if (typeof net === 'object' && net !== null) {
    netText = NET_STATES[net.state] || ('state ' + net.state);
    if (net.ip !== null && net.ip !== undefined) ipText = String(net.ip);
  }

  if (!bleProbed) {
    bleProbed = true;
    var probe = lume.ble.status();
    bleReady = typeof probe === 'object' && probe !== null;
    radioText = bleReady ? (BLE_STATES[probe.state] || 'state') : 'off';
  } else if (bleReady) {
    var ble = lume.ble.status();
    if (typeof ble === 'object' && ble !== null) radioText = BLE_STATES[ble.state] || 'state';
  }

  var mounted = lume.storage.Fs.mounted();
  var keys = lume.storage.kv.keys();
  storageText = (mounted === true ? 'fs ok' : 'fs --') +
    (typeof keys === 'object' && keys !== null ? ' ' + keys.length + ' kv' : '');

  var shownPct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
  var voltsText = num(mv, 0) === '--' ? '--' : (mv / 1000).toFixed(2) + ' V';
  var vbusText = usb === 1 ? (vbus < 0 ? '--' : (vbus / 1000).toFixed(2) + ' V') : 'none';
  var chargeText = charge < 0 ? '--' : (CHARGE_STATES[charge] || ('st ' + charge));
  var tempText = raw < 0 ? '--' : (22 + (7274 - raw) / 20).toFixed(1) + ' C';

  slow.pct = shownPct;
  slow.volts = voltsText;
  slow.vbus = vbusText;
  slow.charge = chargeText;
  slow.temp = tempText;
  slow.info = [
    ['SOC', 'ESP32-S3'],
    ['FLASH', '16 MB'],
    ['PSRAM', '8 MB'],
    ['WIFI', netText],
    ['IP', ipText],
    ['BLE', radioText],
    ['STORAGE', storageText],
    ['TEMP', tempText],
    ['UPTIME', Math.floor((lume._nowMs() - startedMs) / 1000) + 's']
  ];
}
var slow = { pct: 0, volts: '--', vbus: '--', charge: '--', temp: '--', info: [] };

function publish() {
  view.set({
    page: currentPage,
    pct: slow.pct, volts: slow.volts, vbus: slow.vbus,
    charge: slow.charge, temp: slow.temp,
    uptime: Math.floor((lume._nowMs() - startedMs) / 1000) + 's',
    ax: lastAx, ay: lastAy, az: lastAz,
    trace: buf.slice(),
    info: slow.info
  });
}

function loop() {
  tick++;
  var sample = lume.imu.read();
  if (sample) {
    lastAx = sample.ax; lastAy = sample.ay; lastAz = sample.az;
    if (currentPage === 1) {
      buf.push([sample.ax, sample.ay, sample.az]);
      if (buf.length > TRACE_POINTS) buf.shift();
    }
  }
  if (btnReady) {
    var level = lume.gpio.read(BTN_PIN);
    if (level === 0 && btnLast === 1) go((currentPage + 1) % 3);
    if (level === 0 || level === 1) btnLast = level;
  }
  if (tick % 2 === 0) readSlow();          /* PMIC / radio / storage at 2 Hz */
  if (currentPage === 1 || tick % 3 === 0) publish();
}

function go(page) {
  currentPage = page;
  if (page === 1) {
    buf = [];
    for (var i = 0; i < 6; i++) buf.push([0, 0, 0]);
  }
  publish();
}

function start() {
  if (timer !== null) return;
  readSlow();
  publish();
  timer = lume.system.setInterval(loop, 200);
}

function stop() {
  if (timer === null) return;
  lume.system.clearInterval(timer);
  timer = null;
}

lume.app.onStart(start);
lume.app.onPause(stop);
lume.app.onResume(start);

/* swipe anywhere on the canvas to move between pages */
lume.gesture.on(canvas, 'swipe', function (e) {
  if (e.dir === 'left') go((currentPage + 1) % 3);
  else if (e.dir === 'right') go((currentPage + 2) % 3);
});

/* --- tab bar ------------------------------------------------------------ */

function tab(x, index, label) {
  return Button({ title: label, style: {
    x: x, y: 404, width: 128, height: 36,
    background: function () { return view().page === index ? 'accent' : 'surface'; },
    borderColor: '#22405A', borderWidth: 1, borderRadius: 10
  }, onPress: function () { go(index); } });
}

tab(SAFE, 0, 'GAUGE');
tab(176, 1, 'TRACE');
tab(312, 2, 'SYSTEM');
