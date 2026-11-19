'use strict';
/* Voice gateway: WS server + per-device session manager + protocol enforcement.
 * Zero runtime dependencies (vendored ws.js). See docs/voice-gateway-protocol.md. */

const http = require('node:http');
const crypto = require('node:crypto');
const { attachWsServer, encodeFrame } = require('./ws');
const { MockUpstream } = require('./upstream');

const PROTOCOL_VERSION = 1;
const UPLINK_BYTES = 3840;            /* 60 ms, 16 kHz, s16le stereo */
const AUDIO_FRAME_BYTES = 3840;       /* 8-byte header + 3840 payload = 3848 */
const AUDIO_HEADER_LENGTH = 8;
const MAX_PAYLOAD = 65536;

const CLOSE_FOR_ERROR = {
  bad_json: 1002,
  not_hello: 1008,
  bad_hello: 1008,
  unsupported_version: 1008,
  unauthorized: 1008,          /* r119: device shared-token gate (§8.2) */
  bad_audio_frame: 1009,
  upstream_closed: 1011,
  upstream_error: 1011
};

/* r119: constant-time compare for the shared device token. Both inputs are
 * non-empty strings at the call site; length mismatch short-circuits before
 * timingSafeEqual (which throws on unequal lengths). */
function tokenEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); }
  catch (e) { return false; }
}

const ascii = (s) => String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, '?');

class DeviceSession {
  constructor(gateway, conn) {
    this.gateway = gateway;
    this.conn = conn;
    this.deviceToken = gateway.deviceToken || '';   /* r119: '' = open LAN mode */
    this.sessionId = 's' + (++gateway.counter.value);
    this.phase = 'await-hello';
    this.upstream = null;
    this.upstreamStopped = false;
    this.api = null;
    this.audioFramesIn = 0;
    this.audioBytesIn = 0;
    this.textDeltasOut = 0;
    this.transcriptDeltasOut = 0;       /* r117: independent from text-delta */
    this.audioFramesOut = 0;
    this.deltaSeq = -1;
    this.transcriptSeq = -1;            /* r117: transcript-delta own seq */
    this.audioSeq = -1;
    this.deviceCaps = null;             /* r117: hello.caps, read by upstream start() */
    this.closeCode = null;
    this.closeReason = null;
    gateway.sessions.push(this);
    conn.on('message', (m) => this._onMessage(m));
    conn.on('close', (code, reason) => {
      this.closeCode = code;
      this.closeReason = this.closeReason || reason || 'peer';
      this._stopUpstream();
      this._log('session.close', { code });
    });
  }

  _log(event, fields = {}) {
    this.gateway.log(event, Object.assign({ sessionId: this.sessionId }, fields));
  }

  _ctrl(fields) {
    if (this.conn.closeSent) return;
    this.conn.sendText(JSON.stringify(Object.assign(
      { v: PROTOCOL_VERSION, sessionId: this.sessionId }, fields)));
  }

  _error(code, message, fatal) {
    if (this.conn.closeSent) return;
    this._log('protocol.error', { code, message: ascii(message), fatal });
    this._ctrl({ type: 'error', code, message: ascii(message), fatal });
    if (fatal) {
      this._stopUpstream();
      this.conn.close(CLOSE_FOR_ERROR[code] || 1011, code);
      this.closeReason = code;
    }
  }

