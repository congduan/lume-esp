import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { bundle } from './bundle.js';
import { create } from './create.js';
import { frame, cmdFrame, storeCommand, storeCommandBuffer, simpleCommand, crc32, CONTROL, MAX_PAYLOAD, MAGIC_CMD, MAGIC_BYTECODE, bytecodeFrame, bytecodePayload, parseBytecodePayload, BC_MAGIC, BC_HDR_LEN, FWTAG_CMD, MAGIC_REPL, REPL_OUT_CAP, replFrame, parseFrame, clampReplOutput, decodeReplLines } from './protocol.js';
import { queryFirmwareTag } from './fwtag.js';
import { parseQjsVersion, qjsVersion, assertEngineVersion, queryEngineVersion, compileBytecode, localQjsc } from './bytecode.js';
import { openOta, otaMac, otaAuthResponse, OTA_PORT_DEFAULT } from './ota.js';
import { decodeShot, bmpFromRgb565 } from './shot.js';
import { check, render, parsePerf } from './check.js';
import { extractLumeCatalog, namespaceMembers, levenshtein, findUnknownMembers, suggest, parseEvalError } from './check_suggest.js';
import { parseLayoutRules } from './check_layout.js';

const execFileAsync = promisify(execFile);
const OTA_TOKEN = '0123456789abcdef0123456789abcdef';
const OTA_CHALLENGE = 'fedcba9876543210fedcba9876543210';

// Emulate the firmware's r96 challenge-response edge: send one fresh
// CHALLENGE on connect, then validate the AUTH line against the HMAC vector.
function startOtaHandshake(socket, token) {
  socket.write(`CHALLENGE ${OTA_CHALLENGE}\n`);
  const expected = `AUTH ${otaMac(token, OTA_CHALLENGE)}`;
  return line => line === expected;
}

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

/* ---- r115 device REPL frame + bounded-output helpers ---- */

test('r115 REPL frame uses LUMR magic with the same 12-byte header and CRC', () => {
  assert.equal(MAGIC_REPL, 'LUMR');
  const bytes = replFrame('1+2');
  assert.equal(bytes.toString('ascii', 0, 4), MAGIC_REPL);
  assert.equal(bytes.readUInt32LE(4), 3);
  assert.equal(bytes.readUInt32LE(8), crc32(Buffer.from('1+2')));
  assert.equal(bytes.subarray(12).toString('utf8'), '1+2');
  const parsed = parseFrame(bytes);
  assert.equal(parsed.magic, MAGIC_REPL);
  assert.equal(parsed.payload.toString('utf8'), '1+2');
  assert.throws(() => replFrame(''), /1\.\.262144/);
  assert.throws(() => replFrame(Buffer.alloc(MAX_PAYLOAD + 1)), /1\.\.262144/);
});

test('parseFrame rejects bad magic, zero/overlong length and bad CRC', () => {
  const good = replFrame('x');
  assert.equal(parseFrame(good).payload.toString(), 'x');
  const badMagic = Buffer.from(good); badMagic.write('XXXX', 0, 'ascii');
  assert.equal(parseFrame(badMagic), null);
  const zeroLen = Buffer.from(good); zeroLen.writeUInt32LE(0, 4);
  assert.equal(parseFrame(zeroLen), null);
  const badCrc = Buffer.from(good); badCrc.writeUInt32LE((badCrc.readUInt32LE(8) ^ 1) >>> 0, 8);
  assert.equal(parseFrame(badCrc), null);
  const wrongSize = Buffer.from(good); wrongSize.writeUInt32LE(2, 4);
  assert.equal(parseFrame(wrongSize), null);
  assert.equal(parseFrame(Buffer.alloc(11)), null);
});

