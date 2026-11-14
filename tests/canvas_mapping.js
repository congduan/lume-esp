// Host harness for the exact embedded prelude and demo message sequence.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
function extract(name, end) {
  const part = source.split(`const char ${name}[] =\n`)[1].split(end)[0];
  return [...part.matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
}
const prelude = extract('lume_prelude_js', '\n\nconst char lume_demo_js');
const demo = extract('lume_demo_js', ';\n');
function harness(script) {
  const calls = [], handlers = new Map(); let next = 0;
  const lume = {
    createNode: (...a) => { calls.push(['create', ...a]); return ++next; },
    setAttr: (...a) => calls.push(['attr', ...a]),
    canvasDraw: (...a) => calls.push(['draw', ...a]),
    canvasInvalidate: id => calls.push(['invalidate', id]),
    setPressEvent: id => calls.push(['press', id]),
    log: () => {}, _nowMs: () => 0, imu: {read: () => null}
  };
  const ctx = vm.createContext({lume});
  vm.runInContext(prelude + '\n' + script, ctx);
  return {calls, ctx};
}
function pass(name, fn) { fn(); console.log('PASS ' + name); }
pass('canvas create dimensions and fixed wire kind', () => {
  const h = harness('Canvas({width:220,height:120,onDraw:function(c){c.clear();}})');
  assert.deepStrictEqual(h.calls[0], ['create',3,0,220,120]);
});
pass('drawing command order and final invalidate', () => {
  const h = harness(`Canvas({width:40,height:40,onDraw:function(c){c.clear();c.fillColor('#112233');c.fillRect(1,2,3,4);c.line(1,2,3,4,'#abcdef',2);c.polyline([[0,0],[1,1],[2,2]],'#ffffff',1);c.circle(4,5,2,'#00ff00');c.text(2,3,'ok','#ffffff',14);}})`);
  assert.deepStrictEqual(h.calls.filter(x => x[0] === 'draw').map(x => x[2]), [0,1,2,2,2,3,4]);
  assert.strictEqual(h.calls.at(-1)[0], 'invalidate');
});
pass('signal change redraws once; equal value stays idle', () => {
  const h = harness('var s=signal(1);Canvas({width:8,height:8,onDraw:function(c){c.clear();c.fillRect(s(),0,1,1);}})');
  const n = h.calls.length; vm.runInContext('s.set(1)',h.ctx); assert.strictEqual(h.calls.length,n);
  vm.runInContext('s.set(2)',h.ctx); assert.deepStrictEqual(h.calls.slice(n).map(x=>x[0]),['draw','draw','invalidate']);
});
pass('canvas is adopted into flex layout flow at fixed size', () => {
  const h = harness(`var c=Canvas({width:80,height:60,onDraw:function(c){c.clear();}});View({style:{display:'flex',flexDirection:'column',gap:4}},[Text({text:'label'}),c]);`);
  const canvasId = h.calls.find(x=>x[0]==='create'&&x[1]===3) && 1;
  assert(h.calls.some(x=>x[0]==='attr'&&x[1]===canvasId&&x[2]===6));
  assert(h.calls.some(x=>x[0]==='attr'&&x[2]===7&&x[3]===1));
});
pass('dimensions/coordinates/color/text/point bounds reject', () => {
  for (const expr of [
    'Canvas({width:481,height:1,onDraw:function(){}})',
    'Canvas({width:1,height:0,onDraw:function(){}})',
    'Canvas({width:480,height:480,onDraw:function(){}});Canvas({width:1,height:1,onDraw:function(){}})',
    'Canvas({width:2,height:2,onDraw:function(c){c.line(0,0,999,0,"#ffffff");}})',
    'Canvas({width:2,height:2,onDraw:function(c){c.fillColor("red");}})',
    'Canvas({width:2,height:2,onDraw:function(c){c.polyline([[1],[2]],"#ffffff");}})',
    'Canvas({width:2,height:2,onDraw:function(c){c.text(0,0,"x","#ffffff",32);}})'
  ]) assert.throws(() => harness(expr), expr);
});
pass('embedded demo equals polling example message sequence', () => {
  const file = fs.readFileSync('examples/imu_poll/app.js','utf8');
  assert.deepStrictEqual(harness(demo).calls,harness(file).calls);
});
const printed = harness(demo).calls;
console.log('SAMPLE messages (first 12): ' + JSON.stringify(printed.slice(0,12)));
console.log('SAMPLE totals: ' + JSON.stringify(printed.reduce((a,x)=>(a[x[0]]=(a[x[0]]||0)+1,a),{})));
