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

/** Crypto checksum / digest diagnostic: lume.crypto on one static screen.
 *
 *  Shows, for a switchable built-in payload: SHA-256 digest (hex), HMAC-SHA256
 *  token (hex, echoing the r132 OTA token), CRC-32 (unsigned decimal) and an
 *  AES-CTR encrypt -> decrypt loopback (OK / MISMATCH plus the first 8 bytes
 *  of ciphertext as hex). A single Button cycles 3 payloads (short text /
 *  longer text / empty string) so every primitive sees both data and no data.
 *
 *  RETURN-CODE DISCIPLINE: sha256 / hmacSha256 / aesCtr return 0 on success
 *  and a NEGATIVE code on failure; crc32 returns an UNSIGNED u32 value, or -1
 *  for a bad argument. All failures are tested numerically (v < 0), never by
 *  truthiness. -3 is the host / browser stub unsupported answer and is
 *  rendered as ASCII "UNSUPPORTED" rather than swallowed as an exception;
 *  every other negative code renders as "ERR <code>".
 *
 *  HEX TRUNCATION: each 32-byte digest renders its FIRST 16 bytes (32 hex chars)
 *  followed by "...".
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 19 nodes inside the [76, 404] round AMOLED
 *  safe square (root + dial bezel + safeBox + header Text + NEXT Button +
 *  payload card + 4 grouped diagnostic cards) and creates nothing at runtime.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script.
 *  Real-device acceptance (mbedTLS on target, touch feel) stays deferred.
 */
var PAYLOADS = [
  'Lume',
  'The quick brown fox jumps over the lazy dog - Lume crypto diagnostic r134.',
  ''
];
var HMAC_KEY = new Uint8Array([76, 117, 109, 101, 45, 114, 49, 51, 52, 45, 107, 101, 121]);
var AES_KEY = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
var AES_IV = new Uint8Array([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
var HEX = '0123456789abcdef';
var crypto = lume.crypto;
var idx = 0;

var theme = { colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(theme);

var payloadDisplay = signal(''), shaDisplay = signal(''), tokenDisplay = signal('');
var crcDisplay = signal(''), aesDisplay = signal('');

function bytesOf(str) {
  var out = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function hexOf(view, n) {
  var s = '';
  for (var i = 0; i < n && i < view.length; i++) {
    var b = view[i];
    s += HEX.charAt((b >>> 4) & 15) + HEX.charAt(b & 15);
  }
  return s;
}

function errText(code) { return code === -3 ? 'UNSUPPORTED' : 'ERR ' + code; }

function digestText(data) {
  var out = new Uint8Array(32);
  var rc = crypto.sha256(data, out);
  if (rc !== 0) return errText(rc);
  return hexOf(out, 16) + '...';
}

function tokenText(data) {
  var out = new Uint8Array(32);
  var rc = crypto.hmacSha256(HMAC_KEY, data, out);
  if (rc !== 0) return errText(rc);
  return hexOf(out, 16) + '...';
}

function crcText(data) {
  var half = data.length >> 1;
  var c1 = crypto.crc32(data.subarray(0, half));
  if (c1 < 0) return errText(c1);
  var c2 = crypto.crc32(data.subarray(half), c1);
  if (c2 < 0) return errText(c2);
  return String(c2 >>> 0);
}

function aesText(data) {
  var enc = new Uint8Array(data.length);
  var rc = crypto.aesCtr(AES_KEY, AES_IV, data, enc);
  if (rc !== 0) return errText(rc);
  var dec = new Uint8Array(data.length);
  rc = crypto.aesCtr(AES_KEY, AES_IV, enc, dec);
  if (rc !== 0) return errText(rc);
  var ok = true;
  for (var i = 0; i < data.length; i++) {
    if (dec[i] !== data[i]) { ok = false; break; }
  }
  var cipherHex = hexOf(enc, 8);
  return (ok ? 'OK' : 'MISMATCH') + (cipherHex ? ' ' + cipherHex : '');
}

function measure() {
  var data = bytesOf(PAYLOADS[idx]);
  var state = {
    idx: idx,
    payload: PAYLOADS[idx],
    len: data.length,
    sha: digestText(data),
    token: tokenText(data),
    crc: crcText(data),
    aes: aesText(data)
  };
  payloadDisplay.set('PAYLOAD ' + (idx + 1) + '/' + PAYLOADS.length + '  ' + data.length + 'B');
  shaDisplay.set(state.sha);
  tokenDisplay.set(state.token);
  crcDisplay.set(state.crc);
  aesDisplay.set(state.aes);
  return state;
}

function cyclePayload() {
  idx = idx + 1 >= PAYLOADS.length ? 0 : idx + 1;
  return measure();
}

function diagCard(y, h, label, sig, colFn) {
  return __A_View({ style: {
    position: 'absolute', x: 4, y: y, width: 320, height: h,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
    paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, scroll: 'none'
  } }, [
    __A_Text({ text: label, style: { fontSize: 11, color: '#5C7794' } }),
    __A_Text({ text: sig, style: { fontSize: 13, color: colFn, longMode: 'dots' } })
  ]);
}

function valColor(sig, okCol) {
  return function () {
    var s = sig();
    if (s === 'UNSUPPORTED') return '#FFD78E';
    if (s.indexOf('ERR') === 0 || s.indexOf('MISMATCH') === 0) return '#FF6B79';
    return okCol;
  };
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
    __A_Text({ text: 'Crypto Check', style: {
      position: 'absolute', x: 4, y: 10, width: 204, height: 28,
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
      __A_Text({ text: payloadDisplay, style: { fontSize: 13, color: '#40D8B0' } })
    ]),
    diagCard(90, 54, 'SHA-256 DIGEST', shaDisplay, valColor(shaDisplay, '#F2F7FB')),
    diagCard(150, 54, 'HMAC-SHA256 TOKEN', tokenDisplay, valColor(tokenDisplay, '#F2F7FB')),
    diagCard(210, 54, 'CRC-32 (U32)', crcDisplay, valColor(crcDisplay, '#40D8B0')),
    diagCard(270, 54, 'AES-128-CTR LOOPBACK', aesDisplay, valColor(aesDisplay, '#40D8B0'))
  ])
]);

measure();
