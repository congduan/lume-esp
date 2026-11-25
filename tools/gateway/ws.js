'use strict';
/* Minimal RFC 6455 framing + server handshake. Vendored, zero dependencies.
 * Only what the gateway needs: text/binary/close/ping frames, client masking,
 * 7/16/64-bit lengths, 64 KiB payload cap. No permessage-deflate, no TLS
 * (TLS terminates at a reverse proxy in a later round if needed). */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAccept(key) {
  return crypto.createHash('sha1').update(key + GUID, 'binary').digest('base64');
}

function authorized(req, token) {
  if (!token) return true;
  let queryToken = '';
  try { queryToken = new URL(req.url, 'http://gateway.invalid').searchParams.get('token') || ''; }
  catch (_) { return false; }
  const authorization = req.headers.authorization || '';
  const bearer = /^Bearer (.+)$/i.exec(authorization);
  const supplied = bearer ? bearer[1] : (req.headers['x-gateway-token'] || queryToken);
  if (typeof supplied !== 'string') return false;
  const expectedHash = crypto.createHash('sha256').update(token).digest();
  const suppliedHash = crypto.createHash('sha256').update(supplied).digest();
  return crypto.timingSafeEqual(expectedHash, suppliedHash);
}

function closePayload(code, reason) {
  const text = Buffer.from(String(reason || ''), 'ascii').subarray(0, 123);
  const out = Buffer.allocUnsafe(2 + text.length);
  out.writeUInt16BE(code, 0);
  text.copy(out, 2);
  return out;
}

/* fin/opcode/mask in, wire frame out. mask=true for client->server frames. */
function encodeFrame(opcode, payload, opts = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload == null ? '' : payload));
  const len = data.length;
  const finBit = opts.fin === false ? 0 : 0x80;
  const maskBit = opts.mask ? 0x80 : 0;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(opts.mask ? 6 : 2);
    header[1] = maskBit | len;
  } else if (len <= 0xffff) {
    header = Buffer.allocUnsafe(opts.mask ? 8 : 4);
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(opts.mask ? 14 : 10);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = finBit | (opcode & 0x0f);
  let body = data;
  if (opts.mask) {
    const key = crypto.randomBytes(4);
    key.copy(header, header.length - 4);
    body = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) body[i] = data[i] ^ key[i & 3];
  }
  return Buffer.concat([header, body]);
}

/* Returns { frames, consumed, error }. error: 'bad-mask' | 'too-big' | null.
 * Incomplete frames are left buffered (consumed stops before them). */
