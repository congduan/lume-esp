import { SerialPort } from 'serialport';
import { frame } from './protocol.js';

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

export async function openPort(path, { monitor = false } = {}) {
  const selected = path ?? await detectPort();
  const port = new SerialPort({ path: selected, baudRate: 115200, autoOpen: false });
  try { await new Promise((ok, fail) => port.open(err => err ? fail(err) : ok())); }
  catch (err) { throw new Error(`cannot open serial port ${selected}: ${err.message} (check connection and port ownership)`); }
  let pending = null;
  let lineBuffer = '';
  const consumeLine = line => {
    const ack = /^RELOAD (OK (\d+)|ERR (\S+))\r?$/.exec(line);
    if (ack && pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      if (ack[2]) {
        const received = Number(ack[2]);
        received === request.length ? request.resolve() : request.reject(new Error(`device ACK length mismatch: ${received} != ${request.length}`));
      } else request.reject(new Error(`device rejected bundle: ${ack[3]}`));
    } else if (monitor) process.stdout.write(line + '\n');
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
  const failPending = err => { if (pending) { clearTimeout(pending.timer); pending.reject(err); pending = null; } };
  port.on('error', err => failPending(new Error(`serial port ${selected}: ${err.message}`)));
  port.on('close', () => failPending(new Error(`serial port ${selected} disconnected`)));
  const write = async bytes => {
    if (!port.isOpen) throw new Error(`serial port ${selected} disconnected`);
    await new Promise((ok, fail) => port.write(bytes, err => err ? fail(err) : ok()));
    await new Promise((ok, fail) => port.drain(err => err ? fail(err) : ok()));
  };
  return {
    path: selected,
    async push(source) {
      if (pending) throw new Error('a reload is already waiting for device ACK');
      const bytes = frame(source);
      const result = new Promise((resolve, reject) => {
        pending = { length: bytes.length - 12, resolve, reject,
          timer: setTimeout(() => { pending = null; reject(new Error(`device did not ACK reload within ${ACK_TIMEOUT_MS} ms on ${selected}`)); }, ACK_TIMEOUT_MS) };
      });
      // A write failure can reject before the caller receives this promise.
      result.catch(() => {});
      try { await write(bytes); } catch (err) { failPending(new Error(`serial write failed on ${selected}: ${err.message}`)); }
      return result;
    },
    write,
    close: () => new Promise(resolve => port.close(() => resolve())),
  };
}
