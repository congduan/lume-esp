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

var BW=384,BH=350,BRICK_W=54,BRICK_H=22;
function breakoutBricks(){var b=[];for(var y=0;y<6;y++)for(var x=0;x<6;x++)b.push({x:20+x*58,y:22+y*27,w:BRICK_W,h:BRICK_H,alive:true});return b;}
function breakoutStep(s){
  if(s.over)return 'over';
  var ball={x:s.x-5,y:s.y-5,w:10,h:10}, oldX=s.x,oldY=s.y;
  s.x+=s.vx;s.y+=s.vy;
  if(s.x<5){s.x=5;s.vx=Math.abs(s.vx);}if(s.x>BW-5){s.x=BW-5;s.vx=-Math.abs(s.vx);}if(s.y<5){s.y=5;s.vy=Math.abs(s.vy);}
  var next={x:s.x-5,y:s.y-5,w:10,h:10};
  if(s.vy>0&&gameAabb(next,{x:s.paddle,y:BH-25,w:72,h:10})){s.y=BH-30;s.vy=-Math.abs(s.vy);s.vx+=(s.x-(s.paddle+36))*.025;return 'paddle';}
  for(var i=0;i<s.bricks.length;i++){var b=s.bricks[i];if(b.alive&&gameAabb(next,b)){
    b.alive=false;s.lastBrick=i;s.score+=10;s.remaining--;if(oldY+5<=b.y||oldY-5>=b.y+b.h)s.vy=-s.vy;else s.vx=-s.vx;
    if(!s.remaining){s.level++;s.bricks=breakoutBricks();s.remaining=36;s.vx*=1.13;s.vy*=1.13;return 'level';}return 'brick';}}
  if(s.y>BH+5){s.lives--;if(!s.lives){s.over=true;return 'over';}s.x=BW/2;s.y=BH-52;s.vx=2.5;s.vy=-3;return 'lost';}
  return 'move';
}
function breakoutState(){return {x:BW/2,y:BH-52,vx:2.5,vy:-3,paddle:BW/2-36,bricks:breakoutBricks(),remaining:36,lastBrick:-1,score:0,lives:3,level:1,over:false};}
/* GAME UI */
var state=breakoutState(),frame=signal(0),brickRevision=signal(0),score=signal(0),best=signal(gameHigh('breakout')),lives=signal(3),level=signal(1),note=signal('DRAG PADDLE');
var root=View({style:{width:480,height:480,background:'#0A1428',scroll:'none'}});
Text({parent:root,text:'BREAKOUT',style:{position:'absolute',x:72,y:22,fontSize:32,color:'#ECF2FF'}});
Text({parent:root,text:function(){return 'S '+score()+'  BEST '+best()+'  L '+lives()+'  LV '+level();},style:{position:'absolute',x:72,y:63,fontSize:20,color:'#ECF2FF'}});
Text({parent:root,text:function(){return note();},style:{position:'absolute',x:155,y:449,color:'#ECF2FF'}});
var oldBall=null,oldPaddle=null;
var scene=Canvas({parent:root,width:BW,height:BH,style:{position:'absolute',x:48,y:91},onDraw:function(ctx){
 frame();
 /* Transparent Canvas is unsupported: repaint only entity trails with board color.
    Bricks live in Views above this layer, so cleared trails do not erase them. */
 if(oldBall){ctx.fillColor('#0A1428');ctx.fillRect(oldBall.x-7,oldBall.y-7,14,14);}
 if(oldPaddle!==null){ctx.fillColor('#0A1428');ctx.fillRect(oldPaddle,BH-26,72,12);}
 ctx.fillColor('#FFFFFF');ctx.fillRect(Math.round(state.x)-5,Math.round(state.y)-5,10,10);
 ctx.fillColor('#5EE3C0');ctx.fillRect(Math.round(state.paddle),BH-25,72,10);
 oldBall={x:Math.round(state.x),y:Math.round(state.y)};oldPaddle=Math.round(state.paddle);
}});
var bricks=[];
for(var i=0;i<36;i++)(function(n){var b=state.bricks[n];bricks.push(View({parent:root,style:{position:'absolute',x:48+b.x,y:91+b.y,width:b.w,height:b.h,borderRadius:3,background:function(){brickRevision();return state.bricks[n].alive?['#F17A8A','#F8AB70','#F9D66C','#65D6B5','#63B8F0','#A48FE8'][Math.floor(n/6)]:'#0A1428';}}}));})(i);
var timer=null,lastDx=0;
function tick(){var event=breakoutStep(state);frame.set(frame()+1);
 if(event==='brick'||event==='level'){score.set(state.score);best.set(gameSave('breakout',state.score,best()));if(event==='brick')lume.setAttr(bricks[state.lastBrick],5,0);else for(var j=0;j<bricks.length;j++)lume.setAttr(bricks[j],5,1);gameBeep(620,20);}
 if(event==='paddle')gameBeep(400,12);
 if(event==='lost'||event==='over'){lives.set(state.lives);gameBeep(190,40);}
 if(event==='level'){level.set(state.level);note.set('LEVEL '+state.level);}
 if(event==='over'){note.set('GAME OVER - TAP');stop();}}
function start(){if(timer===null&&!state.over)timer=gameLoop(tick,40);}
function stop(){if(timer!==null)lume.system.clearInterval(timer);timer=null;}
function placePaddle(x){state.paddle=Math.max(0,Math.min(BW-72,x-48-36));frame.set(frame()+1);}
lume.gesture.on(root,'panstart',function(e){placePaddle(e.x);});lume.gesture.on(root,'pan',function(e){placePaddle(e.x);});
lume.gesture.on(scene,'panstart',function(e){placePaddle(e.x);});lume.gesture.on(scene,'pan',function(e){placePaddle(e.x);});
function breakoutTap(e){if(state.over){state=breakoutState();score.set(0);lives.set(3);level.set(1);note.set('DRAG PADDLE');for(var j=0;j<bricks.length;j++)lume.setAttr(bricks[j],5,1);start();}else placePaddle(e.x);}
lume.gesture.on(root,'tap',breakoutTap);lume.gesture.on(scene,'tap',breakoutTap);
lume.app.onPause(stop);lume.app.onResume(start);start();
