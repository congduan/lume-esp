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
 * r204: launcher_grid v2 -- 3x4 round-AMOLED launcher translated from
 * artifacts/r201/design/launcher.html with all r201 vision fixes applied:
 *   - 12 real repo apps mapped in 3x4 grid inside SafeArea ([75, 405]).
 *   - 12 hand-drawn Canvas vector icons (48x48 each = 27648 px <= 230400 px),
 *     eliminating single-letter placeholders (DESIGN-TOKENS R8).
 *   - Vision fixes:
 *       1) Fitness icon uses single ring + pulse chart (no Apple 3-ring motif).
 *       2) Three greens staggered in hue/lightness: Timer (#40D8B0 mint),
 *          Fitness (#7CE850 lime), Chat (#38C8E8 cyan).
 *       3) Camera / Settings neutral gray contrast boosted (#2A3B52 disc,
 *          #5D7896 ring, bright #F2F7FB strokes).
 *       4) Unified outer tonal ring across all 12 circular icon discs.
 *   - Top SNTP wall clock: shows HH:MM when lume.system.time() >= 2020 epoch,
 *     otherwise honestly displays '--:--'.
 *   - Bottom 3-dot page indicator + EDIT mode preserved (tap EDIT/DONE or
 *     swap tiles in edit mode; EdgeNavigation back exits edit mode).
 *
 * Pure app layer: no firmware / runtime / tools/lume change.
 * Text uses only bundled 14/20/32 faces; entire file is ASCII-only (r64).
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg: '#000000', primary: '#0D1420', surface: '#16202E',
  surfaceAlt: '#1F2C3D', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0',
  danger: '#FF6B79', success: '#40D8B0' },
  radius: 12, spacing: 8 });

/* 12 real apps present in examples/. All discs carry a uniform tonal ring. */
var INITIAL_APPS = [
  { id: 'clock',          label: 'Clock',    icon: 'clock',    disc: '#332917', discHi: '#3E321D', ring: '#B89A63', ink: '#FFD78E' },
  { id: 'timer_kit',      label: 'Timer',    icon: 'timer',    disc: '#12332E', discHi: '#18423B', ring: '#34B090', ink: '#40D8B0' },
  { id: 'weather',        label: 'Weather',  icon: 'weather',  disc: '#132640', discHi: '#1A3252', ring: '#4C84D1', ink: '#5B9DF7' },
  { id: 'music_player',   label: 'Music',    icon: 'music',    disc: '#361821', discHi: '#441F2A', ring: '#C95663', ink: '#FF6B79' },
  { id: 'fitness',        label: 'Fitness',  icon: 'fitness',  disc: '#1D3316', discHi: '#26421D', ring: '#68C444', ink: '#7CE850' },
  { id: 'hr_monitor',     label: 'Heart',    icon: 'heart',    disc: '#361821', discHi: '#441F2A', ring: '#C95663', ink: '#FF6B79' },
  { id: 'image_gallery',  label: 'Camera',   icon: 'camera',   disc: '#243347', discHi: '#2E4059', ring: '#6883A1', ink: '#F2F7FB' },
  { id: 'compass',        label: 'Compass',  icon: 'compass',  disc: '#132640', discHi: '#1A3252', ring: '#4C84D1', ink: '#5B9DF7' },
  { id: 'ai_chat',        label: 'Chat',     icon: 'chat',     disc: '#112B38', discHi: '#17394A', ring: '#2FA6C2', ink: '#38C8E8' },
  { id: 'control_center', label: 'Control',  icon: 'control',  disc: '#243347', discHi: '#2E4059', ring: '#6883A1', ink: '#F2F7FB' },
  { id: 'clock_round',    label: 'Alarm',    icon: 'alarm',    disc: '#332917', discHi: '#3E321D', ring: '#B89A63', ink: '#FFD78E' },
  { id: 'settings',       label: 'Settings', icon: 'settings', disc: '#243347', discHi: '#2E4059', ring: '#6883A1', ink: '#F2F7FB' },
];

var ICON_PX = 48;
var ICON_AREA = ICON_PX * ICON_PX;          /* 2304 px per icon */
var FRAME_AREA = 480 * 480;                 /* 230400 px full frame */
var COLUMNS = 3;
var ROWS = 4;
var WALL_MIN_MS = 1577836800000;            /* 2020-01-01 UTC: SNTP wall-clock threshold */

