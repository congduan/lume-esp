#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { CONTROL, storeCommand, storeCommandBuffer, simpleCommand, fputCommand } from './protocol.js';
import { queryFirmwareTag } from './fwtag.js';
import { openPort } from './transport.js';
import { openOta, OTA_PORT_DEFAULT } from './ota.js';
import { bmpFromRgb565 } from './shot.js';
import { check, render } from './check.js';
import { scan, scanDevice, renderScan } from './scan.js';
import { context, renderContext } from './context.js';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const usage = `lume ${pkg.version}\nUsage:\n  lume create <name>\n  lume dev <dir> [--port <path>] [--id <app-id>] [--ephemeral] [--source]\n  lume deploy <dir> [--port <path>] [--id <app-id>] [--ephemeral] [--source]\n  lume deploy <dir> --host <ip> --token <t> [--ota-port <n>] [--id <app-id>] [--source]\n  lume apps list|launch <id>|remove <id>|home [--port <path>]\n  lume fput <local> <sd:/path|fs:/path> [--port <path>]\n  lume fls <sd:/dir|fs:/dir> [--port <path>]\n  lume fdel <sd:/path|fs:/path> [--port <path>]\n  lume repl [--port <path>] [--eval "expr"] [--host <ip> --token <t>]\n  lume screenshot [file.bmp] [--port <path>] | --ota <ip> --token <t>\n  lume screenshot --scan <N> <app-dir> [--json]\n  lume screenshot --scan <N> (--port <path> | --host <ip> --token <t>) [app-dir|spec] [--json]\n  lume check <app-dir> [--json] [--no-emu] [--visual] [--timeout <s>]\n  lume context [--json] [--skip-check] [--strict]
  lume examples [name] [--json]\n  lume mcp   (MCP stdio server for MCP clients; see docs/r206-report.md)
  lume token <32hex> [--port <path>]
  lume --help | --version\n\nNode >=18. dev: p=pause, r=resume, b=back, Ctrl+C=exit.\n  check bundles the app, boots it under the esp32s3 emulator, verifies eval,\n  runs layout assertions (R1-R7) and prints a perf summary in one shot.\n  --json emits machine-readable output; exit 0 = all pass, 1 = any fail.\n  --visual captures browser frames at 1/3/6s and checks pixels/draws; it\n  skips the firmware emulator and needs Playwright.\n  --no-emu skips the emulator (fast bundle-only check); --timeout sets the\n  emulator step limit in seconds (default 120).
  context prints a machine-readable repo snapshot (version, repo, head,
  branch, manifest, examples, unregistered, harnesses, api, check, env).
  --json emits one compact line; --skip-check skips the sentinel check;
  --strict exits 1 when any snapshot block failed.\n  deploy/dev install the app on the device (LittleFS) and start it; the device\n  keeps exactly one app running. --ephemeral pushes without installing.\n  --host pushes over WiFi TCP (default port ${OTA_PORT_DEFAULT}); the board\n  must be connected to WiFi and its token is printed in the serial log.\n  --ota is a legacy alias for --host.\n  deploy/dev compile with vendored qjsc by default; the first run builds\n  qjsc locally. --source sends JS for older firmware.\n  screenshot captures the running app's frame over the same channel and\n  writes a 24-bit BMP (default: screenshot.bmp in the current directory).\n  screenshot --scan N boots the app under esp32sim at N successive instants\n  (no board needed) and checks every frame for the expected layer set and\n  out-of-bounds changed pixels; exit 0 = all frames pass, 1 = any fail.\n  repl evaluates one JS expression per line on the device's CURRENT app ctx\n  (so app globals/signals are visible). --eval sends one expression and exits;\n  without it, type expressions interactively (Ctrl+C or "exit" to quit).\n  Output is bounded to 2048 bytes per result; longer replies are truncated.\n`;

const APP_COMMANDS = new Set(['list', 'launch', 'remove', 'home']);

