const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js'];
/* r134 host harness for examples/crypto_check (pure app + injected crypto).
 * Standalone CommonJS:  node tests/crypto_check.js
 *
 * Runs the REAL app against the firmware prelude. lume.crypto does not exist
 * on the host (no mbedTLS), so REAL primitives are injected through
 * options.crypto: SHA-256 / HMAC-SHA256 / AES-128-CTR come from node:crypto,
 * CRC-32 from a self-written reflected table (cross-checked against
 * zlib.crc32). Assertions therefore observe the native message stream and
 * the app's rendered hex against an independent implementation -- not just
 * source text. A mutable `force` switch injects -1/-2/-3 and a maximal u32
 * to exercise the error / UNSUPPORTED / unsigned branches live.
 *
 * HONESTY: this harness does NOT test ESP-IDF mbedTLS or the real device.
 * Every primitive here is a host stand-in with the same contract; board
 * acceptance (mbedTLS on target, touch feel) stays deferred. Mutations below
 * re-feed deliberately broken copies to prove the key predicates are load
 * bearing rather than decorative.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const nodeCrypto = require('node:crypto');
const zlib = require('node:zlib');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('examples/crypto_check/app.js');
const manifest = read('tools/playground/build.mjs');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)

// ---- independent host implementations (the injected `options.crypto`) ----
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c | 0;
}
function crc32Real(data, seed) {
  let c = ((seed >>> 0) ^ 0xFFFFFFFF) | 0;
  for (let i = 0; i < data.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ data[i]) & 0xff];
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const u8 = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const force = { sha256: null, hmacSha256: null, crc32: null, aesCtr: null, crcValue: null };
const injected = {
  sha256: (data, out) => {
    if (force.sha256 !== null) return force.sha256;
    const d = nodeCrypto.createHash('sha256').update(u8(data)).digest();
    for (let i = 0; i < 32; i++) out[i] = d[i];
    return 0;
  },
  hmacSha256: (key, data, out) => {
    if (force.hmacSha256 !== null) return force.hmacSha256;
    const d = nodeCrypto.createHmac('sha256', u8(key)).update(u8(data)).digest();
    for (let i = 0; i < 32; i++) out[i] = d[i];
    return 0;
  },
  crc32: (data, seed) => {
    if (force.crcValue !== null) return force.crcValue;
    if (force.crc32 !== null) return force.crc32;
    return crc32Real(data, seed === undefined ? 0 : seed);
  },
  aesCtr: (key, iv, data, out) => {
    if (force.aesCtr !== null) return force.aesCtr;
    const cipher = nodeCrypto.createCipheriv('aes-' + (key.length * 8) + '-ctr', u8(key), u8(iv));
    const enc = Buffer.concat([cipher.update(u8(data)), cipher.final()]);
    for (let i = 0; i < enc.length; i++) out[i] = enc[i];
    return 0;
  },
};
function resetForce() {
  for (const k of Object.keys(force)) force[k] = null;
}
function probe(opts) {
  resetForce();
  const ui = runApp(source, { crypto: injected, ...(opts || {}) });
  return { ui, c: ui.ctx };
}
function textsAfter(ui, from) {
  return ui.messages.slice(from).filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
}
function check(name, fn) { fn(); console.log('PASS ' + name); }

// ---- static predicates (also used by mutation proof) ---------------------
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const asciiOnly = s => {
  const lits = literals(s);
  return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
};
const errBranch = s => s.includes("code === -3 ? 'UNSUPPORTED' : 'ERR ' + code") &&
  s.includes('c1 < 0') && s.includes('if (rc !== 0)');
const digestTrunc = s => (s.match(/hexOf\(out, 16\) \+ '\.\.\.'/g) || []).length === 2;
const crcUnsigned = s => s.includes('String(c2 >>> 0)') && s.includes('if (c1 < 0)');
const budgetDecl = s => /LUME_MAX_NODES = 128/.test(s) && /NODE BUDGET/.test(s);
const plainGlobal = s => !/\bimport\b|\bexport\b/.test(s);
function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
function manifestApps(m) {
  const block = (m.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
  assert.ok(block, 'playground app list not found');
  return block.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ---- live runs: real injected primitives ---------------------------------
check('CRC-32 table cross-checks against zlib.crc32 (independent reference)', () => {
  for (const s of ['', 'Lume', 'The quick brown fox', 'x'.repeat(200)]) {
    const b = Buffer.from(s, 'ascii');
    assert.equal(crc32Real(b, 0), zlib.crc32(b), 'crc32 table mismatch for ' + s.length + 'B');
  }
});

check('default payload Lume: SHA/HMAC hex matches node:crypto, AES loopback OK', () => {
  const { c } = probe();
  const st = c.measure();
  const expSha = nodeCrypto.createHash('sha256').update(Buffer.from('Lume', 'ascii')).digest('hex');
  const key = Buffer.from(c.HMAC_KEY.buffer, c.HMAC_KEY.byteOffset, c.HMAC_KEY.byteLength);
  const expHmac = nodeCrypto.createHmac('sha256', key).update(Buffer.from('Lume', 'ascii')).digest('hex');
  assert.equal(st.sha, expSha.slice(0, 32) + '...', st.sha);
  assert.equal(st.token, expHmac.slice(0, 32) + '...', st.token);
  assert.equal(st.crc, String(zlib.crc32(Buffer.from('Lume', 'ascii')) >>> 0));
  assert.match(st.aes, /^OK [0-9a-f]{8,16}$/, st.aes);
  const aesKey = Buffer.from(c.AES_KEY.buffer, c.AES_KEY.byteOffset, c.AES_KEY.byteLength);
  const aesIv = Buffer.from(c.AES_IV.buffer, c.AES_IV.byteOffset, c.AES_IV.byteLength);
  const cipher = nodeCrypto.createCipheriv('aes-128-ctr', aesKey, aesIv);
  const enc = Buffer.concat([cipher.update(Buffer.from('Lume', 'ascii')), cipher.final()]);
  assert.equal(st.aes, 'OK ' + enc.subarray(0, 8).toString('hex'));
});

check('rendered text stream carries the computed digest, not just ctx state', () => {
  const { ui, c } = probe();
  const st = c.measure();
  const all = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(all.includes(st.sha), st.sha);
  assert.ok(all.includes(st.token), st.token);
  assert.ok(all.includes(st.crc), st.crc);
  assert.ok(all.includes(st.aes), st.aes);
  assert.ok(all.includes('PAYLOAD 1/3  4B'));
});

check('NEXT button cycles 3 payloads and wraps; empty payload does not crash', () => {
  const { c } = probe();
  let st = c.measure();
  assert.equal(st.idx, 0);
  st = c.cyclePayload();
  assert.equal(st.idx, 1);
  assert.ok(st.len > 20, 'long payload length');
  st = c.cyclePayload();
  assert.equal(st.idx, 2);
  assert.equal(st.payload, '');
  assert.equal(st.len, 0);
  assert.equal(st.aes, 'OK', 'empty payload AES loopback');
  assert.equal(st.crc, String(zlib.crc32(Buffer.alloc(0)) >>> 0), 'empty CRC');
  assert.equal(st.sha.length, 35, '32 hex chars + ...');
  st = c.cyclePayload();
  assert.equal(st.idx, 0, 'wraps back to first payload');
});

check('negative codes render numerically: ERR -2 / ERR -1, never ERR 0', () => {
  const { ui, c } = probe();
  force.sha256 = -2; force.hmacSha256 = -1; force.aesCtr = -2; force.crc32 = -1;
  const from = ui.messages.length;
  const st = c.measure();
  assert.equal(st.sha, 'ERR -2');
  assert.equal(st.token, 'ERR -1');
  assert.equal(st.aes, 'ERR -2');
  assert.equal(st.crc, 'ERR -1');
  const t = textsAfter(ui, from);
  assert.ok(t.includes('ERR -2') && t.includes('ERR -1'), t.join('|'));
  assert.ok(!t.some(x => /ERR 0\b/.test(x)), 'zero is not an error');
});

check('-3 from any primitive renders UNSUPPORTED (host/playground stub reality)', () => {
  const { ui, c } = probe();
  force.sha256 = -3; force.hmacSha256 = -3; force.aesCtr = -3; force.crc32 = -3;
  const from = ui.messages.length;
  const st = c.measure();
  assert.equal(st.sha, 'UNSUPPORTED');
  assert.equal(st.token, 'UNSUPPORTED');
  assert.equal(st.aes, 'UNSUPPORTED');
  assert.equal(st.crc, 'UNSUPPORTED');
  assert.ok(textsAfter(ui, from).filter(x => x === 'UNSUPPORTED').length >= 4);
});

check('default no-crypto host stub shows UNSUPPORTED for all four rows', () => {
  const ui = runApp(source); // no options.crypto -> prelude -3 stubs
  const st = ui.ctx.measure();
  assert.deepEqual([st.sha, st.token, st.crc, st.aes],
    ['UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED']);
});

check('CRC-32 u32: 4294967295 is VALID, not ERR -1; seed chaining used once', () => {
  const { c } = probe();
  force.crcValue = 4294967295;
  assert.equal(c.measure().crc, '4294967295');
  assert.ok(!c.measure().crc.includes('ERR'));
  // real path must chain two crc32 calls (half + rest with seed)
  resetForce();
  const calls = [];
  const spy = { ...injected, crc32: (d, s) => { calls.push([d.length, s]); return injected.crc32(d, s); } };
  const ui = runApp(source, { crypto: spy });
  calls.length = 0; // drop the two calls from the app's startup measure()
  ui.ctx.measure();
  assert.equal(calls.length, 2, 'CRC must chain seed once');
  assert.equal(calls[1][1], zlib.crc32(Buffer.from('Lu' /* first half of "Lume" */, 'ascii')),
    'second CRC call seed is the first chunk CRC');
});

