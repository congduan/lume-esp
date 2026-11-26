/* r206: MCP (Model Context Protocol) stdio server for the lume CLI.
 *
 * Exposes six stable tools to any MCP client (Claude Desktop, agent hosts):
 *   lume_check    - run `lume check <appDir>` (machine-readable JSON result)
 *   lume_bundle   - bundle an app in-process, report byte size (no artifacts)
 *   lume_manifest - playground app manifest (in-process, no side effects)
 *   lume_context  - r199 machine-readable repo snapshot (skipCheck default ON)
 *   lume_help     - CLI usage text (spawned `lume.js --help`, zero duplication)
 *   lume_deploy   - install+launch on a board; WITHOUT port/host+token it
 *                   returns isError with guidance instead of hanging
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdio (MCP stdio framing).
 * Contract decisions (docs/r206-report.md):
 *   - Protocol messages ONLY on stdout; all diagnostics on stderr. Mixing
 *     stdout breaks every client, so no console.log anywhere in this file.
 *   - Zero new npm dependencies: the protocol layer is Node builtins only
 *     (readline + JSON). No @modelcontextprotocol/sdk.
 *   - Heavy CLI surfaces (check/help/deploy) spawn `node lume.js` so the
 *     exit-code contract (0 pass / 1 fail) stays the single source of truth;
 *     pure-data surfaces (bundle/manifest/context) import in-process.
 *   - Tool-level failures (check FAIL, deploy without a board, spawn errors)
 *     are MCP results with isError=true; malformed tools/call params are
 *     JSON-RPC error -32602; unknown methods are -32601. A failing check is
 *     an expected, meaningful outcome and still returns structured content.
 *   - Non-JSON stdin lines are logged to stderr and skipped (server must
 *     survive noisy clients).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.js';
import { context, renderContext } from './context.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LUME_JS = join(HERE, 'lume.js');
const ROOT = resolve(HERE, '../..');
const PKG = JSON.parse(await readFile(join(HERE, 'package.json'), 'utf8'));
const SERVER_INFO = { name: 'lume', version: PKG.version };
/* Supported MCP protocol versions; we answer with the client's version when
 * we know it, otherwise our latest (MCP version negotiation, conservative). */
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];

const TOOLS = [
  {
    name: 'lume_check',
    description: 'Verify a Lume app: bundle it, (optionally) boot it under the ' +
      'esp32s3 emulator, run layout assertions and print a machine-readable ' +
      'result. exitCode 0 = all pass. Fast path: noEmu=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'App directory, relative to the repo root (e.g. "examples/counter")' },
        noEmu: { type: 'boolean', description: 'Skip the emulator step (fast bundle-only check). Default true' },
        timeout: { type: 'number', description: 'Emulator step limit in seconds (default 120)' },
      },
      required: ['appDir'],
    },
  },
  {
    name: 'lume_bundle',
    description: 'Bundle a Lume app with esbuild exactly like `lume check` ' +
      'step 1 and report the byte size. Use it to sanity-check syntax and ' +
      'size before deploying. Nothing is written to the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'App directory, relative to the repo root' },
      },
      required: ['appDir'],
    },
  },
  {
    name: 'lume_manifest',
    description: 'List every app registered in the playground manifest and ' +
      'the on-device firmware app list. Read-only, no board needed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lume_context',
    description: 'One-shot machine-readable repo snapshot (r199): version, ' +
      'head, branch, manifest, examples, unregistered apps, harnesses, API ' +
      'catalog, env. Use this FIRST to orient before touching the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        skipCheck: { type: 'boolean', description: 'Skip the sentinel app check (fast). Default true' },
      },
    },
  },
  {
    name: 'lume_help',
    description: 'Full `lume` CLI usage text. Zero-exploration reference for ' +
      'agent authors.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lume_deploy',
    description: 'Install and launch a Lume app on a board over USB serial ' +
      '(--port) or WiFi OTA (--host + --token). WITHOUT a board it returns ' +
      'an isError result explaining how to connect one; it never hangs.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'App directory, relative to the repo root' },
        port: { type: 'string', description: 'USB serial device path (e.g. /dev/ttyACM0)' },
        host: { type: 'string', description: 'Board IP for WiFi OTA push' },
        token: { type: 'string', description: '32-hex OTA token (required with host)' },
        otaPort: { type: 'number', description: 'OTA TCP port (default 8765)' },
        id: { type: 'string', description: 'Explicit app id (default derived from the directory name)' },
        ephemeral: { type: 'boolean', description: 'Push without installing (hot-reload slot)' },
      },
      required: ['appDir'],
    },
  },
];

function log(...args) {
  process.stderr.write(['[lume-mcp]', ...args].join(' ') + '\n');
}

/* Spawn `node lume.js ...args`, capture stdout/stderr, enforce a deadline.
 * Returns { code, stdout, stderr, killed }. Never throws. */
function runCli(args, timeoutMs) {
  return new Promise(res => {
    let out = '', err = '', killed = false;
    const child = spawn(process.execPath, [LUME_JS, ...args], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); res({ code: -1, stdout: out, stderr: err + String(e), killed }); });
    child.on('close', code => { clearTimeout(timer); res({ code, stdout: out, stderr: err, killed }); });
  });
}

