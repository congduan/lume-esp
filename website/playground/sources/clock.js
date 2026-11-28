/** Clock — analog dial on one 300x300 Canvas plus digital time/date texts.
 * A 1 s interval copies the wall clock into ONE time-of-day signal (seconds
 * since midnight); the canvas effect subscribes to it (it is read inside
 * onDraw), so each second redraws exactly once — one set() triggers one
 * drain. ~105 canvas primitives per redraw, far under the ~100 primitives /
 * 128-slot queue budget.
 *
 * Time source: new Date() on the device counts from boot (no RTC battery).
 * When WiFi is already associated and has an IP (lume.net.status() reports
 * GOT_IP — the association survives app switches), the app tries the r128
 * lume.system.setTimeNtp() primitive first: a success already corrects
 * Date.now() via settimeofday(), so the local offset becomes 0. If SNTP is
 * missing / fails (-2/-3), it falls back to the r128 HTTP source list and
 * keeps the offset wall-epoch − device-epoch. No WiFi / total failure
 * degrades to device-uptime time. */
var clockTheme = { colors: {
  primary: '#0B0F14', surface: '#141A22', accent: '#2E86FF', text: '#E8EEF6'
}, radius: 12, fontScale: 1 };
lume.theme.set(clockTheme);

var C_FACE = '#141A22';
var C_TEXT = '#E8EEF6';
var C_DIM = '#5C7794';
var C_HAND = '#E8EEF6';
var C_SEC = '#F87171';

/* ---- time state: the only signal the UI subscribes to (s since midnight) ---- */
var todSig = signal(0);

var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---- network time sync (read-only: WiFi association is owned elsewhere) --
 * Polls lume.net.status(); on GOT_IP (state 3) first calls the r128 SNTP
 * primitive lume.system.setTimeNtp() with default server / default 10 s.
 * On success settimeofday() has already corrected Date.now(), so the local
 * offset is reset to 0 and the HTTP list is skipped this round. Anything
 * else (no API / -1 / -2 / -3 / thrown) falls through to the r128 HTTP path:
 * plain-HTTP time endpoints tried IN ORDER, FIRST success applied (httpGet
 * has no CA bundle, so https:// is not usable; single sources come and go,
 * hence the list). Each httpGet is SYNCHRONOUS and blocks the engine task for
 * up to HTTP_TIMEOUT_MS (worst case one full pass). Success re-syncs every
 * 10 min; no IP or total failure retries after 30 s while device time runs.
 *
 * Display timezone: on the HTTP path the device renders dates in UTC, so the
 * wall epoch is utc-epoch + tzMin minutes. tzMin comes from a source carrying
 * an explicit offset (worldtimeapi) and is persisted in kv ('clock.tzMin');
 * UTC-only sources reuse the cached value (default 480 = UTC+08:00). The SNTP
 * path leaves tzMin untouched. The offset also compensates the display
 * timezone (getTimezoneOffset), so the clock reads the same on device and in
 * the host simulator.
 *
 * wallDate() reads Date.now() (+ the HTTP offset): on the device Date.now()
 * is gettimeofday(), which SNTP corrects, while lume._nowMs() is a monotonic
 * uptime timer. With the offset at 0 the path is the identity (Date.now()),
 * which is exactly the post-SNTP wall clock. */
var SYNC_OK_MS = 600000;      /* re-sync every 10 min */
var SYNC_RETRY_MS = 30000;    /* retry after failure / while WiFi has no IP */
var HTTP_TIMEOUT_MS = 4000;
var DEFAULT_TZ_MIN = 480;     /* UTC+08:00 until a source says otherwise */
var epochOffsetMs = 0;        /* wall-epoch − device-epoch; 0 until synced */
var nextSyncMs = 0;           /* first attempt is due immediately */
var tzMin = DEFAULT_TZ_MIN;
(function () {
  /* kv.get() ambiguity (a stored negative number looks like an error code):
   * accept positive finite numbers only. */
  var t = lume.storage.kv.get('clock.tzMin');
  if (typeof t === 'number' && isFinite(t) && t > 0) tzMin = t;
})();

