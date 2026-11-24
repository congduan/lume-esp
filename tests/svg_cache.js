/* Host harness for the r183 SVG raster-result cache.
 * Standalone CommonJS:  node tests/svg_cache.js
 *
 * Compiles the REAL firmware cache source with heap_caps stubs (C test driver
 * in tests/svg_cache_test.c) and runs hit/miss/eviction/content-change/size-key/
 * byte-cap/reset cases. Source-contract checks guard the engine integration.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const engine = read('firmware/components/lume-engine/lume_engine.c');
const cache = read('firmware/components/lume-engine/lume_svg_cache.c');
const cmake = read('firmware/components/lume-engine/CMakeLists.txt');
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };

check('engine gates cache with lume_svg_detect (SVG only)', () => {
  assert.ok(/bool svg = lume_svg_detect\(bytes, len\)/.test(engine));
  assert.ok(/!\(svg && lume_svg_cache_get\(/.test(engine));
  assert.ok(/if \(svg\) \(void\)lume_svg_cache_put\(/.test(engine));
});
check('cache is reset on every runtime teardown', () => {
  const sites = engine.match(/lume_svg_cache_reset\(\);/g) || [];
  const frees = engine.match(/JS_FreeRuntime\(rt\);/g) || [];
  assert.ok(sites.length >= frees.length,
    `cache resets (${sites.length}) must cover runtime frees (${frees.length})`);
});
check('cache source uses SPIRAM caps and FNV-1a', () => {
  assert.ok(/MALLOC_CAP_SPIRAM/.test(cache));
  assert.ok(/2166136261u/.test(cache) && /16777619u/.test(cache));
  assert.ok(/1 << 20/.test(cache)); /* 1 MiB byte budget */
});
check('component registers the new source', () =>
  assert.ok(/"lume_svg_cache\.c"/.test(cmake)));

const bin = '/tmp/lume-r183-svg-cache-host';
try {
  execFileSync('gcc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-I', path.join(root, 'firmware/components/lume-engine/include'),
    path.join(__dirname, 'svg_cache_test.c'),
    path.join(root, 'firmware/components/lume-engine/lume_svg_cache.c'),
    '-o', bin], { cwd: root, encoding: 'utf8' });
  const out = execFileSync(bin, { cwd: root, encoding: 'utf8' });
  process.stdout.write(out);
  check('svg_cache_test.c compiled and ran with exit 0', () => {});
} catch (e) {
  process.stderr.write(String(e.stdout || '') + String(e.stderr || ''));
  assert.fail('svg_cache_test.c compile/run failed');
}

console.log(`svg_cache: ${checks} checks green`);
