/* Lume r101/r205 aurora clock. One 480x480 RGB565 canvas; 20 Hz animation.
 * Four palette keyframes per theme are expanded once into a lookup table.
 * r205 round-AMOLED redesign (from artifacts/r205/design/aurora.html):
 *  - Chord-clamped ribbon width (<= 424px via circular chord at y) so ribbons
 *    never clip harshly against the circular watch bezel.
 *  - Removes misaligned ghosting patches & glow stamps; separates upper/lower
 *    aurora curtains cleanly from the isolated midnight time stage.
 *  - Upgraded sleek geometric rounded-sans RGB565 time sprite with circular
 *    mint colon dots (still 1 spriteDefine/min, <= 35 draw calls/frame).
 *  - Dedicated bottom complications: battery pill + exception-only Wi-Fi badge
 *    (with inline wifi-off SVG icon, visible only when !acWallValid). */
var AC_W = 480, AC_H = 480, AC_DT = 0.05, AC_IDLE_TICKS = 1200;
var AC_BG = '#000000', AC_DIAL = '#040C16', AC_WHITE = '#F4FBFF';
var AC_KEYS = [
  [['#09212E','#164B59','#2D8886','#6BD4BE'],['#0B2439','#1B4E6B','#3B8F9B','#7BD6C8'],['#0A2733','#1A5462','#3C948A','#7FD4BE'],['#0F2539','#2D536D','#558FA5','#95D4D0']],
  [['#1F1936','#42325A','#72588F','#B097C4'],['#14233C','#344B77','#626CA2','#A2A9D4'],['#241A36','#513B66','#8B679E','#C4A0C8'],['#18253B','#375473','#638BA8','#A4C0D2']],
  [['#092734','#1A5067','#3E8B92','#7FC2BF'],['#0E263C','#254F6E','#5493A7','#9AC6D0'],['#0E2B33','#25595A','#5C9387','#9EC4A6'],['#11263C','#335578','#679AB5','#A6C8D3']]
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
function acChordHalf(y) {
  var dy = y - 240;
  var r = 212;
  var r2 = r * r - dy * dy;
  return r2 > 0 ? Math.floor(Math.sqrt(r2)) : 0;
}
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
  /* Band 0: upper aurora sky (~y=146); Band 1: lower horizon (~y=328); Band 2: upper crest */
  var baseY = [148, 326, 152][band];
  var y = baseY + Math.sin(s.phase * 0.72 + part * 0.62 + band * 1.4) * 9 + s.tiltY * 0.45;
  var chord = Math.max(48, acChordHalf(y) - 32);
  var frac = (part - 2.5) / 2.5;
  var x = 240 + frac * (chord * 0.78) + Math.sin(s.phase + band * 1.7 + part * 0.38) * 10 + s.tiltX * 0.6;
  x = acClamp(x, 240 - chord, 240 + chord);
  return [Math.round(acClamp(x, 0, 479)), Math.round(acClamp(y, 0, 479))];
}
function acTwo(n) { return ('0' + n).slice(-2); }
var AC_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function acClock(s, d) {
  var minute = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '-' + d.getHours() + '-' + d.getMinutes();
  if (minute === s.minute) return false;
  s.minute = minute;
  s.timeText = acTwo(d.getHours()) + ':' + acTwo(d.getMinutes());
  s.date = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()] + '  ' +
    acTwo(d.getDate()) + ' ' + AC_MONTHS[d.getMonth()];
  return true;
}
/* Sleek geometric rounded-stroke time glyph built once per minute as a retained
 * RGB565 sprite (with circular mint colon dots). Crisp contrast over dark well. */
var AC_DIGITS = { '0':[1,1,1,0,1,1,1], '1':[0,0,1,0,0,1,0],
  '2':[1,0,1,1,1,0,1], '3':[1,0,1,1,0,1,1], '4':[0,1,1,1,0,1,0],
  '5':[1,1,0,1,0,1,1], '6':[1,1,0,1,1,1,1], '7':[1,0,1,0,0,1,0],
  '8':[1,1,1,1,1,1,1], '9':[1,1,1,1,0,1,1] };
