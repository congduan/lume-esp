/* Round clock. 480 logical pixels; all essential marks lie within R=218.
 * r205 refinements (from artifacts/r205/design/clock-round.html):
 *  - Brightened metallic outer bezel (r=218) + retained 60 chapter ticks.
 *  - Unified geometric sans numeral system (12 / 3 / 6 / 9) at r=158.
 *  - Minute hand shortened to r=128 (30px clearance before '3', zero collision).
 *  - NO WIFI moved from clipped corner into dedicated 12-o'clock complication
 *    pill (wifi-off icon + status, hidden when synced) + lower digital pill. */
var CR_BG = '#000000', CR_DIAL = '#07101C', CR_BEZEL = '#5689AC', CR_BEZEL_IN = '#294A63';
var CR_TICK = '#537691', CR_MAJOR = '#DCEAF4', CR_INK = '#EEF8F8';
var CR_ACCENT = '#40D8B0', CR_SECOND = '#FF8E6E';
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


var clockState = signal(clockTime(new Date()));

/* ---- r130: SNTP sync BEGIN ---- */
/* r130: SNTP-first wall clock. WiFi GOT_IP -> lume.system.setTimeNtp(); only a
 * 0 return means Date.now()/new Date() is a corrected wall clock (valid).
 * Until then (or on -2/-3/throw) the genuine 1970-based device time is shown
 * and the corner status flags it -- no fabricated epoch. Dial animation and
 * interaction are untouched. Default server / 10 s timeout, like r129. */
var CR_SYNC_RETRY_MS = 30000;
var CR_SYNC_OK_MS = 600000;
var clockWallValid = false;              /* true ONLY after setTimeNtp() === 0 */
var clockSyncStatus = signal('SYNCING'); /* ASCII: SYNCING / NO WIFI / NO SYNC / '' */
var clockNextSyncMs = 0;                 /* first attempt due immediately */
function clockSyncNtp() {
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    clockWallValid = false; clockSyncStatus.set('NO WIFI');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS; return;
  }
  var sys = lume.system;
  if (!sys || typeof sys.setTimeNtp !== 'function') {
    clockWallValid = false; clockSyncStatus.set('NO API');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS; return;
  }
  clockSyncStatus.set('SYNCING');
  var r;
  try { r = sys.setTimeNtp(); } catch (e) { r = -2; }
  if (r === 0) {
    clockWallValid = true; clockSyncStatus.set('');   /* wall time: enable rendering */
    clockNextSyncMs = lume._nowMs() + CR_SYNC_OK_MS;
  } else {
    clockWallValid = false;
    clockSyncStatus.set(r === -3 ? 'NO WIFI' : 'NO SYNC');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS;
  }
}
/* ---- r130: SNTP sync END ---- */

function crPt(r, deg) {
  var p = clockPolar(r, deg);
  return [p[0] + 40, p[1] + 40];
}

function crBuildTicks() {
  var minor = [], major = [], card = [];
  for (var i = 0; i < 60; i++) {
    var isCard = i % 15 === 0;
    var isMaj = i % 5 === 0;
    var p = crPt(isCard ? 185 : (isMaj ? 189 : 197), i * 6);
    var q = crPt(205, i * 6);
    if (isCard) card.push([p[0], p[1], q[0], q[1]]);
    else if (isMaj) major.push([p[0], p[1], q[0], q[1]]);
    else minor.push([p[0], p[1], q[0], q[1]]);
  }
  return { minor: minor, major: major, card: card };
}
var CR_TICKS = crBuildTicks();

function crSvgBytes(svg) {
  var b = new Uint8Array(svg.length);
  for (var i = 0; i < svg.length; i++) b[i] = svg.charCodeAt(i);
  return b.buffer;
}
var CR_WIFIOFF_SVG = crSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24">' +
  '<path d="M 3 9 A 13 13 0 0 1 9 6" fill="none" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 15 6 A 13 13 0 0 1 21 9" fill="none" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 6.5 12.6 A 8.2 8.2 0 0 1 10.5 10.5" fill="none" stroke="#FFD78E" stroke-width="2.1" stroke-linecap="round"/>' +
  '<circle cx="12" cy="19" r="1.5" fill="#FFD78E"/>' +
  '<line x1="3" y1="3" x2="21" y2="21" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>'
);

function clockTick() {
  if (lume._nowMs() >= clockNextSyncMs) clockSyncNtp();
  clockState.set(clockTime(new Date()));  /* genuine device/wall time, never fabricated */
  if (typeof crSyncPill === 'number') {
    lume.setAttr(crSyncPill, 5, clockSyncStatus() === '' ? 0 : 1);
  }
}

