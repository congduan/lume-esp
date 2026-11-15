import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from './protocol.js';
import { decodeRgb } from './png.js';
import { inkCount, changedPixels, analyzeFrames, scan, renderScan } from './scan.js';

const execFileAsync = promisify(execFile);
const cli = new URL('./lume.js', import.meta.url).pathname;

/* Build a minimal colour-type-2 RGB8 PNG (filter 0 rows) from a flat rgb buffer. */
function makePng(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function frame(width, height, color = [0, 0, 0]) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(color, i * 3);
  return { width, height, rgb };
}
function rect(f, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f.rgb.set(color, (y * f.width + x) * 3);
}

test('decodeRgb round-trips a synthetic RGB8 PNG', () => {
  const f = frame(6, 4, [10, 20, 30]);
  rect(f, 1, 1, 4, 3, [200, 100, 50]);
  const decoded = decodeRgb(makePng(6, 4, f.rgb));
  assert.equal(decoded.width, 6);
  assert.equal(decoded.height, 4);
  assert.deepEqual(decoded.rgb, f.rgb);
});

test('decodeRgb rejects a non-PNG buffer', () => {
  assert.throws(() => decodeRgb(Buffer.from('nope')), /not a PNG/);
});

test('inkCount counts only pixels differing from the background', () => {
  const f = frame(10, 10, [0, 0, 0]);
  rect(f, 2, 2, 5, 5, [255, 255, 255]);   // 3x3 = 9 ink pixels
  assert.equal(inkCount(f, [2, 2, 5, 5], [0, 0, 0], 24), 9);
  assert.equal(inkCount(f, [0, 0, 2, 2], [0, 0, 0], 24), 0);
});

test('changedPixels returns count and half-open bbox', () => {
  const a = frame(10, 10);
  const b = frame(10, 10);
  rect(b, 3, 4, 6, 7, [255, 0, 0]);        // 3x3 block
  const d = changedPixels(a, b, [0, 0, 10, 10], 24);
  assert.equal(d.count, 9);
  assert.deepEqual(d.bbox, [3, 4, 6, 7]);
});

const SPEC = {
  roi: [0, 0, 12, 12],
  backgroundSample: [11, 11],           // a real background pixel, outside any layer
  inkThreshold: 20,
  changeThreshold: 20,
  dynamicRegion: [5, 0, 12, 12],
  layers: [{ name: 'L', roi: [0, 0, 4, 4], minInk: 8 }],
};
function goodFrame(blobX) {
  const f = frame(12, 12);
  rect(f, 0, 0, 4, 4, [255, 255, 255]);    // static layer L (16 px)
  rect(f, blobX, 6, blobX + 2, 8, [0, 0, 255]); // dynamic blob
  return f;
}

test('analyzeFrames passes when layers persist and changes stay in bounds', () => {
  const frames = [goodFrame(6), goodFrame(7), goodFrame(8)];
  const out = analyzeFrames(frames, SPEC);
  assert.equal(out.length, 3);
  assert.ok(out.every(s => s.ok), 'all frames pass');
  assert.equal(out[1].changedPixels, 4);  // symmetric difference of two 2x2 blobs
  assert.equal(out[1].staticIntrusions, 0);
});

test('analyzeFrames detects a missing expected layer', () => {
  const broken = goodFrame(6);
  rect(broken, 0, 0, 4, 4, [0, 0, 0]);     // erase static layer
  const out = analyzeFrames([goodFrame(6), broken], SPEC);
  assert.equal(out[1].layersOk, false);
  assert.match(out[1].missing.join(' '), /L:.*< 8 ink/);
  assert.equal(out[1].ok, false);
});

test('analyzeFrames detects changed pixels intruding into a static layer', () => {
  const a = goodFrame(6);
  const b = goodFrame(6);
  rect(b, 0, 0, 2, 2, [0, 0, 0]);          // a change inside L
  const out = analyzeFrames([a, b], SPEC);
  assert.equal(out[1].layersOk, true);     // layer still has ink
  assert.equal(out[1].boundsOk, false);   // but it was touched
  assert.ok(out[1].staticIntrusions > 0);
  assert.equal(out[1].ok, false);
});

test('renderScan emits PASS/FAIL text and parseable JSON', () => {
  const okResult = { ok: true, app: 'demo', frames: 2, steps: [{ frame: 0, layerInk: {}, layersOk: true, missing: [], changedPixels: 0, changedBbox: null, boundsOk: true, outOfBounds: 0, staticIntrusions: 0, ok: true }, { frame: 1, layerInk: {}, layersOk: true, missing: [], changedPixels: 0, changedBbox: null, boundsOk: true, outOfBounds: 0, staticIntrusions: 0, ok: true }] };
  assert.match(renderScan(okResult), /RESULT: PASS \(2 frames, 0 failed; exit 0\)/);
  const json = JSON.parse(renderScan(okResult, { json: true }));
  assert.equal(json.ok, true);
  const bad = { ...okResult, ok: false, error: 'frame 1: no PNG' };
  assert.match(renderScan(bad), /RESULT: FAIL \(exit 1\)/);
});

test('scan() engine runs assertions over injected captured frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lume-scan-test-'));
  try {
    const logs = [];
    for (let k = 0; k < 3; k++) {
      const png = join(dir, `f${k}.png`);
      await writeFile(png, makePng(12, 12, goodFrame(6 + k).rgb));
      logs.push({ frame: k, seconds: 3.5 + k * 0.2, png, reload: true, bad: false, pngOk: true });
    }
    const result = await scan('demo', { scan: 3 }, {
      readSpecs: async () => ({ demo: SPEC }),
      capture: async () => ({ logs, frameError: null }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 3);
    assert.ok(result.steps.every(s => s.ok));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scan() fails cleanly when a frame is missing', async () => {
  const result = await scan('demo', { scan: 3 }, {
    readSpecs: async () => ({ demo: SPEC }),
    capture: async () => ({ logs: [], frameError: 'frame 0 (t=3.5s): no PNG' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /no PNG/);
});

test('CLI: --scan with no spec fails with exit 1 and parseable JSON', async () => {
  // counter has no scan_specs.json entry; the CLI must fail before launching esp32sim.
  let captured;
  try {
    await execFileAsync(process.execPath, [cli, 'screenshot', '--scan', '2', 'examples/counter', '--json']);
  } catch (err) { captured = err; }
  assert.ok(captured, 'expected exit 1');
  assert.equal(captured.code, 1);
  const parsed = JSON.parse(captured.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /no scan specification/);
});