var order = signal(INITIAL_APPS.slice());
var lastAction = signal('READY');
var editing = signal(false);
var editPick = signal(-1);
var pageIdx = signal(0);
var launching = signal(null);
var clockText = signal('--:--');

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function readWallClock() {
  try {
    var ms = lume.system.time();
    if (typeof ms === 'number' && isFinite(ms) && ms >= WALL_MIN_MS) {
      var d = new Date(ms);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
  } catch (e) {}
  return '--:--';
}
function refreshClock() { clockText.set(readWallClock()); }
refreshClock();
var clockTimer = lume.system.setInterval(refreshClock, 15000);
lume.app.onPause(function () {
  if (clockTimer !== null) { lume.system.clearInterval(clockTimer); clockTimer = null; }
});
lume.app.onResume(function () {
  refreshClock();
  if (clockTimer === null) clockTimer = lume.system.setInterval(refreshClock, 15000);
});

function setEditing(v) {
  editing.set(!!v);
  if (!v) editPick.set(-1);
}
function swapTiles(a, b) {
  if (a === b || a < 0 || b < 0) return;
  var next = order().slice();
  if (a >= next.length || b >= next.length) return;
  var tmp = next[a]; next[a] = next[b]; next[b] = tmp;
  order.set(next);
}
function onLaunch(id) { lastAction.set('launch ' + id); }
function onBack() { lastAction.set('BACK'); return true; }

/* ---- 12 crisp vector icons on 48x48 Canvas (zero letter placeholders) -- */
function drawIconGlyph(c, app, selected) {
  /* Match watch bezel backdrop so circular discs have zero square corner seam. */
  c.fillColor('#09101B');
  c.fillRect(0, 0, 48, 48);
  /* Uniform circular glass disc + unified outer ring across all 12 icons. */
  c.fillCircle(24, 24, 23, selected ? '#40D8B0' : app.ring);
  c.fillCircle(24, 24, 22, app.disc);
  c.fillCircle(24, 21, 18, app.discHi);
  c.fillCircle(24, 26, 17, app.disc);

  var k = app.icon;
  var ink = app.ink;
  var hi = '#F2F7FB';

  if (k === 'clock') {
    c.arc(24, 24, 9, 0, 360, 2, ink);
    c.line(24, 18, 24, 24, hi, 2);
    c.line(24, 24, 28, 26, hi, 2);
    c.fillCircle(24, 24, 2, ink);
  } else if (k === 'timer') {
    c.line(21, 13, 27, 13, ink, 2);
    c.line(24, 13, 24, 16, ink, 2);
    c.arc(24, 26, 8, 0, 360, 2, ink);
    c.line(24, 26, 28, 22, hi, 2);
    c.line(30, 19, 32, 17, ink, 2);
  } else if (k === 'weather') {
    c.fillCircle(28, 20, 4, '#FFD78E');
    c.fillCircle(20, 27, 4, hi);
    c.fillCircle(25, 25, 5, hi);
    c.fillCircle(30, 27, 4, hi);
    c.fillColor(hi);
    c.fillRect(19, 27, 12, 4);
    c.fillCircle(25, 27, 3, '#2D588A');
  } else if (k === 'music') {
    c.line(20, 29, 20, 18, hi, 2);
    c.line(30, 27, 30, 16, hi, 2);
    c.line(20, 18, 30, 16, hi, 2);
    c.line(20, 22, 30, 20, ink, 2);
    c.fillCircle(18, 30, 3, ink);
    c.fillCircle(28, 28, 3, ink);
  } else if (k === 'fitness') {
    /* Vision fix 1: single outer ring + ascending activity chart (no 3-ring copy). */
    c.arc(24, 24, 11, -90, 225, 2, ink);
    c.fillCircle(24, 13, 1, ink);
    c.polyline([[17, 28], [21, 24], [24, 26], [30, 18]], hi, 2);
    c.fillCircle(30, 18, 2, ink);
  } else if (k === 'heart') {
    c.fillCircle(20, 21, 5, ink);
    c.fillCircle(28, 21, 5, ink);
    c.polyline([[16, 23], [24, 32], [32, 23]], ink, 3);
    c.fillCircle(24, 26, 4, ink);
    c.polyline([[17, 24], [21, 24], [23, 20], [25, 27], [27, 24], [31, 24]], hi, 2);
  } else if (k === 'camera') {
    /* Vision fix 3: boosted contrast for neutral gray tile. */
    c.line(15, 19, 33, 19, hi, 2);
    c.line(33, 19, 33, 31, hi, 2);
    c.line(33, 31, 15, 31, hi, 2);
    c.line(15, 31, 15, 19, hi, 2);
    c.line(20, 19, 22, 16, hi, 2);
    c.line(22, 16, 26, 16, hi, 2);
    c.line(26, 16, 28, 19, hi, 2);
    c.arc(24, 25, 4, 0, 360, 2, '#B6CCE0');
    c.fillCircle(30, 22, 1, '#40D8B0');
  } else if (k === 'compass') {
    c.arc(24, 24, 9, 0, 360, 2, ink);
    c.line(24, 24, 28, 19, '#FF6B79', 3);
    c.line(24, 24, 20, 29, hi, 3);
    c.fillCircle(24, 24, 2, hi);
  } else if (k === 'chat') {
    /* Vision fix 2: cyan-aqua hue (#38C8E8) distinct from Timer & Fitness. */
    c.line(16, 17, 32, 17, ink, 2);
    c.line(32, 17, 32, 27, ink, 2);
    c.line(32, 27, 22, 27, ink, 2);
    c.line(22, 27, 17, 31, ink, 2);
    c.line(17, 31, 17, 27, ink, 2);
    c.line(16, 27, 16, 17, ink, 2);
    c.fillCircle(20, 22, 1, hi);
    c.fillCircle(24, 22, 1, hi);
    c.fillCircle(28, 22, 1, hi);
  } else if (k === 'control') {
    c.line(16, 20, 32, 20, '#B6CCE0', 2);
    c.fillCircle(27, 20, 3, '#40D8B0');
    c.line(16, 28, 32, 28, '#B6CCE0', 2);
    c.fillCircle(21, 28, 3, hi);
  } else if (k === 'alarm') {
    c.arc(24, 25, 8, 0, 360, 2, ink);
    c.line(16, 18, 19, 15, ink, 2);
    c.line(32, 18, 29, 15, ink, 2);
    c.line(24, 21, 24, 25, hi, 2);
    c.line(24, 25, 27, 27, hi, 2);
    c.line(18, 32, 16, 34, ink, 2);
    c.line(30, 32, 32, 34, ink, 2);
  } else {
    /* Settings gear with boosted neutral contrast. */
    c.arc(24, 24, 6, 0, 360, 2, '#B6CCE0');
    c.arc(24, 24, 3, 0, 360, 2, hi);
    c.line(24, 14, 24, 17, hi, 2);
    c.line(24, 31, 24, 34, hi, 2);
    c.line(14, 24, 17, 24, hi, 2);
    c.line(31, 24, 34, 24, hi, 2);
    c.line(17, 17, 19, 19, '#B6CCE0', 2);
    c.line(29, 29, 31, 31, '#B6CCE0', 2);
    c.line(31, 17, 29, 19, '#B6CCE0', 2);
    c.line(19, 29, 17, 31, '#B6CCE0', 2);
  }
}

/* ---- UI: round watch bezel + SafeArea 3x4 grid ------------------------- */
var root = __A_View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: '#000000', scroll: 'none' } });

