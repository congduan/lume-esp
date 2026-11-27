// `lume screenshot --scan N`: half-frame / layer-integrity regression harness.
//
// esp32sim only writes one `--tft-png` at the end of a run, so N consecutive
// frames of the SAME deterministic execution are captured as N boots at
// increasing --max-seconds (fixed firmware + fixed app frame + fixed script).
// Each frame is decoded and checked with two assertions, the same two the
// manual harness used to catch the mid-frame blit and needle-union bugs:
//   A) expected layer set: every declared static layer ROI still has ink,
//   B) changed pixels in bounds: pixels that changed since the previous frame
//      stay inside dynamicRegion and never intrude into a static layer ROI.
//
// Exit 0 = all frames pass, 1 = any fail (same contract as `lume check`).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { bundle } from './bundle.js';
import { frame } from './protocol.js';
import { decodeRgb } from './png.js';
import { rgbFromRgb565 } from './shot.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SPECS_PATH = join(ROOT, 'tools/lume/scan_specs.json');
const SCAN_ROOT = join(ROOT, 'artifacts/check');

function rgbAt(f, x, y) {
  const i = (y * f.width + x) * 3;
  return [f.rgb[i], f.rgb[i + 1], f.rgb[i + 2]];
}
function maxDiff(a, b) {
  let m = Math.abs(a[0] - b[0]);
  const g = Math.abs(a[1] - b[1]), bl = Math.abs(a[2] - b[2]);
  return g > m ? (bl > g ? bl : g) : (bl > m ? bl : m);
}
function inBox(x, y, box) { return x >= box[0] && y >= box[1] && x < box[2] && y < box[3]; }

/* A static layer is "present" when enough pixels in its ROI differ from the
 * sampled background. The background reference is a screen-corner sample so it
 * matches the firmware's RGB565->RGB8 round-trip exactly. */
export function inkCount(f, roi, bg, threshold) {
  let n = 0;
  for (let y = roi[1]; y < roi[3]; y++) {
    for (let x = roi[0]; x < roi[2]; x++) {
      if (maxDiff(rgbAt(f, x, y), bg) > threshold) n++;
    }
  }
  return n;
}

/* Pixels whose colour changed between two frames, inside roi. Returns the
 * count, the bbox [x0,y0,x1,y1] (half-open) or null, and the changed points. */
export function changedPixels(a, b, roi, threshold) {
  let count = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const points = [];
  for (let y = roi[1]; y < roi[3]; y++) {
    for (let x = roi[0]; x < roi[2]; x++) {
      if (maxDiff(rgbAt(a, x, y), rgbAt(b, x, y)) <= threshold) continue;
      count++;
      points.push([x, y]);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x >= x1) x1 = x + 1;
      if (y >= y1) y1 = y + 1;
    }
  }
  return { count, bbox: count ? [x0, y0, x1, y1] : null, points };
}

/* Pure per-frame analysis. frames: [{width,height,rgb}] (already decoded).
 * spec: the app's entry from scan_specs.json (or a custom static-region spec). */
export function analyzeFrames(frames, spec) {
  const bgSample = spec.backgroundSample || [0, 0];
  const inkThr = spec.inkThreshold ?? 24;
  const chThr = spec.changeThreshold ?? 24;
  const layers = spec.layers || [];
  const hasDyn = Array.isArray(spec.dynamicRegion) && spec.dynamicRegion.length > 0;
  const boxes = hasDyn
    ? (Array.isArray(spec.dynamicRegion[0]) ? spec.dynamicRegion : [spec.dynamicRegion])
    : null;
  const out = [];
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    const roi = spec.roi || [0, 0, f.width, f.height];
    const bg = rgbAt(f, Math.min(bgSample[0], f.width - 1), Math.min(bgSample[1], f.height - 1));
    // Assertion A: expected layer set present.
    const layerInk = {};
    const missing = [];
    for (const layer of layers) {
      const n = inkCount(f, layer.roi, bg, inkThr);
      layerInk[layer.name] = n;
      const minInk = layer.minInk ?? 1;
      if (n < minInk) missing.push(`${layer.name}: ${n} < ${minInk} ink`);
    }
    // Assertion B: changed pixels stay in bounds (frame 0 compares to itself).
    const prev = k === 0 ? f : frames[k - 1];
    const diff = changedPixels(prev, f, roi, chThr);
    const outOfBounds = [];
    const intrusions = [];
    for (const [x, y] of diff.points) {
      if (boxes && !boxes.some(b => inBox(x, y, b))) outOfBounds.push([x, y]);
      if (layers.some(l => inBox(x, y, l.roi))) intrusions.push([x, y]);
    }
    const frameResult = {
      frame: k,
      layerInk,
      layersOk: missing.length === 0,
      missing,
      changedPixels: diff.count,
      changedBbox: diff.bbox,
      boundsOk: outOfBounds.length === 0 && intrusions.length === 0,
      outOfBounds: outOfBounds.length,
      staticIntrusions: intrusions.length,
    };
    frameResult.ok = frameResult.layersOk && frameResult.boundsOk;
    out.push(frameResult);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Capture: N deterministic esp32sim boots at increasing stop times.  */
/* ------------------------------------------------------------------ */
function findRom() {
  if (process.env.EMU_ROM) return process.env.EMU_ROM;
  const base = join(homedir(), '.espressif/tools/esp-rom-elfs');
  const entries = [];
  function walk(dir) {
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'esp32s3_rev0_rom.elf') entries.push(p);
    }
  }
  walk(base);
  return entries[0] || '';
}

