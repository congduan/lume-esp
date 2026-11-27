/* ---- synchronous OpenAI-compatible chat client ---- */
lume.ai = {
  setKey: function (key) {
    if (typeof key !== 'string' || !key || key.length >= 4000) return -1;
    return lume.storage.kv.set('ai_api_key', key);
  },
  chat: function (options) {
    if (!options || !Array.isArray(options.messages) || !options.messages.length) return -1;
    var key = lume.storage.kv.get('ai_api_key');
    if (typeof key !== 'string' || !key) return -1;
    var base = options.baseUrl === undefined ? 'https://api.deepseek.com' : options.baseUrl;
    if (typeof base !== 'string' || !/^https?:\/\/[^\s]+$/.test(base)) return -1;
    if (base.slice(-1) === '/') base = base.slice(0, -1);
    var model = options.model === undefined ? 'deepseek-flash' : options.model;
    if (typeof model !== 'string' || !model) return -1;
    for (var i = 0; i < options.messages.length; i++) {
      var m = options.messages[i];
      if (!m || (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') ||
          typeof m.content !== 'string') return -1;
    }
    if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1)) return -1;
    if (options.temperature !== undefined && (typeof options.temperature !== 'number' ||
        options.temperature < 0 || options.temperature > 2)) return -1;
    var payload = { model: model, messages: options.messages, stream: false };
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    var body = JSON.stringify(payload);
    if (body.length > 16384) return -1;
    var response = lume.net.httpRequest({
      url: base + '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: body, timeoutMs: options.timeoutMs === undefined ? 30000 : options.timeoutMs,
      caPem: options.caPem, httpsInsecure: options.httpsInsecure === true
    });
    if (typeof response === 'number') return response === -5 ? -5 : response === -1 ? -1 : -2;
    if (!response || response.status < 200 || response.status >= 300) return -3;
    if (response.truncated) return -4;
    try {
      var data = JSON.parse(response.body);
      if (!data || !Array.isArray(data.choices) || !data.choices[0] ||
          !data.choices[0].message || typeof data.choices[0].message.content !== 'string') return -4;
      return { content: data.choices[0].message.content,
               usage: data.usage || null, finishReason: data.choices[0].finish_reason || null };
    } catch (e) { return -4; }
  }
};

/* ---- WebSocket client: callbacks run only on the engine task ---- */
var __wsPeers = {};
function __lume_dispatchWS(id, kind, data) {
  var peer = __wsPeers[id];
  if (!peer) return;
  if (kind === 1) {
    if (!peer.settled) { peer.settled = true; peer.cb(null, peer.handle); }
    if (peer.options.onOpen) peer.options.onOpen(peer.handle);
  } else if (kind === 2) {
    if (peer.options.onMessage) peer.options.onMessage(data);
  } else if (kind === 3) {
    delete __wsPeers[id];
    if (!peer.settled) { peer.settled = true; peer.cb(-2, null); }
    if (peer.options.onClose) peer.options.onClose();
  } else if (kind === 4) {
    if (!peer.settled) { peer.settled = true; peer.cb(-2, null); }
    if (peer.options.onError) peer.options.onError(-2);
  }
}
if (lume.net && lume.net.ws) lume.net.ws.connect = function (url, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  options = options || {};
  if (typeof cb !== 'function') {
    return new Promise(function (resolve, reject) {
      lume.net.ws.connect(url, options, function (err, handle) {
        if (err) reject(err); else resolve(handle);
      });
    });
  }
  if (typeof url !== 'string' || !/^wss?:\/\//.test(url)) { cb(-1, null); return; }
  var headers = '';
  if (options.headers) {
    if (typeof options.headers !== 'object') { cb(-1, null); return; }
    var names = Object.keys(options.headers);
    for (var i = 0; i < names.length; i++) {
      var name = names[i], value = options.headers[name];
      if (!/^[A-Za-z0-9-]+$/.test(name) || typeof value !== 'string' || /[\0\r\n]/.test(value)) {
        cb(-1, null); return;
      }
      headers += name + ': ' + value + '\r\n';
    }
    if (headers.length > 4096) { cb(-1, null); return; }
  }
  var id = lume.net.ws._connect(url, headers);
  if (id < 0) { cb(id, null); return; }
  var handle = {
    send: function (data) { return lume.net.ws._send(id, data); },
    close: function () {
      var result = lume.net.ws._close(id);
      var peer = __wsPeers[id];
      if (peer) {
        delete __wsPeers[id];
        if (peer.options.onClose) peer.options.onClose();
      }
      return result;
    }
  };
  __wsPeers[id] = { options: options, cb: cb, handle: handle, settled: false };
};

/* ---- microphone stream: native task -> engine queue -> callback ---- */
var __audioStreamOptions = null;
function __lume_dispatchAudioChunk(pcm, samples) {
  var opts = __audioStreamOptions;
  if (!opts) return;
  if (samples < 0) { if (opts.onError) opts.onError(samples); return; }
  opts.onChunk(pcm, samples);
}
if (lume.audio && lume.audio._recordStream) {
  lume.audio.recordStream = function (opts) {
    opts = opts || {};
    var n = opts.chunkSamples === undefined ? 1024 : opts.chunkSamples;
    if (typeof opts.onChunk !== 'function' ||
        (opts.onError !== undefined && typeof opts.onError !== 'function') ||
        (n !== 512 && n !== 1024 && n !== 2048)) return -1;
    var rc = lume.audio._recordStream(n);
    if (rc === 0) __audioStreamOptions = opts;
    return rc;
  };
  lume.audio.stopStream = function () {
    var rc = lume.audio._stopStream();
    __audioStreamOptions = null;
    return rc;
  };
}
/* ---- LAN web server: JS-defined routes (r71) -------------------------
 * C owns only HTTP + sockets; every route and page body is written here and
 * hot-distributed with the app. CALLBACK DISCIPLINE: a handler is invoked
 * synchronously on the engine task and must return within a few ms. Light
 * string building (<8 KB) is fine; heavy work must be pushed to a signal /
 * state and fetched by a later poll. The engine calls __lume_web_dispatch()
 * once per request and writes the returned {status, headers?, body} back.
 */
var __lumeWebRoutes = {};
var __lumeWebOrder = [];
function __lumeWebQuery(qs) {
  var out = {};
  if (typeof qs !== 'string' || !qs) return out;
  var parts = qs.split('&');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    var eq = p.indexOf('=');
    var k = eq < 0 ? p : p.slice(0, eq);
    var v = eq < 0 ? '' : p.slice(eq + 1);
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
    out[k] = v;
  }
  return out;
}
function __lumeWebWelcome() {
  var name = (typeof lume.apps !== 'undefined' && lume.apps.current)
    ? lume.apps.current() : '';
  if (!name) name = 'Lume device';
  var links = '';
  for (var i = 0; i < __lumeWebOrder.length; i++) {
    links += '<li><code>' + __lumeWebOrder[i] + '</code></li>';
  }
  if (!links) links = '<li>(no routes registered)</li>';
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + name + '</title></head><body>'
    + '<h1>' + name + '</h1><p>Lume local web server</p>'
    + '<p>Registered routes:</p><ul>' + links + '</ul></body></html>';
}
function __lumeWebNotFound() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>404</title></head>'
    + '<body><h1>404 Not Found</h1><p>No JS route registered for this path.</p></body></html>';
}
function __lume_web_dispatch(raw) {
  var method = raw.method || 'GET';
  var path = raw.path || '/';
  var handler = __lumeWebRoutes[method + ' ' + path];
  var req = { method: method, path: path,
    query: __lumeWebQuery(raw.queryRaw), body: raw.body || '' };
  if (typeof handler !== 'function') {
    if (method === 'GET' && path === '/') return { status: 200, body: __lumeWebWelcome() };
    return { status: 404, body: __lumeWebNotFound() };
  }
  var res;
  try { res = handler(req); }
  catch (e) { return { status: 500, body: 'handler error: ' + e }; }
  if (res === undefined || res === null) res = {};
  if (typeof res !== 'object') res = { body: String(res) };
  return { status: (typeof res.status === 'number' ? res.status : 200),
    headers: res.headers || undefined,
    body: (res.body === undefined || res.body === null) ? '' : res.body };
}
if (lume.net && lume.net.web) {
  lume.net.web.start = function (options) {
    options = options || {};
    if (typeof options !== 'object' || typeof options.token !== 'string' ||
        !options.token || options.token.length >= 64) return -1;
    var port = options.port === undefined ? null : options.port;
    if (port !== null && (!Number.isInteger(port) || port < 1024 || port > 65535)) return -1;
    return lume.net.web._start(port, options.token);
  };
  lume.net.web.stop = function () { return lume.net.web._stop(); };
  lume.net.web.on = function (method, path, handler) {
    if (typeof method !== 'string' || typeof path !== 'string' ||
        typeof handler !== 'function') return -1;
    method = method.toUpperCase();
    if (!/^[A-Z]+$/.test(method) || path.charAt(0) !== '/' ||
        path.indexOf('?') >= 0 || path.length >= 192) return -1;
    var key = method + ' ' + path;
    if (!__lumeWebRoutes[key]) __lumeWebOrder.push(key);
    __lumeWebRoutes[key] = handler;
    return 0;
  };
  lume.net.web.url = function () { return lume.net.web._url(); };
}

