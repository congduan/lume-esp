import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { bundle as esbuildBundle } from './bundle.js';
import {
  parseEvalError, EVAL_OK_RE, MISSING_MEMBER_RE,
  findUnknownMembers, suggest, readCatalog,
} from './check_suggest.js';
import { hasLayoutSpec, runLayout, LAYOUT_SPEC_PATH } from './check_layout.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const RUN_SH = join(ROOT, 'tools/emu/run.sh');
const DTS_PATH = join(ROOT, 'runtime/types/lume.d.ts');
const CHECK_ROOT = join(ROOT, 'artifacts/check');

/* ------------------------------------------------------------------ */
/* Default I/O. Tests inject replacements for the heavy steps.           */
/* ------------------------------------------------------------------ */

async function defaultBundle(appDir) {
  return await esbuildBundle(appDir);
}

async function defaultAppSources(appDir) {
  const root = resolve(appDir);
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.js')) {
        try { out.push({ file: relative(root, p), text: await readFile(p, 'utf8') }); } catch { /* skip */ }
      }
    }
  }
  await walk(root);
  return out;
}

/* run.sh takes the app dir as $1; EMU_OUTPUT_DIR redirects all of its products
 * (app.frame/actions.txt/serial.log/tft.png) into artifacts/check/<app>/ so
 * artifacts/emu stays untouched. When the firmware images already exist we
 * skip the (slow) idf.py build inside run.sh. */
