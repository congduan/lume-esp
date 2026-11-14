#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { CONTROL } from './protocol.js';
import { openPort } from './transport.js';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const usage = `lume ${pkg.version}\nUsage:\n  lume create <name>\n  lume dev <dir> [--port <path>]\n  lume deploy <dir> [--port <path>]\n  lume --help | --version\n\nNode >=18. dev: p=pause, r=resume, b=back, Ctrl+C=exit.\n`;

function parse(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || !command) return { command: 'help' };
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (!['create', 'dev', 'deploy'].includes(command)) throw new Error(`unknown command: ${command}\n${usage}`);
  let dir, port;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--port' && command !== 'create' && rest[i + 1]) port = rest[++i];
    else if (!rest[i].startsWith('-') && !dir) dir = rest[i];
    else throw new Error(`unexpected argument: ${rest[i]}\n${usage}`);
  }
  if (!dir && command === 'create') throw new Error(`create needs a name\n${usage}`);
  return { command, dir: dir ?? '.', port };
}

async function runDev(dir, portPath) {
  const root = resolve(dir);
  const first = await bundle(root, { minify: false });
  const serial = await openPort(portPath, { monitor: true });
  process.stdout.write(`Connected to ${serial.path}\n`);
  await serial.push(first);
  process.stdout.write(`Reload OK (${first.length} bytes). Watching ${root}\n`);
  let busy = false, dirty = false;
  async function rebuild() {
    if (busy) { dirty = true; return; }
    busy = true;
    do {
      dirty = false;
      try {
        const source = await bundle(root, { minify: false });
        await serial.push(source);
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
  const { command, dir, port } = parse(process.argv.slice(2));
  if (command === 'help') process.stdout.write(usage);
  else if (command === 'version') process.stdout.write(pkg.version + '\n');
  else if (command === 'create') process.stdout.write(`Created ${await create(dir)}\n`);
  else if (command === 'dev') await runDev(dir, port);
  else {
    const source = await bundle(dir);
    const serial = await openPort(port);
    try { await serial.push(source); process.stdout.write(`Deployed ${source.length} bytes to ${serial.path}\n`); }
    finally { await serial.close(); }
  }
} catch (err) { process.stderr.write(`lume: ${err.message}\n`); process.exitCode = 1; }
