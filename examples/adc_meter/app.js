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

/** ADC voltage meter: lume.adc ADC1 readout with sparkline trend & scale bar.
 *
 *  Samples GPIO 1..10 (ADC1) once every 250 ms (4 Hz) through lume.adc.config /
 *  readRaw / readMv. Buttons cycle the sampled pin (1..10) and attenuation
 *  (0..3 = DB_0 / DB_2_5 / DB_6 / DB_12). Every native return is a NUMBER:
 *  0 means success, a NEGATIVE value is an error code (-1 bad arg, -2 driver /
 *  calibration failure, -3 pin not configured or calibration unavailable).
 *  Negative values are tested numerically (v < 0), never by truthiness.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 20 nodes inside the [76, 404] round AMOLED
 *  safe square and never creates a node at runtime. The sparkline Canvas uses
 *  <= 40 draw calls per refresh (budget <= 240).
 *
 *  ASCII-only UI copy (r64). Real ADC sampling & eFuse calibration stay
 *  deferred to board bring-up.
 *
 *  LIFECYCLE: no lume.adc.free() call (no app unload hook; config is last-wins).
 */
var ADC_PIN_MIN = 1, ADC_PIN_MAX = 10, ADC_ATTEN_MAX = 3;
var RAW_MAX = 4095;
var FULL_SCALE_MV = 3300;
var HISTORY_LEN = 16;
var adc = lume.adc;
var pin = 3, atten = 0;
var history = [];