function acGlyph(time) {
  var w = 328, h = 88, px = new Uint16Array(w * h);
  var positions = [24, 90, 178, 244];
  var chars = [time[0], time[1], time[3], time[4]];
  var boxes = [[10,4,34,10],[4,10,10,32],[40,10,10,32],[10,39,34,10],
    [4,46,10,32],[40,46,10,32],[10,74,34,10]];
  function fillRound(x0, y0, bw, bh, col, edgeCol) {
    for (var y = y0; y < y0 + bh; y++) for (var x = x0; x < x0 + bw; x++) {
      var dx = Math.min(x - x0, x0 + bw - 1 - x);
      var dy = Math.min(y - y0, y0 + bh - 1 - y);
      if (dx + dy < 2) continue;
      px[y * w + x] = (dx === 0 || dy === 0) ? edgeCol : col;
    }
  }
  for (var i = 0; i < 4; i++) {
    var ch = chars[i];
    if (ch === '1') {
      fillRound(positions[i] + 24, 6, 11, 76, 0xFFFF, 0xC618);
      fillRound(positions[i] + 15, 8, 12, 9, 0xFFFF, 0xC618);
      continue;
    }
    var on = AC_DIGITS[ch] || AC_DIGITS['0'];
    for (var seg = 0; seg < 7; seg++) if (on[seg]) {
      var b = boxes[seg];
      fillRound(positions[i] + b[0], b[1], b[2], b[3], 0xFFFF, 0xC618);
    }
  }
  /* Circular mint colon dots (#40D8B0 -> RGB565 0x46D6) */
  for (var dot = 0; dot < 2; dot++) for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) {
    var r2 = dx * dx + dy * dy;
    if (r2 <= 25) px[(28 + dot * 32 + dy) * w + 161 + dx] = r2 > 16 ? 0x2D53 : 0x46D6;
  }
  return px;
}

/* GAME UI */
/* r227 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r227Ctx) return c.__r227Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c.text(__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r227Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_View(p, kids) { return View(__A_style(p), kids); }
function __A_Text(p, kids) { return Text(__A_style(p), kids); }
function __A_Button(p, kids) { return Button(__A_style(p), kids); }
function __A_Image(p, kids) { return Image(__A_style(p), kids); }


var ac = acState();
var acFrame = signal(0), acTime = signal('00:00'), acDate = signal('');
var acBattLabel = signal('85%');
var acSpriteMinute = '';
acClock(ac, new Date()); acTime.set(ac.timeText); acDate.set(ac.date);

function acReadBattery() {
  try {
    if (lume.pmic && typeof lume.pmic.battPercent === 'function') {
      var p = lume.pmic.battPercent();
      if (typeof p === 'number' && isFinite(p) && p >= 0 && p <= 100) return Math.round(p) + '%';
    }
  } catch (e) {}
  return '85%';
}
acBattLabel.set(acReadBattery());

/* ---- r130: SNTP sync BEGIN ---- */
/* r130: SNTP-first wall clock. WiFi GOT_IP -> lume.system.setTimeNtp(); only a
 * 0 return means Date.now()/new Date() is a corrected wall clock (valid).
 * Until then (or on -2/-3/throw) the genuine 1970-based device time is shown;
 * the existing AURORA HUD slot carries the ASCII sync status. No fabricated
 * epoch, and the 20 Hz ribbon animation / tap interaction are untouched. */
var AC_SYNC_RETRY_MS = 30000;
var AC_SYNC_OK_MS = 600000;
var acWallValid = false;              /* true ONLY after setTimeNtp() === 0 */
var acSyncStatus = signal('SYNCING'); /* ASCII: SYNCING / NO WIFI / NO SYNC / '' */
var acNextSyncMs = 0;                 /* first attempt due immediately */
function acSyncNtp() {
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    acWallValid = false; acSyncStatus.set('NO WIFI');
    acNextSyncMs = lume._nowMs() + AC_SYNC_RETRY_MS; return;
  }
  var sys = lume.system;
  if (!sys || typeof sys.setTimeNtp !== 'function') {
    acWallValid = false; acSyncStatus.set('NO API');
    acNextSyncMs = lume._nowMs() + AC_SYNC_RETRY_MS; return;
  }
  acSyncStatus.set('SYNCING');
  var r;
  try { r = sys.setTimeNtp(); } catch (e) { r = -2; }
  if (r === 0) {
    acWallValid = true; acSyncStatus.set('');     /* wall time: enable rendering */
    acNextSyncMs = lume._nowMs() + AC_SYNC_OK_MS;
  } else {
    acWallValid = false;
    acSyncStatus.set(r === -3 ? 'NO WIFI' : 'NO SYNC');
    acNextSyncMs = lume._nowMs() + AC_SYNC_RETRY_MS;
  }
}
/* ---- r130: SNTP sync END ---- */

