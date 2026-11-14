/** Settings app: WiFi (station / WPA2-PSK), Bluetooth (BLE peripheral) and
 *  general device settings (volume, battery, sleep, power off, storage).
 *
 *  Pages are built once and switched by toggling ATTR_VISIBLE with
 *  lume.setAttr(node, 5, 0|1) -- the pattern already used by
 *  examples/dashboard/app.js and examples/file_manager/app.js. The on-screen
 *  keyboard is an absolute overlay on top; the runtime has no text-input
 *  widget, so SSID / password / BLE name are typed with key buttons.
 *
 *  Firmware limits honoured here (runtime/types/lume.d.ts):
 *  - WiFi: station only, WPA2-PSK only, NO scan list -> SSIDs are typed in
 *    and remembered in NVS (lume.storage.kv 'wifi.saved'). connect() is
 *    non-blocking; status() is polled: DISCONNECTED -> CONNECTING ->
 *    CONNECTED -> GOT_IP.
 *  - Bluetooth: lume.ble is a GATT PERIPHERAL only (Nordic-UART-shaped): the
 *    app advertises for a central; it cannot scan/pair/connect out to other
 *    devices. ble.status() WARNs on every call while NimBLE is down, so it is
 *    probed once (same as examples/device_monitor).
 *  - httpGet / connect() would block the engine task; nothing here uses them.
 *
 *  On-device acceptance (advertising, association, coexistence, sleep
 *  current) is deferred to the board bring-up round -- a green host run does
 *  NOT mean the radios work on hardware.
 */
var settingsTheme = { colors: {
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 10, fontScale: 1 };
lume.theme.set(settingsTheme);

var SAFE = 40;
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

var page = signal(0);              /* 0 menu, 1 wifi, 2 bluetooth, 3 general */
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
  page.set(name === 'menu' ? 0 : (name === 'wifi' ? 1 : (name === 'bt' ? 2 : 3)));
  showPage(name);
}

/* ---- keyboard overlay ----------------------------------------------------- */

var kbMode = signal('abc');        /* 'abc' or 'sym' */
var kbText = signal('');
var kbTitle = signal('');
var kbMax = 32;
var kbOnOk = null;
var kbOpen = false;

var KB_ROWS = [
  [['q', 'q'], ['w', 'w'], ['e', 'e'], ['r', 'r'], ['t', 't'], ['y', 'y'],
   ['u', 'u'], ['i', 'i'], ['o', 'o'], ['p', 'p']],
  [['a', 'a'], ['s', 's'], ['d', 'd'], ['f', 'f'], ['g', 'g'], ['h', 'h'],
   ['j', 'j'], ['k', 'k'], ['l', 'l'], ['DEL', 'DEL', 4]],
  [['#123', 'ABC', 4], ['z', '['], ['x', ']'], ['c', '{'], ['v', '}'],
   ['b', ':'], ['n', ';'], ['m', "'"], ['.', '"']],
  [['-', '+'], ['_', '='], ['@', '<'], ['.', '>'], [',', '?'], ['!', '/'],
   ['?', '%'], ['^', '*']],
  [['ESC', 'ESC', 3], ['space', 'space', 8], ['OK', 'OK', 3]]
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
  position: 'absolute', x: 12, y: 190, width: 456, height: 278,
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
  var list = savedNets();
  for (var i = 0; i < list.length; i++) {
    if (list[i].ssid === last) { connectNet(list[i]); return; }
  }
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

function titleBar(text) {
  return View({ style: {
    width: '100%', height: 40, display: 'flex', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center'
  } }, [
    Text({ text: text, style: {} }),
    Button({ title: '< Back', onPress: function () { go('menu'); },
      style: { width: 84, height: 36, borderRadius: 10 } })
  ]);
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
    width: '100%', height: height || 48, display: 'flex',
    flexDirection: 'row', gap: 8
  } }, children);
}
function bigButton(title, onPress, grow) {
  return Button({ title: title, onPress: onPress, style: {
    flexGrow: grow || 1, height: 48, borderRadius: 10 } });
}

