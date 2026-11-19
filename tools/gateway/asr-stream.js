'use strict';
/* r117: streaming transcription WS adapter (OpenAI Realtime transcription
 * style). Zero new npm dependencies: reuses the vendored ws-client.
 *
 * The real upstream wire protocol is an ADAPTATION ASSUMPTION (no real key /
 * no egress this round; see docs/voice-gateway-protocol.md §8.1.8). Accepted
 * JSON text events (kept deliberately narrow so a fake endpoint is enough to
 * prove the device-facing semantics):
 *   interim: {"type":"transcript.delta","text":"..."}
 *            {"type":"input_audio_transcription.delta","delta":"..."}
 *   final:   {"type":"transcript.done","text":"..."}
 *            {"type":"input_audio_transcription.completed","transcript":"..."}
 *            {"text":"...","final":true}   (convenience for local fakes)
 * Anything else is ignored (never mistaken for a final).
 *
 * Interface returned by createAsrStream(opts):
 *   ready        Promise resolved on WS open, rejected on handshake failure.
 *   sendAudio(pcm)  Forward one 3840 B uplink frame the moment it arrives;
 *                   frames sent before the WS opens are queued and flushed
 *                   on open, so "arrive => forward" still holds.
 *   commit()     Send an end-of-audio control frame, asking for the final.
 *   abort()      Stop mid-stream; suppress further callbacks, close socket.
 *   close()      Graceful close (idempotent with abort).
 *   stats        { forwarded, firstForwardAt, lastForwardAt, bytes }
 *
 * All callbacks are defensive: after abort()/close() no onInterim/onFinal/
 * onError is delivered, so the turn owner never sees a late duplicate final. */

const { connect } = require('./ws-client');

const MAX_PIECE_CHARS = 256;          /* bound each signal write (typewriter OOM lesson) */

function textOf(msg, keys) {
  for (const k of keys) {
    if (typeof msg[k] === 'string' && msg[k].length) return msg[k].slice(0, MAX_PIECE_CHARS);
  }
  return '';
}

function createAsrStream(opts = {}) {
  const o = opts || {};
  const stats = { forwarded: 0, firstForwardAt: 0, lastForwardAt: 0, bytes: 0 };
  const pending = [];
  let conn = null;
  let open = false;
  let commitPending = false;            /* end-of-audio may precede the handshake */
  let stopped = false;
  let resolveReady = null;
  let rejectReady = null;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  /* A caller that only waits for the transcript must not crash the process on
   * a handshake failure before it attaches a catch handler. */
  ready.catch(() => {});

  const safe = (fn, arg) => {
    if (stopped) return;
    try { if (typeof fn === 'function') fn(arg); } catch (_) { /* owner error is not ours */ }
  };

  const flush = () => {
    if (!open || stopped) return;
    while (pending.length) {
      const pcm = pending.shift();
      conn.sendBinary(pcm);
      const now = Date.now();
      if (!stats.firstForwardAt) stats.firstForwardAt = now;
      stats.lastForwardAt = now;
      stats.forwarded++;
      stats.bytes += pcm.length;
    }
    /* Device `end` can land before the handshake finishes. Deliver the
     * queued end-of-audio right after the queued PCM so the final is not
     * lost to a 1.5 s timeout (real device-sim ordering, r117 smoke). */
    if (commitPending) {
      commitPending = false;
      try { conn.sendText(JSON.stringify({ type: 'input_audio_buffer.commit' })); }
      catch (_) { /* upstream will be closed by the owner's timeout */ }
    }
  };

  conn = connect(o.url, {
    onOpen() {
      if (stopped) return;
      open = true;
      flush();
      if (resolveReady) { const r = resolveReady; resolveReady = null; r(); }
    },
    onMessage(data) {
      if (stopped || typeof data !== 'string') return;   /* binary is not an ASR event */
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      const type = String(msg.type || '');
      if (type === 'transcript.delta' || type === 'input_audio_transcription.delta') {
        const text = textOf(msg, ['text', 'delta']);
        if (text) safe(o.onInterim, text);
        return;
      }
      if (type === 'transcript.done' || type === 'input_audio_transcription.completed') {
        safe(o.onFinal, textOf(msg, ['text', 'transcript', 'delta']));
        return;
      }
      if (msg.final === true) {
        safe(o.onFinal, textOf(msg, ['text', 'transcript', 'delta']));
      }
      /* unknown event: ignore, never fabricate a final */
    },
    onError(code) {
      if (stopped) return;
      if (rejectReady) { const r = rejectReady; rejectReady = null; r(new Error('asr ws error ' + code)); }
      safe(o.onError, new Error('asr ws error ' + code));
    },
    onClose() {
      if (stopped) return;
      if (!open && rejectReady) { const r = rejectReady; rejectReady = null; r(new Error('asr ws closed before open')); }
      if (open) safe(o.onError, new Error('asr ws closed'));
    }
  }, o.headers || {});

  return {
    ready,
    stats,
    sendAudio(pcm) {
      if (stopped || !Buffer.isBuffer(pcm)) return;
      if (open) {
        pending.push(pcm);
        flush();
      } else {
        pending.push(pcm);
      }
    },
    commit() {
      if (stopped) return false;
      if (!open) { commitPending = true; return true; }  /* flushed on open */
      try { conn.sendText(JSON.stringify({ type: 'input_audio_buffer.commit' })); }
      catch (_) { return false; }
      return true;
    },
    abort() {
      if (stopped) return;
      stopped = true;
      pending.length = 0;
      commitPending = false;
      if (resolveReady) { const r = resolveReady; resolveReady = null; r(); }
      try { conn.close(1000, 'asr-abort'); } catch (_) { /* best effort */ }
    },
    close() {
      if (stopped) return;
      stopped = true;
      pending.length = 0;
      commitPending = false;
      if (resolveReady) { const r = resolveReady; resolveReady = null; r(); }
      try { conn.close(1000, 'asr-done'); } catch (_) { /* best effort */ }
    }
  };
}

module.exports = { createAsrStream, MAX_PIECE_CHARS };
