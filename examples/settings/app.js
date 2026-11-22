/** Settings app: WiFi (station / WPA2-PSK), Bluetooth (BLE peripheral) and
 *  general device settings (volume, battery, sleep, power off, storage).
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots and the
 *  engine does NOT reject ids beyond it (creates are silently dropped on the
 *  LVGL side, leaving JS/UI diverged), so this app keeps its static tree at
 *  ~98 nodes (incl. the r132 OTA status row) and its two virtualized Lists add
 *  <= ~25 visible rows worst case.
 *  The on-screen keyboard is therefore 4 compact rows; BACK navigation uses
 *  the prelude's global gesture (swipe up) instead of per-page back buttons.
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
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 10, fontScale: 1 };
lume.theme.set(settingsTheme);

var SAFE = 24;
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
var storeLine = signal('--');
var volume = signal(function () {
  var v = kv.get('set.volume');
  return typeof v === 'number' && v >= 0 && v <= 100 ? v : 50;
}());
var volNote = signal('');
var powerConfirm = signal(false);
var wifiBusy = signal('');         /* ssid while a connect attempt is running */
var timeSyncLine = signal('TIME SYNC: --');  /* r129: General-page NTP status */
var otaLine = signal('ota off');             /* r132: General-page OTA status */
var otaNote = signal('');                    /* r132: transient setToken result */
var rebootNote = signal('');                 /* r143: transient reboot guard note */

var savedNets = signal(loadSaved());
var autoSsid = signal(function () {
  var s = kv.get('wifi.auto');
  return typeof s === 'string' ? s : '';
}());

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
    width: '100%', height: 44, display: 'flex', flexDirection: 'row', gap: 4
  } }, children);
}
function kbKeyButton(k) {
  return Button({
    title: function () { return keyChar(k) === 'space' ? 'space' : keyChar(k); },
    onPress: function () { kbKey(k); },
    style: {
      flexGrow: k[2] || 2, height: 44,
      background: function () {
        var label = keyChar(k);
        return (label === 'DEL' || label === 'ESC' || label === 'OK' ||
                label === 'space' || label === '#123' || label === 'ABC')
          ? '#1B3145' : 'surface';
      }
    }
  });
}
/* rows are flex: every key grows by k[2] (default 1), so widths auto-fit; */

var kbDisplay = Text({ text: function () {
  var title = kbTitle();
  var t = kbText();
  var shown = t;
  if (kbTitle().indexOf('Password') === 0) {
    shown = new Array(t.length + 1).join('*');
  }
  /* label + input must stay inside the 63-byte text attribute cap */
  var room = 60 - title.length;
  if (shown.length > room) shown = '<' + shown.slice(shown.length - room + 1);
  return title + ': ' + (shown === '' ? '|' : shown);
}, style: { width: '100%', height: 26, textAlign: 'left' } });