async function defaultRunEmu(appDir, outDir, timeoutMs) {
  await mkdir(outDir, { recursive: true });
  const images = [
    'firmware/build/lume.bin',
    'firmware/build/bootloader/bootloader.bin',
    'firmware/build/partition_table/partition-table.bin',
  ];
  const env = { ...process.env, EMU_OUTPUT_DIR: outDir };
  if (images.every(p => existsSync(join(ROOT, p)))) env.EMU_SKIP_BUILD = '1';
  return await new Promise(res => {
    const child = spawn('bash', [RUN_SH, resolve(appDir)], {
      env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let stdout = '', stderr = '', timedOut = false, done = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    const finish = async code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let serialLog = '';
      try { serialLog = await readFile(join(outDir, 'serial.log'), 'utf8'); } catch { /* no log */ }
      const png = join(outDir, 'tft.png');
      res({
        exitCode: code, timedOut, stdout, stderr, serialLog,
        screenshot: existsSync(png) ? relative(ROOT, png) : null,
      });
    };
    child.on('error', err => {
      if (!done) { stderr += `\n${err.message}`; finish(null); }
    });
    child.on('close', finish);
  });
}

/* Best-effort perf summary from the optional `lume-perf:` profile lines.
 * Absent profile data is a normal skip, never a failure. */
export function parsePerf(serialLog) {
  if (!serialLog) return null;
  const lines = serialLog.split(/\r?\n/).filter(l => l.includes('lume-perf:'));
  if (!lines.length) return null;
  let fps = null, renderAvgUs = null, renderMaxUs = null, evalAvgUs = null;
  for (const l of lines) {
    const body = l.replace(/^.*?lume-perf:\s*/, '');
    const kv = {};
    for (const m of body.matchAll(/(\w+)=(-?\d+)/g)) kv[m[1]] = Number(m[2]);
    if (Number.isFinite(kv.fps)) fps = Math.max(fps ?? 0, kv.fps);
    if (/^render\b/.test(body)) {
      if (Number.isFinite(kv.avg_us)) renderAvgUs = Math.max(renderAvgUs ?? 0, kv.avg_us);
      if (Number.isFinite(kv.max_us)) renderMaxUs = Math.max(renderMaxUs ?? 0, kv.max_us);
    }
    if (/^eval\b/.test(body) && Number.isFinite(kv.avg_us)) evalAvgUs = Math.max(evalAvgUs ?? 0, kv.avg_us);
  }
  const out = {};
  if (fps !== null) out.fps = fps;
  if (renderAvgUs !== null) out.renderAvgUs = renderAvgUs;
  if (renderMaxUs !== null) out.renderMaxUs = renderMaxUs;
  if (evalAvgUs !== null) out.evalAvgUs = evalAvgUs;
  return Object.keys(out).length ? out : null;
}

function formatBundleError(err) {
  const e = Array.isArray(err?.errors) && err.errors[0];
  if (e?.location) {
    const loc = e.location;
    const file = relative(ROOT, resolve(loc.file || '')) || loc.file;
    return `${e.text} (${file}:${loc.line}:${loc.column})`;
  }
  return err?.message || String(err);
}

function tail(text, n = 20) {
  return (text || '').split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
}

async function defaultRunVisual(appDir, outDir) {
  const { createRequire } = await import('node:module');
  const { createServer } = await import('node:net');
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
  catch (e) { throw new Error(`Playwright unavailable; set PLAYWRIGHT_MODULE to its installed path (${e.message})`); }
  const port = await new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => res(p)); });
  });
  const entry = join(resolve(appDir), 'app.js');
  const appSource = await readFile(entry, 'utf8');
  const themeColor = /lume\.theme\.set\s*\(/.test(appSource)
    ? (appSource.match(/\bbg\s*:\s*['"](#[0-9a-fA-F]{6})['"]/) || [])[1]?.toUpperCase() ?? null
    : null;
  const url = `http://localhost:${port}/`;
  const visualDir = join(outDir, 'visual');
  await mkdir(visualDir, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'tools/simulator/sim.js'), entry], {
    cwd: ROOT, env: { ...process.env, LUME_SIM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  let browser;
  try {
    const started = Date.now();
    while (!output.includes('Host Simulator http://')) {
      if (child.exitCode !== null) throw new Error(`simulator exited: ${output}`);
      if (Date.now() - started > 10000) throw new Error(`simulator startup timeout: ${output}`);
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 600, height: 640 }, deviceScaleFactor: 1 });
    await page.goto(url);
    const frames = [];
    const begun = Date.now();
    for (const [index, seconds] of [1, 3, 6].entries()) {
      const wait = begun + seconds * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const file = `frame-${String(index + 1).padStart(2, '0')}.png`;
      const png = await page.locator('#device').screenshot({ path: join(visualDir, file) });
      const response = await page.request.get(`${url}messages`);
      const data = await response.json();
      const calls = data.messages.filter(m => m[0] === 'draw').length;
      const renderCalls = data.messages.filter(m => ['create', 'attr', 'draw'].includes(m[0])).length;
      const metrics = await page.evaluate(async base64 => {
        const canvases = [...document.querySelectorAll('#device canvas')];
        let pixels;
        if (canvases.length) {
          pixels = canvases.flatMap(c => [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data]);
        } else {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
          const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
          pixels = [...ctx.getImageData(0, 0, c.width, c.height).data];
        }
        const hist = new Map(); let nonEmpty = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b, a] = pixels.slice(i, i + 4);
          if (a === 0 || (r === 0 && g === 0 && b === 0)) continue;
          nonEmpty++;
          const color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
          hist.set(color, (hist.get(color) || 0) + 1);
        }
        return { hasCanvas: canvases.length > 0, nonEmptyRatio: pixels.length ? nonEmpty / (pixels.length / 4) : 0,
          top5: [...hist].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([color, pixels]) => ({ color, pixels })) };
      }, png.toString('base64'));
      const assertions = {
        nonEmpty: metrics.nonEmptyRatio > 0,
        drawCalls: metrics.hasCanvas ? calls > 0 : renderCalls > 0,
        drawBudget: (metrics.hasCanvas ? calls : renderCalls) < 250,
        simulator: !data.error,
        ...(themeColor && !metrics.hasCanvas ? { themeColor: metrics.top5.some(x => x.color === themeColor) } : {}),
      };
      frames.push({ file, url, timestamp: new Date().toISOString(), elapsedMs: Date.now() - begun,
        canvasDrawCalls: calls, renderCalls, nonEmptyRatio: metrics.nonEmptyRatio,
        top5: metrics.top5, themeColor, assertions, error: data.error || null });
    }
    const visual = { app: relative(ROOT, resolve(appDir)), frames,
      ok: frames.every(f => Object.values(f.assertions).every(Boolean)) };
    await writeFile(join(visualDir, 'visual.json'), JSON.stringify(visual, null, 2) + '\n');
    const file = relative(ROOT, join(visualDir, 'visual.json'));
    return { ok: visual.ok, frames: frames.length, file,
      ...(!visual.ok ? { error: `visual assertions failed; see ${file}` } : {}) };
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
  }
}

