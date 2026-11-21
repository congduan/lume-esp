/** Heart-rate telemetry broadcaster over lume.ble (r146, pure app layer).
 *
 *  lume.ble (r25) is a NimBLE GATT PERIPHERAL: it advertises as "Lume" and
 *  exposes a Nordic-UART-shaped service (RX write / TX notify, 20-byte cap).
 *  It has NO central/scan API, so this app does not "scan for a heart-rate
 *  strap" -- instead the device IS the sensor: it advertises, waits for a
 *  central to connect and subscribe to TX, then streams a simulated ASCII
 *  heartbeat line ("HR 072", fixed width, <=20 bytes) once per second.
 *  Inbound central commands are shown in the HUD (truncated to 20 bytes).
 *
 *  Advertising is behind a two-stage arm/confirm gate (arm -> 3 s -> act) so
 *  a stray tap cannot drop a live link. status() returns a NEGATIVE NUMBER on
 *  failure, discriminated with typeof === 'object'; read() yields a string,
 *  null (empty FIFO) or a negative code. Without a BLE stack (playground /
 *  stub) every call is guarded with `typeof lume.ble !== 'undefined'` and the
 *  app degrades to an ASCII note instead of throwing.
 *
 *  No radio / board on the host: this is simulator/host evidence only, not
 *  on-device BLE acceptance (docs/KNOWN-SIMPLIFICATIONS.md r146).
 */

/* ---- r146: BLE telemetry logic BEGIN ---- */
var NAME = 'Lume';
var HAS_BLE = (typeof lume.ble !== 'undefined');
var STATE_NAMES = ['IDLE', 'ADVERTISING', 'CONNECTED'];

var bleState = signal('IDLE');
var subsSig = signal(false);
var pendingSig = signal(0);
var mtuSig = signal(23);
var lastCmd = signal('-');
var hrSig = signal(72);
var txCount = signal(0);
var rxCount = signal(0);
var note = signal('');
var advertising = signal(false);
var toggleArm = signal(false);
var toggleArmTimer = null;
var pollId = null;
var hrId = null;

/* r146 STATUS POLL BEGIN */
function poll() {
  var s = lume.ble.status();
  if (typeof s === 'object' && s !== null) {   /* negative number = error code */
    mtuSig.set(s.mtu);
    subsSig.set(s.subscribed);
    pendingSig.set(s.pending);
    bleState.set(STATE_NAMES[s.state] || 'IDLE');
  } else {
    note.set('status err ' + s);
    return;
  }
  var msg = lume.ble.read();
  if (typeof msg === 'number') { note.set('read err ' + msg); return; }
  if (msg !== null) {
    rxCount.set(rxCount() + 1);
    lastCmd.set(String(msg).slice(0, 20));     /* <=20B ASCII truncation */
  }
}
/* r146 STATUS POLL END */

/* r146 HR STREAM BEGIN */
function sendHr() {
  if (!HAS_BLE) return;
  if (!advertising()) return;
  if (bleState() !== 'CONNECTED' || !subsSig()) return; /* only while subscribed */
  var n = hrSig();
  var line = 'HR ' + ('00' + n).slice(-3);     /* fixed width, <=20B, ASCII */
  var r = lume.ble.write(line);
  if (r === 0) txCount.set(txCount() + 1);
  else note.set('write err ' + r);
  hrSig.set(60 + ((n - 60 + 7) % 40));         /* next simulated BPM */
  var h = history();
  history.set(h.slice(1).concat([hrSig()]));   /* rolling sparkline samples */
}
/* r146 HR STREAM END */

function startAdv() {
  if (!HAS_BLE) { note.set('BLE n/a (no stack)'); return; }
  var r = lume.ble.start(NAME);
  if (r !== 0) { note.set('start err ' + r); return; }
  advertising.set(true);
  note.set('advertising as ' + NAME);
  if (pollId === null) pollId = lume.system.setInterval(poll, 200);
  if (hrId === null) hrId = lume.system.setInterval(sendHr, 1000); /* >=1s throttle */
}

