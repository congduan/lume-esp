/* r230 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args).
 * Mechanism mirrors the r227 __A_* shim (13 round flagships + 16 others). */
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
  if (c.__r230Ctx) return c.__r230Ctx;
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
  w.text = function (x, y, str, col, sz) { return c['text'](__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r230Ctx = w;
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
function __A_props(p, minTouch) {
  if (!__A_ADAPT || !p || typeof p !== 'object') return p;
  var o = {}, k;
  for (k in p) o[k] = (k === 'style') ? __A_style(p[k]) : p[k];
  if (minTouch && p.style && o.style) {
    if (typeof p.style.width === 'number' && p.style.width >= 48 && o.style.width < 48) o.style.width = 48;
    if (typeof p.style.height === 'number' && p.style.height >= 48 && o.style.height < 48) o.style.height = 48;
  }
  return o;
}
function __A_View(p, kids) { return View(__A_props(p, !!(p && p.onPress)), kids); }
function __A_Text(p, kids) { return Text(__A_props(p), kids); }
function __A_Button(p, kids) { return Button(__A_props(p, true), kids); }
function __A_Image(p, kids) { return Image(__A_props(p), kids); }
function __A_List(p) {
  if (!__A_ADAPT || !p) return List(p);
  var o = __A_props(p);
  o.itemHeight = __A_SY(p.itemHeight);
  return List(o);
}

/*
 * r204: control_center v2 -- translated from artifacts/r201/design/control-center.html
 * with r201 vision fixes applied:
 *   - Toggle cards (Wi-Fi / Bluetooth): capsule switch track + white circular
 *     knob (ON right, OFF left) with layered-circle shadow approximation,
 *     ON-state accent card tint, and Wi-Fi / Bluetooth vector icons.
 *   - Group section labels: CONNECTIONS and OUTPUT (10px muted gray stroke text).
 *   - Slider cards (Brightness / Volume): golden sun & speaker icons,
 *     right-aligned numeric readout, gradient-stepped teal fill rail, and 32px
 *     circular white/teal thumb with center anchor dot & layered shadow.
 *   - Dedicated ghost-outlined danger pill: "Reset All" with circular undo arrow.
 *   - Preserves ALL r159 functional semantics and KV keys:
 *       cc.wifi (0/1), cc.ble (0/1), cc.vol (0..10), cc.brt (1..5),
 *       try/catch guarded reads/writes, step wrap cycles, and resetAll().
 *
 * Pure app layer: no firmware / runtime / tools/lume change.
 * Text nodes use only 14/20/32 faces; entire file is ASCII-only (r64).
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#000000', primary:'#0D1420', surface:'#16202E',
  surfaceAlt:'#1F2C3D', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var KV_WIFI = 'cc.wifi';   /* 7 chars */
var KV_BLE = 'cc.ble';     /* 6 chars */
var KV_VOL = 'cc.vol';     /* 7 chars */
var KV_BRT = 'cc.brt';     /* 7 chars */
var DEF_WIFI = false, DEF_BLE = false, DEF_VOL = 3, DEF_BRT = 3;

var wifi = signal(DEF_WIFI);           /* simulated radio state */
var ble = signal(DEF_BLE);             /* simulated radio state */
var vol = signal(DEF_VOL);             /* 0..10 */
var brt = signal(DEF_BRT);             /* 1..5 */

/* ---- KV: try/catch everywhere, accept only legal values ---------------- */
function kvLoadFlag(key, fallback) {
  try {
    var v = lume.storage.kv.get(key);
    return (v === 0 || v === 1) ? (v === 1) : fallback;
  } catch (e) { return fallback; }
}
function kvLoadStep(key, lo, hi, fallback) {
  try {
    var v = lume.storage.kv.get(key);
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v &&
      v >= lo && v <= hi) ? v : fallback;
  } catch (e) { return fallback; }
}
function kvSave(key, value) {
  try { lume.storage.kv.set(key, value); } catch (e) { /* NVS unavailable: volatile only */ }
  return value;
}

wifi.set(kvLoadFlag(KV_WIFI, DEF_WIFI));
ble.set(kvLoadFlag(KV_BLE, DEF_BLE));
vol.set(kvLoadStep(KV_VOL, 0, 10, DEF_VOL));
brt.set(kvLoadStep(KV_BRT, 1, 5, DEF_BRT));

/* ---- state transitions: every one persists ----------------------------- */
function setWifi(v) { wifi.set(!!v); kvSave(KV_WIFI, wifi() ? 1 : 0); }
function setBle(v) { ble.set(!!v); kvSave(KV_BLE, ble() ? 1 : 0); }
function toggleWifi() { setWifi(!wifi()); }
function toggleBle() { setBle(!ble()); }
function setVol(v) {
  var q = Math.max(0, Math.min(10, Math.round(v)));
  vol.set(kvSave(KV_VOL, q));
}
function setBrt(v) {
  var q = Math.max(1, Math.min(5, Math.round(v)));
  brt.set(kvSave(KV_BRT, q));
}
function cycleVol() {
  var v = vol() + 1;
  if (v > 10) v = 0;
  vol.set(kvSave(KV_VOL, v));
}
function cycleBrt() {
  var v = brt() + 1;
  if (v > 5) v = 1;
  brt.set(kvSave(KV_BRT, v));
}
function resetAll() {
  setWifi(DEF_WIFI);
  setBle(DEF_BLE);
  vol.set(kvSave(KV_VOL, DEF_VOL));
  brt.set(kvSave(KV_BRT, DEF_BRT));
}

function flagLabel(v) { return v ? 'ON' : 'OFF'; }
function flagStatus(prefix, v) { return prefix + ' ' + (v ? 'ON' : 'OFF'); }

/* ---- compact 10px uppercase stroke font for CONNECTIONS / OUTPUT ------- */
var MICRO_GLYPHS = {
  C: [[4,0,1,0],[1,0,0,1],[0,1,0,7],[0,7,1,8],[1,8,4,8]],
  E: [[0,0,4,0],[0,0,0,8],[0,4,3,4],[0,8,4,8]],
  I: [[1,0,3,0],[2,0,2,8],[1,8,3,8]],
  N: [[0,8,0,0],[0,0,4,8],[4,8,4,0]],
  O: [[1,0,3,0],[3,0,4,1],[4,1,4,7],[4,7,3,8],[3,8,1,8],[1,8,0,7],[0,7,0,1],[0,1,1,0]],
  P: [[0,8,0,0],[0,0,3,0],[3,0,4,1],[4,1,4,3],[4,3,3,4],[3,4,0,4]],
  S: [[4,1,3,0],[3,0,1,0],[1,0,0,1],[0,1,0,3],[0,3,4,5],[4,5,4,7],[4,7,3,8],[3,8,1,8],[1,8,0,7]],
  T: [[0,0,4,0],[2,0,2,8]],
  U: [[0,0,0,7],[0,7,1,8],[1,8,3,8],[3,8,4,7],[4,7,4,0]]
};
function drawMicroLabel(c, text, x, y, col) {
  var cx = x;
  for (var i = 0; i < text.length; i++) {
    var segs = MICRO_GLYPHS[text[i]];
    if (segs) {
      for (var j = 0; j < segs.length; j++) {
        var s = segs[j];
        c.line(cx + s[0], y + s[1], cx + s[2], y + s[3], col, 1);
      }
    }
    cx += 7;
  }
}

/* ---- Canvas render helpers --------------------------------------------- */
function drawCapsule(c, x, y, w, h, fill, border) {
  var r = Math.floor(h / 2);
  if (border) {
    c.fillCircle(x + r, y + r, r, border);
    c.fillCircle(x + w - r, y + r, r, border);
    c.fillColor(border); c.fillRect(x + r, y, w - 2 * r, h);
    var ir = r - 1;
    c.fillCircle(x + r, y + r, ir, fill);
    c.fillCircle(x + w - r, y + r, ir, fill);
    c.fillColor(fill); c.fillRect(x + r, y + 1, w - 2 * r, h - 2);
  } else {
    c.fillCircle(x + r, y + r, r, fill);
    c.fillCircle(x + w - r, y + r, r, fill);
    c.fillColor(fill); c.fillRect(x + r, y, w - 2 * r, h);
  }
}

function drawToggleCardCanvas(c, kind, isOn) {
  var bg = isOn ? '#14292E' : '#172231';
  c.fillColor(bg); c.fillRect(0, 0, 134, 62);
  var iconCol = isOn ? '#40D8B0' : '#9EB3C6';
  if (kind === 'wifi') {
    c.arc(12, 18, 10, 225, 315, 2, iconCol);
    c.arc(12, 18, 6, 225, 315, 2, iconCol);
    c.fillCircle(12, 18, 2, iconCol);
    c.text(28, 6, 'Wi-Fi', '#F2F7FB');
  } else {
    c.polyline([[8, 8], [16, 16], [12, 20], [12, 4], [16, 8], [8, 16]], iconCol, 2);
    c.text(26, 6, 'Bluetooth', '#F2F7FB');
  }
  /* Capsule switch track (50x28) at bottom-right (x=80, y=32). */
  var tx = 80, ty = 32;
  drawCapsule(c, tx, ty, 50, 28, isOn ? '#40D8B0' : '#1F2C3D', isOn ? '#6EEAC8' : '#3A4E66');
  /* White circular knob with layered-circle shadow approximation (vision fix). */
  var kx = isOn ? (tx + 36) : (tx + 14);
  var ky = ty + 14;
  c.fillCircle(kx, ky + 2, 11, isOn ? '#1B6E5C' : '#0B121B');
  c.fillCircle(kx, ky + 1, 11, isOn ? '#2A9A80' : '#121C29');
  c.fillCircle(kx, ky, 11, '#E6EFF7');
  c.fillCircle(kx, ky - 1, 9, '#FFFFFF');
}

function drawSliderCardCanvas(c, kind, pct) {
  c.fillColor('#16202E'); c.fillRect(0, 0, 296, 52);
  if (kind === 'brt') {
    /* Golden sun icon (#FFD78E) */
    c.arc(9, 10, 3, 0, 360, 2, '#FFD78E');
    c.line(9, 3, 9, 5, '#FFD78E', 2); c.line(9, 15, 9, 17, '#FFD78E', 2);
    c.line(2, 10, 4, 10, '#FFD78E', 2); c.line(14, 10, 16, 10, '#FFD78E', 2);
    c.line(4, 5, 6, 7, '#FFD78E', 1); c.line(12, 13, 14, 15, '#FFD78E', 1);
    c.line(14, 5, 12, 7, '#FFD78E', 1); c.line(6, 13, 4, 15, '#FFD78E', 1);
    c.text(24, 3, 'Brightness', '#9EB3C6');
  } else {
    /* Speaker + teal acoustic waves icon */
    c.fillColor('#9EB3C6'); c.fillRect(3, 8, 4, 5);
    c.polyline([[7, 8], [11, 4], [11, 16], [7, 13]], '#9EB3C6', 2);
    c.arc(11, 10, 4, -45, 45, 2, '#40D8B0');
    c.arc(11, 10, 7, -45, 45, 2, '#40D8B0');
    c.text(24, 3, 'Volume', '#9EB3C6');
  }
  /* Right-aligned percentage readout. */
  var valStr = pct + '%';
  var valX = 294 - valStr.length * 9;
  c.text(valX, 3, valStr, '#F2F7FB');

  /* Recessed rail + stepped gradient teal fill + 32px circular thumb. */
  var rx = 16, rw = 264, ry = 35;
  drawCapsule(c, rx - 2, ry - 4, rw + 4, 8, '#1F2C3D', '#35485E');
  var fillW = Math.max(0, Math.round((pct / 100) * rw));
  var stops = ['#148A75', '#1B9F87', '#24B398', '#2FC6A6', '#38D2AC', '#40D8B0'];
  if (fillW > 6) {
    var segs = stops.length;
    var sw = Math.max(1, Math.ceil(fillW / segs));
    for (var i = 0; i < segs; i++) {
      var sx = rx + i * sw;
      var cw = Math.min(sw, rx + fillW - sx);
      if (cw <= 0) break;
      c.fillColor(stops[i]);
      c.fillRect(sx, ry - 3, cw, 6);
    }
    c.fillCircle(rx, ry, 3, stops[0]);
  }
  /* 32px circular thumb (r=15 inside 52px canvas height) with layered shadow. */
  var tx = rx + fillW;
  c.fillCircle(tx, ry + 2, 15, '#091018');
  c.fillCircle(tx, ry, 15, '#40D8B0');
  c.fillCircle(tx, ry, 13, '#EDF4FA');
  c.fillCircle(tx, ry - 1, 11, '#FFFFFF');
  c.fillCircle(tx, ry, 4, '#117B69');
}

/* ---- UI: round watch bezel + SafeArea layout --------------------------- */
var outerRoot = __A_View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: '#000000', scroll: 'none' } });
__A_View({ parent: outerRoot, style: { position: 'absolute', x: 16, y: 16, width: 448, height: 448,
  borderRadius: 224, background: '#0A111B', borderWidth: 1, borderColor: '#1B2838',
  padding: 0, gap: 0, scroll: 'none' } });