test('clampReplOutput bounds to REPL_OUT_CAP and flags truncation', () => {
  assert.equal(REPL_OUT_CAP, 2048);
  const exact = 'a'.repeat(REPL_OUT_CAP);
  assert.deepEqual(clampReplOutput(exact), { text: exact, truncated: false });
  const long = exact + 'OVERFLOW';
  const clamped = clampReplOutput(long);
  assert.equal(clamped.text.length, REPL_OUT_CAP);
  assert.equal(clamped.truncated, true);
  // Byte-oriented: a 3000-byte multibyte string is clipped on a byte boundary;
  // decoding the clipped bytes may replace a trailing partial UTF-8 sequence,
  // so allow a few bytes of slack when measuring the decoded text.
  const utf = '中'.repeat(1000); // 3000 bytes
  const utfClamped = clampReplOutput(utf);
  assert.equal(utfClamped.truncated, true);
  assert.ok(Buffer.byteLength(utfClamped.text) >= REPL_OUT_CAP - 3 &&
            Buffer.byteLength(utfClamped.text) <= REPL_OUT_CAP + 3);
});

test('decodeReplLines joins R64 base64 and ignores device log noise', () => {
  const raw = Buffer.from('a\nb\0c', 'utf8');
  const b64 = raw.toString('base64');
  const half = Math.ceil(b64.length / 2);
  const lines = ['I (495) log noise', 'R64' + b64.slice(0, half),
                 'E (123) more noise', 'R64' + b64.slice(half)];
  assert.deepEqual(decodeReplLines(lines), raw);
  assert.deepEqual(decodeReplLines([]), Buffer.alloc(0));
});

/* ---- r43b app-bundle bytecode (qjsc + frame protocol + version check) ---- */

test('r43b bytecode frame uses LUMB magic with the same 12-byte header and CRC', () => {
  const payload = Buffer.from([0x4c, 0x51, 0x42, 0x43, 0, 18, 0, 29,
                               0, 0, 0, 0, 3, 0, 0, 0, 1, 2, 3]);
  const bytes = bytecodeFrame(payload);
  assert.equal(bytes.toString('ascii', 0, 4), MAGIC_BYTECODE);
  assert.equal(bytes.readUInt32LE(4), payload.length);
  assert.equal(bytes.readUInt32LE(8), crc32(payload));
  assert.ok(bytes.subarray(12).equals(payload));
  assert.throws(() => bytecodeFrame(Buffer.alloc(MAX_PAYLOAD + 1)), /1\.\.262144/);
});

test('r43b LQBC payload header round-trips a raw qjsc blob', () => {
  const version = { major: 0, minor: 18, patch: 0, bcVersion: 29 };
  const body = Buffer.from([29, 0xaa, 0x0a, 0xff, 0x00, 0x7f]);
  const payload = bytecodePayload(body, version);
  assert.equal(payload.length, BC_HDR_LEN + body.length);
  assert.equal(payload.toString('ascii', 0, 4), BC_MAGIC);
  assert.equal(payload[4], 0);
  assert.equal(payload[5], 18);
  assert.equal(payload[6], 0);
  assert.equal(payload[7], 29);
  assert.equal(payload.readUInt32LE(8), 0);          // reserved bytes zero
  assert.equal(payload.readUInt32LE(12), body.length);
  const parsed = parseBytecodePayload(payload);
  assert.equal(parsed.major, 0);
  assert.equal(parsed.minor, 18);
  assert.equal(parsed.patch, 0);
  assert.equal(parsed.bcVersion, 29);
  assert.equal(parsed.reserved, 0);
  assert.equal(parsed.bodyLen, body.length);
  assert.ok(parsed.body.equals(body));
  assert.equal(parseBytecodePayload(Buffer.from('not bytecode')), null);
  assert.throws(() => bytecodePayload(Buffer.alloc(0), version), /empty/);
  assert.throws(() => bytecodePayload(body, { major: 999, minor: 0, patch: 0, bcVersion: 29 }), /0\.\.255/);
});

test('engine version is read from the vendored QuickJS-NG sources', async () => {
  const v = await qjsVersion();             // r43b pinned vendored version
  assert.equal(v.version, '0.18.0');
  assert.equal(v.bcVersion, 29);
  assert.deepEqual(parseQjsVersion(
    '#define QJS_VERSION_MAJOR 1\n#define QJS_VERSION_MINOR 2\n#define QJS_VERSION_PATCH 3\n',
    '#define BC_VERSION 30\n'),
    { major: 1, minor: 2, patch: 3, bcVersion: 30, version: '1.2.3' });
  assert.throws(() => parseQjsVersion('nope', 'nope'), /QJS_VERSION_MAJOR/);
});

