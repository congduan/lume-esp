/* Four swipeable watch faces. Time is the device's Date clock. */
var WATCHFACE_START_PAGE = 0; /* 0 digital, 1 analog, 2 info rings, 3 activity goals */
var faceTheme = { colors: { primary: '#08121C', bg: '#08121C', surface: '#132435', surfaceAlt: '#1C3449', text: '#F4F8FA', textDim: '#92AAB6', accent: '#40D8B0', danger: '#FF7081', success: '#40D8B0' } };
lume.theme.set(faceTheme);
var faceNow = signal(new Date()), facePage = WATCHFACE_START_PAGE;
var faceSteps = signal(0), faceTimer = null;
var faceBatt = signal(78), faceBattLive = signal(false);
var goalProgress = signal([24, 18, 35]); /* demo percentages; 1 Hz animation */
var goalSteps = 0, goalExerciseSeconds = 0, goalStandSlots = 0, goalLastStandMinute = -1;
var goalMotion = false, goalArmed = true, goalLastStep = 0, goalSampleTimer = null, goalBase = null;
var goalValues = signal([120, 9, 4]);
var goalColors = ['#FF5C70', '#81E46A', '#5ADDE7'];
var goalTracks = ['#48202C', '#25442D', '#1B4048'];
function goalClamp(n) { return Math.max(0, Math.min(100, isFinite(n) ? n : 0)); }
var FACE_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function faceTwo(n) { return ('0' + n).slice(-2); }
function faceTime() { var d = faceNow(); return faceTwo(d.getHours()) + ':' + faceTwo(d.getMinutes()); }
function faceDate() { var d = faceNow(); return (d.getMonth() + 1) + '月' + d.getDate() + '日  ' + FACE_DAYS[d.getDay()]; }
function facePoint(r, deg) { var a = (deg - 90) * Math.PI / 180; return [Math.round(150 + Math.cos(a) * r), Math.round(150 + Math.sin(a) * r)]; }
/* Sample points for a polyline arc. Static pictures upload the points once as
 * a retained path (r49 #6); dynamic progress arcs still rebuild their points
 * per frame via faceArc(). */