function stopAdv() {
  if (!HAS_BLE) return;
  if (pollId !== null) { lume.system.clearInterval(pollId); pollId = null; }
  if (hrId !== null) { lume.system.clearInterval(hrId); hrId = null; }
  advertising.set(false);
  bleState.set('IDLE');
  subsSig.set(false);
  pendingSig.set(0);
  lume.ble.stop();                             /* stop advertising before sleep */
  note.set('advertising stopped');
}

/* r146 TWO-STAGE GATE BEGIN */
function toggleAdvert() {
  if (!toggleArm()) {                          /* first tap: arm a 3 s confirm */
    toggleArm.set(true);
    note.set('Confirm: tap again within 3s');
    if (toggleArmTimer !== null) lume.system.clearTimeout(toggleArmTimer);
    toggleArmTimer = lume.system.setTimeout(function () {
      toggleArm.set(false);
      note.set('');
    }, 3000);
    return;                                    /* do NOT start/stop on first tap */
  }
  toggleArm.set(false);                        /* second tap: act */
  if (toggleArmTimer !== null) { lume.system.clearTimeout(toggleArmTimer); toggleArmTimer = null; }
  if (advertising()) stopAdv(); else startAdv();
}
/* r146 TWO-STAGE GATE END */

lume.app.onStart(function () {
  if (!HAS_BLE) { note.set('BLE n/a (no stack)'); return; }
  note.set('ready - tap Advertise');
});
lume.app.onPause(function () { if (advertising()) stopAdv(); });
lume.app.onResume(function () { if (advertising()) startAdv(); });
/* ---- r146: BLE telemetry logic END ---- */

/* ---- r146: UI BEGIN ---- */
var hrTheme = {
  colors: { bg: '#07111D', surface: '#132435', surfaceAlt: '#1C3449',
    text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79' },
  radius: 12, spacing: 12, fontScale: 1
};
lume.theme.set(hrTheme);
var history = signal([72, 74, 71, 76, 73, 75, 72, 77]);

var spark = Canvas({ width: 400, height: 96, onDraw: function (ctx) {
  var d = history();
  ctx.clear();
  ctx.fillColor(lume.theme.get().colors.surface);
  ctx.fillRect(0, 0, 400, 96);
  var lo = 55, hi = 105, step = 384 / (d.length - 1), pts = [];
  for (var i = 0; i < d.length; i++) {
    pts.push([Math.round(8 + i * step), Math.round(88 - (d[i] - lo) / (hi - lo) * 76)]);
  }
  ctx.polyline(pts, lume.theme.get().colors.accent, 3);
} });

function card(label, value) {
  return View({ style: {
    width: '100%', height: 44, background: 'surface', borderRadius: 12,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 10, scroll: 'none' } }, [
    Text({ text: label, style: { color: 'textDim', fontSize: 13 } }),
    Text({ text: value, style: { color: 'text', fontSize: 15 } })
  ]);
}

View({ style: {
  width: '100%', height: '100%', background: 'bg', scroll: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 24, gap: 8
} }, [
  View({ style: { width: '100%', height: 58, display: 'flex', flexDirection: 'column', gap: 2 } }, [
    Text({ text: 'HR monitor', style: { fontSize: 24, color: 'text' } }),
    Text({ text: 'BLE peripheral / simulated telemetry', style: { fontSize: 13, color: 'textDim' } })
  ]),
  card('state', function () { return bleState(); }),
  card('subscribed', function () { return subsSig() ? 'yes' : 'no'; }),
  card('pending', function () { return String(pendingSig()); }),
  card('mtu', function () { return String(mtuSig()); }),
  card('HR', function () { return String(hrSig()) + ' BPM / tx ' + txCount(); }),
  card('last cmd', function () { return lastCmd() + ' / rx ' + rxCount(); }),
  card('note', function () { return note() === '' ? '-' : note(); }),
  spark,
  Button({ title: function () {
    if (toggleArm()) return advertising() ? 'Confirm stop?' : 'Confirm adv?';
    return advertising() ? 'Stop advertising' : 'Advertise';
  }, onPress: toggleAdvert, style: { width: '100%', height: 56, background: 'accent', borderRadius: 999 } })
]);
/* ---- r146: UI END ---- */