test('bytecode deploy rejects a mismatched device engine version locally', async () => {
  const device = { command: async () => ({ verb: 'ver', arg: '0.17.0' }) };
  assert.equal(await queryEngineVersion(device), '0.17.0');
  assert.throws(() => assertEngineVersion('0.17.0', '0.18.0'),
                /engine version mismatch: device 0.17.0, local qjsc 0.18.0/);
  assert.doesNotThrow(() => assertEngineVersion('0.18.0', '0.18.0'));
  // Old firmware answers "CMD ERR verb": surface a clear "update firmware" hint.
  const old = { command: async () => { throw new Error('device rejected command: verb'); } };
  await assert.rejects(queryEngineVersion(old), /cannot query device engine version/);
});

test('binary STORE keeps bytecode bytes intact (no UTF-8 round trip)', () => {
  const body = Buffer.from([0x00, 0xff, 0x0a, 0x1d, 0x80, 0x4c, 0x51, 0x42, 0x43]);
  const cmd = storeCommandBuffer('snake', { label: 'Snake' }, body);
  assert.ok(Buffer.isBuffer(cmd));
  assert.ok(cmd.subarray(-body.length).equals(body));
  const framed = cmdFrame(cmd);
  assert.equal(framed.toString('ascii', 0, 4), MAGIC_CMD);
  assert.ok(framed.subarray(12).subarray(-body.length).equals(body));
});

test('qjsc compiles an esbuild bundle to loadable bytecode', { skip: !existsSync(localQjsc) }, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'lume-qjsc-test-'));
  try {
    await writeFile(join(parent, 'app.js'), 'globalThis.lumeProbe = 42;\n');
    const src = await bundle(parent, { minify: false });
    const body = await compileBytecode(src, localQjsc);
    const v = await qjsVersion();
    assert.equal(body[0], v.bcVersion);   // BC_VERSION is byte 0 of the blob
    const payload = bytecodePayload(body, v);
    const parsed = parseBytecodePayload(payload);
    assert.equal(parsed.bodyLen, body.length);
    assert.equal(parsed.body[0], v.bcVersion);
    assert.equal(parsed.major, v.major);
    const fr = bytecodeFrame(payload);
    assert.equal(fr.toString('ascii', 0, 4), MAGIC_BYTECODE);
    assert.equal(fr.readUInt32LE(4), payload.length);
    assert.equal(crc32(fr.subarray(12)), fr.readUInt32LE(8));
  } finally { await rm(parent, { recursive: true, force: true }); }
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
  const commands = [];
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let authed = false;
    const checkAuth = startOtaHandshake(socket, token);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!authed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = buf.subarray(0, nl).toString('utf8');
        buf = buf.subarray(nl + 1);
        authed = checkAuth(line);
        socket.write(authed ? 'AUTH OK\n' : 'AUTH ERR\n');
        if (!authed) socket.end();
      }
      if (authed && buf.length >= 12) {
        const len = buf.readUInt32LE(4);
        if (buf.length >= 12 + len) {
          const magic = buf.subarray(0, 4).toString('ascii');
          const payload = buf.subarray(12, 12 + len).toString('utf8');
          received.push(Buffer.from(buf.subarray(0, 12 + len)));
          if (magic === MAGIC_CMD) {
            commands.push(payload);
            if (payload.startsWith('STORE\t')) {
              socket.write(`CMD OK store ${payload.split('\t')[1].split('\n')[0]} ${len}\n`);
            } else if (payload === 'LIST') {
              socket.write('APP\tclock\nMETA\tclock\t{"label":"Clock"}\nCMD OK list 1\n');
            } else if (payload.startsWith('LAUNCH')) {
              socket.write('RELOAD OK 7\n');
            } else if (payload === 'SHOT') {
              // Same grammar as lume_hotreload.c handle_shot(): header,
              // S64 base64 data lines (240 raw bytes each), footer. Junk
              // log lines between replies must be ignored by the CLI.
              const w = 4, h = 3;
              const raw = Buffer.alloc(w * h * 2);
              for (let i = 0; i < raw.length; i += 2) raw.writeUInt16LE((i / 2) & 0xffff, i);
              socket.write(`SHOT ${w} ${h} ${raw.length} ${crc32(raw).toString(16).padStart(8, '0')}\n`);
              socket.write('I (1234) lume: noisy device log line\n');
              for (let off = 0; off < raw.length; off += 240) {
                const end = Math.min(off + 240, raw.length);
                socket.write('S64' + raw.subarray(off, end).toString('base64') + '\n');
                socket.write('I (1235) lume: another log line\n');
              }
              socket.write('SHOT OK\n');
            } else {
              socket.write('CMD OK home\n');
            }
          } else {
            socket.write(`RELOAD OK ${len}\n`);
          }
          buf = buf.subarray(12 + len);
        }
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      received,
      commands,
      close: () => new Promise(r => {
        for (const s of sockets) s.destroy();
        server.close(r);
      }),
    }));
  });
}

