// r92 host cases for lume.compress. Executed inside QuickJS by compress_host.c,
// which registers the EXACT firmware lume_compress.c (+ vendored tinfl).
// Node zlib fixtures are injected as `__FIXTURES` by tests/compress.js.
function check(ok, message) { if (!ok) throw Error(message); }
function fromHex(text) {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}
function toHex(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += ('0' + bytes[i].toString(16)).slice(-2);
  return text;
}
function expectBytes(actual, expected, label) {
  check(actual.length === expected.length, label + ': length ' + actual.length + ' vs ' + expected.length);
  for (let i = 0; i < expected.length; i++)
    check(actual[i] === expected[i], label + ': byte ' + i + ' ' + actual[i] + ' vs ' + expected[i]);
}
function roundtrip(payloadHex, srcHex, format, label, pad) {
  const payload = fromHex(payloadHex), src = fromHex(srcHex);
  const out = new Uint8Array(payload.length + (pad || 8));
  const n = lume.compress.inflate(src, out, format);
  check(n === payload.length, label + ': return ' + n + ' vs ' + payload.length);
  expectBytes(out.subarray(0, n), payload, label);
  return n;
}

check(typeof __FIXTURES === 'object', 'fixtures not injected');
const F = __FIXTURES;

// 1. Correctness: Node zlib fixtures decompressed by the firmware C, byte-exact.
for (const key of ['empty', 'text', 'rle', 'random', 'big']) {
  const item = F.payloads[key];
  roundtrip(item.payload, item.raw, 'raw', key + ' raw');
  roundtrip(item.payload, item.zlib, 'zlib', key + ' zlib');
  const n = lume.compress.inflate(fromHex(item.raw), new Uint8Array(fromHex(item.payload).length), 'raw');
  check(n === F.lengths[key], key + ' raw exact-size out');
}
print('PASS correctness: empty / repetitive text / RLE / random stored / >64KiB dynamic (raw+zlib, byte-exact)');

// 2. Default format is raw when omitted or null.
const textRaw = fromHex(F.payloads.text.raw);
const textPayload = fromHex(F.payloads.text.payload);
check(lume.compress.inflate(textRaw, new Uint8Array(textPayload.length)) === textPayload.length, 'omitted format defaults raw');
check(lume.compress.inflate(textRaw, new Uint8Array(textPayload.length), null) === textPayload.length, 'null format defaults raw');
print('PASS default format (omitted/null) is raw');

// 3. Damaged inputs: truncated, bad zlib header, reserved block type, bad Adler-32.
const badOut = new Uint8Array(1 << 17);
for (const key of ['truncated', 'badHeader', 'badBlock', 'badAdler'])
  check(lume.compress.inflate(fromHex(F.damaged[key]), badOut, key === 'badHeader' || key === 'badAdler' ? 'zlib' : 'raw') < 0,
        key + ' rejected');
print('PASS damaged streams rejected (truncated / bad header / reserved BTYPE / Adler mismatch)');

// 4. Output too small -> -3, no write beyond the out view (guard region intact).
const tinyBase = new Uint8Array(16).fill(0x5A);
const tiny = tinyBase.subarray(0, 8);
check(lume.compress.inflate(textRaw, tiny, 'raw') === -3, 'out too small -> -3');
for (let i = 8; i < tinyBase.length; i++) check(tinyBase[i] === 0x5A, 'tiny guard ' + i);
print('PASS out-too-small -> -3 with no out-of-bounds write');

// 5. Offset (subarray/byteOffset) views on both src and out.
const srcBase = new Uint8Array(textRaw.length + 9).fill(0xCC);
srcBase.set(textRaw, 4);
const outBase = new Uint8Array(textPayload.length + 11).fill(0x77);
const nOff = lume.compress.inflate(srcBase.subarray(4, 4 + textRaw.length),
                                   outBase.subarray(5, 5 + textPayload.length), 'raw');
check(nOff === textPayload.length, 'offset inflate return');
expectBytes(outBase.subarray(5, 5 + textPayload.length), textPayload, 'offset inflate bytes');
for (let i = 0; i < 4; i++) check(srcBase[i] === 0xCC, 'src prefix guard ' + i);
for (let i = 4 + textRaw.length; i < srcBase.length; i++) check(srcBase[i] === 0xCC, 'src suffix guard ' + i);
for (let i = 0; i < 5; i++) check(outBase[i] === 0x77, 'out prefix guard ' + i);
for (let i = 5 + textPayload.length; i < outBase.length; i++) check(outBase[i] === 0x77, 'out suffix guard ' + i);
print('PASS subarray/byteOffset views on src and out with guards intact');

// 6. Error contract: negative codes, no JS exceptions.
check(lume.compress.inflate('not a typed array', new Uint8Array(8)) === -1, 'bad src type');
check(lume.compress.inflate(textRaw, new ArrayBuffer(8)) === -1, 'bad out type');
check(lume.compress.inflate(textRaw, new Uint8Array(8), 123) === -1, 'bad format type');
check(lume.compress.inflate(textRaw, new Uint8Array(8), 'gzip') === -1, 'bad format string');
check(lume.compress.inflate() === -1, 'missing args');
print('PASS error contract: -1 type / -2 data / -3 length, no exceptions');

// 7. Host-only performance sample (single process, NOT ESP32-S3).
const perfSrc = fromHex(F.perf.src);
const rounds = F.perf.rounds;
const perfOut = new Uint8Array(F.perf.outLen);
let sink = 0;
let t0 = Date.now();
for (let i = 0; i < rounds; i++) sink += lume.compress.inflate(perfSrc, perfOut, 'zlib');
const nativeMs = Date.now() - t0;
print('PERF native inflate ' + rounds + 'x ' + F.perf.outLen + 'B: ' + nativeMs + 'ms (sink=' + sink + ', NOT ESP32-S3)');
print('ALL OK');
