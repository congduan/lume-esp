// Host harness for the exact embedded prelude and demo message sequence.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const { prelude, demo, runApp } = require('./lib/prelude_runner');
function harness(script) {
  const calls = [], handlers = new Map(); let next = 0;
  const lume = {
    createNode: (...a) => { calls.push(['create', ...a]); return ++next; },
    setAttr: (...a) => calls.push(['attr', ...a]),
    canvasDraw: (...a) => calls.push(['draw', ...a]),
    canvasBatch: (id, lines) => calls.push(['batch', id, [...lines]]),
    canvasPathDefine: (id, path, lines) => calls.push(['pathDefine', id, path, [...lines]]),
    canvasPathDraw: (id, path, dx, dy) => calls.push(['pathDraw', id, path, dx, dy]),
    canvasInvalidate: (...args) => calls.push(['invalidate', ...args]),
    setPressEvent: id => calls.push(['press', id]),
    log: () => {}, _nowMs: () => 0, imu: {read: () => null}
  };
  const ctx = vm.createContext({lume, __lumeScreen: {w: 480, h: 480}});
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
  assert.deepStrictEqual(h.calls.filter(x => x[0] === 'draw').map(x => x[2]), [0,1,3,4]);
  assert.strictEqual(h.calls.filter(x => x[0] === 'batch').length, 1);
  assert.strictEqual(h.calls.find(x => x[0] === 'batch')[2].length, 18);
  assert.strictEqual(h.calls.at(-1)[0], 'invalidate');
});
pass('optional dirty rectangles preserve local coordinates', () => {
  const h = harness('Canvas({width:40,height:40,onDraw:function(c){return [{x:1,y:2,w:3,h:4},{x:10,y:11,w:2,h:2}];}})');
  assert.deepStrictEqual(h.calls.filter(x=>x[0]==='invalidate'), [['invalidate',1,1,2,3,4],['invalidate',1,10,11,2,2]]);
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
pass('injected 390x390 screen governs canvas size, budget and draw bounds', () => {
  const screen = {w: 390, h: 390};
  const app = 'Canvas({width:390,height:390,onDraw:function(c){c.fillRect(-390,-390,390,390);c.line(390,390,0,0,"#ffffff");c.circle(0,0,390,"#ffffff");c.text(390,390,"ok","#ffffff");}})';
  const result = runApp(app, {screen});
  /* The prelude registers one global swipe-up gesture on node 0 before any
   * app code runs; skip that registration message. */
  const msgs = result.messages.filter(x => !(x[0] === 'gesture' && x[1] === 0));
  assert.deepStrictEqual(msgs[0], ['create', 1, 3, 0, 390, 390]);
  assert.strictEqual(result.messages.filter(x => x[0] === 'draw').length, 3);
  assert.strictEqual(result.messages.filter(x => x[0] === 'batch').length, 1);
  for (const expr of [
    'Canvas({width:391,height:1,onDraw:function(){}})',
    'Canvas({width:1,height:391,onDraw:function(){}})',
    'Canvas({width:390,height:390,onDraw:function(){}});Canvas({width:1,height:1,onDraw:function(){}})',
    'Canvas({width:1,height:1,onDraw:function(c){c.fillRect(391,0,1,1);}})',
    'Canvas({width:1,height:1,onDraw:function(c){c.line(0,-391,0,0,"#ffffff");}})',
    'Canvas({width:1,height:1,onDraw:function(c){c.circle(0,0,391,"#ffffff");}})',
    'Canvas({width:1,height:1,onDraw:function(c){c.text(0,391,"x","#ffffff");}})',
  ]) assert.throws(() => runApp(expr, {screen}), expr);
});
pass('counter example retains count and theme behavior', () => {
  const file = fs.readFileSync('examples/counter/app.js','utf8');
  const h = harness(file);
  assert.strictEqual(vm.runInContext('count()',h.ctx),0);
  vm.runInContext('count.set(count()+1);lume.theme.set(lightTheme)',h.ctx);
  assert.strictEqual(vm.runInContext('count()',h.ctx),1);
  assert.strictEqual(vm.runInContext('lume.theme.get().colors.bg',h.ctx),'#EAF2F7');
  assert(h.calls.some(x=>x[0]==='press'));
});
const printed = harness(demo).calls;
console.log('SAMPLE messages (first 12): ' + JSON.stringify(printed.slice(0,12)));
console.log('SAMPLE totals: ' + JSON.stringify(printed.reduce((a,x)=>(a[x[0]]=(a[x[0]]||0)+1,a),{})));

pass('33 contiguous lines split at 32', () => {
  const h = harness('Canvas({width:40,height:40,onDraw:function(c){for(var i=0;i<33;i++)c.line(i,0,i,1,"#ffffff");}})');
  assert.deepStrictEqual(h.calls.filter(x=>x[0]==='batch').map(x=>x[2].length/6),[32,1]);
});

pass('240-point polyline uses eight batches', () => {
  const h = harness('var p=[];for(var i=0;i<240;i++)p.push([i,0]);Canvas({width:240,height:1,onDraw:function(c){c.polyline(p,"#ffffff");}})');
  assert.deepStrictEqual(h.calls.filter(x=>x[0]==='batch').map(x=>x[2].length/6),[32,32,32,32,32,32,32,15]);
  console.log('CANVAS 240 points: old=239 messages / 27724 queue bytes; new=8 messages / 928 queue bytes + 3824 payload bytes');
});

pass('retained path uploads geometry once and replays from C', () => {
  const h = harness(`var cid = Canvas({width:40,height:40,onDraw:function(c){
    c.p = c.p || c.retainPath([[0,0],[10,0],[10,10]],'#ff0000',3);
    c.drawPath(c.p);
    c.drawPath(c.p, 2, 3);
  }});`);
  const defs = h.calls.filter(x => x[0] === 'pathDefine');
  const draws = h.calls.filter(x => x[0] === 'pathDraw');
  assert.strictEqual(defs.length, 1, 'geometry uploaded exactly once');
  assert.strictEqual(defs[0][1], 1, 'canvas node id');
  assert.strictEqual(defs[0][2], 1, 'first path id');
  assert.deepStrictEqual(defs[0][3], [0,0,10,0,0xff0000,3, 10,0,10,10,0xff0000,3], 'flat segments');
  assert.deepStrictEqual(draws.map(d => [d[2], d[3], d[4]]), [[1,0,0],[1,2,3]], 'replays with offsets');
  console.log(`CANVAS retained path: 2 segments uploaded once, ${draws.length} draws / ${defs.length} upload`);
  for (const [expr, pattern] of [
    ['Canvas({width:8,height:8,onDraw:function(c){c.drawPath(9);}})', /path id/],
    ['Canvas({width:8,height:8,onDraw:function(c){c.retainPath([[0,0]],"#ffffff");}})', /path needs/],
    ['Canvas({width:8,height:8,onDraw:function(c){c.retainPath([[0,0],[1,"x"]],"#ffffff");}})', /coordinate/],
    ['Canvas({width:8,height:8,onDraw:function(c){for(var i=0;i<9;i++)c.retainPath([[0,0],[1,1]],"#ffffff");}})',
     /too many retained paths/],
  ]) assert.throws(() => harness(expr), pattern, expr);
});

pass('retainSegments uploads independent segments', () => {
  const h = harness(`Canvas({width:40,height:40,onDraw:function(c){
    c.s = c.s || c.retainSegments([[0,0,5,5],[10,10,20,10]],'#00ff00',2);
    c.drawPath(c.s, 1, 1);
  }});`);
  const def = h.calls.find(x => x[0] === 'pathDefine');
  assert.deepStrictEqual(def[3], [0,0,5,5,0x00ff00,2, 10,10,20,10,0x00ff00,2], 'independent segments');
  assert.deepStrictEqual(h.calls.filter(x => x[0] === 'pathDraw').map(x => [x[2], x[3], x[4]]), [[1,1,1]]);
  assert.throws(() => harness('Canvas({width:8,height:8,onDraw:function(c){c.retainSegments([[0,0,1]]);}})'),
                /segment must be \[x1,y1,x2,y2\]/);
  assert.throws(() => harness('Canvas({width:8,height:8,onDraw:function(c){c.retainSegments([]);}})'),
                /1\.\.240 segments/);
});
