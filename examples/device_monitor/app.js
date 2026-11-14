/** Device monitor: PMIC rails + charger, die temperature, IMU, WiFi/BLE and
 * storage, read from the lume.* hardware APIs.
 *
 * LAYOUT: relative (flex), not absolute pixels. The root is a 100%x100% flex
 * column with `padding: 40` (the round-corner AMOLED safe inset) and
 * `justifyContent: 'space-between'`, so the four edges are produced by the
 * layout engine instead of hand-computed x/y. Rows that hold several items
 * (the two gauges, the three small cards) are nested flex rows with
 * `gap`. Children of a flex parent must NOT set x/y -- LVGL's layout takes
 * over and silently ignores them.
 *
 * Canvas draws into a fixed-size buffer (196x140) because a canvas has an
 * intrinsic pixel size; everything else is sized by the layout. */
var monitorTheme = { colors: {
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 10, fontScale: 1 };
lume.theme.set(monitorTheme);

/* AXP2101 STATUS2[2:0] charger state, NET/BLE state names (runtime/types/lume.d.ts). */
var CHARGE_STATES = ['trickle', 'pre-charge', 'CC', 'CV', 'done', 'idle'];
var NET_STATES = ['idle', 'joining', 'linked', 'got ip'];
var BLE_STATES = ['idle', 'adv', 'linked'];

var SAFE = 40;
var WIDE = 480 - SAFE * 2;
var GAUGE_W = 196;
var GAUGE_H = 140;
var SMALL_W = 128;
var ROW_H = 38;

function fixed(value, digits) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) return '--';
  return value.toFixed(digits);
}
function clamp(value, low, high) {
  return value < low ? low : (value > high ? high : value);
}

var battPct = signal(0);
var battVolts = signal('--');
var powerLine = signal('reading...');
var accelLine = signal('reading...');
var gyroLine = signal('reading...');
var netLine = signal('reading...');
var tempLine = signal('reading...');
var storeLine = signal('reading...');
var bleLine = signal('reading...');
var pitchSig = signal(0);
var rollSig = signal(0);
var tiltLine = signal('p 0  r 0');

var timer = null;
var bleProbed = false;
var bleReady = false;

/* --- gauges (fixed-pixel canvases; the row that holds them is flex) ------ */

function gaugeFrame(ctx, w, h) {
  ctx.clear();
  ctx.fillColor('#0E1B28');
  ctx.fillRect(0, 0, w, h);
  ctx.line(0, 0, w - 1, 0, '#22405A', 1);
  ctx.line(w - 1, 0, w - 1, h - 1, '#22405A', 1);
  ctx.line(w - 1, h - 1, 0, h - 1, '#22405A', 1);
  ctx.line(0, h - 1, 0, 0, '#22405A', 1);
}

var battGauge = Canvas({ width: GAUGE_W, height: GAUGE_H, onDraw: function (ctx) {
  var pct = clamp(battPct(), 0, 100);
  gaugeFrame(ctx, GAUGE_W, GAUGE_H);
  var lit = Math.round(12 * pct / 100);
  var i, rad, px, py;
  ctx.fillColor('#20374D');
  for (i = lit; i < 12; i++) {
    rad = (135 + 270 * i / 11) * Math.PI / 180;
    px = Math.round(98 + 52 * Math.cos(rad));
    py = Math.round(70 + 52 * Math.sin(rad));
    ctx.fillRect(px - 4, py - 4, 9, 9);
  }
  ctx.fillColor(pct >= 60 ? '#34D399' : pct >= 25 ? '#FBBF24' : '#F87171');
  for (i = 0; i < lit; i++) {
    rad = (135 + 270 * i / 11) * Math.PI / 180;
    px = Math.round(98 + 52 * Math.cos(rad));
    py = Math.round(70 + 52 * Math.sin(rad));
    ctx.fillRect(px - 4, py - 4, 9, 9);
  }
  ctx.text(84, 56, Math.round(pct) + '%', '#FFFFFF', 14);
  ctx.text(76, 80, battVolts(), '#9FB6CC', 14);
} });

var tiltGauge = Canvas({ width: GAUGE_W, height: GAUGE_H, onDraw: function (ctx) {
  gaugeFrame(ctx, GAUGE_W, GAUGE_H);
  ctx.fillColor('#20374D');
  for (var i = 0; i < 8; i++) {
    var rad = (i * 45) * Math.PI / 180;
    ctx.fillRect(Math.round(98 + 48 * Math.cos(rad)) - 2,
      Math.round(66 + 48 * Math.sin(rad)) - 2, 5, 5);
  }
  ctx.line(60, 66, 136, 66, '#1B3145', 1);
  ctx.line(98, 28, 98, 104, '#1B3145', 1);
  var bx = Math.round(98 + clamp(rollSig() * 1.1, -40, 40));
  var by = Math.round(66 + clamp(pitchSig() * 1.1, -40, 40));
  ctx.circle(bx, by, 8, '#38BDF8');
  ctx.circle(bx, by, 3, '#08111C');
  ctx.text(66, 118, tiltLine(), '#9FB6CC', 14);
} });

