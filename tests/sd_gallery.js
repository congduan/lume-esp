// Host harness for the r126 image_gallery Sd-first slice. Standalone CommonJS:
//   node tests/sd_gallery.js
// Static source assertions: the app really reads from lume.storage.Sd when a
// card is mounted, degrades per image to the pre-existing Fs path, discriminates
// statvfs()'s number error codes correctly and keeps UI copy ASCII-only (r64).
// The old app-only "zero firmware diff" guard is now an r128 allowlist.
// No card on the host: nothing here proves a real SPI mount -- board acceptance
// stays deferred.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('examples/image_gallery/app.js');

// --- 1. Sd-first wiring ---------------------------------------------------
assert.match(app, /var sd = \(lume\.storage && lume\.storage\.Sd\) \|\| null;/,
  'Sd must be resolved defensively from lume.storage');
assert.match(app, /sd\.mounted\(\) === true/,
  'read path must gate on Sd.mounted() === true');
assert.match(app, /sd\.readBinary\(path\)/,
  'mounted-card images must be read via Sd.readBinary');

// Sd must be consulted BEFORE Fs inside the shared reader.
const readFn = app.slice(app.indexOf('function readImageBytes'),
                         app.indexOf('function thumbnailTile'));
const sdAt = readFn.indexOf('sd.readBinary');
const fsAt = readFn.indexOf('Fs.readBinary');
assert.ok(sdAt >= 0 && fsAt > sdAt,
  'Sd.readBinary must precede the Fs fallback inside readImageBytes');

// --- 2. per-image try/catch -----------------------------------------------
// Brace-match the paths loop; it must own a try/catch so one bad card image
// cannot drag down the whole eval.
function blockFrom(haystack, marker) {
  const start = haystack.indexOf(marker);
  assert.ok(start >= 0, 'missing marker: ' + marker);
  const open = haystack.indexOf('{', start);
  assert.ok(open >= 0, 'missing opening brace for ' + marker);
  let depth = 0;
  for (let i = open; i < haystack.length; i++) {
    if (haystack[i] === '{') depth++;
    else if (haystack[i] === '}' && --depth === 0) return haystack.slice(open, i + 1);
  }
  assert.fail('unbalanced block for ' + marker);
}
const loop = blockFrom(app, 'for (var i = 0; i < paths.length; i++)');
assert.match(loop, /\btry\s*\{/, 'each image must be wrapped in its own try/catch');
assert.match(loop, /catch\s*\(e\)/, 'per-image catch must keep one bad image local');
assert.match(loop, /readImageBytes\(paths\[i\]\)/, 'loop must use the Sd-first reader');

// --- 3. Fs fallback + embedded PNG preserved ------------------------------
assert.match(readFn, /var fsBytes = Fs\.readBinary\(path\)/,
  'the pre-existing Fs.readBinary fallback must remain');
assert.match(readFn, /instanceof ArrayBuffer/,
  'both readers must validate ArrayBuffer before use');
assert.match(app, /137,80,78,71/, 'the embedded 1x1 red PNG fallback must remain');

// --- 4. statvfs error-code discrimination ---------------------------------
assert.match(app, /sd\.statvfs\(\)/, 'HUD must query Sd.statvfs()');
assert.match(app, /typeof stat === 'object'/,
  'a number from statvfs is an error code, not capacity -- discriminate by typeof');
assert.match(app, /return 'NO CARD'/,
  'negative statvfs error codes must render NO CARD');
assert.match(app, /Math\.floor\(stat\.total \/ 1048576\)/,
  'capacity must be floor-converted to integer MB');

// --- 5. ASCII-only UI copy (r64) ------------------------------------------
// Comments are Chinese by design; only string literals (the UI copy surface)
// must stay ASCII. No string literals live inside the file's comments.
const stringLits = [...app.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
  .map(m => (m[1] !== undefined ? m[1] : m[2]));
assert.ok(stringLits.length > 0, 'expected to find string literals in app.js');
for (const s of stringLits) {
  assert.ok(/^[\x00-\x7F]*$/.test(s),
    'all app string literals (UI copy) must be ASCII-only: ' + JSON.stringify(s));
}

// --- 6. round-scope guard: only r128's firmware files may differ ----------
// r126 was an app-only round; r128 deliberately adds the SNTP/time natives,
// so the old "zero firmware diff" sentinel is narrowed to an allowlist
// instead of being deleted. Anything else under firmware/ or runtime/
// changing vs the r127 baseline still fails this harness.
const R128_FIRMWARE_FILES = [
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_scripts.c',
  'firmware/sdkconfig.defaults',
  'runtime/types/lume.d.ts',
  'runtime/shell.js', // r166 ColorPicker
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  // r181 UI-queue backpressure.
  'firmware/components/lume-ui-bridge/lume_ui_bridge.c',
  'firmware/components/lume-svg/lume_svg.c',
  'firmware/components/lvgl/lv_conf.h',
];
const diffFiles = execFileSync('git', ['diff', '--name-only', '4a2bd29',
  '--', 'firmware/', 'runtime/'], { cwd: root, encoding: 'utf8' }).trim();
const changed = diffFiles ? diffFiles.split('\n') : [];
assert.ok(changed.every(f => R128_FIRMWARE_FILES.includes(f)),
  'only known firmware files may differ from 4a2bd29: ' + changed.join(', '));

console.log('PASS sd_gallery: Sd-first read path wired before Fs fallback');
console.log('PASS sd_gallery: per-image try/catch degrades one image only');
console.log('PASS sd_gallery: Fs fallback + embedded red PNG intact');
console.log('PASS sd_gallery: statvfs error-code discrimination + integer MB HUD');
console.log('PASS sd_gallery: all app string literals ASCII-only (r64)');
console.log('PASS sd_gallery: firmware/ runtime/ differ only in known files vs 0d1111c');
console.log('ALL SD GALLERY HARNESS CASES PASSED');