test('OTA auth vector: HMAC-SHA256(token, challenge ASCII) + default port', () => {
  // Fixed vector so the CLI and firmware glue can be cross-checked by hand.
  const token = '0123456789abcdef0123456789abcdef';
  const challenge = 'fedcba9876543210fedcba9876543210';
  const want = createHmac('sha256', Buffer.from(token, 'hex'))
    .update(challenge, 'ascii').digest('hex');
  assert.equal(otaMac(token, challenge), want);
  assert.equal(otaAuthResponse(token, challenge), `AUTH ${want}\n`);
  // A different challenge must produce a different MAC (anti-replay property).
  assert.notEqual(otaMac(token, '00000000000000000000000000000000'), want);
  assert.throws(() => otaMac('bad', challenge), /32 hex characters/);
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

/* ---- r35 screenshot reply (SHOT command, host mock device) ---- */

test('OTA screenshot round trips the RGB565 frame past log noise', async () => {
  const dev = await mockOtaDevice(OTA_TOKEN);
  try {
    const device = await openOta('127.0.0.1', OTA_TOKEN, dev.port);
    const shot = await device.screenshot();
    await device.close();
    assert.deepEqual(dev.commands, ['SHOT'], 'device received the SHOT command');
    assert.equal(shot.width, 4);
    assert.equal(shot.height, 3);
    assert.equal(shot.data.length, 24);
    assert.equal(shot.data.readUInt16LE(0), 0);      // first pixel
    assert.equal(shot.data.readUInt16LE(20), 10);    // last pixel (i/2 = 10)
  } finally { await dev.close(); }
});

test('decodeShot rejects a corrupted payload and a CRC mismatch', () => {
  const raw = Buffer.alloc(8, 0xab);
  const crc = crc32(raw).toString(16).padStart(8, '0');
  assert.throws(() => decodeShot(['SHOT 2 2 8 deadbeef', 'S64' + raw.toString('base64'), 'SHOT OK']),
    /CRC mismatch/);
  assert.throws(() => decodeShot([`SHOT 2 2 8 ${crc}`, 'S64' + raw.subarray(0, 4).toString('base64'), 'SHOT OK']),
    /truncated/);
  assert.throws(() => decodeShot(['I (1) tag: log only']), /no SHOT header/);
});

test('bmpFromRgb565 produces a valid bottom-up 24-bit BMP', () => {
  // 3x2 frame: top row = pure red (0xF800), bottom row = pure blue (0x001F).
  const w = 3, h = 2;
  const data = Buffer.alloc(w * h * 2);
  for (let x = 0; x < w; x++) data.writeUInt16LE(0xf800, x * 2);
  for (let x = 0; x < w; x++) data.writeUInt16LE(0x001f, w * 2 + x * 2);
  const bmp = bmpFromRgb565(data, w, h);
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readUInt32LE(10), 54);
  assert.equal(bmp.readInt32LE(18), w);
  assert.equal(bmp.readInt32LE(22), h);
  assert.equal(bmp.readUInt16LE(28), 24);
  // Row stride is padded to 4 bytes (w*3 = 9 -> pad 3); BMP rows run
  // bottom-up, so the BMP's first pixel row is the frame's LAST row (blue).
  const stride = w * 3 + 3;
  assert.deepEqual([...bmp.subarray(54, 57)], [31 << 3, 0, 0]);
  // 5-bit channels quantize 0x1f to 31<<3 = 248 (not 255).
  assert.deepEqual([...bmp.subarray(54 + stride * (h - 1), 54 + stride * (h - 1) + 3)], [0, 0, 31 << 3]);
});

test('OTA RELOAD ERR is surfaced as a push error', async () => {
  // A device that answers every frame with a RELOAD ERR reason.
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let authed = false;
    const checkAuth = startOtaHandshake(socket, OTA_TOKEN);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!authed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        authed = checkAuth(buf.subarray(0, nl).toString('utf8'));
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

/* ---- r30 multi-app command frames ---- */

test('command frame uses LUMC magic, same header and CRC as app frames', () => {
  const bytes = cmdFrame('LIST');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'LUMC');
  assert.equal(MAGIC_CMD, 'LUMC');
  assert.equal(bytes.readUInt32LE(4), 4);
  assert.equal(bytes.readUInt32LE(8), crc32(Buffer.from('LIST')));
  assert.equal(bytes.subarray(12).toString('utf8'), 'LIST');
  assert.equal(frame('LIST').subarray(0, 4).toString('ascii'), 'LUME');
  assert.throws(() => cmdFrame(''), /1\.\.262144/);
});

test('STORE payload layout: verb, id, one-line meta, then raw source', () => {
  assert.equal(storeCommand('clock', { label: '时钟' }, 'var a=1;'),
    'STORE\tclock\n{"label":"时钟"}\nvar a=1;');
  assert.equal(storeCommand('calc', {}, 'var b=2;'), 'STORE\tcalc\n\nvar b=2;');
  // JSON.stringify escapes newlines, so the meta line always stays one line.
  const multiline = storeCommand('x', { label: 'a\nb' }, 's');
  assert.equal(multiline.split('\n').length, 3);
  assert.ok(multiline.includes('\\n'));
  assert.equal(simpleCommand('launch', 'clock'), 'LAUNCH\tclock');
  assert.equal(simpleCommand('list'), 'LIST');
  assert.equal(simpleCommand('home'), 'HOME');
});

/* ---- r106 deploy-manifest firmware API tag (FWTAG) ---- */
test('r106 FWTAG is an id-less LUMC verb and parses the device reply', async () => {
  assert.equal(FWTAG_CMD, 'FWTAG');
  assert.equal(simpleCommand(FWTAG_CMD), 'FWTAG');
  const device = { command: async (text) => {
    assert.equal(text, 'FWTAG');
    return { verb: 'fwt', arg: '7', count: null, lines: [] };
  } };
  assert.equal(await queryFirmwareTag(device), 7);
  // Old firmware / malformed replies surface as honest errors, never a fake 0.
  const old = { command: async () => { throw new Error('device rejected command: verb'); } };
  await assert.rejects(queryFirmwareTag(old), /cannot query device firmware tag/);
  const bad = { command: async () => ({ verb: 'fwt', arg: 'x' }) };
  await assert.rejects(queryFirmwareTag(bad), /unexpected FWTAG reply/);
});

test('OTA command round trip: STORE + LIST + LAUNCH ACKs', async () => {
  const dev = await mockOtaDevice(OTA_TOKEN);
  try {
    const device = await openOta('127.0.0.1', OTA_TOKEN, dev.port);
    const payload = storeCommand('clock', { label: 'Clock' }, 'View({});');
    const stored = await device.command(payload);
    assert.equal(stored.verb, 'store');
    assert.equal(stored.arg, 'clock');

    const list = await device.command(simpleCommand('LIST'));
    assert.equal(list.count, 1);
    assert.deepEqual(list.lines, ['APP\tclock', 'META\tclock\t{"label":"Clock"}']);

    await device.commandReload(simpleCommand('LAUNCH', 'clock'));
    await device.close();
    assert.deepEqual(dev.commands, [payload, 'LIST', 'LAUNCH\tclock']);
    assert.ok(dev.received.every(f => f.subarray(0, 4).toString('ascii') === 'LUMC'));
  } finally { await dev.close(); }
});

test('CLI apps usage, sub-command and id validation', async () => {
  const cli = new URL('./lume.js', import.meta.url).pathname;
  const help = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /lume apps list\|launch <id>\|remove <id>\|home/);
  assert.match(help.stdout, /--id <app-id>/);
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'apps', 'launch']),
    err => /apps launch needs an app id/.test(err.stderr));
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'apps', 'explode']),
    err => /unknown apps command: explode/.test(err.stderr));
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'deploy', '.', '--id', '.bad']),
    err => /--id must be/.test(err.stderr));
});

