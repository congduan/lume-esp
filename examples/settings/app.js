/** Settings app: WiFi (station / WPA2-PSK), Bluetooth (BLE peripheral) and
 *  general device settings (volume, battery, sleep, power off, storage).
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots and the
 *  engine does NOT reject ids beyond it (creates are silently dropped on the
 *  LVGL side, leaving JS/UI diverged), so this app keeps its static tree at
 *  ~102 nodes (incl. the r132 OTA status row) and its two virtualized Lists add
 *  <= ~20 visible rows worst case.
 *  The on-screen keyboard is therefore 4 compact rows; BACK navigation uses
 *  the global prelude gesture (swipe up) instead of per-page back buttons.
 *
 *  r205 round-AMOLED redesign (from artifacts/r205/design/settings.html):
 *  - Compact top header with time & battery complications flanking Settings.
 *  - Three grouped sections (CONNECTIONS / SOUND / DEVICE) strictly inside the
 *    [75, 405] circular safe area, replacing W/B/G letter placeholders with
 *    inline SVG icons (Wi-Fi fan, Bluetooth rune, Speaker, Gear cog), iOS-style
 *    toggle switches, volume bar, and chevrons.
 *  - Removes permanent "Swipe up to go back" tutorial text and fixes General
 *    row value semantics ("System" instead of "50% volume").
 *
 *  Pages are built once and switched by toggling ATTR_VISIBLE with
 *  lume.setAttr(node, 5, 0|1) -- the pattern already used by
 *  examples/dashboard/app.js and examples/files/app.js. The on-screen
 *  keyboard is an absolute overlay on top; the runtime has no text-input
 *  widget, so SSID / password / BLE name are typed with key buttons.
 *
 *  Firmware behaviour honoured here (runtime/types/lume.d.ts):
 *  - WiFi: station only, WPA2-PSK only. lume.net.scan() (added this round)
 *    lists nearby APs SYNCHRONOUSLY -- it blocks the engine task for ~1.5-3 s,
 *    so the UI freezes during a scan (same tradeoff as the synchronous
 *    httpGet). Saved networks are remembered in NVS (lume.storage.kv
 *    'wifi.saved'); connect() is non-blocking and status() is polled:
 *    DISCONNECTED -> CONNECTING -> CONNECTED -> GOT_IP.
 *  - Bluetooth: lume.ble is a GATT PERIPHERAL only (Nordic-UART-shaped): the
 *    app advertises for a central; it cannot scan/pair/connect out to other
 *    devices. ble.status() WARNs on every call while NimBLE is down, so it is
 *    probed once (same as examples/device_monitor).
 *  - r132 OTA consumer: lume.ota.status() is a LOCAL snapshot (running /
 *    wifiReady / tokenReady / hmac / port / token). The 32-hex token appears
 *    only on the serial log and is NEVER rendered on screen. The "New token"
 *    button opens a shell.Dialog; its danger "Rotate" action generates the
 *    replacement with Math.random() -- the device has no crypto.getRandomValues,
 *    so the key is NOT cryptographically secure. The channel still has HMAC
 *    challenge-response and a LAN boundary. See docs/KNOWN-SIMPLIFICATIONS.md
 *    r132 (token generation) and r163 (Dialog confirmation).
 *
 *  On-device acceptance (advertising, association, real scan results,
 *  coexistence, sleep current) is deferred to the board bring-up round -- a
 *  green host run does NOT mean the radios work on hardware.
 */

import '../../runtime/shell.js';

var settingsTheme = { colors: {
  bg: '#000000',
  primary: '#09101A',
  surface: '#16202E',
  surfaceAlt: '#1F2C3D',
  accent: '#40D8B0',
  danger: '#FF6B79',
  text: '#F2F7FB',
  textDim: '#9EB3C6'
}, radius: 12, fontScale: 1 };
lume.theme.set(settingsTheme);

var SAFE = 76;
var kv = lume.storage.kv;

/* ---- persisted state ---------------------------------------------------- */

function loadSaved() {
  var raw = kv.get('wifi.saved');
  if (typeof raw !== 'string') return [];
  try {
    var list = JSON.parse(raw);
    return list instanceof Array ? list : [];
  } catch (e) {
    return [];
  }
}
function saveSaved(list) {
  kv.set('wifi.saved', JSON.stringify(list));
}
function upsertNet(ssid, pass) {
  var list = loadSaved();
  for (var i = 0; i < list.length; i++) {
    if (list[i].ssid === ssid) { list[i].pass = pass; saveSaved(list); return; }
  }
  list.push({ ssid: ssid, pass: pass });
  saveSaved(list);
}

/* ---- signals ------------------------------------------------------------- */

var NET_STATES = ['disconnected', 'connecting', 'associated', 'got ip'];
var BLE_STATES = ['idle', 'advertising', 'connected'];
var CHARGE_STATES = ['trickle', 'pre', 'CC', 'CV', 'done', 'idle'];

var page = signal(0);              /* 0 menu, 1 wifi, 2 bt, 3 general, 4 scan */
var wifiLine = signal('off');
var btLine = signal('off');
var btName = signal(function () {
  var n = kv.get('bt.name');
  return typeof n === 'string' && n ? n : 'Lume';
}());
var battLine = signal('--');
var battPct = signal(-1);
var clockText = signal('--:--');
var storeLine = signal('--');
var volume = signal(function () {
  var v = kv.get('set.volume');
  return typeof v === 'number' && v >= 0 && v <= 100 ? v : 50;
}());
var volNote = signal('');
var powerNote = signal('');       /* r164: ASCII note for guarded power-off failure */
var wifiBusy = signal('');         /* ssid while a connect attempt is running */
var timeSyncLine = signal('Time  OFFLINE');  /* r129: General-page NTP status */
var otaLine = signal('OTA  OFFLINE');        /* r132: General-page OTA status */
var otaNote = signal('');                    /* r132: transient setToken result */
var rebootNote = signal('');                 /* r143: transient reboot guard note */

var savedNets = signal(loadSaved());
var autoSsid = signal(function () {
  var s = kv.get('wifi.auto');
  return typeof s === 'string' ? s : '';
}());

/* ---- inline SVG icons (lume-svg + browser compatible, ASCII-only) ------- */

function svgBuf(svg) {
  var b = new Uint8Array(svg.length);
  for (var i = 0; i < svg.length; i++) b[i] = svg.charCodeAt(i);
  return b.buffer;
}

var SVG_WIFI = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="16" fill="#133334" stroke="#285E5C" stroke-width="1"/>' +
  '<path d="M 8 14 A 13 13 0 0 1 26 14" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 11 18 A 8 8 0 0 1 23 18" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M 14 21.5 A 4 4 0 0 1 20 21.5" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '<circle cx="17" cy="24.5" r="1.8" fill="#40D8B0"/>' +
  '</svg>'
);

var SVG_BT = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="16" fill="#152B44" stroke="#2B4E75" stroke-width="1"/>' +
  '<polyline points="12,12 22,22 17,26 17,8 22,12 12,22" fill="none" stroke="#5B9DF7" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'
);

var SVG_SOUND = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="16" fill="#322716" stroke="#624D29" stroke-width="1"/>' +
  '<polygon points="9,14 13,14 18,10 18,24 13,20 9,20" fill="#5A4522" stroke="#FFD78E" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M 21 13.5 A 5 5 0 0 1 21 20.5" fill="none" stroke="#FFD78E" stroke-width="1.9" stroke-linecap="round"/>' +
  '<path d="M 23.5 11 A 8.5 8.5 0 0 1 23.5 23" fill="none" stroke="#FFD78E" stroke-width="1.9" stroke-linecap="round"/>' +
  '</svg>'
);

