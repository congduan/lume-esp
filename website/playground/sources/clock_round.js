/* Round clock. 480 logical pixels; all essential marks lie within R=205.
 * On the 466 panel the browser/device scales this centered design. */
var CR_BG = '#050B15', CR_RING = '#244862', CR_TICK = '#88B5C8';
var CR_INK = '#EEF8F8', CR_ACCENT = '#51E0C4', CR_SECOND = '#FF9A77';
function clockAngles(h, m, s) {
  return { hour: (h % 12) * 30 + m * 0.5 + s / 120,
    minute: m * 6 + s * 0.1, second: s * 6 };
}
function clockPolar(r, deg) {
  var a = deg * Math.PI / 180;
  return [Math.round(200 + r * Math.sin(a)), Math.round(200 - r * Math.cos(a))];
}
function clockPad(n) { return ('0' + n).slice(-2); }
function clockDigital(t) { return clockPad(t.h) + ':' + clockPad(t.m) + ':' + clockPad(t.s); }
function clockTime(d) { return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }; }

/* GAME UI */
var clockState = signal(clockTime(new Date()));
function clockTick() { clockState.set(clockTime(new Date())); }
function clockDraw(c) {
  var t = clockState(), a = clockAngles(t.h, t.m, t.s);
  c.clear(); c.fillColor(CR_BG); c.fillRect(0, 0, 400, 400);
  c.arc(200, 200, 186, 0, 360, 2, CR_RING);
  for (var i = 0; i < 60; i++) {
    var major = i % 5 === 0;
    var p = clockPolar(major ? 163 : 173, i * 6), q = clockPolar(182, i * 6);
    c.line(p[0], p[1], q[0], q[1], major ? CR_INK : CR_TICK, major ? 3 : 1);
  }
  var pH = clockPolar(91, a.hour), pM = clockPolar(138, a.minute);
  var pS = clockPolar(153, a.second), tail = clockPolar(23, a.second + 180);
  c.line(200, 200, pH[0], pH[1], CR_INK, 7);
  c.line(200, 200, pM[0], pM[1], CR_ACCENT, 4);
  c.line(tail[0], tail[1], pS[0], pS[1], CR_SECOND, 2);
  c.circle(200, 200, 6, CR_SECOND);
  c.text(185, 105, '12', CR_INK, 14);
  c.text(287, 194, '3', CR_INK, 14);
  c.text(195, 290, '6', CR_INK, 14);
  c.text(102, 194, '9', CR_INK, 14);
}
var clockRoot = View({ style: { width: 480, height: 480, background: CR_BG, scroll: 'none' } });
Canvas({ parent: clockRoot, width: 400, height: 400, onDraw: clockDraw,
  style: { position: 'absolute', x: 40, y: 40 } });
Text({ parent: clockRoot, text: function () { return clockDigital(clockState()); },
  style: { position: 'absolute', x: 137, y: 266, width: 206, height: 36,
    fontSize: 28, color: CR_INK, textAlign: 'center' } });
lume.system.setInterval(clockTick, 1000);
