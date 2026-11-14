/** M3 flex counter. The firmware embeds the same app in lume_demo_js. */
var count = signal(0);
View({ style: {
  display: 'flex', flexDirection: 'column',
  justifyContent: 'space-between', alignItems: 'center',
  gap: 8, padding: 16, background: '#0B1E3F',
  width: '100%', height: '100%', borderRadius: 12
} }, [
  Text({ text: function () { return 'taps: ' + count(); } }),
  Button({ title: '+1', style: { width: '50%', borderRadius: 12 },
    onPress: function () { count.set(count() + 1); } })
]);
