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
function __A_props(p) {
  if (!__A_ADAPT || !p || typeof p !== 'object') return p;
  var o = {}, k;
  for (k in p) o[k] = (k === 'style') ? __A_style(p[k]) : p[k];
  return o;
}
function __A_View(p, kids) { return View(__A_props(p), kids); }
function __A_Text(p, kids) { return Text(__A_props(p), kids); }
function __A_Button(p, kids) { return Button(__A_props(p), kids); }
function __A_Image(p, kids) { return Image(__A_props(p), kids); }
function __A_List(p) {
  if (!__A_ADAPT || !p) return List(p);
  var o = __A_props(p);
  o.itemHeight = __A_SY(p.itemHeight);
  return List(o);
}

/** RGB565 scaling demo: lume.imgscale.scale on one static screen (r136).
 *
 *  A small built-in RGB565 test image is scaled into a caller-owned Uint16Array
 *  at an integer multiple (2x / 4x / 8x) and uploaded to a Canvas sprite slot
 *  with retainImage / drawImage. NEXT cycles the zoom; MODE toggles nearest /
 *  bilinear sampling. The HUD shows the active factor, sampling mode, source
 *  to destination dimensions and the scale() return code.
 *
 *  RETURN-CODE DISCIPLINE: scale() returns 0 on success and a NEGATIVE code on
 *  failure. Every failure is discriminated NUMERICALLY with `rc < 0` and
 *  rendered as ASCII "ERR <code>"; zero is SUCCESS and never rendered as error.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 10 nodes inside the [76, 404] round AMOLED
 *  safe square (root + dial bezel + header Text + status pill View & Text +
 *  framed viewport Canvas + HUD Text + control row + 2 Buttons) and creates
 *  nothing at runtime.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script.
 *  Real-device acceptance (panel output, touch feel) stays deferred.
 */
var __IMG_SW = 24, __IMG_SH = 24;
var FACTORS = [2, 4, 8];
var MAXD = __IMG_SW * FACTORS[FACTORS.length - 1];
var SRC = new Uint16Array([
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  0,0,0,0,0,0,0,0,0,0,0,31,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  192,192,192,192,192,192,192,192,192,192,192,223,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  352,352,352,352,352,352,352,352,352,352,352,383,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  544,544,544,544,544,544,544,544,544,544,544,575,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  736,736,736,736,736,736,736,736,736,736,736,767,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  928,928,928,928,928,928,928,928,928,928,928,959,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1088,1088,1088,1088,1088,1088,1088,1088,1088,1088,1088,1119,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1280,1280,1280,1280,1280,1280,1280,1280,1280,1280,1280,1311,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1472,1472,1472,1472,1472,1472,1472,1472,1472,1472,1472,1503,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1664,1664,1664,1664,1664,1664,1664,1664,1664,1664,1664,1695,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  1824,1824,1824,1824,1824,1824,1824,1824,1824,1824,1824,1855,
  31,6172,12313,16407,22548,28689,34830,40971,47112,51206,57347,63488,
  2016,2016,2016,2016,2016,2016,2016,2016,2016,2016,2016,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,2047,
  1,1,1,1,65535,65535,65535,65535,1,1,1,1,
  2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,63488,2047,
  65535,65535,65535,65535,1,1,1,1,65535,65535,65535,65535,
  2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,2047,63488
]);
var DST = new Uint16Array(MAXD * MAXD);
var CW = 204, CH = 204;
var imgscale = lume.imgscale;
var idx = 0;
var mode = 'nearest';

var scaleIndex = signal(0);
var modeSignal = signal('nearest');
var hudDisplay = signal(''), statusDisplay = signal('');

