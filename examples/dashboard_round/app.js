/* Relative heading and bubble level on the QMI8658 six-axis IMU.
 * There is no magnetometer. Check Z sign, board orientation and drift on-device. */
var DR_BG = '#07131D', DR_RING = '#295768', DR_INK = '#E9F5F3';
var DR_MINT = '#62E0BF', DR_AMBER = '#FFD082';
function roundWrap(d) { d = d % 360; return d < 0 ? d + 360 : d; }
function roundIntegrate(h, gz, ms) { return roundWrap(h + gz * ms / 1000); }
function roundNeedle(deg, radius) {
  var a = deg * Math.PI / 180;
  return [Math.round(200 + radius * Math.sin(a)), Math.round(200 - radius * Math.cos(a))];
}
function roundBubble(ax, ay) {
  var x = Math.max(-1, Math.min(1, ax / 9.81));
  var y = Math.max(-1, Math.min(1, ay / 9.81));
  return [Math.round(x * 65), Math.round(y * 43)];
}
function roundSample(s) {
  return s && isFinite(s.ax) && isFinite(s.ay) && isFinite(s.gz) ? s : null;
}

/* GAME UI */
var roundData = signal({ heading: 0, ax: 0, ay: 0, sim: true });
var roundTicks = 0;
function roundTick() {
  var s = null;
  try { if (lume.imu && lume.imu.read) s = roundSample(lume.imu.read()); } catch (e) { s = null; }
  var old = roundData();
  if (s) roundData.set({ heading: roundIntegrate(old.heading, s.gz, 100), ax: s.ax, ay: s.ay, sim: false });
  else {
    roundTicks++;
    roundData.set({ heading: roundWrap(roundTicks * 1.8),
      ax: Math.sin(roundTicks * 0.04) * 2.5, ay: Math.cos(roundTicks * 0.035) * 2,
      sim: true });
  }
}
function roundDraw(c) {
  var d = roundData(), bubble = roundBubble(d.ax, d.ay);
  c.clear(); c.fillColor(DR_BG); c.fillRect(0, 0, 400, 400);
  c.arc(200, 200, 188, 0, 360, 2, DR_RING);
  c.arc(200, 140, 113, 180, 360, 2, DR_RING);
  for (var i = -6; i <= 6; i++) {
    var p = roundNeedle(i * 15, 95), q = roundNeedle(i * 15, 108);
    c.line(p[0], p[1] - 60, q[0], q[1] - 60, DR_INK, i % 3 === 0 ? 3 : 1);
  }
  var tip = roundNeedle(d.heading, 76);
  c.line(200, 140, tip[0], tip[1] - 60, DR_MINT, 5);
  c.circle(200, 140, 5, DR_AMBER);
  c.text(192, 17, 'N', DR_INK, 14);
  c.text(118, 131, 'W', DR_INK, 14);
  c.text(276, 131, 'E', DR_INK, 14);
  c.line(105, 294, 295, 294, DR_RING, 2);
  c.line(200, 244, 200, 344, DR_RING, 2);
  c.arc(200, 294, 76, 0, 360, 2, DR_RING);
  c.circle(200 + bubble[0], 294 + bubble[1], 16, DR_MINT);
  c.circle(200 + bubble[0], 294 + bubble[1], 5, DR_INK);
  c.text(170, 360, 'LEVEL', DR_INK, 14);
}
var roundRoot = View({ style: { width: 480, height: 480, background: DR_BG, scroll: 'none' } });
Canvas({ parent: roundRoot, width: 400, height: 400, onDraw: roundDraw,
  style: { position: 'absolute', x: 40, y: 40 } });
Text({ parent: roundRoot, text: function () { return ('00' + Math.floor(roundData().heading)).slice(-3) + ' DEG'; },
  style: { position: 'absolute', x: 156, y: 222, width: 168, height: 30,
    fontSize: 20, color: DR_INK, textAlign: 'center' } });
Text({ parent: roundRoot, text: function () { return roundData().sim ? 'SIM' : 'REL'; },
  style: { position: 'absolute', x: 322, y: 126, width: 52, height: 22,
    fontSize: 14, color: DR_AMBER, textAlign: 'center' } });
roundTick();
lume.system.setInterval(roundTick, 100);