test('OTA no-board path: connection refused is a clear error', async () => {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const closedPort = probe.address().port;
  await new Promise(r => probe.close(r));
  await assert.rejects(openOta('127.0.0.1', OTA_TOKEN, closedPort),
    /cannot connect to OTA device at 127\.0\.0\.1/);
});

test('CLI --host usage, arg validation and no-board error output', async () => {
  const cli = new URL('./lume.js', import.meta.url).pathname;
  const help = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /lume deploy <dir> --host <ip> --token <t>/);

  const parent = await mkdtemp(join(tmpdir(), 'lume-ota-cli-'));
  const root = join(parent, 'app');
  try {
    await create(root);   // valid app.js so bundle() succeeds before connecting
    // --host without --token is rejected before bundling
    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'deploy', root, '--host', '127.0.0.1']),
      err => /--host needs --token/.test(err.stderr));
    // --host on a closed port -> clear connect error (no board). --ota is
    // retained as a legacy alias and is exercised here.
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

/* ---- r45b `lume check` one-shot verification (injected I/O, no board) ---- */

const RULES_PASS = Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].map(r => [r, 'PASS']));
const SERIAL_OK = [
  'I (1881) lume-engine: app eval ok; entering event loop',
  'I (2776) lume-engine: app eval ok; entering event loop',
].join('\n');
const SERIAL_BAD_API = [
  'E (2759) lume-engine: JS exception [<lume-app>]: TypeError: not a function',
  'E (2760) lume-engine: JS stack [<lume-app>]:     at <anonymous> (<lume-app>:1:14)',
  "W (2760) lume-engine: reload/launch eval failed for ''",
  'I (2902) lume-engine: app eval ok; entering event loop',  // HOME fallback, not success
].join('\n');