function simBin() {
  return process.env.EMU_BIN || join(ROOT, 'tools/emu/.cache/bin/esp32sim');
}
function images() {
  return {
    bootloader: join(ROOT, 'firmware/build/bootloader/bootloader.bin'),
    ptable: join(ROOT, 'firmware/build/partition_table/partition-table.bin'),
    app: join(ROOT, 'firmware/build/lume.bin'),
  };
}

function runSim(bin, args, timeoutMs) {
  return new Promise(res => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, done = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGKILL');
    }, timeoutMs);
    const finish = code => {
      if (done) return;
      done = true; clearTimeout(timer);
      res({ code, timedOut, stdout, stderr });
    };
    child.on('error', err => { if (!done) { stderr += '\n' + err.message; finish(null); } });
    child.on('close', finish);
  });
}

async function defaultCapture(appDir, outDir, N, spec, timeoutMs) {
  await mkdir(outDir, { recursive: true });
  const imgs = images();
  for (const [k, p] of Object.entries(imgs)) {
    if (!existsSync(p)) throw new Error(`firmware image missing: ${p} (build firmware first, or run from tools/emu/run.sh once)`);
  }
  const rom = findRom();
  if (!rom || !existsSync(rom)) throw new Error('S3 ROM ELF missing; set EMU_ROM (see tools/emu/README.md)');
  const bin = simBin();
  if (!existsSync(bin)) throw new Error(`esp32sim missing: ${bin}; run tools/emu/setup.sh`);

  const payload = await bundle(appDir);
  const framed = frame(payload);
  const framePath = join(outDir, 'app.frame');
  await writeFile(framePath, framed);
  // r181: pace large frames (see tools/emu/run.sh) — a single >~32 KiB burst
  // strands bytes in esp32sim's USB model and leaves the frame parser mid-body.
  // 4 KiB pieces at 10 ms keep even a 42 KiB frame inside the capture window.
  const CHUNK = 4096, STEP_MS = 10;
  const pieces = [];
  for (let off = 0, i = 0; off < framed.length; off += CHUNK, i++) {
    const part = join(outDir, `app.frame.part-${String(i).padStart(3, '0')}`);
    await writeFile(part, framed.subarray(off, off + CHUNK));
    const t = 2500 + i * STEP_MS;
    pieces.push(`${Math.floor(t / 1000)}.${String(t % 1000).padStart(3, '0')} serial-file ${part}`);
  }
  const actions = [...pieces, ...(spec.scriptLines || [])];
  const actionsPath = join(outDir, 'actions.txt');
  await writeFile(actionsPath, actions.join('\n') + '\n');

  const start = spec.start ?? 3.5;
  const step = spec.step ?? 0.2;
  const board = process.env.EMU_BOARD || 'lume-amoled216';
  const logs = [];
  for (let k = 0; k < N; k++) {
    const t = +(start + k * step).toFixed(3);
    const png = join(outDir, `frame_${String(k).padStart(2, '0')}.png`);
    const log = join(outDir, `serial_${String(k).padStart(2, '0')}.log`);
    const args = [
      '--chip', 's3', '--board', board, '--boot', 'rom', '--rom', rom,
      '--bootloader', imgs.bootloader, '--ptable', imgs.ptable, '--app', imgs.app,
      '--flash-mb', '16', '--psram-mb', '8', '--script', actionsPath,
      '--max-seconds', String(t), '--tft-png', png, '--console', 'all', '--no-dump',
    ];
    const r = await runSim(bin, args, timeoutMs);
    const text = (r.stdout || '') + (r.stderr || '');
    await writeFile(log, text);
    const reload = /engine recv RELOAD/.test(text);
    const bad = /eval failed|RELOAD ERR/.test(text);
    const pngOk = existsSync(png);
    logs.push({ frame: k, seconds: t, png, log, reload, bad, pngOk, timedOut: r.timedOut, code: r.code });
    if (bad || !reload || !pngOk || r.timedOut) {
      // Keep capturing nothing else; a broken frame fails the whole scan.
      return { logs, frameError: `frame ${k} (t=${t}s): ${!pngOk ? 'no PNG' : bad ? 'eval/RELOAD error' : !reload ? 'no app reload' : r.timedOut ? 'timeout' : 'sim exit ' + r.code}` };
    }
  }
  return { logs, frameError: null };
}

