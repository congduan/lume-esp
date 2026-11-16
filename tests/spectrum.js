/* Ten host checks. Synthetic PCM stands in for the emu's ES7210 register stub. */
const assert = require('node:assert/strict');
const { buildSync } = require('../tools/lume/node_modules/esbuild');
const { runApp } = require('./lib/prelude_runner');
const FFT = require('../examples/spectrum/fft.js');
const vm = require('node:vm');
function pcm(n, tones) {
  const b = new ArrayBuffer(n * 4), v = new DataView(b);
  for (let i = 0; i < n; i++) {
    const x = tones.reduce((a, t) => a + t[1] * Math.sin(2 * Math.PI * t[0] * i / n), 0);
    const s = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
  }
  return b;
}
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS spectrum ' + name); }
check('single sine peak ±1 bin', () => {
  const r = FFT.analyze(pcm(512, [[16, .8]]), 512, 16000);
  assert.ok(Math.abs(r.peakBin - 16) <= 1);
  assert.ok(Math.abs(r.peakHz - 500) <= 31.25);
});
check('two tones produce two peaks', () => {
  const r = FFT.analyze(pcm(512, [[12, .5], [60, .35]]), 512, 16000);
  assert.ok(r.bins[12] > .45 && r.bins[60] > .30);
});
check('Hann coherent gain normalization', () => {
  const r = FFT.analyze(pcm(512, [[24, .5]]), 512, 16000);
  assert.ok(Math.abs(r.bins[24] - .5) < .015, r.bins[24]);
});
check('log groups strictly advance', () => {
  const g = FFT.groupBounds(512, 32);
  assert.equal(g.length, 32);
  assert.equal(g[0][0], 1); assert.equal(g[31][1], 256);
  assert.ok(g.every((v, i) => v[1] > v[0] && (!i || v[0] === g[i - 1][1])));
});
check('256 FFT and 32 bars bounded', () => {
  const r = FFT.analyze(pcm(256, [[8, .8]]), 256, 16000);
  assert.equal(FFT.bars(r.bins, 32).length, 32);
  assert.ok(FFT.bars(r.bins, 32).every(v => v >= 0 && v <= 1));
  const chirp = new ArrayBuffer(256 * 4), view = new DataView(chirp);
  let phase = 0;
  for (let i = 0; i < 256; i++) {
    phase += 2 * Math.PI * (200 + i * 6) / 16000;
    const s = Math.round(Math.sin(phase) * 25000);
    view.setInt16(i * 4, s, true); view.setInt16(i * 4 + 2, s, true);
  }
  assert.ok(FFT.analyze(chirp, 256, 16000).vu > .4);
});
const bundled = buildSync({ entryPoints: ['examples/spectrum/app.js'], bundle: true,
  format: 'iife', platform: 'neutral', write: false }).outputFiles[0].text;
let active = false, sampleCount = 0, stopped = 0, drop = 0;
const logs = [];
const ui = runApp(bundled, { onLog: s => logs.push(s), audio: {
  _recordStream: n => { active = true; sampleCount = n; return 0; },
  _stopStream: () => { active = false; stopped++; return 0; },
  recordStreamDropped: () => drop,
} });
const rootId = ui.messages.findLast(m => m[0] === 'gesture')[1];
function tap() { ui.gesture(rootId, 0, 100, 200, 0); ui.gesture(rootId, 2, 100, 200, 100); }
check('tap starts one 1024-frame stream', () => { tap(); assert.equal(active, true); assert.equal(sampleCount, 1024); });
check('callback does not redraw canvas', () => {
  const before = ui.messages.filter(m => m[0] === 'invalidate').length;
  ui.ctx.__lume_dispatchAudioChunk(pcm(1024, [[32, .8]]), 1024);
  const after = ui.messages.filter(m => m[0] === 'invalidate').length;
  assert.equal(after, before);
});
check('timer signal drives 400x200 dirty rect', () => {
  vm.runInContext('__lume_tick()', ui.ctx);
  const a = ui.messages.filter(m => m[0] === 'invalidate');
  assert.ok(a.some(m => m.length === 6 && m[2] === 0 && m[3] === 0 && m[4] === 400 && m[5] === 200));
});
check('drop count and SPEC serial event', () => {
  drop = 3;
  ui.lume._nowMs = () => Date.now() + 1100;
  vm.runInContext('__lume_tick()', ui.ctx);
  assert.ok(logs.some(s => /^SPEC fps=\d+ drop=3 peak=\d+$/.test(s)));
});
check('stopStream clears callback and capture', () => {
  tap(); assert.equal(active, false); assert.equal(stopped, 1);
  const count = ui.messages.length;
  ui.ctx.__lume_dispatchAudioChunk(pcm(1024, [[32, .8]]), 1024);
  assert.equal(ui.messages.length, count);
});
assert.equal(checks, 10);