var theme = { colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var last = { rc: 0, mode: mode, factor: FACTORS[0], sw: __IMG_SW, sh: __IMG_SH, dw: 0, dh: 0, dst: DST };

function compute() {
  var f = FACTORS[idx], m = mode;
  var dw = __IMG_SW * f, dh = __IMG_SH * f;
  var dst = DST.subarray(0, dw * dh);
  var rc = imgscale.scale(SRC, __IMG_SW, __IMG_SH, dst, dw, dh, m);
  last = { rc: rc, mode: m, factor: f, sw: __IMG_SW, sh: __IMG_SH, dw: dw, dh: dh, dst: dst };
  return last;
}

function statusText(rc) { return rc < 0 ? 'ERR ' + rc : 'OK'; }

function apply() {
  var r = compute();
  hudDisplay.set('X' + r.factor + ' ' + r.mode + ' ' + r.sw + 'x' + r.sh + ' -> ' + r.dw + 'x' + r.dh);
  statusDisplay.set(statusText(r.rc));
  return r;
}

function nextScale() {
  idx = idx + 1 >= FACTORS.length ? 0 : idx + 1;
  scaleIndex.set(idx);
  return apply();
}

function toggleMode() {
  mode = mode === 'nearest' ? 'bilinear' : 'nearest';
  modeSignal.set(mode);
  return apply();
}

function state() {
  return {
    rc: last.rc, mode: last.mode, factor: last.factor, sw: last.sw, sh: last.sh,
    dw: last.dw, dh: last.dh, pixels: Array.prototype.slice.call(last.dst)
  };
}

var root = __A_View({ style: { width: '100%', height: '100%', background: '#000000', scroll: 'none' } }, [
  __A_View({ style: {
    position: 'absolute', x: 14, y: 14, width: 452, height: 452,
    borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
    scroll: 'none'
  } }),
  __A_Text({ text: 'Image Scale', style: {
    position: 'absolute', x: 80, y: 78, width: 220, height: 28,
    fontSize: 20, color: '#F2F7FB'
  } }),
  __A_View({ style: {
    position: 'absolute', x: 320, y: 78, width: 80, height: 24,
    background: '#122A2B', borderColor: '#2E7D6B', borderWidth: 1, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
  } }, [
    __A_Text({ text: statusDisplay, style: {
      fontSize: 12, textAlign: 'center',
      color: function () { return statusDisplay() === 'OK' ? '#40D8B0' : '#FF6B79'; }
    } })
  ]),
  __A_Text({ text: hudDisplay, style: {
    position: 'absolute', x: 80, y: 322, width: 320, height: 22,
    fontSize: 13, color: '#9EB3C6', textAlign: 'center'
  } }),
  __A_View({ style: {
    position: 'absolute', x: 80, y: 350, width: 320, height: 48,
    display: 'flex', flexDirection: 'row', gap: 10, scroll: 'none'
  } }, [
    __A_Button({ title: 'NEXT', onPress: nextScale, style: {
      flexGrow: 1, height: 48, borderRadius: 12,
      background: '#116354', borderColor: '#40D8B0', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } }),
    __A_Button({ title: 'MODE', onPress: toggleMode, style: {
      flexGrow: 1, height: 48, borderRadius: 12,
      background: '#16202E', borderColor: '#233245', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } })
  ])
]);

__A_Canvas({
  parent: root, width: CW, height: CH,
  style: { position: 'absolute', x: 138, y: 112, scroll: 'none' },
  onDraw: function (ctx) {
    scaleIndex(); modeSignal();
    var r = compute();
    ctx.fillColor('#2E7D6B'); ctx.fillRect(0, 0, CW, CH);
    ctx.fillColor('#0B121C'); ctx.fillRect(1, 1, CW - 2, CH - 2);
    /* Subtle crosshair framing guides */
    ctx.line(6, 6, 18, 6, '#233245', 1); ctx.line(6, 6, 6, 18, '#233245', 1);
    ctx.line(CW - 18, 6, CW - 6, 6, '#233245', 1); ctx.line(CW - 6, 6, CW - 6, 18, '#233245', 1);
    ctx.line(6, CH - 6, 18, CH - 6, '#233245', 1); ctx.line(6, CH - 18, 6, CH - 6, '#233245', 1);
    ctx.line(CW - 18, CH - 6, CW - 6, CH - 6, '#233245', 1); ctx.line(CW - 6, CH - 18, CW - 6, CH - 6, '#233245', 1);
    if (r.rc < 0) {
      ctx.fillColor('#FF6B79');
      ctx.fillRect(2, 2, CW - 4, 8);
    } else {
      ctx.retainImage(1, r.dw, r.dh, r.dst);
      ctx.drawImage(1, Math.floor((CW - r.dw) / 2), Math.floor((CH - r.dh) / 2));
    }
  }
});

apply();