function emuOk(extra = {}) {
  return { exitCode: 0, timedOut: false, stdout: '', stderr: '',
           serialLog: SERIAL_OK, screenshot: 'artifacts/check/counter/tft.png', ...extra };
}

test('check: d.ts catalog + Levenshtein nearest-neighbour spelling hint', () => {
  const catalog = extractLumeCatalog(`
declare namespace lume.ai {
  function setKey(key: string): number;
  function chat(options: ChatOptions): ChatResult | number;
}
declare namespace lume.theme {
  function set(theme: Theme): void;
  function get(): Theme;
}
`);
  assert.deepEqual(namespaceMembers(catalog, 'lume.ai'), ['setKey', 'chat']);
  assert.equal(levenshtein('chet', 'chat'), 1);
  assert.equal(levenshtein('xyz', 'chat'), 4);
  const found = findUnknownMembers(
    [{ file: 'app.js', text: 'lume.ai.chet({});\nlume.theme.get();' }], catalog);
  assert.equal(found.length, 1);
  assert.equal(found[0].expression, 'lume.ai.chet');
  assert.equal(found[0].namespace, 'lume.ai');
  assert.equal(found[0].line, 1);
  assert.equal(suggest(found[0]), 'did you mean lume.ai.chat? (available: setKey, chat)');
});

