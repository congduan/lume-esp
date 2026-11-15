import { readFile, readdir, mkdir } from 'node:fs/promises';
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
    ...deps,
  };
  const { noEmu = false, timeout = 120 } = options;
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
  if (noEmu) {
    result.steps.push({ step: 'eval', skipped: '--no-emu' });
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
  if (noEmu) {
    result.steps.push({ step: 'layout', skipped: 'requires emulator screenshot (--no-emu)' });
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
