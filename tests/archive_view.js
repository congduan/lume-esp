/* r135 host harness for examples/archive_view (pure app + injected compress).
 * Standalone CommonJS:  node tests/archive_view.js
 *
 * Runs the REAL app against the firmware prelude. lume.compress.inflate has no
 * native DEFLATE decoder on the host (no miniz), so REAL decompression is
 * injected through options.compress: zlib.inflateSync for "zlib" and
 * zlib.inflateRawSync for "raw" (node:zlib, independent native C), adapted to
 * the firmware stub signature inflate(src, out, format) -> bytes written or a
 * negative code. Assertions observe the app's rendered text and returned state
 * against those real results -- not just source text. A mutable `force`
 * switch injects -1/-2/-3/0 to exercise every error / zero-byte branch live.
 *
 * HONESTY: this harness does NOT test the ESP32-S3 or its vendored miniz build.
 * The firmware path is exercised by tests/compress.js (which compiles the
 * exact lume_compress.c); here node:zlib is a host stand-in with the same
 * contract. Board acceptance stays deferred. Mutations below re-feed
 * deliberately broken copies to prove the key predicates are load bearing.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('examples/archive_view/app.js');
const manifest = read('tools/playground/build.mjs');
const BASE = '5ca3e66'; // r148: re-pinned to the shell Keyboard feat commit (runtime/ shell + types)

// ---- independent expected plaintexts (same synthetic samples the app embeds)
const PLAIN_A = '[Lume] boot log sample (synthetic)\n' +
  '00:00:01 panel CO5300 480x480 ok\n' +
  '00:00:02 touch CST9220 ready\n' +
  '00:00:03 heap free 4182 KiB\n' +
  '00:00:04 prelude eval ok\n' +
  '00:00:05 archive viewer online\n';
const PLAIN_B = 't=0   acc 0.01 0.02 9.81  gyro 0.0 0.1 -0.1\n' +
  't=100 acc 0.02 0.01 9.80  gyro 0.1 0.0  0.0\n' +
  't=200 acc 0.00 0.03 9.82  gyro 0.0 0.2  0.1\n' +
  't=300 acc -0.01 0.02 9.81  gyro 0.1 0.1  0.0\n';
const MAX_CHARS = 120;
const truncated = s => s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '...' : s;
const u8 = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

// ---- injected real implementation (the `options.compress`) ----------------
const force = { inflate: null };
const injected = {
  inflate: (src, out, format) => {
    if (force.inflate !== null) return force.inflate;
    if (!src || typeof src.byteLength !== 'number' || !out || out.constructor?.name !== 'Uint8Array') return -1;
    const f = format === undefined || format === null ? 'raw' : format;
    if (f !== 'raw' && f !== 'zlib') return -1;
    let data;
    try { data = f === 'zlib' ? zlib.inflateSync(u8(src)) : zlib.inflateRawSync(u8(src)); }
    catch (e) { return -2; } // truncated / bad checksum / bad block -> firmware -2
    if (data.length > out.length) return -3;
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return data.length;
  },
};
function resetForce() { force.inflate = null; }
function probe(opts) {
  resetForce();
  const ui = runApp(source, { compress: injected, ...(opts || {}) });
  return { ui, c: ui.ctx };
}
function textsAfter(ui, from) {
  return ui.messages.slice(from).filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
}
function check(name, fn) { fn(); console.log('PASS ' + name); }

// ---- static predicates (also used by mutation proof) ----------------------
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const asciiOnly = s => {
  const lits = literals(s);
  return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
};
const errBranch = s => s.includes('if (n < 0)') && s.includes("'ERR ' + n") &&
  !/\bif \(n\)\b/.test(s);
const realInflate = s => s.includes('compress.inflate(p.bytes, OUT, p.format)');
const truncPred = s => s.includes("s.slice(0, MAX_CHARS) + '...'");
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

// ---- live runs: real injected node:zlib ----------------------------------
check('payload 1 zlib: real inflate text, byte counts, ratio and ZLIB label', () => {
  const { ui, c } = probe();
  const st = c.render();
  assert.equal(st.rc, 181, 'decompressed boot log length');
  assert.equal(st.format, 'zlib');
  assert.equal(st.text, truncated(PLAIN_A), st.text);
  assert.equal(st.bytes, '143 -> 181B');
  assert.equal(st.ratio, '79%');
  assert.equal(st.formatLabel, 'FORMAT ZLIB');
  assert.equal(st.status, 'OK');
  const all = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(all.includes(st.text) && all.includes('143 -> 181B') &&
            all.includes('79%') && all.includes('FORMAT ZLIB'), all.join('|'));
});

check('payload 2 raw: real inflate text, byte counts, ratio and RAW label', () => {
  const { ui, c } = probe();
  c.cyclePayload();
  const st = c.render();
  assert.equal(st.rc, 177, 'decompressed sensor record length');
  assert.equal(st.format, 'raw');
  assert.equal(st.text, truncated(PLAIN_B), st.text);
  assert.equal(st.bytes, '91 -> 177B');
  assert.equal(st.ratio, '51%');
  assert.equal(st.formatLabel, 'FORMAT RAW');
  assert.equal(st.status, 'OK');
  const all = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(all.includes(st.text) && all.includes('FORMAT RAW'), all.join('|'));
});

check('payload 3 truncated zlib is a REAL -2 (not -1), rendered as ERR -2', () => {
  const { ui, c } = probe();
  c.cyclePayload();
  const from = ui.messages.length;
  c.cyclePayload();
  const st = c.render();
  assert.equal(st.rc, -2, 'truncated DEFLATE stream must be -2, not -1');
  assert.equal(st.status, 'ERR -2');
  assert.equal(st.text, '');
  assert.equal(st.bytes, '71 -> ERR');
  assert.equal(st.ratio, '-');
  const t = textsAfter(ui, from);
  assert.ok(t.includes('ERR -2'), t.join('|'));
  assert.ok(!t.some(x => /ERR 0\b/.test(x)), 'zero is not an error');
});

check('injected -1 / -2 / -3 render numerically; 0 is OK, never ERR 0', () => {
  const { ui, c } = probe();
  for (const [code, expected] of [[-1, 'ERR -1'], [-2, 'ERR -2'], [-3, 'ERR -3'], [0, 'OK']]) {
    force.inflate = code;
    const from = ui.messages.length;
    const st = c.render();
    assert.equal(st.status, expected, 'code ' + code);
    if (code === 0) {
      assert.equal(st.ratio, '0%');
      assert.equal(st.text, '');
      assert.ok(!textsAfter(ui, from).some(x => /ERR 0\b/.test(x)), 'no ERR 0');
    }
  }
});

check('NEXT cycles three payloads and wraps; format labels follow the cycle', () => {
  const { c } = probe();
  let st = c.render();
  assert.equal(st.idx, 0); assert.equal(st.formatLabel, 'FORMAT ZLIB');
  st = c.cyclePayload();
  assert.equal(st.idx, 1); assert.equal(st.formatLabel, 'FORMAT RAW');
  st = c.cyclePayload();
  assert.equal(st.idx, 2); assert.equal(st.formatLabel, 'FORMAT ZLIB');
  st = c.cyclePayload();
  assert.equal(st.idx, 0); assert.equal(st.name, 'BOOTLOG');
  assert.equal(st.rc, 181, 'wrap re-inflates the first payload');
});

check('default host stub (no options.compress) renders ERR -3, no fake success', () => {
  const ui = runApp(source);
  for (let i = 0; i < 3; i++) {
    assert.equal(ui.ctx.render().status, 'ERR -3');
    ui.ctx.cyclePayload();
  }
});

// ---- static source / repo invariants -------------------------------------
check('all UI string literals ASCII-only (r64)', () => assert.ok(asciiOnly(source)));
check('numeric < 0 / no truthy branch; real inflate call present', () => {
  assert.ok(errBranch(source));
  assert.ok(realInflate(source));
});
check('text truncation to 120 chars + "..." is declared and implemented', () =>
  assert.ok(truncPred(source)));
check('header declares LUME_MAX_NODES budget and app is a plain global script', () => {
  assert.ok(budgetDecl(source));
  assert.ok(plainGlobal(source));
});
check('static tree <= 20 nodes', () => {
  const { ui } = probe();
  assert.ok(ui.messages.filter(m => m[0] === 'create').length <= 20,
    String(ui.messages.filter(m => m[0] === 'create').length));
});
check('playground manifest has 55 apps including archive_view', () => {
  const apps = manifestApps(manifest);
  assert.equal(apps.length, 55, String(apps.length));
  assert.ok(apps.includes('archive_view'));
});
check('generated playground source is byte-identical to the example', () =>
  assert.equal(read('website/playground/sources/archive_view.js'), source));
check('firmware/ runtime/ tools/lume/ byte-identical to baseline 5ca3e66', () =>
  assert.deepEqual(gitChanged(['firmware/', 'runtime/', 'tools/lume/']), []));

// ---- mutation proof: key predicates MUST fail on a bad input --------------
check('MUTATION delete <0 error branch -> error predicate FAILS', () => {
  const mutated = source.replace('if (n < 0) {', 'if (false) {');
  assert.notEqual(mutated, source);
  assert.equal(errBranch(mutated), false);
});
check('MUTATION non-ASCII UI literal -> ASCII predicate FAILS', () => {
  const mutated = source.replace("'Archive Viewer'", "'档案查看器'");
  assert.notEqual(mutated, source);
  assert.equal(asciiOnly(mutated), false);
});
check('MUTATION fake inflate result -> real-inflate predicate and live FAIL', () => {
  const mutated = source.replace('compress.inflate(p.bytes, OUT, p.format)', 'OUT.length');
  assert.notEqual(mutated, source);
  assert.equal(realInflate(mutated), false);
  const ui = runApp(mutated, { compress: injected });
  assert.notEqual(ui.ctx.render().rc, 181, 'fake must not reproduce the real byte count');
});
check('MUTATION drop text truncation -> truncation predicate FAILS', () => {
  const mutated = source.replace("s.slice(0, MAX_CHARS) + '...'", 's');
  assert.notEqual(mutated, source);
  assert.equal(truncPred(mutated), false);
});
function mutationFirmwareDiff(paths, rel) {
  const target = path.join(root, rel);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original + '\n/* r135 mutation proof */\n');
    assert.ok(gitChanged(paths).length > 0, rel + ' modification must be visible to the diff check');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.deepEqual(gitChanged(paths), []);
}
check('MUTATION touch firmware/ -> diff predicate FAILS (then restored)', () =>
  mutationFirmwareDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'firmware/components/lume-compress/lume_compress.c'));
check('MUTATION touch runtime/ -> diff predicate FAILS (then restored)', () =>
  mutationFirmwareDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'runtime/types/lume.d.ts'));

console.log('PASS archive_view harness: all live, static and mutation checks green');