var root = lume.ui.shell.SafeArea({ parent: outerRoot, shape: 'round', size: SW, children: [] });

__A_Text({ parent: root, text: 'Control Center',
  style: { position: 'absolute', x: 10, y: 0, width: 320, height: 26, fontSize: 20,
    textAlign: 'center', scroll: 'none' } });

/* Group 1 label: CONNECTIONS (10px muted gray, vision fix). */
__A_Canvas({ parent: root, width: 320, height: 12,
  style: { position: 'absolute', x: 10, y: 28, scroll: 'none' },
  onDraw: function (c) {
    c.fillColor('#0A111B'); c.fillRect(0, 0, 320, 12);
    drawMicroLabel(c, 'CONNECTIONS', 2, 2, '#6E859E');
  } });

/* Row 1: Wi-Fi and Bluetooth toggle cards (154x78 each, radius 12). */
var wifiCanvas = __A_Canvas({ width: 134, height: 62, style: { scroll: 'none' },
  onDraw: function (c) { drawToggleCardCanvas(c, 'wifi', wifi()); } });
var wifiCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { toggleWifi(); },
  style: { position: 'absolute', x: 10, y: 42, width: 154, height: 78,
    padding: 8, gap: 0, borderRadius: 12, borderWidth: 1,
    background: function () { return wifi() ? '#14292E' : '#172231'; },
    borderColor: function () { return wifi() ? '#34A88B' : '#263548'; },
    alignItems: 'center', justifyContent: 'center' },
  children: [wifiCanvas] });