function clockDraw(c) {
  var t = clockState(), a = clockAngles(t.h, t.m, t.s);
  c.clear();
  c.fillColor(CR_BG); c.fillRect(0, 0, 480, 480);
  c.fillCircle(240, 240, 224, CR_DIAL);

  /* Brightened metallic bezel + subtle inner chapter track */
  c.arc(240, 240, 218, 0, 360, 3, CR_BEZEL);
  c.arc(240, 240, 211, 0, 360, 1, CR_BEZEL_IN);
  c.arc(240, 240, 142, 0, 360, 1, '#122234');

  if (!c.crPaths) {
    c.crPaths = [
      c.retainSegments(CR_TICKS.minor, CR_TICK, 1),
      c.retainSegments(CR_TICKS.major, CR_MAJOR, 2),
      c.retainSegments(CR_TICKS.card, CR_ACCENT, 3)
    ];
  }
  c.drawPath(c.crPaths[0]);
  c.drawPath(c.crPaths[1]);
  c.drawPath(c.crPaths[2]);

  /* Hour baton (r=90, dark skeleton core) */
  var pH = crPt(90, a.hour), pHIn = crPt(18, a.hour), pHOut = crPt(80, a.hour);
  c.line(240, 240, pH[0], pH[1], CR_INK, 8);
  c.line(pHIn[0], pHIn[1], pHOut[0], pHOut[1], '#0C1726', 2);

  /* Minute baton shortened to r=128 -> 30px crisp clearance before '3' at r=158 */
  var pM = crPt(128, a.minute), pMIn = crPt(16, a.minute), pMOut = crPt(122, a.minute);
  c.line(240, 240, pM[0], pM[1], CR_ACCENT, 5);
  c.line(pMIn[0], pMIn[1], pMOut[0], pMOut[1], '#B6FAEA', 1);

  /* Counterbalanced sweep second hand */
  var pS = crPt(142, a.second), tail = crPt(26, a.second + 180);
  c.line(tail[0], tail[1], pS[0], pS[1], CR_SECOND, 2);
  c.fillCircle(tail[0], tail[1], 3, CR_SECOND);

  /* Jewelled center pinion cap */
  c.fillCircle(240, 240, 8, CR_SECOND);
  c.fillCircle(240, 240, 3, '#0B1420');
}

var clockRoot = __A_View({ style: { width: 480, height: 480, background: CR_BG, scroll: 'none' } });
__A_Canvas({ parent: clockRoot, width: 480, height: 480, onDraw: clockDraw,
  style: { position: 'absolute', x: 0, y: 0 } });

/* Unified geometric sans hour numerals at r=158 (zero collision with minute hand!) */
__A_Text({ parent: clockRoot, text: '12', style: { position: 'absolute', x: 216, y: 74, width: 48, height: 26, fontSize: 22, color: CR_INK, textAlign: 'center' } });
__A_Text({ parent: clockRoot, text: '3',  style: { position: 'absolute', x: 374, y: 228, width: 44, height: 26, fontSize: 22, color: CR_INK, textAlign: 'center' } });
__A_Text({ parent: clockRoot, text: '6',  style: { position: 'absolute', x: 216, y: 382, width: 48, height: 26, fontSize: 22, color: CR_INK, textAlign: 'center' } });
__A_Text({ parent: clockRoot, text: '9',  style: { position: 'absolute', x: 62,  y: 228, width: 44, height: 26, fontSize: 22, color: CR_INK, textAlign: 'center' } });

/* Upper 12-o'clock sync complication pill (exception-only, strictly inside dial) */
var crSyncKids = [];
var crWifiIcon = __A_Image({ src: CR_WIFIOFF_SVG, style: { position: 'absolute', x: 14, y: 6, width: 13, height: 13 } });
if (crWifiIcon > 0) crSyncKids.push(crWifiIcon);
crSyncKids.push(__A_Text({ text: function () {
  return clockWallValid ? '' : clockSyncStatus();
}, style: { position: 'absolute', x: 30, y: 4, width: 72, height: 18, fontSize: 13, color: '#FFD78E', textAlign: 'left' } }));
var crSyncPill = __A_View({ parent: clockRoot, style: {
  position: 'absolute', x: 184, y: 132, width: 112, height: 26,
  borderRadius: 13, background: '#162231', borderWidth: 1, borderColor: '#6D5B3A',
  scroll: 'none'
} }, crSyncKids);

/* Lower digital time complication pill -- unified sans, cleanly above '6' */
__A_View({ parent: clockRoot, style: {
  position: 'absolute', x: 164, y: 300, width: 152, height: 34,
  borderRadius: 17, background: '#101A28', borderWidth: 1, borderColor: '#2A3F56',
  display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
} }, [
  __A_Text({ text: function () { return clockDigital(clockState()); },
    style: { fontSize: 20, color: CR_INK, textAlign: 'center' } })
]);

clockTick();
lume.system.setInterval(clockTick, 1000);
