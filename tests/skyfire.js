/* r99: pure rules, then the actual firmware prelude draw path. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {runApp}=require('./lib/prelude_runner');
const app=fs.readFileSync('examples/skyfire/app.js','utf8');
const logic=vm.createContext({});vm.runInContext(app.split('/* GAME UI */')[0],logic);
assert.equal(logic.SF_DT,33);
assert.equal(logic.sfNear({x:0,y:0},{x:3,y:4},5),true);
assert.equal(logic.sfNear({x:0,y:0},{x:3,y:4},4.9),false);
let s=logic.sfState();assert.equal(logic.sfWaveReady(s),true);logic.sfBeginWave(s);assert.equal(s.wave,1);assert.equal(logic.sfWaveReady(s),false);
s.spawnLeft=0;s.waveClock=0;assert.equal(logic.sfWaveReady(s),true);
assert.ok(logic.sfWaveGap(12)<logic.sfWaveGap(1));assert.ok(logic.sfSpeed(12)>logic.sfSpeed(1));
for(const [x,y,ex,ey] of [[-9,0,18,165],[999,999,462,455],[240,300,240,300]]){logic.sfMovePlayer(s,x,y);assert.equal(s.player.x,ex);assert.equal(s.player.y,ey);}
assert.equal(s.weapon,1);logic.sfUpgrade(s);assert.equal(s.weapon,2);logic.sfUpgrade(s);assert.equal(s.weapon,3);logic.sfUpgrade(s);assert.equal(s.shield,true);assert.equal(s.upgrade,0);logic.sfUpgrade(s);assert.equal(s.weapon,2);
s=logic.sfState();assert.equal(logic.sfDamage(s),true);assert.equal(s.lives,2);assert.equal(logic.sfDamage(s),false);assert.equal(s.lives,2);s.invuln=0;s.shield=true;logic.sfDamage(s);assert.equal(s.lives,2);assert.equal(s.shield,false);
s=logic.sfState();s.wave=1;s.waveClock=100;s.spawnLeft=0;let e=logic.sfTake(s.enemies);Object.assign(e,{type:0,hp:1,x:240,y:250,vy:0,age:0,fire:999,base:240});logic.sfBullet(s.friendly,240,259,0,-9);logic.sfStep(s,()=>0.5);assert.equal(e.active,false);assert.equal(s.score,50);
s=logic.sfState();s.wave=1;s.waveClock=100;s.spawnLeft=0;logic.sfBullet(s.hostile,240,396,0,4);logic.sfStep(s,()=>0.5);assert.equal(s.lives,2);logic.sfBullet(s.hostile,240,396,0,4);logic.sfStep(s,()=>0.5);assert.equal(s.lives,2);
console.log('PASS collision, waves, upgrade cycle, invulnerability, player limits');
function draws(ms){return ms.reduce((n,m)=>n+(m[0]==='draw'?1:m[0]==='batch'?m[2].length/6:0),0);}
const ui=runApp(app);assert.ok(draws(ui.messages)>0);let max=draws(ui.messages);assert.ok(max<=240);
assert.equal(ui.ctx.sfTimerDt,33,'combat timer stays at 33 ms');
ui.ctx.sf.drag=true;const pools=[ui.ctx.sf.enemies,ui.ctx.sf.friendly,ui.ctx.sf.hostile,ui.ctx.sf.particles];
for(let tick=0;tick<1820;tick++){const st=ui.messages.length;ui.ctx.sfStep(ui.ctx.sf,()=>0.37);ui.ctx.sf.events.length=0;ui.ctx.sfFrame.set(ui.ctx.sfFrame()+1);const d=draws(ui.messages.slice(st));max=Math.max(max,d);assert.ok(d<=240,`draw budget tick ${tick}: ${d}`);for(const pool of pools){assert.ok(ui.ctx.sfActive(pool)<=pool.length);for(const o of pool)if(o.active){assert.ok(Number.isFinite(o.x)&&Number.isFinite(o.y));assert.ok(o.x>=-50&&o.x<=530&&o.y>=-50&&o.y<=530);}}for(const enemy of ui.ctx.sf.enemies)if(enemy.active)assert.ok(enemy.x>=22&&enemy.x<=458);if(ui.ctx.sf.over)ui.ctx.sf=ui.ctx.sfState();}
assert.equal(ui.ctx.sf.enemies.length,8);assert.equal(ui.ctx.sf.friendly.length,32);assert.equal(ui.ctx.sf.hostile.length,32);assert.equal(ui.ctx.sf.particles.length,40);
ui.ctx.sf.over=true;ui.ctx.sfTick();
assert.equal(ui.ctx.sfTimerDt,100,'game-over timer drops to 100 ms');
let from=ui.messages.length;for(let i=0;i<10;i++)ui.ctx.sfTick();
assert.equal(draws(ui.messages.slice(from)),0,'game-over ticks emit 0 canvas draws');
ui.ctx.sfRestart();assert.equal(ui.ctx.sfTimerDt,33,'restart restores 33 ms cadence');
console.log(`EVIDENCE skyfire active max ${max}/240, over 0 draws in 10 ticks, dt 33->100->33`);
console.log(`PASS real prelude, 60s smoke, draw max ${max}/240, fixed pools, idle 0-draw`);
console.log('ALL SKYFIRE HARNESS CASES PASSED');
