// Host harness for the r129 SNTP *consumers* slice (app-only). Standalone
// CommonJS:
//   node tests/sntp_consumers.js
// Static source-contract checks only: examples/clock/app.js SNTP-first sync,
// examples/settings/app.js General-page sync row, ASCII-only UI copy (r64),
// and a firmware/ runtime/ zero-diff guard against the r128 baseline b5ca082.
// There is NO radio and NO board on the host: nothing here proves a real SNTP
// exchange. Every assertion is mutation-proven below so none are decorative.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const clock = read('examples/clock/app.js');
const settings = read('examples/settings/app.js');

function sliceBetween(s, startMarker, endMarker) {
  const a = s.indexOf(startMarker);
  assert.ok(a >= 0, 'missing start marker: ' + startMarker);
  const b = s.indexOf(endMarker, a + startMarker.length);
  assert.ok(b >= 0, 'missing end marker: ' + endMarker);
  return s.slice(a, b);
}
const clockSync = sliceBetween(clock, 'function syncNetTime() {', '\n/** wall-clock Date; epochOffsetMs');
const clockWall = sliceBetween(clock, 'function wallDate() {', '\nfunction tick()');
const settingsSyncHelpers = sliceBetween(settings, '/* ---- r129: time sync', '/* ---- polling');
const settingsSyncRow = sliceBetween(settings, '/* r129: NTP sync row', '\n  actionRow([');

