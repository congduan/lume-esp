/** Device monitor with dashboard gauges: PMIC rails + charger, die
 * temperature, IMU, WiFi/BLE and storage. Every value comes from the lume.*
 * hardware APIs; a sensor that is missing (or returns a negative error code)
 * renders "--" instead of a bogus number.
 *
 * Layout is absolute pixels on the 480x480 round-corner panel: 40 px inset on
 * every edge, 8 px between rows. Every node is a direct child of the screen --
 * nesting them in a width/height:'100%' container shifted them all on the
 * device.
 *
 * BUDGET: every canvasDraw() is one message on the UI queue (128 slots since
 * r28; it was 32, which a dashboard redraw overran)
 * (js_canvas_draw -> lume_ui_bridge_post), and a full queue throws
 * "InternalError: lume: ui queue full" right in the middle of a refresh --
 * leaving half the cards on their initial text. So each gauge redraw stays at
 * ~17 commands and the two gauges ALTERNATE (one per refresh) instead of both
 * repainting at once. polyline() is unusable here: it emits one line per point
 * pair, so arcs are drawn as a dozen fillRect ticks. */
var monitorTheme = { colors: {
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 12, fontScale: 1 };
lume.theme.set(monitorTheme);

/* AXP2101 STATUS2[2:0] charger state (runtime/types/lume.d.ts). */
var CHARGE_STATES = ['trickle', 'pre-charge', 'CC', 'CV', 'done', 'idle'];
var NET_STATES = ['idle', 'joining', 'linked', 'got ip'];
var BLE_STATES = ['idle', 'adv', 'linked'];

var SAFE = 40;
var WIDE = 480 - SAFE * 2;
var GAUGE_W = 196;
var GAUGE_H = 140;
var GAUGE2_X = 244;
var SMALL_W = 128;
var SMALL_X2 = 176;
var SMALL_X3 = 312;

function fixed(value, digits) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) return '--';
  return value.toFixed(digits);
}

function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

/* Smooth arc. polyline() emits one line per adjacent point pair, so the step
 * angle is a direct message cost: 4 degrees (~67 records for 270) is visually
 * smooth, 8-10 degrees is enough for a dim background ring. Queue A is 128 deep
 * and the two gauges alternate, so one redraw stays under ~110 records. */
function arc(ctx, cx, cy, radius, startDeg, endDeg, color, width, step) {
  var inc = step || 6;
  var pts = [];
  for (var a = startDeg; a <= endDeg; a += inc) {
    var rad = a * Math.PI / 180;
    pts.push([Math.round(cx + radius * Math.cos(rad)), Math.round(cy + radius * Math.sin(rad))]);
  }
  if (pts.length > 1) ctx.polyline(pts, color, width);
}

function polarX(cx, radius, deg) { return Math.round(cx + radius * Math.cos(deg * Math.PI / 180)); }
function polarY(cy, radius, deg) { return Math.round(cy + radius * Math.sin(deg * Math.PI / 180)); }

/* One signal per gauge: they are set on alternating refreshes, so a single
 * refresh never emits both redraw bursts. */
var battSig = signal({ pct: 0, volts: '--' });
var tiltSig = signal({ pitch: 0, roll: 0, tilt: 'p 0  r 0' });

var powerLine = signal('reading...');
var accelLine = signal('reading...');
var gyroLine = signal('reading...');
var netLine = signal('reading...');
var tempLine = signal('reading...');
var storeLine = signal('reading...');
var bleLine = signal('reading...');
var uptimeLine = signal('up 0s');

var startedMs = lume._nowMs();
var timer = null;
var refreshCount = 0;
/* lume.ble.status() logs a WARN every call while the NimBLE stack is down, so
 * probe it once and stop polling unless the stack is actually up. */
var bleProbed = false;
var bleReady = false;

/* Background: plain 480x480 View created first so it sits at the bottom and
 * covers the whole panel. Tapping it forces a refresh. */
View({ style: { x: 0, y: 0, width: 480, height: 480, background: 'primary',
    borderWidth: 0, borderRadius: 0 },
  onPress: function () { refresh(); } });

/* Battery gauge: a thin dim track, a rounded 4-degree progress arc with round
 * caps, a recessed dial face, and 12 tick marks outside the ring. */
