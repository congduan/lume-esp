/* Reusable radix-2 real-input spectrum. CommonJS is bundled by esbuild on device. */
function analyze(pcm, n, sampleRate) {
  if (n !== 256 && n !== 512) throw new Error('FFT size must be 256 or 512');
  var view = new DataView(pcm), available = Math.floor(view.byteLength / 4);
  if (available < n) throw new Error('short PCM chunk');
  var re = new Float64Array(n), im = new Float64Array(n);
  var sumWindow = 0, sumSquares = 0;
  for (var i = 0; i < n; i++) {
    var mono = (view.getInt16(4 * i, true) + view.getInt16(4 * i + 2, true)) / 65536;
    var window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    re[i] = mono * window;
    sumWindow += window;
    sumSquares += mono * mono;
  }
  for (var i = 1, j = 0; i < n; i++) {
    var bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (var len = 2; len <= n; len <<= 1) {
    var angle = -2 * Math.PI / len, cr = Math.cos(angle), ci = Math.sin(angle);
    for (var base = 0; base < n; base += len) {
      var wr = 1, wi = 0;
      for (var k = 0; k < len / 2; k++) {
        var a = base + k, b = a + len / 2;
        var tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        var next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next;
      }
    }
  }
  var bins = new Float64Array(n / 2), peak = 1;
  for (var i = 1; i < bins.length; i++) {
    bins[i] = 2 * Math.sqrt(re[i] * re[i] + im[i] * im[i]) / sumWindow;
    if (bins[i] > bins[peak]) peak = i;
  }
  return { bins: bins, peakBin: peak, peakHz: peak * sampleRate / n,
           vu: Math.sqrt(sumSquares / n) };
}
function groupBounds(n, count) {
  var out = [], last = 1, max = n / 2;
  for (var i = 0; i < count; i++) {
    var next = i === count - 1 ? max : Math.max(last + 1,
      Math.round(Math.exp(Math.log(max) * (i + 1) / count)));
    if (next > max) next = max;
    out.push([last, next]); last = next;
  }
  return out;
}
function bars(bins, count) {
  var bounds = groupBounds(bins.length * 2, count), out = [];
  for (var i = 0; i < bounds.length; i++) {
    var value = 0;
    for (var k = bounds[i][0]; k < bounds[i][1]; k++) value = Math.max(value, bins[k]);
    out.push(Math.max(0, Math.min(1, (20 * Math.log10(value + 1e-6) + 70) / 70)));
  }
  return out;
}
module.exports = { analyze: analyze, groupBounds: groupBounds, bars: bars };