var SVG_GEAR = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="16" fill="#212F41" stroke="#3B516B" stroke-width="1"/>' +
  '<circle cx="17" cy="17" r="5.5" fill="none" stroke="#F2F7FB" stroke-width="2.2"/>' +
  '<circle cx="17" cy="17" r="2.2" fill="#212F41" stroke="#9EB3C6" stroke-width="1.2"/>' +
  '<line x1="17" y1="8.5" x2="17" y2="11" stroke="#F2F7FB" stroke-width="2.4" stroke-linecap="round"/>' +
  '<line x1="17" y1="23" x2="17" y2="25.5" stroke="#F2F7FB" stroke-width="2.4" stroke-linecap="round"/>' +
  '<line x1="8.5" y1="17" x2="11" y2="17" stroke="#F2F7FB" stroke-width="2.4" stroke-linecap="round"/>' +
  '<line x1="23" y1="17" x2="25.5" y2="17" stroke="#F2F7FB" stroke-width="2.4" stroke-linecap="round"/>' +
  '<line x1="11" y1="11" x2="13" y2="13" stroke="#F2F7FB" stroke-width="2.2" stroke-linecap="round"/>' +
  '<line x1="21" y1="21" x2="23" y2="23" stroke="#F2F7FB" stroke-width="2.2" stroke-linecap="round"/>' +
  '<line x1="23" y1="11" x2="21" y2="13" stroke="#F2F7FB" stroke-width="2.2" stroke-linecap="round"/>' +
  '<line x1="13" y1="21" x2="11" y2="23" stroke="#F2F7FB" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>'
);

/* ---- compact 10px uppercase stroke glyphs for group headers ------------- */

var MICRO_GLYPHS = {
  A: [[0,8,0,2],[0,2,1,0],[1,0,3,0],[3,0,4,2],[4,2,4,8],[0,4,4,4]],
  B: [[0,0,3,0],[3,0,4,1],[4,1,4,3],[4,3,3,4],[3,4,0,4],[3,4,4,5],[4,5,4,7],[4,7,3,8],[3,8,0,8],[0,8,0,0]],
  C: [[4,0,1,0],[1,0,0,1],[0,1,0,7],[0,7,1,8],[1,8,4,8]],
  D: [[0,0,3,0],[3,0,4,1],[4,1,4,7],[4,7,3,8],[3,8,0,8],[0,8,0,0]],
  E: [[0,0,4,0],[0,0,0,8],[0,4,3,4],[0,8,4,8]],
  I: [[1,0,3,0],[2,0,2,8],[1,8,3,8]],
  K: [[0,0,0,8],[4,0,0,4],[1,3,4,8]],
  N: [[0,8,0,0],[0,0,4,8],[4,8,4,0]],
  O: [[1,0,3,0],[3,0,4,1],[4,1,4,7],[4,7,3,8],[3,8,1,8],[1,8,0,7],[0,7,0,1],[0,1,1,0]],
  P: [[0,8,0,0],[0,0,3,0],[3,0,4,1],[4,1,4,3],[4,3,3,4],[3,4,0,4]],
  R: [[0,8,0,0],[0,0,3,0],[3,0,4,1],[4,1,4,3],[4,3,3,4],[3,4,0,4],[2,4,4,8]],
  S: [[4,1,3,0],[3,0,1,0],[1,0,0,1],[0,1,0,3],[0,3,4,5],[4,5,4,7],[4,7,3,8],[3,8,1,8],[1,8,0,7]],
  T: [[0,0,4,0],[2,0,2,8]],
  U: [[0,0,0,7],[0,7,1,8],[1,8,3,8],[3,8,4,7],[4,7,4,0]],
  V: [[0,0,2,8],[2,8,4,0]],
  W: [[0,0,0,8],[0,8,2,4],[2,4,4,8],[4,8,4,0]],
  Y: [[0,0,2,4],[4,0,2,4],[2,4,2,8]]
};

function drawMicroLabel(c, text, x, y, col) {
  var cx = x;
  for (var i = 0; i < text.length; i++) {
    var segs = MICRO_GLYPHS[text[i]];
    if (segs) {
      for (var j = 0; j < segs.length; j++) {
        var s = segs[j];
        c.line(cx + s[0], y + s[1], cx + s[2], y + s[3], col, 1);
      }
    }
    cx += 7;
  }
}

function drawCapsule(c, x, y, w, h, fill, border) {
  var r = Math.floor(h / 2);
  if (border) {
    c.fillCircle(x + r, y + r, r, border);
    c.fillCircle(x + w - r, y + r, r, border);
    c.fillColor(border); c.fillRect(x + r, y, w - 2 * r, h);
    var ir = r - 1;
    c.fillCircle(x + r, y + r, ir, fill);
    c.fillCircle(x + w - r, y + r, ir, fill);
    c.fillColor(fill); c.fillRect(x + r, y + 1, w - 2 * r, h - 2);
  } else {
    c.fillCircle(x + r, y + r, r, fill);
    c.fillCircle(x + w - r, y + r, r, fill);
    c.fillColor(fill); c.fillRect(x + r, y, w - 2 * r, h);
  }
}

function drawCardBox(c, x, y, w, h, fill, border) {
  var r = 10;
  if (border) {
    c.fillCircle(x + r, y + r, r, border);
    c.fillCircle(x + w - r, y + r, r, border);
    c.fillCircle(x + r, y + h - r, r, border);
    c.fillCircle(x + w - r, y + h - r, r, border);
    c.fillColor(border);
    c.fillRect(x + r, y, w - 2 * r, h);
    c.fillRect(x, y + r, w, h - 2 * r);
    x += 1; y += 1; w -= 2; h -= 2; r = 9;
  }
  c.fillCircle(x + r, y + r, r, fill);
  c.fillCircle(x + w - r, y + r, r, fill);
  c.fillCircle(x + r, y + h - r, r, fill);
  c.fillCircle(x + w - r, y + h - r, r, fill);
  c.fillColor(fill);
  c.fillRect(x + r, y, w - 2 * r, h);
  c.fillRect(x, y + r, w, h - 2 * r);
}

function drawStatusPill(c, x, y, w, h, label, fg, bg, border) {
  drawCapsule(c, x, y, w, h, bg, border);
  c.fillCircle(x + 11, y + Math.floor(h / 2), 3, fg);
  c.text(x + 19, y + Math.floor((h - 14) / 2), label, fg);
}

function drawSignalBars(c, x, y, tier, col) {
  var dim = '#2A3B4F';
  c.fillColor(tier >= 1 ? col : dim); c.fillRect(x, y + 8, 3, 5);
  c.fillColor(tier >= 2 ? col : dim); c.fillRect(x + 6, y + 4, 3, 9);
  c.fillColor(tier >= 3 ? col : dim); c.fillRect(x + 12, y, 3, 13);
}

function drawLockGlyph(c, x, y, col) {
  c.line(x + 2, y + 4, x + 2, y + 2, col, 1);
  c.line(x + 2, y + 2, x + 7, y + 2, col, 1);
  c.line(x + 7, y + 2, x + 7, y + 4, col, 1);
  c.line(x, y + 5, x + 9, y + 5, col, 1);
  c.line(x, y + 11, x + 9, y + 11, col, 1);
  c.line(x, y + 5, x, y + 11, col, 1);
  c.line(x + 9, y + 5, x + 9, y + 11, col, 1);
}

function drawWifiGlyph(c, cx, cy, col, bg, ring) {
  c.fillCircle(cx, cy, 16, ring);
  c.fillCircle(cx, cy, 15, bg);
  c.arc(cx, cy + 5, 11, 225, 315, 2, col);
  c.arc(cx, cy + 5, 7, 225, 315, 2, col);
  c.fillCircle(cx, cy + 6, 2, col);
}

function drawBtGlyph(c, cx, cy, col, bg, ring) {
  c.fillCircle(cx, cy, 17, ring);
  c.fillCircle(cx, cy, 16, bg);
  c.line(cx, cy - 9, cx, cy + 9, col, 2);
  c.line(cx, cy - 9, cx + 6, cy - 4, col, 2);
  c.line(cx + 6, cy - 4, cx - 5, cy + 5, col, 2);
  c.line(cx - 5, cy - 5, cx + 6, cy + 4, col, 2);
  c.line(cx + 6, cy + 4, cx, cy + 9, col, 2);
}

function drawChevron(c, x, y, col) {
  c.line(x, y - 4, x + 4, y, col, 2);
  c.line(x + 4, y, x, y + 4, col, 2);
}

/* ---- page switching (ATTR_VISIBLE = 5, see header) ----------------------- */