var battGauge = Canvas({ width: GAUGE_W, height: GAUGE_H, style: { x: SAFE, y: 68 },
  onDraw: function (ctx) {
    var g = battSig();
    var pct = clamp(g.pct, 0, 100);
    var cx = 98, cy = 70, r = 50;
    ctx.clear();
    ctx.fillColor('#0B1622');
    ctx.fillRect(0, 0, GAUGE_W, GAUGE_H);
    ctx.circle(cx, cy, 36, '#0F1E2C');

    /* tick marks every 22.5 degrees, longer at the four cardinal points */
    ctx.fillColor('#2A4560');
    for (var t = 0; t < 8; t++) {
      var deg = 135 + 270 * t / 7;
      var long = (t === 0 || t === 7);
      ctx.fillRect(polarX(cx, r + 10, deg) - 1, polarY(cy, r + 10, deg) - 1,
        long ? 3 : 2, long ? 3 : 2);
    }

    arc(ctx, cx, cy, r, 135, 405, '#1B3145', 4, 10);
    var sweep = 270 * pct / 100;
    if (sweep > 1) {
      var color = pct >= 60 ? '#34D399' : pct >= 25 ? '#FBBF24' : '#F87171';
      arc(ctx, cx, cy, r, 135, 135 + sweep, color, 6, 5);
      ctx.circle(polarX(cx, r, 135), polarY(cy, r, 135), 3, color);
      ctx.circle(polarX(cx, r, 135 + sweep), polarY(cy, r, 135 + sweep), 3, color);
    }
    ctx.text(84, 52, Math.round(pct) + '%', '#FFFFFF', 14);
    ctx.text(78, 74, g.volts, '#8FA6BC', 14);
  } });

/* IMU levelling bubble: pitch drives vertical travel, roll horizontal, over a
 * recessed dial face with hairline cross-hairs and a round rim. */
var tiltGauge = Canvas({ width: GAUGE_W, height: GAUGE_H, style: { x: GAUGE2_X, y: 68 },
  onDraw: function (ctx) {
    var g = tiltSig();
    var cx = 98, cy = 66;
    ctx.clear();
    ctx.fillColor('#0B1622');
    ctx.fillRect(0, 0, GAUGE_W, GAUGE_H);
    ctx.circle(cx, cy, 44, '#0F1E2C');
    arc(ctx, cx, cy, 44, 0, 360, '#1B3145', 2, 10);
    ctx.line(cx - 34, cy, cx + 34, cy, '#25405A', 1);
    ctx.line(cx, cy - 34, cx, cy + 34, '#25405A', 1);
    var bx = Math.round(cx + clamp(g.roll * 1.0, -34, 34));
    var by = Math.round(cy + clamp(g.pitch * 1.0, -34, 34));
    ctx.circle(bx, by, 7, '#38BDF8');
    ctx.circle(bx, by, 3, '#0B1622');
    ctx.text(68, 116, g.tilt, '#8FA6BC', 14);
  } });

/* --- data rows ---------------------------------------------------------- */

