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
View({style: {display: 'flex', flexDirection: 'column', gap: 12,
  padding: 10, width: 240, background: '#0B1724'}}, [
  Text({text: function () { return 'uptime: ' + seconds() + 's'; }}),
  Text({text: function () { return motion(); }}),
  Button({title: 'Poll now', onPress: poll})
]);