var kbChildren = [kbDisplay];
for (var r = 0; r < KB_ROWS.length; r++) {
  kbChildren.push(kbRow(KB_ROWS[r].map(kbKeyButton)));
}
var kbOverlay = View({ style: {
  position: 'absolute', x: 12, y: 234, width: 456, height: 234,
  background: '#0E1B28', borderRadius: 14,
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
  /* WiFi survives app switches (driver-level association; init latches for
   * the process lifetime), so only reconnect when the station is idle:
   * CONNECTING/CONNECTED/GOT_IP mean nothing to do (and calling connect()
   * again would kick a needless re-association). */
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
var armTimer = null;
function powerOff() {
  if (!powerConfirm()) {
    powerConfirm.set(true);
    if (armTimer !== null) lume.system.clearTimeout(armTimer);
    armTimer = lume.system.setTimeout(function () { powerConfirm.set(false); }, 3000);
    return;
  }
  powerConfirm.set(false);
  lume.pmic.powerOff();
}

/* ---- r129: time sync (r128 lume.system.time / setTimeNtp primitives) ----------
 * time() and Date.now() both read gettimeofday(), so a synced device shows
 * them agreeing at a large wall epoch while a cold boot reports a small
 * near-1970 value for both. The difference plus magnitude is an honest,
 * radio-free "synced?" heuristic (ASCII copy, r64 discipline). */
function timeSyncStatus() {
  var t = lume.system.time(), d = Date.now();
  if (typeof t !== 'number' || typeof d !== 'number') return 'TIME SYNC: NOT SYNCED';
  if (Math.abs(t - d) > 5000) return 'TIME SYNC: NOT SYNCED';
  return t > 1000000000000 ? 'TIME SYNC: NTP OK' : 'TIME SYNC: NOT SYNCED';
}
function syncTimeNow() {
  var sys = lume.system;
  if (!sys || typeof sys.setTimeNtp !== 'function') {
    timeSyncLine.set('TIME SYNC: NO API');
    return;
  }
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null || st.state !== lume.net.GOT_IP) {
    timeSyncLine.set('TIME SYNC: NO WIFI');
    return;
  }
  var r = sys.setTimeNtp();            /* default server / default 10 s */
  if (r === 0) timeSyncLine.set('TIME SYNC: NTP OK');
  else if (r === -2) timeSyncLine.set('TIME SYNC: SYNC FAILED');
  else if (r === -3) timeSyncLine.set('TIME SYNC: NO WIFI');
  else timeSyncLine.set('TIME SYNC: ERR ' + r);
}

/* ---- r132: OTA status + token rotation BEGIN (pure app layer) ----------------
 * lume.ota.status() is a local snapshot; a number return is an error code, so
 * discriminate with typeof === 'object'. The token field is deliberately never
 * read here: the 32-hex key stays on the serial log, never on the display. */
function otaStatusText() {
  var st = lume.ota.status();
  if (!(typeof st === 'object') || st === null) return 'ota err ' + st;
  if (!st.running) return 'ota off';
  if (!st.wifiReady) return 'ota wifi down';
  if (!st.tokenReady) return 'ota no token';
  return 'ota :' + st.port + (st.hmac ? ' hmac' : '');
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

/* ---- shared widgets ------------------------------------------------------------ */

/* Page titles are bare Texts (node budget): BACK navigation comes from the
 * prelude's global swipe-up gesture, which applies to EVERY app. */
function titleText(text) {
  return Text({ text: text, style: { width: '100%', height: 36, fontSize: 24, color: 'text' } });
}
function infoRow(label, value, height) {
  return View({ style: {
    width: '100%', height: height || 40, background: 'surface',
    borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, scroll: 'none'
  } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}
function actionRow(children, height) {
  return View({ style: {
    width: '100%', height: height || 56, display: 'flex',
    flexDirection: 'row', gap: 8
  } }, children);
}
function bigButton(title, onPress, grow) {
  return Button({ title: title, onPress: onPress, style: {
    flexGrow: grow || 1, height: 56, borderRadius: 10 } });
}

/* ---- page: menu ------------------------------------------------------------------ */

function menuHeader(label) {
  return Text({ text: label, style: { width: '100%', height: 22, fontSize: 14, color: '#92AAB6' } });
}
function menuRow(icon, title, value, action) {
  return View({ onPress: action, style: {
    width: '100%', height: 56, background: 'surface', borderRadius: 12,
    display: 'flex', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12
  } }, [
    Text({ text: icon, style: { width: 24, height: 24, fontSize: 20, color: 'accent', textAlign: 'center' } }),
    Text({ text: title, style: { width: 126, height: 28, fontSize: 16, color: 'text' } }),
    Text({ text: value, style: { flexGrow: 1, height: 24, fontSize: 14, color: '#92AAB6', textAlign: 'right' } }),
    Text({ text: '>', style: { width: 12, height: 24, color: '#92AAB6', textAlign: 'right' } })
  ]);
}

var menuChildren = [
  titleText('Settings'),
  Text({ text: function () { return 'Battery  ' + battLine(); }, style: { width: '100%', height: 24, fontSize: 14, color: '#92AAB6' } }),
  menuHeader('CONNECTIONS'),
  menuRow('W', 'Wi-Fi', function () { return wifiLine() === 'off' ? 'Off' : 'On'; }, function () { go('wifi'); }),
  menuRow('B', 'Bluetooth', function () { return btLine() === 'off' ? 'Off' : 'On'; }, function () { go('bt'); }),
  menuHeader('DEVICE'),
  menuRow('G', 'General', function () { return volume() + '% volume'; }, function () { go('general'); }),
  Text({ text: 'Swipe up to go back', style: { width: '100%', height: 24, fontSize: 14, color: '#92AAB6' } })
];

var menuPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 12,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, menuChildren);
pageNodes.menu = menuPage;

/* ---- page: wifi --------------------------------------------------------------------- */

function netRow(item) {
  var isAuto = function () { return autoSsid() === item.ssid; };
  return View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 6, scroll: 'none'
  }, onPress: function () { connectNet(item); } }, [
    Text({ text: function () {
      return item.ssid.slice(0, 14) + (isAuto() ? ' (auto)' : '');
    }, style: { flexGrow: 1 } }),
    Button({ title: 'X', onPress: function () { forgetNet(item); },
      style: { width: 36, height: 34, borderRadius: 8 } })
  ]);
}

var wifiPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 8,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleText('WiFi'),
  infoRow('status', function () { return wifiLine(); }),
  actionRow([
    bigButton('Scan', function () { go('scan'); }),
    bigButton('Disconnect', disconnectNet),
    bigButton('Add', addNetwork)
  ]),
  Text({ text: 'saved - tap to connect, X to forget',
    style: { width: '100%', height: 20 } }),
  List({ items: savedNets, itemHeight: 44, overscan: 1,
    renderItem: netRow,
    style: { width: '100%', height: 132, background: 'primary',
      scrollbar: 'auto' } })
]);
pageNodes.wifi = wifiPage;

