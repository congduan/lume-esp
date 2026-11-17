function check(ok, message) { if (!ok) throw Error(message); }
function near(actual, expected, tolerance, label) {
  check(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
}
function sameBits(actual, expected, label) {
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
  const b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
  check(a.length === b.length, label + ' length');
  for (let i = 0; i < a.length; i++) check(a[i] === b[i], label + ' bit ' + i + ': ' + a[i] + ' vs ' + b[i]);
}
function dft(input) {
  const n = input.length, out = new Float32Array(n);
  let dc = 0, nyquist = 0;
  for (let t = 0; t < n; t++) { dc += input[t]; nyquist += (t & 1 ? -1 : 1) * input[t]; }
  out[0] = dc; out[1] = nyquist;
  for (let k = 1; k < n / 2; k++) {
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      re += input[t] * Math.cos(angle); im += input[t] * Math.sin(angle);
    }
    out[2*k] = re; out[2*k+1] = im;
  }
  return out;
}
for (const n of [8, 16]) {
  const impulse = new Float32Array(n); impulse[0] = 1;
  check(lume.fft.realfft(impulse) === 0, 'impulse status');
  const expected = new Float32Array(n); expected[0] = 1;
  for (let k = 1; k < n / 2; k++) expected[2*k] = 1;
  expected[1] = 1;
  sameBits(impulse, expected, n + '-point impulse known DFT');
  const alternating = Float32Array.from({length:n}, (_, i) => i & 1 ? -1 : 1);
  check(lume.fft.realfft(alternating) === 0, 'alternating status');
  near(alternating[1], n, 0, 'Nyquist');
  for (let k = 2; k < n; k++) near(alternating[k], 0, 1e-5, 'alternating other bins');
  const sample = Float32Array.from({length:n}, (_, i) => (i*i % 7) - 3);
  const reference = dft(sample);
  const transformed = new Float32Array(n);
  check(lume.fft.realfft(sample, transformed) === 0, 'out status');
  for (let k = 0; k < n; k++) near(transformed[k], reference[k], 1e-5, n + '-point DFT bin ' + k);
  const mag = new Float32Array(n/2);
  check(lume.fft.magnitude(mag, transformed) === 0, 'packed magnitude status');
  for (let k = 0; k < n/2; k++) near(mag[k], k ? Math.hypot(reference[2*k], reference[2*k+1]) : Math.abs(reference[0]), 1e-5, 'magnitude');
}
print('PASS 8/16-point known DFT, Float32 bit patterns, packed magnitude');
const n = 1024, input = Float32Array.from({length:n}, (_, i) => Math.sin(2 * Math.PI * 64 * i / n));
const spectral = new Float32Array(n), magnitudes = new Float32Array(n/2);
check(lume.fft.realfft(input, spectral) === 0, 'sine fft');
check(lume.fft.magnitude(magnitudes, spectral) === 0, 'sine magnitude');
let peak = 0;
for (let k = 1; k < magnitudes.length; k++) if (magnitudes[k] > magnitudes[peak]) peak = k;
check(peak === 64, '1kHz at 16kHz peak bin ' + peak);
const timeEnergy = input.reduce((sum, value) => sum + value*value, 0);
let frequencyEnergy = spectral[0]**2 + spectral[1]**2;
for (let k = 1; k < n/2; k++) frequencyEnergy += 2 * (spectral[2*k]**2 + spectral[2*k+1]**2);
near(frequencyEnergy/n, timeEnergy, 0.001, 'Parseval');
print('PASS 1kHz peak bin 64/1024 and Parseval');
const base = new Float32Array(20); base.fill(77);
const view = base.subarray(2, 10); view.fill(0); view[0] = 1;
check(lume.fft.realfft(view) === 0, 'offset realfft');
check(base[0] === 77 && base[1] === 77 && base[10] === 77, 'offset guards');
const outBase = new Float32Array(22); outBase.fill(99);
const outView = outBase.subarray(3, 11);
const separate = new Float32Array(8); separate[0] = 1;
check(lume.fft.realfft(separate, outView) === 0, 'offset output');
sameBits(outView, view, 'offset output bits');
check(outBase[2] === 99 && outBase[11] === 99, 'output guards');
const magBase = new Float32Array(10); magBase.fill(55);
check(lume.fft.magnitude(magBase.subarray(2, 6), outView) === 0, 'offset magnitude');
check(magBase[1] === 55 && magBase[6] === 55, 'magnitude guards');
const splitRe = new Float32Array([3, 4, 0, 0]), splitIm = new Float32Array([0, 3, 0, 0]);
const splitMag = new Float32Array(4);
check(lume.fft.magnitude(splitMag, splitRe, splitIm) === 0, 'split magnitude');
near(splitMag[1], 5, 0, 'split magnitude value');
print('PASS offset views, guards, split magnitude');
check(lume.fft.realfft([]) === -1, 'type input');
check(lume.fft.realfft(new Float32Array(8), []) === -1, 'type output');
for (const bad of [0, 1, 3, 4097, 8192]) check(lume.fft.realfft(new Float32Array(bad)) === -2, 'length ' + bad);
check(lume.fft.realfft(new Float32Array(8), new Float32Array(4)) === -2, 'output length');
check(lume.fft.magnitude([], new Float32Array(8)) === -1, 'magnitude type');
check(lume.fft.magnitude(new Float32Array(3), new Float32Array(8)) === -2, 'magnitude length');
check(lume.fft.magnitude(new Float32Array(4), new Float32Array(4), new Float32Array(3)) === -2, 'split length');
check(lume.fft.magnitude(outView.subarray(0, 4), outView) === -2, 'overlap');
print('PASS error codes for type, length, non-power-of-two, limit, overlap');
function jsButterflies(real, imaginary) {
  let j = 0;
  for (let i = 1; i < real.length; i++) {
    let bit = real.length >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
      tmp = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = tmp;
    }
  }
  for (let width = 2; width <= real.length; width <<= 1) {
    const stepRe = Math.cos(-2*Math.PI/width), stepIm = Math.sin(-2*Math.PI/width);
    for (let start = 0; start < real.length; start += width) {
      let twRe = 1, twIm = 0;
      for (let k = 0; k < width/2; k++) {
        const a = start+k, b = a+width/2;
        const vr = twRe*real[b]-twIm*imaginary[b], vi = twRe*imaginary[b]+twIm*real[b];
        const ur = real[a], ui = imaginary[a];
        real[a] = ur+vr; imaginary[a] = ui+vi;
        real[b] = ur-vr; imaginary[b] = ui-vi;
        const nextRe = twRe*stepRe-twIm*stepIm;
        twIm = twRe*stepIm+twIm*stepRe; twRe = nextRe;
      }
    }
  }
}
const iterations = 1000;
let start = Date.now();
for (let i = 0; i < iterations; i++) jsButterflies(new Float32Array(input), new Float32Array(n));
const jsMs = (Date.now()-start)/iterations;
start = Date.now();
for (let i = 0; i < iterations; i++) lume.fft.realfft(input, spectral);
const nativeMs = (Date.now()-start)/iterations;
print('PERF 1024-point mean over 1000 calls: JS butterflies=' + jsMs.toFixed(4) + ' ms native=' + nativeMs.toFixed(4) + ' ms (host single sample; not ESP32-S3)');
