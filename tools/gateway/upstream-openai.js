'use strict';
/* OpenAI-compatible three-segment upstream adapter (stt -> chat -> tts).
 *
 * Zero new npm dependencies: uses Node 18+ global fetch / FormData / Blob /
 * AbortController. Same surface as MockUpstream (see upstream.js):
 *   start(session)     begin a turn; emits state=thinking
 *   sendAudio(pcm)     accumulate one 3840-byte uplink frame (16 kHz stereo s16le)
 *   sendText?(text)    optional device text input, folded into the chat user message
 *   stop()             advisory round finalize; idempotent, never calls session.close().
 *                      r114: also aborts an active chat SSE read (see stop()).
 *
 * r114: the chat segment is streamed (SSE `stream:true`); each upstream
 * choices[0].delta.content becomes a real text delta immediately.
 * r116: those deltas also feed a stateful sentence splitter (see
 * sentence-splitter.js). Every completed sentence enters a TTS queue that is
 * drained serially, so audio for the first sentence goes downlink while chat
 * is still streaming.
 * r117: when configured AND the device opts in via hello.caps, the STT segment
 * becomes a streaming transcription WS (see asr-stream.js): uplink frames are
 * forwarded on arrival, interim results become transcript-delta(final=false),
 * and the single finalized transcript is transcript-delta(final=true) BEFORE
 * chat starts. Otherwise (no config / no caps / stream broken) the r113
 * one-shot REST path is used unchanged.
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
 * (1 s gap) for transient faults, then state=idle + error. No retry storm.
 * r116: stop() aborts an in-flight chat SSE read AND an in-flight TTS request,
 * discards sentences that have not started, and keeps already-sent audio. */

const { createSentenceSplitter } = require('./sentence-splitter');
const { createAsrStream } = require('./asr-stream');

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