function parse(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || !command) return { command: 'help' };
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (!['create', 'dev', 'deploy', 'apps', 'screenshot', 'check', 'context', 'examples', 'mcp', 'token', 'repl', 'fput', 'fls', 'fdel'].includes(command)) throw new Error(`unknown command: ${command}\n${usage}`);
  let dir, port, ota, token, otaPort, id, sub, subArg, tokenHex, evalExpr = null, ephemeral = false, bytecode = true, devicePath;
  let json = false, noEmu = false, visual = false, timeout = 120, scanN = null, skipCheck = false, strict = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--port' && command !== 'create' && rest[i + 1]) port = rest[++i];
    else if ((a === '--ota' || a === '--host') && (command === 'deploy' || command === 'screenshot' || command === 'repl') && rest[i + 1]) ota = rest[++i];
    else if (a === '--token' && (command === 'deploy' || command === 'screenshot' || command === 'repl') && rest[i + 1]) token = rest[++i];
    else if (a === '--ota-port' && (command === 'deploy' || command === 'screenshot' || command === 'repl') && rest[i + 1]) otaPort = rest[++i];
    else if (a === '--eval' && command === 'repl' && rest[i + 1]) evalExpr = rest[++i];
    else if (a === '--id' && (command === 'dev' || command === 'deploy') && rest[i + 1]) id = rest[++i];
    else if (a === '--ephemeral' && (command === 'dev' || command === 'deploy')) ephemeral = true;
    else if (a === '--bytecode' && (command === 'deploy' || command === 'dev')) bytecode = true;
    else if (a === '--source' && (command === 'deploy' || command === 'dev')) bytecode = false;
    else if (a === '--json' && (command === 'check' || command === 'screenshot' || command === 'context' || command === 'examples')) json = true;
    else if (a === '--skip-check' && command === 'context') skipCheck = true;
    else if (a === '--strict' && command === 'context') strict = true;
    else if (a === '--scan' && command === 'screenshot' && rest[i + 1]) scanN = rest[++i];
    else if (a === '--no-emu' && command === 'check') noEmu = true;
    else if (a === '--visual' && command === 'check') visual = true;
    else if (a === '--timeout' && command === 'check' && rest[i + 1]) timeout = rest[++i];
    else if (!a.startsWith('-') && command === 'apps' && !sub) sub = a;
    else if (!a.startsWith('-') && command === 'apps' && !subArg) subArg = a;
    else if (!a.startsWith('-') && command === 'token' && !tokenHex) tokenHex = a;
    else if (!a.startsWith('-') && command === 'fput' && dir && !devicePath) devicePath = a;
    else if (!a.startsWith('-') && !dir) dir = a;
    else throw new Error(`unexpected argument: ${a}\n${usage}`);
  }
  if (!dir && command === 'create') throw new Error(`create needs a name\n${usage}`);
  if (['fput', 'fls', 'fdel'].includes(command)) {
    if (!dir || dir === '.' || (command === 'fput' && !devicePath))
      throw new Error(`${command} needs a path${command === 'fput' ? ' and device path' : ''}\n${usage}`);
    if (command !== 'fput') devicePath = dir;
    if (!/^(sd|fs):\/?[^\t\r\n]*$/.test(devicePath) ||
        devicePath.split('/').some(s => s === '.' || s === '..') ||
        (command !== 'fls' && /:\/?$/.test(devicePath)))
      throw new Error(`invalid device path: ${devicePath}`);
  }
  if (command === 'token' && !/^[0-9a-fA-F]{32}$/.test(tokenHex || '')) {
    throw new Error(`token needs 32 hex characters\n${usage}`);
  }
  if (ota && !token) throw new Error(`--host needs --token <t>\n${usage}`);
  if (token && !ota) throw new Error(`--token requires --host <ip>\n${usage}`);
  if (otaPort && !ota) throw new Error(`--ota-port requires --host <ip>\n${usage}`);
  if (ota && port) throw new Error(`--host and --port (serial path) are mutually exclusive\n${usage}`);
  if (command === 'check') {
    if (!dir) throw new Error(`check needs an app directory\n${usage}`);
    const seconds = Number(timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`--timeout must be a positive number of seconds (got ${timeout})`);
    }
    timeout = seconds;
  }
  if (scanN !== null) {
    const n = Number(scanN);
    if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error(`--scan must be an integer 1..64 (got ${scanN})\n${usage}`);
    scanN = n;
    if (!port && !ota && (!dir || dir === '.')) throw new Error(`screenshot --scan needs an app directory (or pass --port / --host for device scan)\n${usage}`);
  }
  if (otaPort !== undefined) {
    const n = Number(otaPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`--ota-port must be 1..65535 (got ${otaPort})`);
    }
    otaPort = n;
  }
  if (id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(id)) {
    throw new Error(`--id must be 1..31 chars of [A-Za-z0-9._-] and not start with '.' (got ${id})`);
  }
  if (command === 'apps') {
    if (!sub) sub = 'list';
    if (!APP_COMMANDS.has(sub)) throw new Error(`unknown apps command: ${sub}\n${usage}`);
    if ((sub === 'launch' || sub === 'remove') && !subArg) {
      throw new Error(`lume apps ${sub} needs an app id\n${usage}`);
    }
    if ((sub === 'list' || sub === 'home') && subArg) {
      throw new Error(`lume apps ${sub} takes no argument (got ${subArg})\n${usage}`);
    }
    if (subArg !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(subArg)) {
      throw new Error(`invalid app id: ${subArg}`);
    }
  }
  return { command, dir: dir ?? '.', devicePath, port, ota, token, otaPort, id, sub, subArg, tokenHex, evalExpr, ephemeral, bytecode, json, noEmu, visual, timeout, scanN, skipCheck, strict };
}

