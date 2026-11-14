/** Clock — analog dial on one 300x300 Canvas plus digital time/date texts.
 * A 1 s interval copies new Date() into ONE time-of-day signal (seconds since
 * midnight); the canvas effect subscribes to it (it is read inside onDraw), so
 * each second redraws exactly once — one set() triggers one drain. ~105 canvas
 * primitives per redraw, far under the ~100 primitives / 128-slot queue budget. */
var clockTheme = { colors: {
  primary: '#0B0F14', surface: '#141A22', accent: '#2E86FF', text: '#E8EEF6'
}, radius: 14, fontScale: 1 };
lume.theme.set(clockTheme);

var C_FACE = '#141A22';
var C_TEXT = '#E8EEF6';
var C_DIM = '#5C7794';
var C_HAND = '#E8EEF6';
var C_SEC = '#F87171';

/* ---- time state: the only signal the UI subscribes to (s since midnight) ---- */
var todSig = signal(0);

var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tick() {
  var n = new Date();
  todSig.set(n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds());
}
tick();
lume.system.setInterval(tick, 1000);

/* ---- helpers (pure; unit-checked on the host) ---- */
function pad2(v) { return ('0' + v).slice(-2); }
function digital() {
  var t = todSig();
  return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor(t / 60) % 60) + ':' + pad2(t % 60);
}
function dateLine() {
  var n = new Date();
  return DAYS[n.getDay()] + ' ' + MONTHS[n.getMonth()] + ' ' +
         n.getDate() + ' ' + n.getFullYear();
}
/** 0 deg = 12 o'clock, clockwise; returns [x, y] on the canvas. */
function polar(cx, cy, len, deg) {
  var rad = deg * Math.PI / 180;
  return [Math.round(cx + len * Math.sin(rad)), Math.round(cy - len * Math.cos(rad))];
}

/* ---- analog dial (300 px leaves room for the digital line) ---- */
var SIZE = 300;
var CX = SIZE / 2, CY = SIZE / 2;
var FACE_R = 144;
var HAND_H = 66, HAND_M = 108, HAND_S = 122, TAIL = 18;

function drawDial(c) {
  /* read the single signal so the effect redraws on every tick */
  var t = todSig();
  var s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);

  c.clear();
  c.fillColor(C_FACE);
  c.circle(CX, CY, FACE_R, C_FACE);

  /* 60 minor ticks; majors (every 5th) drawn again, thicker */
  for (var i = 0; i < 60; i++) {
    var deg = i * 6;
    var r1 = i % 5 === 0 ? 124 : 132, r2 = 140;
    var a = polar(CX, CY, r1, deg), b = polar(CX, CY, r2, deg);
    if (i % 5 !== 0) c.line(a[0], a[1], b[0], b[1], C_DIM, 1);
    else {
      c.line(a[0], a[1], b[0], b[1], C_HAND, 3);
      c.line(a[0] - 1, a[1], b[0] - 1, b[1], C_HAND, 1); /* thicken */
      c.line(a[0] + 1, a[1], b[0] + 1, b[1], C_HAND, 1);
    }
  }

  /* hands: hour, minute, second (with tail) */
  var hDeg = (h % 12) * 30 + m * 0.5;
  var mDeg = m * 6 + s * 0.1;
  var tip;
  tip = polar(CX, CY, HAND_H, hDeg);
  c.line(CX, CY, tip[0], tip[1], C_HAND, 5);
  c.line(CX - 2, CY, tip[0] - 2, tip[1], C_HAND, 1);
  c.line(CX + 2, CY, tip[0] + 2, tip[1], C_HAND, 1);
  tip = polar(CX, CY, HAND_M, mDeg);
  c.line(CX, CY, tip[0], tip[1], C_HAND, 3);
  tip = polar(CX, CY, HAND_S, s * 6);
  var tail = polar(CX, CY, TAIL, s * 6 + 180);
  c.line(tail[0], tail[1], tip[0], tip[1], C_SEC, 2);
  c.circle(CX, CY, 5, C_SEC);

  /* dial numerals (canvas text is 14 px, UTF-8 <= 63 bytes) */
  for (var n12 = 1; n12 <= 12; n12++) {
    var p = polar(CX, CY, 98, n12 * 30);
    c.text(p[0] - 5, p[1] - 7, String(n12), C_TEXT, 14);
  }
}

/* ---- dial canvas + digital time + date, one column ---- */
View({ style: {
  width: '100%', height: '100%', background: 'primary',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', padding: 40, gap: 8
} }, [
  Canvas({ width: SIZE, height: SIZE, onDraw: drawDial }),
  Text({ text: digital, style: { textAlign: 'center', width: '100%' } }),
  Text({ text: function () { return dateLine(); }, style: { textAlign: 'center', width: '100%', opacity: 0.55 } })
]);