function textResult(text, isError = false) {
  const r = { content: [{ type: 'text', text }] };
  if (isError) r.isError = true;
  return r;
}
function jsonResult(data, isError = false) {
  return textResult(JSON.stringify(data, null, 2), isError);
}

/* --- tool handlers ---------------------------------------------------------- */

async function toolCheck(a) {
  const args = ['check', a.appDir, '--json'];
  const noEmu = a.noEmu !== false;
  if (noEmu) args.push('--no-emu');
  if (a.timeout !== undefined) {
    if (!(typeof a.timeout === 'number' && a.timeout > 0)) return jsonResult({ error: 'timeout must be a positive number of seconds' }, true);
    args.push('--timeout', String(a.timeout));
  }
  const limit = (noEmu ? 60 : (a.timeout ?? 120)) * 1000 + 60_000;
  const r = await runCli(args, limit);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-JSON stdout (usage error, crash) */ }
  if (r.killed) return jsonResult({ error: `lume check timed out after ${limit / 1000}s`, stderr: r.stderr.slice(-2000) }, true);
  if (parsed) return jsonResult({ exitCode: r.code, check: parsed }, r.code !== 0);
  return jsonResult({ exitCode: r.code, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000) }, true);
}

async function toolBundle(a) {
  try {
    const bytes = await bundle(resolve(ROOT, a.appDir));
    return jsonResult({ appDir: a.appDir, bytes: bytes.length });
  } catch (err) {
    return jsonResult({ appDir: a.appDir, error: String(err.message || err).slice(0, 4000) }, true);
  }
}

async function toolManifest() {
  /* build.mjs is import-side-effect free (build only runs as main). */
  const { manifestApps } = await import(join(HERE, '../playground/build.mjs'));
  const apps = manifestApps();
  return jsonResult({ count: apps.length, apps });
}

async function toolContext(a) {
  const skipCheck = a.skipCheck !== false;
  const snapshot = await context({ skipCheck });
  const json = JSON.parse(renderContext(snapshot.data, { json: true }));
  json.snapshotFailed = snapshot.failed;
  return jsonResult(json, snapshot.failed);
}

async function toolHelp() {
  const r = await runCli(['--help'], 30_000);
  if (r.code !== 0) return jsonResult({ error: 'lume --help failed', stderr: r.stderr.slice(-2000) }, true);
  return textResult(r.stdout);
}

async function toolDeploy(a) {
  if (!a.port && !(a.host && a.token)) {
    return jsonResult({
      error: 'no board: pass port (USB serial path) or host + token (WiFi OTA)',
      hint: 'lume deploy needs a flashed board; token is printed in the serial log. ' +
        'Host-only verification: use lume_check (noEmu=true) instead.',
    }, true);
  }
  const args = ['deploy', a.appDir];
  if (a.port) args.push('--port', String(a.port));
  if (a.host) args.push('--host', String(a.host), '--token', String(a.token));
  if (a.otaPort !== undefined) args.push('--ota-port', String(a.otaPort));
  if (a.id) args.push('--id', String(a.id));
  if (a.ephemeral) args.push('--ephemeral');
  const r = await runCli(args, 120_000);
  if (r.killed) return jsonResult({ error: 'lume deploy timed out after 120s', stderr: r.stderr.slice(-2000) }, true);
  return textResult((r.stdout + r.stderr).trim() || `deploy exited with ${r.code}`, r.code !== 0);
}

const HANDLERS = {
  lume_check: toolCheck,
  lume_bundle: toolBundle,
  lume_manifest: toolManifest,
  lume_context: toolContext,
  lume_help: toolHelp,
  lume_deploy: toolDeploy,
};

/* --- JSON-RPC 2.0 over ndjson stdio ---------------------------------------- */

function methodNotFound(id) {
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}
function invalidParams(id, message) {
  return { jsonrpc: '2.0', id, error: { code: -32602, message } };
}

async function dispatch(msg, write) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    log('dropping malformed message'); return;
  }
  const isNotification = !('id' in msg);
  const id = msg.id ?? null;

  if (msg.method === 'initialize') {
    const requested = msg.params && msg.params.protocolVersion;
    const version = PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
    write({ jsonrpc: '2.0', id, result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
    return;
  }
  if (msg.method === 'ping') { write({ jsonrpc: '2.0', id, result: {} }); return; }
  if (msg.method === 'tools/list') { write({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) { write(invalidParams(id, `unknown tool: ${name}`)); return; }
    try {
      const result = await HANDLERS[name](args);
      write({ jsonrpc: '2.0', id, result });
    } catch (err) {
      log(`tool ${name} crashed:`, err.message);
      write({ jsonrpc: '2.0', id, result: jsonResult({ error: String(err.message || err) }, true) });
    }
    return;
  }
  if (isNotification) { log(`ignoring notification ${msg.method}`); return; }
  write(methodNotFound(id));
}

export async function startMcp(input, output) {
  const write = obj => output.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); }
    catch { log('dropping non-JSON line'); return; }
    const p = dispatch(msg, write);
    if (p) pending.add(p.finally(() => pending.delete(p)));
  });
  await new Promise(res => rl.on('close', res));
  await Promise.allSettled([...pending]);
  return 0;
}

/* Entry used by `lume.js mcp`. Returns the process exit code. */
export async function run() {
  return await startMcp(process.stdin, process.stdout);
}
