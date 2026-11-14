import { SerialPort } from 'serialport';
import { frame, cmdFrame } from './protocol.js';

const ACK_TIMEOUT_MS = 15000;

export async function detectPort() {
  const ports = await SerialPort.list();
  const candidates = ports.filter(p =>
    p.vendorId?.toLowerCase() === '303a' ||
    /esp32|serial\/jtag/i.test(`${p.manufacturer ?? ''} ${p.friendlyName ?? ''}`));
  if (candidates.length === 1) return candidates[0].path;
  if (candidates.length > 1) throw new Error(`multiple ESP USB ports: ${candidates.map(p => p.path).join(', ')}; use --port`);
  throw new Error('no ESP32-S3 USB Serial/JTAG port found; connect the board or pass --port <path>');
}

/* Device reply grammar (firmware lume_hotreload.c / lume_cmd.c):
 *   RELOAD OK <len> | RELOAD ERR <reason>            (bundle / launch eval)
 *   CMD OK <verb> [<arg>] [<len>] | CMD ERR <reason> (store/list/remove/meta)
 *   APP\t<id> / META\t<id>\t<json>                   (list blocks, before OK) */
const RELOAD_LINE = /^RELOAD (OK (\d+)|ERR (\S+))\r?$/;
const CMD_OK_LINE = /^CMD OK(?: (\S+))?(?: (\S+))?(?: (\d+))?\r?$/;
const CMD_ERR_LINE = /^CMD ERR (\S+)\r?$/;

export async function openPort(path, { monitor = false } = {}) {
  const selected = path ?? await detectPort();
  const port = new SerialPort({ path: selected, baudRate: 115200, autoOpen: false });
  try { await new Promise((ok, fail) => port.open(err => err ? fail(err) : ok())); }
  catch (err) { throw new Error(`cannot open serial port ${selected}: ${err.message} (check connection and port ownership)`); }
  let pending = null;
  let lineBuffer = '';
  const finish = (ok, value) => {
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    if (ok) request.resolve(value);
    else request.reject(value instanceof Error ? value : new Error(String(value)));
  };
  const consumeLine = line => {
    if (!pending) {
      if (monitor) process.stdout.write(line + '\n');
      return;
    }
    if (pending.kind === 'cmd' && (line.startsWith('APP\t') || line.startsWith('META\t'))) {
      pending.lines.push(line);
      return;
    }
    if (pending.kind === 'bundle' || pending.kind === 'launch') {
      const ack = RELOAD_LINE.exec(line);
      if (!ack) { if (monitor) process.stdout.write(line + '\n'); return; }
      if (ack[2] === undefined) return finish(false, new Error(`device rejected: ${ack[3]}`));
      const received = Number(ack[2]);
      // A launched app reports its OWN source length, not the command length.
      if (pending.kind === 'bundle' && received !== pending.length) {
        return finish(false, new Error(`device ACK length mismatch: ${received} != ${pending.length}`));
      }
      return finish(true, received);
    }
    const ok = CMD_OK_LINE.exec(line);
    const err = CMD_ERR_LINE.exec(line);
    if (!ok && !err) { if (monitor) process.stdout.write(line + '\n'); return; }
    if (err) return finish(false, new Error(`device rejected command: ${err[1]}`));
    const verb = ok[1] ?? '';
    const arg = ok[2] ?? '';
    // LIST answers "CMD OK list <count>": the count occupies the arg slot.
    const count = ok[3] !== undefined ? Number(ok[3])
      : verb === 'list' && arg !== '' ? Number(arg) : null;
    return finish(true, { verb, arg, count, lines: pending.lines });
  };
  port.on('data', bytes => {
    lineBuffer += bytes.toString('utf8');
    // Keep log memory bounded even if a device emits no newline.
    if (lineBuffer.length > 8192) lineBuffer = lineBuffer.slice(-8192);
    let index;
    while ((index = lineBuffer.indexOf('\n')) >= 0) {
      consumeLine(lineBuffer.slice(0, index));
      lineBuffer = lineBuffer.slice(index + 1);
    }
  });
  const failPending = err => { if (pending) finish(false, err); };
  port.on('error', err => failPending(new Error(`serial port ${selected}: ${err.message}`)));
  port.on('close', () => failPending(new Error(`serial port ${selected} disconnected`)));
  const write = async bytes => {
    if (!port.isOpen) throw new Error(`serial port ${selected} disconnected`);
    await new Promise((ok, fail) => port.write(bytes, err => err ? fail(err) : ok()));
    await new Promise((ok, fail) => port.drain(err => err ? fail(err) : ok()));
  };
  const startPending = (kind, extra) => {
    if (pending) throw new Error('a device request is already waiting for ACK');
    return new Promise((resolve, reject) => {
      pending = { kind, resolve, reject, ...extra,
        timer: setTimeout(() => {
          pending = null;
          reject(new Error(`device did not ACK ${kind} within ${ACK_TIMEOUT_MS} ms on ${selected}`));
        }, ACK_TIMEOUT_MS) };
    });
  };
  return {
    path: selected,
    async push(source) {
      const bytes = frame(source);
      const result = startPending('bundle', { length: bytes.length - 12 });
      // A write failure can reject before the caller receives this promise.
      result.catch(() => {});
      try { await write(bytes); } catch (err) { failPending(new Error(`serial write failed on ${selected}: ${err.message}`)); }
      return result;
    },
    /** Command frame answered by CMD OK/ERR (store/list/remove/meta). */
    async command(text) {
      const bytes = cmdFrame(text);
      const result = startPending('cmd', { lines: [] });
      result.catch(() => {});
      try { await write(bytes); } catch (err) { failPending(new Error(`serial write failed on ${selected}: ${err.message}`)); }
      return result;
    },
    /** Command frame answered by the engine's RELOAD OK/ERR (launch/home). */
    async commandReload(text) {
      const bytes = cmdFrame(text);
      const result = startPending('launch', {});
      result.catch(() => {});
      try { await write(bytes); } catch (err) { failPending(new Error(`serial write failed on ${selected}: ${err.message}`)); }
      return result;
    },
    write,
    close: () => new Promise(resolve => port.close(() => resolve())),
  };
}
