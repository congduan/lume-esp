// WiFi-OTA transport for `lume deploy --ota`. Talks to the firmware's
// lume-hotreload TCP channel (see firmware/components/lume-hotreload/ and
// include/lume_frame.h). Frame protocol is REUSED verbatim from the USB
// channel: the same frame() from protocol.js, same BACK/PAUS/RESM controls,
// same RELOAD OK/ERR reply lines. Only the transport + AUTH handshake differ.
import net from 'node:net';
import { frame, cmdFrame } from './protocol.js';

export const OTA_PORT_DEFAULT = 8765;
const CONNECT_TIMEOUT_MS = 5000;
const AUTH_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 15000;
const RELOAD_LINE = /^RELOAD /;
const CMD_LINE = /^CMD /;
const CMD_OK_LINE = /^CMD OK(?: (\S+))?(?: (\S+))?(?: (\d+))?$/;
const CMD_ERR_LINE = /^CMD ERR (\S+)$/;
const LIST_LINE = /^(APP|META)\t/;

/** The one-line auth preamble expected by lume_ota_auth_parse(). */
export function otaAuthLine(token) {
  return `AUTH ${token}\n`;
}

function connect(ip, port) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const fail = msg => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail(
      `cannot connect to OTA device at ${ip}:${port}: connection timed out ` +
      `(no board / wrong IP / OTA server down — the server starts only after WiFi GOT_IP)`),
      CONNECT_TIMEOUT_MS);
    socket.once('error', err => fail(
      `cannot connect to OTA device at ${ip}:${port}: ${err.message} ` +
      `(is the board on WiFi with an IP, and is the OTA server up?)`));
    socket.connect(port, ip, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

/* Line reader: the device sends ONLY lines (AUTH OK/ERR, RELOAD OK/ERR), never
 * binary. waitLine(predicate, ms, what) resolves with the first matching line
 * (queued or future) or rejects on timeout / socket close / error. */
function lineReader(socket, address) {
  let buf = '';
  const queue = [];
  let waiter = null;
  const fail = err => {
    if (!waiter) return;
    const w = waiter;
    waiter = null;
    clearTimeout(w.timer);
    w.reject(err);
  };
  socket.on('data', bytes => {
    buf += bytes.toString('utf8');
    if (buf.length > 65536) buf = buf.slice(-65536);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (waiter && waiter.predicate(line)) {
        const w = waiter;
        waiter = null;
        clearTimeout(w.timer);
        w.resolve(line);
      } else {
        queue.push(line);
        if (queue.length > 64) queue.shift();
      }
    }
  });
  socket.on('error', err => fail(new Error(`OTA connection ${address}: ${err.message}`)));
  socket.on('close', () => fail(new Error(`OTA connection ${address} closed`)));
  return {
    waitLine(predicate, ms, what) {
      const idx = queue.findIndex(predicate);
      if (idx >= 0) return Promise.resolve(queue.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error(`${what} timed out after ${ms} ms on ${address}`));
        }, ms);
        waiter = { resolve, reject, timer, predicate };
      });
    },
  };
}

/**
 * Connect to <ip>:<port>, authenticate with <token>, and return a channel with
 * push(source) / write(bytes) / close(). push() frames the source with the USB
 * frame() codec and waits for the device's RELOAD OK/ERR line.
 */
export async function openOta(ip, token, port = OTA_PORT_DEFAULT) {
  if (!ip) throw new Error('--ota needs an IP address');
  if (!token) throw new Error('--ota needs --token <t>');
  const address = `${ip}:${port}`;
  const socket = await connect(ip, port);
  const reader = lineReader(socket, address);
  const write = bytes => new Promise((resolve, reject) => {
    socket.write(bytes, err => err
      ? reject(new Error(`OTA write to ${address} failed: ${err.message}`))
      : resolve());
  });
  try {
    await write(Buffer.from(otaAuthLine(token), 'ascii'));
    const auth = await reader.waitLine(
      l => l === 'AUTH OK' || l === 'AUTH ERR', AUTH_TIMEOUT_MS, 'OTA auth');
    if (auth !== 'AUTH OK') {
      throw new Error(`OTA device at ${address} rejected the token (AUTH ERR)`);
    }
  } catch (err) {
    socket.destroy();
    throw err;
  }
  const awaitReload = async (sent, kind = 'command') => {
    const line = await reader.waitLine(l => RELOAD_LINE.test(l),
                                      ACK_TIMEOUT_MS, 'OTA reload ACK');
    const m = /^RELOAD (OK (\d+)|ERR (\S+))$/.exec(line);
    if (!m) throw new Error(`unexpected OTA reply: ${line}`);
    if (m[2]) {
      const received = Number(m[2]);
      if (sent !== null && received !== sent) {
        throw new Error(`OTA ACK length mismatch: ${received} != ${sent}`);
      }
      return received;
    }
    throw new Error(kind === 'bundle'
      ? `device rejected bundle: ${m[3]}`
      : `device rejected: ${m[3]}`);
  };
  return {
    address,
    async push(source) {
      const bytes = frame(source);
      await write(bytes);
      await awaitReload(bytes.length - 12, 'bundle');
    },
    /** Command frame answered by CMD OK/ERR (store/list/remove/meta). */
    async command(text) {
      await write(cmdFrame(text));
      const lines = [];
      for (;;) {
        const line = await reader.waitLine(
          l => LIST_LINE.test(l) || CMD_LINE.test(l), ACK_TIMEOUT_MS,
          'OTA command ACK');
        if (LIST_LINE.test(line)) { lines.push(line); continue; }
        const err = CMD_ERR_LINE.exec(line);
        if (err) throw new Error(`device rejected command: ${err[1]}`);
        const ok = CMD_OK_LINE.exec(line);
        if (!ok) throw new Error(`unexpected OTA reply: ${line}`);
        const verb = ok[1] ?? '';
        const arg = ok[2] ?? '';
        // LIST answers "CMD OK list <count>", where the count sits in the arg
        // slot because a list has no id.
        const count = ok[3] !== undefined ? Number(ok[3])
          : verb === 'list' && arg !== '' ? Number(arg) : null;
        return { verb, arg, count, lines };
      }
    },
    /** Command frame answered by the engine's RELOAD OK/ERR (launch/home). */
    async commandReload(text) {
      await write(cmdFrame(text));
      return awaitReload(null);   // the launched app reports its own length
    },
    write,
    close: () => new Promise(resolve => { socket.destroy(); resolve(); }),
  };
}