var pageNodes = {};                /* name -> node id */
function showPage(name) {
  for (var k in pageNodes) lume.setAttr(pageNodes[k], 5, k === name ? 1 : 0);
}
function go(name) {
  page.set(name === 'menu' ? 0 : (name === 'wifi' ? 1 : (name === 'bt' ? 2 :
          name === 'general' ? 3 : 4)));
  showPage(name);
}

/* ---- keyboard overlay ----------------------------------------------------- */

var kbMode = signal('abc');        /* 'abc' or 'sym' */
var kbText = signal('');
var kbTitle = signal('');
var kbMax = 32;
var kbOnOk = null;
var kbOpen = false;

/* Each key is [abcChar, symChar, flexGrow?]. In 'sym' mode row 1 becomes the
 * digits 1..0 and row 2 the symbol band, so the #123 toggle visibly changes
 * every row; the toggle key itself swaps between '#123' and 'ABC'.
 * 4 compact rows x 36 keys: the whole keyboard must stay inside the 128-node
 * firmware budget (see header). */
var KB_ROWS = [
  [['q', '1'], ['w', '2'], ['e', '3'], ['r', '4'], ['t', '5'], ['y', '6'],
   ['u', '7'], ['i', '8'], ['o', '9'], ['p', '0']],
  [['a', '!'], ['s', '@'], ['d', '#'], ['f', '$'], ['g', '%'], ['h', '^'],
   ['j', '&'], ['k', '*'], ['l', '('], ['DEL', 'DEL', 4]],
  [['#123', 'ABC', 4], ['z', ')'], ['x', '['], ['c', ']'], ['v', '{'],
   ['b', '}'], ['n', ':'], ['m', "'"], ['.', '"']],
  [['-', '+'], ['_', '='], ['@', '<'], ['.', '>'], ['space', 'space', 5],
   ['OK', 'OK', 3], ['ESC', 'ESC', 3]]
];

function keyChar(k) { return kbMode() === 'abc' ? k[0] : k[1]; }

function kbShow(title, max, onOk) {
  kbTitle.set(title);
  kbMax = max;
  kbOnOk = onOk;
  kbText.set('');
  kbMode.set('abc');
  kbOpen = true;
  lume.setAttr(kbOverlay, 5, 1);
}
function kbHide() {
  kbOpen = false;
  kbOnOk = null;
  lume.setAttr(kbOverlay, 5, 0);
}
function kbKey(k) {
  var label = keyChar(k);
  if (label === 'DEL') { kbText.set(kbText().slice(0, -1)); return; }
  if (label === 'space') { kbText.set(kbText() + ' '); return; }
  if (label === 'ESC') { kbHide(); return; }
  if (label === 'OK') {
    var v = kbText();
    var cb = kbOnOk;
    kbHide();
    if (cb) cb(v);
    return;
  }
  if (label === '#123') { kbMode.set('sym'); return; }
  if (label === 'ABC') { kbMode.set('abc'); return; }
  if (kbText().length < kbMax) kbText.set(kbText() + label);
}

function kbRow(children) {
  return View({ style: {
    width: '100%', height: 42, display: 'flex', flexDirection: 'row', gap: 4
  } }, children);
}
function kbKeyButton(k) {
  return Button({
    title: function () { return keyChar(k) === 'space' ? 'space' : keyChar(k); },
    onPress: function () { kbKey(k); },
    style: {
      flexGrow: k[2] || 2, height: 42,
      background: function () {
        var label = keyChar(k);
        return (label === 'DEL' || label === 'ESC' || label === 'OK' ||
                label === 'space' || label === '#123' || label === 'ABC')
          ? '#1F2C3D' : 'surface';
      }
    }
  });
}

var kbDisplay = Text({ text: function () {
  var title = kbTitle();
  var t = kbText();
  var shown = t;
  if (kbTitle().indexOf('Password') === 0) {
    shown = new Array(t.length + 1).join('*');
  }
  var room = 60 - title.length;
  if (shown.length > room) shown = '<' + shown.slice(shown.length - room + 1);
  return title + ': ' + (shown === '' ? '|' : shown);
}, style: { width: '100%', height: 24, textAlign: 'left', fontSize: 14 } });

var kbChildren = [kbDisplay];
for (var r = 0; r < KB_ROWS.length; r++) {
  kbChildren.push(kbRow(KB_ROWS[r].map(kbKeyButton)));
}
var kbOverlay = View({ style: {
  position: 'absolute', x: 76, y: 174, width: 328, height: 224,
  background: '#0D1420', borderRadius: 12, borderWidth: 1, borderColor: '#2B3E54',
  display: 'flex', flexDirection: 'column', gap: 4, padding: 8
} }, kbChildren);
lume.setAttr(kbOverlay, 5, 0);     /* hidden until kbShow() */

/* ---- wifi ----------------------------------------------------------------- */

function netInit() {
  var r = lume.net.init();
  if (r < 0) { wifiLine.set('init err ' + r); return false; }
  return true;
}
function connectNet(net) {
  if (!netInit()) return;
  var r = lume.net.connect(net.ssid, net.pass);
  if (r < 0) {
    wifiLine.set('connect err ' + r);
    wifiBusy.set('');
    return;
  }
  wifiBusy.set(net.ssid);
  wifiLine.set('connecting ' + net.ssid + '...');
  kv.set('wifi.auto', net.ssid);
  autoSsid.set(net.ssid);
}
function disconnectNet() {
  lume.net.disconnect();
  wifiBusy.set('');
  kv.remove('wifi.auto');
  autoSsid.set('');
}
function addNetwork() {
  kbShow('Network name (SSID)', 32, function (ssid) {
    if (!ssid) return;
    kbShow('Password (8-63)', 63, function (pass) {
      if (pass.length < 8) { wifiLine.set('password too short (8+)'); return; }
      upsertNet(ssid, pass);
      savedNets.set(loadSaved());
      connectNet({ ssid: ssid, pass: pass });
    });
  });
}
function forgetNet(item) {
  var list = loadSaved();
  var next = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].ssid !== item.ssid) next.push(list[i]);
  }
  saveSaved(next);
  savedNets.set(next);
  if (autoSsid() === item.ssid) {
    kv.remove('wifi.auto');
    autoSsid.set('');
  }
}
function autoConnect() {
  var last = autoSsid();
  if (!last) return;
  var st = lume.net.status();
  if (typeof st === 'object' && st !== null && st.state >= 1) return;
  var list = savedNets();
  for (var i = 0; i < list.length; i++) {
    if (list[i].ssid === last) { connectNet(list[i]); return; }
  }
}

/* ---- wifi scan -----------------------------------------------------------
 * lume.net.scan() is SYNCHRONOUS: the engine task is blocked for ~1.5-3 s
 * (all-channel active scan), so the whole UI freezes while it runs and the
 * status text below may only repaint afterwards. That is the accepted
 * firmware tradeoff this round, shared with the synchronous httpGet. */
var scanResults = signal([]);

function scanNow() {
  if (!netInit()) return;
  wifiLine.set('scanning... UI frozen');
  var r = lume.net.scan();
  if (typeof r === 'number') {
    wifiLine.set('scan err ' + r);
    return;
  }
  scanResults.set(r);
  wifiLine.set(r.length + ' aps found');
}
function connectFromScan(item) {
  if (item.auth === 0) {
    wifiLine.set('open networks unsupported');
    return;
  }
  kbShow('Password (8-63)', 63, function (pass) {
    if (pass.length < 8) { wifiLine.set('password too short (8+)'); return; }
    upsertNet(item.ssid, pass);
    savedNets.set(loadSaved());
    connectNet({ ssid: item.ssid, pass: pass });
  });
}

/* ---- bluetooth ------------------------------------------------------------- */

var bleProbed = false;
var bleReady = false;
var blePoll = null;

