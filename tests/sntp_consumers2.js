// Host harness for the r130 SNTP *second-wave consumers* slice (pure app layer).
// Standalone CommonJS:
//   node tests/sntp_consumers2.js
// Static source-contract checks only, every one mutation-proven below:
//   - clock_round / aurora_clock / watchface: GOT_IP-gated setTimeNtp(),
//     only a 0 return enables wall-time rendering, failure copy is ASCII,
//     sync is cadence-gated in the tick (not every frame).
//   - worldclock absence (no dir, not in the 52-app playground manifest).
//   - firmware/ runtime/ tools/ are byte-identical to baseline ffdd757.
// There is NO radio and NO board on the host: nothing here proves a real SNTP
// exchange. Host net.status() is DISCONNECTED, so the GOT_IP gate is inert.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '2e192d5'; // r141: firmware changed deliberately for lume.system.reboot
const BEGIN = '/* ---- r130: SNTP sync BEGIN ---- */';
const END = '/* ---- r130: SNTP sync END ---- */';

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j);
}

// r64: comments may be Chinese; only string literals (the UI-copy surface)
// inside the NEW sync block must be ASCII. Scoped because watchface already
// ships non-ASCII complications (weekday / units) that r130 does not touch.
function asciiStrings(s) {
  const lits = [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
  return lits.length > 0 && lits.every(x => /^[\x00-\x7F]*$/.test(x));
}

const APPS = [
  { name: 'clock_round', p: 'clock', path: 'examples/clock_round/app.js' },
  { name: 'aurora_clock', p: 'ac', path: 'examples/aurora_clock/app.js' },
  { name: 'watchface', p: 'face', path: 'examples/watchface/app.js' },
];
const sources = {}, sync = {}, valid = {}, status = {}, next = {};
for (const a of APPS) {
  sources[a.name] = read(a.path);
  sync[a.name] = sliceBetween(sources[a.name], BEGIN, END);
  valid[a.name] = a.p + 'WallValid';
  status[a.name] = a.p + 'SyncStatus';
  next[a.name] = a.p + 'NextSyncMs';
}

// The 52-app playground manifest is the source of truth for "in清单".
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
/* r133 registers adc_meter in tools/playground/build.mjs (data-only) as the
 * 46th app; r134 adds crypto_check as the 47th; r135 adds archive_view as the
 * 48th. Keep the firmware/runtime/CLI surface pinned to the baseline. */
const changed = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);

// --- checks -----------------------------------------------------------------
const checks = [];
for (const a of APPS) {
  const n = a.name, v = valid[n], st = status[n];
  checks.push([`${n}: GOT_IP-gated setTimeNtp call in sync block`, [sync[n], s =>
    s.includes('st.state !== lume.net.GOT_IP') &&
    s.includes('sys.setTimeNtp()') &&
    s.indexOf('lume.net.GOT_IP') < s.indexOf('sys.setTimeNtp()')]]);
  checks.push([`${n}: only setTimeNtp()===0 sets ${v}=true (enables wall rendering)`,
    [sync[n], s =>
      (s.match(new RegExp(v + ' = true;', 'g')) || []).length === 1 &&
      new RegExp('if \\(r === 0\\)\\s*\\{\\s*' + v + ' = true;').test(s)]]);
  checks.push([`${n}: status Text gated by ${v} and bound to ${st}()`, [sources[n], s =>
    s.includes(v + ' ? ') && s.includes(st + '()')]]);
  checks.push([`${n}: failure copy ASCII (SYNCING/NO WIFI/NO SYNC)`, [sync[n], s =>
    ["'SYNCING'", "'NO WIFI'", "'NO SYNC'"].every(t => s.includes(t)) && asciiStrings(s)]]);
  checks.push([`${n}: sync cadence-gated in tick via ${next[n]}`, [sources[n], s =>
    s.includes('lume._nowMs() >= ' + next[n])]]);
}
checks.push(['all three migrated apps are in the 52-app playground manifest',
  [playgroundApps, list => list.length === 52 &&
    ['clock_round', 'aurora_clock', 'watchface'].every(x => list.includes(x))]]);
checks.push(['worldclock absent (no example dir, not in manifest)',
  [playgroundApps, list => !list.includes('worldclock') &&
    !fs.existsSync(path.join(root, 'examples/worldclock/app.js'))]]);
checks.push(['firmware/ runtime/ CLI tooling identical to ffdd757 (manifest excluded)',
  [changed, c => c.length === 0]]);

for (const [name, [source, test]] of checks) {
  assert.ok(test(source), 'FAIL sntp_consumers2: ' + name);
  console.log('PASS sntp_consumers2: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, source) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS sntp_consumers2 mutation: ' + name + ' -> FAIL as expected');
}

for (const a of APPS) {
  const n = a.name, v = valid[n], st = status[n];
  must(`${n}: drop the GOT_IP gate`,
    s => s.replace('st.state !== lume.net.GOT_IP', 'false'),
    `${n}: GOT_IP-gated setTimeNtp call in sync block`, sync[n]);
  must(`${n}: success branch no longer requires r===0`,
    s => s.replace('if (r === 0)', 'if (r !== 0)'),
    `${n}: only setTimeNtp()===0 sets ${v}=true (enables wall rendering)`, sync[n]);
  must(`${n}: unbind status Text from the wallValid flag`,
    s => s.replace(v + ' ? ', ''),
    `${n}: status Text gated by ${v} and bound to ${st}()`, sources[n]);
  must(`${n}: inject non-ASCII failure copy`,
    s => s + "\nvar __bad = '时间';",
    `${n}: failure copy ASCII (SYNCING/NO WIFI/NO SYNC)`, sync[n]);
  must(`${n}: call setTimeNtp on every tick`,
    s => s.replace('lume._nowMs() >= ' + next[n], 'true'),
    `${n}: sync cadence-gated in tick via ${next[n]}`, sources[n]);
}
must('playground manifest drops clock_round',
  list => list.filter(x => x !== 'clock_round'),
  'all three migrated apps are in the 52-app playground manifest', playgroundApps);
must('playground manifest gains worldclock',
  list => [...list, 'worldclock'],
  'worldclock absent (no example dir, not in manifest)', playgroundApps);
must('a firmware file changes vs ffdd757',
  () => ['firmware/components/lume-engine/lume_engine.c'],
  'firmware/ runtime/ CLI tooling identical to ffdd757 (manifest excluded)', changed);

console.log('ALL SNTP CONSUMERS2 HARNESS CASES PASSED');
