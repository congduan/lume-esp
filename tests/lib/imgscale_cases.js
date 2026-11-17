function check(ok, message) { if (!ok) throw Error(message); }
function sameBits(actual, expected, label) {
  const a = new Uint16Array(actual.buffer, actual.byteOffset, actual.length);
  const b = new Uint16Array(expected.buffer, expected.byteOffset, expected.length);
  check(a.length === b.length, label + ' length');
  for (let i = 0; i < a.length; i++) check(a[i] === b[i], label + ' bit ' + i + ': ' + a[i].toString(16) + ' vs ' + b[i].toString(16));
}
function hex(values) { return Array.from(values, v => '0x' + v.toString(16).padStart(4, '0')).join(' '); }

// --- Reference implementations (mirror the C fixed-point algorithm) --------
function refNearest(src, sw, sh, dw, dh) {
  const out = new Uint16Array(dw * dh);
  const axis = (d, ds, ss) => {
    const p = Math.floor((2 * d + 1) * ss / (2 * ds));
    return p < 0 ? 0 : p >= ss ? ss - 1 : p;
  };
  for (let y = 0; y < dh; y++) {
    const sy = axis(y, dh, sh);
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + axis(x, dw, sw)];
  }
  return out;
}
function refBilinear(src, sw, sh, dw, dh) {
  const out = new Uint16Array(dw * dh), FP = 256;
  const axis = (d, ds, ss) => {
    let p = Math.floor((2 * d + 1) * ss * FP / (2 * ds)) - FP / 2;
    const hi = (ss - 1) * FP;
    return p < 0 ? 0 : p > hi ? hi : p;
  };
  const ch = (a, b, c, d, shift, mask, fx, fy) => {
    const gx = FP - fx, gy = FP - fy;
    const v = (((a >> shift) & mask) * gx * gy + ((b >> shift) & mask) * fx * gy +
      ((c >> shift) & mask) * gx * fy + ((d >> shift) & mask) * fx * fy + 32768) >> 16;
    return v < 0 ? 0 : v > mask ? mask : v;
  };
  for (let y = 0; y < dh; y++) {
    const sy = axis(y, dh, sh), y0 = sy >> 8, fy = sy & 255;
    const y1 = Math.min(y0 + 1, sh - 1);
    for (let x = 0; x < dw; x++) {
      const sx = axis(x, dw, sw), x0 = sx >> 8, fx = sx & 255;
      const x1 = Math.min(x0 + 1, sw - 1);
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = ((ch(a, b, c, d, 11, 31, fx, fy) << 11) |
        (ch(a, b, c, d, 5, 63, fx, fy) << 5) | ch(a, b, c, d, 0, 31, fx, fy)) & 0xffff;
    }
  }
  return out;
}

// --- Correctness: nearest, exact RGB565 bit patterns ------------------------
const src2 = new Uint16Array([0xF800, 0x07E0, 0x001F, 0xFFFF]); // R, G, B, W
const up4 = new Uint16Array(16);
check(lume.imgscale.scale(src2, 2, 2, up4, 4, 4, 'nearest') === 0, 'nearest 2x up status');
const expectUp = new Uint16Array([
  0xF800, 0xF800, 0x07E0, 0x07E0,
  0xF800, 0xF800, 0x07E0, 0x07E0,
  0x001F, 0x001F, 0xFFFF, 0xFFFF,
  0x001F, 0x001F, 0xFFFF, 0xFFFF,
]);
sameBits(up4, expectUp, 'nearest 2x upsample');
sameBits(up4, refNearest(src2, 2, 2, 4, 4), 'nearest 2x upsample vs reference');
print('PASS nearest 2x upsample, exact RGB565 bits: ' + hex(expectUp.slice(0, 4)) + ' ...');

const src4 = Uint16Array.from({length: 16}, (_, i) => i + 1);
const down2 = new Uint16Array(4);
check(lume.imgscale.scale(src4, 4, 4, down2, 2, 2, 'nearest') === 0, 'nearest 2x down status');
sameBits(down2, new Uint16Array([6, 8, 14, 16]), 'nearest 2x downsample');
sameBits(down2, refNearest(src4, 4, 4, 2, 2), 'nearest 2x downsample vs reference');
print('PASS nearest 2x downsample, centre taps = ' + hex(down2));

// --- Bilinear: hand-computable cases ----------------------------------------
// 3x1 [red, black, green] -> 2x1. sx(0)=0.25 (weight 0.75/0.25 on P0/P1),
// sx(1)=1.75 (weight 0.25/0.75 on P1/P2).
//   out0.R = round(0.75*31) = 23 => 0xB800
//   out1.G = round(0.75*63) = 47 => 0x05E0
const strip = new Uint16Array([0xF800, 0x0000, 0x07E0]);
const stripOut = new Uint16Array(2);
check(lume.imgscale.scale(strip, 3, 1, stripOut, 2, 1, 'bilinear') === 0, 'bilinear strip status');
sameBits(stripOut, new Uint16Array([0xB800, 0x05E0]), 'bilinear hand-computed strip');
print('PASS bilinear hand case 3x1->2x1 = ' + hex(stripOut));

