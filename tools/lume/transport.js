import { SerialPort } from 'serialport';
import { frame, cmdFrame, bytecodeFrame, replFrame, decodeReplLines } from './protocol.js';
import { decodeShot, formatShotError } from './shot.js';

const ACK_TIMEOUT_MS = 15000;

// r222: ESP32-S3 USB Serial/JTAG ISR drains the 64 B hardware FIFO into an
// internal ring buffer without USB OUT backpressure (xRingbufferSendFromISR
// drops packets silently when full). Chunking + short inter-chunk pacing keeps
// burst volume well inside the RX ring even on older 1 KiB firmware builds.
export const DEFAULT_CHUNK_SIZE = 256;
export const DEFAULT_CHUNK_DELAY_MS = 4;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RESYNC_DELAY_MS = 50;
// 12 x 0xFF drives lume_frame_parser into ST_RESYNC from any non-body state:
// in ST_RESYNC it is ignored; in ST_MAGIC it triggers bad-magic -> ST_RESYNC;
// in ST_HDR (hdr_n <= 3) it forces total_len >= 0xFF000000 -> too-large -> ST_RESYNC.
export const RESYNC_PREAMBLE = Buffer.alloc(12, 0xff);

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
 *   RELOAD OK <len> | RELOAD ERR <reason>            (bundle / launch eval / frame-layer err)
 *   CMD OK <verb> [<arg>] [<len>] | CMD ERR <reason> (store/list/remove/meta)
 *   APP\t<id> / META\t<id>\t<json>                   (list blocks, before OK) */