/* ------------------------------------------------------------------ */
/* Engine                                                            */
/* ------------------------------------------------------------------ */
export async function scan(appDir, options = {}, deps = {}) {
  const io = {
    bundle: null,                       // defaultCapture uses bundle directly
    readSpecs: async () => JSON.parse(await readFile(SPECS_PATH, 'utf8')),
    capture: defaultCapture,
    ...deps,
  };
  const N = Math.max(1, Number(options.scan) || 5);
  const timeoutMs = Math.max(1, Number(options.timeout) || 90) * 1000;
  const abs = resolve(appDir);
  const rel = relative(ROOT, abs);
  const app = rel.startsWith('..') ? appDir : (rel || basename(abs));
  const name = basename(abs);
  const outDir = join(SCAN_ROOT, name, 'scan');
  const result = { ok: false, app, frames: N, steps: [], outDir: relative(ROOT, outDir) };

  let spec;
  try {
    const specs = await io.readSpecs();
    spec = specs[name];
    if (!spec) throw new Error(`no scan specification for "${name}" (add it to tools/lume/scan_specs.json)`);
  } catch (err) {
    result.error = err.message;
    return result;
  }

  let cap;
  try {
    cap = await io.capture(abs, outDir, N, spec, timeoutMs);
  } catch (err) {
    result.error = err.message;
    return result;
  }
  result.capture = cap.logs.map(l => ({ frame: l.frame, seconds: l.seconds, png: relative(ROOT, l.png) }));
  if (cap.frameError) {
    result.error = cap.frameError;
    return result;
  }

  const frames = [];
  for (const l of cap.logs) {
    frames.push(decodeRgb(await readFile(l.png)));
  }
  const perFrame = analyzeFrames(frames, spec);
  result.steps = perFrame;
  result.ok = perFrame.every(s => s.ok);
  return result;
}

/* ------------------------------------------------------------------ */
/* Device burst-scan: capture N frames over USB serial / WiFi OTA.    */
/* Asserts every frame is complete (no truncation / CRC / shot-tx)    */
/* and optionally checks static-region dirty-area assertions.         */
/* ------------------------------------------------------------------ */
function normalizeStaticSpec(staticRegions) {
  const layers = staticRegions.map((entry, idx) => {
    if (Array.isArray(entry)) {
      return { name: `static-${idx}`, roi: entry, minInk: 0 };
    }
    return { name: entry.name || `static-${idx}`, roi: entry.roi, minInk: entry.minInk ?? 0 };
  });
  return { layers };
}