async function runFileCommand(options) {
  const device = await openPort(options.port);
  try {
    const path = options.devicePath;
    if (options.command === 'fls') {
      const r = await device.command(`FLS\t${path}`);
      const parts = r.lines.filter(s => s.startsWith('FLS\t'));
      if (r.verb !== 'fls' || !parts.length) throw new Error('incomplete FLS reply');
      const entries = JSON.parse(parts.map(s => s.slice(4)).join(''));
      process.stdout.write(JSON.stringify(entries) + '\n');
    } else if (options.command === 'fdel') {
      const r = await device.command(`FDEL\t${path}`);
      if (r.verb !== 'fdel') throw new Error('unexpected FDEL reply');
      process.stdout.write(`Deleted ${path}\n`);
    } else {
      const bytes = await readFile(resolve(options.dir));
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('file must be 1..8388608 bytes');
      for (let offset = 0; offset < bytes.length; offset += 2048) {
        const chunk = bytes.subarray(offset, offset + 2048);
        const r = await device.command(fputCommand(path, offset, bytes.length, chunk));
        if (r.verb !== 'fput' || Number(r.arg) !== offset + chunk.length)
          throw new Error(`FPUT ACK size mismatch at ${offset}`);
      }
      const returned = [];
      for (let offset = 0; offset < bytes.length; offset += 768) {
        const n = Math.min(768, bytes.length - offset);
        const r = await device.command(`FGET\t${path}\t${offset}\t${n}`);
        const line = r.lines.find(s => s.startsWith('F64'));
        if (r.verb !== 'fget' || !line) throw new Error(`incomplete FGET at ${offset}`);
        const chunk = Buffer.from(line.slice(3), 'base64');
        if (chunk.length !== n || Number(r.arg) !== n) throw new Error(`FGET size mismatch at ${offset}`);
        returned.push(chunk);
      }
      const hash = x => createHash('sha256').update(x).digest('hex');
      if (hash(bytes) !== hash(Buffer.concat(returned))) throw new Error('FPUT readback SHA-256 mismatch');
      process.stdout.write(`Wrote ${bytes.length} bytes to ${path}; SHA-256 ${hash(bytes)} verified\n`);
    }
  } finally { await device.close(); }

}

/* Directory name -> stable app id (same rules as lume_app_id.h). */
function defaultId(dir) {
  const base = basename(resolve(dir)).toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  const id = base.slice(0, 31);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`cannot derive an app id from "${basename(resolve(dir))}"; pass --id <app-id>`);
  }
  return id;
}

/* package.json `lume` block -> meta.json text (label/icon/color only). */
async function appMeta(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(resolve(dir), 'package.json'), 'utf8'));
    const src = manifest.lume ?? {};
    const meta = {};
    for (const key of ['label', 'icon', 'color']) {
      if (typeof src[key] === 'string' && src[key]) meta[key] = src[key];
    }
    return meta;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`invalid package.json in ${resolve(dir)}: ${err.message}`);
  }
}