function bleStart() {
  var r = lume.ble.start(btName());
  if (r < 0) { btLine.set('start err ' + r); return; }
  if (blePoll === null) {
    blePoll = lume.system.setInterval(pollBle, 300);
  }
}
function bleStop() {
  if (blePoll !== null) {
    lume.system.clearInterval(blePoll);
    blePoll = null;
  }
  lume.ble.stop();
  btLine.set('off');
}
function renameBle() {
  kbShow('BLE name', 24, function (name) {
    if (!name) return;
    kv.set('bt.name', name);
    btName.set(name);
    var st = bleReady ? lume.ble.status() : -3;
    if (typeof st === 'object' && st.state !== 0) bleStart();  /* re-advertise */
  });
}
function pollBle() {
  var st = lume.ble.status();
  if (typeof st === 'number') { btLine.set('status err ' + st); return; }
  btLine.set((BLE_STATES[st.state] || ('st ' + st.state)) +
    (st.connected ? ' mtu ' + st.mtu : '') +
    (st.pending > 0 ? ' rx ' + st.pending : ''));
}

/* ---- general ----------------------------------------------------------------- */

function applyVolume(v, persist) {
  v = v < 0 ? 0 : (v > 100 ? 100 : v);
  volume.set(v);
  if (persist) kv.set('set.volume', v);
  var audio = lume.audio;
  if (!audio || typeof audio.setVolume !== 'function') {
    volNote.set('audio n/a');
    return;
  }
  var r = audio.setVolume(v);
  volNote.set(r === 0 ? '' : 'audio err ' + r);
}
/* ---- r164: power off consumer (pure app layer) BEGIN -----------------------------
 * lume.pmic.powerOff() performs a REAL power off: on device it never returns.
 * r164 replaces the old 3 s arm/confirm gate with a shell.Dialog whose danger
 * "Power off" button is the ONLY path to the binding. The typeof guard lives
 * inside that callback, so Cancel / mask / card / a stub without Dialog can
 * never power the device down; a missing binding degrades to an ASCII note. */
function powerOff() {
  var shell = lume.ui && lume.ui.shell;
  if (!shell || typeof shell.Dialog !== 'function') {
    powerNote.set('power off n/a (no dialog)');
    return;
  }
  shell.Dialog({
    title: 'Power off',
    message: 'The device powers down immediately; unsaved state is lost.',
    buttons: [
      { label: 'Cancel', style: 'plain' },
      { label: 'Power off', style: 'danger', onPress: function () {
        if (!lume.pmic || typeof lume.pmic.powerOff !== 'function') {
          powerNote.set('power off n/a');        /* stub without the binding */
          return;
        }
        lume.pmic.powerOff();                    /* real power off; never returns */
      } }
    ]
  });
}
/* ---- r164: power off consumer END ---- */

/* ---- r129: time sync (r128 lume.system.time / setTimeNtp primitives) ----------
 * time() and Date.now() both read gettimeofday(), so a synced device shows
 * them agreeing at a large wall epoch while a cold boot reports a small
 * near-1970 value for both. The difference plus magnitude is an honest,
 * radio-free "synced?" heuristic (ASCII copy, r64 discipline). */
function timeSyncStatus() {
  var t = lume.system.time(), d = Date.now();
  if (typeof t !== 'number' || typeof d !== 'number') return 'Time  OFFLINE';
  if (Math.abs(t - d) > 5000) return 'Time  OFFLINE';
  return t > 1000000000000 ? 'Time  SYNCED' : 'Time  OFFLINE';
}
function syncTimeNow() {
  var sys = lume.system;
  if (!sys || typeof sys.setTimeNtp !== 'function') {
    timeSyncLine.set('Time  NO API');
    return;
  }
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    timeSyncLine.set('Time  NO WIFI');
    return;
  }
  var r = sys.setTimeNtp();            /* default server / default 10 s */
  if (r === 0) timeSyncLine.set('Time  SYNCED');
  else if (r === -2) timeSyncLine.set('Time  FAILED');
  else if (r === -3) timeSyncLine.set('Time  NO WIFI');
  else timeSyncLine.set('Time  ERR ' + r);
}

/* ---- r132: OTA status + token rotation BEGIN (pure app layer) ----------------
 * lume.ota.status() is a local snapshot; a number return is an error code, so
 * discriminate with typeof === 'object'. The token field is deliberately never
 * read here: the 32-hex key stays on the serial log, never on the display. */
function otaStatusText() {
  var st = lume.ota.status();
  if (!(typeof st === 'object') || st === null) return 'ota err ' + st;
  if (!st.running) return 'OTA  OFFLINE';
  if (!st.wifiReady) return 'OTA  NO WIFI';
  if (!st.tokenReady) return 'OTA  NO TOKEN';
  return 'OTA  :' + st.port + (st.hmac ? ' HMAC' : '');
}
function refreshOta() { otaLine.set(otaStatusText()); }

/* 32 lowercase hex chars. Math.random is NOT a CSPRNG; see header comment and
 * docs/KNOWN-SIMPLIFICATIONS.md r132 for the accepted tradeoff. */
function newOtaToken() {
  var digits = '0123456789abcdef';
  var out = '';
  for (var i = 0; i < 32; i++) out += digits.charAt(Math.floor(Math.random() * 16));
  return out;
}

function rotateOtaToken() {
  var shell = lume.ui && lume.ui.shell;
  if (!shell || typeof shell.Dialog !== 'function') {
    /* r163: a stub without Dialog must not silently execute a dangerous op. */
    otaNote.set('rotate n/a (no dialog)');
    return;
  }
  shell.Dialog({
    title: 'Rotate OTA token?',
    message: 'A new 32-hex token replaces the current one on this device.',
    buttons: [
      { label: 'Cancel', style: 'plain' },
      { label: 'Rotate', style: 'danger', onPress: function () {
        var r = lume.ota.setToken(newOtaToken());   /* token never rendered on screen */
        if (r !== 0) { otaNote.set('setToken err ' + r); return; }
        otaNote.set('');
        refreshOta();
      } }
    ]
  });
}
/* ---- r132: OTA status + token rotation END ---- */

/* ---- r143: reboot consumer (pure app layer) BEGIN -----------------------------
 * lume.system.reboot() is `never`: on device it kills the JS task via
 * esp_restart(), so state not already persisted is lost. r163 replaces the old
 * 3 s arm/confirm gate with a shell.Dialog modal whose danger "Reboot" button
 * performs the call. The playground browser stub may not expose the binding,
 * so the call is guarded with typeof and degrades to an ASCII note. */
function rebootNow() {
  var shell = lume.ui && lume.ui.shell;
  if (!shell || typeof shell.Dialog !== 'function') {
    rebootNote.set('reboot n/a (no dialog)');  /* stub without Dialog: never auto-reboot */
    return;
  }
  shell.Dialog({
    title: 'Reboot device?',
    message: 'Unsaved state is lost; the device restarts immediately.',
    buttons: [
      { label: 'Cancel', style: 'plain' },
      { label: 'Reboot', style: 'danger', onPress: function () {
        if (!lume.system || typeof lume.system.reboot !== 'function') {
          rebootNote.set('reboot n/a');        /* stub without the binding */
          return;
        }
        lume.system.reboot();                  /* never returns on device */
      } }
    ]
  });
}
/* ---- r143: reboot consumer END ---- */

/* ---- polling ------------------------------------------------------------------ */

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function readClock() {
  try {
    var ms = lume.system.time();
    if (typeof ms === 'number' && isFinite(ms) && ms >= 1577836800000) {
      var d = new Date(ms);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
  } catch (e) {}
  var now = new Date();
  if (now.getFullYear() >= 2020) return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  return '--:--';
}

function pollWifi() {
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null) {
    if (wifiBusy() === '') wifiLine.set('off');
    return;
  }
  if (st.state === 3) {
    wifiLine.set('ip ' + st.ip);
    wifiBusy.set('');
  } else if (st.state === 0 && wifiBusy() !== '') {
    wifiLine.set('failed ' + wifiBusy());
    wifiBusy.set('');
  } else if (wifiBusy() === '') {
    wifiLine.set(NET_STATES[st.state] || ('st ' + st.state));
  }
}
function pollOnce() {
  pollWifi();
  refreshOta();                              /* r132: listener state at 600 ms */
  clockText.set(readClock());

  if (!bleProbed) {
    bleProbed = true;
    var probe = lume.ble.status();
    bleReady = typeof probe === 'object' && probe !== null;
    if (!bleReady) btLine.set('off');
  } else if (bleReady && blePoll !== null) {
    pollBle();
  }

  var mv = lume.pmic.battVoltageMv();
  var pct = lume.pmic.battPercent();
  var charge = lume.pmic.chargingStatus();
  battPct.set(typeof pct === 'number' && pct >= 0 && pct <= 100 ? Math.round(pct) : -1);
  var batt = (pct >= 0 ? pct + '%' : '--') +
    (mv >= 0 ? ' ' + (mv / 1000).toFixed(2) + 'V' : '') +
    (charge >= 0 && charge <= 5 ? ' ' + CHARGE_STATES[charge] : '');
  battLine.set(batt);

  var mounted = lume.storage.Fs.mounted();
  var keys = kv.keys();
  storeLine.set((mounted === true ? 'fs ok' : 'fs --') +
    (typeof keys === 'object' && keys !== null ? ' ' + keys.length + ' kv' : ''));
}