/* ---- native binding constants (mirror lume_ui_bridge.h) ---- */
var Fs = lume.storage ? lume.storage.Fs : undefined;   /* bare-Fs alias: image_gallery/files use it */
var NODE_VIEW = 0, NODE_TEXT = 1, NODE_BUTTON = 2, NODE_CANVAS = 3, NODE_IMAGE = 4, NODE_ARC = 5;
var ATTR_TEXT = 0, ATTR_BG_COLOR = 1, ATTR_WIDTH = 2, ATTR_HEIGHT = 3,
    ATTR_ALIGN = 4, ATTR_VISIBLE = 5, ATTR_PARENT = 6;
var ATTR_FLEX_FLOW = 7, ATTR_FLEX_MAIN_ALIGN = 8, ATTR_FLEX_CROSS_ALIGN = 9,
    ATTR_PADDING = 10, ATTR_GAP = 11, ATTR_RADIUS = 12, ATTR_BORDER_WIDTH = 13,
    ATTR_BORDER_COLOR = 14, ATTR_OPACITY = 15, ATTR_WIDTH_PCT = 16, ATTR_HEIGHT_PCT = 17;
var ATTR_X = 18, ATTR_Y = 19, ATTR_SCROLL_DIR = 20, ATTR_SCROLLBAR_MODE = 21,
    ATTR_SCROLL_Y = 22, ATTR_IGNORE_LAYOUT = 23;
var ATTR_ARC_VALUE = 24, ATTR_ARC_START = 25, ATTR_ARC_END = 26,
    ATTR_ARC_THICKNESS = 27, ATTR_ARC_TRACK = 28, ATTR_ARC_COLOR = 29;
var ATTR_PAD_TOP = 30, ATTR_PAD_RIGHT = 31, ATTR_PAD_BOTTOM = 32, ATTR_PAD_LEFT = 33;
var ATTR_MARGIN = 34, ATTR_MARGIN_TOP = 35, ATTR_MARGIN_RIGHT = 36,
    ATTR_MARGIN_BOTTOM = 37, ATTR_MARGIN_LEFT = 38, ATTR_FLEX_GROW = 39;
var ATTR_ALIGN_TARGET = 40, ATTR_ALIGN_OFS_X = 41, ATTR_ALIGN_OFS_Y = 42;
var ATTR_WIDTH_AUTO = 43, ATTR_HEIGHT_AUTO = 44, ATTR_MIN_WIDTH = 45, ATTR_MAX_WIDTH = 46,
    ATTR_MIN_HEIGHT = 47, ATTR_MAX_HEIGHT = 48;
var ATTR_TRANSLATE_X = 49, ATTR_TRANSLATE_X_PCT = 50,
    ATTR_TRANSLATE_Y = 51, ATTR_TRANSLATE_Y_PCT = 52;
var ATTR_TEXT_ALIGN = 53, ATTR_TEXT_LONG_MODE = 54;
var ATTR_TEXT_FONT = 55, ATTR_LETTER_SPACE = 56, ATTR_LINE_SPACE = 57;
var ALIGN_CENTER = 0, ALIGN_TOP_LEFT = 1, ALIGN_TOP_MID = 2, ALIGN_TOP_RIGHT = 3,
    ALIGN_BOTTOM_MID = 4, ALIGN_BOTTOM_LEFT = 5, ALIGN_BOTTOM_RIGHT = 6,
    ALIGN_LEFT_MID = 7, ALIGN_RIGHT_MID = 8,
    ALIGN_OUT_TOP_LEFT = 9, ALIGN_OUT_TOP_MID = 10, ALIGN_OUT_TOP_RIGHT = 11,
    ALIGN_OUT_BOTTOM_LEFT = 12, ALIGN_OUT_BOTTOM_MID = 13, ALIGN_OUT_BOTTOM_RIGHT = 14,
    ALIGN_OUT_LEFT_TOP = 15, ALIGN_OUT_LEFT_MID = 16, ALIGN_OUT_LEFT_BOTTOM = 17,
    ALIGN_OUT_RIGHT_TOP = 18, ALIGN_OUT_RIGHT_MID = 19, ALIGN_OUT_RIGHT_BOTTOM = 20;
var TEXT_MAX = 256;       /* max UTF-8 bytes of text (short inline, long PSRAM) */

/* ---- reactivity: minimal Preact-signals model (M1) ----
 * Per-signal: value + version (ver) + subscription array (subs).
 * Per-effect: dirty flag + flat dep list (_deps), rebuilt after each run so
 *   a conditional branch switch drops the now-unread signal (P2-3).
 * set() enqueues subscribers then runs ONE batched drain (no microtask).
 * __drain() guards a self-referencing (cyclic) effect: after 1024 runs it
 *   trips, logs via lume.log, and the finally block purges residual batch
 *   entries AND clears their dirty flags (P1-3) so a later write can enqueue
 *   them again instead of leaving them permanently dirty/wedged. A plain
 *   thrown effect does NOT purge the residual batch (r4 fix): remaining
 *   queued effects stay dirty and are re-drained by the next set().
 */
var __batch = [];
var __draining = false;
var __active = null;      /* effect currently running (dependency tracking) */
var __activeDeps = null;  /* fresh dep list for the current run */
var __version = 0;        /* global version tick (versioned nodes) */
var __allEffects = [];     /* app ownership, including standalone effects */

function __subscribe(sig) {
  var eff = __active;
  if (eff == null) return;
  if (sig._subs.indexOf(eff) < 0) sig._subs.push(eff);
  if (__activeDeps.indexOf(sig) < 0) __activeDeps.push(sig);
}
function __rebuildDeps(eff, touched) {
  /* Preact-signals-style cleanup: deps not touched in the last run are stale
   * (e.g. an if/else branch switched) -> unlink this effect from them. */
  var old = eff._deps;
  for (var i = 0; i < old.length; i++) {
    if (touched.indexOf(old[i]) < 0) {
      var subs = old[i]._subs;
      var k = subs.indexOf(eff);
      if (k >= 0) subs.splice(k, 1);
    }
  }
  eff._deps = touched;
}
function __runEffect(eff) {
  if (eff.dead) return;    /* disposed: never run again */
  var prev = __active, prevDeps = __activeDeps;
  var touched = [];
  __active = eff;
  __activeDeps = touched;
  try { eff.fn(); }
  finally {
    __active = prev;
    __activeDeps = prevDeps;
    __rebuildDeps(eff, touched);
  }
}
function __enqueue(eff) {
  if (eff.dirty) return;   /* dirty flag: no duplicate enqueue */
  eff.dirty = true;
  __batch.push(eff);
}
function __drain() {
  if (__draining) return;  /* batches, not nested drains / no microtask */
  __draining = true;
  var overflow = false;
  try {
    var guard = 0;
    while (__batch.length) {
      var eff = __batch.shift();
      eff.dirty = false;
      __runEffect(eff);
      if (++guard > 1024) { overflow = true; break; }
    }
    if (overflow) {
      lume.log('lume: signals drain guard tripped (>1024 runs); residual batch dropped');
    }
  } catch (e) {
    /* r4 P1 fix: a thrown effect must NOT purge the residual batch — the
     * remaining (unrelated) effects keep their dirty flags and stay queued;
     * the next set() re-drains them. Only the cyclic guard's overflow exit
     * may drop the batch (self-ref cycle is wedged by design). */
    if (!overflow) throw e;
  } finally {
    /* Drop residual entries ONLY on the guard-overflow exit path; reset
     * their dirty flags so a later write can enqueue them again. */
    if (overflow) while (__batch.length) __batch.shift().dirty = false;
    __draining = false;    /* never wedge the batch queue on a thrown effect */
  }
}
function signal(value) {
  var subs = [];
  var ver = 0;             /* per-signal version */
  function read() {
    __subscribe(read);     /* read == subscribe (no-op when no active effect) */
    return value;
  }
  read._subs = subs;
  read._ver = function () { return ver; };
  read.set = function (v) {
    if (v === value) return;             /* equality check: no propagation */
    value = v;
    ver++;
    __version++;
    for (var i = 0; i < subs.length; i++) __enqueue(subs[i]);
    __drain();                          /* single batched drain */
  };
  return read;
}
/* Theme snapshots live in a signal; style effects subscribe only when they use
 * a named color or the implicit radius. set() validates before publishing. */
var __theme = signal({colors: {}, radius: undefined, fontScale: 1});
lume.theme = {
  set: function (next) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('lume: theme must be an object');
    var colors = {};
    if (next.colors !== undefined) {
      if (!next.colors || typeof next.colors !== 'object' || Array.isArray(next.colors)) throw new TypeError('lume: theme colors must be an object');
      for (var key in next.colors) {
        if (!Object.prototype.hasOwnProperty.call(next.colors, key)) continue;
        if (!/^#[0-9a-fA-F]{6}$/.test(next.colors[key])) throw new Error('lume: theme color must be #RRGGBB');
        colors[key] = next.colors[key];
      }
    }
    var radius = next.radius;
    if (radius !== undefined && (typeof radius !== 'number' || !isFinite(radius) || radius < 0 || Math.floor(radius) !== radius))
      throw new Error('lume: theme radius must be nonnegative integer pixels');
    var fontScale = next.fontScale === undefined ? 1 : next.fontScale;
    if (typeof fontScale !== 'number' || !isFinite(fontScale) || fontScale <= 0)
      throw new Error('lume: theme fontScale must be positive');
    __theme.set({colors: colors, radius: radius, fontScale: fontScale});
  },
  get: function () {
    var current = __theme();
    var colors = {};
    for (var key in current.colors) if (Object.prototype.hasOwnProperty.call(current.colors, key)) colors[key] = current.colors[key];
    return {colors: colors, radius: current.radius, fontScale: current.fontScale};
  }
};
function effect(fn) {
  var eff = { fn: fn, dirty: false, _deps: [] };
  __allEffects.push(eff);
  __runEffect(eff);        /* run once, auto-track deps */
  return eff;
}