/* Each parse(body) returns { ms: wall-epoch ms, tz?: minutes from UTC } or
 * null. Bodies are tiny (<100 B), well under the 32 KB httpGet cap. */
var TIME_SOURCES = [
  { url: 'http://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp',
    parse: function (body) {
      var t = JSON.parse(body);
      var ms = Number(t && t.data && t.data.t);   /* UTC epoch in ms, string */
      return ms > 0 ? { ms: ms + tzMin * 60000 } : null;
    } },
  { url: 'http://quan.suning.com/getSysTime.do',
    parse: function (body) {
      var t = JSON.parse(body);
      var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
        String((t && t.sysTime2) || ''));
      if (!m) return null;
      /* sysTime2 is Beijing wall time; recover its UTC epoch (fixed +08:00) */
      var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600000;
      return { ms: utc + tzMin * 60000, tz: 480 };
    } },
  { url: 'http://worldtimeapi.org/api/ip',
    parse: function (body) {
      var t = JSON.parse(body);
      if (typeof t.unixtime !== 'number') return null;
      var off = /^([+-])(\d{2}):(\d{2})$/.exec(String(t.utc_offset || ''));
      var tz = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]))
                   : null;
      return { ms: t.unixtime * 1000 + (tz === null ? tzMin : tz) * 60000,
               tz: tz === null ? undefined : tz };
    } },
];

function syncNetTime() {
  var mono = lume._nowMs();          /* monotonic uptime: drives the cadence */
  var st = lume.net.status();
  /* status() returns an object only while the station is up; GOT_IP means a
   * usable IPv4 (what httpGet and SNTP need). Anything else: keep device time. */
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    nextSyncMs = mono + SYNC_RETRY_MS;
    return;
  }
  /* r129: SNTP-first. On success settimeofday() already made Date.now() the
   * wall clock, so reset the local offset to 0 (identity in wallDate) and
   * finish without touching the HTTP sources or the cached tzMin. Default
   * server / default 10 s timeout mirror lume.system.setTimeNtp()'s contract. */
  var sys = lume.system;
  if (sys && typeof sys.setTimeNtp === 'function') {
    try {
      if (sys.setTimeNtp() === 0) {
        epochOffsetMs = 0;
        nextSyncMs = mono + SYNC_OK_MS;
        return;                     /* wall clock is correct already */
      }
    } catch (e) { /* API threw: fall through to the HTTP source list */ }
  }
  /* HTTP fallback (r128 path, unchanged behaviour): */
  for (var i = 0; i < TIME_SOURCES.length; i++) {
    var wallMs = null, tz;
    try {
      var r = lume.net.httpGet(TIME_SOURCES[i].url, { timeoutMs: HTTP_TIMEOUT_MS });
      if (typeof r === 'object' && r !== null && r.status === 200 &&
          typeof r.body === 'string') {
        var p = TIME_SOURCES[i].parse(r.body);
        if (p) { wallMs = p.ms; tz = p.tz; }
      }
    } catch (e) { /* malformed body / transport error: try the next source */ }
    if (wallMs !== null) {
      if (typeof tz === 'number' && tz !== tzMin) {
        tzMin = tz;
        lume.storage.kv.set('clock.tzMin', tz);
      }
      /* Anchor to Date.now() (gettimeofday ms on the device, wall clock in
       * the host) and compensate the display timezone (getTimezoneOffset()
       * is 0 on the UTC device). wallDate() adds the offset back to Date.now(),
       * so this is the same wall epoch as the r128 _nowMs()-anchored path. */
      epochOffsetMs = wallMs + new Date().getTimezoneOffset() * 60000 - Date.now();
      nextSyncMs = mono + SYNC_OK_MS;
      return;
    }
  }
  nextSyncMs = mono + SYNC_RETRY_MS;  /* every source failed: retry later */
}

/** wall-clock Date; epochOffsetMs === 0 is the identity (post-SNTP wall clock). */
function wallDate() {
  return new Date(Date.now() + epochOffsetMs);
}