function parseFrames(buf, opts = {}) {
  const expectMasked = !!opts.expectMasked;
  const maxPayload = opts.maxPayload || 65536;
  const frames = [];
  let off = 0;
  for (;;) {
    const avail = buf.length - off;
    if (avail < 2) break;
    const b0 = buf[off], b1 = buf[off + 1];
    const fin = !!(b0 & 0x80), opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    if (masked !== expectMasked) return { frames, consumed: off, error: 'bad-mask' };
    let len = b1 & 0x7f, hdr = 2;
    if (len === 126) {
      if (avail < 4) break;
      len = buf.readUInt16BE(off + 2); hdr = 4;
    } else if (len === 127) {
      if (avail < 10) break;
      const big = buf.readBigUInt64BE(off + 2);
      if (big > BigInt(maxPayload)) return { frames, consumed: off, error: 'too-big' };
      len = Number(big); hdr = 10;
    }
    if (len > maxPayload) return { frames, consumed: off, error: 'too-big' };
    const maskBytes = masked ? 4 : 0;
    if (avail < hdr + maskBytes + len) break;
    let mask = null;
    let start = off + hdr;
    if (masked) { mask = buf.subarray(start, start + 4); start += 4; }
    const payload = Buffer.from(buf.subarray(start, start + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    frames.push({ fin, opcode, payload });
    off = start + len;
  }
  return { frames, consumed: off, error: null };
}

class WsConnection extends EventEmitter {
  constructor(socket, opts = {}) {
    super();
    this.socket = socket;
    this.expectMasked = opts.expectMasked !== false;
    this.maxPayload = opts.maxPayload || 65536;
    this.log = opts.log || (() => {});
    this.buf = Buffer.alloc(0);
    this.closeSent = false;
    this.closed = false;
    this.fragOp = 0;
    this.fragments = [];
    socket.setNoDelay(true);  /* streaming PCM: never batch small frames */
    socket.on('data', (d) => this.feed(d));
    socket.on('error', (e) => { this.log('ws.socket.error', { error: e.code || e.message }); this._emitClose(1006); });
    socket.on('close', () => this._emitClose(1006));
  }

  _emitClose(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, reason || '');
  }

  feed(chunk) {
    if (this.closed || this.closeSent) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const parsed = parseFrames(this.buf, { expectMasked: this.expectMasked, maxPayload: this.maxPayload });
    if (parsed.consumed) this.buf = this.buf.subarray(parsed.consumed);
    if (parsed.error) { this.fail(1002, parsed.error); return; }
    for (const f of parsed.frames) this._handle(f);
  }

  _handle(f) {
    if (this.closeSent) return;
    const op = f.opcode;
    if (op === 0x8) {
      const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000;
      const reason = f.payload.subarray(2).toString('ascii');
      this.closeSent = true;
      try { this.socket.write(encodeFrame(0x8, f.payload.subarray(0, Math.min(125, f.payload.length)), { mask: false })); } catch (e) { /* best effort echo */ }
      this.socket.end();
      this._emitClose(code, reason);
      return;
    }
    if (op === 0x9) { this.sendRaw(encodeFrame(0xa, f.payload, { mask: false })); return; }
    if (op === 0xa) return;
    if (op !== 0x0 && op !== 0x1 && op !== 0x2) { this.fail(1002, 'bad-opcode'); return; }
    if (op === 0x0) {
      if (!this.fragOp) { this.fail(1002, 'bad-continuation'); return; }
      this.fragments.push(f.payload);
      if (f.fin) {
        const full = Buffer.concat(this.fragments);
        const saved = this.fragOp;
        this.fragOp = 0; this.fragments = [];
        this._deliver(saved, full);
      }
      return;
    }
    if (this.fragOp) { this.fail(1002, 'bad-fragment'); return; }
    if (f.fin) this._deliver(op, f.payload);
    else { this.fragOp = op; this.fragments = [f.payload]; }
  }

  _deliver(op, payload) {
    /* Text arrives as string, binary as Buffer; mirrors lume.net.ws onMessage. */
    this.emit('message', { binary: op === 2, data: op === 2 ? payload : payload.toString('utf8') });
  }

  sendRaw(wire) {
    if (this.closeSent || this.socket.destroyed) return;
    this.socket.write(wire);
  }

  sendText(text) { this.sendRaw(encodeFrame(0x1, text, { mask: false })); }
  sendBinary(buf) { this.sendRaw(encodeFrame(0x2, buf, { mask: false })); }

  sendClose(code, reason) {
    if (this.closeSent) return;
    this.closeSent = true;
    try { this.socket.write(encodeFrame(0x8, closePayload(code, reason), { mask: false })); } catch (e) { /* ignore */ }
    this.socket.end();
    this._emitClose(code, reason);
  }

  fail(code, reason) { this.sendClose(code, reason); }
  close(code = 1000, reason = 'done') { this.sendClose(code, reason); }
  destroy() { this.socket.destroy(); }
}

/* Attach upgrade handling to an http.Server. Returns a small connection manager. */
function attachWsServer(httpServer, opts = {}) {
  const clients = new Set();
  const log = opts.log || (() => {});
  httpServer.on('upgrade', (req, socket, head) => {
    if (!authorized(req, opts.token)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' ||
        req.headers['sec-websocket-version'] !== '13' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + computeAccept(key) + '\r\n\r\n');
    const conn = new WsConnection(socket, {
      expectMasked: true,
      maxPayload: opts.maxPayload || 65536,
      log
    });
    clients.add(conn);
    conn.on('close', () => clients.delete(conn));
    if (head && head.length) conn.feed(head);
    if (opts.onConnection) opts.onConnection(conn, req);
  });
  return {
    clients,
    closeAll(code = 1001, reason = 'gateway-shutdown') {
      for (const c of [...clients]) { c.sendClose(code, reason); c.destroy(); }
    }
  };
}

module.exports = { computeAccept, encodeFrame, parseFrames, closePayload, WsConnection, attachWsServer };
