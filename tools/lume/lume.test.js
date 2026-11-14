import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { frame, crc32, CONTROL, MAX_PAYLOAD } from './protocol.js';

test('frame bytes match firmware wire layout and CRC-32', () => {
  const bytes = frame('123456789');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(bytes.toString('hex'), '4c554d45090000002639f4cb313233343536373839');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 12);
  assert.equal(bytes.readUInt32LE(8), crc32(bytes.subarray(12)));
  assert.equal(CONTROL.back.toString('hex'), '4241434b');
  assert.equal(CONTROL.pause.toString('hex'), '50415553');
  assert.equal(CONTROL.resume.toString('hex'), '5245534d');
  assert.throws(() => frame(''), /1\.\.262144/);
  assert.throws(() => frame(Buffer.alloc(MAX_PAYLOAD + 1)), /1\.\.262144/);
});

test('create writes complete offline scaffold and bundles with prelude globals', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'lume-test-'));
  const root = join(parent, 'counter');
  try {
    await create(root);
    assert.deepEqual((await readdir(root)).sort(), ['.gitignore', 'app.js', 'package.json', 'tsconfig.json']);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.lume.entry, 'app.js');
    assert.match(manifest.scripts.sim, /sim\.js" app\.js$/);
    const output = await bundle(root, { minify: false });
    assert.ok(output.length > 0);
    assert.match(output.toString(), /View\(/);
    const globals = { signal: () => Object.assign(() => 0, { set() {} }), View() {}, Text() {}, Button() {} };
    runInNewContext(output.toString(), globals);
    await assert.rejects(create(root), /already exists/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('esbuild iife runs in global-script host; esm syntax does not', async () => {
  const options = { stdin: { contents: 'globalThis.result = signal(7)();', resolveDir: process.cwd() }, bundle: true, write: false, target: 'es2020' };
  const iife = await build({ ...options, format: 'iife' });
  const globals = { signal: n => () => n };
  runInNewContext(iife.outputFiles[0].text, globals);
  assert.equal(globals.result, 7);
  const esm = await build({ ...options, stdin: { contents: 'export const result = signal(7)();', resolveDir: process.cwd() }, format: 'esm' });
  assert.throws(() => runInNewContext(esm.outputFiles[0].text, globals), { name: 'SyntaxError', message: /export/ });
});

test('bundle rejects oversize output before opening serial', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'lume-big-'));
  try {
    await writeFile(join(parent, 'app.js'), `globalThis.data = '${'x'.repeat(MAX_PAYLOAD)}';`);
    await assert.rejects(bundle(parent, { minify: false }), /bundle must be/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