var bleCanvas = __A_Canvas({ width: 134, height: 62, style: { scroll: 'none' },
  onDraw: function (c) { drawToggleCardCanvas(c, 'ble', ble()); } });
var bleCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { toggleBle(); },
  style: { position: 'absolute', x: 176, y: 42, width: 154, height: 78,
    padding: 8, gap: 0, borderRadius: 12, borderWidth: 1,
    background: function () { return ble() ? '#14292E' : '#172231'; },
    borderColor: function () { return ble() ? '#34A88B' : '#263548'; },
    alignItems: 'center', justifyContent: 'center' },
  children: [bleCanvas] });

/* Group 2 label: OUTPUT (10px muted gray, vision fix). */
__A_Canvas({ parent: root, width: 320, height: 12,
  style: { position: 'absolute', x: 10, y: 124, scroll: 'none' },
  onDraw: function (c) {
    c.fillColor('#0A111B'); c.fillRect(0, 0, 320, 12);
    drawMicroLabel(c, 'OUTPUT', 2, 2, '#6E859E');
  } });

/* Row 2: Brightness slider card (320x66). Tap cycles 1..5; pan drags directly. */
var brtCanvas = __A_Canvas({ width: 296, height: 52, style: { scroll: 'none' },
  onDraw: function (c) { drawSliderCardCanvas(c, 'brt', Math.round((brt() / 5) * 100)); } });
var brtCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { cycleBrt(); },
  style: { position: 'absolute', x: 10, y: 138, width: 320, height: 66,
    padding: 7, gap: 0, borderRadius: 12, borderWidth: 1,
    background: '#16202E', borderColor: '#253447',
    alignItems: 'center', justifyContent: 'center' },
  children: [brtCanvas] });

/* Row 3: Volume slider card (320x66). Tap cycles 0..10; pan drags directly. */
var volCanvas = __A_Canvas({ width: 296, height: 52, style: { scroll: 'none' },
  onDraw: function (c) { drawSliderCardCanvas(c, 'vol', vol() * 10); } });
var volCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { cycleVol(); },
  style: { position: 'absolute', x: 10, y: 210, width: 320, height: 66,
    padding: 7, gap: 0, borderRadius: 12, borderWidth: 1,
    background: '#16202E', borderColor: '#253447',
    alignItems: 'center', justifyContent: 'center' },
  children: [volCanvas] });

/* Gesture tap + pan support on both slider canvases. */
var brtDragStart = 3, volDragStart = 3;
lume.gesture.on(brtCanvas, 'tap', function () { cycleBrt(); });
lume.gesture.on(brtCanvas, 'panstart', function () { brtDragStart = brt(); });
lume.gesture.on(brtCanvas, 'pan', function (e) {
  setBrt(brtDragStart + (e.dx || 0) * 4 / 264);
});
lume.gesture.on(volCanvas, 'tap', function () { cycleVol(); });
lume.gesture.on(volCanvas, 'panstart', function () { volDragStart = vol(); });
lume.gesture.on(volCanvas, 'pan', function (e) {
  setVol(volDragStart + (e.dx || 0) * 10 / 264);
});

