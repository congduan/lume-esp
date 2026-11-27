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
    canvasSpriteDefine: (id, sprite, w, h, px) => calls.push(['spriteDefine', id, sprite, w, h, [...px]]),
    canvasSpriteDraw: (id, sprite, dx, dy, flip) => calls.push(['spriteDraw', id, sprite, dx, dy, flip]),
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
pass('r48 native arc emits one LUME_DRAW_ARC (opcode 5) with normalised args', () => {
  const h = harness(`Canvas({width:100,height:100,onDraw:function(c){c.arc(50,50,20,135,405,5,'#53E1C4');}})`);
  const draws = h.calls.filter(x => x[0] === 'draw');
  assert.strictEqual(draws.length, 1);
  /* [draw, id, op=5, cx, cy, r, b=0, color, width, from, to] */
  assert.deepStrictEqual(draws[0], ['draw', 1, 5, 50, 50, 20, 0, 0x53e1c4, 5, 135, 405]);
});
pass('r48 native arc rounds fractional degrees and rejects bad angles', () => {
  const h = harness(`Canvas({width:100,height:100,onDraw:function(c){c.arc(50,50,20,259.6,405.4,5,0xffffff);}})`);
  assert.deepStrictEqual(h.calls.filter(x => x[0] === 'draw')[0].slice(-2), [260, 405]);
  for (const expr of [
    `Canvas({width:100,height:100,onDraw:function(c){c.arc(0,0,10,'x',90,1,'#ffffff');}})`,
    `Canvas({width:100,height:100,onDraw:function(c){c.arc(0,0,10,NaN,90,1,'#ffffff');}})`,
    `Canvas({width:100,height:100,onDraw:function(c){c.arc(0,0,10,0,9000,1,'#ffffff');}})`
  ]) assert.throws(() => harness(expr), expr);
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

/* r81: retained sprites — RGB565 bitmap uploaded once via retainImage(),
 * replayed from C via drawImage() with colour-key transparency and flip. */
pass('retained sprite uploads pixels once and replays from C', () => {
  const h = harness(`var px = new Uint16Array([0x0000,0x1234,0x5678,0x0000,
    0x1234,0x0000,0x0000,0x1234,0x5678,0x0000,0x0000,0x1234,0x0000,0x1234,0x5678,0x0000]);
    var uploaded = false;
    Canvas({width:40,height:40,onDraw:function(c){
      if (!uploaded) { c.retainImage(1, 4, 4, px); uploaded = true; }
      c.drawImage(1, 2, 3);
      c.drawImage(1, 8, 3, true);
    }});`);
  const defs = h.calls.filter(x => x[0] === 'spriteDefine');
  const draws = h.calls.filter(x => x[0] === 'spriteDraw');
  assert.strictEqual(defs.length, 1, 'pixels uploaded exactly once');
  assert.strictEqual(defs[0][1], 1, 'canvas node id');
  assert.strictEqual(defs[0][2], 1, 'sprite slot id');
  assert.strictEqual(defs[0][3], 4, 'sprite width');
  assert.strictEqual(defs[0][4], 4, 'sprite height');
  assert.strictEqual(defs[0][5].length, 16, 'w*h pixels');
  assert.deepStrictEqual(draws.map(d => [d[2], d[3], d[4], d[5]]), [[1,2,3,0],[1,8,3,1]], 'replays with offset and flip');
});

pass('sprite argument validation matches the native contract', () => {
  const cases = [
    ['c.retainImage(0, 4, 4, new Uint16Array(16));', /sprite id must be 1\.\.8/],
    ['c.retainImage(9, 4, 4, new Uint16Array(16));', /sprite id must be 1\.\.8/],
    ['c.retainImage(1, 0, 4, new Uint16Array(16));', /size out of range/],
    ['c.retainImage(1, 4, 4, new Uint16Array(15));', /length w\*h/],
    ['c.retainImage(1, 4, 4, new Uint8Array(16));', /Uint16Array/],
    ['c.drawImage(0);', /sprite id must be 1\.\.8/],
  ];
  for (const [expr, pattern] of cases)
    assert.throws(() => harness(`Canvas({width:8,height:8,onDraw:function(c){${expr}}})`), pattern, expr);
});

pass('sprite slot redefinition re-uploads (animation frame swap)', () => {
  const h = harness(`var px = new Uint16Array(16);
    Canvas({width:40,height:40,onDraw:function(c){
      c.retainImage(2, 4, 4, px);
      c.retainImage(2, 4, 4, px);
      c.drawImage(2);
    }});`);
  const defs = h.calls.filter(x => x[0] === 'spriteDefine');
  assert.strictEqual(defs.length, 2, 're-define re-uploads into the same slot');
  assert.strictEqual(h.calls.filter(x => x[0] === 'spriteDraw').length, 1);
});

/* r221: per-canvas singleBuffer opt-in (roadmap rendering-backlog #7).
 * Host layer tests the exact embedded prelude (validation, createNode flags,
 * 1x vs 2x PSRAM pool accounting, dispose refund) plus C bridge/engine wiring
 * invariants; actual PSRAM/LVGL work==front runtime execution is verified via
 * firmware build and deferred to board bring-up. */
pass('r221 singleBuffer: false/omitted preserves exact 4-arg create and 2x budget', () => {
  const hDef = harness('Canvas({width:120,height:80,onDraw:function(c){c.clear();}})');
  const hFalse = harness('Canvas({width:120,height:80,singleBuffer:false,onDraw:function(c){c.clear();}})');
  assert.deepStrictEqual(hDef.calls[0], ['create', 3, 0, 120, 80]);
  assert.deepStrictEqual(hFalse.calls[0], ['create', 3, 0, 120, 80]);
  assert.throws(() => harness('Canvas({width:480,height:480,singleBuffer:false,onDraw:function(){}});Canvas({width:1,height:1,singleBuffer:true,onDraw:function(){}})'),
                /budget exceeded/);
});

pass('r221 singleBuffer: true emits create flag 1 and halves PSRAM pool cost (1x)', () => {
  const h = harness('Canvas({width:480,height:480,singleBuffer:true,onDraw:function(c){c.clear();}});Canvas({width:480,height:480,singleBuffer:true,onDraw:function(c){c.clear();}})');
  const creates = h.calls.filter(x => x[0] === 'create');
  assert.deepStrictEqual(creates, [
    ['create', 3, 0, 480, 480, 1],
    ['create', 3, 0, 480, 480, 1],
  ]);
  /* Two 480x480 singleBuffer canvases fill the 921,600 B pool; a 3rd 1x1 rejects. */
  assert.throws(() => harness('Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}});Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}});Canvas({width:1,height:1,singleBuffer:true,onDraw:function(){}})'),
                /budget exceeded/);
  /* Mixed pool: one 480x240 double-buffered (460,800 B) + one 480x480 singleBuffer (460,800 B) fits. */
  const mix = harness('Canvas({width:480,height:240,onDraw:function(){}});Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}})');
  assert.deepStrictEqual(mix.calls.filter(x => x[0] === 'create'), [
    ['create', 3, 0, 480, 240],
    ['create', 3, 0, 480, 480, 1],
  ]);
  assert.throws(() => harness('Canvas({width:480,height:240,onDraw:function(){}});Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}});Canvas({width:1,height:1,singleBuffer:true,onDraw:function(){}})'),
                /budget exceeded/);
});

pass('r221 singleBuffer: runApp stream, injected screen, validation and dispose refund', () => {
  const r = runApp('var a=Canvas({width:390,height:390,singleBuffer:true,onDraw:function(c){c.clear();return {x:0,y:0,w:10,h:10};}});var b=Canvas({width:390,height:390,singleBuffer:true,onDraw:function(c){c.clear();}});', {screen: {w: 390, h: 390}});
  const creates = r.messages.filter(x => x[0] === 'create');
  assert.deepStrictEqual(creates, [
    ['create', 1, 3, 0, 390, 390, 1],
    ['create', 2, 3, 0, 390, 390, 1],
  ]);
  assert.deepStrictEqual(r.messages.filter(x => x[0] === 'invalidate'), [
    ['invalidate', 1, 0, 0, 10, 10],
    ['invalidate', 2],
  ]);
  /* Disposing one 390x390 single-buffer canvas frees 1x (304,200 B): enough for
   * another 390x390 singleBuffer, NOT enough for a 390x390 double-buffered one. */
  r.removed(1);
  assert.throws(() => vm.runInContext('Canvas({width:390,height:390,onDraw:function(){}})', r.ctx), /budget exceeded/);
  vm.runInContext('Canvas({width:390,height:390,singleBuffer:true,onDraw:function(){}})', r.ctx);
  /* Non-boolean singleBuffer rejects cleanly. */
  for (const bad of ['1', "'true'", 'null', '{}']) {
    assert.throws(() => harness(`Canvas({width:16,height:16,singleBuffer:${bad},onDraw:function(){}})`),
                  /singleBuffer must be a boolean/, bad);
  }
});

/* r221 review fix: Codex P-with-fixes — the refund test above only exercised a
 * single-buffer-only pool. Pin mixed 1x/2x accounting on the executable host
 * side: exact refund for each buffer grade and repeat-removal idempotency.
 * (work == front allocation/publish/release execution is C-bridge runtime and
 * stays deferred to board bring-up; the C wiring anchors stay asserted above.) */
pass('r221 singleBuffer: mixed-pool refund is exact and repeat removal is a no-op', () => {
  const app = 'var a=Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}});'
            + 'var b=Canvas({width:480,height:240,onDraw:function(){}});';
  const r = runApp(app, {screen: {w: 480, h: 480}});
  /* Pool 480*480*4 = 921,600 B: a=460,800 (1x) + b=460,800 (2x) → pool exactly
   * full. Removing b refunds exactly 460,800, so a full-size 1x canvas (460,800)
   * then fits and fills the pool again — a 2x-grade (over-)refund would too, so
   * the next step pins the exactness: with the pool exactly full, even a 1x1
   * canvas must throw. */
  r.removed(2);
  vm.runInContext('Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}})', r.ctx);
  /* Repeating removal of the same id must not refund again: any further canvas
   * must still throw on the exactly-full pool. */
  r.removed(2);
  assert.throws(() => vm.runInContext('Canvas({width:1,height:1,onDraw:function(){}})', r.ctx),
                /budget exceeded/);
});

pass('r221 singleBuffer: removing the 1x member of a mixed pool frees exactly 1x', () => {
  const app = 'var a=Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}});'
            + 'var b=Canvas({width:480,height:240,onDraw:function(){}});';
  const r = runApp(app, {screen: {w: 480, h: 480}});
  r.removed(1);
  /* Exactly 460,800 (b 2x) stays held → 460,800 free: a full 2x canvas (921,600)
   * does NOT fit — a 2x-grade refund (921,600 free) would let it through —
   * while a full 1x canvas fits exactly. */
  assert.throws(() => vm.runInContext('Canvas({width:480,height:480,onDraw:function(){}})', r.ctx),
                /budget exceeded/);
  vm.runInContext('Canvas({width:480,height:480,singleBuffer:true,onDraw:function(){}})', r.ctx);
  assert.throws(() => vm.runInContext('Canvas({width:1,height:1,onDraw:function(){}})', r.ctx),
                /budget exceeded/);
});

pass('r221 singleBuffer: C engine and bridge wire work==front and 1x budget', () => {
  const eng = fs.readFileSync('firmware/components/lume-engine/lume_engine.c', 'utf8');
  const br = fs.readFileSync('firmware/components/lume-ui-bridge/lume_ui_bridge.c', 'utf8');
  assert.ok(eng.includes('if (argc >= 5 && !JS_IsUndefined(argv[4]))') &&
            eng.includes('m.value = canvas_flags;'),
            'lume_engine.c forwards optional 5th createNode arg to LUME_OP_CREATE m.value');
  assert.ok(br.includes('bool single_buf = (m->value & 1) != 0;') &&
            br.includes('size_t copies = single_buf ? 1u : 2u;') &&
            br.includes('bytes > (CANVAS_BUDGET - s_canvas_bytes) / copies') &&
            br.includes('if (!single_buf)') &&
            br.includes('s_canvas_work[m->node_id] = work ? work : pixels;') &&
            br.includes('s_canvas_bytes += bytes * (work ? 2u : 1u);'),
            'lume_ui_bridge.c skips work alloc (work==front) and accounts 1x bytes when single_buf');
  assert.ok(br.includes('if (work != front)') &&
            br.includes('bool split = s_canvas_work[id] != NULL && s_canvas_work[id] != s_canvas_pixels[id];'),
            'canvas_publish and release_dead_canvases guard swap/copy/free on work != front');
});
