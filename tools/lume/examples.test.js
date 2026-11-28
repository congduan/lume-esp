import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageExamples, catalog, renderCatalog } from './examples.js';

test('parsePageExamples: real page.js yields 7-string tuples with shape, counter present', async () => {
  const entries = await parsePageExamples();
  assert.ok(entries.length >= 60, 'expected >=60 entries, got ' + entries.length);
  const counter = entries.find(e => e[0] === 'counter');
  assert.ok(counter, 'counter missing from page.js examples');
  assert.equal(counter[1].length >= 1, true, 'icon field present');
  assert.equal(counter[2], 'Counter');
  assert.equal(counter[4], 'Tap-driven counter');
  assert.equal(counter[6], 'square');
  assert.ok(counter[3].length > 0 && counter[5].length > 0, 'zh fields non-empty');
  for (const e of entries)
    assert.ok(e.length === 7 && e.every(v => typeof v === 'string') &&
      (e[6] === 'round' || e[6] === 'square'), 'bad tuple: ' + JSON.stringify(e));
});

test('parsePageExamples: throws pointed error on shape drift', async () => {
  await assert.rejects(
    () => parsePageExamples('const examples = [];'),
    /cannot locate|malformed/
  );
  await assert.rejects(
    () => parsePageExamples('const examples = [\n    [1,2,3,4,5,6,7],\n  ];'),
    /7-string tuple/
  );
  await assert.rejects(
    () => parsePageExamples("const examples = [\n    ['a','A','A','A','A','A','oval'],\n  ];"),
    /7-string tuple/
  );
});

test('catalog: manifest and disk union, registration flags grounded', async () => {
  const { rows, summary, missingOnDisk, missingMeta } = await catalog();
  assert.ok(rows.length >= summary.total);
  assert.equal(summary.total, rows.length);
  assert.equal(summary.registered + summary.unregistered, rows.length);
  const names = new Set(rows.map(r => r.name));
  assert.ok(names.has('counter'));
  // every manifest app is registered=true
  for (const r of rows) {
    if (r.name === 'counter') { assert.equal(r.registered, true); assert.equal(r.metaSource, 'page.js'); }
    if (!r.registered) assert.equal(r.metaSource === 'fallback' || r.metaSource === 'page.js', true);
  }
  assert.ok(Array.isArray(missingOnDisk) && Array.isArray(missingMeta));
});

test('catalog with injected deps: no disk access, deterministic', async () => {
  const fakeEntries = [
    ['alpha', 'A', 'Alpha', 'Jia', 'First', 'Di Yi', 'round'],
    ['beta', 'B', 'Beta', 'Yi', 'Second', 'Di Er', 'square'],
  ];
  const calls = { parse: 0 };
  const { rows, summary } = await catalog({
    parseExamples: async () => { calls.parse++; return fakeEntries; },
    manifestApps: () => ['alpha', 'beta', 'ghost'],
    examplesDir: ['alpha'],
  });
  assert.equal(rows.length, 3);
  const alpha = rows.find(r => r.name === 'alpha');
  assert.equal(alpha.shape, 'round');
  const ghost = rows.find(r => r.name === 'ghost');
  assert.equal(ghost.registered, true);
  assert.equal(ghost.metaSource, 'fallback');
  assert.equal(ghost.icon, '?');
  assert.equal(ghost.shape, 'square');
  assert.deepEqual(summary, { total: 3, registered: 3, unregistered: 0, missingMeta: 1, missingOnDisk: 2 });
  assert.equal(calls.parse, 1);
});

test('renderCatalog: text lines + final summary JSON; json mode is NDJSON', async () => {
  const data = await catalog({
    parseExamples: async () => [['solo', 'S', 'Solo', 'Du', 'Only one', 'Zhi You Yi Ge', 'square']],
    manifestApps: () => ['solo'],
    examplesDir: ['solo'],
  });
  const text = renderCatalog(data);
  const textLines = text.trimEnd().split('\n');
  assert.match(textLines[0], /^\+ solo\s{2,}Solo \/ Du\s{2,}Only one$/);
  const tail = JSON.parse(textLines[textLines.length - 1]);
  assert.equal(tail.summary.total, 1);
  const json = renderCatalog(data, { json: true });
  const jsonLines = json.trimEnd().split('\n');
  assert.equal(jsonLines.length, 2); // 1 row + 1 summary
  assert.deepEqual(JSON.parse(jsonLines[0]).name, 'solo');
  assert.deepEqual(JSON.parse(jsonLines[1]).summary.total, 1);
});