/* --- building blocks ---------------------------------------------------- */

/* A plain data row: label left, value right, both pushed apart by the layout. */
function card(width, label, value) {
  return View({ style: {
    width: width, height: ROW_H,
    background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 6, scroll: 'none'
  }, onPress: function () { refresh(); } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}

function row(children, height, justify) {
  return View({ style: {
    width: '100%', height: height,
    display: 'flex', flexDirection: 'row', gap: 8,
    justifyContent: justify || 'start'
  } }, children);
}

/* --- data --------------------------------------------------------------- */

function refresh() {
  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var vbus = lume.pmic.vbusVoltageMv();
  var usb = lume.pmic.usbConnected();
  var charge = lume.pmic.chargingStatus();

  battPct.set(pct < 0 ? 0 : (pct > 100 ? 100 : pct));
  battVolts.set(fixed(mv, 0) === '--' ? '--' : (mv / 1000).toFixed(2) + ' V');

  var vbusText = usb === 1 ? 'USB ' + (vbus < 0 ? '--' : (vbus / 1000).toFixed(2) + ' V') : 'no VBUS';
  powerLine.set(vbusText + '  ' + (charge < 0 ? '--' : (CHARGE_STATES[charge] || ('state ' + charge))));

  var raw = lume.pmic.dieTempRaw();
  tempLine.set(raw < 0 ? '--' : (22 + (7274 - raw) / 20).toFixed(1) + ' C');

  var sample = lume.imu.read();
  if (sample) {
    accelLine.set(sample.ax.toFixed(2) + '  ' + sample.ay.toFixed(2) + '  ' + sample.az.toFixed(2));
    gyroLine.set(sample.gx.toFixed(1) + '  ' + sample.gy.toFixed(1) + '  ' + sample.gz.toFixed(1));
    var pitch = Math.atan2(sample.ay, Math.sqrt(sample.ax * sample.ax + sample.az * sample.az)) * 180 / Math.PI;
    var roll = Math.atan2(-sample.ax, sample.az) * 180 / Math.PI;
    pitchSig.set(pitch);
    rollSig.set(roll);
    tiltLine.set('p ' + pitch.toFixed(0) + '  r ' + roll.toFixed(0));
  } else {
    accelLine.set('IMU unavailable');
    gyroLine.set('--');
    pitchSig.set(0);
    rollSig.set(0);
    tiltLine.set('p --  r --');
  }

  var net = lume.net.status();
  if (typeof net === 'object' && net !== null) {
    netLine.set((NET_STATES[net.state] || ('state ' + net.state)) + '  ' +
      (net.ip === null || net.ip === undefined ? '--' : String(net.ip)));
  } else {
    netLine.set('off  --');
  }

  /* lume.ble.status() logs a WARN on every call while NimBLE is down: probe once. */
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

  var mounted = lume.storage.Fs.mounted();
  var keys = lume.storage.kv.keys();
  storeLine.set((mounted === true ? 'fs ok' : 'fs --') +
    (typeof keys === 'object' && keys !== null ? '  ' + keys.length + ' kv' : ''));
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

/* --- screen tree: one flex column, no absolute coordinates -------------- */

var screenRoot = View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: SAFE
}, onPress: function () { refresh(); } }, [
  row([battGauge, tiltGauge], GAUGE_H),
  card(WIDE, 'Power', function () { return powerLine(); }),
  card(WIDE, 'Accel m/s2', function () { return accelLine(); }),
  card(WIDE, 'Gyro deg/s', function () { return gyroLine(); }),
  card(WIDE, 'WiFi', function () { return netLine(); }),
  row([
    card(SMALL_W, 'Temp', function () { return tempLine(); }),
    card(SMALL_W, 'Store', function () { return storeLine(); }),
    card(SMALL_W, 'BLE', function () { return bleLine(); })
  ], ROW_H)
]);

lume.gesture.on(screenRoot, 'swipe', function (e) {
});

/* Bottom indicator pill (swipe-up hint). */
View({ style: { width: 64, height: 3, background: '#2E4761', borderRadius: 2 },
  align: 'bottom-mid', alignOffset: { y: -10 } });