/* r113 pseudo-delta splitter. Retained as an exported utility for API/test
 * compatibility and any future non-streaming endpoint mode. The r114 chat SSE
 * path emits real upstream deltas directly and does NOT call this function. */
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
    this.deltaMaxChars = opts.deltaMaxChars == null ? 24 : opts.deltaMaxChars; /* r113 helper; unused by SSE path */

    /* r117 streaming ASR: BOTH gates must be on, else the r113 REST path runs.
     * No real address or key is hardcoded here; cli.js injects from env. */
    this.streamTranscript = !!opts.streamTranscript;          /* config gate */
    this.asrWsUrl = opts.asrWsUrl || '';                      /* ws(s):// endpoint */
    this.transcriptFinalTimeoutMs = opts.transcriptFinalTimeoutMs == null
      ? 1500 : opts.transcriptFinalTimeoutMs;

    this.session = null;
    this.deviceCaps = null;
    this.started = false;
    this.pipeStarted = false;
    this.stopped = false;
    this.parts = [];
    this.audioBytesIn = 0;
    this.audioFramesIn = 0;
    this.deviceText = '';
    this.silenceTimer = null;
    this._abort = null;             /* r114: chat SSE read controller */
    this._chatStreaming = false;   /* r114: true while reading the chat SSE body */
    this._stopAborted = false;     /* r114/r116: stop() aborted an active read */
    this._ttsAborts = new Set();   /* r116: in-flight TTS controllers (chat+TTS concurrent) */
    this._ttsSplitter = null;
    this._pipeline = null;
    this._speaking = false;

    this._asr = null;
    this._asrInterim = '';              /* bounded accumulation for timeout fallback */
    this._asrFinalText = null;          /* null = no final yet; '' is a valid final */
    this._asrFailed = false;
    this._asrResolveFinal = null;
    this._transcriptFinalSent = false;  /* guard: exactly one final transcript */
  }

  /* ---- upstream interface ------------------------------------------------ */
  start(session) {
    this.session = session;
    this.deviceCaps = session.caps || null;   /* server.js fills from hello.caps */
    this.started = true;
    session.sendState('thinking');
    if (this._asrEnabled()) this._openAsr();
    this._armSilenceTimer();
  }

  sendAudio(pcm) {
    if (!this.started || this.pipeStarted) return;
    if (!Buffer.isBuffer(pcm) || pcm.length !== UPLINK_BYTES) return; /* gateway already validates */
    this.parts.push(Buffer.from(pcm));        /* kept for REST fallback / zero-copy */
    this.audioBytesIn += pcm.length;
    this.audioFramesIn++;
    /* r117: forward on arrival, never wait for stop(). The adapter queues
     * frames that land before the WS handshake completes and flushes on open. */
    if (this._asr && !this._asrFailed && !this._stopAborted) this._asr.sendAudio(pcm);
    this._armSilenceTimer();
  }

  sendText(text) { this.deviceText = String(text == null ? '' : text); }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this._clearSilenceTimer();
    if (this.pipeStarted) {
      /* r114/r116: when stop() arrives AFTER the pipe was started (e.g. by the
       * silence timer) and the device says `end` / closes, abort both readers:
       * the active chat SSE read and the in-flight TTS request. Sentences that
       * have not started are dropped; already-sent audio stays. Emitted deltas
       * are kept and sealed by _chatStream; _finalize does the clean收口.
       * r117: the streaming transcription WS is also released here so a
       * mid-stream stop() cannot leave the final-transcript wait hanging. */
      this._stopAborted = true;
      if (this._asr) this._asr.abort();
      if (this._asrResolveFinal) { const r = this._asrResolveFinal; this._asrResolveFinal = null; r(null); }
      if (this._chatStreaming && this._abort) {
        try { this._abort.abort(); } catch (_) { /* ignore */ }
      }
      for (const ctrl of this._ttsAborts) {
        try { ctrl.abort(); } catch (_) { /* ignore */ }
      }
      const p = this._pipeline;
      if (p) p.queue.length = 0;
      return;
    }
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

  /* ---- r117 streaming transcription -------------------------------------- */
  /* Both the gateway config gate and the device hello.caps gate must be on.
   * No caps (old device) or no config -> the r113 REST path runs unchanged. */
  _asrEnabled() {
    return this.streamTranscript && !!this.asrWsUrl &&
      !!(this.deviceCaps && this.deviceCaps.streamTranscript === true);
  }

  _openAsr() {
    const self = this;
    const asr = createAsrStream({
      url: this.asrWsUrl,
      headers: { Authorization: 'Bearer ' + this.apiKey },
      onInterim(text) {
        if (!text || self._stopAborted || !self._alive()) return;
        /* Bounded accumulation + tiny signal on the device: never build a
         * large string inside an audio/WS callback (typewriter OOM lesson). */
        if (self._asrInterim.length < 2000) self._asrInterim += text;
        self.session.sendTranscriptDelta(text, false);
      },
      onFinal(text) {
        self._asrFinalText = String(text == null ? '' : text);
        if (self._asrResolveFinal) {
          const r = self._asrResolveFinal; self._asrResolveFinal = null;
          r(self._asrFinalText);
        }
      },
      onError(err) {
        self._asrFailed = true;
        self._log('openai.asr.error', ascii(err && err.message));
        if (self._asrResolveFinal) {
          const r = self._asrResolveFinal; self._asrResolveFinal = null;
          r(null);                       /* null => REST fallback */
        }
      }
    });
    this._asr = asr;
    /* Handshake failure (bad URL / refused) is a fallback trigger, not a
     * fatal turn error: log it and let _awaitAsrTranscript take the REST path. */
    asr.ready.catch((err) => {
      self._asrFailed = true;
      self._log('openai.asr.handshake', ascii(err && err.message));
      if (self._asrResolveFinal) {
        const r = self._asrResolveFinal; self._asrResolveFinal = null;
        r(null);
      }
    });
  }

  /* Ask the upstream to close audio and wait for exactly one final result.
   * Returns a string on success ('' is valid) or null on failure/abort, which
   * the caller maps to the r113 REST fallback. */
  _awaitAsrTranscript() {
    const self = this;
    if (!this._asr) return Promise.resolve(null);
    if (this._asrFinalText !== null) {         /* upstream finalized early */
      const t = this._asrFinalText; this._asr.close(); return Promise.resolve(t);
    }
    if (this._asrFailed || this._stopAborted) {
      this._asr.close(); return Promise.resolve(null);
    }
    try { this._asr.commit(); }
    catch (e) { this._log('openai.asr.commit.error', ascii(e && e.message)); }
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        self._asrResolveFinal = null;
        if (self._asr) self._asr.close();      /* release WS on every path */
        resolve(value);
      };
      self._asrResolveFinal = finish;
      const timer = setTimeout(() => {
        self._log('openai.asr.final.timeout', 'using accumulated interim');
        /* No duplicate: finalize once with what we heard, even if truncated. */
        finish(self._asrInterim);
      }, self.transcriptFinalTimeoutMs);
      if (timer.unref) timer.unref();
    });
  }

  /* Exactly one final transcript per negotiated turn. The final carries the
   * COMPLETE text (not an increment) so device reassembly cannot duplicate. */
  _emitTranscriptFinal(text) {
    if (this._transcriptFinalSent) return false;
    this._transcriptFinalSent = true;
    const s = this.session;
    if (!s || typeof s.sendTranscriptDelta !== 'function' || !this._alive()) return false;
    s.sendTranscriptDelta(String(text == null ? '' : text), true);
    return true;
  }

  /* ---- HTTP plumbing ----------------------------------------------------- */
  async _request(stage, url, options, kind) {
    const ctrl = new AbortController();
    /* r116: chat and TTS now run concurrently, so the in-flight TTS
     * controllers live in their own set; `this._abort` stays the chat reader's
     * controller and is no longer clobbered here. */
    if (stage === 'tts') this._ttsAborts.add(ctrl);
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
      if (stage === 'tts') this._ttsAborts.delete(ctrl);
    }
  }

  async _withRetry(stage, fn) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await fn(); }
      catch (e) {
        last = e;
        /* r116: a stop()-induced abort is retryable by shape (timeout) but must
         * never restart a request the device asked us to cancel. */
        if (!e || !e.retryable || attempt === 1 || this._stopAborted) break;
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

  /* r114: the chat segment is a true SSE stream. `stream:true` + Accept
   * text/event-stream; each choices[0].delta.content is forwarded immediately
   * as a text delta. A clean [DONE]/EOF seals the text with exactly one final
   * delta. Any interruption AFTER the SSE headers are accepted is non-fatal and
   * non-retryable (a retry would duplicate deltas) and seals the partial text
   * with a final delta; pre-header failures keep the r113 error mapping
   * (§8.1.4). r116: each delta is also fed to `sink` (the sentence splitter),
   * and `sink.seal()` is called at every final-delta point so the residual
   * sentence is enqueued exactly when chat收口. */
  async _chatStream(transcript, sink) {
    const parts = [];
    if (transcript) parts.push(transcript);
    if (this.deviceText) parts.push(this.deviceText);
    const body = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: parts.join('\n') || '(no input)' }
      ],
      stream: true
    };
    const base = this.chatBaseUrl || this.baseUrl;
    const ctrl = new AbortController();
    this._abort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const session = this.session;
    const alive = () => !!(session &&
      (typeof session.isOpen !== 'function' || session.isOpen()));
    let text = '';
    let emittedAny = false;
    let streaming = false;
    const seal = (note) => {
      /* r116: flush residual sentence BEFORE the final text delta so TTS of
       * the tail can start immediately; splitter.seal() is idempotent. */
      if (sink && typeof sink.seal === 'function') sink.seal();
      if (emittedAny && alive()) session.sendTextDelta(note || '', true);
    };
    try {
      const res = await fetch(joinUrl(base, '/chat/completions'), {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer ' + this.apiKey
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let rbody = '';
        try { rbody = (await res.text()).slice(0, 512); } catch (_) { /* ignore */ }
        const e = new Error('chat HTTP ' + res.status + (rbody ? ': ' + ascii(rbody) : ''));
        e.status = res.status;
        e.retryable = RETRYABLE_STATUS(res.status);
        throw e;
      }
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('text/event-stream') < 0) {
        const e = new Error('chat expected text/event-stream, got ' + ascii(ct));
        e.status = 415;
        e.retryable = false;           /* malformed endpoint: same class as 4xx */
        throw e;
      }
      streaming = true;
      this._chatStreaming = true;

      /* SSE line grammar (verified against a node:http fake endpoint): events
       * are separated by a blank line; `field: value` drops one leading space;
       * multiple `data:` fields of one event join with '\n'; ':comment' is
       * ignored; `data: [DONE]` terminates. Chunk boundaries can split a line,
       * so a partial line is buffered until the next '\n'. */
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      let dataLines = [];
      let done = false;
      const dispatch = (data) => {
        if (data === '[DONE]') return true;
        let chunk;
        try { chunk = JSON.parse(data); } catch (_) { return false; }
        const content = chunk && chunk.choices && chunk.choices[0] &&
          chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (typeof content === 'string' && content.length) {
          if (!alive()) return false;
          session.sendTextDelta(content, false);
          emittedAny = true;
          text += content;
          /* r116: feed the splitter synchronously; a completed sentence starts
           * its TTS request while the SSE body is still being read. */
          if (sink && typeof sink.feed === 'function') sink.feed(content);
        }
        return false;
      };
      for await (const raw of res.body) {
        if (this._stopAborted || done) break;
        buf += decoder.decode(raw, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line === '') {
            if (dataLines.length) {
              const payload = dataLines.join('\n');
              dataLines = [];
              if (dispatch(payload)) { done = true; break; }
            }
            continue;
          }
          if (line.charAt(0) === ':') continue;       /* comment / keepalive */
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? '' : line.slice(colon + 1);
          if (value.charAt(0) === ' ') value = value.slice(1);
          if (field === 'data') dataLines.push(value);
        }
      }
      /* EOF without trailing blank line: best-effort dispatch of a pending
       * event (some minimal endpoints omit the final newline). */
      if (!done && !this._stopAborted && dataLines.length) {
        done = dispatch(dataLines.join('\n'));
      }
      if (this._stopAborted) {
        seal('');
        const se = new Error('chat SSE aborted by stop');
        se.stoppedByUser = true;
        throw se;
      }
      /* clean end: exactly one final delta (even for an empty reply, r113). */
      if (sink && typeof sink.seal === 'function') sink.seal();
      if (alive()) session.sendTextDelta('', true);
      return text;
    } catch (e) {
      if (this._stopAborted) {
        seal('');
        const se = new Error('chat SSE aborted by stop');
        se.stoppedByUser = true;
        throw se;
      }
      if (streaming) {
        /* Stream established: never retry (would duplicate deltas), and treat
         * the interruption as non-fatal (same class as 401, §8.1.4). */
        seal(' (truncated)');
        const be = new Error('chat SSE interrupted: ' + ascii(e && e.message));
        be.streamBreak = true;
        be.retryable = false;
        be.network = false;
        be.timeout = false;
        throw be;
      }
      if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
        const te = new Error('chat timeout after ' + this.timeoutMs + 'ms');
        te.timeout = true;
        te.retryable = true;
        throw te;
      }
      if (e && typeof e.retryable === 'boolean') throw e;
      const ne = new Error('chat network error: ' + ascii(e && e.message));
      ne.network = true;
      ne.retryable = true;
      throw ne;
    } finally {
      clearTimeout(timer);
      this._chatStreaming = false;
      if (this._abort === ctrl) this._abort = null;
    }
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

  /* ---- one full turn (r116: chat SSE + serial sentence-TTS drain) -------- */
  async _finalize() {
    if (this.pipeStarted) return;
    this.pipeStarted = true;
    this._clearSilenceTimer();
    const p = this._pipeline = {
      queue: [],            /* sentences waiting for /audio/speech */
      draining: false,      /* at most one /audio/speech request in flight */
      chatDone: false,      /* chat SSE sealed (clean / broken / stopped) */
      sealed: false,        /* splitter backstop flag */
      total: 0,             /* sentences ever enqueued */
      spoken: 0,            /* sentences whose audio fully went downlink */
      failed: 0,            /* sentences skipped after exhausted retries */
      lastTtsError: null,
      finished: false,
      resolve: null,
      promise: null
    };
    p.promise = new Promise((resolve) => { p.resolve = resolve; });
    this._speaking = false;

    const splitter = createSentenceSplitter((sentence) => {
      if (!sentence) return;
      p.queue.push(sentence);
      p.total++;
      this._drainTts();
    });
    this._ttsSplitter = splitter;

    let stopped = false;
    let fatalErr = null;
    let streamBreakErr = null;
    try {
      const asrOn = this._asrEnabled();
      let transcript = null;
      if (asrOn) {
        /* r117: interim deltas were already sent on arrival. The finalized
         * transcript goes down exactly once, before the first chat delta. */
        transcript = await this._awaitAsrTranscript();
      }
      if (this._stopAborted) {
        stopped = true;                         /* barge-in mid ASR wait */
      } else {
        let sttErr = null;
        if (transcript === null) {
          /* r113 one-shot REST path: capability/config off, handshake failed,
           * stream broke, or no final arrived. Behavior is byte-for-byte the
           * pre-r117 path (one POST after stop, no transcript-delta). */
          try {
            const wav = pcm16StereoToWav(Buffer.concat(this.parts, this.audioBytesIn));
            transcript = await this._withRetry('stt', () => this._transcribe(wav));
          } catch (err) { sttErr = err; transcript = ''; }
        }
        if (asrOn) this._emitTranscriptFinal(transcript);
        if (sttErr) throw sttErr;
        if (this._alive()) {
          /* chat and the TTS queue now run concurrently: _chatStream feeds the
           * splitter, which starts _drainTts() as soon as a sentence completes. */
          await this._withRetry('chat', () => this._chatStream(transcript || '', splitter));
        }
      }
    } catch (err) {
      if (err && err.stoppedByUser) stopped = true;
      else if (err && err.streamBreak) streamBreakErr = err;  /* r114: non-fatal */
      else fatalErr = err;
    } finally {
      /* backstop: seal exactly once even if _chatStream threw before sealing */
      if (!p.sealed) { p.sealed = true; splitter.seal(); }
      p.chatDone = true;
      this._finishTurn();
    }

    /* join point: the turn ends only when chat is sealed AND every sentence
     * has been synthesized or skipped. */
    await p.promise;

    /* stoppedByUser covers stop() during the chat read; _stopAborted also
     * covers stop() landing after chat sealed but while a TTS segment is
     * in flight (common barge-in shape). Both are clean, no error frame. */
    if (stopped || this._stopAborted) { this._cleanClose(); return; }
    if (fatalErr) { this._fail(fatalErr); return; }
    if (streamBreakErr) { this._fail(streamBreakErr); return; } /* non-fatal, r114 */
    if (p.total > 0 && p.spoken === 0 && p.failed === p.total) {
      this._fail(p.lastTtsError || new Error('all tts sentences failed'));
      return;
    }
    this._cleanClose();
  }

  _alive() {
    const s = this.session;
    return !!(s && (typeof s.isOpen !== 'function' || s.isOpen()));
  }

  _log(...parts) {
    const s = this.session;
    if (s && typeof s.log === 'function') s.log(...parts);
  }

  /* Serial TTS consumer: at most one /audio/speech request in flight. Each
   * returned 24k mono PCM is resampled + framed immediately, so the first
   * sentence starts playing while chat is still streaming. */
  _drainTts() {
    const p = this._pipeline;
    if (!p || p.draining || this._stopAborted) return;
    p.draining = true;
    const self = this;
    (async () => {
      try {
        while (p.queue.length) {
          if (self._stopAborted || !self._alive()) { p.queue.length = 0; break; }
          const sentence = p.queue.shift();
          let pcm;
          try {
            pcm = await self._withRetry('tts', () => self._speak(sentence));
          } catch (e) {
            p.failed++;
            p.lastTtsError = e;
            self._log('openai.tts.skip',
              'sentence=' + ascii(sentence).slice(0, 80), ascii(e && e.message).slice(0, 120));
            continue;                       /* keep spoken audio; skip this sentence */
          }
          if (self._stopAborted || !self._alive()) { p.queue.length = 0; break; }
          if (!Buffer.isBuffer(pcm) || pcm.length === 0) { p.failed++; continue; }
          const stereo = resample24kMonoTo16kStereo(pcm);
          if (!self._speaking) {
            self._speaking = true;
            self.session.sendState('speaking');   /* before the first audio frame */
          }
          for (const frame of chunkPcm(stereo)) {
            if (self._stopAborted || !self._alive()) { p.queue.length = 0; return; }
            self.session.sendAudio(FORMAT, frame);
          }
          p.spoken++;
        }
      } finally {
        p.draining = false;
        self._finishTurn();
      }
    })().catch((e) => {
      /* defensive: never leave the turn hanging on an unexpected throw */
      p.draining = false;
      self._log('openai.tts.drain.error', ascii(e && e.message).slice(0, 160));
      self._finishTurn();
    });
  }

  _finishTurn() {
    const p = this._pipeline;
    if (!p || p.finished || !p.chatDone || p.draining) return;
    p.finished = true;
    if (p.resolve) p.resolve();
  }

  _cleanClose() {
    const s = this.session;
    if (!s) return;
    if (typeof s.isOpen === 'function' && !s.isOpen()) return;
    s.sendState('idle');
    if (typeof s.close === 'function') s.close(1000, 'done');
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
