/* Lume r101 aurora clock. One 480x480 RGB565 canvas; 20 Hz animation.
 * Four palette keyframes per theme are expanded once into a lookup table.
 * Each ribbon uses six overlapping ellipses and two overlap-color patches.
 * The clock widgets sit above the canvas and update only on minute changes. */
var AC_W = 480, AC_H = 480, AC_DT = 0.05, AC_IDLE_TICKS = 1200;
var AC_BG = '#030A14', AC_WHITE = '#F4FBFF';
var AC_KEYS = [
  [['#0A2431','#18495A','#347F81','#70BBAE'],['#0D253D','#1D4A6D','#438B9C','#80BFBE'],['#0B2936','#1D5363','#458F89','#83BDAE'],['#11263C','#375270','#658EA9','#A2C9CB']],
  [['#211B37','#48355D','#785C92','#B49AC2'],['#14253E','#364C79','#676DA5','#A7ABD5'],['#261B38','#563D69','#906BA1','#C8A3CA'],['#19273D','#3A5675','#688DAA','#A8C2D4']],
  [['#0A2936','#1B5269','#438D94','#84BEBD'],['#10283E','#285271','#5B96AA','#A0C8D2'],['#102D35','#285C5D','#63968A','#A6C6A8'],['#13283E','#36587B','#6D9DB8','#ABCBD5']]
];
function acClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function acHex(n) { var s = n.toString(16).toUpperCase(); return s.length < 2 ? '0' + s : s; }
function acBlend(a, b, n) {
  var out = '#';
  for (var i = 1; i < 7; i += 2) {
    var x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
    out += acHex(Math.round(x + (y - x) * n / 8));
  }
  return out;
}
function acMakeLut(keys) {
  var lut = [];
  for (var t = 0; t < keys.length; t++) for (var step = 0; step < 8; step++) {
    var row = [];
    for (var shade = 0; shade < 4; shade++) row.push(acBlend(keys[t][shade], keys[(t + 1) % keys.length][shade], step));
    lut.push(row);
  }
  return lut;
}
var AC_LUT = [acMakeLut(AC_KEYS[0]), acMakeLut(AC_KEYS[1]), acMakeLut(AC_KEYS[2])];
function acPalette(theme, tick, band) { return AC_LUT[theme][Math.floor((tick + band * 7) / 10) % 32]; }
function acState() { return { tick: 0, phase: 0, tiltX: 0, tiltY: 0, idle: 0, theme: 0, ripple: 0, minute: '', date: '' }; }
function acWake(s) { s.idle = 0; s.ripple = 24; }
function acStep(s, sample) {
  var ax = 0, ay = 0;
  if (sample && isFinite(sample.ax) && isFinite(sample.ay) && isFinite(sample.az)) {
    ax = acClamp(sample.ax, -9.81, 9.81);
    ay = acClamp(sample.ay, -9.81, 9.81);
    var magnitude = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az);
    if (Math.abs(magnitude - 9.81) > 1.8 || Math.abs(ax - s.tiltX / 2.2) > 4.5 || Math.abs(ay - s.tiltY / 1.8) > 4.5) acWake(s);
  }
  s.tiltX += (ax * 2.2 - s.tiltX) * 0.035;
  s.tiltY += (ay * 1.8 - s.tiltY) * 0.035;
  s.idle++;
  s.phase += s.idle >= AC_IDLE_TICKS ? 0.006 : 0.02;
  if (s.ripple > 0) s.ripple--;
  s.tick++;
  return s;
}
function acCenter(s, band, part) {
  var baseY = [143, 254, 362][band];
  var x = 102 + part * 55 + Math.sin(s.phase + band * 1.9 + part * 0.33) * 17 + s.tiltX;
  var y = baseY + Math.sin(s.phase * 0.68 + part * 0.55 + band) * 12 + s.tiltY +
    (x - 240) * s.tiltY / 320;
  return [Math.round(acClamp(x, 0, 479)), Math.round(acClamp(y, 0, 479))];
}
function acTwo(n) { return ('0' + n).slice(-2); }
function acClock(s, d) {
  var minute = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '-' + d.getHours() + '-' + d.getMinutes();
  if (minute === s.minute) return false;
  s.minute = minute;
  s.timeText = acTwo(d.getHours()) + ':' + acTwo(d.getMinutes());
  s.date = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()] + '  ' +
    acTwo(d.getDate()) + ' / ' + acTwo(d.getMonth() + 1) + ' / ' + d.getFullYear();
  return true;
}
/* A large time glyph is built once per minute as a retained RGB565 sprite.
 * The Text node below remains the clock's text contract; the sprite gives the
 * 32px device-font ceiling a legible 76px visual at arm's length. */
var AC_DIGITS = { '0':[1,1,1,0,1,1,1], '1':[0,0,1,0,0,1,0],
  '2':[1,0,1,1,1,0,1], '3':[1,0,1,1,0,1,1], '4':[0,1,1,1,0,1,0],
  '5':[1,1,0,1,0,1,1], '6':[1,1,0,1,1,1,1], '7':[1,0,1,0,0,1,0],
  '8':[1,1,1,1,1,1,1], '9':[1,1,1,1,0,1,1] };
