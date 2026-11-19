'use strict';
/* Minimal device-side WS client used by the host harness and the smoke simulator.
 * Callback shape mirrors runtime/types/lume.d.ts namespace ws:
 *   onOpen(), onMessage(string|Buffer), onClose(), onError(number)
 * where a Buffer is the host analog of the device's ArrayBuffer. Zero deps. */

const net = require('node:net');
const crypto = require('node:crypto');
const { computeAccept, encodeFrame, parseFrames } = require('./ws');

/* r117: optional `headers` are extra handshake headers (e.g. upstream ASR
 * bearer auth). Names/values are restricted to ASCII to prevent header
 * injection; callers must not put secrets in URLs or logs. */
function extraHeaders(headers) {
  let out = '';
  for (const name of Object.keys(headers || {})) {
    const value = String(headers[name]);
    if (/^[A-Za-z0-9-]+$/.test(name) && /^[\x20-\x7e]*$/.test(value)) {
      out += name + ': ' + value + '\r\n';
    }
  }
  return out;
}

function connect(url, callbacks = {}, headers = {}) {
  const u = new URL(url);
  const port = Number(u.port || 80);
  const key = crypto.randomBytes(16).toString('base64');
  const client = {
    socket: null,
    opened: false,
    closed: false,
    _buf: Buffer.alloc(0),
    _handshaken: false,
    sendText(text) { this._wire(encodeFrame(0x1, text, { mask: true })); },
    sendBinary(buf) { this._wire(encodeFrame(0x2, buf, { mask: true })); },
    raw(wire) { if (this.socket && !this.socket.destroyed) this.socket.write(wire); },
    close(code = 1000, reason = 'bye') {
      if (this.closed) return;
      this._wire(encodeFrame(0x8, (() => {
        const b = Buffer.alloc(2 + Buffer.byteLength(String(reason), 'ascii'));
        b.writeUInt16BE(code, 0);
        b.write(String(reason), 2, 'ascii');
        return b;
      })(), { mask: true }));
      if (this.socket) this.socket.end();
    },
    _wire(wire) { if (this.socket && !this.socket.destroyed) this.socket.write(wire); },
    _fail(code) { if (!this.closed) { this.closed = true; if (callbacks.onError) callbacks.onError(code); } }
  };

  const socket = net.connect({ host: u.hostname, port }, () => {
    socket.write('GET ' + (u.pathname || '/') + (u.search || '') + ' HTTP/1.1\r\n' +
      'Host: ' + u.host + '\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n' + extraHeaders(headers) + '\r\n');
  });
  client.socket = socket;
  socket.setNoDelay(true);

  socket.on('error', () => client._fail(2));
  socket.on('data', (chunk) => {
    if (client.closed) return;
    client._buf = Buffer.concat([client._buf, chunk]);
    if (!client._handshaken) {
      const at = client._buf.indexOf('\r\n\r\n');
      if (at < 0) return;
      const head = client._buf.subarray(0, at).toString('latin1');
      if (!/^HTTP\/1\.1 101 /.test(head)) { client._fail(1); socket.destroy(); return; }
      const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
      if (!accept || accept[1] !== computeAccept(key)) { client._fail(1); socket.destroy(); return; }
      client._handshaken = true;
      client._buf = client._buf.subarray(at + 4);
      client.opened = true;
      if (callbacks.onOpen) callbacks.onOpen(client);
    }
    const parsed = parseFrames(client._buf, { expectMasked: false });
    if (parsed.consumed) client._buf = client._buf.subarray(parsed.consumed);
    if (parsed.error) { client._fail(1); socket.destroy(); return; }
    for (const f of parsed.frames) {
      if (f.opcode === 0x8) {
        client.closed = true;
        if (callbacks.onClose) callbacks.onClose();
        socket.end();
      } else if (f.opcode === 0x9) {
        client._wire(encodeFrame(0xa, f.payload, { mask: true }));
      } else if (f.opcode === 0x1 || f.opcode === 0x2 || f.opcode === 0x0) {
        if (callbacks.onMessage) callbacks.onMessage(f.opcode === 2 ? f.payload : f.payload.toString('utf8'));
      }
    }
  });
  socket.on('close', () => {
    if (!client.closed) {
      client.closed = true;
      if (callbacks.onClose) callbacks.onClose();
    }
  });
  return client;
}

module.exports = { connect };
