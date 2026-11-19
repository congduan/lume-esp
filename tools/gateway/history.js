'use strict';
/* r120: bounded per-session conversation history for the voice gateway.
 *
 * Pure host-side state; no npm deps, no protocol frames, no firmware. A
 * DeviceSession owns one ConversationHistory instance, so history is isolated
 * by sessionId and is discarded when the session closes. The OpenAI-compatible
 * upstream reads messages() when building each chat request and calls
 * record() once a turn closes cleanly.
 *
 * Window policy: keep the most recent `limit` messages (user + assistant;
 * the system prompt is never stored). `limit === 0` disables history, which
 * makes the upstream chat body byte-for-byte identical to r119. A per-session
 * character budget is the second bound so one long conversation cannot grow
 * without limit. Trimming drops the OLDEST user+assistant pair first. */

const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_CHAR_BUDGET = 8192;

function normalizeLimit(v) {
  if (v == null || v === '') return DEFAULT_HISTORY_LIMIT;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(0, Math.floor(n));
}

function normalizeBudget(v) {
  if (v == null || v === '') return DEFAULT_HISTORY_CHAR_BUDGET;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_HISTORY_CHAR_BUDGET;
  return Math.floor(n);
}

class ConversationHistory {
  constructor(opts = {}) {
    this.limit = normalizeLimit(opts.limit);
    this.charBudget = normalizeBudget(opts.charBudget);
    this.messages = [];               /* [{role:'user'|'assistant', content}] */
  }

  enabled() { return this.limit > 0; }

  /* Return a shallow copy: the upstream must never mutate stored history. */
  snapshot() { return this.messages.slice(); }

  size() { return this.messages.length; }

  chars() {
    let n = 0;
    for (const m of this.messages) n += String(m.content).length;
    return n;
  }

  /* Append one completed turn (user utterance + assistant reply), then trim
   * by oldest pair until both the message-count and character bounds hold.
   * An empty side is skipped so a silent turn cannot store a blank message. */
  record(user, assistant) {
    if (!this.enabled()) return;
    if (user != null && String(user).length) {
      this.messages.push({ role: 'user', content: String(user) });
    }
    if (assistant != null && String(assistant).length) {
      this.messages.push({ role: 'assistant', content: String(assistant) });
    }
    while (this.messages.length > this.limit || this.chars() > this.charBudget) {
      if (this.messages.length < 2) {
        /* A single stored message over budget cannot be paired off; drop it. */
        if (this.chars() > this.charBudget) this.messages.length = 0;
        break;
      }
      this.messages.splice(0, 2);
    }
  }

  clear() { this.messages.length = 0; }

  /* r122: bounded copy used when a session closes. The gateway retires this
   * snapshot into its resume store so a later `hello.resume` can rebind the
   * history to a new connection; the live session still clears its own copy. */
  clone() {
    const c = new ConversationHistory({ limit: this.limit, charBudget: this.charBudget });
    c.messages = this.snapshot();
    return c;
  }
}

module.exports = {
  ConversationHistory, normalizeLimit, normalizeBudget,
  DEFAULT_HISTORY_LIMIT, DEFAULT_HISTORY_CHAR_BUDGET
};