/* App lifecycle is registered on the engine task and follows registration order. */
var __lifecycle = {start: [], pause: [], resume: [], back: []};
var __appPaused = false, __appClosed = false;
function __onLifecycle(kind, cb) {
  if (typeof cb !== 'function') throw new TypeError('lume.app callback must be a function');
  var list = __lifecycle[kind];
  list.push(cb);
  return function () { var i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
}
lume.app = {
  onStart: function (cb) { return __onLifecycle('start', cb); },
  onPause: function (cb) { return __onLifecycle('pause', cb); },
  onResume: function (cb) { return __onLifecycle('resume', cb); },
  onBack: function (cb) { return __onLifecycle('back', cb); }
};
/* Multi-app (r30): installed apps with their meta.json merged in. The native
 * side returns raw ids; parsing meta here keeps the firmware JSON-free. */
lume.apps = lume.apps || {};
lume.apps.entries = function () {
  var out = [];
  if (typeof lume.apps.list !== 'function') return out;
  var ids = lume.apps.list();
  if (!Array.isArray(ids)) return out;
  for (var i = 0; i < ids.length; i++) {
    var meta = {};
    var raw = typeof lume.apps.meta === 'function' ? lume.apps.meta(ids[i]) : -1;
    if (typeof raw === 'string' && raw.length) {
      try { meta = JSON.parse(raw) || {}; } catch (e) { meta = {}; }
    }
    var label = meta.label || ids[i];
    out.push({ id: ids[i], label: label, icon: meta.icon || String(label).slice(0, 1),
      color: meta.color || '#385CA5' });
  }
  return out;
};
function __fireLifecycle(kind) {
  var list = __lifecycle[kind].slice();
  for (var i = 0; i < list.length; i++) {
    try { if (list[i]() === true && kind === 'back') return true; }
    catch (e) { lume.log('lume.app ' + kind + ' callback: ' + e); }
  }
  return false;
}
function __lume_start() { if (!__appClosed) __fireLifecycle('start'); }
function __lume_pause() { if (!__appClosed && !__appPaused) { __appPaused = true; __fireLifecycle('pause'); } }
function __lume_resume() { if (!__appClosed && __appPaused) { __appPaused = false; __fireLifecycle('resume'); } }
function __lume_back() { return !__appClosed && __fireLifecycle('back'); }

/* The 20ms engine queue wait is the timer tick source. The native clock is
 * monotonic; callbacks run here, never on an esp_timer or LVGL task. */
var __timers = {}, __nextTimer = 1;
function __setTimer(cb, delay, repeat) {
  if (typeof cb !== 'function') throw new TypeError('timer callback must be a function');
  if (typeof delay !== 'number' || !isFinite(delay) || delay < 0)
    throw new RangeError('timer delay must be a finite nonnegative number');
  var ms = Math.ceil(delay);
  if (repeat && ms < 1) ms = 1;
  var id = __nextTimer++;
  __timers[id] = {cb: cb, due: lume._nowMs() + ms, period: ms, repeat: repeat};
  return id;
}
lume.system = {
  setInterval: function (cb, ms) { return __setTimer(cb, ms, true); },
  setTimeout: function (cb, ms) { return __setTimer(cb, ms, false); },
  clearInterval: function (id) { delete __timers[id]; },
  clearTimeout: function (id) { delete __timers[id]; },
  /* r128: wall clock (unix ms) + bounded SNTP sync; natives live on lume as
   * _systemTime/_systemSetTimeNtp. setTimeNtp BLOCKS the engine task. */
  time: function () { return lume._systemTime(); },
  /* r177: read-only compile-time board name from the HAL registry. */
  get board() { return lume._systemBoard(); },
  setTimeNtp: function (server, timeoutMs) { return lume._systemSetTimeNtp(server, timeoutMs); },
  /* r141: reboot() is the native itself, so extra args reach its argc guard. */
  reboot: lume._systemReboot,
  log: lume.log
};
/* Wake callbacks run after panel sleep-out and full-redraw scheduling. */
lume.power = lume.power || {};
var __wakeCallbacks = [];
lume.power.sleepNow = function () {
  var status = lume.power._sleepNow();
  if (status === 0) {
    var callbacks = __wakeCallbacks.slice();
    for (var i = 0; i < callbacks.length; i++) callbacks[i]();
  }
  return status;
};
lume.power.wake = function () { return lume.power._wake(); };
lume.power.onWake = function (cb) {
  if (typeof cb !== 'function') throw new TypeError('wake callback must be a function');
  __wakeCallbacks.push(cb);
  return function () { var i = __wakeCallbacks.indexOf(cb); if (i >= 0) __wakeCallbacks.splice(i, 1); };
};
function __lume_tick() {
  if (__appClosed || __appPaused) return;
  var now = lume._nowMs(), ids = Object.keys(__timers);
  for (var key in __lists) __lists[key].flush();
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i], t = __timers[id];
    if (!t || now < t.due) continue;
    if (t.repeat) t.due = now + t.period; /* skip missed ticks; no burst */
    else delete __timers[id];
    t.cb();
  }
}
function __lume_shutdown() {
  if (__appClosed) return;
  __lume_pause();
  __appClosed = true;
  __lifecycle = {start: [], pause: [], resume: [], back: []};
  __timers = {};
  __wakeCallbacks = [];
  for (var key in __animActive) {
    var parts = key.split(':');
    lume.nativeAnimateCancel(Number(parts[0]), Number(parts[1]));
    __animForget(key);
  }
  for (var id in __ownedEffects) __dispose(Number(id));
  for (var i = 0; i < __allEffects.length; i++) {
    var eff = __allEffects[i];
    if (eff.dead) continue;
    eff.dead = true;
    for (var j = 0; j < eff._deps.length; j++) {
      var subs = eff._deps[j]._subs, k = subs.indexOf(eff);
      if (k >= 0) subs.splice(k, 1);
    }
    eff._deps = [];
  }
  __allEffects = []; __batch = []; __pressHandlers = {}; __scrollHandlers = {}; __lists = {};
  __gestureStates = {}; __gestureHandlers = {}; __gestureConsumed = {};
  __animCallbacks = {}; __animActive = {}; __animKey = {};
  __ownedEffects = {}; __canvasAlloc = {}; __canvasBytes = 0;
  __active = null; __activeDeps = null; __version = 0;
}
/* ---- declarative UI ---- */
var __pressHandlers = {};  /* node_id -> js onPress callback */
var __scrollHandlers = {}; /* node_id -> scroll offset callback */
var __lists = {};          /* active virtual lists */
var __animCallbacks = {};  /* token -> JS callback, engine task only */
var __animActive = {};     /* node/attr -> token */
var __animKey = {};        /* token -> node/attr */
function __animAttr(name) {
  var attrs = {x: ATTR_X, y: ATTR_Y, width: ATTR_WIDTH, height: ATTR_HEIGHT, opacity: ATTR_OPACITY};
  if (!Object.prototype.hasOwnProperty.call(attrs, name)) throw new Error('lume: nonnumeric or unsupported animation attr ' + name);
  return attrs[name];
}
function __animEasing(name) {
  var names = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
  var i = names.indexOf(name === undefined ? 'linear' : name);
  if (i < 0) throw new Error('lume: unsupported easing ' + name);
  return i;
}
function __animForget(key) {
  var old = __animActive[key];
  if (old !== undefined) { delete __animCallbacks[old]; delete __animKey[old]; delete __animActive[key]; }
}
function __animTo(id, attr, from, to, duration, easing, callback) {
  if (typeof to !== 'number' || !isFinite(to) || Math.floor(to) !== to ||
      typeof duration !== 'number' || !isFinite(duration) || Math.floor(duration) !== duration || duration < 1 || duration > 60000)
    throw new Error('lume: animation needs integer to and durationMs 1..60000');
  if (attr === ATTR_OPACITY && (to < 0 || to > 255)) throw new Error('lume: opacity must be 0..1');
  var key = id + ':' + attr;
  var token = lume.nativeAnimate(id, attr, from, to, duration, __animEasing(easing));
  __animForget(key);
  __animActive[key] = token;
  __animKey[token] = key;
  if (typeof callback === 'function') __animCallbacks[token] = callback;
  return token;
}
lume.anim = {
  to: function (node, options) {
    if (!options) throw new Error('lume: animation options required');
    var attr = __animAttr(options.attr);
    var to = attr === ATTR_OPACITY ? Math.round(options.to * 255) : options.to;
    var from = options.from === undefined ? null : (attr === ATTR_OPACITY ? Math.round(options.from * 255) : options.from);
    return __animTo(node, attr, from, to, options.durationMs, options.easing, options.onComplete);
  },
  cancel: function (node, attrName) {
    var attr = __animAttr(attrName), key = node + ':' + attr;
    lume.nativeAnimateCancel(node, attr);
    __animForget(key);
  }
};
function __lume_dispatchAnimComplete(token) {
  var key = __animKey[token], cb = __animCallbacks[token];
  if (key === undefined || __animActive[key] !== token) return;
  __animForget(key);
  if (typeof cb === 'function') cb();
}
var __ownedEffects = {};   /* node_id -> [effects bound to this node] (r4) */
var __canvasAlloc = {}, __canvasBytes = 0;