var theme = { colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var rawDisplay = signal('0'), mvDisplay = signal('0'), mvValue = signal(0);
var pinDisplay = signal('GPIO ' + pin), attenDisplay = signal('ATT ' + atten), cfgDisplay = signal('');
var sampleSeq = signal(0);

function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function errText(code) { return 'err ' + code; }

function barRatio() {
  var v = mvValue();
  if (v <= 0) return 0;
  var r = v / FULL_SCALE_MV;
  return r > 1 ? 1 : r;
}

function applyConfig() {
  pin = clampInt(pin, ADC_PIN_MIN, ADC_PIN_MAX);
  atten = clampInt(atten, 0, ADC_ATTEN_MAX);
  var st = adc.config(pin, atten);
  cfgDisplay.set(st === 0 ? 'CFG OK' : errText(st));
  pinDisplay.set('GPIO ' + pin);
  attenDisplay.set('ATT ' + atten);
  return st;
}

function cyclePin() {
  pin = pin >= ADC_PIN_MAX ? ADC_PIN_MIN : pin + 1;
  return applyConfig();
}

function cycleAtten() {
  atten = atten >= ADC_ATTEN_MAX ? 0 : atten + 1;
  return applyConfig();
}

function refresh() {
  var r = adc.readRaw(pin);
  var m = adc.readMv(pin);
  rawDisplay.set(r < 0 ? errText(r) : (r > RAW_MAX ? 'RAW OOR' : String(r)));
  mvDisplay.set(m < 0 ? errText(m) : String(m));
  var clamped = m < 0 ? 0 : m;
  mvValue.set(clamped);
  history.push(clamped > FULL_SCALE_MV ? FULL_SCALE_MV : clamped);
  if (history.length > HISTORY_LEN) history.shift();
  sampleSeq.set(sampleSeq() + 1);
  return { raw: r, mv: m };
}

var meter = __A_Canvas({ width: 320, height: 94, style: { position: 'absolute', x: 4, y: 150, scroll: 'none' },
  onDraw: function (c) {
    sampleSeq();
    var ratio = barRatio();
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 94);
    c.fillColor('#233245'); c.fillRect(0, 0, 320, 94);
    c.fillColor('#0F1926'); c.fillRect(1, 1, 318, 92);
    c.text(10, 6, 'TREND ADC1', '#5C7794');
    c.text(254, 6, Math.round(ratio * 100) + '% FS', '#5C7794');
    /* 3 subtle horizontal gridlines */
    c.line(10, 30, 310, 30, '#1B2838', 1);
    c.line(10, 48, 310, 48, '#1B2838', 1);
    c.line(10, 66, 310, 66, '#1B2838', 1);
    /* Sparkline polyline (<= 15 segments) */
    var n = history.length;
    if (n === 1) {
      var y0 = 68 - Math.round((history[0] / FULL_SCALE_MV) * 40);
      c.line(10, y0, 306, y0, '#40D8B0', 2);
      c.fillCircle(306, y0, 4, '#40D8B0');
    } else if (n > 1) {
      var step = 296 / (HISTORY_LEN - 1);
      var startX = 306 - (n - 1) * step;
      var px = Math.round(startX);
      var py = 68 - Math.round((history[0] / FULL_SCALE_MV) * 40);
      for (var i = 1; i < n; i++) {
        var nx = Math.round(startX + i * step);
        var ny = 68 - Math.round((history[i] / FULL_SCALE_MV) * 40);
        c.line(px, py, nx, ny, '#40D8B0', 2);
        px = nx; py = ny;
      }
      c.fillCircle(px, py, 5, '#195449');
      c.fillCircle(px, py, 3, '#40D8B0');
    }
    /* Bottom linear scale bar */
    c.fillColor('#1F2C3D'); c.fillRect(10, 78, 300, 6);
    var w = Math.round(300 * ratio);
    if (w > 0) {
      c.fillColor('#40D8B0'); c.fillRect(10, 78, w, 6);
    }
  } });

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
    /* Top header + sampling rate + config badge */
    __A_Text({ text: 'ADC Voltmeter', style: {
      position: 'absolute', x: 4, y: 2, width: 174, height: 26,
      fontSize: 19, color: '#F2F7FB'
    } }),
    __A_View({ style: {
      position: 'absolute', x: 184, y: 3, width: 52, height: 22,
      background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 11,
      display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
    } }, [
      __A_Text({ text: '4 Hz', style: { fontSize: 12, color: '#9EB3C6', textAlign: 'center' } })
    ]),
    __A_View({ style: {
      position: 'absolute', x: 242, y: 3, width: 82, height: 22,
      background: function () { return cfgDisplay() === 'CFG OK' ? '#122A2B' : '#2A1720'; },
      borderColor: function () { return cfgDisplay() === 'CFG OK' ? '#2E7D6B' : '#7A3240'; },
      borderWidth: 1, borderRadius: 11,
      display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
    } }, [
      __A_Text({ text: cfgDisplay, style: {
        fontSize: 12, textAlign: 'center',
        color: function () { return cfgDisplay() === 'CFG OK' ? '#40D8B0' : '#FF6B79'; }
      } })
    ]),

    /* Hero readout card */
    __A_View({ style: {
      position: 'absolute', x: 4, y: 34, width: 320, height: 108,
      background: '#142030', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      scroll: 'none'
    } }, [
      __A_Text({ text: mvDisplay, style: {
        position: 'absolute', x: 14, y: 10, width: 196, height: 50,
        fontSize: 44, color: '#40D8B0'
      } }),
      __A_Text({ text: 'mV', style: {
        position: 'absolute', x: 216, y: 18, width: 90, height: 22,
        fontSize: 17, color: '#F2F7FB', textAlign: 'right'
      } }),
      __A_Text({ text: '0-3300 mV', style: {
        position: 'absolute', x: 216, y: 42, width: 90, height: 16,
        fontSize: 12, color: '#9EB3C6', textAlign: 'right'
      } }),
      __A_Text({ text: 'RAW 0..4095', style: {
        position: 'absolute', x: 14, y: 76, width: 130, height: 20,
        fontSize: 12, color: '#9EB3C6'
      } }),
      __A_Text({ text: rawDisplay, style: {
        position: 'absolute', x: 150, y: 74, width: 156, height: 22,
        fontSize: 16, color: '#F2F7FB', textAlign: 'right'
      } })
    ]),

    /* Sparkline + bar canvas */
    meter,

    /* Pin / Atten controls */
    __A_Button({ title: 'PIN', onPress: cyclePin, style: {
      position: 'absolute', x: 4, y: 252, width: 156, height: 48,
      borderRadius: 12, background: '#16202E', borderColor: '#233245', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } }),
    __A_Button({ title: 'ATTEN', onPress: cycleAtten, style: {
      position: 'absolute', x: 168, y: 252, width: 156, height: 48,
      borderRadius: 12, background: '#16202E', borderColor: '#233245', borderWidth: 1,
      color: '#F2F7FB', fontSize: 14
    } }),
    __A_Text({
      text: function () { return pinDisplay() + '   ' + attenDisplay(); },
      style: {
        position: 'absolute', x: 4, y: 306, width: 320, height: 20,
        fontSize: 13, color: '#9EB3C6', textAlign: 'center'
      }
    })
  ])
]);

applyConfig();
refresh();
lume.system.setInterval(refresh, 250);