function acGlyph(time) {
  var w = 328, h = 88, px = new Uint16Array(w * h);
  var positions = [8, 73, 154, 219];
  var chars = [time[0], time[1], time[3], time[4]];
  var boxes = [[10,4,37,9],[5,11,9,30],[49,11,9,30],[10,40,37,9],
    [5,47,9,30],[49,47,9,30],[10,76,37,9]];
  for (var i = 0; i < 4; i++) {
    var on = AC_DIGITS[chars[i]] || AC_DIGITS['0'];
    for (var seg = 0; seg < 7; seg++) if (on[seg]) {
      var b = boxes[seg], x0 = positions[i] + b[0];
      for (var y = b[1]; y < b[1] + b[3]; y++) for (var x = x0; x < x0 + b[2]; x++) {
        var edge = Math.min(x-x0, x0+b[2]-1-x, y-b[1], b[1]+b[3]-1-y);
        px[y*w+x] = edge < 2 ? 0xBDF7 : 0xFFFF;
      }
    }
  }
  for (var dot = 0; dot < 2; dot++) for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) {
    var r2 = dx*dx + dy*dy;
    if (r2 <= 25) px[(26 + dot*33 + dy)*w + 142 + dx] = r2 > 16 ? 0xBDF7 : 0xFFFF;
  }
  return px;
}
function acGlow(theme) {
  var w = 360, h = 116, px = new Uint16Array(w * h);
  var ink = AC_KEYS[theme][0][3];
  var red = parseInt(ink.slice(1,3),16), green = parseInt(ink.slice(3,5),16), blue = parseInt(ink.slice(5,7),16);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var dx = (x - 180) / 180, dy = (y - 58) / 58;
    var r = dx*dx + dy*dy;
    if (r >= 1) continue;
    var a = (1-r)*(1-r)*0.86;
    var rr = Math.round((3 + (red-3)*a)*31/255);
    var gg = Math.round((10 + (green-10)*a)*63/255);
    var bb = Math.round((20 + (blue-20)*a)*31/255);
    px[y*w+x] = (rr<<11) | (gg<<5) | bb;
  }
  return px;
}
/* GAME UI */
var ac = acState();
var acFrame = signal(0), acTime = signal('00:00'), acDate = signal('');
var acSpriteMinute = '', acGlowTheme = -1;
acClock(ac, new Date()); acTime.set(ac.timeText); acDate.set(ac.date);
var acRoot = View({ style: { width: AC_W, height: AC_H, background: AC_BG, scroll: 'none' } });
Text({ parent: acRoot, text: acTime, style: { position: 'absolute', x: 50, y: 209,
  width: 380, height: 91, fontSize: 72, color: AC_WHITE, textAlign: 'center' } });
var acCanvas = Canvas({ parent: acRoot, width: AC_W, height: AC_H,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    acFrame();
    ctx.fillColor(AC_BG); ctx.fillRect(0, 0, AC_W, AC_H);
    for (var band = 0; band < 3; band++) {
      var col = acPalette(ac.theme, ac.tick, band);
      for (var part = 0; part < 6; part++) {
        var p = acCenter(ac, band, part);
        var rx = [139, 151, 157, 149, 137, 113][part];
        var ry = [51, 55, 58, 52, 44, 33][part];
        var shade = part === 2 || part === 3 ? 1 : 0;
        ctx.fillEllipse(p[0], p[1], rx, ry, col[shade]);
      }
      for (var patch = 0; patch < 2; patch++) {
        var q = acCenter(ac, band, patch + 2);
        ctx.fillEllipse(q[0], q[1] + (patch ? 9 : -8), 108, 31, col[patch ? 3 : 2]);
      }
    }
    if (acGlowTheme !== ac.theme) { ctx.retainImage(2, 360, 116, acGlow(ac.theme)); acGlowTheme = ac.theme; }
    for (var glowBand = 0; glowBand < 3; glowBand++) {
      var gp = acCenter(ac, glowBand, 2);
      ctx.drawImage(2, acClamp(gp[0] - 175, 0, 120), acClamp(gp[1] - 58, 0, 364));
    }
    /* Near-black oval is a quiet clock mask over the luminous middle ribbon. */
    ctx.fillEllipse(240, 251, 156, 59, '#071523');
    if (acSpriteMinute !== ac.minute) { ctx.retainImage(1, 328, 88, acGlyph(ac.timeText)); acSpriteMinute = ac.minute; }
    ctx.drawImage(1, 76, 207);
    if (ac.ripple > 0) {
      for (var ring = 0; ring < 3; ring++)
        ctx.ellipse(240, 251, 110 + ring * 20 + (24 - ac.ripple), 47 + ring * 11,
          AC_LUT[ac.theme][(ac.tick >> 2) % 32][1], 1);
    }
    return { x: 0, y: 0, w: AC_W, h: AC_H };
  } });
Text({ parent: acRoot, text: acDate, style: { position: 'absolute', x: 48, y: 79,
  width: 384, height: 27, fontSize: 17, color: '#DAEAF4', textAlign: 'center' } });
Text({ parent: acRoot, text: 'AURORA', style: { position: 'absolute', x: 120, y: 423,
  width: 240, height: 24, fontSize: 15, color: '#C3D8E4', textAlign: 'center' } });
lume.gesture.on(acRoot, 'tap', function () { ac.theme = (ac.theme + 1) % AC_LUT.length; acWake(ac); acFrame.set(acFrame() + 1); });
lume.system.setInterval(function () {
  var sample = null;
  try { sample = lume.imu.read(); } catch (e) { /* no board */ }
  acStep(ac, sample);
  if (acClock(ac, new Date())) { acTime.set(ac.timeText); acDate.set(ac.date); }
  acFrame.set(acFrame() + 1);
}, 50);
