'use strict';
/* OpenAI-compatible three-segment upstream adapter (stt -> chat -> tts).
 *
 * Zero new npm dependencies: uses Node 18+ global fetch / FormData / Blob /
 * AbortController. Same surface as MockUpstream (see upstream.js):
 *   start(session)     begin a turn; emits state=thinking
 *   sendAudio(pcm)     accumulate one 3840-byte uplink frame (16 kHz stereo s16le)
 *   sendText?(text)    optional device text input, folded into the chat user message
 *   stop()             advisory round finalize; idempotent, never cancels an
 *                      in-flight response, never calls session.close()
 *
 * Turn收口 decision (evidence from server.js + protocol v1):
 *   - server.js calls stop() from _stopUpstream() on the `end` control frame
 *     (server.js:182-185), on session close (conn 'close', server.js:46-51) and
 *     on fatal error (server.js:64-72). Protocol §4.6 says stop() is exactly the
 *     "收口本轮" hook and downstream text/audio may continue afterwards.
 *   - Therefore stop() is used as the trigger to START the one-shot pipe, but
 *     ONLY when (a) it has not already started, (b) the session is still open
 *     (guards the device-close / fatal paths) and (c) audio was captured.
 *   - Because stop() must not close the socket and may fire with no audio, a
 *     silence timer (reset on each uplink frame) is the fallback for devices
 *     that stream but never send `end`. Rationale recorded in docs.
 *
 * Error discipline: 30 s AbortController timeout per segment, at most one retry
 * (1 s gap) for transient faults, then state=idle + error. No retry storm. */

const UPLINK_FRAMES = 960;                       /* 60 ms @ 16 kHz */
const UPLINK_BYTES = UPLINK_FRAMES * 4;           /* stereo s16le = 3840 */
const FORMAT = Object.freeze({ format: 1, sampleRate: 16000, channels: 2, bits: 16 });

const ascii = (s) => String(s == null ? '' : s).replace(/[^\x20-\x7e]/g, '?');
const clamp16 = (v) => v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function joinUrl(base, path) {
  return String(base == null ? '' : base).replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
}

/* 16 kHz stereo s16le -> 44-byte mono 16 kHz 16-bit WAV (downmix L+R average). */
function pcm16StereoToWav(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 4 || (pcm.length & 3)) {
    throw new Error('bad stereo pcm: expected 4-aligned >=4 bytes');
  }
  const frames = pcm.length / 4;
  const dataSize = frames * 2;                    /* mono s16 */
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);                      /* PCM fmt chunk size */
  buf.writeUInt16LE(1, 20);                       /* audio format = PCM */
  buf.writeUInt16LE(1, 22);                       /* channels = mono */
  buf.writeUInt32LE(16000, 24);                   /* sample rate */
  buf.writeUInt32LE(32000, 28);                   /* byte rate = 16000*1*2 */
  buf.writeUInt16LE(2, 32);                       /* block align */
  buf.writeUInt16LE(16, 34);                      /* bits per sample */
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const l = pcm.readInt16LE(i * 4);
    const r = pcm.readInt16LE(i * 4 + 2);
    buf.writeInt16LE(clamp16(Math.round((l + r) / 2)), 44 + i * 2);
  }
  return buf;
}

/* 24 kHz mono s16le -> 16 kHz stereo s16le via linear interpolation.
 * outSamples = floor(inSamples * 16000/24000); each source position = i*1.5. */
function resample24kMonoTo16kStereo(pcm) {
  if (!Buffer.isBuffer(pcm) || (pcm.length & 1)) {
    throw new Error('bad mono pcm: expected even byte length');
  }
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.floor(inSamples * 16000 / 24000);
  const out = Buffer.alloc(outSamples * 4);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * 1.5;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(Math.min(i0 + 1, inSamples - 1) * 2);
    const v = clamp16(Math.round(s0 + (s1 - s0) * frac));
    out.writeInt16LE(v, i * 4);                   /* L */
    out.writeInt16LE(v, i * 4 + 2);               /* R (mono duplicated) */
  }
  return out;
}

/* Split PCM into 3840-byte downlink frames; zero-pad a short tail. */
function chunkPcm(buf, frameBytes = UPLINK_BYTES) {
  const out = [];
  if (!Buffer.isBuffer(buf) || buf.length === 0) return out;
  for (let off = 0; off < buf.length; off += frameBytes) {
    let chunk = buf.subarray(off, Math.min(off + frameBytes, buf.length));
    if (chunk.length < frameBytes) {
      const padded = Buffer.alloc(frameBytes);
      chunk.copy(padded);
      chunk = padded;
    }
    out.push(Buffer.from(chunk));
  }
  return out;
}

