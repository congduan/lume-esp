/** Device monitor: PMIC rails + charger state + die temperature + IMU + uptime.
 * Every value comes from the lume.* hardware APIs; nothing is simulated. A
 * sensor that is missing (or returns a negative error code) renders as "--"
 * instead of a bogus number. */
var monitorTheme = { colors: {
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 12, fontScale: 1 };
lume.theme.set(monitorTheme);

/* AXP2101 STATUS2[2:0] charger state (runtime/types/lume.d.ts). */
var CHARGE_STATES = ['trickle', 'pre-charge', 'CC', 'CV', 'done', 'idle'];

function fixed(value, digits) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) return '--';
  return value.toFixed(digits);
}

var battPct = signal(0);
var battLine = signal('reading...');
var powerLine = signal('reading...');
var tempLine = signal('reading...');
var accelLine = signal('reading...');
var gyroLine = signal('reading...');
var tiltLine = signal('reading...');
var uptimeLine = signal('up 0s');

var startedMs = lume._nowMs();
var timer = null;

var battBar = Canvas({ width: 448, height: 44, style: { x: 16, y: 34, borderRadius: 10 },
  onDraw: function (ctx) {
    var pct = battPct();
    ctx.clear();
    ctx.fillColor('#132436');
    ctx.fillRect(0, 0, 448, 44);
    var width = Math.round(448 * pct / 100);
    if (width > 0) {
      ctx.fillColor(pct >= 60 ? '#2ECC71' : pct >= 25 ? '#F5A623' : '#E74C3C');
      ctx.fillRect(0, 0, width, 44);
    }
    ctx.text(10, 15, 'battery ' + pct + ' %', '#FFFFFF', 14);
  } });

function infoCard(y, label, value) {
  return View({ style: {
    x: 16, y: y, width: 448, height: 46,
    background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 10, scroll: 'none'
  } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}

function refresh() {
  /* --- PMIC: battery, VBUS, charger state --- */
  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var vbus = lume.pmic.vbusVoltageMv();
  var usb = lume.pmic.usbConnected();
  var charge = lume.pmic.chargingStatus();

  var shownPct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
  battPct.set(shownPct);
  battLine.set(fixed(mv, 0) === '--' ? 'unavailable'
    : (mv / 1000).toFixed(2) + ' V  ' + (pct < 0 ? '--' : pct) + ' %');

  var vbusText = usb === 1 ? 'USB ' + (vbus < 0 ? '--' : (vbus / 1000).toFixed(2) + ' V') : 'no VBUS';
  var chargeText = charge < 0 ? '--' : (CHARGE_STATES[charge] || ('state ' + charge));
  powerLine.set(vbusText + '  ' + chargeText);

  /* --- AXP2101 die temperature: degC = 22 + (7274 - raw) / 20 --- */
  var raw = lume.pmic.dieTempRaw();
  tempLine.set(raw < 0 ? 'unavailable' : (22 + (7274 - raw) / 20).toFixed(1) + ' C');

  /* --- QMI8658: linear acceleration + angular rate + tilt angles --- */
  var sample = lume.imu.read();
  if (sample) {
    accelLine.set(sample.ax.toFixed(2) + '  ' + sample.ay.toFixed(2) + '  ' + sample.az.toFixed(2));
    gyroLine.set(sample.gx.toFixed(1) + '  ' + sample.gy.toFixed(1) + '  ' + sample.gz.toFixed(1));
    var pitch = Math.atan2(sample.ay, Math.sqrt(sample.ax * sample.ax + sample.az * sample.az)) * 180 / Math.PI;
    var roll = Math.atan2(-sample.ax, sample.az) * 180 / Math.PI;
    tiltLine.set('pitch ' + pitch.toFixed(0) + '  roll ' + roll.toFixed(0));
  } else {
    accelLine.set('IMU unavailable');
    gyroLine.set('--');
    tiltLine.set('--');
  }

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

View({ style: { width: '100%', height: '100%', background: 'primary',
  display: 'flex', flexDirection: 'column' } }, [
  Text({ text: 'DEVICE MONITOR', style: { x: 16, y: 8, width: 260, height: 20 } }),
  Text({ text: function () { return uptimeLine(); },
    style: { x: 280, y: 8, width: 184, height: 20 } }),
  battBar,
  infoCard(84, 'Battery', function () { return battLine(); }),
  infoCard(136, 'Power', function () { return powerLine(); }),
  infoCard(188, 'SoC temp', function () { return tempLine(); }),
  infoCard(240, 'Accel m/s2', function () { return accelLine(); }),
  infoCard(292, 'Gyro deg/s', function () { return gyroLine(); }),
  infoCard(344, 'Tilt deg', function () { return tiltLine(); }),
  Button({ title: 'Refresh now', style: {
    x: 16, y: 404, width: 448, height: 46,
    background: 'accent', borderColor: '#4FA8F0', borderWidth: 1, borderRadius: 10
  }, onPress: refresh })
]);
