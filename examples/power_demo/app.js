/** Touch activity keeps the panel awake; idle 15 seconds enters light sleep.
 * This demo owns WiFi for its lifetime. Reinitialize it before using net APIs. */
var lastActivity = lume._nowMs();
var state = signal('awake at ' + Math.floor(lastActivity));
var netStatus = lume.net.deinit(); // boot starts WiFi even when disconnected
var touch = function () { lastActivity = lume._nowMs(); };

View({ style: {
  width: '100%', height: '100%', background: '#0B1E3F', scroll: 'none',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 24
}, onPress: touch }, [
  Text({ text: function () { return state(); }, style: { textAlign: 'center' } }),
  Button({ title: 'Keep awake', style: { width: 280, height: 64, borderRadius: 12 },
           onPress: touch })
]);

if (netStatus !== 0) state.set('WiFi deinit error ' + netStatus);
lume.power.onWake(function () {
  lastActivity = lume._nowMs();
  state.set('awake at ' + Math.floor(lume._nowMs()));
});
