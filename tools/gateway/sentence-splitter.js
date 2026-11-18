'use strict';
/* Stateful sentence splitter for gateway-side streaming TTS (r116).
 *
 * Pure JS, no I/O and no dependencies. The splitter is fed the real chat SSE
 * text deltas; each time a sentence boundary is crossed the complete sentence
 * is returned (and passed to the optional onSentence callback). The residual
 * buffer is flushed by seal() when the chat stream closes (clean or broken).
 *
 * Boundary rules:
 *   - terminators: . ! ? . ! ? (ASCII + CJK)
 *   - a terminator is held until the next non-closer char so that trailing
 *     quotes / brackets / another terminator (e.g. "..." or "?!") stay in the
 *     same sentence even when they arrive in a later chunk;
 *   - whitespace after a terminator closes the sentence;
 *   - a normal char right after a terminator closes the sentence and starts a
 *     new one (no whitespace required, e.g. "A.B");
 *   - seal() is idempotent and flushes whatever is left.
 *
 * Emitted sentences are trimmed. feed()/seal() both return the sentences
 * produced by that call only; state persists across calls. */

const TERMINATORS = '.!?。！？';
const CLOSERS = "\"')]}>" + '\u201d\u2019\u300d\u300f\uff09\u3011\u3015';

const isTerm = (ch) => TERMINATORS.indexOf(ch) >= 0;
const isCloser = (ch) => CLOSERS.indexOf(ch) >= 0;
const isSpace = (ch) => /\s/.test(ch);

/* Creates a splitter. onSentence(s) is invoked for every completed sentence
 * (once), in the same order as the returned arrays. */
function createSentenceSplitter(onSentence) {
  let buf = '';
  let pending = false;   /* a terminator (and optional closers) is buffered */
  let sealed = false;

  const emit = (out) => {
    const s = buf.trim();
    buf = '';
    pending = false;
    if (s) {
      out.push(s);
      if (typeof onSentence === 'function') onSentence(s);
    }
  };

  return {
    feed(chunk) {
      if (sealed) return [];
      const out = [];
      const text = chunk == null ? '' : String(chunk);
      for (const ch of Array.from(text)) {
        buf += ch;
        if (pending) {
          /* keep closers / repeated terminators attached to this sentence */
          if (isTerm(ch) || isCloser(ch)) continue;
          if (isSpace(ch)) { emit(out); continue; }
          /* a new content char: close the previous sentence before it */
          buf = buf.slice(0, -1);
          emit(out);
          buf = ch;
          pending = false;
          continue;
        }
        if (isTerm(ch)) pending = true;
      }
      return out;
    },

    seal() {
      if (sealed) return [];
      sealed = true;
      const out = [];
      emit(out);
      return out;
    },

    isSealed() { return sealed; }
  };
}

class SentenceSplitter {
  constructor(onSentence) {
    const impl = createSentenceSplitter(onSentence);
    this.feed = impl.feed;
    this.seal = impl.seal;
    this.isSealed = impl.isSealed;
  }
}

module.exports = { createSentenceSplitter, SentenceSplitter, TERMINATORS, CLOSERS };