/* Row 4: Dedicated ghost-outlined danger "Reset All" pill with circular undo arrow. */
var resetCanvas = __A_Canvas({ width: 164, height: 32, style: { scroll: 'none' },
  onDraw: function (c) {
    c.fillColor('#201118'); c.fillRect(0, 0, 164, 32);
    /* Circular undo arrow icon at (48, 16) */
    c.arc(48, 16, 6, -40, 235, 2, '#FF6B79');
    c.line(41, 10, 42, 15, '#FF6B79', 2);
    c.line(42, 15, 47, 14, '#FF6B79', 2);
    c.text(62, 9, 'Reset All', '#FF6B79');
  } });
var resetBtn = __A_View({ parent: root,
  onPress: function () { resetAll(); },
  style: { position: 'absolute', x: 64, y: 286, width: 212, height: 48,
    borderRadius: 999, background: '#201118', borderWidth: 1, borderColor: '#BF4E5B',
    padding: 0, gap: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    scroll: 'none' } }, [resetCanvas]);

/* Aliases preserve existing harness introspection handles (wifiBtn/bleBtn). */
var wifiBtn = wifiCard;
var bleBtn = bleCard;

globalThis.ccWifi = wifi;
globalThis.ccBle = ble;
globalThis.ccVol = vol;
globalThis.ccBrt = brt;
globalThis.ccRoot = root;
globalThis.ccWifiCard = wifiCard;
globalThis.ccBleCard = bleCard;
globalThis.ccVolCard = volCard;
globalThis.ccBrtCard = brtCard;
globalThis.ccWifiBtn = wifiBtn;
globalThis.ccBleBtn = bleBtn;
globalThis.ccResetBtn = resetBtn;
globalThis.ccApi = {
  wifi: wifi, ble: ble, vol: vol, brt: brt,
  root: root, wifiBtn: wifiBtn, bleBtn: bleBtn, resetBtn: resetBtn,
  wifiCard: wifiCard, bleCard: bleCard,
  volCard: volCard, brtCard: brtCard,
  toggleWifi: toggleWifi, toggleBle: toggleBle,
  cycleVol: cycleVol, cycleBrt: cycleBrt, setVol: setVol, setBrt: setBrt,
  resetAll: resetAll, setWifi: setWifi, setBle: setBle,
  kvLoadFlag: kvLoadFlag, kvLoadStep: kvLoadStep, kvSave: kvSave,
  flagLabel: flagLabel, flagStatus: flagStatus,
  KV_WIFI: KV_WIFI, KV_BLE: KV_BLE, KV_VOL: KV_VOL, KV_BRT: KV_BRT,
  DEF_WIFI: DEF_WIFI, DEF_BLE: DEF_BLE, DEF_VOL: DEF_VOL, DEF_BRT: DEF_BRT,
  NODE_BUDGET: 128, CANVAS_BUDGET: 230400
};
lume.log('CONTROL CENTER READY');
