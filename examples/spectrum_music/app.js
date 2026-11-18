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
smDirty = signal(0); smRev = signal(0);
var smRoot = View({ style: { width: 480, height: 480, background: '#050B13', scroll: 'none' } });
var smCanvas = Canvas({ parent: smRoot, width: 480, height: 480,
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
    ctx.text(140, 31, smMode === 'DEMO' ? 'MIC OFF · DEMO MODE' : 'MIC LIVE · 16 kHz', theme.core);
    ctx.fillColor(theme.dim); ctx.fillRect(157, 58, 166, 6);
    ctx.fillColor(theme.bright); ctx.fillRect(157, 58, Math.round(166 * smLevel), 6);
    ctx.text(156, 75, 'ENERGY', '#8799A4');
    return { x: 0, y: 0, w: 480, h: 480 };
  } });
Button({ parent: smRoot, title: 'GAIN', onPress: function () { smSensitivity = (smSensitivity + 1) % 3; smRev.set(smRev() + 1); },
  style: { position: 'absolute', x: 122, y: 422, width: 106, height: 38, background: '#17313A', color: '#D3E7EC' } });
Button({ parent: smRoot, title: 'COLOR', onPress: function () { smTheme = (smTheme + 1) % 3; smRev.set(smRev() + 1); },
  style: { position: 'absolute', x: 252, y: 422, width: 106, height: 38, background: '#17313A', color: '#D3E7EC' } });
var smResult = lume.audio && lume.audio.recordStream ?
  lume.audio.recordStream({ chunkSamples: 1024, onChunk: smOnChunk, onError: smFallback }) : -3;
if (smResult < 0) smFallback();
lume.system.setInterval(smTick, 30);
