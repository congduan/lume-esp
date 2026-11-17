const assert = require('node:assert/strict');
const { runApp } = require('./lib/prelude_runner');
const app = `Canvas({width:100,height:100,onDraw:function(ctx){
  ctx.fillCircle(20,21,9,'#ff0000');
  ctx.fillEllipse(40,41,12,6,'#00ff00');
  ctx.ellipse(60,61,16,7,'#0000ff');
  ctx.ellipse(70,71,11,5,'#ffffff',4);
}});`;
const session = runApp(app);
const draws = session.messages.filter(m => m[0] === 'draw');
assert.deepEqual(draws.map(m => m.slice(2)), [
  [6,20,21,9,0,0xff0000,1],
  [7,40,41,12,6,0x00ff00,1],
  [8,60,61,16,7,0x0000ff,1],
  [8,70,71,11,5,0xffffff,4]
]);
console.log('PASS prelude emits fillCircle/fillEllipse/ellipse draw records');
