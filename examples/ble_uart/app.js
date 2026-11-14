/** BLE UART echo (r25). Advertises a Nordic-UART-Service-shaped GATT
 *  peripheral: a phone BLE console can write text to RX and read TX echoes.
 *  Polling (no JS callbacks) mirrors examples/imu_poll/app.js. */
var stateText = signal('BLE: idle');
var lastText = signal('waiting for data');
var sentCount = signal(0);
var pollId = null;
var STATE_NAMES = ['idle', 'advertising', 'connected'];

function poll() {
  var st = lume.ble.status();
  if (typeof st === 'number') {
    stateText.set('BLE: error ' + st);
    return;
  }
  stateText.set('BLE: ' + STATE_NAMES[st.state] +
    (st.connected ? ' subscribed:' + (st.subscribed ? 'yes' : 'no') : '') +
    ' pending:' + st.pending);
  var msg = lume.ble.read();
  if (typeof msg === 'number') {
    stateText.set('BLE read error: ' + msg);
    return;
  }
  if (msg !== null) {
    lastText.set(msg);
    lume.ble.write('echo:' + msg.slice(0, 12));  // stay within 20 bytes
  }
}

function sendPing() {
  var r = lume.ble.write('ping');
  if (r === 0) sentCount.set(sentCount() + 1);
  else stateText.set('BLE write error: ' + r);
}

function startBle() {
  var r = lume.ble.start('Lume');
  if (r !== 0) {
    stateText.set('BLE start error: ' + r);
    return;
  }
  if (pollId === null) pollId = lume.system.setInterval(poll, 100);
  poll();
}

function stopBle() {
  if (pollId !== null) lume.system.clearInterval(pollId);
  pollId = null;
  lume.ble.stop();   // must stop advertising before light sleep
}

lume.app.onStart(startBle);
lume.app.onPause(stopBle);
lume.app.onResume(startBle);

View({style: {display: 'flex', flexDirection: 'column', gap: 10,
  padding: 10, width: 240, height: 300, background: '#0B1724',
  scroll: 'none'}}, [
  Text({text: function () { return stateText(); }}),
  Text({text: function () { return 'last: ' + lastText(); }}),
  Text({text: function () { return 'pings sent: ' + sentCount(); }}),
  Button({title: 'Ping', onPress: sendPing}),
  Text({text: 'Connect with any NUS BLE console'})
]);
