/* Standalone game helpers (inlined from examples/games/shared.js). */
function gameLoop(fn, ms) { return lume.system.setInterval(fn, ms); }
function gameHigh(name) {
  try { var n = lume.storage.kv.get('hiscore.' + name); return typeof n === 'number' && n > 0 ? n : 0; }
  catch (e) { return 0; }
}
function gameSave(name, score, previous) {
  if (score <= previous) return previous;
  try { lume.storage.kv.set('hiscore.' + name, score); } catch (e) { /* volatile score still works */ }
  return score;
}

var TW = 10, TH = 20, CELL = 16;
/* Four cells in a 4x4 rotation box, in I O T S Z J L order. */
var TETRIS_SHAPES = [
  [[0,1],[1,1],[2,1],[3,1]], [[1,0],[2,0],[1,1],[2,1]],
  [[1,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[0,1],[1,1]],
  [[0,0],[1,0],[1,1],[2,1]], [[0,0],[0,1],[1,1],[2,1]],
  [[2,0],[0,1],[1,1],[2,1]]
];
var TETRIS_COLORS = ['#58D9F5','#F5D96C','#B99BFF','#68DDA6','#F47C91','#78A8FF','#FFB067'];
function tetrisBoard() { var b=[]; for(var y=0;y<TH;y++){var row=[];for(var x=0;x<TW;x++)row.push(0);b.push(row);}return b; }
function tetrisCells(p) {
  var a=TETRIS_SHAPES[p.type], out=[];
  for(var i=0;i<4;i++) { var x=a[i][0],y=a[i][1];
    if(p.type!==1)for(var r=0;r<p.rot;r++){var q=x;x=3-y;y=q;}
    out.push({x:p.x+x,y:p.y+y});
  }
  return out;
}
function tetrisFits(board,p) {
  var cells=tetrisCells(p);
  for(var i=0;i<4;i++){var c=cells[i];if(c.x<0||c.x>=TW||c.y>=TH||(c.y>=0&&board[c.y][c.x]))return false;}
  return true;
}
function tetrisRotate(board,p) {
  if(p.type===1)return false;
  for(var i=0;i<3;i++){var dx=[0,-1,1][i],q={type:p.type,x:p.x+dx,y:p.y,rot:(p.rot+1)%4};
    if(tetrisFits(board,q)){p.x=q.x;p.rot=q.rot;return true;}}
  return false;
}
function tetrisClear(board) {
  var count=0, dirty=[],before=[];
  for(var k=0;k<TH;k++)before.push(board[k].slice());
  for(var y=TH-1;y>=0;y--){var full=true;for(var x=0;x<TW;x++)if(!board[y][x])full=false;
    if(full){board.splice(y,1);board.unshift([0,0,0,0,0,0,0,0,0,0]);count++;y++;}}
  if(count)for(var row=0;row<TH;row++)for(var col=0;col<TW;col++)if(before[row][col]!==board[row][col]){dirty.push(row);break;}
  return {lines:count,dirtyRows:dirty};
}
function tetrisPoints(lines,level) { return [0,100,300,500,800][lines]*level; }
function tetrisPeriod(lines) { return Math.max(80,700-Math.floor(lines/10)*65); }
function tetrisLock(s) {
  var cells=tetrisCells(s.piece), touched=[];
  for(var i=0;i<4;i++){var c=cells[i];if(c.y<0){s.over=true;continue;}s.board[c.y][c.x]=s.piece.type+1;touched.push(c.y);}
  var result=tetrisClear(s.board);s.lines+=result.lines;s.score+=tetrisPoints(result.lines,1+Math.floor((s.lines-result.lines)/10));
  s.level=1+Math.floor(s.lines/10);
  s.piece={type:s.next,x:3,y:0,rot:0};s.next=Math.floor(Math.random()*7);
  if(!tetrisFits(s.board,s.piece))s.over=true;
  return {lines:result.lines,dirtyRows:result.lines?result.dirtyRows:touched};
}
function tetrisState() {return {board:tetrisBoard(),piece:{type:Math.floor(Math.random()*7),x:3,y:0,rot:0},next:Math.floor(Math.random()*7),score:0,lines:0,level:1,over:false};}

/* GAME UI */
var state=tetrisState(), score=signal(0), best=signal(gameHigh('tetris'));
var level=signal(1), lines=signal(0), note=signal('DRAG / TAP / SWIPE DOWN');
var boardRev=signal(0),nextRev=signal(0),dirtyCells=[],fullBoard=true,dirtyArea=0,pendingLine=0;
/* r201: absolute HUD moved inside the 480-round safe square. The 160x320 play
   canvas and CELL=16 are harness anchors and stay byte-identical; the side
   panel now carries title/score/next/level/lines/note in the safe column. */
var root=View({style:{width:480,height:480,background:'#0D1420',scroll:'none'}});
Text({parent:root,text:'TETRIS',style:{position:'absolute',x:250,y:80,width:150,fontSize:20,borderRadius:0,color:'#F2F7FB'}});
Text({parent:root,text:function(){return 'SCORE '+score()+'    BEST '+best();},style:{position:'absolute',x:250,y:106,width:150,fontSize:14,borderRadius:0,color:'#9EB3C6'}});
View({parent:root,style:{position:'absolute',x:78,y:78,width:164,height:324,background:'#16202E',borderRadius:12}});
var scene=Canvas({parent:root,width:160,height:320,style:{position:'absolute',x:80,y:80},onDraw:function(ctx){
  boardRev();var cells=dirtyCells,minX=TW,minY=TH,maxX=-1,maxY=-1;
  if(fullBoard){cells=[];for(var y=0;y<TH;y++)for(var x=0;x<TW;x++)cells.push({x:x,y:y});}
  var active=state.over?[]:tetrisCells(state.piece);dirtyArea=0;
  for(var i=0;i<cells.length;i++){var c=cells[i];if(c.x<0||c.x>=TW||c.y<0||c.y>=TH)continue;
    var v=state.board[c.y][c.x];for(var j=0;j<active.length;j++)if(active[j].x===c.x&&active[j].y===c.y)v=state.piece.type+1;
    ctx.fillColor('#111C34');ctx.fillRect(c.x*CELL,c.y*CELL,CELL,CELL);
    ctx.fillColor(v?TETRIS_COLORS[v-1]:'#192640');ctx.fillRect(c.x*CELL+1,c.y*CELL+1,CELL-2,CELL-2);
    if(c.x<minX)minX=c.x;if(c.y<minY)minY=c.y;if(c.x>maxX)maxX=c.x;if(c.y>maxY)maxY=c.y;
  }
  dirtyCells=[];fullBoard=false;
  if(maxX<0)return;
  var area={x:minX*CELL,y:minY*CELL,w:(maxX-minX+1)*CELL,h:(maxY-minY+1)*CELL};
  dirtyArea=area.w*area.h;
  if(pendingLine){lume.log('TETRIS LINE '+pendingLine+' dirty_px='+dirtyArea);pendingLine=0;}
  return [area];
}});
Text({parent:root,text:'NEXT',style:{position:'absolute',x:250,y:140,width:150,fontSize:14,borderRadius:0,color:'#9EB3C6'}});
View({parent:root,style:{position:'absolute',x:252,y:162,width:84,height:84,background:'#1F2C3D',borderRadius:12}});
var preview=Canvas({parent:root,width:80,height:80,style:{position:'absolute',x:254,y:164},onDraw:function(ctx){
  nextRev();ctx.fillColor('#111C34');ctx.fillRect(0,0,80,80);
  var p={type:state.next,x:0,y:0,rot:0},a=tetrisCells(p);ctx.fillColor(TETRIS_COLORS[state.next]);
  for(var i=0;i<4;i++)ctx.fillRect(a[i].x*16+8,a[i].y*16+8,14,14);
}});
Text({parent:root,text:function(){return 'LEVEL '+level();},style:{position:'absolute',x:250,y:258,width:150,fontSize:14,borderRadius:0,color:'#E9ECFF'}});
Text({parent:root,text:function(){return 'LINES '+lines();},style:{position:'absolute',x:250,y:284,width:150,fontSize:14,borderRadius:0,color:'#E9ECFF'}});
Text({parent:root,text:function(){return note();},style:{position:'absolute',x:250,y:316,width:150,fontSize:12,borderRadius:0,color:'#40D8B0'}});
function mark(cells){for(var i=0;i<cells.length;i++)dirtyCells.push(cells[i]);}
function refresh(old,result){mark(old);if(result&&result.dirtyRows.length){for(var j=0;j<result.dirtyRows.length;j++)for(var x=0;x<TW;x++)dirtyCells.push({x:x,y:result.dirtyRows[j]});}
  if(result&&result.lines){pendingLine=result.lines;fullBoard=true;}
  if(!state.over)mark(tetrisCells(state.piece));boardRev.set(boardRev()+1);
  if(result){score.set(state.score);best.set(gameSave('tetris',state.score,best()));level.set(state.level);lines.set(state.lines);nextRev.set(nextRev()+1);
    if(state.over){note.set('GAME OVER - TAP');stop();}}
}
var timer=null,period=tetrisPeriod(0);
function stop(){if(timer!==null)lume.system.clearInterval(timer);timer=null;}
function start(){if(timer===null&&!state.over)timer=gameLoop(tick,period);}
function tick(){if(state.over)return;var old=tetrisCells(state.piece),q={type:state.piece.type,x:state.piece.x,y:state.piece.y+1,rot:state.piece.rot};
  if(tetrisFits(state.board,q)){state.piece=q;refresh(old,null);}else{var result=tetrisLock(state);refresh(old,result);
    var nextPeriod=tetrisPeriod(state.lines);if(nextPeriod!==period){period=nextPeriod;stop();start();}}}
function restart(){if(!state.over)return;state=tetrisState();score.set(0);level.set(1);lines.set(0);note.set('DRAG / TAP / SWIPE DOWN');period=tetrisPeriod(0);fullBoard=true;dirtyCells=[];boardRev.set(boardRev()+1);nextRev.set(nextRev()+1);start();}
function rotate(){if(state.over){restart();return;}var old=tetrisCells(state.piece);if(tetrisRotate(state.board,state.piece)){lume.log('TETRIS ROTATE '+state.piece.type);refresh(old,null);}}
var panBaseX=0,panBaseCol=0;
function panStart(e){panBaseX=e.x-e.dx;panBaseCol=state.piece.x;panMove(e);}
function panMove(e){if(state.over)return;var target=panBaseCol+Math.round((e.x-panBaseX)/CELL),old=tetrisCells(state.piece);
  while(state.piece.x!==target){var step=target>state.piece.x?1:-1,q={type:state.piece.type,x:state.piece.x+step,y:state.piece.y,rot:state.piece.rot};if(!tetrisFits(state.board,q))break;state.piece.x=q.x;}
  if(old[0].x!==tetrisCells(state.piece)[0].x)refresh(old,null);
}
function down(e){if(state.over)return;if(e.dir!=='down'||Math.abs(e.dy)<50)return;
  if(Math.abs(e.dy)<120){tick();return;}
  while(!state.over){var q={type:state.piece.type,x:state.piece.x,y:state.piece.y+1,rot:state.piece.rot};if(!tetrisFits(state.board,q))break;state.piece=q;}
  tick();
}
for(var i=0;i<2;i++){var target=i?scene:root;lume.gesture.on(target,'panstart',panStart);lume.gesture.on(target,'pan',panMove);
  lume.gesture.on(target,'tap',rotate);lume.gesture.on(target,'swipe',down);}
lume.app.onPause(stop);lume.app.onResume(start);start();