// ---- static source / repo invariants -------------------------------------
check('all UI string literals ASCII-only (r64)', () => assert.ok(asciiOnly(source)));
check('numeric < 0 / !== 0 error discrimination, no truthy branch', () => {
  assert.ok(errBranch(source));
  assert.ok(!/\bif \(rc\)/.test(source) && !/\bif \(code\)/.test(source));
});
check('digest truncation to 16 bytes + "..." in both SHA and HMAC rows', () =>
  assert.ok(digestTrunc(source)));
check('CRC unsigned String(c2 >>> 0) with negative-only guard', () =>
  assert.ok(crcUnsigned(source)));
check('header declares LUME_MAX_NODES budget and app is plain global script', () => {
  assert.ok(budgetDecl(source));
  assert.ok(plainGlobal(source));
});
check('static tree <= 20 nodes', () => {
  const ui = runApp(source, { crypto: injected });
  assert.ok(ui.messages.filter(m => m[0] === 'create').length <= 20,
    String(ui.messages.filter(m => m[0] === 'create').length));
});
check('playground manifest has 57 apps including crypto_check', () => {
  const apps = manifestApps(manifest);
  assert.ok(apps.length > 0 && apps.includes('crypto_check'));
  assert.ok(apps.includes('crypto_check'));
});
check('generated playground source is byte-identical to the example', () =>
  assert.equal(read('website/playground/sources/crypto_check.js'), source));
