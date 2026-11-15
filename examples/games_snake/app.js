/* Shared game helpers, duplicated so this app is a standalone deploy bundle. */
function gameLoop(fn, ms) { return lume.system.setInterval(fn, ms); }
function gameHigh(name) { var n = lume.storage.kv.get('hiscore.' + name); return typeof n === 'number' && n > 0 ? n : 0; }
function gameSave(name, score, previous) { if (score > previous) { lume.storage.kv.set('hiscore.' + name, score); return score; } return previous; }
function gameBeep(hz, ms) {
  /* 16 kHz, signed 16-bit LE stereo; <= 48 ms synchronous playback. */
  if (!lume.audio || !lume.audio.play) return;
  var samples = Math.floor(16000 * Math.min(ms, 48) / 1000);
  var pcm = new ArrayBuffer(samples * 4), v = new DataView(pcm);
  for (var i = 0; i < samples; i++) {
    var amplitude = (i % Math.max(2, Math.floor(16000 / hz))) < 8000 / hz ? 1800 : -1800;
    v.setInt16(i * 4, amplitude, true); v.setInt16(i * 4 + 2, amplitude, true);
  }
  lume.audio.play(pcm);
}
function gameAabb(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

var GRID = 24, CELL = 16;
/* Board tuning point: adjust threshold and axis signs on the physical board. */
var IMU_THRESHOLD = 2.4, IMU_X_SIGN = 1, IMU_Y_SIGN = 1;
function snakeTurn(state, dir) {
  var opposite = {left:'right',right:'left',up:'down',down:'up'};
  if (dir && dir !== opposite[state.dir]) state.next = dir;
}
function snakeFood(state, random) {
  var free = [];
  for (var y=0;y<GRID;y++) for(var x=0;x<GRID;x++) {
    var used=false; for(var i=0;i<state.body.length;i++) if(state.body[i].x===x&&state.body[i].y===y) used=true;
    if(!used) free.push({x:x,y:y});
  }
  return free.length ? free[Math.floor(random()*free.length)] : null;
}
function snakeStep(state, random) {
  if(state.over) return {kind:'over',dirty:[]};
  state.dir=state.next;
  var head=state.body[0], d={right:[1,0],left:[-1,0],up:[0,-1],down:[0,1]}[state.dir];
  var next={x:head.x+d[0],y:head.y+d[1]}, eat=state.food&&next.x===state.food.x&&next.y===state.food.y;
  if(next.x<0||next.x>=GRID||next.y<0||next.y>=GRID) {state.over=true;return {kind:'wall',dirty:[]};}
  var limit=state.body.length-(eat?0:1);
  for(var i=0;i<limit;i++) if(state.body[i].x===next.x&&state.body[i].y===next.y){state.over=true;return {kind:'body',dirty:[]};}
  var tail=state.body[state.body.length-1]; state.body.unshift(next);
  var dirty=[next]; if(!eat){state.body.pop();dirty.push(tail);} else {state.score++;state.food=snakeFood(state,random);if(state.food)dirty.push(state.food);else state.over=true;}
  return {kind:eat?'eat':'move',dirty:dirty};
}
function imuDirection(ax,ay) {
  ax*=IMU_X_SIGN;ay*=IMU_Y_SIGN;
  if(Math.max(Math.abs(ax),Math.abs(ay))<IMU_THRESHOLD) return null;
  return Math.abs(ax)>Math.abs(ay)?(ax>0?'right':'left'):(ay>0?'down':'up');
}
/* GAME UI */
var state={body:[{x:12,y:12},{x:11,y:12},{x:10,y:12}],dir:'right',next:'right',food:null,score:0,over:false};
state.food=snakeFood(state,Math.random);
var best=signal(gameHigh('snake')),score=signal(0),note=signal('SWIPE OR TILT'),redraw=signal(0),dirty=[];
var root=View({style:{width:480,height:480,background:'#081715',scroll:'none'}});
Text({parent:root,text:'SNAKE',style:{position:'absolute',x:70,y:22,fontSize:32,color:'#D9FFE8'}});
Text({parent:root,text:function(){return 'SCORE '+score()+'  BEST '+best();},style:{position:'absolute',x:70,y:60,fontSize:20,color:'#D9FFE8'}});
Text({parent:root,text:function(){return note();},style:{position:'absolute',x:145,y:449,fontSize:14,color:'#D9FFE8'}});
var scene=Canvas({parent:root,width:384,height:384,style:{position:'absolute',x:48,y:88},onDraw:function(ctx){
  redraw();
  /* Canvas keeps its prior pixels; repaint only head, vacated tail and food. */
  var full=!dirty.length;
  if(full) {ctx.fillColor('#12332B');ctx.fillRect(0,0,384,384);for(var i=0;i<state.body.length;i++)dirty.push(state.body[i]);if(state.food)dirty.push(state.food);}
  for(var j=0;j<dirty.length;j++){
    var p=dirty[j], body=false;for(var k=0;k<state.body.length;k++)if(state.body[k].x===p.x&&state.body[k].y===p.y)body=true;
    var food=state.food&&state.food.x===p.x&&state.food.y===p.y;
    ctx.fillColor(food?'#FFB84D':body?'#57E49B':'#12332B');ctx.fillRect(p.x*CELL+1,p.y*CELL+1,CELL-2,CELL-2);
  }
  var areas=[];for(var n=0;n<dirty.length;n++)areas.push({x:dirty[n].x*CELL+1,y:dirty[n].y*CELL+1,w:CELL-2,h:CELL-2});
  dirty=[];
  if(!full)return areas;
}});
var period=180,timer=null,imuTimer=null;
function snakeTick(){var r=snakeStep(state,Math.random);dirty=r.dirty;redraw.set(redraw()+1);
 if(r.kind==='eat'){score.set(state.score);best.set(gameSave('snake',state.score,best()));gameBeep(750,25);period=Math.max(80,180-state.score*8);lume.system.clearInterval(timer);timer=gameLoop(snakeTick,period);}
 if(state.over){note.set('GAME OVER - TAP');gameBeep(180,45);lume.system.clearInterval(timer);timer=null;}}
function snakeStart(){if(timer===null&&!state.over)timer=gameLoop(snakeTick,period);if(imuTimer===null)imuTimer=gameLoop(function(){var s=lume.imu.read();if(s&&typeof s.ax==='number')snakeTurn(state,imuDirection(s.ax,s.ay));},50);}
function snakeStop(){if(timer!==null)lume.system.clearInterval(timer);if(imuTimer!==null)lume.system.clearInterval(imuTimer);timer=null;imuTimer=null;}
lume.gesture.on(root,'swipe',function(e){snakeTurn(state,e.dir);});
lume.gesture.on(scene,'swipe',function(e){snakeTurn(state,e.dir);});
function snakeRestart(){if(!state.over)return;state={body:[{x:12,y:12},{x:11,y:12},{x:10,y:12}],dir:'right',next:'right',food:null,score:0,over:false};state.food=snakeFood(state,Math.random);score.set(0);period=180;dirty=[];note.set('SWIPE OR TILT');redraw.set(redraw()+1);snakeStart();}
lume.gesture.on(root,'tap',snakeRestart);lume.gesture.on(scene,'tap',snakeRestart);
lume.app.onPause(snakeStop);lume.app.onResume(snakeStart);snakeStart();
