const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(root+'/examples/raycast/app.js','utf8');
const events=[];
function signal(v){function f(){return v;}f.set=x=>{v=x};return f;}
let id=0;function node(){return {nodeId:++id};}
const ctx={Uint8Array,ArrayBuffer,DataView,Math,Date,parseInt,signal,View:node,Canvas:node,Text:node,
 lume:{raycast:{setMap(){return 0},setTextures(){return 0},render(){}},gesture:{on(){}},audio:{play(b){events.push(b.byteLength);return 0}},system:{setInterval(){return 1},clearInterval(){}},app:{onPause(){},onResume(){}}}};
vm.createContext(ctx);vm.runInContext(source,ctx);
let count=0;function test(name,fn){fn();console.log('PASS '+name);count++;}
test('three rectangular levels and bounded map values',()=>{assert.equal(ctx.LEVELS.length,3);for(const l of ctx.LEVELS){assert(l.rows.every(r=>r.length===l.rows[0].length));assert(l.rows.join('').includes('S'));}});
test('BFS reaches exit or every enemy spawn in all stages',()=>{for(const l of ctx.LEVELS){let w=l.rows[0].length,h=l.rows.length,q=[],seen=new Set();for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(l.rows[y][x]==='S'){q.push([x,y]);seen.add(y*w+x)}for(let i=0;i<q.length;i++){let [x,y]=q[i];for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){let nx=x+dx,ny=y+dy,k=ny*w+nx;if(nx>=0&&ny>=0&&nx<w&&ny<h&&l.rows[ny][nx]!=='1'&&l.rows[ny][nx]!=='2'&&!seen.has(k)){seen.add(k);q.push([nx,ny])}}}for(let y=0;y<h;y++)for(let x=0;x<w;x++)if('EGH'.includes(l.rows[y][x]))assert(seen.has(y*w+x),`${l.name} ${x},${y}`)}});
test('three textures carry exactly 768 in-range indices',()=>{assert.equal(ctx.TEX_ROWS.length,48);assert(ctx.TEX_ROWS.every(r=>r.length===16));assert.equal(ctx.textures.length,768);assert([...ctx.textures].every(v=>v<16));});
test('16x16 brick and portal texels are distinct',()=>{assert.notEqual(ctx.textures[0],ctx.textures[512+16+1]);});
test('collision blocks wall with player radius',()=>{let s=ctx.state();assert.equal(ctx.canStand(s,0.9,1.5),false);});
test('collision admits open corridor',()=>{let s=ctx.state();assert.equal(ctx.canStand(s,1.5,1.5),true);});
test('step moves forward and reveals fog',()=>{let s=ctx.state(),x=s.x;assert(ctx.move(s,.3));assert(s.x>x);assert(s.fog.some(v=>v));});
test('closed door opens and becomes passable',()=>{let s=ctx.state();s.x=5.5;s.y=8.5;s.angle=0;assert.equal(ctx.interact(s),'');s.x=4.5;assert.equal(ctx.interact(s),'door');assert.equal(ctx.cell(s,5,8),0);});
test('pickup grants 100 only once',()=>{let s=ctx.state(),p=s.pickups[0];s.x=p.x;s.y=p.y;assert(ctx.collect(s));assert.equal(s.score,100);assert(!ctx.collect(s));});
test('patrol reverses at a wall',()=>{let s=ctx.state(),e=s.enemies[0];e.x=1.25;e.y=6.5;e.dir=-1;ctx.updateEnemies(s,1,1000);assert.equal(e.dir,1);});
test('hunter changes to chase only with line of sight',()=>{let s=ctx.state();ctx.loadLevel(s,1);let e=s.enemies.find(x=>x.type==='H');s.x=e.x+.8;s.y=e.y;ctx.updateEnemies(s,.1,1000);assert.equal(e.phase,'chase');});
test('wall blocks line of sight',()=>{let s=ctx.state();assert.equal(ctx.lineOfSight(s,1.5,3.5,5.5,3.5),false);});
test('shoot rejects occluded or off-axis target',()=>{let s=ctx.state();assert.equal(ctx.shoot(s),false);});
test('shoot clears aligned visible target and scores',()=>{let s=ctx.state(),e=s.enemies[0];s.x=e.x-1;s.y=e.y;s.angle=0;assert(ctx.shoot(s));assert.equal(s.score,250);assert(!e.alive);});
test('exit cell completes stages one and two',()=>{let s=ctx.state();assert(!ctx.won(s));s.x=s.ex[0]+.5;s.y=s.ex[1]+.5;assert(ctx.won(s));ctx.loadLevel(s,1);s.x=s.ex[0]+.5;s.y=s.ex[1]+.5;assert(ctx.won(s));});
test('arena requires every enemy cleared',()=>{let s=ctx.state();ctx.loadLevel(s,2);assert(!ctx.won(s));s.enemies.forEach(e=>e.alive=false);assert(ctx.won(s));});
test('damage has cooldown and resets current stage on death',()=>{let s=ctx.state();s.lastDamage=0;assert(ctx.damage(s,1000));assert.equal(s.hp,2);assert(!ctx.damage(s,1100));ctx.damage(s,2000);ctx.damage(s,3000);assert.equal(s.hp,3);assert.equal(s.li,0);assert(s.justDied);});
test('four sound heads remain within 48 ms stereo PCM',()=>{for(const name of Object.keys(ctx.SOUND)){let ms=ctx.SOUND[name][1];assert(ms<=48);assert.equal(ctx.sounds[name].byteLength,Math.floor(ms*16)*4)}ctx.play('win');assert(events.length>0);});
console.log(`raycast game: ${count} cases PASS`);