/* UTF-8 byte length. C's JS_ToCStringLen encodes a JS string as UTF-8,
 * so the JS-side limit counts bytes, not UTF-16 code units. QuickJS combines a
 * surrogate pair into one 4-byte code point and keeps lone surrogates as 3
 * bytes; this loop mirrors that (see quickjs.c JS_ToCStringLen2). */
function __utf8Len(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
             s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
      n += 4; i++;          /* surrogate pair -> 4 bytes */
    } else n += 3;
  }
  return n;
}
function __checkText(s) {
  if (typeof s !== 'string') s = String(s);
  if (__utf8Len(s) > TEXT_MAX) throw new Error('lume: text exceeds ' + TEXT_MAX + ' bytes');
  return s;               /* C binding enforces the same 256-byte limit */
}
function __dispose(id) {
  /* r4 P2 fix: UI-side removal must dispose the JS side too. Delete the
   * press handler, then drop every effect bound to this subtree (dispose
   * marks eff.dead AND unlinks it from all signal sub lists) so a removed
   * signal-bound text node stops posting messages for a missing LVGL obj. */
  delete __pressHandlers[id]; delete __scrollHandlers[id]; delete __lists[id];
  delete __gestureStates[id]; delete __gestureHandlers[id]; delete __gestureConsumed[id];
  if (__canvasAlloc[id]) { __canvasBytes -= __canvasAlloc[id]; delete __canvasAlloc[id]; }
  for (var key in __animActive) if (key.indexOf(id + ':') === 0) __animForget(key);
  var ids = __ownedEffects[id];
  if (ids) {
    for (var i = 0; i < ids.length; i++) {
      var eff = ids[i];
      if (eff.dead) continue;
      eff.dead = true;
      var all = __allEffects.indexOf(eff); if (all >= 0) __allEffects.splice(all, 1);
      var q = __batch.indexOf(eff);
      if (q >= 0) { __batch.splice(q, 1); eff.dirty = false; }
      for (var s = 0; s < eff._deps.length; s++) {
        var subs = eff._deps[s]._subs;
        var k = subs.indexOf(eff);
        if (k >= 0) subs.splice(k, 1);
      }
    }
    delete __ownedEffects[id];
  }
}
function __bindText(id, text) {
  if (typeof text === 'function') {
    /* getter form: wrap in an effect so signal changes repaint the attr */
    __ownedEffects[id] = __ownedEffects[id] || [];
    __ownedEffects[id].push(effect(function () {
      lume.setAttr(id, ATTR_TEXT, __checkText(text()));
    }));
  } else {
    lume.setAttr(id, ATTR_TEXT, __checkText(text === undefined ? '' : text));
  }
}
function __bindNumeric(id, attr, source, convert, transition) {
  function send(v, first) {
    var n = convert(v);
    if (first || !transition) { __animForget(id + ':' + attr); lume.setAttr(id, attr, n); }
    else __animTo(id, attr, null, n, transition.durationMs, transition.easing);
  }
  if (typeof source === 'function') {
    var first = true;
    __ownedEffects[id] = __ownedEffects[id] || [];
    __ownedEffects[id].push(effect(function () { send(source(), first); first = false; }));
  } else send(source, true);
}
function __pixel(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) throw new Error('lume: expected nonnegative integer pixels');
  return v;
}
function __opacity(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1) throw new Error('lume: opacity must be 0..1');
  return Math.round(v * 255);
}
/* Colour coercion shared by style handling and the Arc component: accepts a
 * legacy number, a theme colour key, or #RRGGBB. */
function __color(v) {
  if (typeof v === 'number') return v; /* legacy numeric bg */
  if (typeof v === 'string' && v.charAt(0) !== '#') {
    var colors = __theme().colors;
    if (Object.prototype.hasOwnProperty.call(colors, v)) v = colors[v];
  }
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error('lume: expected #RRGGBB');
  return parseInt(v.slice(1), 16);
}
/* Alignment accepts the ALIGN_* constants or their kebab-case names. The
 * outside-* entries place the node next to its base instead of inside it and
 * imply a base object (see alignTo). above/below/left-of/right-of are the
 * mid-edge aliases. */
var __ALIGN_NAMES = {'center': 0, 'top-left': 1, 'top-mid': 2, 'top-right': 3,
  'bottom-mid': 4, 'bottom-left': 5, 'bottom-right': 6, 'left-mid': 7, 'right-mid': 8,
  'outside-top-left': 9, 'outside-top-mid': 10, 'outside-top-right': 11,
  'outside-bottom-left': 12, 'outside-bottom-mid': 13, 'outside-bottom-right': 14,
  'outside-left-top': 15, 'outside-left-mid': 16, 'outside-left-bottom': 17,
  'outside-right-top': 18, 'outside-right-mid': 19, 'outside-right-bottom': 20,
  'above': 10, 'below': 13, 'left-of': 16, 'right-of': 19};
function __alignValue(v) {
  if (typeof v === 'number') {
    if (!isFinite(v) || Math.floor(v) !== v || v < 0 || v > 20) throw new Error('lume: align must be an ALIGN_* constant');
    return v;
  }
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(__ALIGN_NAMES, v)) return __ALIGN_NAMES[v];
  throw new Error('lume: unsupported align ' + v);
}
/* r204: `nodeType` is passed only by content nodes (Text / Canvas / Image).
 * They skip implicit theme-radius inheritance: a rounded clip rect combined
 * with scroll:'none' cuts the first/last glyph corners and canvas pixels.
 * Box nodes (View / Row / Column / List / Button / Arc) keep the old default. */
