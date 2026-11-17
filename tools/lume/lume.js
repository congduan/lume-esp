#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { CONTROL, storeCommand, storeCommandBuffer, simpleCommand } from './protocol.js';
import { openPort } from './transport.js';
import { openOta, OTA_PORT_DEFAULT } from './ota.js';
import { bmpFromRgb565 } from './shot.js';
import { check, render } from './check.js';
import { scan, renderScan } from './scan.js';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const usage = `lume ${pkg.version}\nUsage:\n  lume create <name>\n  lume dev <dir> [--port <path>] [--id <app-id>] [--ephemeral] [--source]\n  lume deploy <dir> [--port <path>] [--id <app-id>] [--ephemeral] [--source]\n  lume deploy <dir> --ota <ip> --token <t> [--ota-port <n>] [--id <app-id>] [--source]\n  lume apps list|launch <id>|remove <id>|home [--port <path>]\n  lume screenshot [file.bmp] [--port <path>] | --ota <ip> --token <t>\n  lume screenshot --scan <N> <app-dir> [--json]\n  lume check <app-dir> [--json] [--no-emu] [--timeout <s>]\n  lume --help | --version\n\nNode >=18. dev: p=pause, r=resume, b=back, Ctrl+C=exit.\n  check bundles the app, boots it under the esp32s3 emulator, verifies eval,\n  runs layout assertions (R1-R7) and prints a perf summary in one shot.\n  --json emits machine-readable output; exit 0 = all pass, 1 = any fail.\n  --no-emu skips the emulator (fast bundle-only check); --timeout sets the\n  emulator step limit in seconds (default 120).\n  deploy/dev install the app on the device (LittleFS) and start it; the device\n  keeps exactly one app running. --ephemeral pushes without installing.\n  --ota pushes over WiFi TCP (default port ${OTA_PORT_DEFAULT}); the board\n  must be connected to WiFi and its token is printed in the serial log.\n  deploy/dev compile with vendored qjsc by default; the first run builds\n  qjsc locally. --source sends JS for older firmware.\n  screenshot captures the running app's frame over the same channel and\n  writes a 24-bit BMP (default: screenshot.bmp in the current directory).\n  screenshot --scan N boots the app under esp32sim at N successive instants\n  (no board needed) and checks every frame for the expected layer set and\n  out-of-bounds changed pixels; exit 0 = all frames pass, 1 = any fail.\n`;

const APP_COMMANDS = new Set(['list', 'launch', 'remove', 'home']);

function parse(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || !command) return { command: 'help' };
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (!['create', 'dev', 'deploy', 'apps', 'screenshot', 'check'].includes(command)) throw new Error(`unknown command: ${command}\n${usage}`);
  let dir, port, ota, token, otaPort, id, sub, subArg, ephemeral = false, bytecode = true;
  let json = false, noEmu = false, timeout = 120, scanN = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--port' && command !== 'create' && rest[i + 1]) port = rest[++i];
    else if (a === '--ota' && (command === 'deploy' || command === 'screenshot') && rest[i + 1]) ota = rest[++i];
    else if (a === '--token' && (command === 'deploy' || command === 'screenshot') && rest[i + 1]) token = rest[++i];
    else if (a === '--ota-port' && (command === 'deploy' || command === 'screenshot') && rest[i + 1]) otaPort = rest[++i];
    else if (a === '--id' && (command === 'dev' || command === 'deploy') && rest[i + 1]) id = rest[++i];
    else if (a === '--ephemeral' && (command === 'dev' || command === 'deploy')) ephemeral = true;
    else if (a === '--bytecode' && (command === 'deploy' || command === 'dev')) bytecode = true;
    else if (a === '--source' && (command === 'deploy' || command === 'dev')) bytecode = false;
    else if (a === '--json' && (command === 'check' || command === 'screenshot')) json = true;
    else if (a === '--scan' && command === 'screenshot' && rest[i + 1]) scanN = rest[++i];
    else if (a === '--no-emu' && command === 'check') noEmu = true;
    else if (a === '--timeout' && command === 'check' && rest[i + 1]) timeout = rest[++i];
    else if (!a.startsWith('-') && command === 'apps' && !sub) sub = a;
    else if (!a.startsWith('-') && command === 'apps' && !subArg) subArg = a;
    else if (!a.startsWith('-') && !dir) dir = a;
    else throw new Error(`unexpected argument: ${a}\n${usage}`);
  }
  if (!dir && command === 'create') throw new Error(`create needs a name\n${usage}`);
  if (ota && !token) throw new Error(`--ota needs --token <t>\n${usage}`);
  if (token && !ota) throw new Error(`--token requires --ota <ip>\n${usage}`);
  if (otaPort && !ota) throw new Error(`--ota-port requires --ota <ip>\n${usage}`);
  if (ota && port) throw new Error(`--ota and --port (serial path) are mutually exclusive\n${usage}`);
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
    if (!dir || dir === '.') throw new Error(`screenshot --scan needs an app directory\n${usage}`);
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
  return { command, dir: dir ?? '.', port, ota, token, otaPort, id, sub, subArg, ephemeral, bytecode, json, noEmu, timeout, scanN };
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

function displayApps(lines) {
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
    process.stdout.write(`${app.id.padEnd(width)}  ${label}\n`);
  }
  return apps;
}

async function runApps(sub, subArg, options) {
  const device = await openDevice(options);
  try {
    if (sub === 'list') {
      const reply = await device.command(simpleCommand('LIST'));
      displayApps(reply.lines);
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
  const { command, dir, port, ota, token, otaPort, id, sub, subArg, ephemeral, bytecode, json, noEmu, timeout, scanN } = opts;
  if (command === 'help') process.stdout.write(usage);
  else if (command === 'version') process.stdout.write(pkg.version + '\n');
  else if (command === 'create') process.stdout.write(`Created ${await create(dir)}\n`);
  else if (command === 'dev') await runDev(dir, port, id, ephemeral, bytecode);
  else if (command === 'apps') await runApps(sub, subArg, { port, ota, token, otaPort });
  else if (command === 'screenshot' && scanN !== null) {
    const result = await scan(dir, { scan: scanN });
    process.stdout.write(renderScan(result, { json }));
    process.exitCode = result.ok ? 0 : 1;
  }
  else if (command === 'screenshot') await runScreenshot(dir && dir !== '.' ? dir : 'screenshot.bmp', { port, ota, token, otaPort });
  else if (command === 'check') {
    const result = await check(dir, { noEmu, timeout });
    process.stdout.write(render(result, { json }));
    process.exitCode = result.ok ? 0 : 1;
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