function tick() {
  if (lume._nowMs() >= nextSyncMs) syncNetTime();
  var n = wallDate();
  todSig.set(n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds());
}
tick();
lume.system.setInterval(tick, 1000);

/* ---- helpers (pure; unit-checked on the host) ---- */
function pad2(v) { return ('0' + v).slice(-2); }
function digital() {
  var t = todSig();
  return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor(t / 60) % 60) + ':' + pad2(t % 60);
}
function dateLine() {
  var n = wallDate();
  return DAYS[n.getDay()] + ' ' + MONTHS[n.getMonth()] + ' ' +
         n.getDate() + ' ' + n.getFullYear();
}
/** 0 deg = 12 o'clock, clockwise; returns [x, y] on the canvas. */
function polar(cx, cy, len, deg) {
  var rad = deg * Math.PI / 180;
  return [Math.round(cx + len * Math.sin(rad)), Math.round(cy - len * Math.cos(rad))];
}

/* ---- analog dial (300 px leaves room for the digital line) ---- */
var SIZE = 300;
var CX = SIZE / 2, CY = SIZE / 2;
var FACE_R = 144;
var HAND_H = 66, HAND_M = 108, HAND_S = 122, TAIL = 18;

function drawDial(c) {
  /* read the single signal so the effect redraws on every tick */
  var t = todSig();
  var s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);

  c.clear();
  c.fillColor(C_FACE);
  c.circle(CX, CY, FACE_R, C_FACE);

  /* 60 minor ticks; majors (every 5th) drawn again, thicker */
  for (var i = 0; i < 60; i++) {
    var deg = i * 6;
    var r1 = i % 5 === 0 ? 124 : 132, r2 = 140;
    var a = polar(CX, CY, r1, deg), b = polar(CX, CY, r2, deg);
    if (i % 5 !== 0) c.line(a[0], a[1], b[0], b[1], C_DIM, 1);
    else {
      c.line(a[0], a[1], b[0], b[1], C_HAND, 3);
      c.line(a[0] - 1, a[1], b[0] - 1, b[1], C_HAND, 1); /* thicken */
      c.line(a[0] + 1, a[1], b[0] + 1, b[1], C_HAND, 1);
    }
  }

  /* hands: hour, minute, second (with tail) */
  var hDeg = (h % 12) * 30 + m * 0.5;
  var mDeg = m * 6 + s * 0.1;
  var tip;
  tip = polar(CX, CY, HAND_H, hDeg);
  c.line(CX, CY, tip[0], tip[1], C_HAND, 5);
  c.line(CX - 2, CY, tip[0] - 2, tip[1], C_HAND, 1);
  c.line(CX + 2, CY, tip[0] + 2, tip[1], C_HAND, 1);
  tip = polar(CX, CY, HAND_M, mDeg);
  c.line(CX, CY, tip[0], tip[1], C_HAND, 3);
  tip = polar(CX, CY, HAND_S, s * 6);
  var tail = polar(CX, CY, TAIL, s * 6 + 180);
  c.line(tail[0], tail[1], tip[0], tip[1], C_SEC, 2);
  c.circle(CX, CY, 5, C_SEC);

  /* dial numerals (canvas text is 14 px, UTF-8 <= 63 bytes) */
  for (var n12 = 1; n12 <= 12; n12++) {
    var p = polar(CX, CY, 98, n12 * 30);
    c.text(p[0] - 5, p[1] - 7, String(n12), C_TEXT, 14);
  }
}

/* ---- dial canvas + digital time + date, one column ---- */
View({ style: {
  width: '100%', height: '100%', background: 'primary',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', padding: 40, gap: 8
} }, [
  Canvas({ width: SIZE, height: SIZE, onDraw: drawDial }),
  Text({ text: digital, style: { textAlign: 'center', width: '100%' } }),
  Text({ text: function () { return dateLine(); }, style: { textAlign: 'center', width: '100%', opacity: 0.55 } })
]);