/* ------------------------------------------------------------------ */
/* One-shot verification pipeline                                     */
/* ------------------------------------------------------------------ */

export async function check(appDir, options = {}, deps = {}) {
  const io = {
    bundle: defaultBundle,
    appSources: defaultAppSources,
    runEmu: defaultRunEmu,
    readCatalog: () => readCatalog(DTS_PATH),
    hasLayoutSpec: name => hasLayoutSpec(name, LAYOUT_SPEC_PATH),
    runLayout,
    runVisual: defaultRunVisual,
    ...deps,
  };
  const { noEmu = false, timeout = 120, visual = false } = options;
  const skipEmu = noEmu || visual;
  const timeoutMs = Math.max(1, Number(timeout) || 120) * 1000;

  const abs = resolve(appDir);
  const rel = relative(ROOT, abs);
  const app = rel.startsWith('..') ? appDir : (rel || basename(abs));
  const appName = basename(abs);
  const outDir = join(CHECK_ROOT, appName);
  const result = { ok: false, app, steps: [], screenshot: null };
  let emu = null;

  /* 1. syntax / bundle check (fail fast) */
  const t0 = Date.now();
  let bytes;
  try { bytes = await io.bundle(appDir); }
  catch (err) {
    result.steps.push({ step: 'bundle', ok: false, error: formatBundleError(err) });
    return result;
  }
  result.steps.push({ step: 'bundle', ok: true, bytes: bytes.length, ms: Date.now() - t0 });

  /* 2. emulator render + eval verification */
  if (skipEmu) {
    result.steps.push({ step: 'eval', skipped: visual ? '--visual uses browser simulator' : '--no-emu' });
  } else {
    emu = await io.runEmu(appDir, outDir, timeoutMs);
    result.screenshot = emu.screenshot ?? null;
    const evalError = parseEvalError(emu.serialLog);
    const okCount = emu.serialLog.split(/\r?\n/).filter(l => EVAL_OK_RE.test(l)).length;
    const step = { step: 'eval', ok: false };
    if (emu.timedOut) {
      step.error = `emulator timed out after ${timeoutMs / 1000}s`;
      step.tail = tail(emu.serialLog || emu.stderr || emu.stdout);
    } else if (evalError) {
      step.error = evalError.message;
      if (evalError.line != null) step.line = evalError.line;
      if (MISSING_MEMBER_RE.test(evalError.message)) {
        try {
          const [catalog, sources] = await Promise.all([io.readCatalog(), io.appSources(appDir)]);
          const unknown = findUnknownMembers(sources, catalog);
          if (unknown.length) {
            const u = unknown[0];
            step.expression = u.expression;
            step.line = u.line;
            step.hint = suggest(u);
          }
        } catch { /* hints are best effort, never mask the real error */ }
      }
    } else if (emu.exitCode !== 0) {
      step.error = `emulator failed (exit ${emu.exitCode})`;
      step.tail = tail(emu.stderr || emu.stdout || emu.serialLog);
    } else if (okCount < 2) {
      step.error = `expected >= 2 "app eval ok" markers, found ${okCount}`;
      step.tail = tail(emu.serialLog);
    } else {
      step.ok = true;
      step.marker = 'app eval ok';
      step.evalOkCount = okCount;
    }
    result.steps.push(step);
  }

  /* 3. geometry assertions (only for apps with layout expectations) */
  if (skipEmu) {
    result.steps.push({ step: 'layout', skipped: visual ? 'requires emulator screenshot (--visual)' : 'requires emulator screenshot (--no-emu)' });
  } else if (!(await io.hasLayoutSpec(appName))) {
    result.steps.push({ step: 'layout', skipped: `no layout expectations for ${appName}` });
  } else {
    const lr = await io.runLayout(join(outDir, 'tft.png'), appName);
    if (lr.error && !lr.rules) {
      result.steps.push({ step: 'layout', ok: false, error: lr.error });
    } else {
      result.steps.push({
        step: 'layout', ok: lr.ok, rules: lr.rules ?? {},
        ...(lr.failed?.length ? { failed: lr.failed } : {}),
      });
    }
  }

  /* 4. performance summary (best effort, never blocks) */
  const perf = emu ? parsePerf(emu.serialLog) : null;
  result.steps.push(perf
    ? { step: 'perf', ok: true, ...perf }
    : { step: 'perf', skipped: 'profile disabled' });

  if (visual) {
    try {
      result.steps.push({ step: 'visual', ...await io.runVisual(appDir, outDir) });
    } catch (err) {
      result.steps.push({ step: 'visual', ok: false, error: err.message });
    }
  }

  result.ok = result.steps.every(s => ('skipped' in s) || s.ok === true);
  return result;
}