function __applyAttrs(id, p, nodeType) {
  var s = p.style || {};
  var color = __color;
  var tr = s.transition;
  if (tr) {
    if (tr.property !== 'bg') __animAttr(tr.property);
    if (typeof tr.durationMs !== 'number' || !isFinite(tr.durationMs) || Math.floor(tr.durationMs) !== tr.durationMs || tr.durationMs < 1 || tr.durationMs > 60000) throw new Error('lume: transition durationMs must be 1..60000');
    __animEasing(tr.easing);
  }
  function numeric(name, attr, v, convert) {
    __bindNumeric(id, attr, v, convert, tr && tr.property === name ? tr : null);
  }
  function size(v, px, pct, auto, name) {
    if (typeof v === 'function') {
      numeric(name, px, v, function (n) { return __pixel(n); });
      return;
    }
    if (tr && tr.property === name && typeof v !== 'number') throw new Error('lume: transition size needs pixel value');
    if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) numeric(name, px, v, __pixel);
    else if (v === 'auto') lume.setAttr(id, auto, 1);
    else if (typeof v === 'string' && /^(100|[0-9]?[0-9])%$/.test(v)) lume.setAttr(id, pct, parseInt(v, 10));
    else throw new Error('lume: expected pixel number, 0%-100% or auto');
  }
  function choice(v, names, attr) {
    var n = names.indexOf(v);
    if (n < 0) throw new Error('lume: unsupported style value ' + v);
    lume.setAttr(id, attr, n);
  }
  function metric(v, attr) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) throw new Error('lume: expected nonnegative integer style metric');
    lume.setAttr(id, attr, v);
  }
  /* Alignment offsets and margins are signed; the wire slot is int16. */
  function offset(v, attr) {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < -32768 || v > 32767) throw new Error('lume: expected integer pixel offset');
    lume.setAttr(id, attr, v);
  }
  function grow(v) {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 0 || v > 255) throw new Error('lume: flexGrow must be an integer 0..255');
    lume.setAttr(id, ATTR_FLEX_GROW, v);
  }
  /* translate moves the node without touching x/y, so it survives alignment
   * (and unlike x/y it accepts a percentage of the node's own size). */
  function translate(v, px, pct) {
    if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= -32768 && v <= 32767) { lume.setAttr(id, px, v); return; }
    if (typeof v === 'string' && /^(100|[0-9]?[0-9])%$/.test(v)) { lume.setAttr(id, pct, parseInt(v, 10)); return; }
    throw new Error('lume: expected signed integer pixels or 0%-100% for translate');
  }
  if (tr && (tr.property === 'bg' ? s.background === undefined && p.bg === undefined : s[tr.property] === undefined)) throw new Error('lume: transition property needs a style value');
  var bg = s.background === undefined ? p.bg : s.background;
  if (bg !== undefined) {
    if (typeof bg === 'function') {
      __ownedEffects[id] = __ownedEffects[id] || [];
      __ownedEffects[id].push(effect(function () { lume.setAttr(id, ATTR_BG_COLOR, color(bg())); }));
    } else if (typeof bg === 'string' && bg.charAt(0) !== '#') {
      __ownedEffects[id] = __ownedEffects[id] || [];
      __ownedEffects[id].push(effect(function () { lume.setAttr(id, ATTR_BG_COLOR, color(bg)); }));
    } else lume.setAttr(id, ATTR_BG_COLOR, color(bg));
  }
  var w = s.width === undefined ? p.w : s.width;
  var h = s.height === undefined ? p.h : s.height;
  if (w !== undefined) size(w, ATTR_WIDTH, ATTR_WIDTH_PCT, ATTR_WIDTH_AUTO, 'width');
  if (h !== undefined) size(h, ATTR_HEIGHT, ATTR_HEIGHT_PCT, ATTR_HEIGHT_AUTO, 'height');
  if (s.minWidth !== undefined) metric(s.minWidth, ATTR_MIN_WIDTH);
  if (s.maxWidth !== undefined) metric(s.maxWidth, ATTR_MAX_WIDTH);
  if (s.minHeight !== undefined) metric(s.minHeight, ATTR_MIN_HEIGHT);
  if (s.maxHeight !== undefined) metric(s.maxHeight, ATTR_MAX_HEIGHT);
  if (s.position !== undefined) {
    if (s.position !== 'absolute' && s.position !== 'relative') throw new Error('lume: position must be absolute or relative');
    if (s.position === 'absolute') lume.setAttr(id, ATTR_IGNORE_LAYOUT, 1);
  }
  if (s.translateX !== undefined) translate(s.translateX, ATTR_TRANSLATE_X, ATTR_TRANSLATE_X_PCT);
  if (s.translateY !== undefined) translate(s.translateY, ATTR_TRANSLATE_Y, ATTR_TRANSLATE_Y_PCT);
  if (s.textAlign !== undefined) choice(s.textAlign, ['left','center','right','auto'], ATTR_TEXT_ALIGN);
  if (s.longMode !== undefined) choice(s.longMode, ['wrap','dots','scroll','scroll-circular','clip'], ATTR_TEXT_LONG_MODE);
  /* r35 typography: fontSize snaps to the nearest bundled face in the bridge;
   * theme.fontScale (r18 signal) multiplies in before the snap, so 14 * 1.25
   * rounds to the 20 px face. letterSpacing/lineHeight pass through signed. */
  function __fontPx(v) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0 || Math.floor(v) !== v)
      throw new Error('lume: fontSize must be a positive integer px size');
    var scale = 1;
    try { scale = lume.theme.get().fontScale || 1; } catch (e) { scale = 1; }
    if (typeof scale !== 'number' || !isFinite(scale) || scale <= 0) scale = 1;
    return Math.round(v * scale);
  }
  if (s.fontSize !== undefined) {
    if (typeof s.fontSize === 'function') numeric('fontSize', ATTR_TEXT_FONT, s.fontSize, __fontPx);
    else lume.setAttr(id, ATTR_TEXT_FONT, __fontPx(s.fontSize));
  }
  function __spacePx(v) {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < -32768 || v > 32767)
      throw new Error('lume: expected integer px spacing');
    return v;
  }
  if (s.letterSpacing !== undefined) numeric('letterSpacing', ATTR_LETTER_SPACE, s.letterSpacing, __spacePx);
  if (s.lineHeight !== undefined) numeric('lineHeight', ATTR_LINE_SPACE, s.lineHeight, __spacePx);
  if (s.x !== undefined) numeric('x', ATTR_X, s.x, __pixel);
  if (s.y !== undefined) numeric('y', ATTR_Y, s.y, __pixel);
  if (s.scroll !== undefined) choice(s.scroll, ['none','vertical','horizontal'], ATTR_SCROLL_DIR);
  if (s.scrollbar !== undefined) choice(s.scrollbar, ['off','auto','on'], ATTR_SCROLLBAR_MODE);
  if (s.display !== undefined && s.display !== 'flex') throw new Error('lume: only flex display is supported');
  if (s.display === 'flex' || s.flexDirection !== undefined || s.flexWrap !== undefined) {
    var dir = s.flexDirection || 'row', wrap = s.flexWrap || 'nowrap';
    if (wrap !== 'nowrap' && wrap !== 'wrap') throw new Error('lume: unsupported flexWrap');
    choice(dir + (wrap === 'wrap' ? '-wrap' : ''), ['row','column','row-wrap','column-wrap'], ATTR_FLEX_FLOW);
  }
  if (s.justifyContent !== undefined) choice(s.justifyContent, ['start','end','center','space-between','space-around','space-evenly'], ATTR_FLEX_MAIN_ALIGN);
  if (s.alignItems !== undefined) choice(s.alignItems, ['start','end','center','stretch'], ATTR_FLEX_CROSS_ALIGN);
  if (s.padding !== undefined) metric(s.padding, ATTR_PADDING);
  /* Per-side padding is applied after the box shorthand so it wins. */
  if (s.paddingTop !== undefined) metric(s.paddingTop, ATTR_PAD_TOP);
  if (s.paddingRight !== undefined) metric(s.paddingRight, ATTR_PAD_RIGHT);
  if (s.paddingBottom !== undefined) metric(s.paddingBottom, ATTR_PAD_BOTTOM);
  if (s.paddingLeft !== undefined) metric(s.paddingLeft, ATTR_PAD_LEFT);
  if (s.margin !== undefined) metric(s.margin, ATTR_MARGIN);
  if (s.marginTop !== undefined) metric(s.marginTop, ATTR_MARGIN_TOP);
  if (s.marginRight !== undefined) metric(s.marginRight, ATTR_MARGIN_RIGHT);
  if (s.marginBottom !== undefined) metric(s.marginBottom, ATTR_MARGIN_BOTTOM);
  if (s.marginLeft !== undefined) metric(s.marginLeft, ATTR_MARGIN_LEFT);
  if (s.flexGrow !== undefined) grow(s.flexGrow);
  if (s.gap !== undefined) metric(s.gap, ATTR_GAP);
  if (s.borderRadius !== undefined) metric(s.borderRadius, ATTR_RADIUS);
  else if (nodeType !== NODE_TEXT && nodeType !== NODE_CANVAS && nodeType !== NODE_IMAGE) {
    __ownedEffects[id] = __ownedEffects[id] || [];
    var lastRadius;
    __ownedEffects[id].push(effect(function () {
      var radius = __theme().radius;
      if (radius !== lastRadius) {
        lume.setAttr(id, ATTR_RADIUS, radius === undefined ? 0 : radius);
        lastRadius = radius;
      }
    }));
  }
  if (s.borderWidth !== undefined) metric(s.borderWidth, ATTR_BORDER_WIDTH);
  if (s.borderColor !== undefined) {
    if (typeof s.borderColor === 'function' || (typeof s.borderColor === 'string' && s.borderColor.charAt(0) !== '#')) {
      __ownedEffects[id] = __ownedEffects[id] || [];
      __ownedEffects[id].push(effect(function () {
        var value = typeof s.borderColor === 'function' ? s.borderColor() : s.borderColor;
        lume.setAttr(id, ATTR_BORDER_COLOR, color(value));
      }));
    } else lume.setAttr(id, ATTR_BORDER_COLOR, color(s.borderColor));
  }
  if (s.opacity !== undefined) numeric('opacity', ATTR_OPACITY, s.opacity, __opacity);
  /* alignTo aligns against another node id (0 = parent); alignOffset shifts
   * the result. ATTR_ALIGN is sent LAST because LVGL alignment overrides any
   * earlier x/y. */
  if (p.alignTo !== undefined) {
    var target = p.alignTo;
    if (typeof target !== 'number' || !isFinite(target) || Math.floor(target) !== target || target < 0) throw new Error('lume: alignTo must be a node id (0 = parent)');
    lume.setAttr(id, ATTR_ALIGN_TARGET, target);
  }
  if (p.alignOffset !== undefined) {
    var ao = p.alignOffset;
    if (typeof ao !== 'object' || ao === null) throw new Error('lume: alignOffset must be {x, y}');
    if (ao.x !== undefined) offset(ao.x, ATTR_ALIGN_OFS_X);
    if (ao.y !== undefined) offset(ao.y, ATTR_ALIGN_OFS_Y);
  }
  if (p.align !== undefined) lume.setAttr(id, ATTR_ALIGN, __alignValue(p.align));
  else if (!p.style || p.alignTo !== undefined) lume.setAttr(id, ATTR_ALIGN, ALIGN_CENTER);
  if (p.visible !== undefined) lume.setAttr(id, ATTR_VISIBLE, p.visible ? 1 : 0);
}
function View(props, children) {
  props = props || {};
  var id = lume.createNode(NODE_VIEW, props.parent || 0);
  __applyAttrs(id, props);
  if (typeof props.onPress === 'function') { __pressHandlers[id] = props.onPress; lume.setPressEvent(id); }
  if (typeof props.onScroll === 'function') __scrollHandlers[id] = props.onScroll;
  if (children) {
    for (var i = 0; i < children.length; i++) {  /* append in order */
      lume.setAttr(children[i], ATTR_PARENT, id);
    }
  }
  return id;
}
function Text(props) {
  props = props || {};
  var id = lume.createNode(NODE_TEXT, props.parent || 0);
  __applyAttrs(id, props, NODE_TEXT);
  if (props.text !== undefined) __bindText(id, props.text);
  return id;
}
/* Row/Column: layout containers that only preset the flex axis, so an app
 * does not repeat display/flexDirection. The axis is forced (a conflicting
 * flexDirection in the passed style is overwritten). */