async function openDevice({ ota, token, otaPort, port }) {
  return ota ? openOta(ota, token, otaPort ?? OTA_PORT_DEFAULT) : openPort(port);
}

/* Install (STORE) then start (LAUNCH). Both steps are separate commands so the
 * device can report "stored" before it pays for the runtime switch. */
async function install(device, dir, id, source) {
  const meta = await appMeta(dir);
  /* r106: stamp the deploy manifest with the device's current API tag. If the
   * query fails, WARN and install WITHOUT a fw field rather than fabricate a
   * value: the device then treats the app as "unknown compatibility" (launch
   * allowed with a WARN), which is honest and non-bricking. */
  try {
    meta.fw = await queryFirmwareTag(device);
  } catch (err) {
    process.stderr.write(`lume: WARN ${err.message}; installing without an fw tag\n`);
  }
  /* Bytecode payloads are binary: never UTF-8-decode/re-encode them. The
   * firmware stores the raw bytes and the engine auto-detects the LQBC header
   * at eval time, so STORE/LAUNCH works for both source and bytecode. */
  const command = Buffer.isBuffer(source)
    ? storeCommandBuffer(id, meta, source)
    : storeCommand(id, meta, source.toString('utf8'));
  const stored = await device.command(command);
  await device.commandReload(simpleCommand('LAUNCH', id));
  return stored;
}

function displayApps(lines, deviceTag = null) {
  const apps = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('APP\t')) {
      current = { id: line.split('\t')[1] ?? '', meta: {} };
      apps.push(current);
    } else if (line.startsWith('META\t') && current) {
      const parts = line.split('\t');
      if (parts[1] === current.id && parts[2]) {
        try { current.meta = JSON.parse(parts[2]); } catch { current.meta = {}; }
      }
    }
  }
  if (!apps.length) {
    process.stdout.write('no apps installed\n');
    return apps;
  }
  const width = Math.max(...apps.map(a => a.id.length));
  for (const app of apps) {
    const label = typeof app.meta.label === 'string' ? app.meta.label : '';
    const fw = app.meta.fw;
    let tag = 'fw=?';
    if (typeof fw === 'number' || (typeof fw === 'string' && /^\d+$/.test(fw))) {
      tag = `fw=${fw}`;
      if (deviceTag !== null && Number(fw) !== deviceTag) tag += ' MISMATCH';
    }
    process.stdout.write(`${app.id.padEnd(width)}  ${label}  ${tag}\n`);
  }
  return apps;
}

async function runApps(sub, subArg, options) {
  const device = await openDevice(options);
  try {
    if (sub === 'list') {
      const reply = await device.command(simpleCommand('LIST'));
      let tag = null;
      try { tag = await queryFirmwareTag(device); }
      catch (err) { process.stderr.write(`lume: WARN ${err.message}; mismatch status unavailable\n`); }
      displayApps(reply.lines, tag);
    } else if (sub === 'launch') {
      await device.commandReload(simpleCommand('LAUNCH', subArg));
      process.stdout.write(`Launched ${subArg}\n`);
    } else if (sub === 'home') {
      await device.commandReload(simpleCommand('HOME'));
      process.stdout.write('Returned to home\n');
    } else {
      await device.command(simpleCommand('REMOVE', subArg));
      process.stdout.write(`Removed ${subArg}\n`);
    }
  } finally { await device.close(); }
}

/* r96: set the WiFi-OTA HMAC token over the serial LUMC channel (the token is
 * never echoed by the device reply). This is the first-boot serial-CLI path. */
async function runToken(tokenHex, options) {
  const device = await openDevice(options);
  try {
    const reply = await device.command(simpleCommand('TOKEN', tokenHex));
    if (reply.verb !== 'token') throw new Error(`unexpected token reply: ${reply.verb}`);
    process.stdout.write('OTA token updated\n');
  } finally { await device.close(); }
}

/* r115: device REPL. --eval mode sends one expression, prints its result and
 * exits (scriptable). Interactive mode reads stdin line by line. Evaluations
 * are serialized so a fast typist can never trip the transport's one-pending
 * request guard. */