function faceArcPoints(from, to, r) {
  var points = []; for (var d = from; d <= to; d += 3) points.push(facePoint(r, d));
  points.push(facePoint(r, to)); return points;
}
function faceArc(c, from, to, r, color, width) { c.polyline(faceArcPoints(from, to, r), color, width); }
function analogDraw(c) {
  var d = faceNow(), h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  c.fillColor('#08121C'); c.fillRect(0, 0, 300, 300);
  c.circle(150, 150, 144, '#1C3449'); c.circle(150, 150, 140, '#08121C');
  /* r49 #6: the 60 tick marks are static geometry, uploaded once as two
   * retained paths (minor / major differ in colour and width) and replayed
   * from C, instead of sampling 60 facePoint()/line() pairs in JS each frame. */
  if (!c.minorTicks) {
    var minor = [], major = [];
    for (var i = 0; i < 60; i++) {
      var a = i * 6, p = facePoint(i % 5 ? 126 : 116, a), q = facePoint(133, a);
      (i % 5 ? minor : major).push([p[0], p[1], q[0], q[1]]);
    }
    c.minorTicks = c.retainSegments(minor, '#667F8B', 1);
    c.majorTicks = c.retainSegments(major, '#E9F5F8', 2);
  }
  c.drawPath(c.minorTicks);
  c.drawPath(c.majorTicks);
  var hp = facePoint(71, (h + m / 60) * 30), mp = facePoint(104, (m + s / 60) * 6), sp = facePoint(116, s * 6);
  c.line(150, 150, hp[0], hp[1], '#F4F8FA', 5);
  c.line(150, 150, mp[0], mp[1], '#F4F8FA', 3);
  c.line(150, 150, sp[0], sp[1], '#FF7081', 2); c.circle(150, 150, 6, '#40D8B0');
}
function ringDraw(c) {
  var d = faceNow(), b = faceBatt(), steps = faceSteps();
  c.fillColor('#08121C'); c.fillRect(0, 0, 300, 300);
  /* r49 #6: the three full background rings are static (~121 segments each,
   * ~360 total); upload them once and replay from C. Retained paths replay the
   * same canvas_line() raster as polyline(), so the picture is unchanged. The
   * three progress arcs depend on battery/steps/seconds and stay per-frame. */
  if (!c.bgRings) {
    c.bgRings = [
      c.retainPath(faceArcPoints(0, 360, 136), '#1C3449', 8),
      c.retainPath(faceArcPoints(0, 360, 111), '#1C3449', 8),
      c.retainPath(faceArcPoints(0, 360, 86), '#1C3449', 8)
    ];
  }
  for (var i = 0; i < c.bgRings.length; i++) c.drawPath(c.bgRings[i]);
  faceArc(c, 0, 360 * b / 100, 136, '#40D8B0', 8);
  faceArc(c, 0, 360 * Math.min(1, steps / 6000), 111, '#F9C66A', 8);
  faceArc(c, 0, d.getSeconds() * 6, 86, '#FF7081', 8);
}
function goalDraw(c) {
  var progress = goalProgress(), radii = [100, 81, 62], width = 16;
  c.fillColor('#08121C'); c.fillRect(0, 0, 220, 220);
  for (var i = 0; i < 3; i++) {
    c.arc(110, 110, radii[i], 270, 630, width, goalTracks[i]);
    /* Native AA op; no JS point sampling. A zero goal has track only. */
    if (progress[i] > 0) c.arc(110, 110, radii[i], 270,
      270 + Math.round(360 * goalClamp(progress[i]) / 100), width, goalColors[i]);
  }
  return { x: 2, y: 2, w: 216, h: 216 }; /* 46,656 of 48,400 canvas pixels */
}
function goalSample() {
  var imu = lume.imu.read();
  if (!imu || !isFinite(imu.ax) || !isFinite(imu.ay) || !isFinite(imu.az)) return;
  var magnitude = Math.sqrt(imu.ax * imu.ax + imu.ay * imu.ay + imu.az * imu.az);
  var moving = Math.abs(magnitude - 9.81) > 1.35, now = Date.now();
  if (!moving) { goalArmed = true; return; }
  if (goalArmed && now - goalLastStep >= 300) {
    if (!goalMotion) goalBase = goalProgress();
    goalSteps++; goalLastStep = now; goalArmed = false; goalMotion = true;
  }
}
function goalTick() {
  var next, values;
  if (goalMotion) {
    if (Date.now() - goalLastStep < 5000) goalExerciseSeconds++;
    var minute = Math.floor(goalExerciseSeconds / 60);
    if (goalExerciseSeconds > 0 && minute !== goalLastStandMinute) { goalStandSlots++; goalLastStandMinute = minute; }
    values = [120 + Math.round(goalSteps * 0.04), 9 + Math.floor(goalExerciseSeconds / 60), 4 + goalStandSlots];
    next = [goalClamp(goalBase[0] + goalSteps / 125), goalClamp(goalBase[1] + goalExerciseSeconds / 18), goalClamp(goalBase[2] + goalStandSlots * 8)];
  } else {
    var old = goalProgress();
    next = [goalClamp(old[0] + 0.8), goalClamp(old[1] + 0.6), goalClamp(old[2] + 0.4)];
    values = [Math.round(next[0] * 5), Math.round(next[1] * 0.5), Math.round(next[2] * 0.12)];
  }
  goalProgress.set(next); goalValues.set(values);
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
var goals = facePanel(); facePages.push(goals);
Text({ parent: goals, text: 'LUME / GOALS', style: { position: 'absolute', x: 32, y: 34, width: 280, height: 24, fontSize: 14, color: 'textDim' } });
var goalCanvas = Canvas({ parent: goals, width: 220, height: 220, style: { position: 'absolute', x: 130, y: 132 }, onDraw: goalDraw });
Text({ parent: goals, text: function () { return faceTime(); }, style: { position: 'absolute', x: 175, y: 198, width: 130, height: 50, textAlign: 'center', fontSize: 32, color: 'text' } });
Text({ parent: goals, text: function () { var v = goalValues(); return v[0] + ' kcal'; }, style: { position: 'absolute', x: 185, y: 249, width: 110, height: 22, textAlign: 'center', fontSize: 14, color: 'danger' } });
Text({ parent: goals, text: function () { var v = goalValues(); return v[1] + ' 分钟 / ' + v[2] + ' 次'; }, style: { position: 'absolute', x: 165, y: 272, width: 150, height: 22, textAlign: 'center', fontSize: 14, color: 'text' } });
Text({ parent: goals, text: function () { return (goalMotion ? 'IMU 步数估算' : 'DEMO 动画') + ' / 电量 ' + faceBatt() + '%' + (faceBattLive() ? '' : ' DEMO'); }, style: { position: 'absolute', x: 60, y: 413, width: 360, height: 24, textAlign: 'center', fontSize: 14, color: 'textDim' } });
function faceShow(n) { facePage = (n + facePages.length) % facePages.length; for (var i = 0; i < facePages.length; i++) lume.setAttr(facePages[i], 5, i === facePage ? 1 : 0); }
function faceSwipe(e) { if (e.dir === 'left') faceShow(facePage + 1); if (e.dir === 'right') faceShow(facePage - 1); }
lume.gesture.on(faceRoot, 'swipe', faceSwipe);
lume.gesture.on(analogCanvas, 'swipe', faceSwipe);
lume.gesture.on(ringCanvas, 'swipe', faceSwipe);
lume.gesture.on(goalCanvas, 'swipe', faceSwipe);
faceShow(facePage);
function faceTick() {
  faceNow.set(new Date());
  var b = lume.pmic.battPercent(); if (typeof b === 'number' && b >= 0 && b <= 100) { faceBattLive.set(true); faceBatt.set(b); }
  var imu = lume.imu.read(); if (imu && Math.abs(imu.ax) + Math.abs(imu.ay) > 1.3) faceSteps.set(faceSteps() + 1);
  goalTick();
}
function faceStart() { faceTick(); if (faceTimer === null) faceTimer = lume.system.setInterval(faceTick, 1000); if (goalSampleTimer === null) goalSampleTimer = lume.system.setInterval(goalSample, 100); }
function faceStop() { if (faceTimer !== null) { lume.system.clearInterval(faceTimer); faceTimer = null; } if (goalSampleTimer !== null) { lume.system.clearInterval(goalSampleTimer); goalSampleTimer = null; } }
lume.app.onStart(faceStart);
lume.app.onPause(faceStop);
lume.app.onResume(faceStart);