function __flexBox(direction, props, children) {
  props = props || {};
  var style = {}, src = props.style || {};
  for (var key in src) style[key] = src[key];
  style.display = 'flex';
  style.flexDirection = direction;
  var own = {};
  for (var name in props) own[name] = props[name];
  own.style = style;
  return View(own, children);
}
function Row(props, children) { return __flexBox('row', props, children); }
function Column(props, children) { return __flexBox('column', props, children); }
function __arcPercent(v) {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
/* Native LVGL arc (anti-aliased ring). style.background is the value ring
 * colour, `track` the background ring; value 0..100 across start->end. */
function Arc(props) {
  props = props || {};
  /* style.background is the ring colour for an arc, NOT a box fill: strip it
   * before __applyAttrs so it can never reach ATTR_BG_COLOR (which forces an
   * opaque rounded background). `color` is the same value in prop form. */
  var src = props.style || {};
  var style = {}, ring;
  for (var sk in src) { if (sk === 'background') ring = src[sk]; else style[sk] = src[sk]; }
  if (ring === undefined) ring = props.color === undefined ? '#34D399' : props.color;
  var clean = {};
  for (var pk in props) { if (pk !== 'style' && pk !== 'color') clean[pk] = props[pk]; }
  clean.style = style;
  var id = lume.createNode(NODE_ARC, props.parent || 0);
  __applyAttrs(id, clean);
  if (typeof ring === 'function') {
    __ownedEffects[id] = __ownedEffects[id] || [];
    __ownedEffects[id].push(effect(function () { lume.setAttr(id, ATTR_ARC_COLOR, __color(ring())); }));
  } else lume.setAttr(id, ATTR_ARC_COLOR, __color(ring));
  var start = props.start === undefined ? 135 : props.start;
  var end = props.end === undefined ? 45 : props.end;
  lume.setAttr(id, ATTR_ARC_START, __pixel(start));
  lume.setAttr(id, ATTR_ARC_END, __pixel(end));
  if (props.thickness !== undefined) lume.setAttr(id, ATTR_ARC_THICKNESS, __pixel(props.thickness));
  if (props.track !== undefined) lume.setAttr(id, ATTR_ARC_TRACK, __color(props.track));
  var value = props.value === undefined ? 0 : props.value;
  if (typeof value === 'function') {
    __ownedEffects[id] = __ownedEffects[id] || [];
    __ownedEffects[id].push(effect(function () {
      lume.setAttr(id, ATTR_ARC_VALUE, __arcPercent(value()));
    }));
  } else lume.setAttr(id, ATTR_ARC_VALUE, __arcPercent(value));
  return id;
}
function Button(props) {
  props = props || {};
  var id = lume.createNode(NODE_BUTTON, props.parent || 0);
  __applyAttrs(id, props);
  if (props.title !== undefined) __bindText(id, props.title);
  if (typeof props.onPress === 'function') {
    __pressHandlers[id] = props.onPress;
    lume.setPressEvent(id);
  }
  return id;
}
function Image(props) {
  if (!props || !(props.src instanceof ArrayBuffer)) return -1;
  var size = lume.image.sizeOf(props.src);
  if (typeof size === 'number') return size;
  var style = {}, input = props.style || {};
  for (var key in input) style[key] = input[key];
  if (style.width === undefined && style.height === undefined) { style.width = size.width; style.height = size.height; }
  else if (typeof style.width === 'number' && style.height === undefined) style.height = Math.max(1, Math.round(style.width * size.height / size.width));
  else if (typeof style.height === 'number' && style.width === undefined) style.width = Math.max(1, Math.round(style.height * size.width / size.height));
  var id = lume.createNode(NODE_IMAGE, props.parent || 0);
  var own = {}; for (var name in props) own[name] = props[name]; own.style = style;
  __applyAttrs(id, own, NODE_IMAGE);
  var rc = lume.image._setSource(id, props.src, style.width, style.height);
  if (rc < 0) { lume.removeChild(id); return rc; }
  return id;
}
/* Fixed-height window: spacer owns scroll extent; rows ignore flex layout. */
function List(props) {
  props = props || {};
  if (typeof props.renderItem !== 'function') throw new TypeError('lume: List needs renderItem');
  var height = __pixel(props.itemHeight);
  if (!height) throw new Error('lume: List itemHeight must be positive');
  var overscan = props.overscan === undefined ? 3 : __pixel(props.overscan);
  if (overscan > 20) throw new Error('lume: List overscan must be <=20');
  var style = props.style || {};
  var viewport = __pixel(style.height);
  if (!viewport) throw new Error('lume: List needs pixel style.height');
  var ownStyle = {};
  for (var key in style) ownStyle[key] = style[key];
  ownStyle.scroll = 'vertical';
  if (ownStyle.scrollbar === undefined) ownStyle.scrollbar = 'auto';
  var y = 0, rows = {}, data = [], pending = false, total = -1, waiting = [];
  var id = View({style: ownStyle, parent: props.parent, onScroll: function (offset) {
    y = Math.max(0, offset); pending = true;
  }});
  var spacer = View({parent: id, style: {width: 1, height: 0}});
  function range() {
    var first = Math.max(0, Math.floor(y / height) - overscan);
    var end = Math.min(data.length, Math.ceil((y + viewport) / height) + overscan);
    return [first, end];
  }
  function clear() {
    for (var key in rows) { waiting.push(rows[key]); lume.removeChild(rows[key]); delete rows[key]; }
  }
  function flush() {
    if (!pending) return;
    pending = false;
    var window = range();
    for (var key in rows) if (+key < window[0] || +key >= window[1]) {
      waiting.push(rows[key]); lume.removeChild(rows[key]); delete rows[key];
    }
    /* A removal needs an LVGL acknowledgement before its id is reused. */
    if (waiting.length) { pending = true; return; }
    for (var i = window[0]; i < window[1]; i++) {
      if (rows[i] !== undefined) continue;
      var row = props.renderItem(data[i], i);
      if (typeof row !== 'number') throw new TypeError('lume: renderItem must return a Node');
      lume.setAttr(row, ATTR_IGNORE_LAYOUT, 1);
      lume.setAttr(row, ATTR_Y, i * height);
      lume.setAttr(row, ATTR_HEIGHT, height);
      lume.setAttr(row, ATTR_PARENT, id);
      rows[i] = row;
    }
  }
  __lists[id] = {flush: flush, removed: function (nodeId) {
    var at = waiting.indexOf(nodeId); if (at >= 0) { waiting.splice(at, 1); pending = true; }
  }};
  __ownedEffects[id] = __ownedEffects[id] || [];
  var read = typeof props.items === 'function' ? props.items : function () { return props.items; };
  __ownedEffects[id].push(effect(function () {
    var next = read();
    if (!Array.isArray(next)) throw new TypeError('lume: List items must be an array');
    var countChanged = total >= 0 && next.length !== total;
    total = next.length; data = next;
    if (total * height > 2147483647) throw new RangeError('lume: List height overflow');
    clear();
    lume.setAttr(spacer, ATTR_HEIGHT, total * height);
    if (countChanged) { y = 0; lume.setAttr(id, ATTR_SCROLL_Y, 0); }
    pending = true;
  }));
  flush();
  return id;
}
/* Canvas draws are an owned effect: signal reads inside onDraw subscribe. */
/* These two helpers sit on the hot path of every line segment. On the board's
 * QuickJS (~0.5 Mops/s) the old per-segment regex + six helper calls cost about
 * 450 us per segment, so keep a one-entry color cache and an integer fast path.
 * Accepted values and thrown messages are unchanged. */
var __canvasColorKey = null, __canvasColorVal = 0;
function __canvasColor(v) {
  if (v === __canvasColorKey) return __canvasColorVal;
  var out;
  if (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 0xffffff && Math.floor(v) === v) out = v;
  else if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out = parseInt(v.slice(1), 16);
  else throw new Error('lume: canvas color must be #RRGGBB');
  __canvasColorKey = v; __canvasColorVal = out;
  return out;
}
function __canvasInt(v, lo, hi) {
  /* v !== (v|0) rejects non-numbers, NaN, +/-Infinity and fractions in one test. */
  if (v !== (v | 0) || v < lo || v > hi)
    throw new Error('lume: canvas coordinate out of range');
  return v;
}
/* r48 native arc angles are integer degrees (the raster normalises/wraps).
 * Fractional degrees (e.g. speedAngle()) are rounded: a <=0.5deg, ~1px at
 * r=158 discretisation of the boundary, recorded in KNOWN-SIMPLIFICATIONS. */
function __canvasArcAngle(v) {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error('lume: arc angle must be a number');
  var a = Math.round(v);
  if (a < -4096 || a > 4096) throw new Error('lume: arc angle out of range');
  return a;
}
function Canvas(props) {
  props = props || {};
  var SW = __lumeScreen.w, SH = __lumeScreen.h;
  var w = __canvasInt(props.width, 1, SW), h = __canvasInt(props.height, 1, SH);
  if (typeof props.onDraw !== 'function') throw new Error('lume: Canvas needs onDraw');
  if (props.style && (props.style.width !== undefined || props.style.height !== undefined)) throw new Error('lume: Canvas size is fixed by width/height');
  if (props.singleBuffer !== undefined && typeof props.singleBuffer !== 'boolean') throw new Error('lume: singleBuffer must be a boolean');
  var singleBuf = props.singleBuffer === true;
  var cost = w * h * 2 * (singleBuf ? 1 : 2);
  if (__canvasBytes + cost > SW * SH * 4) throw new Error('lume: canvas PSRAM budget exceeded');
  var id = singleBuf
    ? lume.createNode(NODE_CANVAS, props.parent || 0, w, h, 1)
    : lume.createNode(NODE_CANVAS, props.parent || 0, w, h);
  __canvasAlloc[id] = cost; __canvasBytes += cost;
  if (props.style) __applyAttrs(id, {style: props.style}, NODE_CANVAS);
  var ink = 0xffffff, pendingLines = [], pathSeq = 0;
  function flushLines() { if (pendingLines.length) { lume.canvasBatch(id, pendingLines); pendingLines = []; } }
  function pushLine(x1,y1,x2,y2,col,wd) {
    pendingLines.push(x1,y1,x2,y2,col,wd);
    if (pendingLines.length === 192) flushLines();
  }
  function queueLine(x1,y1,x2,y2,c,width) {
    /* Same checks as four __canvasInt calls, inlined: the helper call overhead
     * alone was measurable per segment on the board. */
    if (x1 !== (x1 | 0) || y1 !== (y1 | 0) || x2 !== (x2 | 0) || y2 !== (y2 | 0) ||
        x1 < -SW || x1 > SW || y1 < -SH || y1 > SH || x2 < -SW || x2 > SW || y2 < -SH || y2 > SH)
      throw new Error('lume: canvas coordinate out of range');
    pushLine(x1,y1,x2,y2,__canvasColor(c),__canvasInt(width === undefined ? 1 : width,1,16));
  }
  var ctx = {
    nodeId: id,
    fillColor: function (c) { ink = __canvasColor(c); },
    clear: function () { flushLines(); lume.canvasDraw(id, 0, 0, 0, 0, 0, 0, 1); },
    fillRect: function (x,y,rw,rh) { flushLines(); lume.canvasDraw(id, 1, __canvasInt(x,-SW,SW), __canvasInt(y,-SH,SH), __canvasInt(rw,0,SW), __canvasInt(rh,0,SH), ink, 1); },
    line: function (x1,y1,x2,y2,c,width) {
      queueLine(x1,y1,x2,y2,c,width);
    },
    polyline: function (points,c,width) {
      if (!Array.isArray(points) || points.length > 240) throw new Error('lume: polyline needs <=240 points');
      if (points.length < 2) return;
      /* One pass: validate each point once (the old loop re-checked both ends
       * of every segment), cache the resolved color/width on the first emit. */
      var px = 0, py = 0, col = -1, wd = 1;
      for (var i=0;i<points.length;i++) {
        var p = points[i];
        if (!Array.isArray(p) || p.length !== 2) throw new Error('lume: point must be [x,y]');
        var cx = p[0], cy = p[1];
        if (cx !== (cx | 0) || cy !== (cy | 0) || cx < -SW || cx > SW || cy < -SH || cy > SH)
          throw new Error('lume: canvas coordinate out of range');
        if (i) {
          if (col < 0) { col = __canvasColor(c); wd = __canvasInt(width === undefined ? 1 : width,1,16); }
          pushLine(px,py,cx,cy,col,wd);
        }
        px = cx; py = cy;
      }
    },
    /* Upload a polyline once; drawPath() replays it from the C side, so a
     * static picture costs no JS per frame (the engine runs at ~0.5 Mops/s). */
    retainPath: function (points,c,width) {
      if (!Array.isArray(points) || points.length > 240) throw new Error('lume: polyline needs <=240 points');
      if (points.length < 2) throw new Error('lume: path needs >=2 points');
      if (pathSeq >= 8) throw new Error('lume: too many retained paths (max 8)');
      var color = 0, wd = 1, px = 0, py = 0, flat = [], styled = false;
      for (var i=0;i<points.length;i++) {
        var p = points[i];
        if (!Array.isArray(p) || p.length !== 2) throw new Error('lume: point must be [x,y]');
        var cx = p[0], cy = p[1];
        if (cx !== (cx | 0) || cy !== (cy | 0) || cx < -SW || cx > SW || cy < -SH || cy > SH)
          throw new Error('lume: canvas coordinate out of range');
        if (i) {
          if (!styled) { color = __canvasColor(c); wd = __canvasInt(width === undefined ? 1 : width,1,16); styled = true; }
          flat.push(px,py,cx,cy,color,wd);
        }
        px = cx; py = cy;
      }
      var pid = ++pathSeq;
      lume.canvasPathDefine(id, pid, flat);
      return pid;
    },
    /* Independent segments (tick marks, grids): each entry is [x1,y1,x2,y2]. */
    retainSegments: function (segs,c,width) {
      if (!Array.isArray(segs) || !segs.length || segs.length > 240) throw new Error('lume: retainSegments needs 1..240 segments');
      if (pathSeq >= 8) throw new Error('lume: too many retained paths (max 8)');
      var flat = [];
      for (var i=0;i<segs.length;i++) {
        var s = segs[i];
        if (!Array.isArray(s) || s.length !== 4) throw new Error('lume: segment must be [x1,y1,x2,y2]');
        flat.push(__canvasInt(s[0],-SW,SW),__canvasInt(s[1],-SH,SH),__canvasInt(s[2],-SW,SW),__canvasInt(s[3],-SH,SH),0,0);
      }
      var color = __canvasColor(c), wd = __canvasInt(width === undefined ? 1 : width,1,16);
      for (var k=4;k<flat.length;k+=6) { flat[k] = color; flat[k+1] = wd; }
      var pid = ++pathSeq;
      lume.canvasPathDefine(id, pid, flat);
      return pid;
    },
    drawPath: function (pid, dx, dy) {
      if (pid !== (pid | 0) || pid < 1 || pid > 8) throw new Error('lume: path id must be 1..8');
      flushLines();
      lume.canvasPathDraw(id, pid,
        __canvasInt(dx === undefined ? 0 : dx, -SW, SW),
        __canvasInt(dy === undefined ? 0 : dy, -SH, SH));
    },
    /* r81 sprite blit: upload an RGB565 bitmap once (Uint16Array, length
     * w*h), replay it from C each frame — the drawPath pattern for bitmaps.
     * Pixels equal to 0x0000 (pure black) are transparent; use #000001 for
     * near-black. drawImage(slot, dx, dy, flip) is one native call. */
    retainImage: function (slot, w, h, pixels) {
      if (slot !== (slot | 0) || slot < 1 || slot > 8) throw new Error('lume: sprite id must be 1..8');
      if (w !== (w | 0) || h !== (h | 0) || w < 1 || h < 1 || w > SW || h > SH)
        throw new Error('lume: sprite size out of range');
      if (!(pixels instanceof Uint16Array) || pixels.length !== w * h)
        throw new Error('lume: sprite pixels must be Uint16Array of length w*h');
      return lume.canvasSpriteDefine(id, slot, w, h, pixels);
    },
    drawImage: function (slot, dx, dy, flip) {
      if (slot !== (slot | 0) || slot < 1 || slot > 8) throw new Error('lume: sprite id must be 1..8');
      flushLines();
      lume.canvasSpriteDraw(id, slot,
        __canvasInt(dx === undefined ? 0 : dx, -SW, SW),
        __canvasInt(dy === undefined ? 0 : dy, -SH, SH),
        flip ? 1 : 0);
    },
    circle: function (x,y,r,c) { flushLines(); lume.canvasDraw(id,3,__canvasInt(x,-SW,SW),__canvasInt(y,-SH,SH),__canvasInt(r,0,SW),0,__canvasColor(c),1); },
    fillCircle: function (cx,cy,r,color) { flushLines(); lume.canvasDraw(id,6,__canvasInt(cx,-SW,SW),__canvasInt(cy,-SH,SH),__canvasInt(r,0,SW),0,__canvasColor(color),1); },
    fillEllipse: function (cx,cy,rx,ry,color) { flushLines(); lume.canvasDraw(id,7,__canvasInt(cx,-SW,SW),__canvasInt(cy,-SH,SH),__canvasInt(rx,0,SW),__canvasInt(ry,0,SH),__canvasColor(color),1); },
    ellipse: function (cx,cy,rx,ry,color,width) { flushLines(); lume.canvasDraw(id,8,__canvasInt(cx,-SW,SW),__canvasInt(cy,-SH,SH),__canvasInt(rx,0,SW),__canvasInt(ry,0,SH),__canvasColor(color),__canvasInt(width === undefined ? 1 : width,1,16)); },
    /* r48 native AA annulus arc (roadmap rendering-backlog #2). Angles are
     * degrees, clockwise from +x, wrapping at 360; from==to is a dot, a full
     * 360 sweep is a ring. Opcode 5 = LUME_DRAW_ARC; a=r, b=0, and the two
     * angles ride in the extra args (see js_canvas_draw). Kept alongside the
     * polyline arc path, which is left untouched for compatibility. */
    arc: function (cx,cy,r,from,to,width,color) {
      flushLines();
      lume.canvasDraw(id,5,__canvasInt(cx,-SW,SW),__canvasInt(cy,-SH,SH),__canvasInt(r,0,SW),0,__canvasColor(color),__canvasInt(width === undefined ? 1 : width,1,16),__canvasArcAngle(from),__canvasArcAngle(to));
    },
    text: function (x,y,str,c,size) {
      if (size !== undefined && size !== 14) throw new Error('lume: canvas text supports 14px font');
      flushLines(); lume.canvasDraw(id,4,__canvasInt(x,-SW,SW),__canvasInt(y,-SH,SH),0,0,__canvasColor(c),1,__checkText(str));
    }
  };
  __ownedEffects[id] = __ownedEffects[id] || [];
  __ownedEffects[id].push(effect(function () {
    var dirty; try { dirty = props.onDraw(ctx); } finally { flushLines(); }
    if (dirty === undefined || dirty === null) { lume.canvasInvalidate(id); return; }
    var areas = Array.isArray(dirty) ? dirty : [dirty];
    if (!areas.length || areas.length > 8) throw new Error('lume: expected 1..8 dirty rects');
    for (var i=0;i<areas.length;i++) {
      var r=areas[i]; if (!r || typeof r !== 'object') throw new Error('lume: dirty rect needs x/y/w/h');
      var x=__canvasInt(r.x,0,w), y=__canvasInt(r.y,0,h);
      var rw=__canvasInt(r.w,1,w), rh=__canvasInt(r.h,1,h);
      if (x+rw>w || y+rh>h) throw new Error('lume: dirty rect outside canvas');
      lume.canvasInvalidate(id,x,y,rw,rh);
    }
  }));
  return id;
}
/* ---- r21 gesture recognizer: PURE state machine (no lume.* deps) ----
 * Consumes a normalized LVGL pointer stream (DOWN/MOVE/UP + LVGL swipe-dir
 * hint) from Queue B. Thresholds are centralized in GESTURE and start from
 * the vendored LVGL defaults (components/lvgl/src/indev/lv_indev.c).
 * __gestureStep(state,input) -> event[] is pure so the host harness can
 * synthesize press/move/release sequences with no LVGL indev build. */
var GESTURE = {
  tapMovePx: 10,      /* LV_INDEV_DEF_SCROLL_LIMIT       lv_indev.c:32 */
  tapMaxMs: 400,      /* LV_INDEV_DEF_LONG_PRESS_TIME    lv_indev.c:39 */
  longpressMs: 400,   /* LV_INDEV_DEF_LONG_PRESS_TIME    lv_indev.c:39 */
  panMinPx: 12,       /* > scroll_limit(10): a List-scroll first frame can't start a pan */
  swipeMinPx: 50,     /* LV_INDEV_DEF_GESTURE_LIMIT      lv_indev.c:46 */
  swipeMinVel: 0.1    /* ~ LV_INDEV_DEF_GESTURE_MIN_VELOCITY 3px/33ms  lv_indev.c:49 */
};
function __gestureDirName(d) {
  if (d === 1) return 'left';    /* LV_DIR_LEFT   lv_area.h:79 */
  if (d === 2) return 'right';   /* LV_DIR_RIGHT  lv_area.h:80 */
  if (d === 4) return 'up';      /* LV_DIR_TOP    lv_area.h:81 */
  if (d === 8) return 'down';    /* LV_DIR_BOTTOM lv_area.h:82 */
  return null;
}
function __gestureAxisDir(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
function __gestureNewState() {
  return {down: false, sx: 0, sy: 0, st: 0, lx: 0, ly: 0, lt: 0, panning: false, consumed: false, dir: null};
}
/* inp.kind 0=DOWN 1=MOVE 2=UP 3=SWIPEDIR; x/y absolute px, t=lv_tick_get ms,
 * dir=LVGL lv_dir bitmask (SWIPEDIR only), cancelled=1 when a List scroll won. */
function __gestureStep(s, inp) {
  var out = [], dx, dy, dt, dist, vel, dir;
  if (inp.kind === 0) {
    s.down = true; s.sx = inp.x; s.sy = inp.y; s.st = inp.t;
    s.lx = inp.x; s.ly = inp.y; s.lt = inp.t;
    s.panning = false; s.consumed = false; s.dir = null;
    return out;
  }
  if (inp.kind === 3) { s.dir = __gestureDirName(inp.dir); return out; }
  if (!s.down) return out;
  /* Displacement of the whole press so far (since DOWN). A press that has
   * moved past panMinPx is a drag, not a stationary hold: it can never be a
   * longpress and must stay swipe-eligible on release (r21 review fix). */
  dx = inp.x - s.sx; dy = inp.y - s.sy;
  var dragged = Math.abs(dx) > GESTURE.panMinPx || Math.abs(dy) > GESTURE.panMinPx;
  if (inp.kind === 1) {
    s.lx = inp.x; s.ly = inp.y; s.lt = inp.t;
    /* LV_EVENT_PRESSING repeats even when stationary -> longpress fires while
     * down, but ONLY while the finger is essentially stationary: a slow drag
     * past panMinPx must not morph into a longpress (r21 review fix). */
    if (!s.consumed && !dragged && (inp.t - s.st) >= GESTURE.longpressMs) {
      s.consumed = true;
      out.push({type: 'longpress', x: inp.x, y: inp.y});
    }
    if (!s.consumed) {
      if (dragged) {
        if (!s.panning) { s.panning = true; out.push({type: 'panstart', x: inp.x, y: inp.y, dx: dx, dy: dy}); }
        out.push({type: 'pan', x: inp.x, y: inp.y, dx: dx, dy: dy});
      }
    }
    return out;
  }
  if (inp.kind === 2) {
    dt = inp.t - s.st;
    /* Close a started pan stream even when a scroll stole the press. */
    if (s.panning) out.push({type: 'panend', x: inp.x, y: inp.y, dx: dx, dy: dy});
    if (!inp.cancelled) {
      /* longpress-on-release only for a genuinely STATIONARY hold: a drag past
       * panMinPx stays swipe-eligible (r21 review fix). */
      if (!s.consumed && !dragged && dt >= GESTURE.longpressMs) {
        s.consumed = true;
        out.push({type: 'longpress', x: inp.x, y: inp.y});
      }
      if (!s.consumed) {
        dist = Math.sqrt(dx * dx + dy * dy);
        vel = dt > 0 ? dist / dt : 0;
        if (dt < GESTURE.tapMaxMs && dist < GESTURE.tapMovePx) {
          out.push({type: 'tap', x: inp.x, y: inp.y});
        } else if (dist >= GESTURE.swipeMinPx && vel >= GESTURE.swipeMinVel) {
          dir = s.dir || __gestureAxisDir(dx, dy);
          out.push({type: 'swipe', x: inp.x, y: inp.y, dx: dx, dy: dy, dir: dir});
        }
      }
    }
    s.down = false; s.panning = false; s.dir = null; s.consumed = false;
    return out;
  }
  return out;
}
/* engine -> JS press dispatch (called from C via JS_Call) */
function __lume_dispatchScroll(nodeId, y) {
  var h = __scrollHandlers[nodeId]; if (typeof h === 'function') h(y);
}
function __lume_dispatchPress(nodeId) {
  /* r21: a longpress consumed this press -> suppress the CLICKED->onPress path
   * so longpress and onPress never double-trigger on the same node. */
  if (__gestureConsumed[nodeId]) return;
  var h = __pressHandlers[nodeId];
  if (typeof h === 'function') h();
}
/* ---- r21 gesture API: per-target subscriptions on the same event pipeline ---- */
var __gestureStates = {};    /* node_id -> __gestureNewState() */
var __gestureHandlers = {};  /* node_id -> {type: [cb, ...]} */
var __gestureConsumed = {};  /* node_id -> bool: longpress consumed this press */
lume.gesture = {
  tuning: GESTURE,
  on: function (target, type, cb) {
    if (typeof cb !== 'function') throw new TypeError('lume.gesture callback must be a function');
    if (['tap', 'swipe', 'longpress', 'pan', 'panstart', 'panend'].indexOf(type) < 0)
      throw new Error('lume: unsupported gesture type ' + type);
    var id = target;
    if (!__gestureHandlers[id]) {
      __gestureHandlers[id] = {};
      __gestureStates[id] = __gestureNewState();
      lume.setGestureEvent(id);       /* native: enable LVGL pointer events (once per node) */
    }
    var list = __gestureHandlers[id][type] || (__gestureHandlers[id][type] = []);
    list.push(cb);
    return function () { var i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
  }
};
/* engine -> JS gesture dispatch (called from C via JS_Call, Queue B).
 * kind: 0 DOWN, 1 MOVE, 2 UP, 3 SWIPEDIR; t = lv_tick_get ms. */
function __lume_dispatchGesture(nodeId, kind, x, y, t, dir, cancelled) {
  var s = __gestureStates[nodeId];
  if (!s) return;
  if (kind === 0) __gestureConsumed[nodeId] = false;   /* DOWN clears the longpress latch */
  var evts = __gestureStep(s, {kind: kind, x: x, y: y, t: t, dir: dir, cancelled: cancelled});
  for (var i = 0; i < evts.length; i++) {
    var e = evts[i];
    if (e.type === 'longpress') __gestureConsumed[nodeId] = true;
    var list = __gestureHandlers[nodeId][e.type];
    if (list) for (var j = 0; j < list.length; j++) {
      try { list[j](e); } catch (err) { lume.log('lume.gesture ' + e.type + ' callback: ' + err); }
    }
  }
}
/* engine -> JS removal hook (called from C via JS_Call after LVGL delete)
 * r4 P2: dispose press handlers + signal-bound effects of the subtree. */
function __lume_dispatchRemove(nodeId) {
  __dispose(nodeId);
  for (var key in __lists) __lists[key].removed(nodeId);
}
function __lume_dispatchCreateFailed(nodeId) {
  __dispose(nodeId);
  for (var key in __lists) __lists[key].removed(nodeId);
  lume.warn('lume create failed for node ' + nodeId);
}
/* ---- global navigation gesture (applies to EVERY app) ----
 * Swipe up anywhere -> back to the launcher. Registered on node 0 (the active
 * screen) so apps do not have to repeat it; events bubble up from whichever
 * clickable node was touched. The bridge drops the previous runtime's
 * callbacks before re-adding, so switching apps does not accumulate them. */
if (lume.gesture && typeof lume.gesture.on === 'function' &&
    lume.apps && typeof lume.apps.home === 'function') {
  lume.gesture.on(0, 'swipe', function (e) {
    if (e.dir !== 'up') return;
    var cur = lume.apps.current();
    if (typeof cur === 'string' && cur !== '') lume.apps.home();
  });
}
