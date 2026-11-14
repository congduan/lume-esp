/** Heart-curve demo: a signal-driven polyline on a canvas that fills the
 * middle of the panel. The canvas keeps a fixed pixel size (a canvas buffer
 * must have dimensions), the layout around it is flex. */
var samples = signal([28, 31, 26, 38, 45, 39, 54, 61, 58, 72, 64, 77]);
var tick = signal(0);

var chart = Canvas({ width: 400, height: 280, onDraw: function (ctx) {
  var data = samples();
  ctx.clear();
  ctx.fillColor('#102438');
  ctx.fillRect(0, 0, 400, 280);
  ctx.line(16, 240, 384, 240, '#46617A', 1);
  ctx.line(16, 60, 16, 240, '#46617A', 1);
  var step = (400 - 32) / (data.length - 1);
  var points = [];
  for (var i = 0; i < data.length; i++)
    points.push([Math.round(16 + i * step), 240 - data[i]]);
  ctx.polyline(points, '#47E0B1', 2);
  for (var j = 0; j < points.length; j++)
    ctx.circle(points[j][0], points[j][1], 3, '#DCECF5');
  ctx.text(24, 70, 'pulse / simulated', '#DCECF5', 14);
} });

View({ style: {
  width: '100%', height: '100%', background: '#0B1724',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 40, gap: 8
} }, [
  View({ style: { display: 'flex', flexDirection: 'row',
    justifyContent: 'space-between', width: '100%', height: 20 } }, [
    Text({ text: 'HEART CURVE', style: {} }),
    Text({ text: function () { return 'samples: ' + tick(); }, style: {} })
  ]),
  chart,
  Button({ title: 'Next sample', style: { width: '100%', height: 56, borderRadius: 12 },
    onPress: function () {
      var n = tick() + 1;
      var old = samples();
      samples.set(old.slice(1).concat([35 + ((n * 37) % 50)]));
      tick.set(n);
    } })
]);
