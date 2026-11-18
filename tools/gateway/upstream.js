'use strict';
/* Pluggable upstream adapter interface + mock implementation.
 *
 * Interface (see docs/voice-gateway-protocol.md section 8):
 *   start(session)      begin a turn, emit progress via session.*
 *   sendAudio(pcm)      receive one 3840-byte uplink PCM frame (Buffer)
 *   sendText?(text)     optional: receive a device text control frame
 *   stop()              advisory release of upstream capture resources;
 *                       idempotent, MUST NOT cancel an in-flight response,
 *                       MUST NOT call session.close() (gateway owns the socket)
 *
 * Real upstreams are TODO stubs. Upstream selection is explicitly undecided
 * this round; no API keys, credentials, or guessed third-party endpoints here. */

const UPLINK_FRAMES = 960;       /* 60 ms at 16 kHz */
const UPLINK_BYTES = UPLINK_FRAMES * 4; /* stereo s16le = 3840 */
const FORMAT = Object.freeze({ format: 1, sampleRate: 16000, channels: 2, bits: 16 });

function synthPcm(frameIndex, mode) {
  const buf = Buffer.alloc(UPLINK_BYTES);
  if (mode === 'silence') return buf;
  for (let i = 0; i < UPLINK_FRAMES; i++) {
    const v = Math.round(4000 * Math.sin(2 * Math.PI * 440 * (frameIndex * UPLINK_FRAMES + i) / 16000));
    buf.writeInt16LE(v, i * 4);
    buf.writeInt16LE(v, i * 4 + 2);
  }
  return buf;
}

class MockUpstream {
  constructor(opts = {}) {
    this.answer = opts.answer || 'HELLO FROM THE MOCK GATEWAY.';
    this.audioFrames = opts.audioFrames == null ? 3 : opts.audioFrames;
    this.fail = !!opts.fail;
    this.delayMs = opts.delayMs == null ? 40 : opts.delayMs;
    this.session = null;
    this.started = false;
    this.stopped = false;
    this.audioFramesIn = 0;
    this.audioBytesIn = 0;
    this.textIn = null;
    this.timer = null;
  }

  start(session) {
    this.session = session;
    this.started = true;
    session.sendState('thinking');
    /* Defer the canned response so the device's uplink frames are processed
     * before the gateway completes the turn (real upstreams are async too). */
    this.timer = setTimeout(() => this._respond(), this.delayMs);
  }

  _respond() {
    this.timer = null;
    const session = this.session;
    if (!session || (session.isOpen && !session.isOpen())) return;
    const chars = Array.from(this.answer);
    if (this.fail) {
      /* Partial stream, then a simulated upstream disconnect. */
      for (const ch of chars.slice(0, 3)) session.sendTextDelta(ch, false);
      session.sendError('upstream_closed', 'mock upstream disconnected', true);
      return;
    }
    for (const ch of chars) session.sendTextDelta(ch, false);
    session.sendState('speaking');
    for (let f = 0; f < this.audioFrames; f++) {
      session.sendAudio(FORMAT, synthPcm(f, f % 2 === 0 ? 'sine' : 'silence'));
    }
    session.sendTextDelta('', true);
    session.sendState('idle');
    session.close(1000, 'done');
  }

  sendAudio(pcm) {
    this.audioFramesIn++;
    this.audioBytesIn += pcm.length;
  }

  sendText(text) { this.textIn = String(text); }

  stop() { this.stopped = true; }
}

/* TODO(r107): xiaozhi official upstream (WS + Opus 60 ms -> PCM translation).
 * Not implemented: upstream selection is pending a product decision. */
class XiaozhiUpstream {
  start() { throw new Error('NOT_IMPLEMENTED xiaozhi upstream start (r107 TODO)'); }
  sendAudio() { throw new Error('NOT_IMPLEMENTED xiaozhi upstream sendAudio (r107 TODO)'); }
  stop() { /* reserved */ }
}

/* TODO(r107): direct ASR/LLM/TTS three-service upstream. Not implemented. */
class DirectStackUpstream {
  start() { throw new Error('NOT_IMPLEMENTED direct ASR/LLM/TTS start (r107 TODO)'); }
  sendAudio() { throw new Error('NOT_IMPLEMENTED direct ASR/LLM/TTS sendAudio (r107 TODO)'); }
  stop() { /* reserved */ }
}

function createUpstream(name, opts = {}) {
  switch (name) {
    case 'mock': return new MockUpstream(opts);
    case 'xiaozhi': return new XiaozhiUpstream();
    case 'direct': return new DirectStackUpstream();
    default: throw new Error('unknown upstream: ' + name);
  }
}

module.exports = {
  FORMAT, UPLINK_BYTES, synthPcm,
  MockUpstream, XiaozhiUpstream, DirectStackUpstream, createUpstream
};
