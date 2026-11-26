import test from 'node:test';
import assert from 'node:assert/strict';
import { context, renderContext } from './context.js';

const MUST = ['version', 'repo', 'head', 'branch', 'manifest', 'examples',
  'unregistered', 'harnesses', 'api', 'check', 'env', 'errors'];

test('context emits every required field with --skip-check', async () => {
  const { data, failed } = await context({ skipCheck: true });
  for (const key of MUST)
    assert.ok(Object.prototype.hasOwnProperty.call(data, key), 'missing field: ' + key);
  assert.equal(failed, false);
  assert.deepEqual(data.errors, {});
  assert.deepEqual(data.check, { run: false, skipReason: 'user requested' });
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  assert.ok(data.repo.startsWith('/'));
  assert.match(data.head, /^[0-9a-f]+$/);
  assert.match(data.branch, /^[A-Za-z0-9._-]+$/);
  assert.ok(data.manifest.length >= 73);
  assert.ok(data.harnesses.includes('ota_consumers.js'));
  assert.ok(data.api.includes('lume.ui') && data.api.includes('lume.ota'));
  assert.match(data.env.node, /^v/);
});

test('unregistered is the source-grounded examples-minus-manifest set', async () => {
  const { data } = await context({ skipCheck: true });
  const registered = new Set(data.manifest);
  assert.deepEqual(data.unregistered, data.examples.filter(x => !registered.has(x)));
  assert.ok(data.examples.includes('counter') && !data.unregistered.includes('counter'));
});

test('renderContext: compact one-line JSON and pretty JSON agree', async () => {
  const { data } = await context({ skipCheck: true });
  const compact = renderContext(data, { json: true });
  const pretty = renderContext(data);
  assert.equal(compact.trimEnd().split('\n').length, 1);
  assert.match(pretty, /\n  "version":/);
  assert.deepEqual(JSON.parse(compact), JSON.parse(pretty));
});

test('a failing git block is isolated from the rest of the snapshot', async () => {
  const { data, failed } = await context({ skipCheck: true }, {
    git: () => { throw new Error('git unavailable'); },
  });
  assert.equal(failed, true);
  assert.equal(data.head, null);
  assert.equal(data.branch, null);
  assert.match(data.errors.head, /git unavailable/);
  assert.ok(data.manifest.length >= 73);
  assert.deepEqual(data.check, { run: false, skipReason: 'user requested' });
});

test('a failing sentinel check is recorded without dropping other fields', async () => {
  const { data, failed } = await context({}, {
    check: async () => { throw new Error('sentinel exploded'); },
  });
  assert.equal(failed, true);
  assert.equal(data.check.run, true);
  assert.equal(data.check.ok, false);
  assert.match(data.check.error, /sentinel exploded/);
  assert.match(data.errors.check, /sentinel exploded/);
  assert.ok(data.manifest.length >= 73);
  assert.match(data.head, /^[0-9a-f]+$/);
});
