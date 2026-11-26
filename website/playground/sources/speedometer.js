/* Speedometer UI demonstration. No vehicle speed sensor is connected.
 *
 * Redraw strategy (the board's JS engine is slow: one dial layer costs ~86 ms to
 * build, so repainting it every frame cannot keep up with the 20 ms tick):
 *   - the dial (background arc, colour bands, ticks, labels) is painted once,
 *   - later frames repaint only the needle and return one dirty rectangle that
 *     covers the old and the new needle, so the bridge publishes a few KB
 *     instead of the whole 432x344 canvas.
 * The needle never reaches the ticks (r=128 vs r=139..152) and the dial labels
 * are Text widgets, so the canvas interior (r < 135) holds nothing but the
 * background, the needle and the hub: clearing the needle box cannot erase
 * static dial content. */
var SPEED_MODE = 'demo'; /* 'demo', 'imu', or 'manual' */
var speedTheme = { colors: { bg: '#0D1420', surface: '#16202E', surfaceAlt: '#1F2C3D', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', success: '#40D8B0', danger: '#FF6B79', primary: '#0D1420' } };
lume.theme.set(speedTheme);
var speedTarget = signal(0); /* In manual mode, external JS can call speedTarget.set(kmH). */
var speedShown = signal(0);
var dialValue = signal(0);
var tripKm = signal(0);
var tripStored = lume.storage.kv.get('drive.trip');
if (typeof tripStored === 'number' && isFinite(tripStored) && tripStored >= 0) tripKm.set(tripStored / 1000);
var speedClock = signal(new Date());
var speedTimer = null, speedLast = Date.now(), speedSave = Date.now(), speedDialLast = Date.now();
var DIAL_W = 432, DIAL_H = 344, DIAL_CX = 216, DIAL_CY = 178, DIAL_BG = '#08121C';
var NEEDLE_R = 128, HUB_R = 9, NEEDLE_PAD = 3;
function speedClamp(n) { return Math.max(0, Math.min(260, Number(n) || 0)); }
function speedPolar(radius, degree) {
  var a = degree * Math.PI / 180;
  return [Math.round(DIAL_CX + radius * Math.cos(a)), Math.round(DIAL_CY + radius * Math.sin(a))];
}
function speedAngle(kmH) { return 135 + kmH * 270 / 260; }
/* r48: the dial arcs (background track + three colour bands) are one native
 * ctx.arc call each — exact annulus geometry, AA edges and round caps rendered
 * in C, so the dial no longer samples ~276 polyline segments in JS. Angles are
 * the same speedAngle() degrees; the needle and ticks still use line/circle. */
function speedArc(ctx, from, to, radius, color, width) {
  ctx.arc(DIAL_CX, DIAL_CY, radius, from, to, width, color);
}
/* One-off layer: everything that does not depend on the needle position. */
function speedDialLayer(ctx) {
  ctx.fillColor(DIAL_BG); ctx.fillRect(0, 0, DIAL_W, DIAL_H);
  speedArc(ctx, 135, 405, 158, '#264454', 4);
  speedArc(ctx, 135, speedAngle(120), 158, '#53E1C4', 5);
  speedArc(ctx, speedAngle(120), speedAngle(200), 158, '#F8C461', 5);
  speedArc(ctx, speedAngle(200), 405, 158, '#FF667B', 5);
  for (var v = 0; v <= 260; v += 10) {
    var major = v % 20 === 0;
    var p = speedPolar(major ? 139 : 145, speedAngle(v)), q = speedPolar(152, speedAngle(v));
    ctx.line(p[0], p[1], q[0], q[1], major ? '#C9DAE1' : '#55717F', major ? 2 : 1);
  }
}
/* Dial labels are widgets, not canvas text: they sit at r=119, inside the
 * needle's sweep, so the needle's dirty rect has to be free to erase there. */
function speedLabelWidgets() {
  var out = [];
  for (var label = 0; label <= 260; label += 40) {
    var t = speedPolar(119, speedAngle(label));
    out.push(Text({
      text: String(label),
      style: {
        position: 'absolute',
        x: 24 + t[0] - (label >= 100 ? 12 : 8),
        y: 64 + t[1] - 8,
        width: 48, height: 18,
        borderRadius: 0, color: 'textDim', fontSize: 14
      }
    }));
  }
  return out;
}
function speedNeedle(ctx, kmH) {
  var tip = speedPolar(NEEDLE_R, speedAngle(kmH));
  ctx.line(DIAL_CX, DIAL_CY, tip[0], tip[1], '#F1F7FA', 4);
  ctx.circle(DIAL_CX, DIAL_CY, HUB_R, '#53E1C4');
  ctx.circle(DIAL_CX, DIAL_CY, 4, DIAL_BG);
}
/* Bounding box of one needle pose, hub included: what a frame has to repaint. */
function speedNeedleBox(kmH) {
  var tip = speedPolar(NEEDLE_R, speedAngle(kmH));
  var x1 = Math.min(DIAL_CX - HUB_R, tip[0]) - NEEDLE_PAD;
  var y1 = Math.min(DIAL_CY - HUB_R, tip[1]) - NEEDLE_PAD;
  var x2 = Math.max(DIAL_CX + HUB_R, tip[0]) + NEEDLE_PAD;
  var y2 = Math.max(DIAL_CY + HUB_R, tip[1]) + NEEDLE_PAD;
  if (x1 < 0) x1 = 0;
  if (y1 < 0) y1 = 0;
  if (x2 > DIAL_W) x2 = DIAL_W;
  if (y2 > DIAL_H) y2 = DIAL_H;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
var speedDialDrawn = false, speedLastBox = null;
function speedDraw(ctx) {
  var current = dialValue(), box = speedNeedleBox(current);
  if (!speedDialDrawn) {
    speedDialDrawn = true;
    speedDialLayer(ctx);
    speedNeedle(ctx, current);
    speedLastBox = box;
    return;                     /* first frame: repaint the whole canvas */
  }
  /* Two rects, not one union: the bounding box of a rotating needle is not its
   * swept area, and the union of two boxes ~90 deg apart reaches r=185 - past
   * the ticks (139) and into the colour bands (155). Each box alone stays
   * within r<132, where the canvas holds nothing but background and the hub. */
  var prev = speedLastBox;
  speedLastBox = box;
  var moved = prev && (prev.x !== box.x || prev.y !== box.y || prev.w !== box.w || prev.h !== box.h);
  var areas = moved ? [prev, box] : [box];
  ctx.fillColor(DIAL_BG);
  for (var i = 0; i < areas.length; i++) {
    ctx.fillRect(areas[i].x, areas[i].y, areas[i].w, areas[i].h);
  }
  speedNeedle(ctx, current);
  return areas;
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
/* r201: HUD/footer inside the 480-round safe square; dial canvas + needle
   physics stay unchanged. Canvas is created first so the HUD Texts stack above it. */
var speedChildren = [
  Canvas({ width: DIAL_W, height: DIAL_H, style: { position: 'absolute', x: 24, y: 64 }, onDraw: speedDraw }),
  Text({ text: 'LUME DRIVE', style: { position: 'absolute', x: 84, y: 80, width: 200, height: 24, borderRadius: 0, color: 'textDim', fontSize: 14 } }),
  Text({ text: function () { var d = speedClock(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }, style: { position: 'absolute', x: 296, y: 80, width: 100, height: 24, textAlign: 'right', borderRadius: 0, color: 'textDim', fontSize: 14 } })
];
speedChildren = speedChildren.concat(speedLabelWidgets()).concat([
  Text({ text: function () { return String(Math.round(speedShown())); }, style: { position: 'absolute', x: 144, y: 244, width: 192, height: 64, textAlign: 'center', borderRadius: 0, color: 'text', fontSize: 48 } }),
  Text({ text: 'km/h', style: { position: 'absolute', x: 176, y: 306, width: 128, height: 24, textAlign: 'center', borderRadius: 0, color: 'textDim', fontSize: 14 } }),
  View({ style: { position: 'absolute', x: 84, y: 352, width: 312, height: 48, background: 'surface', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'row', justifyContent: 'space-between' } }, [
    Text({ text: 'TRIP', style: { color: 'textDim', fontSize: 14, width: 92 } }),
    Text({ text: function () { return tripKm().toFixed(2) + ' km'; }, style: { color: 'text', fontSize: 20, textAlign: 'right', width: 180 } })
  ])
]);
View({ style: { width: '100%', height: '100%', background: 'bg', scroll: 'none' } }, speedChildren);
lume.app.onStart(function () { if (speedTimer === null) { speedLast = Date.now(); speedTimer = lume.system.setInterval(speedTick, 20); } });
lume.app.onPause(function () { if (speedTimer !== null) { lume.system.clearInterval(speedTimer); speedTimer = null; } lume.storage.kv.set('drive.trip', Math.round(tripKm() * 1000)); });
lume.app.onResume(function () { if (speedTimer === null) { speedLast = Date.now(); speedTimer = lume.system.setInterval(speedTick, 20); } });
