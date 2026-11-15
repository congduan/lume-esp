/* Speedometer UI demonstration. No vehicle speed sensor is connected. */
var SPEED_MODE = 'demo'; /* 'demo', 'imu', or 'manual' */
var speedTheme = { colors: { bg: '#08121C', surface: '#102333', surfaceAlt: '#1B3647', text: '#F1F7FA', textDim: '#8EACB8', accent: '#53E1C4', success: '#53E1C4', danger: '#FF667B', primary: '#08121C' } };
lume.theme.set(speedTheme);
var speedTarget = signal(0); /* In manual mode, external JS can call speedTarget.set(kmH). */
var speedShown = signal(0);
var dialValue = signal(0);
var tripKm = signal(0);
var tripStored = lume.storage.kv.get('drive.trip');
if (typeof tripStored === 'number' && isFinite(tripStored) && tripStored >= 0) tripKm.set(tripStored / 1000);
var speedClock = signal(new Date());
var speedTimer = null, speedLast = Date.now(), speedSave = Date.now(), speedDialLast = Date.now();
function speedClamp(n) { return Math.max(0, Math.min(260, Number(n) || 0)); }
function speedPolar(radius, degree) {
  var a = degree * Math.PI / 180;
  return [Math.round(216 + radius * Math.cos(a)), Math.round(178 + radius * Math.sin(a))];
}
function speedArc(ctx, from, to, radius, color, width) {
  var points = [];
  for (var d = from; d <= to; d += 2) points.push(speedPolar(radius, d));
  if ((to - from) % 2) points.push(speedPolar(radius, to));
  ctx.polyline(points, color, width);
}
function speedDraw(ctx) {
  var current = dialValue();
  ctx.fillColor('#08121C'); ctx.fillRect(0, 0, 432, 344);
  speedArc(ctx, 135, 405, 158, '#264454', 4);
  speedArc(ctx, 135, 135 + 270 * 120 / 260, 158, '#53E1C4', 5);
  speedArc(ctx, 135 + 270 * 120 / 260, 135 + 270 * 200 / 260, 158, '#F8C461', 5);
  speedArc(ctx, 135 + 270 * 200 / 260, 405, 158, '#FF667B', 5);
  for (var v = 0; v <= 260; v += 10) {
    var angle = 135 + v * 270 / 260;
    var major = v % 20 === 0;
    var p = speedPolar(major ? 139 : 145, angle), q = speedPolar(152, angle);
    ctx.line(p[0], p[1], q[0], q[1], major ? '#C9DAE1' : '#55717F', major ? 2 : 1);
  }
  for (var label = 0; label <= 260; label += 40) {
    var t = speedPolar(119, 135 + label * 270 / 260);
    ctx.text(t[0] - (label >= 100 ? 12 : 8), t[1] - 7, String(label), '#8EACB8', 14);
  }
  var tip = speedPolar(128, 135 + current * 270 / 260);
  ctx.line(216, 178, tip[0], tip[1], '#F1F7FA', 4);
  ctx.circle(216, 178, 9, '#53E1C4');
  ctx.circle(216, 178, 4, '#08121C');
}
function speedTick() {
  var now = Date.now(), dt = Math.min(100, Math.max(0, now - speedLast)); speedLast = now;
  if (SPEED_MODE === 'demo') speedTarget.set(Math.round(130 + 130 * Math.sin(now / 2100)));
  else if (SPEED_MODE === 'imu') {
    var sample = lume.imu.read();
    if (sample) speedTarget.set(speedClamp(Math.round(Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay) * 130)));
  }
  var old = speedShown(), next = old + (speedClamp(speedTarget()) - old) * Math.min(1, dt / 180);
  if (Math.abs(next - old) > 0.05) speedShown.set(next);
  if (now - speedDialLast >= 100) { dialValue.set(next); speedDialLast = now; }
  tripKm.set(tripKm() + next * dt / 3600000);
  if (now - speedSave > 10000) { lume.storage.kv.set('drive.trip', Math.round(tripKm() * 1000)); speedSave = now; }
  if (now - speedClock().getTime() >= 1000) speedClock.set(new Date());
}
View({ style: { width: '100%', height: '100%', background: 'bg', scroll: 'none' } }, [
  Text({ text: 'LUME DRIVE', style: { position: 'absolute', x: 32, y: 24, width: 200, height: 32, color: 'textDim', fontSize: 14 } }),
  Text({ text: function () { var d = speedClock(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }, style: { position: 'absolute', x: 352, y: 24, width: 96, height: 32, textAlign: 'right', color: 'textDim', fontSize: 14 } }),
  Canvas({ width: 432, height: 344, style: { position: 'absolute', x: 24, y: 64 }, onDraw: speedDraw }),
  Text({ text: function () { return String(Math.round(speedShown())); }, style: { position: 'absolute', x: 144, y: 244, width: 192, height: 64, textAlign: 'center', color: 'text', fontSize: 48 } }),
  Text({ text: 'km/h', style: { position: 'absolute', x: 176, y: 306, width: 128, height: 24, textAlign: 'center', color: 'textDim', fontSize: 14 } }),
  View({ style: { position: 'absolute', x: 24, y: 396, width: 432, height: 60, background: 'surface', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'row', justifyContent: 'space-between' } }, [
    Text({ text: 'TRIP', style: { color: 'textDim', fontSize: 14, width: 92 } }),
    Text({ text: function () { return tripKm().toFixed(2) + ' km'; }, style: { color: 'text', fontSize: 20, textAlign: 'right', width: 180 } })
  ])
]);
lume.app.onStart(function () { if (speedTimer === null) { speedLast = Date.now(); speedTimer = lume.system.setInterval(speedTick, 20); } });
lume.app.onPause(function () { if (speedTimer !== null) { lume.system.clearInterval(speedTimer); speedTimer = null; } lume.storage.kv.set('drive.trip', Math.round(tripKm() * 1000)); });
lume.app.onResume(function () { if (speedTimer === null) { speedLast = Date.now(); speedTimer = lume.system.setInterval(speedTick, 20); } });
