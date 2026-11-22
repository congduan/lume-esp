const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {runApp} = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
function make(source = shell, initial = '#FF0000') {
  return runApp('globalThis.warnings=[];globalThis.console={warn:s=>warnings.push(s)};\n' + source +
    '\nglobalThis.changes=[];globalThis.confirmed=[];globalThis.p=lume.ui.shell.ColorPicker({x:90,y:25,initialHex:' + JSON.stringify(initial) +
    ',onChange:h=>changes.push(h),onConfirm:h=>confirmed.push(h)});');
}
function tap(s,x,y,t=0) { s.gesture(s.ctx.p,0,x,y,t); s.gesture(s.ctx.p,2,x,y,t+20); }
function drag(s,pts) { pts.forEach(([x,y],i)=>s.gesture(s.ctx.p,i?1:0,x,y,i*5)); const q=pts.at(-1); s.gesture(s.ctx.p,2,q[0],q[1],pts.length*5); }
function check(name, source, fn, mutation) {
  fn(source);
  if (mutation) {
    const bad = mutation(source);
    assert.notEqual(bad, source, 'mutation unchanged: '+name);
    assert.throws(()=>fn(bad), undefined, 'mutation survived: '+name);
  }
  console.log('PASS colorpicker '+name+'; mutation FAIL as expected');
}
check('12 RGB round trips', shell, src=>{
  const s=make(src);
  for (const hex of ['#FF0000','#FF8000','#FFFF00','#80FF00','#00FF00','#00FF80',
    '#00FFFF','#0080FF','#0000FF','#8000FF','#FF00FF','#000000','#FFFFFF','#808080']) {
    const hsv=vm.runInContext('lume.ui.shell.hexToHsv('+JSON.stringify(hex)+')',s.ctx);
    const got=vm.runInContext(`lume.ui.shell.hsvToHex(${hsv.h},${hsv.s},${hsv.v})`,s.ctx);
    for(let i=1;i<7;i+=2) assert.ok(Math.abs(parseInt(hex.slice(i,i+2),16)-parseInt(got.slice(i,i+2),16))<=1, hex+' -> '+got);
  }
}, src=>src.replace('return Math.max(0, Math.min(1, v));','return 0;').replace('v = Math.max(0, Math.min(1, v));','v = 0;'));
check('ring angles and strips',shell,src=>{
  let s=make(src,'#00FF00'); tap(s,330,135); assert.equal(s.ctx.changes.at(-1),'#FF0000');
  s=make(src,'#FF0000'); tap(s,240,225); assert.equal(s.ctx.changes.at(-1),'#80FF00');
  s=make(src); tap(s,120,256); assert.equal(s.ctx.changes.at(-1),'#FFFFFF');
  s=make(src); tap(s,120,306); assert.equal(s.ctx.changes.at(-1),'#000000');
},src=>src.replace('Math.atan2(dy,dx)','Math.atan2(dx,dy)'));
check('outside areas ignored',shell,src=>{
  const s=make(src,'#00FF00'); for(const [x,y] of [[240,135],[350,135],[110,256],[370,306],[240,235]]) tap(s,x,y);
  assert.equal(s.ctx.changes.length,0);
},src=>src.replace('radius >= 82 && radius <= 98','radius >= 0 && radius <= 98'));
check('pan throttle and final flush',shell,src=>{
  const s=make(src); const pts=[]; for(let i=0;i<11;i++) { const a=i*5*Math.PI/180; pts.push([Math.round(240+90*Math.cos(a)),Math.round(135+90*Math.sin(a))]); }
  drag(s,pts); assert.ok(s.ctx.changes.length>=1 && s.ctx.changes.length<=2, s.ctx.changes.length);
  assert.equal(s.ctx.changes.at(-1),vm.runInContext('lume.ui.shell.hsvToHex('+((Math.atan2(pts.at(-1)[1]-135, pts.at(-1)[0]-240)*180/Math.PI+360)%360)+',1,1)',s.ctx));
},src=>src.replace('now-lastEmit >= 100','now-lastEmit >= 0'));
check('invalid initialHex warns and defaults',shell,src=>{
  const s=make(src,'nope'); assert.equal(s.ctx.warnings.length,1);
  const draws=s.messages.filter(m=>m[0]==='draw'&&m[2]===6&&m[3]===150&&m[4]===110);
  assert.ok(draws.length>0);
  assert.equal(draws.at(-1)[7],0x40D8B0);
  const expected=vm.runInContext("lume.ui.shell.hexToHsv('#40D8B0')",s.ctx);
  assert.equal(vm.runInContext(`lume.ui.shell.hsvToHex(${expected.h},${expected.s},${expected.v})`,s.ctx),'#40D8B0');
},src=>src.replace("console.warn('lume: ColorPicker invalid initialHex; using #40D8B0');",''));
check('one canvas, 24 arc segments, dispose',shell,src=>{
  const s=make(src); assert.equal(s.messages.filter(m=>m[0]==='create'&&m[2]===3).length,1);
  assert.equal(s.messages.filter(m=>m[0]==='draw'&&m[2]===5).length,24);
  vm.runInContext('lume.ui.shell.dispose(p)',s.ctx);
  assert.equal(s.messages.filter(m=>m[0]==='remove'&&m[1]===s.ctx.p).length,1);
  assert.equal(vm.runInContext('__lifecycle.pause.length',s.ctx),1); // Dialog's global hook only
  tap(s,330,135); assert.equal(s.ctx.changes.length,0);
  vm.runInContext('lume.ui.shell.dispose(p)',s.ctx);
  assert.equal(s.messages.filter(m=>m[0]==='remove'&&m[1]===s.ctx.p).length,1);
},src=>src.replace('offs.forEach(function (off) { off(); }); lume.removeChild(canvas);','offs.forEach(function (off) { off(); });'));
check('confirm, dismiss, and pause cleanup',shell,src=>{
  const s=runApp(src+'\nglobalThis.confirmed=[];globalThis.dismissed=0;globalThis.p=lume.ui.shell.ColorPicker({x:90,y:25,onConfirm:h=>confirmed.push(h),onDismiss:()=>dismissed++});');
  tap(s,335,359); assert.equal(s.ctx.confirmed.length,1);
  tap(s,130,359); assert.equal(s.ctx.dismissed,1);
  assert.equal(s.messages.filter(m=>m[0]==='remove'&&m[1]===s.ctx.p).length,1);
  const t=make(src); vm.runInContext('__lume_pause()',t.ctx);
  assert.equal(t.messages.filter(m=>m[0]==='remove'&&m[1]===t.ctx.p).length,1);
},src=>src.replace("if (p.onDismiss) p.onDismiss();",''));
check('callbacks validated before mounting',shell,src=>{
  for(const name of ['onChange','onConfirm','onDismiss']) {
    assert.throws(()=>runApp(src+';lume.ui.shell.ColorPicker({'+name+':1})'),new RegExp(name));
  }
},src=>src.replace("callback('ColorPicker onDismiss', p.onDismiss);",''));
console.log('ALL COLORPICKER CASES PASSED');