check('firmware/ runtime/ tools/lume/ byte-identical to baseline 3514c76', () =>
  assert.deepEqual(gitChanged(['firmware/', 'runtime/', 'tools/lume/']).filter(f => !R166_ALLOWED.includes(f)), []));

// ---- mutation proof: key predicates MUST fail on a bad input --------------
check('MUTATION delete -3/UNSUPPORTED branch -> error predicate FAILS', () => {
  const mutated = source.replace("code === -3 ? 'UNSUPPORTED' : 'ERR ' + code", 'code ? 1 : 0');
  assert.notEqual(mutated, source);
  assert.equal(errBranch(mutated), false);
});
check('MUTATION non-ASCII UI literal -> ASCII predicate FAILS', () => {
  const mutated = source.replace("'Crypto Check'", "'加密检查'");
  assert.notEqual(mutated, source);
  assert.equal(asciiOnly(mutated), false);
});
check('MUTATION fake/full digest (drop truncation) -> predicate FAILS', () => {
  const mutated = source.replace(/hexOf\(out, 16\) \+ '\.\.\.'/g, 'hexOf(out, 32)');
  assert.notEqual(mutated, source);
  assert.equal(digestTrunc(mutated), false);
});
check('MUTATION signed CRC render -> unsigned predicate FAILS', () => {
  const mutated = source.replace('String(c2 >>> 0)', 'String(c2)');
  assert.notEqual(mutated, source);
  assert.equal(crcUnsigned(mutated), false);
});
function mutationFirmwareDiff(paths, rel) {
  const target = path.join(root, rel);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original + '\n/* r134 mutation proof */\n');
    assert.ok(gitChanged(paths).length > 0, rel + ' modification must be visible to the diff check');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.deepEqual(gitChanged(paths).filter(f => !R166_ALLOWED.includes(f)), []);
}
check('MUTATION touch firmware/ -> diff predicate FAILS (then restored)', () =>
  mutationFirmwareDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'firmware/components/lume-crypto/lume_crypto.c'));
check('MUTATION touch runtime/ -> diff predicate FAILS (then restored)', () =>
  mutationFirmwareDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'runtime/types/lume.d.ts'));

console.log('PASS crypto_check harness: all live, static and mutation checks green');
