'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {runApp}=require('./lib/prelude_runner');
const src=fs.readFileSync('examples/skycombat/app.js','utf8');
const g=vm.createContext({});vm.runInContext(src.split('/* GAME UI */')[0],g);
function near(a,b,t=1e-6){assert.ok(Math.abs(a-b)<t,`${a} ~= ${b}`);}
let p=g.scProject(40,-20,400,0,0,0);near(p.x,280);near(p.y,220);
p=g.scProject(40,-20,800,0,0,0);near(p.x,260);near(p.y,230);
near(g.scIntegrate(0,30,0,1000),30);let r=0;for(let i=0;i<100;i++)r=g.scIntegrate(r,30,0,10);assert.ok(Math.abs(r-30)<1);
const c=g.scCal();const quiet={ax:0,ay:0,az:9.81,gx:0,gy:0,gz:0.8};for(let i=0;i<310;i++)g.scMotion(c,quiet,33);assert.ok(Math.abs(c.roll)<5,'bias re-zero drift under five degrees');
let e={active:true,type:0,z:601};assert.equal(g.scHit(e,{x:240,y:240}),false);e.z=500;assert.equal(g.scHit(e,{x:240,y:240}),true);
for(let n=1;n<9;n++){let s=g.scState();s.wave=n-1;g.scBegin(s);assert.equal(s.left,4+n);}
console.log('PASS projection, integration, drift re-zero, hit range, wave count');
assert.equal(g.scLerpColor('#FF0000','#0000FF',0),'#FF0000');
assert.equal(g.scLerpColor('#FF0000','#0000FF',1),'#0000FF');
assert.equal(g.scDepthColor('#FF0000',100),'#FF0000');
assert.equal(g.scDepthColor('#FF0000',2000),'#521327');
console.log('PASS lerpColor and 70% sky blend at z=2000');
const ui=runApp(src);function draws(ms){return ms.reduce((n,m)=>n+(m[0]==='draw'?1:m[0]==='batch'?m[2].length/6:0),0);}
let max=0;for(let i=0;i<250;i++){let from=ui.messages.length;ui.ctx.scTick();let d=draws(ui.messages.slice(from));max=Math.max(max,d);assert.ok(d<=240,`draw calls ${d}`);}
assert.equal(ui.ctx.sc.sim,true);
let from=ui.messages.length;ui.ctx.scFrame.set(ui.ctx.scFrame()+1);const ordinary=draws(ui.messages.slice(from));for(let i=0;i<8;i++)ui.ctx.scStep(ui.ctx.sc);from=ui.messages.length;ui.ctx.scFrame.set(ui.ctx.scFrame()+1);const resumed=draws(ui.messages.slice(from));assert.ok(resumed<=240);assert.ok(Math.abs(resumed-ordinary)<15,`full redraw after skipped ticks ${ordinary}/${resumed}`);
assert.ok(src.includes('c.clear()')&&src.includes('c.fillRect(0,0,480,480)'));
assert.equal(ui.ctx.scTimerDt,33,'combat timer stays at 33 ms');
ui.ctx.sc.over=true;from=ui.messages.length;ui.ctx.scTick();
assert.equal(ui.ctx.scTimerDt,100,'game-over timer drops to 100 ms');
assert.equal(draws(ui.messages.slice(from)),0,'static game-over frame is not repainted');
from=ui.messages.length;for(let i=0;i<10;i++)ui.ctx.scTick();
assert.equal(draws(ui.messages.slice(from)),0,'one second of game-over ticks emits no canvas calls');
ui.ctx.sc=ui.ctx.scFire(ui.ctx.sc);
ui.ctx.scSchedule();assert.equal(ui.ctx.scTimerDt,33,'restart restores combat cadence');
console.log('EVIDENCE skycombat combat <=31 scheduled frames/s, over 0 draws in 10 polls, <=240 calls/paint');
console.log(`PASS real prelude SIM, full redraw after 8 skipped ticks, max ${max}/240`);