function card(x, y, width, label, value) {
  return View({ style: {
    x: x, y: y, width: width, height: 40,
    background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 6, scroll: 'none'
  }, onPress: function () { refresh(); } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}

function refresh() {
  refreshCount++;
  if (refreshCount % 20 === 1) lume.system.log('device_monitor refresh #' + refreshCount);
  try {
    refreshBody();
  } catch (e) {
    /* A thrown native error (e.g. ui queue full) must not silently freeze the
     * remaining cards on their initial text. */
    lume.system.log('device_monitor refresh failed: ' + e);
  }
}

function refreshBody() {
  /* --- PMIC: battery, VBUS, charger state --- */
  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var vbus = lume.pmic.vbusVoltageMv();
  var usb = lume.pmic.usbConnected();
  var charge = lume.pmic.chargingStatus();

  var shownPct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
  var voltsText = fixed(mv, 0) === '--' ? '--' : (mv / 1000).toFixed(2) + ' V';

  var vbusText = usb === 1 ? 'USB ' + (vbus < 0 ? '--' : (vbus / 1000).toFixed(2) + ' V') : 'no VBUS';
  var chargeText = charge < 0 ? '--' : (CHARGE_STATES[charge] || ('state ' + charge));
  powerLine.set(vbusText + '  ' + chargeText);

  /* --- AXP2101 die temperature: degC = 22 + (7274 - raw) / 20 --- */
  var raw = lume.pmic.dieTempRaw();
  tempLine.set(raw < 0 ? '--' : (22 + (7274 - raw) / 20).toFixed(1) + ' C');

  /* --- QMI8658: acceleration, angular rate, tilt for the bubble --- */
  var pitch = 0, roll = 0, tiltText = 'p --  r --';
  var sample = lume.imu.read();
  if (sample) {
    accelLine.set(sample.ax.toFixed(2) + '  ' + sample.ay.toFixed(2) + '  ' + sample.az.toFixed(2));
    gyroLine.set(sample.gx.toFixed(1) + '  ' + sample.gy.toFixed(1) + '  ' + sample.gz.toFixed(1));
    pitch = Math.atan2(sample.ay, Math.sqrt(sample.ax * sample.ax + sample.az * sample.az)) * 180 / Math.PI;
    roll = Math.atan2(-sample.ax, sample.az) * 180 / Math.PI;
    tiltText = 'p ' + pitch.toFixed(0) + '  r ' + roll.toFixed(0);
  } else {
    accelLine.set('IMU unavailable');
    gyroLine.set('--');
  }

  /* Alternating redraws: one gauge per refresh keeps the UI queue well under
   * its 128 slots (arc gauge ~70 messages + 7 text attributes). */
  if (refreshCount % 2 === 1) battSig.set({ pct: shownPct, volts: voltsText });
  else tiltSig.set({ pitch: pitch, roll: roll, tilt: tiltText });

  /* --- WiFi station: state + IPv4 (negative number when the stack is down) --- */
  var net = lume.net.status();
  if (typeof net === 'object' && net !== null) {
    var stateText = NET_STATES[net.state] || ('state ' + net.state);
    netLine.set(stateText + '  ' + (net.ip === null || net.ip === undefined ? '--' : String(net.ip)));
  } else {
    netLine.set('off  --');
  }

  /* --- BLE peripheral: probe once, then only poll when the stack is up --- */
  if (!bleProbed) {
    bleProbed = true;
    var probe = lume.ble.status();
    bleReady = typeof probe === 'object' && probe !== null;
    bleLine.set(bleReady
      ? ((BLE_STATES[probe.state] || ('state ' + probe.state)) + (probe.connected ? '  mtu ' + probe.mtu : ''))
      : 'off');
  } else if (bleReady) {
    var ble = lume.ble.status();
    if (typeof ble === 'object' && ble !== null) {
      bleLine.set((BLE_STATES[ble.state] || ('state ' + ble.state)) +
        (ble.connected ? '  mtu ' + ble.mtu : ''));
    }
  }

  /* --- Storage: LittleFS mount + persisted KV key count --- */
  var mounted = lume.storage.Fs.mounted();
  var keys = lume.storage.kv.keys();
  storeLine.set((mounted === true ? 'fs ok' : 'fs --') +
    (typeof keys === 'object' && keys !== null ? '  ' + keys.length + ' kv' : ''));

  uptimeLine.set('up ' + Math.floor((lume._nowMs() - startedMs) / 1000) + 's');
}

function startPolling() {
  if (timer !== null) return;
  refresh();
  timer = lume.system.setInterval(refresh, 500);
}

function stopPolling() {
  if (timer === null) return;
  lume.system.clearInterval(timer);
  timer = null;
}

lume.app.onStart(startPolling);
lume.app.onPause(stopPolling);
lume.app.onResume(startPolling);

/* --- screen tree: everything is a direct child of the screen ------------- */
Text({ text: 'DEVICE MONITOR', style: { x: SAFE, y: SAFE, width: 230, height: 20 } });
Text({ text: function () { return uptimeLine(); },
  style: { x: 270, y: SAFE, width: 170, height: 20 } });

battGauge;
tiltGauge;

card(SAFE, 216, WIDE, 'Power', function () { return powerLine(); });
card(SAFE, 262, WIDE, 'Accel m/s2', function () { return accelLine(); });
card(SAFE, 308, WIDE, 'Gyro deg/s', function () { return gyroLine(); });
card(SAFE, 354, WIDE, 'WiFi', function () { return netLine(); });

card(SAFE, 400, SMALL_W, 'Temp', function () { return tempLine(); });
card(SMALL_X2, 400, SMALL_W, 'Store', function () { return storeLine(); });
card(SMALL_X3, 400, SMALL_W, 'BLE', function () { return bleLine(); });