function printReplResult(r) {
  if (!r.ok) process.stderr.write(`error: ${r.text}\n`);
  else process.stdout.write(r.text + '\n');
  if (r.truncated) process.stderr.write('[output truncated]\n');
}

async function runRepl(evalExpr, options) {
  const device = await openDevice(options);
  try {
    if (evalExpr !== null) {
      const r = await device.repl(evalExpr);
      printReplResult(r);
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
    process.stdout.write('Lume REPL (Ctrl+C or exit to quit)\n');
    let chain = Promise.resolve();
    const handle = line => {
      const expr = line.trim();
      if (expr === 'exit' || expr === '.exit' || expr === 'quit') { rl.close(); return; }
      if (!expr) return;
      chain = chain.then(async () => {
        try { printReplResult(await device.repl(expr)); }
        catch (err) { process.stderr.write(`lume: ${err.message}\n`); }
      });
    };
    rl.on('line', handle);
    rl.on('SIGINT', () => rl.close());
    await new Promise(resolve => rl.on('close', resolve));
    await chain;
  } finally { await device.close(); }
}

/* SHOT -> RGB565 frame -> 24-bit BMP on disk. The device captures the frame
 * the panel is currently showing; if the display is asleep the capture only
 * completes after wake (the CLI errors out on the device's shot-timeout). */
async function runScreenshot(outPath, options) {
  const device = await openDevice(options);
  try {
    const shot = await device.screenshot();
    await writeFile(outPath, bmpFromRgb565(shot.data, shot.width, shot.height));
    process.stdout.write(`Screenshot ${shot.width}x${shot.height} -> ${outPath}\n`);
  } finally { await device.close(); }
}

async function prepareBytecode(device, source) {
  const bc = await import('./bytecode.js');
  const local = await bc.qjsVersion();
  const deviceVersion = await bc.queryEngineVersion(device);
  bc.assertEngineVersion(deviceVersion, local.version);
  return bc.buildBytecodePayload(source);
}

async function runDev(dir, portPath, id, ephemeral, bytecode) {
  const root = resolve(dir);
  let first = await bundle(root, { minify: false });
  const appId = id ?? defaultId(root);
  const serial = await openPort(portPath, { monitor: true });
  try { if (bytecode) first = await prepareBytecode(serial, first); }
  catch (err) { await serial.close(); throw err; }
  process.stdout.write(`Connected to ${serial.path}\n`);
  if (ephemeral) {
    if (bytecode) await serial.pushBytecode(first);
    else await serial.push(first);
    process.stdout.write(`Reload OK (${first.length} bytes). Watching ${root}\n`);
  } else {
    await install(serial, root, appId, first);
    process.stdout.write(`Installed and launched "${appId}" (${first.length} bytes). Watching ${root}\n`);
  }
  let busy = false, dirty = false;
  async function rebuild() {
    if (busy) { dirty = true; return; }
    busy = true;
    do {
      dirty = false;
      try {
        let source = await bundle(root, { minify: false });
        if (bytecode) source = await (await import('./bytecode.js')).buildBytecodePayload(source);
        // Hot updates stay in memory: the installed copy is only replaced by
        // an explicit deploy, so a crashed dev session cannot brick the app.
        if (bytecode) await serial.pushBytecode(source);
        else await serial.push(source);
        process.stdout.write(`Reload OK (${source.length} bytes)\n`);
      } catch (err) { process.stderr.write(`lume: ${err.message}\n`); }
    } while (dirty);
    busy = false;
  }
  // Polling works on Node 18/Linux, where recursive fs.watch is unavailable.
  async function snapshot(path, out = new Map()) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await snapshot(child, out);
      else if (entry.isFile()) {
        const info = await stat(child);
        out.set(child, `${info.mtimeMs}:${info.size}`);
      }
    }
    return out;
  }
  let previous = await snapshot(root);
  let scanning = false;
  const watcher = setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try {
      const current = await snapshot(root);
      if (current.size !== previous.size || [...current].some(([path, value]) => previous.get(path) !== value)) rebuild();
      previous = current;
    } catch (err) { process.stderr.write(`lume: watch failed: ${err.message}\n`); }
    finally { scanning = false; }
  }, 500);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', async bytes => {
      const key = bytes.toString('utf8');
      if (key === '\u0003') { clearInterval(watcher); await serial.close(); process.exit(); }
      const control = { p: CONTROL.pause, r: CONTROL.resume, b: CONTROL.back }[key];
      if (control) {
        try { await serial.write(control); process.stdout.write(`Sent ${control.toString()}\n`); }
        catch (err) { process.stderr.write(`lume: ${err.message}\n`); }
      }
    });
  }
  process.on('SIGINT', async () => { clearInterval(watcher); await serial.close(); process.exit(); });
}

