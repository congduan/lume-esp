/** Bluetooth connect demo (r25 API). Advertises as "Lume" (Nordic-UART-shaped
 *  GATT peripheral) and walks the connection lifecycle on screen:
 *
 *    OFF -> 1 ADVERTISING -> 2 CONNECTED -> 3 LINKED (handshake verified)
 *
 *  On a live link the app sends "HELLO"; the central completes the pairing
 *  handshake by writing anything back (nRF Connect / Web BLE console), which
 *  is acked with "OK <msg>". Later RX packets are still acked (session echo).
 *
 *  NOTE the firmware limit (docs/KNOWN-SIMPLIFICATIONS.md r25): lume.ble has
 *  NO real pairing / bonding / encryption -- "linked" here only means the
 *  central answered the handshake over an unauthenticated link, suitable for
 *  trusted local debugging only. Polling mirrors examples/imu_poll/app.js.
 */
var NAME = 'Lume';
var linkStatus = signal('BLE: idle');
var phase = signal(0);            // 0 off, 1 advertising, 2 connected, 3 linked
var lastMsg = signal('-');
var rxCount = signal(0);
var txCount = signal(0);
var pings = signal(0);
var mtuSig = signal(23);
var subsSig = signal(false);
var pollId = null;

function send(data) {
  var r = lume.ble.write(data);
  if (r === 0) txCount.set(txCount() + 1);
  else linkStatus.set('BLE write error: ' + r);
}

function resetSession() {
  rxCount.set(0); txCount.set(0); pings.set(0);
  lastMsg.set('-');
}

function drainRx() {
  var msg = lume.ble.read();
  if (typeof msg === 'number') {
    linkStatus.set('BLE read error: ' + msg);
    return;
  }
  if (msg === null) return;
  rxCount.set(rxCount() + 1);
  lastMsg.set(msg);
  if (phase() < 3) {
    phase.set(3);
    linkStatus.set('link verified (handshake OK)');
  }
  send('OK ' + msg.slice(0, 15));   // ack within the 20-byte payload cap
}

function poll() {
  var st = lume.ble.status();
  if (typeof st === 'number') {
    linkStatus.set('BLE status error: ' + st);
    return;
  }
  mtuSig.set(st.mtu);
  subsSig.set(st.subscribed);
  if (st.state === 2 && st.connected) {
    if (phase() < 2) {
      phase.set(2);
      linkStatus.set('connected - sending HELLO');
      send('HELLO');
    }
    drainRx();
  } else if (st.state === 1) {
    if (phase() >= 2) resetSession();   // link dropped, advertising again
    phase.set(1);
    linkStatus.set('advertising - waiting for central');
  } else {
    if (phase() > 0) resetSession();
    phase.set(0);
    linkStatus.set('BLE: idle');
  }
}

function startBle() {
  var r = lume.ble.start(NAME);
  if (r !== 0) {
    linkStatus.set('BLE start error: ' + r);
    return;
  }
  if (pollId === null) pollId = lume.system.setInterval(poll, 100);
}

function stopBle() {
  if (pollId !== null) lume.system.clearInterval(pollId);
  pollId = null;
  phase.set(0);
  resetSession();
  lume.ble.stop();   // must stop advertising before light sleep
}

lume.app.onStart(startBle);
lume.app.onPause(stopBle);
lume.app.onResume(startBle);

/* ---- UI ---- */
var COLORS = { bg: '#0B1724', card: '#132436' };

function row(label, value) {
  return View({ style: {
    width: '100%', height: 52, background: COLORS.card, borderRadius: 12,
    display: 'flex', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', padding: 10,
    scroll: 'none' } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}

/* Pairing flow steps: 'ok' when reached, 'wait' while it is the live step. */
function stepRow(label, n) {
  return View({ style: {
    width: '100%', height: 52, background: COLORS.card, borderRadius: 12,
    display: 'flex', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', padding: 10,
    scroll: 'none' } }, [
    Text({ text: label, style: {} }),
    Text({ text: function () {
      return phase() >= n ? 'ok' : (phase() + 1 === n ? 'wait...' : '-');
    } })
  ]);
}

View({ style: {
  width: '100%', height: '100%', background: COLORS.bg,
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 36, gap: 8
} }, [
  Text({ text: 'Bluetooth pairing', style: {} }),
  row('device', function () { return NAME + ' (peripheral)'; }),
  stepRow('1 advertise', 1),
  stepRow('2 connect', 2),
  stepRow('3 handshake', 3),
  row('link', function () { return linkStatus(); }),
  row('session', function () {
    return 'rx ' + rxCount() + ' / tx ' + txCount() +
      ' / mtu ' + mtuSig() + (subsSig() ? ' sub' : '');
  }),
  row('last rx', function () { return lastMsg(); }),
  View({ style: {
    width: '100%', height: 56, display: 'flex', flexDirection: 'row', gap: 8,
    scroll: 'none' } }, [
    Button({ title: 'Ping', onPress: function () {
      var r = lume.ble.write('ping');
      if (r === 0) pings.set(pings() + 1);
      else linkStatus.set('BLE write error: ' + r);
    }, style: { flexGrow: 1, height: 56, borderRadius: 12 } }),
    Button({ title: 'Stop', onPress: stopBle,
      style: { flexGrow: 1, height: 56, borderRadius: 12 } }),
    Button({ title: 'Advertise', onPress: startBle,
      style: { flexGrow: 1, height: 56, borderRadius: 12 } })
  ]),
  Text({ text: 'connect with any NUS BLE console, reply to HELLO to pair', style: {} })
]);