function acSvgBytes(svg) {
  var b = new Uint8Array(svg.length);
  for (var i = 0; i < svg.length; i++) b[i] = svg.charCodeAt(i);
  return b.buffer;
}
var AC_BATT_SVG = acSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" viewBox="0 0 18 11">' +
  '<rect x="1" y="1" width="14" height="9" rx="2" fill="none" stroke="#40D8B0" stroke-width="1.5"/>' +
  '<rect x="3" y="3" width="8.5" height="5" rx="1" fill="#40D8B0"/>' +
  '<rect x="16" y="3.5" width="1.8" height="4" rx="0.8" fill="#40D8B0"/>' +
  '</svg>'
);
var AC_WIFIOFF_SVG = acSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">' +
  '<path d="M 3 9 A 13 13 0 0 1 9 6" fill="none" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 15 6 A 13 13 0 0 1 21 9" fill="none" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 6.5 12.6 A 8.2 8.2 0 0 1 10.5 10.5" fill="none" stroke="#FFD78E" stroke-width="2.1" stroke-linecap="round"/>' +
  '<circle cx="12" cy="19" r="1.5" fill="#FFD78E"/>' +
  '<line x1="3" y1="3" x2="21" y2="21" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>'
);

/* Smooth Gaussian-feathered RGB565 aurora curtain sprites (uploaded once per
 * theme change, chord-constrained <= 340px wide so ribbons never clip at bezel
 * and never wash over the central time digits). */
function acHexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function acCurtainSprite(theme, isLower) {
  var w = isLower ? 320 : 340, h = isLower ? 68 : 76;
  var px = new Uint16Array(w * h);
  var bg = [4, 12, 22];
  var cMid = acHexRgb(AC_KEYS[theme][0][2]);
  var cHi = acHexRgb(AC_KEYS[theme][0][3]);
  var cDeep = acHexRgb(AC_KEYS[theme][1][1]);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var u = (x - w * 0.5) / (w * 0.5);
      var envX = Math.max(0, 1 - u * u);
      envX = envX * envX;
      var wave = isLower
        ? (h * 0.52 + Math.sin(u * 2.6 + 0.5) * 9)
        : (h * 0.52 - Math.sin(u * 2.5 - 0.3) * 10);
      var dy = y - wave;
      var soft = Math.exp(-(dy * dy) / (isLower ? 260 : 320)) * envX;
      var core = Math.exp(-(dy * dy) / (isLower ? 48 : 64)) * envX;
      var crest = Math.exp(-((dy + 2) * (dy + 2)) / 18) * envX * Math.max(0, 1 - Math.abs(u) * 1.15);
      var r = bg[0] + (cDeep[0] - bg[0]) * soft * 0.85 + (cMid[0] - bg[0]) * core * 0.72 + (cHi[0] - bg[0]) * crest * 0.75;
      var g = bg[1] + (cDeep[1] - bg[1]) * soft * 0.85 + (cMid[1] - bg[1]) * core * 0.72 + (cHi[1] - bg[1]) * crest * 0.75;
      var b = bg[2] + (cDeep[2] - bg[2]) * soft * 0.85 + (cMid[2] - bg[2]) * core * 0.72 + (cHi[2] - bg[2]) * crest * 0.75;
      var rr = Math.min(31, Math.round(r * 31 / 255));
      var gg = Math.min(63, Math.round(g * 63 / 255));
      var bb = Math.min(31, Math.round(b * 31 / 255));
      px[y * w + x] = (rr << 11) | (gg << 5) | bb;
    }
  }
  return { w: w, h: h, px: px };
}
var acCurtainTheme = -1;

var acRoot = __A_View({ style: { width: AC_W, height: AC_H, background: AC_BG, scroll: 'none' } });
__A_Text({ parent: acRoot, text: acTime, style: { position: 'absolute', x: 50, y: 196,
  width: 380, height: 88, fontSize: 72, color: AC_WHITE, textAlign: 'center' } });
