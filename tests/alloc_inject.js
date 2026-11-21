/*
 * r138 host OOM fault-injection harness (CommonJS, standalone).
 *
 *   node tests/alloc_inject.js
 *
 * Compiles tests/alloc_inject_host.c against the vendored QuickJS-NG sources
 * on the host, then asserts the injection contract. No firmware, esp32sim or
 * board is involved: this is host-only, exactly like tests/fft.js.
 *
 * Exit 0 = all assertions pass; 1 = a check failed (same convention as the
 * other tests/*.js harnesses).
 */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const qjs = path.join(root, 'firmware/components/quickjs-ng');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-alloc-inject-'));

function run() {
  const cc = process.env.CC || 'cc';
  const args = ['-O2', '-std=gnu11', '-D_GNU_SOURCE', '-DQUICKJS_NG_BUILD', '-funsigned-char',
    `-I${qjs}`,
    path.join(__dirname, 'alloc_inject_host.c'),
    ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'].map((p) => path.join(qjs, p)),
    '-o', path.join(scratch, 'alloc_inject_host'),
    '-lm', '-lpthread', '-ldl'];
  const build = spawnSync(cc, args, { encoding: 'utf8' });
  if (build.status !== 0) {
    process.stderr.write(build.stderr || '');
    throw new Error(`compile failed (exit ${build.status})`);
  }
  const exe = spawnSync(path.join(scratch, 'alloc_inject_host'), [], { encoding: 'utf8' });
  process.stdout.write(exe.stdout || '');
  process.stderr.write(exe.stderr || '');
  const out = (exe.stdout || '') + (exe.stderr || '');
  assert.equal(exe.status, 0, 'host harness must exit 0 (no crash / no signal)');

  // Deterministic failure at the engine boundary, not a crash or wrong class.
  assert.match(out, /engine: exception=InternalError: out of memory/,
    'engine must receive a deterministic out-of-memory exception');
  // Countdown fired exactly once: the counter must match the injection.
  assert.match(out, /inject: denied=1 calls=\d+/, 'exactly one allocation denied');
  // After the window the allocator resumes and the block is accounted.
  assert.match(out, /resume: malloc-after-window ok net=\d+ live=\d+/,
    'allocator must resume and account the resumed block');
  // Every surviving block is freed; net/live return to zero.
  assert.match(out, /teardown: net=0 live=0/, 'counter must balance after free');
  // Sentinel.
  assert.match(out, /RESULT: PASS/, 'harness sentinel missing');
  console.log('PASS alloc_inject: countdown OOM -> deterministic failure, counter consistent, no crash');
}

try {
  run();
} catch (err) {
  console.error(`FAIL alloc_inject: ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
