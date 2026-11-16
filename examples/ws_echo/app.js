/* Set credentials for your AP; the public echo endpoint requires Internet. */
var WIFI_SSID = 'YOUR_SSID';
var WIFI_PASSWORD = 'YOUR_PASSWORD';
var WS_URL = 'wss://echo.websocket.org';
var status = signal('Connecting WiFi');
var received = signal('Waiting for echo');
var wsHandle = null;
var attempted = false;

View({style:{width:'100%',height:'100%',background:'#07111D',padding:24,
  display:'flex',flexDirection:'column',justifyContent:'center',gap:16}}, [
  Text({text:'WebSocket echo',style:{fontSize:28,color:'#F2F7FB'}}),
  Text({text:status,style:{fontSize:18,color:'#40D8B0'}}),
  Text({text:received,style:{fontSize:20,color:'#F2F7FB'}}),
  Button({title:'Send hello',style:{height:56,background:'#40D8B0'},
    onPress:function () {
      if (wsHandle) status.set(wsHandle.send('Hello from Lume') === 0 ? 'Sent' : 'Send failed');
    }})
]);

var wifiStart = lume.net.connect(WIFI_SSID, WIFI_PASSWORD);
if (wifiStart < 0) status.set('WiFi error ' + wifiStart + ' (set credentials)');
var poll = lume.system.setInterval(function () {
  var netStatus = lume.net.status();
  if (attempted || typeof netStatus === 'number' || netStatus.state !== lume.net.GOT_IP) return;
  attempted = true;
  status.set('Connecting WebSocket');
  lume.net.ws.connect(WS_URL, {
    onMessage:function (data) { if (typeof data === 'string') received.set(data); },
    onClose:function () { wsHandle = null; status.set('Closed'); },
    onError:function (err) { status.set('WebSocket error ' + err); }
  }, function (err, handle) {
    if (err) { status.set('Connect failed ' + err); return; }
    wsHandle = handle;
    status.set('Connected');
    handle.send('Hello from Lume');
  });
}, 500);
