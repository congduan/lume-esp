const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {runApp} = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js','utf8');
function make(){return runApp(shell+'\nglobalThis.hits=[];globalThis.w=lume.ui.shell.ClickWheel({cx:240,cy:240,outerR:100,innerR:35,onRotate:n=>hits.push(n),onCenterTap:()=>hits.push("center"),onOuterTap:q=>hits.push(q)});');}
function point(deg,r=80){const a=deg*Math.PI/180;return [Math.round(240+Math.sin(a)*r),Math.round(240-Math.cos(a)*r)];}
function drag(s,id,angles){angles.forEach((a,i)=>{const [x,y]=point(a);s.gesture(id,i?1:0,x,y,i*80);});const [x,y]=point(angles.at(-1));s.gesture(id,2,x,y,angles.length*80);}
function tap(s,id,x,y){s.gesture(id,0,x,y,0);s.gesture(id,2,x,y,40);}
let s=make();drag(s,s.ctx.w,[0,10,20,30,40,50,60]);assert.deepEqual([...s.ctx.hits],[1,1]);
s=make();drag(s,s.ctx.w,[60,50,40,30,20,10,0]);assert.deepEqual([...s.ctx.hits],[-1,-1]);
s=make();drag(s,s.ctx.w,[340,350,0,10,20,30,40]);assert.deepEqual([...s.ctx.hits],[1,1]);
s=make();drag(s,s.ctx.w,[0,80]);assert.deepEqual([...s.ctx.hits],[1,1,1]);
s=make();tap(s,s.ctx.w,240,240);for(let q=0;q<4;q++){const [x,y]=point(q*90);tap(s,s.ctx.w,x,y);}
assert.deepEqual([...s.ctx.hits],['center',0,1,2,3]);
for(const d of [22,22.5,23,67,67.5,68]){const [x,y]=point(d);tap(s,s.ctx.w,x,y);}
assert.deepEqual([...s.ctx.hits].slice(5),[0,1]);
s=make();s.gesture(s.ctx.w,1,240,160,0);s.gesture(s.ctx.w,2,240,160,20);assert.deepEqual([...s.ctx.hits],[]);
vm.runInContext('globalThis.a=[];globalThis.b=[];globalThis.wa=lume.ui.shell.ClickWheel({cx:120,cy:120,outerR:80,innerR:30,onRotate:n=>a.push(n)});globalThis.wb=lume.ui.shell.ClickWheel({cx:350,cy:350,outerR:80,innerR:30,onRotate:n=>b.push(n)});',s.ctx);
function two(id,cx,cy){function p(d){const a=d*Math.PI/180;return [Math.round(cx+65*Math.sin(a)),Math.round(cy-65*Math.cos(a))];}for(let i=0;i<4;i++){const [x,y]=p(i*15);s.gesture(id,i?1:0,x,y,i*80);}const [x,y]=p(45);s.gesture(id,2,x,y,320);}
two(s.ctx.wa,120,120);assert.deepEqual([...s.ctx.a],[1,1]);assert.deepEqual([...s.ctx.b],[]);
two(s.ctx.wb,350,350);assert.deepEqual([...s.ctx.a],[1,1]);assert.deepEqual([...s.ctx.b],[1,1]);
vm.runInContext('lume.ui.shell.dispose(wa)',s.ctx);two(s.ctx.wa,120,120);assert.deepEqual([...s.ctx.a],[1,1]);
console.log('PASS clickwheel angle, taps, sparse trajectory, independent mounts and dispose');
