/* Round clock. 480 logical pixels; all essential marks lie within R=205.
 * On the 466 panel the browser/device scales this centered design. */
var CR_BG = '#050B15', CR_RING = '#244862', CR_TICK = '#88B5C8';
var CR_INK = '#EEF8F8', CR_ACCENT = '#51E0C4', CR_SECOND = '#FF9A77';
function clockAngles(h, m, s) {
  return { hour: (h % 12) * 30 + m * 0.5 + s / 120,
    minute: m * 6 + s * 0.1, second: s * 6 };
}
function clockPolar(r, deg) {
  var a = deg * Math.PI / 180;
  return [Math.round(200 + r * Math.sin(a)), Math.round(200 - r * Math.cos(a))];
}
function clockPad(n) { return ('0' + n).slice(-2); }
function clockDigital(t) { return clockPad(t.h) + ':' + clockPad(t.m) + ':' + clockPad(t.s); }
function clockTime(d) { return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }; }

/* GAME UI */
var clockState = signal(clockTime(new Date()));

/* ---- r130: SNTP sync BEGIN ---- */
/* r130: SNTP-first wall clock. WiFi GOT_IP -> lume.system.setTimeNtp(); only a
 * 0 return means Date.now()/new Date() is a corrected wall clock (valid).
 * Until then (or on -2/-3/throw) the genuine 1970-based device time is shown
 * and the corner status flags it -- no fabricated epoch. Dial animation and
 * interaction are untouched. Default server / 10 s timeout, like r129. */
var CR_SYNC_RETRY_MS = 30000;
var CR_SYNC_OK_MS = 600000;
var clockWallValid = false;              /* true ONLY after setTimeNtp() === 0 */
var clockSyncStatus = signal('SYNCING'); /* ASCII: SYNCING / NO WIFI / NO SYNC / '' */
var clockNextSyncMs = 0;                 /* first attempt due immediately */
function clockSyncNtp() {
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    clockWallValid = false; clockSyncStatus.set('NO WIFI');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS; return;
  }
  var sys = lume.system;
  if (!sys || typeof sys.setTimeNtp !== 'function') {
    clockWallValid = false; clockSyncStatus.set('NO API');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS; return;
  }
  clockSyncStatus.set('SYNCING');
  var r;
  try { r = sys.setTimeNtp(); } catch (e) { r = -2; }
  if (r === 0) {
    clockWallValid = true; clockSyncStatus.set('');   /* wall time: enable rendering */
    clockNextSyncMs = lume._nowMs() + CR_SYNC_OK_MS;
  } else {
    clockWallValid = false;
    clockSyncStatus.set(r === -3 ? 'NO WIFI' : 'NO SYNC');
    clockNextSyncMs = lume._nowMs() + CR_SYNC_RETRY_MS;
  }
}
/* ---- r130: SNTP sync END ---- */

function clockTick() {
  if (lume._nowMs() >= clockNextSyncMs) clockSyncNtp();
  clockState.set(clockTime(new Date()));  /* genuine device/wall time, never fabricated */
}
function clockDraw(c) {
  var t = clockState(), a = clockAngles(t.h, t.m, t.s);
  c.clear(); c.fillColor(CR_BG); c.fillRect(0, 0, 400, 400);
  c.arc(200, 200, 186, 0, 360, 2, CR_RING);
  for (var i = 0; i < 60; i++) {
    var major = i % 5 === 0;
    var p = clockPolar(major ? 163 : 173, i * 6), q = clockPolar(182, i * 6);
    c.line(p[0], p[1], q[0], q[1], major ? CR_INK : CR_TICK, major ? 3 : 1);
  }
  var pH = clockPolar(91, a.hour), pM = clockPolar(138, a.minute);
  var pS = clockPolar(153, a.second), tail = clockPolar(23, a.second + 180);
  c.line(200, 200, pH[0], pH[1], CR_INK, 7);
  c.line(200, 200, pM[0], pM[1], CR_ACCENT, 4);
  c.line(tail[0], tail[1], pS[0], pS[1], CR_SECOND, 2);
  c.circle(200, 200, 6, CR_SECOND);
  c.text(185, 105, '12', CR_INK, 14);
  c.text(287, 194, '3', CR_INK, 14);
  c.text(195, 290, '6', CR_INK, 14);
  c.text(102, 194, '9', CR_INK, 14);
}
var clockRoot = View({ style: { width: 480, height: 480, background: CR_BG, scroll: 'none' } });
Canvas({ parent: clockRoot, width: 400, height: 400, onDraw: clockDraw,
  style: { position: 'absolute', x: 40, y: 40 } });
Text({ parent: clockRoot, text: function () { return clockDigital(clockState()); },
  style: { position: 'absolute', x: 137, y: 266, width: 206, height: 36,
    fontSize: 28, color: CR_INK, textAlign: 'center' } });
/* r130: quiet ASCII sync status in the top-left corner; empty once synced. */
Text({ parent: clockRoot, text: function () {
  return clockWallValid ? '' : clockSyncStatus();
}, style: { position: 'absolute', x: 8, y: 8, width: 120, height: 24,
  fontSize: 14, color: CR_TICK } });
lume.system.setInterval(clockTick, 1000);
