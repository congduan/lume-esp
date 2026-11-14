/** Clock + IMU polling. The interval is owned by this app and stops on pause. */
var seconds = signal(0);
var motion = signal('IMU: waiting');
var pollId = null;

function poll() {
  seconds.set(seconds() + 1);
  var sample = lume.imu.read();
  motion.set(sample ? 'az: ' + sample.az.toFixed(2) + ' m/s2' : 'IMU unavailable');
}
function startPolling() {
  if (pollId === null) pollId = lume.system.setInterval(poll, 1000);
}
function stopPolling() {
  if (pollId !== null) lume.system.clearInterval(pollId);
  pollId = null;
}
lume.app.onStart(startPolling);
lume.app.onPause(stopPolling);
lume.app.onResume(startPolling);

View({ style: {
  width: '100%', height: '100%', background: '#0B1724',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 40, gap: 12
} }, [
  Text({ text: 'IMU POLL', style: {} }),
  card('uptime', function () { return seconds() + 's'; }),
  card('motion', function () { return motion(); }),
  Button({ title: 'Poll now', style: { width: '100%', height: 56, borderRadius: 12 },
    onPress: poll })
]);

function card(label, value) {
  return View({ style: {
    width: '100%', height: 64, background: '#132436', borderRadius: 12,
    borderWidth: 0, display: 'flex', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', padding: 10,
    scroll: 'none' } }, [
    Text({ text: label, style: {} }),
    Text({ text: value, style: {} })
  ]);
}