/* ------------------------------------------------------------------ */
/* Output rendering                                                   */
/* ------------------------------------------------------------------ */

function perfSummary(step) {
  const bits = [];
  if (step.fps != null) bits.push(`fps ${step.fps}`);
  if (step.renderAvgUs != null) bits.push(`render avg ${(step.renderAvgUs / 1000).toFixed(1)} ms`);
  if (step.renderMaxUs != null) bits.push(`max ${(step.renderMaxUs / 1000).toFixed(1)} ms`);
  if (step.evalAvgUs != null) bits.push(`eval avg ${(step.evalAvgUs / 1000).toFixed(1)} ms`);
  return bits.join(', ');
}

function stepSummary(step) {
  if (step.step === 'layout') {
    return ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']
      .map(r => `${r} ${step.rules?.[r] ?? '-'}`).join('  ');
  }
  if (!step.ok) return '';
  if (step.step === 'bundle') return `${step.bytes} bytes (${step.ms} ms)`;
  if (step.step === 'eval') return `${step.evalOkCount}x "app eval ok; entering event loop"`;
  if (step.step === 'perf') return perfSummary(step);
  if (step.step === 'visual') return `${step.frames} frames: ${step.file}`;
  return 'ok';
}

function indent(text) {
  return text.split('\n').map(l => '       ' + l).join('\n');
}

export function render(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2) + '\n';
  const lines = [`lume check ${result.app}`, ''];
  for (const step of result.steps) {
    const label = (step.step || '').padEnd(8);
    if ('skipped' in step) {
      lines.push(`[SKIP] ${label} ${step.skipped}`);
      continue;
    }
    lines.push(`[${step.ok ? 'PASS' : 'FAIL'}] ${label} ${stepSummary(step)}`.trimEnd());
    if (!step.ok) {
      if (step.error) lines.push(`       error: ${step.error}`);
      if (step.expression) lines.push(`       expression: ${step.expression}${step.line != null ? ` (line ${step.line})` : ''}`);
      else if (step.line != null) lines.push(`       line: ${step.line}`);
      if (step.hint) lines.push(`       hint: ${step.hint}`);
      if (step.failed?.length) lines.push(`       failed rules: ${step.failed.join(', ')}`);
      if (step.tail) lines.push(`       --- log tail ---\n${indent(step.tail)}`);
    }
  }
  lines.push('');
  if (result.screenshot) lines.push(`screenshot: ${result.screenshot}`);
  const failed = result.steps.filter(s => !('skipped' in s) && s.ok !== true).length;
  lines.push(`RESULT: ${result.ok ? 'PASS' : 'FAIL'} (${result.steps.length} steps, ${failed} failed; exit ${result.ok ? 0 : 1})`);
  return lines.join('\n') + '\n';
}
