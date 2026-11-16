/* LAN card settings: set WiFi credentials and a per-device token before use. */
var WIFI_SSID = 'YOUR_SSID';
var WIFI_PASSWORD = 'YOUR_PASSWORD';
var WEB_TOKEN = 'change-this-token';
var address = signal('Connecting WiFi...');
var mode = signal('Sequence');
var kv = lume.storage.kv;

View({style:{width:'100%',height:'100%',background:'#101827',padding:24,
  display:'flex',flexDirection:'column',justifyContent:'center',gap:16}}, [
  Text({text:'Card settings',style:{fontSize:32,color:'#FFFFFF'}}),
  Text({text:address,style:{fontSize:20,color:'#64E6C8',longMode:'wrap'}}),
  Text({text:mode,style:{fontSize:20,color:'#FFFFFF'}})
]);

function formValue(body, key) {
  var parts = body.split('&');
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    var k = parts[i].slice(0, eq);
    if (k === key) {
      try { return decodeURIComponent(parts[i].slice(eq + 1).replace(/\+/g, ' ')); }
      catch (e) { return ''; }
    }
  }
  return '';
}

lume.net.web.on('GET', '/', function () {
  var page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Card settings</title></head><body><h1>Card settings</h1><form method="post" action="/api/config"><label>Mode <select name="mode"><option value="sequence">Sequence</option><option value="random">Random</option><option value="compare">Compare case</option></select></label><label>Start letter <select name="start">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('')}</select></label><button>Save</button></form><script>document.querySelector('form').action='/api/config'+location.search</script></body></html>`;
  return {status:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body:page};
});
lume.net.web.on('POST', '/api/config', function (req) {
  var nextMode = formValue(req.body, 'mode');
  var nextStart = formValue(req.body, 'start');
  if (['sequence','random','compare'].indexOf(nextMode) < 0 ||
      !/^[A-Z]$/.test(nextStart)) {
    return {status:400, body:'Invalid mode or start letter'};
  }
  if (kv.set('card.mode', nextMode) < 0 || kv.set('card.start', nextStart) < 0)
    return {status:500, body:'Save failed'};
  mode.set(nextMode + ' / ' + nextStart);
  return {status:200, body:'Saved: ' + nextMode + ' / ' + nextStart};
});

lume.net.connect(WIFI_SSID, WIFI_PASSWORD);
var started = false;
lume.system.setInterval(function () {
  var st = lume.net.status();
  if (typeof st === 'number' || st.state !== lume.net.GOT_IP) {
    address.set('Waiting for WiFi IP...');
    return;
  }
  if (!started) {
    var rc = lume.net.web.start({token:WEB_TOKEN});
    if (rc < 0) { address.set('Web start error ' + rc); return; }
    started = true;
  }
  address.set(lume.net.web.url() || 'Waiting for web address...');
}, 500);