var pollTimer = null;
function startPolling() {
  if (pollTimer !== null) return;
  pollOnce();
  pollTimer = lume.system.setInterval(pollOnce, 600);
}
function stopPolling() {
  if (pollTimer === null) return;
  lume.system.clearInterval(pollTimer);
  pollTimer = null;
}

/* ---- shared subpage widgets (r206 round AMOLED language) -------------------- */

function backPill(dest) {
  return Button({ title: '<', onPress: function () { go(dest); }, style: {
    position: 'absolute', x: 4, y: 2, width: 48, height: 30,
    background: '#16202E', borderColor: '#233245', borderWidth: 1,
    borderRadius: 15, color: '#9EB3C6', fontSize: 16
  } });
}

/* ---- page: menu (r205 round AMOLED design, shared dial bezel) --------------- */

function menuGroupHeader(label, y) {
  return Canvas({ width: 320, height: 12,
    style: { position: 'absolute', x: 4, y: y - 76, scroll: 'none' },
    onDraw: function (c) {
      c.fillColor('#09101A'); c.fillRect(0, 0, 320, 12);
      drawMicroLabel(c, label, 4, 2, '#5C7794');
    } });
}

function makeMenuRow(y, svgBytes, title, rightNode, isOnFn, action) {
  var children = [];
  var iconNode = Image({ src: svgBytes, style: { width: 34, height: 34, borderRadius: 17 } });
  if (iconNode > 0) children.push(iconNode);
  children.push(Text({ text: title, style: { flexGrow: 1, height: 24, fontSize: 16, color: 'text' } }));
  children.push(rightNode);
  return View({ onPress: action, style: {
    position: 'absolute', x: 4, y: y - 76, width: 320, height: 52,
    background: function () { return isOnFn && isOnFn() ? '#14292E' : '#16202E'; },
    borderColor: function () { return isOnFn && isOnFn() ? '#34A88B' : '#233245'; },
    borderWidth: 1, borderRadius: 12,
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    paddingLeft: 10, paddingRight: 10, gap: 10, scroll: 'none'
  } }, children);
}

function drawSwitchTrailing(c, isOn) {
  var bg = isOn ? '#14292E' : '#16202E';
  c.fillColor(bg); c.fillRect(0, 0, 66, 28);
  drawCapsule(c, 2, 2, 44, 24, isOn ? '#40D8B0' : '#1F2C3D', isOn ? '#6EEAC8' : '#3A4E66');
  var kx = isOn ? 34 : 14;
  c.fillCircle(kx, 15, 9, isOn ? '#196C5A' : '#0B121B');
  c.fillCircle(kx, 14, 9, '#E6EFF7');
  c.fillCircle(kx, 13, 7, '#FFFFFF');
  drawChevron(c, 56, 14, '#5C7794');
}

function drawVolumeTrailing(c, pct) {
  c.fillColor('#16202E'); c.fillRect(0, 0, 118, 28);
  drawCapsule(c, 2, 11, 52, 6, '#1F2C3D', '#32455A');
  var fw = Math.round(50 * Math.max(0, Math.min(100, pct)) / 100);
  if (fw > 2) {
    c.fillColor('#40D8B0'); c.fillRect(3, 12, fw, 4);
    c.fillCircle(3 + fw, 14, 2, '#40D8B0');
  }
  var label = pct + '%';
  c.text(62, 7, label, '#9EB3C6');
  drawChevron(c, 108, 14, '#5C7794');
}

function drawSystemTrailing(c) {
  c.fillColor('#16202E'); c.fillRect(0, 0, 82, 28);
  c.text(10, 7, 'System', '#9EB3C6');
  drawChevron(c, 72, 14, '#5C7794');
}

var wifiTrailing = Canvas({ width: 66, height: 28, style: { scroll: 'none' },
  onDraw: function (c) {
    var s = wifiLine();
    drawSwitchTrailing(c, s !== 'off' && s !== 'disconnected');
  } });

var btTrailing = Canvas({ width: 66, height: 28, style: { scroll: 'none' },
  onDraw: function (c) {
    var s = btLine();
    drawSwitchTrailing(c, s !== 'off' && s !== 'idle');
  } });

var volTrailing = Canvas({ width: 118, height: 28, style: { scroll: 'none' },
  onDraw: function (c) { drawVolumeTrailing(c, volume()); } });

var sysTrailing = Canvas({ width: 82, height: 28, style: { scroll: 'none' },
  onDraw: function (c) { drawSystemTrailing(c); } });

var battCompCanvas = Canvas({ width: 68, height: 24,
  style: { position: 'absolute', x: 256, y: 2, scroll: 'none' },
  onDraw: function (c) {
    var p = battPct();
    var shown = p >= 0 ? p : 85;
    c.fillColor('#09101A'); c.fillRect(0, 0, 68, 24);
    drawCapsule(c, 0, 0, 68, 24, '#13222C', '#245852');
    c.fillColor('#40D8B0');
    c.line(8, 8, 20, 8, '#40D8B0', 1);
    c.line(8, 16, 20, 16, '#40D8B0', 1);
    c.line(8, 8, 8, 16, '#40D8B0', 1);
    c.line(20, 8, 20, 16, '#40D8B0', 1);
    c.fillRect(21, 10, 2, 4);
    var fillW = Math.max(1, Math.round(9 * shown / 100));
    c.fillRect(10, 10, fillW, 4);
    c.text(26, 5, (p >= 0 ? p + '%' : '--%'), '#40D8B0');
  } });

var dialBezel = View({ style: {
  position: 'absolute', x: 14, y: 14, width: 452, height: 452,
  borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
  scroll: 'none'
} });

var menuPage = View({ style: {
  position: 'absolute', x: 76, y: 76, width: 328, height: 328,
  background: '#09101A', scroll: 'none'
} }, [
  View({ style: {
    position: 'absolute', x: 4, y: 2, width: 62, height: 24,
    background: '#16202E', borderRadius: 12, borderWidth: 1, borderColor: '#233245',
    display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
  } }, [
    Text({ text: clockText, style: { fontSize: 13, color: '#9EB3C6', textAlign: 'center' } })
  ]),
  Text({ text: 'Settings', style: {
    position: 'absolute', x: 74, y: 0, width: 180, height: 28,
    fontSize: 22, color: 'text', textAlign: 'center'
  } }),
  battCompCanvas,
  menuGroupHeader('CONNECTIONS', 115),
  makeMenuRow(131, SVG_WIFI, 'Wi-Fi', wifiTrailing,
    function () { var s = wifiLine(); return s !== 'off' && s !== 'disconnected'; },
    function () { go('wifi'); }),
  makeMenuRow(189, SVG_BT, 'Bluetooth', btTrailing,
    function () { var s = btLine(); return s !== 'off' && s !== 'idle'; },
    function () { go('bt'); }),
  menuGroupHeader('SOUND', 250),
  makeMenuRow(266, SVG_SOUND, 'Volume', volTrailing, null, function () { go('general'); }),
  menuGroupHeader('DEVICE', 327),
  makeMenuRow(343, SVG_GEAR, 'General', sysTrailing, null, function () { go('general'); })
]);
pageNodes.menu = menuPage;

/* ---- page: wifi (r206 round AMOLED design) ---------------------------------- */