/* Subtle outer circular watch bezel (r = 218 <= 220, zero Canvas cost). */
__A_View({ parent: root, style: { position: 'absolute', x: 22, y: 22, width: 436, height: 436,
  borderRadius: 218, background: '#09101B', borderWidth: 1, borderColor: '#1A2636',
  padding: 0, gap: 0, scroll: 'none' } });

var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: SW, children: [] });

/* Top bar inside safe area (local y: 0..48 -> global y: 70..118).
 * Centered SNTP clock (or EDIT status while editing) + discreet EDIT/DONE control. */
var statusText = __A_Text({ parent: safe,
  text: function () { return editing() ? 'EDIT' : clockText(); },
  style: { position: 'absolute', x: 96, y: 12, width: 148, height: 20, fontSize: 14,
    letterSpacing: 1, textAlign: 'center', opacity: 0.85, scroll: 'none' } });

/* 64x48 touch target (>= 48px) wrapping a sleek compact visual pill. */
var editBtn = __A_View({ parent: safe,
  style: { position: 'absolute', x: 264, y: 0, width: 64, height: 48, padding: 0, gap: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none' },
  onPress: function () { setEditing(!editing()); } }, [
  __A_View({ style: { width: 54, height: 26, borderRadius: 999, padding: 0, gap: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: function () { return editing() ? '#117B69' : '#16202E'; },
    borderWidth: 1,
    borderColor: function () { return editing() ? '#40D8B0' : '#2C3D52'; },
    scroll: 'none' } }, [
    __A_Text({ text: function () { return editing() ? 'DONE' : 'EDIT'; },
      style: { fontSize: 14, textAlign: 'center', opacity: 0.9, scroll: 'none' } })
  ])
]);

/* 3 columns x 4 rows inside safe area:
 * 3 cols x 104 px = 312 px (local x: 14..326 -> global 84..396),
 * 4 rows x 66 px = 264 px (local y: 48..312 -> global 118..382). */
var CELL_W = 104, CELL_H = 66, GRID_X = 14, GRID_Y = 48;
var tileNodes = [];
for (var idx = 0; idx < INITIAL_APPS.length; idx++) {
  (function (slot) {
    var col = slot % COLUMNS;
    var row = Math.floor(slot / COLUMNS);
    var tile = __A_View({ parent: safe,
      style: { position: 'absolute', x: GRID_X + col * CELL_W, y: GRID_Y + row * CELL_H,
        width: CELL_W, height: CELL_H, padding: 0, gap: 0, borderRadius: 12,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', scroll: 'none',
        opacity: function () {
          var app = order()[slot];
          return launching() === app.id ? 0.55 : 1;
        } },
      onPress: function () {
        var app = order()[slot];
        if (editing()) {
          var picked = editPick();
          if (picked < 0) { editPick.set(slot); }
          else if (picked === slot) { editPick.set(-1); }
          else { swapTiles(picked, slot); editPick.set(-1); }
          return;
        }
        launching.set(app.id);
        onLaunch(app.id);
      } }, [
      __A_Canvas({ width: ICON_PX, height: ICON_PX, style: { scroll: 'none' }, onDraw: function (c) {
        var app = order()[slot];
        drawIconGlyph(c, app, editing() && editPick() === slot);
      } }),
      __A_Text({ text: function () { return order()[slot].label; },
        style: { width: 98, height: 18, fontSize: 14, textAlign: 'center',
          opacity: 0.9, scroll: 'none' } }),
    ]);
    tileNodes.push(tile);
  })(idx);
}

/* Bottom 3-dot page indicator inside safe area (local y: 320..334 -> global 390..404). */
var dotsRow = __A_View({ parent: safe, style: { position: 'absolute', x: 110, y: 320,
  width: 120, height: 14, padding: 0, gap: 8, display: 'flex', flexDirection: 'row',
  alignItems: 'center', justifyContent: 'center', scroll: 'none' } }, [
  __A_View({ style: { width: function () { return pageIdx() === 0 ? 18 : 6; }, height: 6,
    borderRadius: 3, background: function () { return pageIdx() === 0 ? '#40D8B0' : '#5C7794'; },
    padding: 0, gap: 0, scroll: 'none' } }),
  __A_View({ style: { width: function () { return pageIdx() === 1 ? 18 : 6; }, height: 6,
    borderRadius: 3, background: function () { return pageIdx() === 1 ? '#40D8B0' : '#5C7794'; },
    padding: 0, gap: 0, scroll: 'none' } }),
  __A_View({ style: { width: function () { return pageIdx() === 2 ? 18 : 6; }, height: 6,
    borderRadius: 3, background: function () { return pageIdx() === 2 ? '#40D8B0' : '#5C7794'; },
    padding: 0, gap: 0, scroll: 'none' } }),
]);

/* EdgeNavigation back: exits editing mode first, otherwise invokes host onBack. */
lume.ui.shell.EdgeNavigation({ parent: root, indicator: false,
  onBack: function () {
    if (editing()) { setEditing(false); return true; }
    return onBack();
  },
  onPageSwipe: function (dir) {
    var p = pageIdx();
    if (dir === 'left') pageIdx.set((p + 1) % 3);
    else if (dir === 'right') pageIdx.set((p + 2) % 3);
  } });

globalThis.lgApi = {
  root: root,
  safe: safe,
  status: lastAction,
  statusNode: statusText,
  clockText: clockText,
  refreshClock: refreshClock,
  readWallClock: readWallClock,
  editing: editing,
  setEditing: setEditing,
  editPick: editPick,
  order: order,
  swapTiles: swapTiles,
  pageIdx: pageIdx,
  editBtn: editBtn,
  tileNodes: tileNodes,
  dotsRow: dotsRow,
  appList: INITIAL_APPS,
  ICON_PX: ICON_PX,
  ICON_AREA: ICON_AREA,
  FRAME_AREA: FRAME_AREA,
  COLUMNS: COLUMNS,
  ROWS: ROWS,
  launch: function (id) { lastAction.set('launch ' + id); },
};
lume.log('LAUNCHER GRID READY');