  _sessionApi() {
    if (this.api) return this.api;
    const self = this;
    this.api = {
      sessionId: this.sessionId,
      get caps() { return self.deviceCaps; },   /* r117: hello caps for ASR negotiation */
      sendTextDelta(text, final = false) {
        if (self.conn.closeSent) return;
        self.deltaSeq = (self.deltaSeq + 1) & 0xffff;
        self.textDeltasOut++;
        self._ctrl({ type: 'text-delta', seq: self.deltaSeq, text: String(text), final: !!final });
      },
      /* r117 v1.1: user-speech transcript. seq is independent of text-delta /
       * audio; final=true is the single finalized transcript (not an increment). */
      sendTranscriptDelta(text, final = false) {
        if (self.conn.closeSent) return;
        self.transcriptSeq = (self.transcriptSeq + 1) & 0xffff;
        self.transcriptDeltasOut++;
        self._ctrl({ type: 'transcript-delta', seq: self.transcriptSeq,
          text: String(text), final: !!final });
      },
      sendAudio(fmt, pcm) {
        if (self.conn.closeSent) return;
        if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length > 4608 || (pcm.length & 3)) {
          throw new Error('bad downlink pcm: expected 4-aligned 1..4608 bytes');
        }
        const f = fmt || {};
        const head = Buffer.alloc(AUDIO_HEADER_LENGTH);
        head[0] = PROTOCOL_VERSION;
        head[1] = 1;                              /* audio */
        head[2] = f.format == null ? 1 : f.format; /* pcm_s16le */
        head.writeUInt16LE(f.sampleRate == null ? 16000 : f.sampleRate, 3);
        head[5] = f.channels == null ? 2 : f.channels;
        head[6] = f.bits == null ? 16 : f.bits;
        head[7] = (self.audioSeq + 1) & 0xff;
        self.audioSeq = head[7];
        self.audioFramesOut++;
        self.conn.sendRaw(encodeFrame(0x2, Buffer.concat([head, pcm]), { mask: false }));
      },
      sendState(state) { self._ctrl({ type: 'state', state: String(state) }); },
      sendError(code, message, fatal) { self._error(code, message, !!fatal); },
      isOpen() { return !self.conn.closeSent && !self.conn.closed; },
      close(code = 1000, reason = 'done') {
        self._stopUpstream();
        if (!self.conn.closeSent) {
          self.conn.close(code, ascii(reason));
          self.closeReason = ascii(reason);
        }
      },
      log(...parts) { self._log('adapter', { message: ascii(parts.map(String).join(' ')) }); }
    };
    return this.api;
  }

  _stopUpstream() {
    if (this.upstreamStopped || !this.upstream) return;
    this.upstreamStopped = true;
    if (typeof this.upstream.stop === 'function') {
      try { this.upstream.stop(); }
      catch (e) { this._log('upstream.stop.error', { error: ascii(e.message) }); }
    }
  }

  _startUpstream() {
    try {
      this.upstream = this.gateway.upstreamFactory(this._sessionApi());
      if (!this.upstream || typeof this.upstream.start !== 'function') {
        throw new Error('adapter missing start()');
      }
      this.upstream.start(this._sessionApi());
    } catch (e) {
      this._error('upstream_error', 'start failed: ' + e.message, true);
    }
  }

  _onMessage(m) {
    if (this.conn.closeSent) return;
    if (m.binary) {
      if (this.phase !== 'active') { this._error('not_hello', 'data before hello', true); return; }
      if (m.data.length !== UPLINK_BYTES) {
        this._error('bad_audio_frame', 'expected 3840 bytes got ' + m.data.length, true);
        return;
      }
      this.audioFramesIn++;
      this.audioBytesIn += m.data.length;
      try { this.upstream.sendAudio(m.data); }
      catch (e) { this._error('upstream_error', 'sendAudio failed: ' + e.message, true); return; }
      this._log('uplink.pcm', { bytes: m.data.length, frames: this.audioFramesIn });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(m.data);
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('not an object');
    } catch (e) { this._error('bad_json', 'invalid json control frame', true); return; }

    if (this.phase === 'await-hello') {
      if (msg.type !== 'hello') { this._error('not_hello', 'first frame must be hello', true); return; }
      if (msg.v !== PROTOCOL_VERSION) { this._error('unsupported_version', 'v=' + String(msg.v), true); return; }
      /* r119 §8.2: device token gate runs AFTER version validation and BEFORE
       * hello-ack / phase flip / upstream adapter init. No configured token
       * skips the check, so open LAN mode is byte-for-byte unchanged. */
      if (this.deviceToken) {
        const auth = (msg.auth && typeof msg.auth === 'object' && !Array.isArray(msg.auth))
          ? msg.auth : null;
        const supplied = auth && typeof auth.token === 'string' ? auth.token : '';
        if (!supplied || !tokenEqual(supplied, this.deviceToken)) {
          this._error('unauthorized',
            supplied ? 'device token mismatch' : 'device token required', true);
          return;
        }
      }
      this.phase = 'active';
      this.deviceCaps = (msg.caps && typeof msg.caps === 'object' && !Array.isArray(msg.caps))
        ? msg.caps : null;
      this._ctrl({ type: 'hello-ack', audioFormat: 'pcm_s16le_16000_2ch' });
      this._log('hello', { device: msg.device ? ascii(JSON.stringify(msg.device)) : '-',
        streamTranscript: !!(this.deviceCaps && this.deviceCaps.streamTranscript) });
      this._startUpstream();
      return;
    }

    if (msg.v !== PROTOCOL_VERSION) { this._error('unsupported_version', 'v=' + String(msg.v), true); return; }
    switch (msg.type) {
      case 'text':
        if (typeof this.upstream.sendText === 'function') {
          try { this.upstream.sendText(String(msg.text == null ? '' : msg.text)); }
          catch (e) { this._error('upstream_error', 'sendText failed: ' + e.message, false); }
        } else {
          this._error('unsupported_text_input', 'upstream has no sendText', false);
        }
        break;
      case 'end':
        this._log('turn.end', {});
        this._stopUpstream();
        break;
      case 'ping':
        this._ctrl({ type: 'pong' });
        break;
      default:
        this._error('unknown_type', 'type=' + String(msg.type), false);
    }
  }
}

function createGateway(opts = {}) {
  const port = opts.port == null ? 8765 : opts.port;
  const host = opts.host || '127.0.0.1';
  const log = opts.log || (() => {});
  const upstreamFactory = opts.upstreamFactory || ((session) => new MockUpstream());
  /* r119: only a non-empty string engages the device token gate. Kept as a
   * local (not a field on the public gateway object) so it cannot be logged
   * by a stray JSON.stringify(gateway). */
  const deviceToken = typeof opts.deviceToken === 'string' ? opts.deviceToken : '';
  const sessions = [];
  const counter = { value: 0 };

  const httpServer = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found\n');
  });
  const manager = attachWsServer(httpServer, {
    maxPayload: MAX_PAYLOAD,
    log,
    onConnection: (conn) => { new DeviceSession({ counter, sessions, log, upstreamFactory, deviceToken }, conn); }
  });

  const gateway = {
    sessions,
    address: () => httpServer.address(),
    upstreamFactory,
    log,
    counter,
    start() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener('error', reject);
          log('gateway.listen', { host, port: httpServer.address().port });
          resolve(gateway);
        });
      });
    },
    close() {
      manager.closeAll(1001, 'gateway-shutdown');
      return new Promise((resolve) => {
        if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
        httpServer.close(() => { log('gateway.closed', {}); resolve(); });
      });
    }
  };
  return gateway;
}

module.exports = {
  createGateway, DeviceSession,
  PROTOCOL_VERSION, UPLINK_BYTES, AUDIO_FRAME_BYTES, AUDIO_HEADER_LENGTH,
  CLOSE_FOR_ERROR
};
