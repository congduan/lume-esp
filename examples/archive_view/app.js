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

/** Compressed archive viewer: lume.compress.inflate on one static screen (r135).
 *
 *  Three built-in DEFLATE payloads are embedded as byte literals and inflated
 *  into a single caller-owned Uint8Array. A Button cycles them; each entry
 *  shows the decompressed ASCII text, source/destination byte counts, the
 *  compression ratio and a format label (ZLIB / RAW).
 *
 *  RETURN-CODE DISCIPLINE: inflate returns bytes written (>= 0) or a NEGATIVE
 *  code (-1 bad arg/format, -2 damaged stream, -3 out too small). Every
 *  negative code is tested numerically (n < 0) and rendered as ASCII "ERR <code>";
 *  zero is SUCCESS and NEVER rendered as "ERR 0".
 *
 *  TRUNCATION: decompressed text is sliced to MAX_CHARS (120) + "...".
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 17 nodes inside the [76, 404] round AMOLED
 *  safe square and creates nothing at runtime.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script.
 *  Real-device acceptance stays deferred.
 */
var PAYLOADS = [
  { name: 'BOOTLOG', format: 'zlib', bytes: new Uint8Array([120,156,77,140,177,10,194,48,0,5,247,126,197,27,117,75,211,20,170,163,142,10,14,186,137,67,108,159,38,152,38,33,77,171,253,123,113,40,8,183,221,113,215,227,216,243,134,123,8,25,46,60,49,232,62,58,98,53,204,62,27,102,219,174,11,33,182,63,74,68,237,233,176,63,213,149,16,80,141,248,168,70,32,188,150,64,34,135,177,53,216,159,47,27,41,5,18,117,55,47,178,130,161,142,120,36,18,170,108,36,14,118,183,56,133,152,232,198,142,224,164,221,223,177,134,78,173,177,19,49,89,190,153,16,188,179,158,197,23,240,84,53,19]) },
  { name: 'SENSOR', format: 'raw', bytes: new Uint8Array([117,142,59,10,192,48,12,67,247,156,66,23,136,145,157,37,25,114,152,146,161,99,33,100,233,237,139,211,31,29,58,88,32,120,122,120,84,2,88,90,3,133,234,97,40,146,21,88,247,190,121,7,69,17,41,26,70,85,242,102,237,28,20,201,124,216,185,135,71,24,213,94,214,29,76,206,218,199,107,206,186,55,93,108,252,121,66,231,77,241,1]) },
  { name: 'DAMAGED', format: 'zlib', bytes: new Uint8Array([120,156,77,140,177,10,194,48,0,5,247,126,197,27,117,75,211,20,170,163,142,10,14,186,137,67,108,159,38,152,38,33,77,171,253,123,113,40,8,183,221,113,215,227,216,243,134,123,8,25,46,60,49,232,62,58,98,53,204,62,27,102,219,174,11,33,182,63,74,68,237]) }
];
var OUT = new Uint8Array(2048);
var MAX_CHARS = 120;
var compress = lume.compress;
var idx = 0;

var theme = { colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var pagerDisplay = signal(''), contentDisplay = signal(''), bytesDisplay = signal('');
var ratioDisplay = signal(''), formatDisplay = signal(''), statusDisplay = signal('');

function asciiOf(view, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += String.fromCharCode(view[i] & 0x7f);
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS) + '...';
  return s;
}