// ASCII-only UI copy (r64): comments may be Chinese; only string literals
// (the UI-copy surface) must be ASCII. No string literals live in comments.
function asciiStrings(s) {
  const lits = [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
  return lits.length > 0 && lits.every(x => /^[\x00-\x7F]*$/.test(x));
}

// r129 is app-only: no firmware/runtime file may differ from the r128
// baseline. Same allowlist pattern as r128, but the exception set is empty.
const R129_ALLOWLIST = [];
function gitChanged() {
  const head = execFileSync('git',
    ['diff', '--name-only', '4e00954', 'HEAD', '--', 'firmware/', 'runtime/'],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', '4e00954', '--', 'firmware/', 'runtime/'],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const changedFiles = gitChanged();

// --- clock: SNTP-first, then HTTP fallback ---------------------------------
const checks = [
  ['clock tries setTimeNtp() first with default args, before the HTTP list',
    [clockSync, s => {
      const ntp = s.indexOf('sys.setTimeNtp() === 0');
      const loop = s.indexOf('for (var i = 0; i < TIME_SOURCES.length; i++)');
      return ntp >= 0 && loop > ntp && /setTimeNtp\(\)/.test(s) &&
             !/setTimeNtp\([^)]/.test(s.slice(ntp, ntp + 60));
    }]],
  ['clock NTP success resets epochOffsetMs=0 and returns before any httpGet',
    [clockSync, s => {
      const ntp = s.indexOf('sys.setTimeNtp() === 0');
      const zero = s.indexOf('epochOffsetMs = 0;', ntp);
      const ret = s.indexOf('return;', zero);
      const loop = s.indexOf('for (var i = 0; i < TIME_SOURCES.length; i++)');
      return ntp >= 0 && zero > ntp && ret > zero && loop > ret;
    }]],
  ['clock keeps the -2/-3 HTTP fallback list (httpGet over TIME_SOURCES)',
    [clockSync, s => s.includes('for (var i = 0; i < TIME_SOURCES.length; i++)') &&
                     s.includes('lume.net.httpGet(TIME_SOURCES[i].url') &&
                     s.indexOf('lume.net.httpGet') > s.indexOf('sys.setTimeNtp() === 0') &&
                     s.includes('nextSyncMs = mono + SYNC_RETRY_MS;')]],
  ['clock guards a missing/throwing setTimeNtp API',
    [clockSync, s => s.includes('var sys = lume.system;') &&
                     s.includes("typeof sys.setTimeNtp === 'function'") &&
                     s.includes('} catch (e) { /* API threw: fall through')]],
  ['clock epochOffsetMs=0 identity: wallDate reads Date.now()',
    [clockWall, s => /new Date\(Date\.now\(\) \+ epochOffsetMs\)/.test(s) &&
                     !/lume\._nowMs\(\) \+ epochOffsetMs/.test(s)]],
  ['clock HTTP path still persists clock.tzMin in kv',
    [clockSync, s => s.includes("lume.storage.kv.set('clock.tzMin', tz);")]],
  ['clock re-sync cadence SYNC_OK_MS / SYNC_RETRY_MS unchanged',
    [clock, s => /var SYNC_OK_MS = 600000;/.test(s) &&
                 /var SYNC_RETRY_MS = 30000;/.test(s)]],

  // --- settings: General-page NTP sync row ---------------------------------
  ['settings General page has a Sync now Button wired to syncTimeNow',
    [settingsSyncRow, s => /Button\(\{ title: 'Sync now', onPress: syncTimeNow,/.test(s)]],
  ['settings General page has the live status Text bound to timeSyncLine',
    [settingsSyncRow, s => /Text\(\{ text: function \(\) \{ return timeSyncLine\(\); \}/.test(s)]],
  ['settings sync row adds at most 3 nodes (View + Text + Button)',
    [settingsSyncRow, s => (s.match(/\b(?:View|Text|Button)\s*\(/g) || []).length === 3]],
  ['settings status copy covers NTP OK / NOT SYNCED / SYNC FAILED / NO WIFI',
    [settings, s => ['TIME SYNC: NTP OK', 'TIME SYNC: NOT SYNCED',
                     'TIME SYNC: SYNC FAILED', 'TIME SYNC: NO WIFI']
                      .every(t => s.includes("'" + t + "'"))]],
  ['settings syncTimeNow gates on GOT_IP before calling setTimeNtp()',
    [settingsSyncHelpers, s => s.includes('st.state !== lume.net.GOT_IP') &&
                               s.includes('var r = sys.setTimeNtp();')]],
  ['settings maps setTimeNtp 0 / -2 / -3 to the status strings',
    [settingsSyncHelpers, s => s.includes("if (r === 0) timeSyncLine.set('TIME SYNC: NTP OK');") &&
                               s.includes("else if (r === -2) timeSyncLine.set('TIME SYNC: SYNC FAILED');") &&
                               s.includes("else if (r === -3) timeSyncLine.set('TIME SYNC: NO WIFI');")]],
  ['settings status heuristic reads both lume.system.time() and Date.now()',
    [settingsSyncHelpers, s => s.includes('lume.system.time()') && s.includes('Date.now()')]],

  // --- ASCII-only UI copy (r64) --------------------------------------------
  ['clock string literals are ASCII-only', [clock, asciiStrings]],
  ['settings string literals are ASCII-only', [settings, asciiStrings]],

  // --- round scope guard: firmware/ runtime/ unchanged vs r128 baseline ----
  ['firmware/ runtime/ differ from b5ca082 only in the (empty) r129 allowlist',
    [changedFiles, changed => changed.every(f => R129_ALLOWLIST.includes(f))]],
];

for (const [name, [source, test]] of checks) {
  assert.ok(test(source), 'FAIL sntp_consumers: ' + name);
  console.log('PASS sntp_consumers: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed
function must(name, mutation, checkName, source) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS sntp_consumers mutation: ' + name + ' -> FAIL as expected');
}

must('clock drops the setTimeNtp-first call',
  s => s.replace('sys.setTimeNtp() === 0', 'false'),
  'clock tries setTimeNtp() first with default args, before the HTTP list', clockSync);
must('clock skips the offset reset on NTP success',
  s => s.replace('epochOffsetMs = 0;', 'epochOffsetMs = 1;'),
  'clock NTP success resets epochOffsetMs=0 and returns before any httpGet', clockSync);
must('clock drops the HTTP fallback loop',
  s => s.replace('for (var i = 0; i < TIME_SOURCES.length; i++) {', 'if (false) {'),
  'clock keeps the -2/-3 HTTP fallback list (httpGet over TIME_SOURCES)', clockSync);
must('clock drops the missing-API guard',
  s => s.replace("typeof sys.setTimeNtp === 'function'", 'true'),
  'clock guards a missing/throwing setTimeNtp API', clockSync);
must('clock reverts wallDate to the monotonic _nowMs anchor',
  s => s.replace('new Date(Date.now() + epochOffsetMs)', 'new Date(lume._nowMs() + epochOffsetMs)'),
  'clock epochOffsetMs=0 identity: wallDate reads Date.now()', clockWall);
must('clock stops persisting clock.tzMin',
  s => s.replace("lume.storage.kv.set('clock.tzMin', tz);", '/* removed */'),
  'clock HTTP path still persists clock.tzMin in kv', clockSync);
must('clock shortens the re-sync cadence',
  s => s.replace('var SYNC_OK_MS = 600000;', 'var SYNC_OK_MS = 1000;'),
  'clock re-sync cadence SYNC_OK_MS / SYNC_RETRY_MS unchanged', clock);
must('settings drops the Sync now button',
  s => s.replace("title: 'Sync now'", "title: 'X'"),
  'settings General page has a Sync now Button wired to syncTimeNow', settingsSyncRow);
must('settings unbinds the status Text from timeSyncLine',
  s => s.replace('return timeSyncLine();', "return '';"),
  'settings General page has the live status Text bound to timeSyncLine', settingsSyncRow);
must('settings adds a fourth node to the sync row',
  s => s.replace("    Button({ title: 'Sync now', onPress: syncTimeNow,",
                 "    Text({ text: 'extra', style: {} }),\n    Button({ title: 'Sync now', onPress: syncTimeNow,"),
  'settings sync row adds at most 3 nodes (View + Text + Button)', settingsSyncRow);
must('settings drops the SYNC FAILED copy',
  s => s.replace("'TIME SYNC: SYNC FAILED'", "'TIME SYNC: FAIL'"),
  'settings status copy covers NTP OK / NOT SYNCED / SYNC FAILED / NO WIFI', settings);
must('settings drops the GOT_IP gate',
  s => s.replace('st.state !== lume.net.GOT_IP', 'false'),
  'settings syncTimeNow gates on GOT_IP before calling setTimeNtp()', settingsSyncHelpers);
must('settings drops the -2 -> SYNC FAILED mapping',
  s => s.replace('r === -2', 'r === -99'),
  'settings maps setTimeNtp 0 / -2 / -3 to the status strings', settingsSyncHelpers);
must('settings status heuristic stops reading system.time()',
  s => s.replace('lume.system.time()', 'Date.now()'),
  'settings status heuristic reads both lume.system.time() and Date.now()', settingsSyncHelpers);
must('clock UI copy gains a non-ASCII string',
  s => s + "\nvar __bad = '时间';",
  'clock string literals are ASCII-only', clock);
must('settings UI copy gains a non-ASCII string',
  s => s + "\nvar __bad = '时间';",
  'settings string literals are ASCII-only', settings);
must('a firmware file changes vs b5ca082',
  () => ['firmware/components/lume-engine/lume_engine.c'],
  'firmware/ runtime/ differ from b5ca082 only in the (empty) r129 allowlist', changedFiles);

console.log('ALL SNTP CONSUMER HARNESS CASES PASSED');