export async function scanDevice(device, options = {}, deps = {}) {
  const io = {
    readSpecs: async () => JSON.parse(await readFile(SPECS_PATH, 'utf8')),
    sleep: ms => new Promise(res => setTimeout(res, ms)),
    ...deps,
  };
  const N = Math.max(1, Number(options.scan) || 5);
  const intervalMs = Math.max(0, Number(options.intervalMs) || 0);
  const target = device.path ?? device.address ?? 'device';
  const result = {
    ok: false,
    mode: 'device',
    target,
    frames: N,
    spec: null,
    steps: [],
  };

  let spec = options.spec || null;
  if (!spec && options.specName) {
    try {
      const specs = await io.readSpecs();
      const rawName = String(options.specName);
      const baseName = basename(resolve(rawName));
      spec = specs[rawName] || specs[baseName] || null;
      if (!spec) {
        throw new Error(`no scan specification for "${rawName}" (add it to tools/lume/scan_specs.json)`);
      }
      result.spec = specs[rawName] ? rawName : baseName;
    } catch (err) {
      result.error = err.message;
      return result;
    }
  } else if (!spec && Array.isArray(options.staticRegions) && options.staticRegions.length > 0) {
    spec = normalizeStaticSpec(options.staticRegions);
    result.spec = 'static-regions';
  } else if (spec) {
    result.spec = options.specName || 'custom';
  }

  const rgbFrames = [];
  for (let k = 0; k < N; k++) {
    let shot;
    try {
      shot = await device.screenshot();
      if (!shot || !Number.isInteger(shot.width) || !Number.isInteger(shot.height) ||
          shot.width <= 0 || shot.height <= 0 || !Buffer.isBuffer(shot.data)) {
        throw new Error('device returned malformed screenshot frame');
      }
      const expected = shot.width * shot.height * 2;
      if (shot.data.length !== expected) {
        throw new Error(`screenshot payload truncated: ${shot.data.length} != ${expected} bytes`);
      }
      rgbFrames.push(rgbFromRgb565(shot.data, shot.width, shot.height));
      result.steps.push({
        frame: k,
        width: shot.width,
        height: shot.height,
        bytes: shot.data.length,
        complete: true,
        ok: true,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      result.steps.push({
        frame: k,
        complete: false,
        ok: false,
        error: msg,
      });
      result.error = `frame ${k}: ${msg}`;
      result.ok = false;
      return result;
    }
    if (k + 1 < N && intervalMs > 0) {
      await io.sleep(intervalMs);
    }
  }

  if (spec) {
    const analyzed = analyzeFrames(rgbFrames, spec);
    for (let k = 0; k < analyzed.length; k++) {
      const step = result.steps[k];
      const a = analyzed[k];
      result.steps[k] = { ...step, ...a, ok: step.complete && a.ok };
    }
  }

  result.ok = result.steps.length === N && result.steps.every(s => s.ok);
  return result;
}

export function renderScan(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2) + '\n';
  if (result.mode === 'device') {
    const label = result.spec ? `${result.target} (${result.spec})` : result.target;
    const lines = [`lume screenshot --scan ${result.frames} ${label}`, ''];
    if (result.error) {
      lines.push(`[FAIL] error: ${result.error}`);
      lines.push('', 'RESULT: FAIL (exit 1)');
      return lines.join('\n') + '\n';
    }
    lines.push(`frames: ${result.frames}   target: ${result.target}`);
    for (const s of result.steps) {
      let line = `[${s.ok ? 'PASS' : 'FAIL'}] frame ${String(s.frame).padStart(2)}  ` +
        `${s.width}x${s.height}  bytes=${s.bytes}  complete=${s.complete ? 'yes' : 'no'}`;
      if (s.layerInk) {
        const ink = Object.entries(s.layerInk).map(([k, v]) => `${k}=${v}`).join(' ');
        line += `  layers[${ink}]  changed=${s.changedPixels}  ` +
          `bbox=${s.changedBbox ? s.changedBbox.join(',') : '-'}  ` +
          `oob=${s.outOfBounds}  static-hits=${s.staticIntrusions}` +
          (s.missing && s.missing.length ? `  MISSING: ${s.missing.join('; ')}` : '');
      }
      lines.push(line);
    }
    const failed = result.steps.filter(s => !s.ok).length;
    lines.push('');
    lines.push(`RESULT: ${result.ok ? 'PASS' : 'FAIL'} (${result.steps.length} frames, ${failed} failed; exit ${result.ok ? 0 : 1})`);
    return lines.join('\n') + '\n';
  }
  const lines = [`lume screenshot --scan ${result.frames} ${result.app}`, ''];
  if (result.error) {
    lines.push(`[FAIL] error: ${result.error}`);
    lines.push('', `RESULT: FAIL (exit 1)`);
    return lines.join('\n') + '\n';
  }
  lines.push(`frames: ${result.frames}   source: ${result.outDir}`);
  for (const s of result.steps) {
    const ink = Object.entries(s.layerInk).map(([k, v]) => `${k}=${v}`).join(' ');
    lines.push(
      `[${s.ok ? 'PASS' : 'FAIL'}] frame ${String(s.frame).padStart(2)}  ` +
      `layers[${ink}]  changed=${s.changedPixels}  ` +
      `bbox=${s.changedBbox ? s.changedBbox.join(',') : '-'}  ` +
      `oob=${s.outOfBounds}  static-hits=${s.staticIntrusions}` +
      (s.missing.length ? `  MISSING: ${s.missing.join('; ')}` : '')
    );
  }
  const failed = result.steps.filter(s => !s.ok).length;
  lines.push('');
  lines.push(`RESULT: ${result.ok ? 'PASS' : 'FAIL'} (${result.steps.length} frames, ${failed} failed; exit ${result.ok ? 0 : 1})`);
  return lines.join('\n') + '\n';
}
