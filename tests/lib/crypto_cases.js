// r91 host cases for lume.crypto. Executed inside QuickJS by crypto_host.c,
// which registers the EXACT firmware lume_crypto.c against IDF mbedTLS.
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
function expectHex(actual, expected, label) {
  const got = toHex(actual);
  check(got === expected, label + ': ' + got + ' vs ' + expected);
}
const B32 = () => new Uint8Array(32);

// SHA-256: NIST FIPS 180-4 vectors (empty, "abc", 56-byte two-block input).
const shaCases = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
   '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']
];
for (const [text, want] of shaCases) {
  const input = fromHex(text.split('').map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  const out = B32();
  check(lume.crypto.sha256(input, out) === 0, 'sha256 status');
  expectHex(out, want, 'sha256(' + text + ')');
}
print('PASS SHA-256 NIST vectors: empty / abc / 56-byte two-block');

// HMAC-SHA256: RFC 4231 cases 1 (0x0b key), 2 ("Jefe"), 3 (0xaa key).
function fill(byte, n) { return new Uint8Array(n).fill(byte); }
const hmacCases = [
  [fill(0x0b, 20), fromHex('4869205468657265'), 'Hi There',
   'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
  [fromHex('4a656665'), fromHex('7768617420646f2079612077616e7420666f72206e6f7468696e673f'), 'what do ya want for nothing?',
   '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
  [fill(0xaa, 20), fill(0xdd, 50), '0xdd*50',
   '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe']
];
for (const [key, data, label, want] of hmacCases) {
  const out = B32();
  check(lume.crypto.hmacSha256(key, data, out) === 0, 'hmac status ' + label);
  expectHex(out, want, 'hmacSha256 ' + label);
}
print('PASS HMAC-SHA256 RFC 4231 cases 1/2/3');

// CRC-32: reflected poly 0xEDB88320, zlib seed semantics.
check(lume.crypto.crc32(fromHex('313233343536373839')) === 0xCBF43926, 'crc32 123456789');
function crc32js(bytes, seed) {
  let crc = (seed ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = ((crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
const crcInput = fromHex('0001020304050607080910111213141516171819');
const crcSeed = 0x12345678;
check(lume.crypto.crc32(crcInput) === crc32js(crcInput, 0), 'crc32 JS cross-check fresh');
check(lume.crypto.crc32(crcInput, crcSeed) === crc32js(crcInput, crcSeed), 'crc32 JS cross-check seed');
print('PASS CRC-32 0xCBF43926 + JS reference cross-check (seed/no-seed)');

// AES-CTR: NIST SP 800-38A F.5.1 (AES-128) and F.5.2 (AES-256).
const iv = fromHex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
const pt2 = fromHex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51');
const ct2 = fromHex('874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff');
const key128 = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
const enc = new Uint8Array(32);
check(lume.crypto.aesCtr(key128, iv, pt2, enc) === 0, 'aes128 ctr status');
expectHex(enc, toHex(ct2), 'aes128 ctr encrypt');
const dec = new Uint8Array(32);
check(lume.crypto.aesCtr(key128, iv, ct2, dec) === 0, 'aes128 ctr decrypt status');
expectHex(dec, toHex(pt2), 'aes128 ctr decrypt');
const key256 = fromHex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4');
const enc256 = new Uint8Array(16);
check(lume.crypto.aesCtr(key256, iv, pt2.subarray(0, 16), enc256) === 0, 'aes256 ctr status');
expectHex(enc256, '601ec313775789a5b7a7f504bbf3d228', 'aes256 ctr encrypt');
const inplace = new Uint8Array(pt2);
check(lume.crypto.aesCtr(key128, iv, inplace, inplace) === 0, 'aes128 ctr in-place status');
expectHex(inplace, toHex(ct2), 'aes128 ctr in-place');
check(toHex(iv) === 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff', 'iv not mutated');
print('PASS AES-128/256-CTR SP 800-38A F.5 vectors + CTR symmetry + in-place');

// Offset views: every primitive honours subarray byteOffset on input and out.
const shaBase = new Uint8Array(40).fill(0xCC); shaBase.set(fromHex('616263'), 4);
const shaOutBase = new Uint8Array(40).fill(0x55);
check(lume.crypto.sha256(shaBase.subarray(4, 7), shaOutBase.subarray(5, 37)) === 0, 'offset sha status');
expectHex(shaOutBase.subarray(5, 37), shaCases[1][1], 'offset sha digest');
check(shaBase[3] === 0xCC && shaBase[7] === 0xCC && shaOutBase[4] === 0x55 && shaOutBase[37] === 0x55,
      'offset sha guards');
const hmacBase = new Uint8Array(40); hmacBase.set(fill(0x0b, 20), 3); hmacBase.set(fromHex('4869205468657265'), 25);
const hmacOut = B32();
check(lume.crypto.hmacSha256(hmacBase.subarray(3, 23), hmacBase.subarray(25, 33), hmacOut) === 0, 'offset hmac status');
expectHex(hmacOut, hmacCases[0][3], 'offset hmac digest');
const crcBase = new Uint8Array(20); crcBase.set(fromHex('313233343536373839'), 6);
check(lume.crypto.crc32(crcBase.subarray(6, 15)) === 0xCBF43926, 'offset crc32');
const keyBase = new Uint8Array(20); keyBase.set(key128, 2);
const ivBase = new Uint8Array(20); ivBase.set(iv, 1);
const dataBase = new Uint8Array(40); dataBase.set(pt2, 4);
const ctrOut = new Uint8Array(40).fill(0x77);
check(lume.crypto.aesCtr(keyBase.subarray(2, 18), ivBase.subarray(1, 17),
                         dataBase.subarray(4, 36), ctrOut.subarray(3, 35)) === 0, 'offset aes status');
expectHex(ctrOut.subarray(3, 35), toHex(ct2), 'offset aes ciphertext');
check(ctrOut[2] === 0x77 && ctrOut[35] === 0x77 && dataBase[3] === 0 && dataBase[36] === 0,
      'offset aes guards');
print('PASS subarray/byteOffset views for all four primitives');

// Error contract: 0 success, negative failure; never a JS exception.
const bad = 'not a typed array';
check(lume.crypto.sha256(bad, B32()) === -1, 'sha256 bad data type');
check(lume.crypto.sha256(fromHex('616263'), new ArrayBuffer(32)) === -1, 'sha256 bad out type');
check(lume.crypto.sha256(fromHex('616263'), new Uint8Array(31)) === -2, 'sha256 short out');
check(lume.crypto.hmacSha256(fill(0x0b, 20), bad, B32()) === -1, 'hmac bad data type');
check(lume.crypto.hmacSha256(fill(0x0b, 20), fromHex('616263'), new Uint8Array(31)) === -2, 'hmac short out');
check(lume.crypto.crc32(bad) === -1, 'crc32 bad type');
check(lume.crypto.crc32(fromHex('616263'), bad) === -1, 'crc32 bad seed');
check(lume.crypto.aesCtr(new Uint8Array(15), iv, pt2, new Uint8Array(32)) === -2, 'aes key len 15');
check(lume.crypto.aesCtr(new Uint8Array(23), iv, pt2, new Uint8Array(32)) === -2, 'aes key len 23');
check(lume.crypto.aesCtr(new Uint8Array(24), iv, new Uint8Array(16), new Uint8Array(16)) === 0, 'aes key len 24 valid');
check(lume.crypto.aesCtr(key128, new Uint8Array(15), pt2, new Uint8Array(32)) === -2, 'aes iv len');
check(lume.crypto.aesCtr(key128, iv, pt2, new Uint8Array(31)) === -2, 'aes short out');
check(lume.crypto.aesCtr(key128, iv, bad, new Uint8Array(32)) === -1, 'aes bad data type');
print('PASS error contract: -1 type / -2 length, no exceptions');

// Host-only performance sample (single process, not representative of ESP32-S3).
const perf = fromHex('00010203040506070809101112131415161718191a1b1c1d1e1f' +
                     '202122232425262728292a2b2c2d2e2f303132333435363738393a3b');
const rounds = 20000;
let t0 = Date.now();
for (let i = 0; i < rounds; i++) lume.crypto.crc32(perf);
const nativeMs = Date.now() - t0;
t0 = Date.now();
let sink = 0;
for (let i = 0; i < rounds; i++) sink = crc32js(perf, 0);
const jsMs = Date.now() - t0;
print('PERF host single sample (' + rounds + 'x 60B): native=' + nativeMs + 'ms js=' + jsMs +
      'ms ratio=' + (jsMs / Math.max(nativeMs, 1)).toFixed(1) + 'x (sink=' + sink + ', NOT ESP32-S3)');
print('ALL OK');
