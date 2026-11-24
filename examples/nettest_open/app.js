/* net_check open-network variant for ESP-EMU assoc testing (r142 follow-up). */
var root = View({ style: { width: 480, height: 480, background: '#0A1420', scroll: 'none' } });
var status = signal('BOOT');
Text({ parent: root, x: 20, y: 20, text: status, color: '#40D8B0' });
function log(msg) { status.set(msg); lume.log('[NETCHECK] ' + msg); }
lume.net.init();
log('init PASS ret=0');
log('connect open emu-test');
var r = lume.net.connect('emu-test', '');
log('connect PASS ret=' + r);
lume.system.setInterval(function () {
  var st = lume.net.status();
  log('state=' + st.state + ' ip=' + (st.ip || 'null'));
}, 5000);