/* ---- page: wifi scan --------------------------------------------------------------- */

function scanRow(item) {
  /* one text per row (node budget): name + rssi + auth in a single label */
  return View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    padding: 8, scroll: 'none'
  }, onPress: function () { connectFromScan(item); } }, [
    Text({ text: function () {
      var name = item.ssid === '' ? '(hidden)' : item.ssid.slice(0, 16);
      return name + '  ' + item.rssi + 'dBm' + (item.auth === 0 ? ' open' : '');
    }, style: { flexGrow: 1 } })
  ]);
}

var scanPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 8,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleText('WiFi scan'),
  infoRow('status', function () { return wifiLine(); }),
  actionRow([bigButton('Rescan', scanNow)]),
  List({ items: scanResults, itemHeight: 44, overscan: 1,
    renderItem: scanRow,
    style: { width: '100%', height: 176, background: 'primary',
      scrollbar: 'auto' } }),
  Text({ text: 'Tap a network to connect',
    style: { width: '100%', height: 20 } })
]);
pageNodes.scan = scanPage;

/* ---- page: bluetooth ------------------------------------------------------------------ */

var btPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 10,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleText('Bluetooth'),
  infoRow('device', function () {
    return btName() + ' ' + btLine();
  }),
  actionRow([
    bigButton('Advertise', bleStart),
    bigButton('Stop', bleStop),
    bigButton('Rename', renameBle)
  ]),
  Text({ text: 'Ready to connect with another device',
    style: { width: '100%', height: 22 } })
]);
pageNodes.bt = btPage;

/* ---- page: general ---------------------------------------------------------------------- */

var generalPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 8,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleText('General'),
  View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 8, scroll: 'none'
  } }, [
    Text({ text: 'volume', style: {} }),
    Button({ title: '-', onPress: function () { applyVolume(volume() - 10, true); },
      style: { width: 44, height: 34, borderRadius: 8 } }),
    Text({ text: function () { return volume() + '%'; }, style: { width: 56, textAlign: 'center' } }),
    Button({ title: '+', onPress: function () { applyVolume(volume() + 10, true); },
      style: { width: 44, height: 34, borderRadius: 8 } })
  ]),
  infoRow('battery', function () { return battLine(); }),
  infoRow('storage', function () {
    return storeLine() + (volNote() === '' ? '' : ' ' + volNote());
  }),
  /* r132 OTA ROW BEGIN -- exactly 3 new nodes (View + Text + Button).
   * The Text shows status only; the full token never enters a render path.
   * Kept BEFORE the r129 NTP row so the 3-node NTP slice stays isolated. */
  View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 8, scroll: 'none'
  } }, [
    Text({ text: function () {
      return otaLine() + (otaNote() === '' ? '' : ' ' + otaNote());
    }, style: {} }),
    Button({ title: 'New token', onPress: rotateOtaToken,
      style: { width: 132, height: 34, borderRadius: 8 } })
  ]),
  /* r132 OTA ROW END */
  /* r129: NTP sync row -- exactly 3 new nodes (View + Text + Button). */
  View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 8, scroll: 'none'
  } }, [
    Text({ text: function () { return timeSyncLine(); }, style: {} }),
    Button({ title: 'Sync now', onPress: syncTimeNow,
      style: { width: 92, height: 34, borderRadius: 8 } })
  ]),
  /* r143 REBOOT ROW BEGIN -- exactly 3 new nodes (View + Text + Button).
   * The button opens a shell.Dialog; the Text is status only and the guarded
   * note is the sole feedback when a binding is absent. */
  View({ style: {
    width: '100%', height: 44, background: 'surface',
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 8, scroll: 'none'
  } }, [
    Text({ text: function () {
      return rebootNote() === '' ? 'Restart the device' : rebootNote();
    }, style: {} }),
    Button({ title: 'Reboot', onPress: rebootNow,
      style: { width: 132, height: 34, borderRadius: 8 } })
  ]),
  /* r143 REBOOT ROW END */
  actionRow([
    bigButton('Sleep now', function () { lume.power.sleepNow(); }),
    bigButton(function () {
      return powerConfirm() ? 'Confirm off?' : 'Power off';
    }, powerOff, 1)
  ]),
  Text({ text: 'Touch the screen to wake from sleep',
    style: { width: '100%', height: 40 } })
]);
pageNodes.general = generalPage;

/* ---- root + lifecycle ---------------------------------------------------------------------- */

var root = View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none'
} }, [menuPage, wifiPage, btPage, generalPage, scanPage, kbOverlay]);

showPage('menu');

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
