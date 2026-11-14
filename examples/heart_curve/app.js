/** r16: a signal-driven curve alongside declarative text and a button. */
var samples = signal([28, 31, 26, 38, 45, 39, 54, 61, 58, 72, 64, 77]);
var tick = signal(0);
var chart = Canvas({width: 220, height: 120, onDraw: function (ctx) {
  var data = samples();
  ctx.clear();
  ctx.fillColor('#102438');
  ctx.fillRect(0, 0, 220, 120);
  ctx.line(10, 100, 210, 100, '#46617A', 1);
  var points = [];
  for (var i = 0; i < data.length; i++)
    points.push([10 + i * 18, 100 - data[i]]);
  ctx.polyline(points, '#47E0B1', 2);
  ctx.text(10, 8, 'pulse / simulated', '#DCECF5', 14);
}});
View({style: {display: 'flex', flexDirection: 'column', gap: 12,
  padding: 10, width: 240, background: '#0B1724'}}, [
  Text({text: function () { return 'samples: ' + tick(); }}),
  chart,
  Button({title: 'Next sample', onPress: function () {
    var n = tick() + 1;
    var old = samples();
    samples.set(old.slice(1).concat([35 + ((n * 37) % 50)]));
    tick.set(n);
  }})
]);