try {
  const opts = parse(process.argv.slice(2));
  const { command, dir, port, ota, token, otaPort, id, sub, subArg, tokenHex, evalExpr, ephemeral, bytecode, json, noEmu, visual, timeout, scanN, skipCheck, strict } = opts;
  if (command === 'help') process.stdout.write(usage);
  else if (command === 'version') process.stdout.write(pkg.version + '\n');
  else if (command === 'create') process.stdout.write(`Created ${await create(dir)}\n`);
  else if (command === 'dev') await runDev(dir, port, id, ephemeral, bytecode);
  else if (command === 'apps') await runApps(sub, subArg, { port, ota, token, otaPort });
  else if (command === 'token') await runToken(tokenHex, { port });
  else if (['fput', 'fls', 'fdel'].includes(command)) await runFileCommand(opts);
  else if (command === 'repl') await runRepl(evalExpr, { port, ota, token, otaPort });
  else if (command === 'screenshot' && scanN !== null && (port || ota)) {
    const device = await openDevice({ port, ota, token, otaPort });
    try {
      const result = await scanDevice(device, {
        scan: scanN,
        specName: dir && dir !== '.' ? dir : null,
      });
      process.stdout.write(renderScan(result, { json }));
      process.exitCode = result.ok ? 0 : 1;
    } finally { await device.close(); }
  }
  else if (command === 'screenshot' && scanN !== null) {
    const result = await scan(dir, { scan: scanN });
    process.stdout.write(renderScan(result, { json }));
    process.exitCode = result.ok ? 0 : 1;
  }
  else if (command === 'screenshot') await runScreenshot(dir && dir !== '.' ? dir : 'screenshot.bmp', { port, ota, token, otaPort });
  else if (command === 'check') {
    const result = await check(dir, { noEmu, timeout, visual });
    process.stdout.write(render(result, { json }));
    process.exitCode = result.ok ? 0 : 1;
  }
  else if (command === 'context') {
    const snapshot = await context({ skipCheck });
    process.stdout.write(renderContext(snapshot.data, { json }));
    process.exitCode = strict && snapshot.failed ? 1 : 0;
  }
  else if (command === 'mcp') {
    const { run: runMcp } = await import('./mcp.js');
    process.exitCode = await runMcp();
  }
  else if (command === 'examples') {
    const { catalog, renderCatalog } = await import('./examples.js');
    const data = await catalog();
    if (dir && dir !== '.') {
      const row = data.rows.find(r => r.name === dir);
      if (!row) {
        process.stderr.write(`lume: unknown example: ${dir}\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write(renderCatalog({ rows: [row], summary: data.summary }, { json }));
      }
    } else {
      process.stdout.write(renderCatalog(data, { json }));
    }
  } else {
    let source = await bundle(dir);
    const appId = id ?? defaultId(dir);
    const device = await openDevice({ port, ota, token, otaPort });
    try {
      if (bytecode) source = await prepareBytecode(device, source);
      const kind = bytecode ? ' (bytecode)' : '';
      if (ephemeral) {
        if (bytecode) await device.pushBytecode(source);
        else await device.push(source);
        process.stdout.write(`Pushed ${source.length} bytes${kind} to ${device.path ?? device.address} (not installed)\n`);
      } else {
        await install(device, dir, appId, source);
        process.stdout.write(`Installed ${source.length} bytes${kind} as "${appId}" on ${device.path ?? device.address} and launched it\n`);
      }
    } finally { await device.close(); }
  }
} catch (err) { process.stderr.write(`lume: ${err.message}\n`); process.exitCode = 1; }