test('check: parseEvalError reads the real JS exception/stack log format', () => {
  const e = parseEvalError(SERIAL_BAD_API);
  assert.equal(e.message, 'TypeError: not a function');
  assert.equal(e.line, 1);                 // from "at <anonymous> (<lume-app>:1:14)"
  assert.equal(e.tag, '<lume-app>');
  assert.equal(parseEvalError(SERIAL_OK), null);
  assert.equal(parseEvalError('RELOAD ERR bad-crc\n')?.message, 'bad-crc');
});

test('check: layout R1-R7 aggregation and best-effort perf parsing', () => {
  const failTable = [
    '  FAIL R1 card: no pixels',
    'app                  R1    R2    R3    R4    R5    R6    R7',
    'counter              FAIL  FAIL  PASS  PASS  PASS  PASS  PASS ',
  ].join('\n');
  assert.deepEqual(parseLayoutRules(failTable),
    { R1: 'FAIL', R2: 'FAIL', R3: 'PASS', R4: 'PASS', R5: 'PASS', R6: 'PASS', R7: 'PASS' });
  assert.deepEqual(parseLayoutRules(`app R1 R7\nx ${Object.values(RULES_PASS).join(' ')}`), RULES_PASS);
  assert.deepEqual(parsePerf([
    'I (1728) lume-perf: fps=2 flush=48',
    'I (1728) lume-perf: render n=2 avg_us=10364 max_us=12143',
    'I (1729) lume-perf: eval n=2 avg_us=41023 max_us=67668',
  ].join('\n')), { fps: 2, renderAvgUs: 10364, renderMaxUs: 12143, evalAvgUs: 41023 });
  assert.equal(parsePerf('I (1) tag: no profile lines\n'), null);
});

