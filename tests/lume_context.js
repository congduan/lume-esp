/* r199 host harness: `lume context` is a real CLI spawn, not a source scan.
 * Standalone CommonJS: node tests/lume_context.js
 * The brief expected `unregistered` to be []; the source proves 9 example
 * directories are absent from the 73-app playground manifest. We assert the
 * source-grounded set instead (independently recomputed) and prove the
 * predicate is load-bearing with a mutation self-check. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const run = args => spawnSync(process.execPath,
  ['tools/lume/lume.js', 'context', ...args],
  { cwd: root, encoding: 'utf8' });

const MUST = ['version', 'repo', 'head', 'branch', 'manifest', 'examples',
  'unregistered', 'harnesses', 'api', 'check', 'env', 'errors'];
function mustHaveFields(d) {
  return MUST.every(k => Object.prototype.hasOwnProperty.call(d, k));
}
function unregisteredMatches(d, expected) {
  return Array.isArray(d.unregistered) &&
    JSON.stringify([...d.unregistered].sort()) === JSON.stringify([...expected].sort());
}

const proc = run(['--json']);
assert.equal(proc.status, 0, 'lume context --json failed: ' + proc.stderr);
const data = JSON.parse(proc.stdout);
assert.ok(mustHaveFields(data), 'missing required context fields');
console.log('PASS context --json exits 0 with parseable stdout and all required fields');

const mutated = { ...data };
delete mutated.head;
assert.equal(mustHaveFields(mutated), false,
  'must-have-fields check is decorative; deleting head did not turn it red');
console.log('PASS mutation: deleting head turns the must-have-fields check red');

assert.equal(proc.stdout.trimEnd().split('\n').length, 1, '--json must be one compact line');
assert.match(data.repo, /^\//);
assert.match(data.version, /^\d+\.\d+\.\d+$/);
console.log('PASS --json is a single compact line with absolute repo and semver version');

assert.ok(Array.isArray(data.manifest) && data.manifest.length >= 73,
  'manifest has fewer than 73 apps');
const manifestSource = fs.readFileSync(path.join(root, 'tools/playground/build.mjs'), 'utf8');
const listBlock = (manifestSource.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground manifest array not found');
const manifest = listBlock.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
assert.deepEqual(data.manifest, manifest, 'manifest does not mirror build.mjs');
console.log('PASS manifest mirrors build.mjs with at least 73 apps');

const examples = fs.readdirSync(path.join(root, 'examples'), { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name);
const expectedUnregistered = examples.filter(x => !manifest.includes(x));
assert.ok(unregisteredMatches(data, expectedUnregistered), 'unregistered != examples minus manifest');
assert.ok(!data.unregistered.includes('counter'), 'registered app leaked into unregistered');
assert.equal(unregisteredMatches({ ...data, unregistered: [...data.unregistered, 'bogus'] },
  expectedUnregistered), false, 'unregistered predicate is decorative');
console.log('PASS unregistered is the source-grounded examples-minus-manifest set (mutation -> FAIL)');
console.log('INFO unregistered count: ' + data.unregistered.length + ' (brief expected 0; source is truth)');

const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
  { cwd: root, encoding: 'utf8' }).trim();
assert.equal(data.head, head, 'head does not match independent git rev-parse');
assert.match(data.branch, /^[A-Za-z0-9._-]+$/);
console.log('PASS head matches independent git rev-parse (' + head + ')');

assert.ok(Array.isArray(data.harnesses) && data.harnesses.includes('lume_context.js'));
assert.ok(Array.isArray(data.api) && data.api.includes('lume.ui') && data.api.includes('lume.ota'));
console.log('PASS harnesses include this harness; api lists real lume namespaces');

assert.equal(data.check.run, true, 'sentinel check did not run');
assert.equal(data.check.ok, true, 'sentinel check is not green: ' + JSON.stringify(data.check));
assert.deepEqual(data.errors, {}, 'snapshot reported block errors: ' + JSON.stringify(data.errors));
assert.match(data.env.node, /^v/);
assert.equal(data.env.platform, process.platform);
console.log('PASS sentinel check green, no block errors, env.node is a v-prefixed version');

const skipped = run(['--json', '--skip-check']);
assert.equal(skipped.status, 0, 'context --skip-check failed: ' + skipped.stderr);
const skipData = JSON.parse(skipped.stdout);
assert.equal(skipData.check.run, false);
assert.equal(skipData.check.skipReason, 'user requested');
assert.deepEqual(skipData.errors, {});
assert.ok(skipData.manifest.length >= 73, 'skip-check dropped the other blocks');
console.log('PASS --skip-check records run:false + skipReason and keeps every other block');

const strict = run(['--json', '--strict']);
assert.equal(strict.status, 0, 'context --strict failed on a green repo: ' + strict.stderr);
assert.deepEqual(JSON.parse(strict.stdout).errors, {});
console.log('PASS --strict exits 0 when every block is green');

console.log('ALL LUME CONTEXT HARNESS CASES PASSED');