function wifiVisualState() {
  var s = wifiLine();
  var busy = wifiBusy();
  if (busy !== '' || s.indexOf('connecting') === 0 || s.indexOf('scanning') === 0) return 'connecting';
  if (s.indexOf('ip ') === 0 || s === 'associated' || s === 'got ip') return 'connected';
  if (s.indexOf('err') >= 0 || s.indexOf('failed') === 0) return 'error';
  return 'off';
}

function netRow(item) {
  return View({ style: {
    width: '100%', height: 48, background: '#09101A',
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingTop: 2, paddingBottom: 2, scroll: 'none'
  }, onPress: function () { connectNet(item); } }, [
    Canvas({ width: 274, height: 44, style: { scroll: 'none' }, onDraw: function (c) {
      var isAuto = autoSsid() === item.ssid;
      c.fillColor('#09101A'); c.fillRect(0, 0, 274, 44);
      drawCardBox(c, 0, 0, 274, 44, isAuto ? '#14292E' : '#16202E', isAuto ? '#34A88B' : '#233245');
      drawSignalBars(c, 12, 15, isAuto ? 3 : 2, '#40D8B0');
      c.text(36, 14, item.ssid.slice(0, 14), '#F2F7FB');
      if (isAuto) {
        drawCapsule(c, 196, 12, 46, 20, '#133334', '#285E5C');
        c.text(204, 15, 'AUTO', '#40D8B0');
      }
      drawLockGlyph(c, 252, 16, '#5C7794');
    } }),
    Button({ title: 'X', onPress: function () { forgetNet(item); }, style: {
      width: 40, height: 44, borderRadius: 10,
      background: '#2A1720', borderColor: '#692C3B', borderWidth: 1, color: '#FF6B79'
    } })
  ]);
}

var wifiHeaderCanvas = Canvas({ width: 128, height: 30,
  style: { position: 'absolute', x: 196, y: 2, scroll: 'none' },
  onDraw: function (c) {
    var st = wifiVisualState();
    c.fillColor('#09101A'); c.fillRect(0, 0, 128, 30);
    if (st === 'connected') drawStatusPill(c, 12, 3, 114, 24, 'CONNECTED', '#40D8B0', '#122A2B', '#2E7D6B');
    else if (st === 'connecting') drawStatusPill(c, 6, 3, 120, 24, 'CONNECTING', '#FFD78E', '#2A2315', '#745B2A');
    else if (st === 'error') drawStatusPill(c, 44, 3, 82, 24, 'ERROR', '#FF6B79', '#2A1720', '#7A3240');
    else drawStatusPill(c, 52, 3, 74, 24, 'OFF', '#9EB3C6', '#16202E', '#2A3B4F');
  } });

var wifiHeroCanvas = Canvas({ width: 320, height: 54,
  style: { position: 'absolute', x: 4, y: 38, scroll: 'none' },
  onDraw: function (c) {
    var st = wifiVisualState();
    var line = wifiLine();
    var busy = wifiBusy();
    var auto = autoSsid();
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 54);
    var fill = st === 'connected' ? '#12262B' : (st === 'connecting' ? '#241E14' : '#16202E');
    var brd = st === 'connected' ? '#34A88B' : (st === 'connecting' ? '#8A6B30' : '#233245');
    drawCardBox(c, 0, 0, 320, 54, fill, brd);
    var icCol = st === 'connected' ? '#40D8B0' : (st === 'connecting' ? '#FFD78E' : '#5C7794');
    var icBg = st === 'connected' ? '#133334' : (st === 'connecting' ? '#332914' : '#1B2838');
    var icRing = st === 'connected' ? '#285E5C' : (st === 'connecting' ? '#6B5326' : '#2A3B4F');
    drawWifiGlyph(c, 28, 27, icCol, icBg, icRing);
    var title = busy !== '' ? busy.slice(0, 16) : (auto !== '' ? auto.slice(0, 16) : 'Wi-Fi Radio');
    c.text(56, 10, title, '#F2F7FB');
    var sub = st === 'off' ? 'Disconnected - tap Scan' : line.slice(0, 26);
    c.text(56, 30, sub, st === 'connected' ? '#40D8B0' : (st === 'connecting' ? '#FFD78E' : '#9EB3C6'));
    if (st === 'connected') {
      c.fillCircle(296, 27, 12, '#163D38');
      c.line(291, 27, 295, 31, '#40D8B0', 2);
      c.line(295, 31, 302, 23, '#40D8B0', 2);
    } else if (st === 'connecting') {
      c.arc(296, 27, 9, 0, 270, 2, '#FFD78E');
    } else {
      c.fillCircle(296, 27, 5, '#3A4E66');
    }
  } });

var wifiSavedHeaderCanvas = Canvas({ width: 320, height: 14,
  style: { position: 'absolute', x: 4, y: 150, scroll: 'none' },
  onDraw: function (c) {
    var n = savedNets().length;
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 14);
    drawMicroLabel(c, 'SAVED NETWORKS', 4, 3, '#5C7794');
    c.text(246, 0, n === 0 ? 'EMPTY' : (n + ' SAVED'), '#5C7794');
  } });

var wifiPage = View({ style: {
  position: 'absolute', x: 76, y: 76, width: 328, height: 328,
  background: '#09101A', scroll: 'none'
} }, [
  backPill('menu'),
  Text({ text: 'Wi-Fi', style: {
    position: 'absolute', x: 58, y: 2, width: 132, height: 28,
    fontSize: 20, color: '#F2F7FB', textAlign: 'center'
  } }),
  wifiHeaderCanvas,
  wifiHeroCanvas,
  Button({ title: 'Scan', onPress: function () { go('scan'); }, style: {
    position: 'absolute', x: 4, y: 98, width: 102, height: 46, borderRadius: 12,
    background: '#116354', borderColor: '#40D8B0', borderWidth: 1, color: '#F2F7FB', fontSize: 14
  } }),
  Button({ title: 'Add', onPress: addNetwork, style: {
    position: 'absolute', x: 113, y: 98, width: 102, height: 46, borderRadius: 12,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, color: '#F2F7FB', fontSize: 14
  } }),
  Button({ title: 'Disconnect', onPress: disconnectNet, style: {
    position: 'absolute', x: 222, y: 98, width: 102, height: 46, borderRadius: 12,
    background: '#2A1720', borderColor: '#692C3B', borderWidth: 1, color: '#FF6B79', fontSize: 13
  } }),
  wifiSavedHeaderCanvas,
  List({ items: savedNets, itemHeight: 48, overscan: 1,
    renderItem: netRow,
    style: { position: 'absolute', x: 4, y: 168, width: 320, height: 156,
      background: '#09101A', scrollbar: 'auto' } })
]);
pageNodes.wifi = wifiPage;

/* ---- page: wifi scan (r206 round AMOLED design) ----------------------------- */

function scanRow(item) {
  return View({ style: {
    width: '100%', height: 48, background: '#09101A',
    paddingTop: 2, paddingBottom: 2, scroll: 'none'
  }, onPress: function () { connectFromScan(item); } }, [
    Canvas({ width: 320, height: 44, style: { scroll: 'none' }, onDraw: function (c) {
      c.fillColor('#09101A'); c.fillRect(0, 0, 320, 44);
      drawCardBox(c, 0, 0, 320, 44, '#16202E', '#233245');
      var tier = item.rssi >= -58 ? 3 : (item.rssi >= -72 ? 2 : 1);
      drawSignalBars(c, 12, 15, tier, tier === 1 ? '#FFD78E' : '#40D8B0');
      var name = item.ssid === '' ? '(hidden)' : item.ssid.slice(0, 15);
      c.text(36, 14, name, '#F2F7FB');
      c.text(222, 14, item.rssi + ' dBm', '#9EB3C6');
      if (item.auth === 0) {
        c.text(282, 14, 'OPEN', '#FFD78E');
      } else {
        drawLockGlyph(c, 296, 16, '#5C7794');
      }
    } })
  ]);
}