/* ---- page: menu ------------------------------------------------------------------ */

var summary = Text({ text: function () {
  var w = wifiLine(), b = btLine();
  if (w.length > 22) w = w.slice(0, 22) + '.';
  if (b.length > 22) b = b.slice(0, 22) + '.';
  return 'wifi ' + w + ' | bt ' + b;
}, style: { width: '100%', height: 22, textAlign: 'left' } });

var menuChildren = [
  Text({ text: 'Settings', style: { width: '100%', height: 36 } }),
  summary,
  actionRow([bigButton('WiFi', function () { go('wifi'); })], 56),
  actionRow([bigButton('Bluetooth', function () { go('bt'); })], 56),
  actionRow([bigButton('General', function () { go('general'); })], 56),
  infoRow('battery', function () { return battLine(); }, 36),
  infoRow('storage', function () { return storeLine(); }, 36),
  Text({ text: 'BACK returns here from any page',
    style: { width: '100%', height: 36 } })
];

var menuPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 8,
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
  titleBar('WiFi'),
  infoRow('status', function () { return wifiLine(); }),
  actionRow([
    bigButton('Disconnect', disconnectNet),
    bigButton('Add network', addNetwork)
  ]),
  Text({ text: 'saved networks - tap to connect, X to forget',
    style: { width: '100%', height: 20 } }),
  List({ items: savedNets, itemHeight: 44, overscan: 1,
    renderItem: netRow,
    style: { width: '100%', height: 160, background: 'primary',
      scrollbar: 'auto' } }),
  Text({ text: 'WPA2-PSK only; no scan list in the firmware',
    style: { width: '100%', height: 22 } })
]);
pageNodes.wifi = wifiPage;

/* ---- page: bluetooth ------------------------------------------------------------------ */

var btPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 10,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleBar('Bluetooth'),
  infoRow('device', function () { return btName() + ' (peripheral)'; }),
  infoRow('status', function () { return btLine(); }),
  actionRow([bigButton('Advertise', bleStart), bigButton('Stop', bleStop)]),
  actionRow([bigButton('Rename', renameBle)]),
  Text({ text: 'a central (NUS console) connects to this board',
    style: { width: '100%', height: 22 } }),
  Text({ text: 'no scan / pairing / outbound links',
    style: { width: '100%', height: 22 } })
]);
pageNodes.bt = btPage;

/* ---- page: general ---------------------------------------------------------------------- */

var generalPage = View({ style: {
  position: 'absolute', x: 0, y: 0, width: '100%', height: '100%',
  background: 'primary', padding: SAFE, gap: 8,
  display: 'flex', flexDirection: 'column', scroll: 'none'
} }, [
  titleBar('General'),
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
  infoRow('volume note', function () { return volNote() === '' ? '-' : volNote(); }),
  infoRow('battery', function () { return battLine(); }),
  infoRow('storage', function () { return storeLine(); }),
  actionRow([bigButton('Sleep now', function () { lume.power.sleepNow(); })]),
  actionRow([bigButton(function () {
    return powerConfirm() ? 'Confirm off?' : 'Power off';
  }, powerOff, 1)]),
  Text({ text: 'sleep blocks until a touch wake; power off cuts the PMIC rail',
    style: { width: '100%', height: 40 } })
]);
pageNodes.general = generalPage;

/* ---- root + lifecycle ---------------------------------------------------------------------- */

var root = View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none'
} }, [menuPage, wifiPage, btPage, generalPage, kbOverlay]);

showPage('menu');

lume.app.onStart(function () {
  startPolling();
  applyVolume(volume(), false);   /* restore persisted volume */
  autoConnect();
});
lume.app.onPause(function () {
  stopPolling();
  if (blePoll !== null) { lume.system.clearInterval(blePoll); blePoll = null; }
});
lume.app.onResume(startPolling);
lume.app.onBack(function () {
  if (kbOpen) { kbHide(); return true; }
  if (page() !== 0) { go('menu'); return true; }
  return false;                   /* default: back out to the home launcher */
});