/* Sentence-aware, fixed-cap text delta split. Concatenation === input. */
function splitTextDeltas(text, maxChars = 24) {
  const chars = Array.from(String(text == null ? '' : text));
  const out = [];
  let cur = '';
  for (const ch of chars) {
    cur += ch;
    if (/[.!?。！？]/.test(ch) || Array.from(cur).length >= maxChars) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

const RETRYABLE_STATUS = (s) => s === 429 || s >= 500;

class OpenAICompatibleUpstream {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
    this.chatBaseUrl = opts.chatBaseUrl || '';     /* optional independent LLM endpoint */
    this.apiKey = opts.apiKey || '';
    this.sttModel = opts.sttModel || 'whisper-1';
    this.chatModel = opts.chatModel || 'gpt-4o-mini';
    this.ttsModel = opts.ttsModel || 'tts-1';
    this.voice = opts.voice || 'alloy';
    this.systemPrompt = opts.systemPrompt ||
      'You are a concise voice assistant. Answer in short plain sentences.';
    this.timeoutMs = opts.timeoutMs == null ? 30000 : opts.timeoutMs;
    this.retryDelayMs = opts.retryDelayMs == null ? 1000 : opts.retryDelayMs;
    this.silenceTimeoutMs = opts.silenceTimeoutMs == null ? 3000 : opts.silenceTimeoutMs;
    this.deltaMaxChars = opts.deltaMaxChars == null ? 24 : opts.deltaMaxChars;

    this.session = null;
    this.started = false;
    this.pipeStarted = false;
    this.stopped = false;
    this.parts = [];
    this.audioBytesIn = 0;
    this.audioFramesIn = 0;
    this.deviceText = '';
    this.silenceTimer = null;
    this._abort = null;
  }

  /* ---- upstream interface ------------------------------------------------ */
  start(session) {
    this.session = session;
    this.started = true;
    session.sendState('thinking');
    this._armSilenceTimer();
  }

  sendAudio(pcm) {
    if (!this.started || this.pipeStarted) return;
    if (!Buffer.isBuffer(pcm) || pcm.length !== UPLINK_BYTES) return; /* gateway already validates */
    this.parts.push(Buffer.from(pcm));
    this.audioBytesIn += pcm.length;
    this.audioFramesIn++;
    this._armSilenceTimer();
  }

  sendText(text) { this.deviceText = String(text == null ? '' : text); }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this._clearSilenceTimer();
    /* stop() is advisory: never cancel a pipe already in flight. */
    if (this.pipeStarted) return;
    /* Device-close and fatal-error paths also call stop(); the socket is gone,
     * so do not start a response there. */
    if (!this.session || typeof this.session.isOpen !== 'function' || !this.session.isOpen()) return;
    if (this.audioFramesIn === 0) {
      this.session.sendState('idle');              /* nothing captured: end quietly */
      return;
    }
    this._finalize();
  }

  /* ---- timers ------------------------------------------------------------ */
  _armSilenceTimer() {
    this._clearSilenceTimer();
    if (this.pipeStarted || this.stopped) return;
    const self = this;
    this.silenceTimer = setTimeout(() => {
      self.silenceTimer = null;
      if (self.pipeStarted || self.stopped) return;
      if (self.audioFramesIn === 0) return;
      if (!self.session || typeof self.session.isOpen === 'function' && !self.session.isOpen()) return;
      self._finalize();
    }, this.silenceTimeoutMs);
    if (this.silenceTimer.unref) this.silenceTimer.unref();
  }

  _clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /* ---- HTTP plumbing ----------------------------------------------------- */
  async _request(stage, url, options, kind) {
    const ctrl = new AbortController();
    this._abort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal }, options));
      if (!res.ok) {
        let body = '';
        try { body = (await res.text()).slice(0, 512); } catch (_) { /* ignore */ }
        const e = new Error(stage + ' HTTP ' + res.status + (body ? ': ' + ascii(body) : ''));
        e.status = res.status;
        e.retryable = RETRYABLE_STATUS(res.status);
        throw e;
      }
      if (kind === 'json') return await res.json();
      if (kind === 'buffer') return Buffer.from(await res.arrayBuffer());
      return res;
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
        const te = new Error(stage + ' timeout after ' + this.timeoutMs + 'ms');
        te.timeout = true;
        te.retryable = true;
        throw te;
      }
      if (e && typeof e.retryable === 'boolean') throw e; /* our own HTTP error */
      const ne = new Error(stage + ' network error: ' + ascii(e && e.message));
      ne.network = true;
      ne.retryable = true;
      throw ne;
    } finally {
      clearTimeout(timer);
      if (this._abort === ctrl) this._abort = null;
    }
  }

  async _withRetry(stage, fn) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await fn(); }
      catch (e) {
        last = e;
        if (!e || !e.retryable || attempt === 1) break;
        if (this.session && typeof this.session.log === 'function') {
          this.session.log('openai.retry', stage, 'attempt=2');
        }
        await sleep(this.retryDelayMs);
      }
    }
    throw last;
  }

  /* ---- three segments ---------------------------------------------------- */
  async _transcribe(wav) {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.sttModel);
    const data = await this._request('stt', joinUrl(this.baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.apiKey },
      body: form
    }, 'json');
    return data && typeof data.text === 'string' ? data.text.trim() : '';
  }

  async _chat(transcript) {
    const parts = [];
    if (transcript) parts.push(transcript);
    if (this.deviceText) parts.push(this.deviceText);
    const body = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: parts.join('\n') || '(no input)' }
      ]
    };
    const base = this.chatBaseUrl || this.baseUrl;
    const data = await this._request('chat', joinUrl(base, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey
      },
      body: JSON.stringify(body)
    }, 'json');
    const choices = data && data.choices;
    const content = choices && choices[0] && choices[0].message && choices[0].message.content;
    return typeof content === 'string' ? content : '';
  }

  async _speak(reply) {
    const body = {
      model: this.ttsModel,
      input: reply,
      voice: this.voice,
      response_format: 'pcm'
    };
    return this._request('tts', joinUrl(this.baseUrl, '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey
      },
      body: JSON.stringify(body)
    }, 'buffer');
  }

  /* ---- one full turn ----------------------------------------------------- */
  async _finalize() {
    if (this.pipeStarted) return;
    this.pipeStarted = true;
    this._clearSilenceTimer();
    const session = this.session;
    const alive = () => !!(session &&
      (typeof session.isOpen !== 'function' || session.isOpen()));
    try {
      const wav = pcm16StereoToWav(Buffer.concat(this.parts, this.audioBytesIn));
      const transcript = await this._withRetry('stt', () => this._transcribe(wav));
      if (!alive()) return;
      const reply = await this._withRetry('chat', () => this._chat(transcript));
      if (!alive()) return;
      const ttsPcm = await this._withRetry('tts', () => this._speak(reply));
      if (!alive()) return;

      /* c) downlink audio first: 24k mono -> 16k stereo, 3840-byte frames. */
      session.sendState('speaking');
      const stereo = resample24kMonoTo16kStereo(ttsPcm);
      for (const frame of chunkPcm(stereo)) {
        if (!alive()) return;
        session.sendAudio(FORMAT, frame);
      }

      /* d) text reply in ordered deltas, then final delta, idle, no held socket. */
      for (const delta of splitTextDeltas(reply, this.deltaMaxChars)) {
        if (!alive()) return;
        session.sendTextDelta(delta, false);
      }
      session.sendTextDelta('', true);
      session.sendState('idle');
      if (alive() && typeof session.close === 'function') session.close(1000, 'done');
    } catch (err) {
      this._fail(err);
    }
  }

  _fail(err) {
    this._clearSilenceTimer();
    const session = this.session;
    if (!session) return;
    const fatal = !!(err && (err.retryable || err.network || err.timeout));
    const code = (err && (err.network || err.timeout)) ? 'upstream_closed' : 'upstream_error';
    const msg = ascii(err && err.message).slice(0, 200) || 'upstream failure';
    if (typeof session.log === 'function') {
      session.log('openai.error', code, msg, 'fatal=' + fatal);
    }
    if (typeof session.isOpen === 'function' && !session.isOpen()) return;
    session.sendState('idle');
    if (typeof session.sendError === 'function') session.sendError(code, msg, fatal);
    /* Fatal errors make the gateway close with 1011; non-fatal ones we finish
     * the turn ourselves so the device still sees a clean close(1000). */
    if (!fatal && typeof session.close === 'function') session.close(1000, 'done');
  }
}

module.exports = {
  FORMAT, UPLINK_BYTES, UPLINK_FRAMES,
  OpenAICompatibleUpstream,
  joinUrl, pcm16StereoToWav, resample24kMonoTo16kStereo, chunkPcm, splitTextDeltas
};
