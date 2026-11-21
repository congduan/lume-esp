// Host harness for the r127 examples/files SD-card slice. Standalone CommonJS:
//   node tests/sd_files.js
// Static source assertions: the file manager discovers a mounted TF card via
// lume.storage.Sd, enters an SD browse mode through an SD/ virtual root entry,
// dispatches every filesystem operation to Sd.* in that mode, falls back to
// Fs on the same path when Sd fails, with per-op try/catch degradation,
// discriminates statvfs()'s number error codes, reuses
// the single existing delete Dialog, keeps UI copy ASCII-only (r64), limits
// firmware/ and runtime/ changes to r128's known files, and lists both
// image_gallery and files in the playground manifest.
//
// Every source check is a predicate over the source text. After the live run,
// selected predicates are re-fed deliberately mutated source and MUST fail --
// so none of them are decorative. No card on the host: nothing here proves a
// real SPI mount -- board acceptance stays deferred.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('examples/files/app.js');
const manifest = read('tools/playground/build.mjs');

// Brace-match a function body so try/catch assertions stay inside that function.
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
function hasTryCatch(block) {
  return /\btry\s*\{/.test(block) && /catch\s*\(e\)/.test(block);
}

// --- source checks: name -> predicate over app.js ------------------------
const checks = [
  { name: 'Sd defensively resolved from lume.storage',
    test: s => /var sd = \(lume\.storage && lume\.storage\.Sd\) \|\| null;/.test(s) },
  { name: 'browse gated on Sd.mounted() === true',
    test: s => /sd\.mounted\(\) === true/.test(s) },
  { name: 'SD/ virtual root entry appended only in Fs root when ready',
    test: s => /if \(!onSd\(\) && sdReady && clean === '\/'/.test(s) &&
               /list\.push\('SD\/'\)/.test(s) },
  { name: 'SD/ entry flagged and handled as SD mode entry',
    test: s => /isDir: true, sd: true/.test(s) && /if \(e\.sd\)/.test(s) &&
               /onSd\.set\(true\)/.test(s) },
  { name: 'Sd.list dispatch with Fs fallback',
    test: s => /onSd\(\) \? sdOrFs\('list', p\) : Fs\.list\(p\)/.test(s) },
  { name: 'Sd.read dispatch for text preview',
    test: s => /onSd\(\) \? sdOrFs\('read', p\) : Fs\.read\(p\)/.test(s) },
  { name: 'Sd remove/mkdir/exists dispatch (delete semantics reuse Fs recursion)',
    test: s => /onSd\(\) \? sdOrFs\('remove', p\) : Fs\.remove\(p\)/.test(s) &&
               /onSd\(\) \? sdOrFs\('mkdir', p\) : Fs\.mkdir\(p\)/.test(s) &&
               /onSd\(\) \? sdOrFs\('exists', p\) : Fs\.exists\(p\)/.test(s) },
  { name: 'sdOrFs falls back to Fs same path on negative code or throw',
    test: s => {
      const b = blockFrom(s, 'function sdOrFs(method, p)');
      return /catch \(e\) \{ return Fs\[method\]\(p\); \}/.test(b) &&
             /typeof r === 'number' && r < 0/.test(b);
    } },
  { name: 'isDirPath degrades on native throw',
    test: s => hasTryCatch(blockFrom(s, 'function isDirPath(p)')) },
  { name: 'loadDir degrades per operation (list failure -> empty dir)',
    test: s => hasTryCatch(blockFrom(s, 'function loadDir(path)')) &&
               /typeof list === 'number'/.test(s) },
  { name: 'loadDir failure branch clears selected + preview',
    test: s => {
      const b = blockFrom(s, 'function loadDir(path)');
      const m = b.match(/if \(typeof list === 'number'\) \{[\s\S]*?notify\('Read failed/);
      return !!m && /selected\.set\(null\)/.test(m[0]) && /closePreview\(\)/.test(m[0]);
    } },
  { name: 'removeTree degrades per operation (JS recursion, try/catch)',
    test: s => (blockFrom(s, 'function removeTree(path, isDirectory, depth)').match(/\btry\s*\{/g) || []).length >= 3 },
  { name: 'previewSelected degrades on read failure',
    test: s => hasTryCatch(blockFrom(s, 'function previewSelected()')) &&
               /typeof text === 'number'/.test(s) },
  { name: 'makeDir degrades on exists/mkdir throw',
    test: s => (blockFrom(s, 'function makeDir()').match(/\btry\s*\{/g) || []).length >= 2 },
  { name: 'SD/ virtual entry cannot be deleted',
    test: s => /name === 'SD\/'/.test(s) && /Cannot delete SD entry/.test(s) },
  { name: 'single shared delete Dialog (no duplicate flow)',
    test: s => (s.match(/lume\.ui\.shell\.Dialog\(/g) || []).length === 1 },
  { name: 'HUD queries Sd.statvfs()',
    test: s => /sd\.statvfs\(\)/.test(s) },
  { name: 'statvfs number error code discriminated via typeof === object',
    test: s => /typeof stat === 'object'/.test(s) },
  { name: 'statvfs error code renders NO CARD',
    test: s => /return 'NO CARD'/.test(s) },
  { name: 'card free bytes floored to integer MB',
    test: s => /Math\.floor\(stat\.free \/ 1048576\)/.test(s) },
  { name: 'status label switches to card info only in SD mode',
    test: s => /onSd\(\) \? cardInfoText\(\) : itemsLabel\(\)/.test(s) },
  { name: 'SD root BACK exits SD mode instead of launcher',
    test: s => /cwd\(\) === '\/' && !onSd\(\)/.test(s) },
  { name: 'all app string literals (UI copy) ASCII-only (r64)',
    test: s => {
      const lits = [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
        .map(m => (m[1] !== undefined ? m[1] : m[2]));
      return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
    } },
];

// --- non-source checks ---------------------------------------------------
// r126/r127 were app-only rounds; r128 is an explicit firmware round that
// intentionally adds lume.system.time()/setTimeNtp(). Keep the round-scope
// guard: only those known r128 files may differ from the r127 baseline.
const R128_FIRMWARE_FILES = [
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_scripts.c',
  'firmware/sdkconfig.defaults',
  'runtime/types/lume.d.ts',
];
function gitDiffEmpty() {
  const out = execFileSync('git', ['diff', '--name-only', '2e192d5',
    '--', 'firmware/', 'runtime/'], { cwd: root, encoding: 'utf8' }).trim();
  const files = out ? out.split('\n') : [];
  return files.every(f => R128_FIRMWARE_FILES.includes(f));
}
function manifestHasApps(src) {
  const m = src.match(/const apps = \[([\s\S]*?)\];/);
  return !!m && /'image_gallery'/.test(m[1]) && /'files'/.test(m[1]);
}

for (const c of checks) {
  assert.ok(c.test(app), 'FAIL sd_files: ' + c.name);
  console.log('PASS sd_files: ' + c.name);
}
assert.ok(gitDiffEmpty(), 'FAIL sd_files: only known firmware files may differ from 2e192d5');
console.log('PASS sd_files: firmware/ runtime/ differ from 2e192d5 only in known files');
assert.ok(manifestHasApps(manifest), 'FAIL sd_files: playground manifest must list image_gallery and files');
console.log('PASS sd_files: playground manifest lists image_gallery and files');

// --- mutation proof: key assertions MUST fail when their code is removed ---
function must(name, mutation, checkName, target) {
  const mutated = mutation(target);
  assert.notEqual(mutated, target, 'mutation must actually change source: ' + name);
  const c = checks.find(x => x.name === checkName) ||
            { name: 'playground manifest lists image_gallery and files', test: manifestHasApps };
  assert.equal(c.test(mutated), false, 'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS sd_files mutation: ' + name + ' -> FAIL as expected');
}

must('drop Sd resolution',
  s => s.replace('var sd = (lume.storage && lume.storage.Sd) || null;', 'var sd = null;'),
  'Sd defensively resolved from lume.storage', app);
must('drop mounted gate',
  s => s.replace('sd.mounted() === true', 'false'),
  'browse gated on Sd.mounted() === true', app);
must('drop SD/ root entry',
  s => s.replace("list.push('SD/');", '/* removed */'),
  'SD/ virtual root entry appended only in Fs root when ready', app);
must('force Sd.list dispatch back to Fs',
  s => s.replace("return onSd() ? sdOrFs('list', p) : Fs.list(p);", 'return Fs.list(p);'),
  'Sd.list dispatch with Fs fallback', app);
must('force Sd.read dispatch back to Fs',
  s => s.replace("return onSd() ? sdOrFs('read', p) : Fs.read(p);", 'return Fs.read(p);'),
  'Sd.read dispatch for text preview', app);
must('drop sdOrFs fallback on negative code',
  s => s.replace("if (typeof r === 'number' && r < 0) return Fs[method](p);", ''),
  'sdOrFs falls back to Fs same path on negative code or throw', app);
must('drop sdOrFs fallback on native throw',
  s => s.replace('catch (e) { return Fs[method](p); }', 'catch (e) { throw e; }'),
  'sdOrFs falls back to Fs same path on negative code or throw', app);
must('drop loadDir failure preview clear',
  s => s.replace(/    closePreview\(\);[^\n]*\n    notify\('Read failed: ' \+ list\);/,
                 "    notify('Read failed: ' + list);"),
  'loadDir failure branch clears selected + preview', app);
must('drop loadDir try/catch',
  s => s.replace('try { list = listDir(clean); }\n  catch (e) { list = -2; }', 'list = listDir(clean);'),
  'loadDir degrades per operation (list failure -> empty dir)', app);
must('drop removeTree try/catch',
  s => s.replace('try { return removeAt(path); }\n    catch (e) { return -2; }', 'return removeAt(path);'),
  'removeTree degrades per operation (JS recursion, try/catch)', app);
must('drop statvfs call',
  s => s.replace('var stat = sd.statvfs();', 'var stat = null;'),
  'HUD queries Sd.statvfs()', app);
must('drop typeof discrimination',
  s => s.replace("if (stat && typeof stat === 'object') {", 'if (stat) {'),
  'statvfs number error code discriminated via typeof === object', app);
must('drop NO CARD',
  s => s.split("return 'NO CARD';").join("return '';"),
  'statvfs error code renders NO CARD', app);
must('drop integer MB floor',
  s => s.replace('Math.floor(stat.free / 1048576)', 'stat.free'),
  'card free bytes floored to integer MB', app);
must('inject CJK UI copy',
  s => s.replace("notify('Cannot delete SD entry');", "notify('无法删除 SD entry');"),
  'all app string literals (UI copy) ASCII-only (r64)', app);
must('drop image_gallery from playground manifest',
  s => s.replace("'image_gallery', 'files', 'adc_meter', 'crypto_check', 'archive_view', 'img_view', 'vec_demo', 'settings'];", "'files'];"),
  'playground manifest lists image_gallery and files', manifest);

console.log('ALL SD FILES HARNESS CASES PASSED');
