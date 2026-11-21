/* Headless network acceptance app. run.sh supplies config in the flash image. */
var netCheckConfig = typeof __NETCHECK_CONFIG === 'object' ? __NETCHECK_CONFIG : {
  ssid: 'emu-test', password: 'emupass123', url: 'http://192.168.4.1:18765/', sd: false
};
var netCheckText = signal('Network check starting');
View({style:{width:'100%',height:'100%',background:'#101827',padding:24,
  display:'flex',justifyContent:'center',alignItems:'center'}}, [
  Text({text:netCheckText,style:{color:'#ffffff',fontSize:24,longMode:'wrap'}})
]);

var netCheckDone = false;
function netCheckLog(step, ok, detail) {
  lume.log('[NETCHECK] ' + step + ' ' + (ok ? 'PASS' : 'FAIL') + ' ' + detail);
  netCheckText.set(step + ' ' + (ok ? 'PASS' : 'FAIL'));
  if (!ok) netCheckDone = true;
  return ok;
}
function netCheckSd() {
  var sd = lume.storage.Sd;
  var mounted = sd.mounted();
  if (!netCheckLog('sd_mount', mounted === true, 'mounted=' + mounted)) return;
  var path = '/netcheck.txt';
  var value = 'lume-emu-net-r142';
  var write = sd.write(path, value);
  if (!netCheckLog('sd_write', write === 0, 'ret=' + write)) return;
  var read = sd.read(path);
  if (!netCheckLog('sd_read', read === value, 'match=' + (read === value))) return;
}
function netCheckAllPass() {
  netCheckDone = true;
  netCheckText.set('ALL PASS');
  lume.log('[NETCHECK] ALL PASS');
}
var init = lume.net.init();
if (netCheckConfig.sd) netCheckSd();
if (netCheckLog('init', init === 0, 'ret=' + init)) {
  var connect = lume.net.connect(netCheckConfig.ssid, netCheckConfig.password);
  if (netCheckLog('connect', connect === 0, 'ret=' + connect)) {
    var polls = 0;
    var timer = lume.system.setInterval(function () {
      if (netCheckDone) { lume.system.clearInterval(timer); return; }
      var status = lume.net.status();
      if (status && typeof status === 'object' && status.state === lume.net.GOT_IP && status.ip) {
        lume.system.clearInterval(timer);
        if (!netCheckLog('ip', true, 'state=' + status.state + ' ip=' + status.ip)) return;
        var response = lume.net.httpRequest({url:netCheckConfig.url, method:'GET', timeoutMs:5000});
        if (!netCheckLog('http', response && typeof response === 'object',
                         'status=' + (typeof response === 'object' ? response.status : response))) return;
        netCheckAllPass();
      } else if (++polls >= 60) {
        lume.system.clearInterval(timer);
        netCheckLog('ip', false, 'timeout state=' + (status && status.state) + ' ip=' + (status && status.ip));
      } else if (polls % 10 === 0 && status && status.state === lume.net.DISCONNECTED) {
        lume.net.connect(netCheckConfig.ssid, netCheckConfig.password);
      }
    }, 500);
  }
}
