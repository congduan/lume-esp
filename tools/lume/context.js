/* r199: one-shot machine-readable repo context for dispatch agents.
 * Pure tools/lume layer. Every block is isolated: a failure is recorded in
 * `errors` and the rest of the snapshot still renders. */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestApps } from '../playground/build.mjs';
import { check as defaultCheck } from './check.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DTS = join(ROOT, 'runtime/types/lume.d.ts');
const QJSC = join(ROOT, 'tools/lume/bin/qjsc');
const SIM = join(ROOT, 'tools/emu/.cache/bin/esp32sim');
const SENTINEL = 'examples/counter';
const CHECK_TIMEOUT_MS = 60_000;

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function withTimeout(fn, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`check timed out after ${ms / 1000}s`);
      err.code = 'CHECK_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

export async function context(options = {}, deps = {}) {
  const { skipCheck = false } = options;
  const runGit = deps.git ?? git;
  const checkFn = deps.check ?? defaultCheck;
  const errors = {};
  const section = async (name, fallback, fn) => {
    try { return await fn(); }
    catch (err) { errors[name] = err.message; return fallback; }
  };

  const data = {};

  data.version = await section('version', null, async () =>
    JSON.parse(await readFile(join(ROOT, 'tools/lume/package.json'), 'utf8')).version);

  data.repo = ROOT;

  data.head = await section('head', null, () =>
    runGit(['rev-parse', '--short', 'HEAD']));

  data.branch = await section('branch', null, () =>
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']));

  data.manifest = await section('manifest', [], async () => {
    const apps = deps.manifestApps ? deps.manifestApps() : manifestApps();
    if (!Array.isArray(apps) || !apps.length) throw new Error('empty playground manifest');
    return apps;
  });

  data.examples = await section('examples', [], async () => {
    const entries = await readdir(join(ROOT, 'examples'), { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  });

  data.unregistered = await section('unregistered', [], async () => {
    if (!Array.isArray(data.manifest) || !Array.isArray(data.examples))
      throw new Error('manifest or examples unavailable');
    const registered = new Set(data.manifest);
    return data.examples.filter(name => !registered.has(name));
  });

  data.harnesses = await section('harnesses', [], async () => {
    const entries = await readdir(join(ROOT, 'tests'), { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.js'))
      .map(e => e.name).sort();
  });

  data.api = await section('api', [], async () => {
    const source = await readFile(DTS, 'utf8');
    const names = [...source.matchAll(/^\s*declare namespace (lume(?:\.[A-Za-z0-9_]+)*)\s*\{/gm)]
      .map(m => m[1]);
    if (!names.length) throw new Error('no lume namespaces in runtime/types/lume.d.ts');
    return names;
  });

  data.check = await section('check', { run: true, ok: false, error: 'unavailable' }, async () => {
    if (skipCheck) return { run: false, skipReason: 'user requested' };
    try {
      const result = await withTimeout(
        () => checkFn(SENTINEL, { noEmu: true, timeout: CHECK_TIMEOUT_MS / 1000 }),
        CHECK_TIMEOUT_MS);
      return { run: true, ok: result.ok, app: result.app, steps: result.steps };
    } catch (err) {
      errors.check = err.message;
      return {
        run: true, ok: false,
        ...(err.code === 'CHECK_TIMEOUT' ? { timeout: true } : {}),
        error: err.message,
      };
    }
  });

  data.env = await section('env', {
    node: process.version, platform: process.platform, qjsc: false, esp32sim: false,
    error: 'unavailable',
  }, async () => ({
    node: process.version,
    platform: process.platform,
    qjsc: existsSync(QJSC),
    esp32sim: existsSync(SIM),
  }));

  data.errors = errors;
  return { data, failed: Object.keys(errors).length > 0 };
}

export function renderContext(data, { json = false } = {}) {
  return JSON.stringify(data, null, json ? 0 : 2) + '\n';
}