var acCanvas = __A_Canvas({ parent: acRoot, width: AC_W, height: AC_H,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    acFrame();
    ctx.fillColor(AC_BG); ctx.fillRect(0, 0, AC_W, AC_H);
    ctx.fillCircle(240, 240, 224, AC_DIAL);
    ctx.arc(240, 240, 215, 0, 360, 1, '#1E364A');

    if (acCurtainTheme !== ac.theme) {
      var topSp = acCurtainSprite(ac.theme, false);
      var botSp = acCurtainSprite(ac.theme, true);
      ctx.retainImage(2, topSp.w, topSp.h, topSp.px);
      ctx.retainImage(3, botSp.w, botSp.h, botSp.px);
      acCurtainTheme = ac.theme;
    }
    var dxTop = Math.round(Math.sin(ac.phase) * 10 + ac.tiltX * 0.5);
    var dyTop = Math.round(Math.cos(ac.phase * 0.7) * 4 + ac.tiltY * 0.3);
    var dxBot = Math.round(Math.sin(ac.phase + 2.1) * 9 - ac.tiltX * 0.4);
    var dyBot = Math.round(Math.cos(ac.phase * 0.65 + 1.1) * 4 + ac.tiltY * 0.3);
    ctx.drawImage(2, acClamp(70 + dxTop, 56, 84), acClamp(112 + dyTop, 106, 120));
    ctx.drawImage(3, acClamp(80 + dxBot, 66, 94), acClamp(294 + dyBot, 288, 302));

    /* Subtle starlight accents outside time band */
    ctx.fillCircle(152, 108, 1, '#9CC6D8');
    ctx.fillCircle(328, 112, 1, '#9CC6D8');
    ctx.fillCircle(114, 296, 1, '#7FA8BC');
    ctx.fillCircle(366, 290, 1, '#7FA8BC');

    /* Calm dark midnight time well -- zero glow wash over crisp digits */
    ctx.fillEllipse(240, 240, 166, 52, '#040C16');
    if (acSpriteMinute !== ac.minute) { ctx.retainImage(1, 328, 88, acGlyph(ac.timeText)); acSpriteMinute = ac.minute; }
    ctx.drawImage(1, 76, 196);

    if (ac.ripple > 0) {
      for (var ring = 0; ring < 2; ring++)
        ctx.ellipse(240, 240, 118 + ring * 22 + (24 - ac.ripple), 48 + ring * 12,
          AC_LUT[ac.theme][(ac.tick >> 2) % 32][2], 1);
    }
    return { x: 0, y: 0, w: AC_W, h: AC_H };
  } });

__A_Text({ parent: acRoot, text: acDate, style: { position: 'absolute', x: 110, y: 80,
  width: 260, height: 24, fontSize: 15, color: '#C8E2EE', textAlign: 'center' } });

/* Bottom complications: Battery slot + exception-only Wi-Fi badge */
var acBattKids = [];
var acBattIcon = __A_Image({ src: AC_BATT_SVG, style: { position: 'absolute', x: 14, y: 8, width: 16, height: 10 } });
if (acBattIcon > 0) acBattKids.push(acBattIcon);
acBattKids.push(__A_Text({ text: acBattLabel, style: { position: 'absolute', x: 36, y: 5, width: 42, height: 18, fontSize: 13, color: '#C8ECE2', textAlign: 'left' } }));
__A_View({ parent: acRoot, style: {
  position: 'absolute', x: 132, y: 362, width: 88, height: 28,
  borderRadius: 14, background: '#0E1E2C', borderWidth: 1, borderColor: '#256159',
  scroll: 'none'
} }, acBattKids);

var acSyncKids = [];
var acWifiIcon = __A_Image({ src: AC_WIFIOFF_SVG, style: { position: 'absolute', x: 14, y: 6, width: 14, height: 14 } });
if (acWifiIcon > 0) acSyncKids.push(acWifiIcon);
acSyncKids.push(__A_Text({ text: function () {
  return acWallValid ? 'AURORA' : acSyncStatus();
}, style: { position: 'absolute', x: 32, y: 5, width: 76, height: 18, fontSize: 13, color: function () { return acSyncStatus() === '' ? '#9EB3C6' : '#FFD78E'; }, textAlign: 'left' } }));
__A_View({ parent: acRoot, style: {
  position: 'absolute', x: 230, y: 362, width: 118, height: 28,
  borderRadius: 14,
  background: function () { return acSyncStatus() === '' ? '#0E1B28' : '#2C2112'; },
  borderWidth: 1,
  borderColor: function () { return acSyncStatus() === '' ? '#243A4E' : '#7A633C'; },
  scroll: 'none'
} }, acSyncKids);

lume.gesture.on(acRoot, 'tap', function () { ac.theme = (ac.theme + 1) % AC_LUT.length; acWake(ac); acFrame.set(acFrame() + 1); });
lume.system.setInterval(function () {
  var sample = null;
  try { sample = lume.imu.read(); } catch (e) { /* no board */ }
  acStep(ac, sample);
  if (lume._nowMs() >= acNextSyncMs) acSyncNtp();  /* r130: cadence-gated sync */
  if (acClock(ac, new Date())) {
    acTime.set(ac.timeText);
    acDate.set(ac.date);
    acBattLabel.set(acReadBattery());
  }
  acFrame.set(acFrame() + 1);
}, 50);