// 2x2 [R,G;B,W] -> 3x3; centre samples all four at 0.25 each:
// R=(31+0+0+31)/4=16, G=(0+63+0+63)/4=32, B=(0+0+31+31)/4=16 => 0x8410.
const quad = new Uint16Array([0xF800, 0x07E0, 0x001F, 0xFFFF]);
const quadOut = new Uint16Array(9);
check(lume.imgscale.scale(quad, 2, 2, quadOut, 3, 3, 'bilinear') === 0, 'bilinear quad status');
check(quadOut[4] === 0x8410, 'bilinear centre 0x' + quadOut[4].toString(16) + ' vs 0x8410');
sameBits(quadOut, refBilinear(quad, 2, 2, 3, 3), 'bilinear quad vs reference');
print('PASS bilinear 2x2->3x3, centre=0x' + quadOut[4].toString(16) + ' (channel separation)');

// Non-trivial 5x4 -> 9x7 bilinear vs reference, plus default mode = nearest.
const w = 5, h = 4;
const noise = Uint16Array.from({length: w * h}, (_, i) =>
  (((i * 7) & 31) << 11) | (((i * 11) & 63) << 5) | ((i * 13) & 31));
const bigOut = new Uint16Array(9 * 7);
check(lume.imgscale.scale(noise, w, h, bigOut, 9, 7, 'bilinear') === 0, 'bilinear 5x4->9x7 status');
sameBits(bigOut, refBilinear(noise, w, h, 9, 7), 'bilinear 5x4->9x7 vs reference');
const defaultOut = new Uint16Array(16);
check(lume.imgscale.scale(src2, 2, 2, defaultOut, 4, 4) === 0, 'default mode status');
sameBits(defaultOut, up4, 'omitted mode == nearest');
print('PASS bilinear 5x4->9x7 reference + omitted-mode defaults to nearest');

// --- Offset views (subarray) ------------------------------------------------
const srcBase = new Uint16Array(8); srcBase.fill(0x1234);
srcBase.set(src2, 2);
const srcView = srcBase.subarray(2, 6);
const dstBase = new Uint16Array(20); dstBase.fill(0x5678);
const dstView = dstBase.subarray(3, 19);
check(lume.imgscale.scale(srcView, 2, 2, dstView, 4, 4, 'nearest') === 0, 'offset view status');
check(srcBase[0] === 0x1234 && srcBase[1] === 0x1234 && srcBase[6] === 0x1234, 'src offset guards');
check(dstBase[0] === 0x5678 && dstBase[2] === 0x5678 && dstBase[19] === 0x5678, 'dst offset guards');
sameBits(dstView, expectUp, 'offset view bits');
const bv = new Uint16Array(7); bv.fill(9); bv.set(strip, 2);
const bOut = new Uint16Array(4); bOut.fill(9);
check(lume.imgscale.scale(bv.subarray(2, 5), 3, 1, bOut.subarray(1, 3), 2, 1, 'bilinear') === 0, 'offset bilinear status');
sameBits(bOut.subarray(1, 3), stripOut, 'offset bilinear bits');
check(bOut[0] === 9 && bOut[3] === 9, 'offset bilinear guards');
print('PASS subarray offset views, guards intact');

// --- Error codes ------------------------------------------------------------
check(lume.imgscale.scale([], 2, 2, new Uint16Array(16), 4, 4) === -1, 'type src');
check(lume.imgscale.scale(src2, 2, 2, [], 4, 4) === -1, 'type dst');
check(lume.imgscale.scale(src2, 2, 2, new Uint16Array(16), 4, 4, 'bicubic') === -1, 'bad mode');
for (const bad of [0, -1, 16385, 2.9]) check(lume.imgscale.scale(new Uint16Array(8), bad, 1, new Uint16Array(8), 1, 1) === -2, 'bad dim ' + bad);
check(lume.imgscale.scale(src2, 2, 2, new Uint16Array(4), 4, 4) === -2, 'short dst');
check(lume.imgscale.scale(new Uint16Array(2), 4, 4, new Uint16Array(4), 2, 2) === -2, 'short src');
const shared = new Uint16Array(16); shared.fill(1);
check(lume.imgscale.scale(shared.subarray(0, 8), 2, 4, shared.subarray(4, 12), 2, 4) === -2, 'partial overlap rejected');
const same = new Uint16Array(src2);
check(lume.imgscale.scale(same, 2, 2, same, 2, 2, 'nearest') === 0, 'identical view in-place allowed');
sameBits(same, src2, 'in-place copy bits');
const sameB = new Uint16Array(quad);
check(lume.imgscale.scale(sameB, 2, 2, sameB, 2, 2, 'bilinear') === 0, 'identical view bilinear in-place');
sameBits(sameB, quad, 'in-place bilinear copy bits');
print('PASS error codes -1/-2 and identical-view in-place allowance');

// --- Performance (host single sample; NOT ESP32-S3) -------------------------
const pw = 64, ph = 64, qw = 128, qh = 128;
const psrc = Uint16Array.from({length: pw * ph}, (_, i) =>
  (((i * 7) & 31) << 11) | (((i * 11) & 63) << 5) | ((i * 13) & 31));
const pdst = new Uint16Array(qw * qh);
const iterations = 200;
let start = Date.now();
for (let i = 0; i < iterations; i++) refBilinear(psrc, pw, ph, qw, qh);
const jsMs = (Date.now() - start) / iterations;
start = Date.now();
for (let i = 0; i < iterations; i++) lume.imgscale.scale(psrc, pw, ph, pdst, qw, qh, 'bilinear');
const nativeMs = (Date.now() - start) / iterations;
print('PERF 64x64->128x128 bilinear mean over ' + iterations + ' calls: JS=' + jsMs.toFixed(4) +
  ' ms native=' + nativeMs.toFixed(4) + ' ms (host single sample; not ESP32-S3)');
