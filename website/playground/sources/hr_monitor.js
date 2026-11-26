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
 *  Advertising is behind a shell.Dialog confirmation (r164) so a stray tap
 *  cannot drop a live link. status() returns a NEGATIVE NUMBER on
 *  failure, discriminated with typeof === 'object'; read() yields a string,
 *  null (empty FIFO) or a negative code. Without a BLE stack (playground /
 *  stub) every call is guarded with `typeof lume.ble !== 'undefined'` and the
 *  app degrades to an ASCII note instead of throwing.
 *
 *  r200: round-screen SafeArea layout (docs/DESIGN-TOKENS.md): all cards,
 *  hero BPM readout, shell.Sparkline (explicitly positioned, no overlap), and
 *  action button live inside global [80, 400] x [76, 396].
 *
 *  No radio / board on the host: this is simulator/host evidence only, not
 *  on-device BLE acceptance (docs/KNOWN-SIMPLIFICATIONS.md r146).
 */

import '../../runtime/shell.js';

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

/* r164: BLE advertise/stop gate BEGIN (shell.Dialog replaces the r146 two-stage arm) */
function toggleAdvert() {
  var shell = lume.ui && lume.ui.shell;
  if (!shell || typeof shell.Dialog !== 'function') {
    note.set('BLE n/a (no dialog)');           /* never auto-start/stop without a modal */
    return;
  }
  var stopping = advertising();
  var label = stopping ? 'Stop adv' : 'Start adv';
  shell.Dialog({
    title: stopping ? 'Stop advertising?' : 'Start advertising?',
    message: stopping ? 'The link drops and this device stops advertising.'
                      : 'This device advertises as ' + NAME + ' for a central.',
    buttons: [
      { label: 'Cancel', style: 'plain' },
      { label: label, style: 'danger', onPress: function () {
        if (!HAS_BLE || typeof lume.ble === 'undefined') {
          note.set('BLE n/a (no stack)');      /* stub without the binding */
          return;
        }
        if (advertising()) stopAdv(); else startAdv();
      } }
    ]
  });
}
/* r164: BLE advertise/stop gate END */

lume.app.onStart(function () {
  if (!HAS_BLE) { note.set('BLE n/a (no stack)'); return; }
  note.set('ready - tap Advertise');
});
lume.app.onPause(function () { if (advertising()) stopAdv(); });
lume.app.onResume(function () { if (advertising()) startAdv(); });
/* ---- r146: BLE telemetry logic END ---- */

/* ---- r146: UI BEGIN ---- */
var hrTheme = {
  colors: { bg: '#0D1420', surface: '#16202E', surfaceAlt: '#1F2C3D',
    text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79' },
  radius: 12, spacing: 8, fontScale: 1
};
lume.theme.set(hrTheme);
var history = signal([72, 74, 71, 76, 73, 75, 72, 77]);

var backdrop = View({ style: {
  x: 0, y: 0, width: 480, height: 480, padding: 0, gap: 0,
  background: 'bg', scroll: 'none'
} });

var safe = lume.ui.shell.SafeArea({ parent: backdrop, shape: 'round', size: 480, children: [] });

/* Header + hero BPM readout (unique primary metric, global y: 76..122). */
Text({ parent: safe, text: 'HR MONITOR',
  style: { x: 10, y: 8, width: 160, height: 24, fontSize: 20, borderRadius: 0, color: 'text', scroll: 'none' } });
Text({ parent: safe, text: function () { return note() === '' ? 'BLE PERIPHERAL' : note(); },
  style: { x: 10, y: 32, width: 176, height: 18, fontSize: 14, borderRadius: 0, color: 'textDim', scroll: 'none' } });
Text({ parent: safe, text: function () { return String(hrSig()) + ' BPM'; },
  style: { x: 184, y: 6, width: 146, height: 38, fontSize: 32, borderRadius: 0, textAlign: 'right',
    color: 'text', scroll: 'none' } });

function card(label, value, x, y, w) {
  return View({ parent: safe, style: {
    x: x, y: y, width: w, height: 36, background: 'surface', borderRadius: 8,
    display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 8, gap: 4, scroll: 'none' } }, [
    Text({ text: label, style: { color: 'textDim', fontSize: 14, borderRadius: 0, scroll: 'none' } }),
    Text({ text: value, style: { color: 'text', fontSize: 14, borderRadius: 0, scroll: 'none' } })
  ]);
}

/* 2x2 BLE status grid inside global [80..400] x [128..208]. */
card('state', function () { return bleState(); }, 10, 58, 156);
card('subscribed', function () { return subsSig() ? 'yes' : 'no'; }, 174, 58, 156);
card('pending', function () { return String(pendingSig()); }, 10, 100, 156);
card('mtu', function () { return String(mtuSig()); }, 174, 100, 156);

Text({ parent: safe, text: function () {
    return 'TX ' + txCount() + '  RX ' + rxCount() + '  CMD ' + lastCmd();
  },
  style: { x: 10, y: 142, width: 320, height: 18, fontSize: 14, borderRadius: 0, color: 'textDim', scroll: 'none' } });

/* Sparkline panel (bg-2 card with explicitly positioned shell.Sparkline). */
View({ parent: safe, style: {
  x: 10, y: 164, width: 320, height: 96, padding: 0, gap: 0,
  background: 'surface', borderRadius: 12, scroll: 'none'
} });
/* r194: the hand-rolled Canvas polyline is now shell.Sparkline. `history`
 * stays the caller-owned signal; the component reads it inside onDraw, so a
 * publish from sendHr() repaints. The old fixed 55..105 BPM domain is kept. */
var spark = lume.ui.shell.Sparkline({ parent: safe, x: 18, y: 172, width: 304, height: 80,
  data: history, min: 55, max: 105, strokeWidth: 3 });

Button({ parent: safe, title: function () {
    return advertising() ? 'Stop adv' : 'Start adv';
  }, onPress: toggleAdvert, style: {
    x: 40, y: 274, width: 260, height: 52, borderRadius: 999, fontSize: 16,
    background: function () { return advertising() ? '#16202E' : '#117B69'; },
    borderWidth: 2,
    borderColor: function () { return advertising() ? '#FF6B79' : '#40D8B0'; },
    scroll: 'none'
  } });
/* ---- r146: UI END ---- */