var scanHeaderCanvas = Canvas({ width: 104, height: 30,
  style: { position: 'absolute', x: 220, y: 2, scroll: 'none' },
  onDraw: function (c) {
    var n = scanResults().length;
    c.fillColor('#09101A'); c.fillRect(0, 0, 104, 30);
    var label = n > 0 ? (n + ' FOUND') : 'READY';
    drawStatusPill(c, 8, 3, 94, 24, label, n > 0 ? '#40D8B0' : '#9EB3C6',
      n > 0 ? '#122A2B' : '#16202E', n > 0 ? '#2E7D6B' : '#2A3B4F');
  } });

var scanLabelCanvas = Canvas({ width: 320, height: 14,
  style: { position: 'absolute', x: 4, y: 92, scroll: 'none' },
  onDraw: function (c) {
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 14);
    drawMicroLabel(c, 'NEARBY', 4, 3, '#5C7794');
    c.text(130, 0, wifiLine().slice(0, 24), '#9EB3C6');
  } });

var scanPage = View({ style: {
  position: 'absolute', x: 76, y: 76, width: 328, height: 328,
  background: '#09101A', scroll: 'none'
} }, [
  backPill('wifi'),
  Text({ text: 'Wi-Fi Scan', style: {
    position: 'absolute', x: 58, y: 2, width: 156, height: 28,
    fontSize: 20, color: '#F2F7FB', textAlign: 'center'
  } }),
  scanHeaderCanvas,
  Button({ title: 'Rescan', onPress: scanNow, style: {
    position: 'absolute', x: 4, y: 38, width: 320, height: 46, borderRadius: 12,
    background: '#116354', borderColor: '#40D8B0', borderWidth: 1, color: '#F2F7FB', fontSize: 15
  } }),
  scanLabelCanvas,
  List({ items: scanResults, itemHeight: 48, overscan: 1,
    renderItem: scanRow,
    style: { position: 'absolute', x: 4, y: 110, width: 320, height: 192,
      background: '#09101A', scrollbar: 'auto' } }),
  Text({ text: 'Tap a network to connect', style: {
    position: 'absolute', x: 4, y: 306, width: 320, height: 18,
    fontSize: 12, color: '#5C7794', textAlign: 'center'
  } })
]);
pageNodes.scan = scanPage;

/* ---- page: bluetooth (r206 round AMOLED design) ----------------------------- */

function btVisualState() {
  var s = btLine();
  if (s.indexOf('connected') === 0) return 'connected';
  if (s.indexOf('advertising') === 0) return 'advertising';
  return 'off';
}

var btHeaderCanvas = Canvas({ width: 96, height: 30,
  style: { position: 'absolute', x: 228, y: 2, scroll: 'none' },
  onDraw: function (c) {
    var st = btVisualState();
    c.fillColor('#09101A'); c.fillRect(0, 0, 96, 30);
    if (st === 'connected') drawStatusPill(c, 10, 3, 84, 24, 'CONN', '#40D8B0', '#122A2B', '#2E7D6B');
    else if (st === 'advertising') drawStatusPill(c, 16, 3, 78, 24, 'ADV', '#5B9DF7', '#152B44', '#2F5C8D');
    else drawStatusPill(c, 20, 3, 74, 24, 'OFF', '#9EB3C6', '#16202E', '#2A3B4F');
  } });

var btHeroCanvas = Canvas({ width: 320, height: 112,
  style: { position: 'absolute', x: 4, y: 42, scroll: 'none' },
  onPress: function () {
    if (btVisualState() === 'off') bleStart(); else bleStop();
  },
  onDraw: function (c) {
    var st = btVisualState();
    var isOn = st !== 'off';
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 112);
    var fill = st === 'connected' ? '#12262B' : (isOn ? '#142338' : '#16202E');
    var brd = st === 'connected' ? '#34A88B' : (isOn ? '#2F5C8D' : '#233245');
    drawCardBox(c, 0, 0, 320, 112, fill, brd);
    drawBtGlyph(c, 32, 36, isOn ? '#5B9DF7' : '#5C7794', '#152B44', isOn ? '#2F5C8D' : '#2A3B4F');
    c.text(62, 17, btName().slice(0, 16), '#F2F7FB');
    c.text(62, 37, 'BLE GATT Peripheral', '#9EB3C6');
    drawCapsule(c, 256, 24, 46, 24, isOn ? '#40D8B0' : '#1F2C3D', isOn ? '#6EEAC8' : '#3A4E66');
    var kx = isOn ? 290 : 268;
    c.fillCircle(kx, 36, 9, '#FFFFFF');
    c.line(14, 70, 306, 70, '#243548', 1);
    c.text(16, 82, 'Status', '#9EB3C6');
    var badgeText = st === 'connected' ? 'CONNECTED' : (st === 'advertising' ? 'ADVERTISING' : btLine().toUpperCase());
    var badgeCol = st === 'connected' ? '#40D8B0' : (st === 'advertising' ? '#5B9DF7' : '#9EB3C6');
    c.text(170, 82, badgeText.slice(0, 16), badgeCol);
  } });

var btIdentityCanvas = Canvas({ width: 320, height: 68,
  style: { position: 'absolute', x: 4, y: 162, scroll: 'none' },
  onPress: renameBle,
  onDraw: function (c) {
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 68);
    drawMicroLabel(c, 'IDENTITY', 4, 2, '#5C7794');
    drawCardBox(c, 0, 18, 320, 50, '#16202E', '#233245');
    c.text(16, 36, 'Device Name', '#F2F7FB');
    c.text(196, 36, btName().slice(0, 11), '#9EB3C6');
    drawChevron(c, 300, 43, '#5C7794');
  } });

var btPage = View({ style: {
  position: 'absolute', x: 76, y: 76, width: 328, height: 328,
  background: '#09101A', scroll: 'none'
} }, [
  backPill('menu'),
  Text({ text: 'Bluetooth', style: {
    position: 'absolute', x: 58, y: 2, width: 164, height: 28,
    fontSize: 20, color: '#F2F7FB', textAlign: 'center'
  } }),
  btHeaderCanvas,
  btHeroCanvas,
  btIdentityCanvas,
  Button({ title: 'Advertise', onPress: bleStart, style: {
    position: 'absolute', x: 4, y: 242, width: 156, height: 48, borderRadius: 12,
    background: function () { return btVisualState() === 'off' ? '#116354' : '#1F2C3D'; },
    borderColor: function () { return btVisualState() === 'off' ? '#40D8B0' : '#233245'; },
    borderWidth: 1,
    color: '#F2F7FB', fontSize: 14
  } }),
  Button({ title: 'Stop', onPress: bleStop, style: {
    position: 'absolute', x: 168, y: 242, width: 156, height: 48, borderRadius: 12,
    background: function () { return btVisualState() === 'off' ? '#16202E' : '#2A1720'; },
    borderColor: function () { return btVisualState() === 'off' ? '#233245' : '#692C3B'; },
    borderWidth: 1,
    color: function () { return btVisualState() === 'off' ? '#5C7794' : '#FF6B79'; },
    fontSize: 14
  } }),
  Text({ text: 'Discoverable as Nordic-UART peripheral', style: {
    position: 'absolute', x: 4, y: 300, width: 320, height: 20,
    fontSize: 12, color: '#5C7794', textAlign: 'center'
  } })
]);
pageNodes.bt = btPage;

/* ---- page: general (r206 round AMOLED design) ------------------------------- */

var generalHeaderCanvas = Canvas({ width: 72, height: 30,
  style: { position: 'absolute', x: 252, y: 2, scroll: 'none' },
  onDraw: function (c) {
    var p = battPct();
    c.fillColor('#09101A'); c.fillRect(0, 0, 72, 30);
    drawCapsule(c, 2, 3, 68, 24, '#13222C', '#245852');
    c.text(18, 8, (p >= 0 ? p + '%' : '--%'), '#40D8B0');
  } });

var volSliderCanvas = Canvas({ width: 212, height: 48, style: { scroll: 'none' },
  onDraw: function (c) {
    var pct = Math.max(0, Math.min(100, volume()));
    c.fillColor('#16202E'); c.fillRect(0, 0, 212, 48);
    c.text(4, 4, 'VOLUME', '#9EB3C6');
    c.text(168, 4, pct + '%', '#40D8B0');
    drawCapsule(c, 4, 28, 204, 10, '#1F2C3D', '#32455A');
    var fw = Math.round(196 * pct / 100);
    if (fw > 4) {
      drawCapsule(c, 5, 29, Math.max(8, fw), 8, '#40D8B0', null);
    }
    var tx = Math.max(14, Math.min(198, 6 + fw));
    c.fillCircle(tx, 33, 11, '#40D8B0');
    c.fillCircle(tx, 33, 9, '#F2F7FB');
    c.fillCircle(tx, 33, 3, '#117B69');
  } });

