/* Live 16 kHz microphone spectrum. Browser playground supplies synthetic PCM. */
var FFT = require('./fft.js');
var specW = 400, specH = 200, specBars = 32, specN = 512;
var specLevels = new Array(specBars).fill(0), specPeaks = new Array(specBars).fill(0);
var specRev = signal(0), specHud = signal('TAP TO LISTEN'), specVu = signal(0);
var specRunning = false, specFrames = 0, specFpsFrames = 0, specLastLog = lume._nowMs();
var specPeakHz = 0, specTimer = null, specLastAnalysisMs = 0;

function specChunk(pcm, samples) {
  /* Audio callback: FFT and numeric assignments only. Rendering and strings
   * are deferred to the timer; this keeps the engine event queue responsive. */
  if (!specRunning || samples < specN) return;
  var began = lume._nowMs(), result = FFT.analyze(pcm, specN, 16000);
  specLastAnalysisMs = lume._nowMs() - began;
  if (specLastAnalysisMs > 15 && specN === 512) specN = 256;
  specLevels = FFT.bars(result.bins, specBars);
  specVu.set(result.vu);
  specPeakHz = result.peakHz;
  specFrames++; specFpsFrames++;
}
function specTick() {
  if (!specRunning) return;
  for (var i = 0; i < specBars; i++)
    specPeaks[i] = Math.max(specLevels[i], Math.max(0, specPeaks[i] - 0.025));
  specRev.set(specRev() + 1);
  var now = lume._nowMs();
  if (now - specLastLog >= 1000) {
    var fps = Math.round(specFpsFrames * 1000 / (now - specLastLog));
    var drop = lume.audio.recordStreamDropped ? lume.audio.recordStreamDropped() : 0;
    specHud.set('16kHz  ' + specN + ' FFT  ' + fps + 'fps  drop ' + drop);
    lume.log('SPEC fps=' + fps + ' drop=' + drop + ' peak=' + Math.round(specPeakHz));
    specLastLog = now; specFpsFrames = 0;
  }
}
function specError(code) { specStop(); specHud.set('MIC ERROR ' + code); }
function specStart() {
  if (specRunning) return;
  if (!lume.audio || !lume.audio.recordStream) { specHud.set('MIC UNAVAILABLE'); return; }
  var rc = lume.audio.recordStream({ chunkSamples: 1024, onChunk: specChunk, onError: specError });
  if (rc < 0) { specHud.set('MIC ERROR ' + rc); return; }
  specRunning = true; specLastLog = lume._nowMs(); specFpsFrames = 0;
  specHud.set('16kHz  ' + specN + ' FFT');
  if (specTimer === null) specTimer = lume.system.setInterval(specTick, 50);
}
function specStop() {
  if (!specRunning) return;
  specRunning = false;
  if (specTimer !== null) { lume.system.clearInterval(specTimer); specTimer = null; }
  lume.audio.stopStream();
  specHud.set('TAP TO LISTEN');
}
function specToggle() { if (specRunning) specStop(); else specStart(); }
function specDraw(ctx) {
  specRev();
  ctx.fillColor('#07111D'); ctx.fillRect(0, 0, specW, specH);
  var width = 10, gap = 2, base = specH - 5;
  for (var i = 0; i < specBars; i++) {
    var h = Math.round(specLevels[i] * (specH - 12));
    if (h > 0) {
      ctx.fillColor(specLevels[i] > 0.72 ? '#FF6B79' : specLevels[i] > 0.40 ? '#FFD166' : '#40D8B0');
      ctx.fillRect(5 + i * (width + gap), base - h, width, h);
    }
    var py = base - Math.round(specPeaks[i] * (specH - 12));
    ctx.fillColor('#E9F5FF'); ctx.fillRect(5 + i * (width + gap), py, width, 2);
  }
  return { x: 0, y: 0, w: specW, h: specH };
}

/* r202: key texts moved into [84,396]; the 400x200 spectrum canvas is a
   harness budget anchor (dirty rect) and is untouched. */
var specCanvas = Canvas({ width: specW, height: specH,
  style: { position: 'absolute', x: 40, y: 149 }, onDraw: specDraw });
var specRoot = View({ style: { width: '100%', height: '100%', background: '#0D1420', scroll: 'none' } }, [
  Text({ text: 'LIVE SPECTRUM', style: { position: 'absolute', x: 84, y: 80, width: 312, height: 34, fontSize: 22, color: '#F2F7FB', borderRadius: 0 } }),
  Text({ text: function () { return specHud(); }, style: { position: 'absolute', x: 84, y: 114, width: 312, height: 25, fontSize: 14, color: '#9EB3C6', borderRadius: 0 } }),
  specCanvas,
  Text({ text: function () { return 'VU ' + Math.round(specVu() * 100) + '%'; }, style: { position: 'absolute', x: 84, y: 352, width: 312, height: 28, fontSize: 18, color: '#40D8B0', borderRadius: 0 } }),
  Text({ text: 'TAP START / STOP   SWIPE UP 256 / 512', style: { position: 'absolute', x: 84, y: 382, width: 312, height: 22, fontSize: 12, color: '#9EB3C6', textAlign: 'center', borderRadius: 0 } })
]);
lume.gesture.on(specRoot, 'tap', specToggle);
lume.gesture.on(specCanvas, 'tap', specToggle);
lume.gesture.on(specRoot, 'swipe', function (e) {
  if (e.dir === 1) { specN = specN === 512 ? 256 : 512; specHud.set('16kHz  ' + specN + ' FFT'); }
});
lume.gesture.on(specCanvas, 'swipe', function (e) {
  if (e.dir === 1) { specN = specN === 512 ? 256 : 512; specHud.set('16kHz  ' + specN + ' FFT'); }
});