test('check: success path aggregates bundle/eval/layout/perf', async () => {
  const result = await check('examples/counter', {}, {
    bundle: async () => Buffer.alloc(2160),
    runEmu: async () => emuOk(),
    hasLayoutSpec: async () => true,
    runLayout: async () => ({ ok: true, rules: RULES_PASS, failed: [], error: null }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map(s => s.step), ['bundle', 'eval', 'layout', 'perf']);
  assert.equal(result.steps[0].bytes, 2160);
  assert.equal(result.steps[1].ok, true);
  assert.equal(result.steps[1].evalOkCount, 2);
  assert.equal(result.steps[2].rules.R7, 'PASS');
  assert.equal(result.steps[3].skipped, 'profile disabled');
  assert.equal(result.screenshot, 'artifacts/check/counter/tft.png');
  assert.match(render(result), /RESULT: PASS/);
});

test('check: layout FAIL is aggregated and fails the run', async () => {
  const rules = { ...RULES_PASS, R1: 'FAIL', R2: 'FAIL' };
  const result = await check('examples/counter', {}, {
    bundle: async () => Buffer.alloc(2160),
    runEmu: async () => emuOk(),
    hasLayoutSpec: async () => true,
    runLayout: async () => ({ ok: false, rules, failed: ['R1', 'R2'], error: null }),
  });
  assert.equal(result.ok, false);
  const layout = result.steps.find(s => s.step === 'layout');
  assert.equal(layout.rules.R1, 'FAIL');
  assert.deepEqual(layout.failed, ['R1', 'R2']);
  assert.match(render(result), /failed rules: R1, R2/);
});

test('check: bundle failure fails fast with esbuild file:line:column', async () => {
  const err = new Error('build failed');
  err.errors = [{ text: 'Unexpected ";"', location: { file: '/tmp/x/app.js', line: 1, column: 8 } }];
  const result = await check('/tmp/x', {}, {
    bundle: async () => { throw err; },
    runEmu: async () => { throw new Error('must not run after bundle failure'); },
    hasLayoutSpec: async () => { throw new Error('must not run'); },
    runLayout: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1, 'stops at the bundle step');
  assert.match(result.steps[0].error, /Unexpected ";" \(.*app\.js:1:8\)/);
});

test('check: eval failure carries raw message, original line and a spelling hint', async () => {
  // Uses the real runtime/types/lume.d.ts catalog via check()'s default reader.
  const result = await check('/tmp/lume-badapi', {}, {
    bundle: async () => Buffer.alloc(40),
    runEmu: async () => emuOk({ exitCode: 1, serialLog: SERIAL_BAD_API, screenshot: null }),
    appSources: async () => [{ file: 'app.js', text: 'lume.ai.chet({ messages: [] });\n' }],
    hasLayoutSpec: async () => false,
  });
  assert.equal(result.ok, false);
  const e = result.steps.find(s => s.step === 'eval');
  assert.equal(e.ok, false);
  assert.equal(e.error, 'TypeError: not a function');
  assert.equal(e.expression, 'lume.ai.chet');
  assert.equal(e.line, 1);
  assert.equal(e.hint, 'did you mean lume.ai.chat? (available: setKey, chat)');
  assert.match(render(result), /did you mean lume\.ai\.chat\?/);
});

test('check: emulator timeout is a FAIL with a serial-log tail', async () => {
  const result = await check('examples/counter', {}, {
    bundle: async () => Buffer.alloc(2160),
    runEmu: async () => emuOk({ exitCode: null, timedOut: true, serialLog: 'line1\nline2\n' }),
    hasLayoutSpec: async () => false,
  });
  assert.equal(result.ok, false);
  const e = result.steps.find(s => s.step === 'eval');
  assert.match(e.error, /timed out/);
  assert.match(e.tail, /line2/);
});

test('check: --no-emu skips emu/layout/perf but keeps the bundle check', async () => {
  const result = await check('examples/counter', { noEmu: true }, {
    bundle: async () => Buffer.alloc(2160),
    runEmu: async () => { throw new Error('must not run'); },
    hasLayoutSpec: async () => { throw new Error('must not run'); },
    runLayout: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.steps.filter(s => 'skipped' in s).length, 3);
});

test('check: visual mode aggregates browser result and skips emulator', async () => {
  for (const visualOk of [true, false]) {
    const result = await check('examples/counter', { visual: true }, {
      bundle: async () => Buffer.alloc(20),
      runEmu: async () => { throw Error('visual mode must skip emulator'); },
      runVisual: async () => ({ ok: visualOk, frames: 3, file: 'visual.json' }),
    });
    assert.equal(result.ok, visualOk);
    assert.equal(result.steps.find(s => s.step === 'eval').skipped, '--visual uses browser simulator');
    assert.equal(result.steps.find(s => s.step === 'visual').frames, 3);
  }
});

test('check: CLI --json is valid JSON and exit codes are 0 (pass) / 1 (fail)', async () => {
  const cli = new URL('./lume.js', import.meta.url).pathname;
  // npm --prefix runs tests with cwd=tools/lume, so use an absolute app path.
  const counterDir = new URL('../../examples/counter', import.meta.url).pathname;
  const help = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /lume check <app-dir> \[--json\]/);

  const ok = await execFileAsync(process.execPath,
    [cli, 'check', counterDir, '--no-emu', '--json']);
  const parsed = JSON.parse(ok.stdout);          // throws if not valid JSON
  assert.equal(parsed.ok, true);
  assert.equal(parsed.app, 'examples/counter');
  assert.ok(Array.isArray(parsed.steps) && parsed.steps.length === 4);

  const parent = await mkdtemp(join(tmpdir(), 'lume-check-empty-'));
  try {
    // No app.js -> bundle step fails -> exit 1, JSON must still parse.
    await assert.rejects(
      execFileAsync(process.execPath, [cli, 'check', parent, '--no-emu', '--json']),
      err => {
        assert.equal(err.code, 1);
        const failed = JSON.parse(err.stdout);
        assert.equal(failed.ok, false);
        assert.equal(failed.steps[0].step, 'bundle');
        return true;
      });
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('CLI token command validates the 32-hex token before opening a port', async () => {
  const cli = new URL('./lume.js', import.meta.url).pathname;
  const help = await execFileAsync(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /lume token <32hex>/);
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'token', 'abc']),
    err => /token needs 32 hex characters/.test(err.stderr));
});
