// Compile a host QuickJS runner against the exact firmware lume_compress.c
// source (which #includes the vendored miniz tinfl), then feed it Node zlib
// fixtures and run the same byte-exact / damaged / offset / error / perf cases.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const qjs = path.join(root, 'firmware/components/quickjs-ng');
const scratchRoot = path.join(root, 'artifacts/r92');
fs.mkdirSync(scratchRoot, {recursive: true});

// Deterministic incompressible fixture (>64 KiB) -> stored DEFLATE blocks.
function detRandom(n, seed) {
  const out = Buffer.allocUnsafe(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out[i] = (x >>> 24) & 0xff; }
  return out;
}
const payloads = {
  empty: Buffer.alloc(0),
  text: Buffer.from('Lume compress roundtrip. '.repeat(400)),
  rle: Buffer.alloc(120000, 0x41),
  random: detRandom(70000, 0xC0FFEE),
  big: Buffer.from(Array.from({length: 2048}, (_, i) =>
    `line ${i}: the quick brown fox jumps over the lazy dog\n`).join('')),
};
const lengths = {};
const fixtures = {payloads: {}, lengths: {}, damaged: {}, perf: {}};
for (const [key, payload] of Object.entries(payloads)) {
  lengths[key] = payload.length;
  fixtures.payloads[key] = {
    payload: payload.toString('hex'),
    raw: zlib.deflateRawSync(payload).toString('hex'),
    zlib: zlib.deflateSync(payload).toString('hex'),
  };
  fixtures.lengths[key] = payload.length;
}
const textRaw = Buffer.from(fixtures.payloads.text.raw, 'hex');
const textZlib = Buffer.from(fixtures.payloads.text.zlib, 'hex');
const truncated = Buffer.from(textRaw.subarray(0, Math.floor(textRaw.length / 2)));
const badHeader = Buffer.from(textZlib); badHeader[0] = 0x00; badHeader[1] = 0x00;
const badAdler = Buffer.from(textZlib); badAdler[badAdler.length - 1] ^= 0xff;
fixtures.damaged = {
  truncated: truncated.toString('hex'),
  badHeader: badHeader.toString('hex'),
  badBlock: Buffer.from([0x07, 0x00, 0x00, 0x00]).toString('hex'), // BFINAL=1, BTYPE=3 (reserved)
  badAdler: badAdler.toString('hex'),
};
const perfPayload = payloads.big;
fixtures.perf = {
  src: zlib.deflateSync(perfPayload).toString('hex'),
  outLen: perfPayload.length,
  rounds: 200,
};

const scratch = fs.mkdtempSync(path.join(scratchRoot, 'compress-host-'));
try {
  fs.writeFileSync(path.join(scratch, 'fixtures.js'), 'var __FIXTURES = ' + JSON.stringify(fixtures) + ';\n');
  const fixturesJs = fs.readFileSync(path.join(scratch, 'fixtures.js'), 'utf8');
  const casesJs = fs.readFileSync(path.join(__dirname, 'lib/compress_cases.js'), 'utf8');
  const allJs = path.join(scratch, 'all.js');
  fs.writeFileSync(allJs, fixturesJs + '\n' + casesJs);

  const cc = process.env.CC || 'cc';
  const args = ['-O2', '-std=gnu11', '-D_GNU_SOURCE', '-DQUICKJS_NG_BUILD', '-funsigned-char',
    `-I${path.join(__dirname, 'lib')}`,
    `-I${qjs}`,
    path.join(__dirname, 'compress_host.c'),
    path.join(root, 'firmware/components/lume-compress/lume_compress.c'),
    ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'].map(p => path.join(qjs, p)),
    '-o', path.join(scratch, 'compress_host'), '-lm', '-lpthread', '-ldl'];
  let r = spawnSync(cc, args, {stdio: 'inherit'});
  if (r.status !== 0) {
    process.exitCode = r.status || 1;
  } else {
    r = spawnSync(path.join(scratch, 'compress_host'), [allJs], {stdio: 'inherit'});
    if (r.status !== 0) process.exitCode = r.status || 1;

    // Node zlib baseline (itself native C; a host reference, not a JS inflate).
    const src = Buffer.from(fixtures.perf.src, 'hex');
    let t0 = Date.now(), sink = 0;
    for (let i = 0; i < fixtures.perf.rounds; i++) sink += zlib.inflateSync(src).length;
    const nodeMs = Date.now() - t0;
    console.log(`PERF Node zlib.inflateSync baseline ${fixtures.perf.rounds}x ${fixtures.perf.outLen}B: ${nodeMs}ms (sink=${sink}, native C, host only)`);
    console.log(`FIXTURES raw/zlib sizes: text=${textRaw.length}/${textZlib.length}B ` +
                `random=${Buffer.from(fixtures.payloads.random.raw, 'hex').length}B ` +
                `big=${Buffer.from(fixtures.payloads.big.raw, 'hex').length}B ` +
                `big-zlib=${Buffer.from(fixtures.payloads.big.zlib, 'hex').length}B`);
  }
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
