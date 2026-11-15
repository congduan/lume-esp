/* Three swipeable watch faces. Time is the device's Date clock. */
var WATCHFACE_START_PAGE = 0; /* 0 digital, 1 analog, 2 rings; useful for captures */
var faceTheme = { colors: { primary: '#08121C', bg: '#08121C', surface: '#132435', surfaceAlt: '#1C3449', text: '#F4F8FA', textDim: '#92AAB6', accent: '#40D8B0', danger: '#FF7081', success: '#40D8B0' } };
lume.theme.set(faceTheme);
var faceNow = signal(new Date()), facePage = WATCHFACE_START_PAGE;
var faceSteps = signal(0), faceTimer = null;
var faceBatt = signal(0);
var FACE_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function faceTwo(n) { return ('0' + n).slice(-2); }
function faceTime() { var d = faceNow(); return faceTwo(d.getHours()) + ':' + faceTwo(d.getMinutes()); }
function faceDate() { var d = faceNow(); return (d.getMonth() + 1) + '月' + d.getDate() + '日  ' + FACE_DAYS[d.getDay()]; }
function facePoint(r, deg) { var a = (deg - 90) * Math.PI / 180; return [Math.round(150 + Math.cos(a) * r), Math.round(150 + Math.sin(a) * r)]; }
function faceArc(c, from, to, r, color, width) {
  var points = []; for (var d = from; d <= to; d += 3) points.push(facePoint(r, d));
  points.push(facePoint(r, to)); c.polyline(points, color, width);
}
function analogDraw(c) {
  var d = faceNow(), h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  c.fillColor('#08121C'); c.fillRect(0, 0, 300, 300);
  c.circle(150, 150, 144, '#1C3449'); c.circle(150, 150, 140, '#08121C');
  for (var i = 0; i < 60; i++) { var a = i * 6, p = facePoint(i % 5 ? 126 : 116, a), q = facePoint(133, a); c.line(p[0], p[1], q[0], q[1], i % 5 ? '#667F8B' : '#E9F5F8', i % 5 ? 1 : 2); }
  var hp = facePoint(71, (h + m / 60) * 30), mp = facePoint(104, (m + s / 60) * 6), sp = facePoint(116, s * 6);
  c.line(150, 150, hp[0], hp[1], '#F4F8FA', 5);
  c.line(150, 150, mp[0], mp[1], '#F4F8FA', 3);
  c.line(150, 150, sp[0], sp[1], '#FF7081', 2); c.circle(150, 150, 6, '#40D8B0');
}
function ringDraw(c) {
  var d = faceNow(), b = faceBatt(), steps = faceSteps();
  c.fillColor('#08121C'); c.fillRect(0, 0, 300, 300);
  faceArc(c, 0, 360, 136, '#1C3449', 8); faceArc(c, 0, 360, 111, '#1C3449', 8); faceArc(c, 0, 360, 86, '#1C3449', 8);
  faceArc(c, 0, 360 * b / 100, 136, '#40D8B0', 8);
  faceArc(c, 0, 360 * Math.min(1, steps / 6000), 111, '#F9C66A', 8);
  faceArc(c, 0, d.getSeconds() * 6, 86, '#FF7081', 8);
}
var faceRoot = View({ style: { width: '100%', height: '100%', background: 'bg', scroll: 'none' } });
var facePages = [];
function facePanel() { return View({ parent: faceRoot, style: { position: 'absolute', x: 0, y: 0, width: 480, height: 480, background: 'bg', scroll: 'none' } }); }
var digital = facePanel(); facePages.push(digital);
Text({ parent: digital, text: 'LUME / DIGITAL', style: { position: 'absolute', x: 32, y: 40, width: 280, height: 24, fontSize: 14, color: 'textDim' } });
Text({ parent: digital, text: function () { return faceTime(); }, style: { position: 'absolute', x: 32, y: 160, width: 416, height: 70, textAlign: 'center', fontSize: 48, color: 'text' } });
Text({ parent: digital, text: function () { return faceDate(); }, style: { position: 'absolute', x: 32, y: 246, width: 416, height: 36, textAlign: 'center', fontSize: 14, color: 'textDim' } });
Canvas({ parent: digital, width: 12, height: 12, style: { position: 'absolute', x: 210, y: 329 }, onDraw: function (c) { c.circle(6, 6, 5, '#40D8B0'); } });
Text({ parent: digital, text: function () { return faceTwo(faceNow().getSeconds()); }, style: { position: 'absolute', x: 228, y: 320, width: 48, height: 32, textAlign: 'left', fontSize: 20, color: 'accent' } });
var analog = facePanel(); facePages.push(analog);
Text({ parent: analog, text: 'LUME / ANALOG', style: { position: 'absolute', x: 32, y: 40, width: 280, height: 24, fontSize: 14, color: 'textDim' } });
var analogCanvas = Canvas({ parent: analog, width: 300, height: 300, style: { position: 'absolute', x: 90, y: 96 }, onDraw: analogDraw });
Text({ parent: analog, text: function () { return faceDate(); }, style: { position: 'absolute', x: 32, y: 407, width: 416, height: 30, textAlign: 'center', fontSize: 14, color: 'textDim' } });
var rings = facePanel(); facePages.push(rings);
Text({ parent: rings, text: 'LUME / ACTIVITY', style: { position: 'absolute', x: 32, y: 40, width: 280, height: 24, fontSize: 14, color: 'textDim' } });
var ringCanvas = Canvas({ parent: rings, width: 300, height: 300, style: { position: 'absolute', x: 90, y: 96 }, onDraw: ringDraw });
Text({ parent: rings, text: function () { return faceTime(); }, style: { position: 'absolute', x: 152, y: 214, width: 176, height: 52, textAlign: 'center', fontSize: 32, color: 'text' } });
Text({ parent: rings, text: function () { return faceBatt() + '%  ·  ' + faceSteps() + ' 步'; }, style: { position: 'absolute', x: 48, y: 409, width: 384, height: 28, textAlign: 'center', fontSize: 14, color: 'textDim' } });
function faceShow(n) { facePage = (n + 3) % 3; for (var i = 0; i < 3; i++) lume.setAttr(facePages[i], 5, i === facePage ? 1 : 0); }
function faceSwipe(e) { if (e.dir === 'left') faceShow(facePage + 1); if (e.dir === 'right') faceShow(facePage - 1); }
lume.gesture.on(faceRoot, 'swipe', faceSwipe);
lume.gesture.on(analogCanvas, 'swipe', faceSwipe);
lume.gesture.on(ringCanvas, 'swipe', faceSwipe);
faceShow(facePage);
function faceTick() {
  faceNow.set(new Date());
  var b = lume.pmic.battPercent(); if (typeof b === 'number' && b >= 0 && b <= 100) faceBatt.set(b);
  var imu = lume.imu.read(); if (imu && Math.abs(imu.ax) + Math.abs(imu.ay) > 1.3) faceSteps.set(faceSteps() + 1);
}
lume.app.onStart(function () { faceTick(); if (faceTimer === null) faceTimer = lume.system.setInterval(faceTick, 1000); });
lume.app.onPause(function () { if (faceTimer !== null) { lume.system.clearInterval(faceTimer); faceTimer = null; } });
lume.app.onResume(function () { faceTick(); if (faceTimer === null) faceTimer = lume.system.setInterval(faceTick, 1000); });