var telemetryCanvas = Canvas({ width: 320, height: 26,
  style: { position: 'absolute', x: 4, y: 194, scroll: 'none' },
  onDraw: function (c) {
    c.fillColor('#09101A'); c.fillRect(0, 0, 320, 26);
    drawCardBox(c, 0, 0, 320, 26, '#121B28', '#233245');
    c.text(10, 6, ('Batt ' + battLine()).slice(0, 18), '#9EB3C6');
    var stText = storeLine() + (volNote() === '' ? '' : ' ' + volNote());
    c.text(184, 6, stText.slice(0, 16), '#9EB3C6');
  } });

var generalPage = View({ style: {
  position: 'absolute', x: 76, y: 76, width: 328, height: 328,
  background: '#09101A', scroll: 'none'
} }, [
  backPill('menu'),
  Text({ text: 'General', style: {
    position: 'absolute', x: 58, y: 2, width: 188, height: 28,
    fontSize: 20, color: '#F2F7FB', textAlign: 'center'
  } }),
  generalHeaderCanvas,
  View({ style: {
    position: 'absolute', x: 4, y: 36, width: 320, height: 56,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingLeft: 6, paddingRight: 6, gap: 4, scroll: 'none'
  } }, [
    Button({ title: '-', onPress: function () { applyVolume(volume() - 10, true); }, style: {
      width: 44, height: 44, borderRadius: 10, background: '#1F2C3D',
      borderColor: '#32455A', borderWidth: 1, color: '#F2F7FB', fontSize: 18
    } }),
    volSliderCanvas,
    Button({ title: '+', onPress: function () { applyVolume(volume() + 10, true); }, style: {
      width: 44, height: 44, borderRadius: 10, background: '#1F2C3D',
      borderColor: '#32455A', borderWidth: 1, color: '#F2F7FB', fontSize: 18
    } })
  ]),
  /* r132 OTA ROW BEGIN -- exactly 3 new nodes (View + Text + Button).
   * The Text shows status only; the full token never enters a render path.
   * Kept BEFORE the r129 NTP row so the 3-node NTP slice stays isolated. */
  View({ style: {
    position: 'absolute', x: 4, y: 98, width: 320, height: 42,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingLeft: 10, paddingRight: 8, gap: 6, scroll: 'none'
  } }, [
    Text({ text: function () {
      return otaLine() + (otaNote() === '' ? '' : ' ' + otaNote());
    }, style: { fontSize: 13, color: function () {
      var s = otaLine();
      return s.indexOf(':') >= 0 ? '#40D8B0' : (s.indexOf('err') >= 0 ? '#FF6B79' : '#9EB3C6');
    } } }),
    Button({ title: 'New token', onPress: rotateOtaToken, style: {
      width: 104, height: 32, borderRadius: 9, background: '#1F2C3D',
      borderColor: '#32455A', borderWidth: 1, color: '#F2F7FB', fontSize: 12
    } })
  ]),
  /* r132 OTA ROW END */
  /* r129: NTP sync row -- exactly 3 new nodes (View + Text + Button). */
  View({ style: {
    position: 'absolute', x: 4, y: 146, width: 320, height: 42,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingLeft: 10, paddingRight: 8, gap: 6, scroll: 'none'
  } }, [
    Text({ text: function () { return timeSyncLine(); }, style: { fontSize: 13, color: function () {
      var s = timeSyncLine();
      return s.indexOf('SYNCED') >= 0 ? '#40D8B0' : (s.indexOf('FAILED') >= 0 || s.indexOf('ERR') >= 0 ? '#FF6B79' : '#FFD78E');
    } } }),
    Button({ title: 'Sync now', onPress: syncTimeNow, style: {
      width: 96, height: 32, borderRadius: 9, background: '#1F2C3D',
      borderColor: '#32455A', borderWidth: 1, color: '#F2F7FB', fontSize: 12
    } })
  ]),
  /* r143 REBOOT ROW BEGIN -- exactly 3 new nodes (View + Text + Button).
   * The button opens a shell.Dialog; the Text is status only and the guarded
   * note is the sole feedback when a binding is absent. */
  View({ style: {
    position: 'absolute', x: 4, y: 226, width: 320, height: 42,
    background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingLeft: 10, paddingRight: 8, gap: 6, scroll: 'none'
  } }, [
    Text({ text: function () {
      return rebootNote() === '' ? 'Restart the device' : rebootNote();
    }, style: { fontSize: 13, color: '#9EB3C6' } }),
    Button({ title: 'Reboot', onPress: rebootNow, style: {
      width: 96, height: 32, borderRadius: 9, background: '#2A2315',
      borderColor: '#745B2A', borderWidth: 1, color: '#FFD78E', fontSize: 12
    } })
  ]),
  /* r143 REBOOT ROW END */
  telemetryCanvas,
  View({ style: {
    position: 'absolute', x: 4, y: 276, width: 320, height: 48,
    display: 'flex', flexDirection: 'row', gap: 8, scroll: 'none'
  } }, [
    Button({ title: 'Sleep now', onPress: function () { lume.power.sleepNow(); }, style: {
      flexGrow: 1, height: 48, borderRadius: 12, background: '#16202E',
      borderColor: '#233245', borderWidth: 1, color: '#F2F7FB', fontSize: 14
    } }),
    Button({ title: function () {
      return powerNote() === '' ? 'Power off' : powerNote();
    }, onPress: powerOff, style: {
      flexGrow: 1, height: 48, borderRadius: 12, background: '#2A1720',
      borderColor: '#7A3240', borderWidth: 1, color: '#FF6B79', fontSize: 14
    } })
  ])
]);
pageNodes.general = generalPage;

/* ---- root + lifecycle ---------------------------------------------------------------------- */

var root = View({ style: {
  width: '100%', height: '100%', background: 'bg', scroll: 'none'
} }, [dialBezel, menuPage, wifiPage, btPage, generalPage, scanPage, kbOverlay]);

showPage('menu');
clockText.set(readClock());
var initBatt = lume.pmic.battPercent();
if (typeof initBatt === 'number' && initBatt >= 0 && initBatt <= 100) battPct.set(Math.round(initBatt));
var initMv = lume.pmic.battVoltageMv();
var initChg = lume.pmic.chargingStatus();
battLine.set((initBatt >= 0 ? Math.round(initBatt) + '%' : '--') +
  (initMv >= 0 ? ' ' + (initMv / 1000).toFixed(2) + 'V' : '') +
  (initChg >= 0 && initChg <= 5 ? ' ' + CHARGE_STATES[initChg] : ''));
var initFs = lume.storage && lume.storage.Fs && typeof lume.storage.Fs.mounted === 'function' ? lume.storage.Fs.mounted() : false;
var initKeys = kv && typeof kv.keys === 'function' ? kv.keys() : null;
storeLine.set((initFs === true ? 'fs ok' : 'fs --') +
  (typeof initKeys === 'object' && initKeys !== null ? ' ' + initKeys.length + ' kv' : ''));
timeSyncLine.set(timeSyncStatus());

lume.app.onStart(function () {
  startPolling();
  applyVolume(volume(), false);   /* restore persisted volume */
  autoConnect();
  timeSyncLine.set(timeSyncStatus());
  refreshOta();
});
lume.app.onPause(function () {
  stopPolling();
  if (blePoll !== null) { lume.system.clearInterval(blePoll); blePoll = null; }
});
lume.app.onResume(function () {
  startPolling();
  timeSyncLine.set(timeSyncStatus());
  refreshOta();
});
lume.app.onBack(function () {
  if (kbOpen) { kbHide(); return true; }
  if (page() === 4) { go('wifi'); return true; }   /* scan -> wifi page */
  if (page() !== 0) { go('menu'); return true; }
  return false;                   /* default: back out to the home launcher */
});