function render() {
  var p = PAYLOADS[idx];
  var n = compress.inflate(p.bytes, OUT, p.format);
  var state = {
    idx: idx, name: p.name, format: p.format, srcLen: p.bytes.length, rc: n,
    text: '', bytes: '', ratio: '', formatLabel: 'FORMAT ' + p.format.toUpperCase(), status: ''
  };
  if (n < 0) {
    state.status = 'ERR ' + n;
    state.ratio = '-';
    state.bytes = p.bytes.length + ' -> ERR';
  } else {
    state.status = 'OK';
    state.text = asciiOf(OUT, n);
    state.bytes = p.bytes.length + ' -> ' + n + 'B';
    state.ratio = n === 0 ? '0%' : String(Math.round(p.bytes.length * 100 / n)) + '%';
  }
  pagerDisplay.set('PAYLOAD ' + (idx + 1) + '/' + PAYLOADS.length + ' ' + p.name);
  contentDisplay.set(state.text);
  bytesDisplay.set(state.bytes);
  ratioDisplay.set(state.ratio);
  formatDisplay.set(state.formatLabel);
  statusDisplay.set(state.status);
  return state;
}

function cyclePayload() {
  idx = idx + 1 >= PAYLOADS.length ? 0 : idx + 1;
  return render();
}

__A_View({ style: { width: '100%', height: '100%', background: '#000000', scroll: 'none' } }, [
  __A_View({ style: {
    position: 'absolute', x: 14, y: 14, width: 452, height: 452,
    borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
    scroll: 'none'
  } }),
  __A_View({ style: {
    position: 'absolute', x: 76, y: 76, width: 328, height: 328,
    background: '#09101A', scroll: 'none'
  } }, [
    __A_Text({ text: 'Archive Viewer', style: {
      position: 'absolute', x: 4, y: 10, width: 210, height: 28,
      fontSize: 20, color: '#F2F7FB'
    } }),
    __A_Button({ title: 'NEXT', onPress: cyclePayload, style: {
      position: 'absolute', x: 224, y: 0, width: 100, height: 48,
      borderRadius: 12, background: '#116354', borderColor: '#40D8B0', borderWidth: 1,
      color: '#F2F7FB', fontSize: 13
    } }),
    __A_View({ style: {
      position: 'absolute', x: 4, y: 54, width: 320, height: 30,
      background: '#12262B', borderColor: '#2E7D6B', borderWidth: 1, borderRadius: 10,
      paddingLeft: 12, paddingRight: 12, display: 'flex', alignItems: 'center', scroll: 'none'
    } }, [
      __A_Text({ text: pagerDisplay, style: { fontSize: 13, color: '#40D8B0' } })
    ]),
    __A_View({ style: {
      position: 'absolute', x: 4, y: 90, width: 320, height: 126,
      background: '#101A28', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      padding: 10, scroll: 'none'
    } }, [
      __A_Text({ text: contentDisplay, style: { width: 300, height: 106, fontSize: 13, color: '#F2F7FB' } })
    ]),
    __A_View({ style: {
      position: 'absolute', x: 4, y: 222, width: 320, height: 48,
      display: 'flex', flexDirection: 'row', gap: 8, scroll: 'none'
    } }, [
      __A_View({ style: {
        flexGrow: 1, height: 48, background: '#16202E', borderColor: '#233245',
        borderWidth: 1, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
        scroll: 'none'
      } }, [
        __A_Text({ text: bytesDisplay, style: { fontSize: 15, color: '#40D8B0', textAlign: 'center' } })
      ]),
      __A_View({ style: {
        width: 96, height: 48, background: '#16202E', borderColor: '#233245',
        borderWidth: 1, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
        scroll: 'none'
      } }, [
        __A_Text({ text: ratioDisplay, style: { fontSize: 15, color: '#FFD78E', textAlign: 'center' } })
      ])
    ]),
    __A_View({ style: {
      position: 'absolute', x: 4, y: 276, width: 320, height: 48,
      background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      paddingLeft: 14, paddingRight: 14,
      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      scroll: 'none'
    } }, [
      __A_Text({ text: formatDisplay, style: { fontSize: 13, color: '#9EB3C6' } }),
      __A_Text({ text: statusDisplay, style: {
        fontSize: 15,
        color: function () { return statusDisplay() === 'OK' ? '#40D8B0' : '#FF6B79'; }
      } })
    ])
  ])
]);

render();