const RELOAD_LINE = /^RELOAD (OK (\d+)|ERR (\S+))\r?$/;
const CMD_OK_LINE = /^CMD OK(?: (\S+))?(?: (\S+))?(?: (\d+))?\r?$/;
const CMD_ERR_LINE = /^CMD ERR (\S+)\r?$/;
const SHOT_HDR_LINE = /^SHOT \d+ \d+ \d+ [0-9a-f]{8}\r?$/;
// Frame-layer rejections emitted by lume_hotreload.c on LUME_FRAME_EV_ERR (or
// USB RX idle timeout) regardless of whether the frame was LUME/LUMB/LUMC/LUMR.
const FRAME_ERR_REASONS = new Set(['bad-crc', 'bad-magic', 'empty', 'too-large', 'oom', 'timeout']);
const RETRYABLE_FRAME_ERRORS = new Set(['bad-crc', 'bad-magic', 'timeout']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function frameRejection(reason) {
  const err = new Error(`device rejected: ${reason}`);
  err.frameError = reason;
  err.retryable = RETRYABLE_FRAME_ERRORS.has(reason);
  return err;
}

/**
 * Attach the Lume frame transport to an already-open SerialPort-compatible
 * stream (EventEmitter with isOpen, write(buf, cb), drain(cb), close(cb)).
 * Exported so unit tests can exercise chunking and retry with a mock port.
 */
export function attachPort(port, selected, {
  monitor = false,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkDelayMs = DEFAULT_CHUNK_DELAY_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  resyncDelayMs = DEFAULT_RESYNC_DELAY_MS,
  ackTimeoutMs = ACK_TIMEOUT_MS,
} = {}) {
  const retryLimit = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : DEFAULT_MAX_RETRIES;
  let pending = null;
  let lineBuffer = '';
  let suppressingResync = false;
  const finish = (ok, value) => {
    const request = pending;
    if (!request) return;
    pending = null;
    clearTimeout(request.timer);
    if (ok) request.resolve(value);
    else request.reject(value instanceof Error ? value : new Error(String(value)));
  };
  const consumeLine = line => {
    if (!pending) {
      if (suppressingResync && RELOAD_LINE.test(line)) return;
      if (monitor) process.stdout.write(line + '\n');
      return;
    }
    if (pending.kind === 'shot') {
      const cmdErr = CMD_ERR_LINE.exec(line);
      if (cmdErr) return finish(false, formatShotError(cmdErr[1]));
      if (/^SHOT OK\r?$/.test(line)) {
        try { return finish(true, decodeShot(pending.shotLines)); }
        catch (err) { return finish(false, err); }
      }
      if (!pending.shotStarted) {
        const frameErr = RELOAD_LINE.exec(line);
        if (frameErr && frameErr[3] && FRAME_ERR_REASONS.has(frameErr[3])) {
          return finish(false, frameRejection(frameErr[3]));
        }
        if (SHOT_HDR_LINE.test(line)) pending.shotStarted = true;
      }
      // Device log lines interleaving with the reply are skipped; every line
      // between the header and the footer is kept for decodeShot to sort out.
      pending.shotLines.push(line);
      return;
    }
    if (pending.kind === 'repl') {
      const header = /^REPL (OK|ERR) (\d+) ([01])\r?$/.exec(line);
      if (header) {
        pending.replStarted = true;
        pending.replOk = header[1] === 'OK';
        pending.replLen = Number(header[2]);
        pending.replTrunc = header[3] === '1';
        pending.replLines = [];
        return;
      }
      if (line === 'REPL END') {
        const text = decodeReplLines(pending.replLines).toString('utf8');
        return finish(true, { ok: pending.replOk, text, truncated: pending.replTrunc, length: pending.replLen });
      }
      if (!pending.replStarted) {
        const frameErr = RELOAD_LINE.exec(line);
        if (frameErr && frameErr[3] && FRAME_ERR_REASONS.has(frameErr[3])) {
          return finish(false, frameRejection(frameErr[3]));
        }
      }
      // R64 data lines and any interleaved device log lines are both kept;
      // decodeReplLines() ignores everything that is not an R64 line.
      pending.replLines.push(line);
      return;
    }
    if (pending.kind === 'cmd' && (line.startsWith('APP\t') || line.startsWith('META\t') ||
        line.startsWith('FLS\t') || line.startsWith('F64'))) {
      pending.lines.push(line);
      return;
    }
    if (pending.kind === 'bundle' || pending.kind === 'launch') {
      const ack = RELOAD_LINE.exec(line);
      if (!ack) { if (monitor) process.stdout.write(line + '\n'); return; }
      if (ack[2] === undefined) return finish(false, frameRejection(ack[3]));
      const received = Number(ack[2]);
      // A launched app reports its OWN source length, not the command length.
      if (pending.kind === 'bundle' && received !== pending.length) {
        return finish(false, new Error(`device ACK length mismatch: ${received} != ${pending.length}`));
      }
      return finish(true, received);
    }
    // Frame-layer rejections on LUMC commands arrive as "RELOAD ERR <reason>".
    const frameErr = RELOAD_LINE.exec(line);
    if (frameErr && frameErr[3] && FRAME_ERR_REASONS.has(frameErr[3])) {
      return finish(false, frameRejection(frameErr[3]));
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
  const writeRaw = async bytes => {
    if (!port.isOpen) throw new Error(`serial port ${selected} disconnected`);
    await new Promise((ok, fail) => port.write(bytes, err => err ? fail(err) : ok()));
    await new Promise((ok, fail) => port.drain(err => err ? fail(err) : ok()));
  };
  const write = async (bytes, shouldAbort = null) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!buf.length) return;
    const step = chunkSize > 0 ? chunkSize : buf.length;
    for (let off = 0; off < buf.length; off += step) {
      if (shouldAbort && shouldAbort()) return;
      const end = Math.min(off + step, buf.length);
      await writeRaw(buf.subarray(off, end));
      if (end < buf.length && chunkDelayMs > 0) {
        await sleep(chunkDelayMs);
      }
    }
  };
  const startPending = (kind, extra) => {
    if (pending) throw new Error('a device request is already waiting for ACK');
    return new Promise((resolve, reject) => {
      pending = { kind, resolve, reject, ...extra,
        timer: setTimeout(() => {
          pending = null;
          const err = new Error(`device did not ACK ${kind} within ${ackTimeoutMs} ms on ${selected}`);
          err.timeout = true;
          err.retryable = true;
          reject(err);
        }, ackTimeoutMs) };
    });
  };
  const sendOnce = async (bytes, kind, extraFactory) => {
    let settled = false;
    const result = startPending(kind, extraFactory());
    // A write failure can reject before the caller receives this promise.
    result.then(() => { settled = true; }, () => { settled = true; });
    try { await write(bytes, () => settled); }
    catch (err) { failPending(new Error(`serial write failed on ${selected}: ${err.message}`)); }
    return result;
  };
  const sendWithRetry = async (bytes, kind, extraFactory, { retryOnTimeout = true } = {}) => {
    let lastErr;
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        return await sendOnce(bytes, kind, extraFactory);
      } catch (err) {
        lastErr = err;
        const canRetry = Boolean(err && err.retryable &&
          (err.frameError ? true : (err.timeout && retryOnTimeout)) &&
          port.isOpen && attempt < retryLimit);
        if (!canRetry) throw err;
        // Drive the device parser back into ST_RESYNC and drain any preamble
        // bad-magic/too-large line before arming the next attempt's pending slot.
        suppressingResync = true;
        try {
          await writeRaw(RESYNC_PREAMBLE);
          if (resyncDelayMs > 0) await sleep(resyncDelayMs);
        } finally {
          suppressingResync = false;
        }
      }
    }
    throw lastErr;
  };
  const pushFrame = async bytes =>
    sendWithRetry(bytes, 'bundle', () => ({ length: bytes.length - 12 }));
  return {
    path: selected,
    async push(source) {
      return pushFrame(frame(source));
    },
    /** r43b: push a bytecodePayload() buffer in a "LUMB" frame. */
    async pushBytecode(payload) {
      return pushFrame(bytecodeFrame(payload));
    },
    /** Command frame answered by CMD OK/ERR (store/list/remove/meta). */
    async command(text) {
      return sendWithRetry(cmdFrame(text), 'cmd', () => ({ lines: [] }));
    },
    /** Command frame answered by the engine's RELOAD OK/ERR (launch/home). */
    async commandReload(text) {
      return sendWithRetry(cmdFrame(text), 'launch', () => ({}));
    },
    /** SHOT command: full-frame RGB565 screenshot streamed back as S64 lines. */
    async screenshot() {
      return sendWithRetry(cmdFrame('SHOT'), 'shot', () => ({ shotLines: [], shotStarted: false }));
    },
    /** r115 REPL: eval one JS expression on the device's current app ctx. */
    async repl(expr) {
      // Retry only on parser-level rejection (expr never evaluated), not timeout.
      return sendWithRetry(replFrame(expr), 'repl', () => ({ replLines: [], replStarted: false }),
        { retryOnTimeout: false });
    },
    write,
    close: () => new Promise(resolve => port.close(() => resolve())),
  };
}

export async function openPort(path, options = {}) {
  const selected = path ?? await detectPort();
  const port = new SerialPort({ path: selected, baudRate: 115200, autoOpen: false });
  try { await new Promise((ok, fail) => port.open(err => err ? fail(err) : ok())); }
  catch (err) { throw new Error(`cannot open serial port ${selected}: ${err.message} (check connection and port ownership)`); }
  return attachPort(port, selected, options);
}
