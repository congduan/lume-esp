const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function logic(name) {
  const source = fs.readFileSync(`examples/games_${name}/app.js`, 'utf8').split('/* GAME UI */')[0];
  const ctx = vm.createContext({}); vm.runInContext(source, ctx); return ctx;
}
function plain(v) { return JSON.parse(JSON.stringify(v)); }
const a = logic('2048');
for (const [dir, input, output] of [
  ['left',[2,2,2,2],[4,4,0,0]], ['right',[2,2,2,2],[0,0,4,4]],
  ['up',[2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0],[4,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0]],
  ['down',[2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0],[0,0,0,0,0,0,0,0,4,0,0,0,4,0,0,0]],
]) { const b=input.concat(Array(16-input.length).fill(0)); const got=a.moveBoard(b,dir); assert.deepEqual(plain(got.board),output.concat(Array(16-output.length).fill(0))); assert.equal(got.score,8); console.log('PASS 2048 '+dir); }
assert.equal(a.moveBoard([2,4,8,16,0,0,0,0,0,0,0,0,0,0,0,0],'left').changed,false);console.log('PASS 2048 no change');
assert.equal(a.boardOver([2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,2]),true);console.log('PASS 2048 game over');
const s = logic('snake');
let snake={body:[{x:3,y:3},{x:2,y:3}],dir:'right',next:'right',food:{x:4,y:3},score:0,over:false};
s.snakeTurn(snake,'left');assert.equal(snake.next,'right');s.snakeTurn(snake,'up');assert.equal(snake.next,'up');console.log('PASS snake turns');
snake.next='right';assert.equal(s.snakeStep(snake,()=>0).kind,'eat');assert.equal(snake.score,1);assert.equal(snake.body.length,3);console.log('PASS snake eats');
snake.body=[{x:23,y:3}];snake.next='right';assert.equal(s.snakeStep(snake,()=>0).kind,'wall');console.log('PASS snake wall');
snake={body:[{x:3,y:3},{x:3,y:4},{x:2,y:4},{x:2,y:3},{x:1,y:3}],dir:'up',next:'left',food:{x:9,y:9},score:0,over:false};assert.equal(s.snakeStep(snake,()=>0).kind,'body');console.log('PASS snake body');
assert.equal(s.imuDirection(-3,1),'right');assert.equal(s.imuDirection(3,1),'left');assert.equal(s.imuDirection(0,0),null);console.log('PASS snake IMU threshold and axis sign');
const b=logic('breakout');
for (const [name,ctx] of [['2048',a],['snake',s],['brkout',b]]) {let stored;ctx.lume={storage:{kv:{get:key=>{stored=key;return 0;},set:(key,value)=>{stored=key;return 0;}}}};assert.equal(ctx.gameHigh(name),0);assert.equal(ctx.gameSave(name,10,0),10);assert.equal(stored,`hiscore.${name}`);assert.ok(stored.length<=15);console.log('PASS '+name+' high score KV key');}let game=b.breakoutState();game.x=4;game.vx=-3;game.y=200;game.vy=0;b.breakoutStep(game);assert.ok(game.vx>0);console.log('PASS breakout wall rebound');
game=b.breakoutState();game.x=game.bricks[0].x+20;game.y=game.bricks[0].y-6;game.vx=0;game.vy=2;assert.equal(b.breakoutStep(game),'brick');assert.equal(game.remaining,35);assert.equal(game.score,10);console.log('PASS breakout brick');
game=b.breakoutState();game.y=game.bricks[0].y-6;game.x=game.bricks[0].x+20;game.vx=0;game.vy=2;for(let i=1;i<36;i++)game.bricks[i].alive=false;game.remaining=1;assert.equal(b.breakoutStep(game),'level');assert.equal(game.level,2);console.log('PASS breakout level');
game=b.breakoutState();game.lives=1;game.y=356;game.vy=3;assert.equal(b.breakoutStep(game),'over');assert.equal(game.over,true);console.log('PASS breakout game over');
const t=logic('tetris');
let tb=t.tetrisBoard(), piece={type:2,x:-2,y:0,rot:1};
assert.equal(t.tetrisFits(tb,piece),true);assert.equal(t.tetrisRotate(tb,piece),true);
assert.equal(piece.x,-1);assert.equal(piece.rot,2);console.log('PASS tetris clockwise wall kick');
for(let x=0;x<10;x++)tb[19][x]=1;
let cleared=t.tetrisClear(tb);assert.equal(cleared.lines,1);assert.deepEqual(plain(cleared.dirtyRows),[19]);
assert.equal(t.tetrisPoints(1,1),100);assert.equal(t.tetrisPeriod(100),80);
console.log('PASS tetris line clear, score and speed floor');
let ts=t.tetrisState();ts.board=t.tetrisBoard();for(let x=2;x<10;x++)ts.board[19][x]=1;
ts.piece={type:1,x:-1,y:18,rot:0};ts.next=2;
assert.equal(t.tetrisLock(ts).lines,1);assert.equal(ts.score,100);assert.equal(ts.lines,1);
console.log('PASS tetris lock scores cleared row');
let store={};t.lume={storage:{kv:{get:key=>store[key]??null,set:(key,value)=>{store[key]=value;return 0;}}}};
assert.equal(t.gameHigh('tetris'),0);assert.equal(t.gameSave('tetris',100,0),100);
assert.equal(store['hiscore.tetris'],100);assert.equal(t.gameHigh('tetris'),100);
assert.ok('hiscore.tetris'.length<=15);
t.lume.storage.kv.get=()=>{throw Error('offline');};t.lume.storage.kv.set=()=>{throw Error('offline');};
assert.equal(t.gameHigh('tetris'),0);assert.equal(t.gameSave('tetris',200,100),200);
console.log('PASS tetris high score KV and graceful failure');
const {runApp}=require('./lib/prelude_runner');
const events=[],ui=runApp(fs.readFileSync('examples/games_tetris/app.js','utf8'),{onLog:s=>events.push(s)});
const sceneId=ui.messages.find(m=>m[0]==='create'&&m[2]===3&&m[4]===200)?.[1];
assert.ok(sceneId);assert.ok(ui.messages.some(m=>m[0]==='invalidate'&&m[1]===sceneId&&m[4]===200&&m[5]===400));
ui.ctx.state.piece={type:2,x:3,y:0,rot:0};
ui.gesture(sceneId,0,180,150,0);ui.gesture(sceneId,2,180,150,80);
assert.equal(ui.ctx.state.piece.rot,1);assert.ok(events.some(e=>e.startsWith('TETRIS ROTATE')));
let invalid=ui.messages.filter(m=>m[0]==='invalidate'&&m[1]===sceneId).at(-1);
assert.ok(invalid[4]*invalid[5]<80000);
let oldCol=ui.ctx.state.piece.x;
ui.gesture(sceneId,0,180,150,200);ui.gesture(sceneId,1,220,150,240);ui.gesture(sceneId,2,220,150,280);
assert.equal(ui.ctx.state.piece.x,oldCol+2);
let oldRow=ui.ctx.state.piece.y;
ui.gesture(sceneId,0,180,150,400);ui.gesture(sceneId,1,180,210,450);ui.gesture(sceneId,2,180,210,490);
assert.equal(ui.ctx.state.piece.y,oldRow+1);
for(let x=0;x<8;x++)ui.ctx.state.board[19][x]=1;
ui.ctx.state.piece={type:1,x:7,y:0,rot:0};
let saved=0;ui.lume.storage.kv.set=(key,value)=>{assert.equal(key,'hiscore.tetris');saved=value;return 0;};
ui.gesture(sceneId,0,180,150,600);ui.gesture(sceneId,1,180,300,680);ui.gesture(sceneId,2,180,300,730);
assert.equal(ui.ctx.state.lines,1);assert.equal(ui.ctx.state.score,100);assert.equal(saved,100);
assert.ok(events.some(e=>e.startsWith('TETRIS LINE 1 dirty_px=')));
console.log('PASS tetris canvas, tap rotation, pan follow, soft and hard drop, line log');
