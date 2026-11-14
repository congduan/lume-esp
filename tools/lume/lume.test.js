import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { frame, crc32, CONTROL, MAX_PAYLOAD } from './protocol.js';
import { openOta, otaAuthLine, OTA_PORT_DEFAULT } from './ota.js';

const execFileAsync = promisify(execFile);
const OTA_TOKEN = '0123456789abcdef0123456789abcdef';

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

/* ---- r26 WiFi-OTA transport (host mock device, no board needed) ---- */

// Minimal in-process OTA device speaking the firmware's lume-hotreload TCP
// protocol: read an AUTH line, then LUME frames, answer with AUTH OK/ERR and
// RELOAD OK <len>. Records the exact frame bytes for reuse assertions.
function mockOtaDevice(token) {
  const received = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let authed = false;
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!authed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = buf.subarray(0, nl).toString('utf8');
        buf = buf.subarray(nl + 1);
        authed = line === `AUTH ${token}`;
        socket.write(authed ? 'AUTH OK\n' : 'AUTH ERR\n');
        if (!authed) socket.end();
      }
      if (authed && buf.length >= 12) {
        const len = buf.readUInt32LE(4);
        if (buf.length >= 12 + len) {
          received.push(Buffer.from(buf.subarray(0, 12 + len)));
          socket.write(`RELOAD OK ${len}\n`);
          buf = buf.subarray(12 + len);
        }
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      received,
      close: () => new Promise(r => {
        for (const s of sockets) s.destroy();
        server.close(r);
      }),
    }));
  });
}

test('OTA auth preamble + default port match the firmware wire format', () => {
  assert.equal(otaAuthLine(OTA_TOKEN), `AUTH ${OTA_TOKEN}\n`);
  assert.equal(OTA_PORT_DEFAULT, 8765);
});

test('OTA push reuses the USB frame() bytes (right-token path)', async () => {
  const dev = await mockOtaDevice(OTA_TOKEN);
  try {
    const device = await openOta('127.0.0.1', OTA_TOKEN, dev.port);
    const source = 'globalThis.__lumeOta = 1;';
    await device.push(source);
    await device.close();
    assert.equal(dev.received.length, 1, 'device received exactly one frame');
    assert.deepEqual(dev.received[0], frame(source),
      'OTA frame is byte-for-byte the USB/CLI frame()');
  } finally { await dev.close(); }
});

test('OTA wrong token is rejected (AUTH ERR path)', async () => {
  const dev = await mockOtaDevice(OTA_TOKEN);
  try {
    await assert.rejects(openOta('127.0.0.1', 'f'.repeat(32), dev.port),
      /rejected the token/);
  } finally { await dev.close(); }
});

test('OTA RELOAD ERR is surfaced as a push error', async () => {
  // A device that answers every frame with a RELOAD ERR reason.
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let authed = false;
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!authed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        authed = buf.subarray(0, nl).toString('utf8') === `AUTH ${OTA_TOKEN}`;
        buf = buf.subarray(nl + 1);
        socket.write(authed ? 'AUTH OK\n' : 'AUTH ERR\n');
      }
      if (authed && buf.length >= 12) {
        const len = buf.readUInt32LE(4);
        if (buf.length >= 12 + len) {
          socket.write('RELOAD ERR bad-crc\n');
          buf = buf.subarray(12 + len);
        }
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const device = await openOta('127.0.0.1', OTA_TOKEN, server.address().port);
    await assert.rejects(device.push('x'), /device rejected bundle: bad-crc/);
    await device.close();
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise(r => server.close(r));
  }
});

test('OTA no-board path: connection refused is a clear error', async () => {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const closedPort = probe.address().port;
  await new Promise(r => probe.close(r));
  await assert.rejects(openOta('127.0.0.1', OTA_TOKEN, closedPort),
    /cannot connect to OTA device at 127\.0\.0\.1/);
});

test('CLI --ota usage, arg validation and no-board error output', async () => {
  const cli = new URL('./lume.js', import.meta.url).pathname;
  const help = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /lume deploy <dir> --ota <ip> --token <t>/);

  const parent = await mkdtemp(join(tmpdir(), 'lume-ota-cli-'));
  const root = join(parent, 'app');
  try {
    await create(root);   // valid app.js so bundle() succeeds before connecting
    // --ota without --token is rejected before bundling
    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'deploy', root, '--ota', '127.0.0.1']),
      err => /--ota needs --token/.test(err.stderr));
    // --ota on a closed port -> clear connect error (no board)
    const probe = net.createServer();
    await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const closedPort = probe.address().port;
    await new Promise(r => probe.close(r));
    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'deploy', root, '--ota', '127.0.0.1',
        '--token', OTA_TOKEN, '--ota-port', String(closedPort)]),
      err => /cannot connect to OTA device at 127\.0\.0\.1/.test(err.stderr));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
