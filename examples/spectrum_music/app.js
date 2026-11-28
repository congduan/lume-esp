/* Lume radial spectrum music box. PCM is 16 kHz signed stereo LE. */
var SM_N = 1024, SM_BANDS = 40, SM_RATE = 16000, SM_RING = 4096;
var SM_TAU = Math.PI * 2;
var smRing = new Float32Array(SM_RING), smWrite = 0, smCount = 0;
var smWindow = new Float32Array(SM_N), smFft = new Float32Array(SM_N);
var smMagnitude = new Float32Array(SM_N / 2), smBands = new Float32Array(SM_BANDS);
var smWindowSum = 0, smLevel = 0, smPhase = 0, smStep = 0, smMode = 'MIC';
var smTheme = 0, smSensitivity = 1, smDirty = null, smRev = null;
var smThemes = [
  { dim: '#153327', mid: '#31B76C', bright: '#B8FF79', core: '#70F7AC' },
  { dim: '#3A2524', mid: '#D36549', bright: '#FFD087', core: '#FF9674' },
  { dim: '#152D3D', mid: '#3A9ECA', bright: '#B5F1FF', core: '#75D8F6' }
];
for (var smI = 0; smI < SM_N; smI++) {
  smWindow[smI] = 0.5 - 0.5 * Math.cos(SM_TAU * smI / (SM_N - 1));
  smWindowSum += smWindow[smI];
}
function smPush(sample) {
  smRing[smWrite] = sample;
  smWrite = (smWrite + 1) % SM_RING;
  if (smCount < SM_RING) smCount++;
}
function smOnChunk(pcm, samples) {
  var view = new DataView(pcm), count = Math.min(samples, pcm.byteLength / 4);
  for (var i = 0; i < count; i++) smPush(view.getInt16(i * 4, true) / 32768);
  smDirty.set(smDirty() + 1);
}
function smBandForBin(bin) {
  var low = 2, high = SM_N / 2;
  return Math.max(0, Math.min(SM_BANDS - 1,
    Math.floor(Math.log(Math.max(low, bin) / low) / Math.log(high / low) * SM_BANDS)));
}
function smAngle(index, rotation) { return -Math.PI / 2 + rotation + index * SM_TAU / SM_BANDS; }
function smAnalyze() {
  if (smCount < SM_N) return false;
  var start = (smWrite - SM_N + SM_RING) % SM_RING, mean = 0, i, bin;
  for (i = 0; i < SM_N; i++) mean += smRing[(start + i) % SM_RING];
  mean /= SM_N;
  var sumSq = 0;
  for (i = 0; i < SM_N; i++) {
    var centered = smRing[(start + i) % SM_RING] - mean;
    sumSq += centered * centered;
    smFft[i] = centered * smWindow[i];
  }
  if (lume.fft.realfft(smFft) < 0 || lume.fft.magnitude(smMagnitude, smFft) < 0) return false;
  smLevel = Math.min(1, Math.sqrt(sumSq / SM_N) * 1.8);
  for (i = 0; i < SM_BANDS; i++) smBands[i] *= 0.78;
  for (bin = 2; bin < SM_N / 2; bin++) {
    var band = smBandForBin(bin), amp = smMagnitude[bin] * 2 / smWindowSum;
    if (amp > smBands[band]) smBands[band] = amp;
  }
  return true;
}
function smDemoTick() {
  var frames = 480, pcm = new ArrayBuffer(frames * 4), view = new DataView(pcm);
  var chord = [[220, 277.18, 329.63], [196, 246.94, 293.66],
    [174.61, 220, 261.63], [164.81, 207.65, 246.94]][Math.floor(smStep / 90) % 4];
  for (var i = 0; i < frames; i++) {
    var t = (smStep * frames + i) / SM_RATE;
    var beat = 0.68 + 0.32 * Math.sin(SM_TAU * 2 * t);
    var value = beat * (0.34 * Math.sin(SM_TAU * chord[0] * t) +
      0.24 * Math.sin(SM_TAU * chord[1] * t) + 0.18 * Math.sin(SM_TAU * chord[2] * t));
    var sample = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
    view.setInt16(i * 4, sample, true); view.setInt16(i * 4 + 2, sample, true);
    smPush(sample / 32768);
  }
  smStep++;
  if (lume.audio && lume.audio.playStream)
    lume.audio.playStream(pcm, { sampleRate: 16000, channels: 2, bits: 16 });
}
function smTick() {
  if (smMode === 'DEMO') smDemoTick();
  else smDirty();
  smAnalyze();
  smPhase += 0.004;
  smRev.set(smRev() + 1);
}
function smFallback() { smMode = 'DEMO'; }

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


smDirty = signal(0); smRev = signal(0);
var smRoot = __A_View({ style: { width: 480, height: 480, background: '#050B13', scroll: 'none' } });
var smCanvas = __A_Canvas({ parent: smRoot, width: 480, height: 480,
  style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
    smRev();
    var theme = smThemes[smTheme], cx = 240, cy = 246;
    ctx.fillColor('#050B13'); ctx.fillRect(0, 0, 480, 480);
    ctx.circle(cx, cy, 82, theme.dim);
    ctx.circle(cx, cy, 100, theme.dim);
    for (var i = 0; i < SM_BANDS; i++) {
      var angle = smAngle(i, smPhase), a = Math.min(1, smBands[i] * [2.2, 3.4, 5.0][smSensitivity]);
      var inner = 108, outer = inner + 9 + Math.round(a * 84);
      ctx.line(Math.round(cx + Math.cos(angle) * inner), Math.round(cy + Math.sin(angle) * inner),
        Math.round(cx + Math.cos(angle) * outer), Math.round(cy + Math.sin(angle) * outer),
        a > 0.43 ? theme.bright : a > 0.13 ? theme.mid : theme.dim, a > 0.43 ? 6 : 4);
    }
    ctx.fillCircle(cx, cy, 63, '#0C1823');
    ctx.circle(cx, cy, 63, theme.mid);
    ctx.text(204, 239, 'LUME', theme.core);
    ctx.text(194, 258, 'SPECTRUM', '#D3E7EC');
    /* r201: HUD text pulled into the 480-round safe square; radial geometry unchanged. */
    ctx.text(140, 80, smMode === 'DEMO' ? 'MIC OFF - DEMO MODE' : 'MIC LIVE - 16 kHz', theme.core);
    ctx.fillColor(theme.dim); ctx.fillRect(157, 104, 166, 6);
    ctx.fillColor(theme.bright); ctx.fillRect(157, 104, Math.round(166 * smLevel), 6);
    ctx.text(156, 120, 'ENERGY', '#9EB3C6');
    return { x: 0, y: 0, w: 480, h: 480 };
  } });
__A_Button({ parent: smRoot, title: 'GAIN', onPress: function () { smSensitivity = (smSensitivity + 1) % 3; smRev.set(smRev() + 1); },
  style: { position: 'absolute', x: 84, y: 352, width: 150, height: 48, borderRadius: 8, background: '#1F2C3D', color: '#F2F7FB' } });
__A_Button({ parent: smRoot, title: 'COLOR', onPress: function () { smTheme = (smTheme + 1) % 3; smRev.set(smRev() + 1); },
  style: { position: 'absolute', x: 246, y: 352, width: 150, height: 48, borderRadius: 8, background: '#1F2C3D', color: '#F2F7FB' } });
var smResult = lume.audio && lume.audio.recordStream ?
  lume.audio.recordStream({ chunkSamples: 1024, onChunk: smOnChunk, onError: smFallback }) : -3;
if (smResult < 0) smFallback();
lume.system.setInterval(smTick, 30);
