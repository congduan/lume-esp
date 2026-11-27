/* Sokoban — original pixel approximations, r68 retro pixel dialect.
 * Hard-edge fillRect on integer pixels (no AA). Every tile is a precomputed
 * run-length span decoded ONCE at eval and replayed every frame (the mario
 * pattern); spanBuilds is a stable count never touched by tick or onDraw.
 * Stock 14px Montserrat is kept (no pixel font swap — r68 entry in
 * docs/KNOWN-SIMPLIFICATIONS.md). Levels are hand-authored ASCII puzzles, not
 * copied from any commercial level set; no third-party bitmaps or marks.
 * Player moves are teleport + one highlight, no tween (same r68 frogger
 * simplification). NVS keys cap at 15 chars (lume_kv.c), so the brief's
 * 'hisc.soko_progress' (18) is shortened to 'hisc.soko_pg' (12). */
/* r201: cell pitch/board origin trimmed so the 13x10 board and all HUD/buttons
   sit inside the 480-round safe square. Grid data, push logic and KV keys are unchanged. */
var IW=480, IH=480, CELL=22, GX=97, GY=128, COLS=13, ROWS=10;
var BG='#0D1420';
var PAL={
  A:'#7A8F4E', B:'#4C5E33', C:'#28331F',
  D:'#9BBC0F',
  E:'#D7B878', F:'#A98A50', G:'#6E5730',
  H:'#9FD8F0', I:'#5B9BC4', J:'#2A4A66',
  K:'#181C12', L:'#E8D46A', M:'#2A2410', N:'#FFFFFF'
};

/* 8x8 tile templates scaled x4 to a 32px cell. '.' transparent. */
var SPRITES={
  wall:['AAAAAAAA','ABBBABBB','ABBBABBB','AAAAAAAA','BBBBAAAA','BAAABAAA','BAAABAAA','BBBBAAAA'],
  floor:['........','..C..C..','........','C......C','........','..C..C..','........','C......C'],
  goal:['........','...DD...','..D..D..','.D....D.','.D....D.','..D..D..','...DD...','........'],
  box:['EEEEEEEE','EFFFFFFE','EFGGGGFE','EFGEEGFE','EFGEEGFE','EFGGGGFE','EFFFFFFE','EEEEEEEE'],
  boxGoal:['HHHHHHHH','HIIIIIIH','HIJJJJIH','HIJHJHIH','HIJHJHIH','HIJJJJIH','HIIIIIIH','HHHHHHHH'],
  player:['..KKKK..','.KLLLLK.','.KLLLLK.','KLLMMLLK','KLLMMLLK','.KLLLLK.','.KLLLLK.','..KKKK..']
};
/* Precompute once: spanBuilds is a stable count of sprite keys. */
var SPANS={}, spanBuilds=0;
for(var sk in SPRITES){spanBuilds++;var rows=SPRITES[sk],out=[];for(var yy=0;yy<rows.length;yy++){var line=rows[yy],xx=0;while(xx<line.length){var ink=line.charAt(xx),st=xx;while(xx<line.length&&line.charAt(xx)===ink)xx++;if(ink!=='.')out.push([st,yy,xx-st,ink]);}}SPANS[sk]=out;}

/* 10 hand-authored levels. '#' wall, '.' goal, '$' box, '@' player,
 * '*' box-on-goal, '+' player-on-goal. par = optimal player moves (BFS-proven
 * in tests/sokoban.js). Every level is 11x7, well within the 13x10 cap. */
var LEVELS=[
  {name:'FIRST PUSH',par:2,map:['###########','#    .    #','#         #','#    $    #','#    @    #','#         #','###########']},
  {name:'TWO LANES',par:9,map:['###########','#         #','#  .   .  #','#  $   $  #','#    @    #','#         #','###########']},
  {name:'SIDE STEP',par:1,map:['###########','#  #####  #','#  #   #  #','#  @$. #  #','#  #   #  #','#  #####  #','###########']},
  {name:'PILLAR',par:10,map:['###########','#    #    #','# .  #  . #','# $  #  $ #','#  @      #','#         #','###########']},
  {name:'SPLIT',par:8,map:['###########','#   ###   #','# .   .   #','# $   $   #','#    @    #','#         #','###########']},
  {name:'THREE IN A ROW',par:7,map:['###########','#         #','# ...     #','# $$$     #','#   @     #','#         #','###########']},
  {name:'CENTRE WALL',par:9,map:['###########','#         #','#  .   .  #','#  $ # $  #','#    @    #','#         #','###########']},
  {name:'STAGGER',par:14,map:['###########','#  #   #  #','# .$  .$  #','#   @ $   #','#  #   .# #','#         #','###########']},
  {name:'THE LEDGE',par:15,map:['###########','#  .....  #','#  $$$$$  #','#    @    #','#         #','#         #','###########']},
  {name:'LAST ONE',par:4,map:['###########','#  ####   #','#  #..#   #','#  #$$#   #','#   @     #','#         #','###########']}
];

/* NVS key cap 15: 'hisc.soko_progress' is 18 and is rejected on hardware. */
function sokoProgress(){try{var n=lume.storage.kv.get('hisc.soko_pg');return typeof n==='number'&&n>=1?Math.min(LEVELS.length,Math.floor(n)):1;}catch(e){return 1;}}
function sokoSaveProgress(n){try{lume.storage.kv.set('hisc.soko_pg',n);}catch(e){/* volatile progress still works */}return n;}

function sokoParse(def){
  var map=def.map,w=map[0].length,h=map.length,goals=[],boxes=[],player=null;
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){var c=map[y].charAt(x),k=y*w+x;
    if(c==='.'||c==='*'||c==='+')goals.push(k);
    if(c==='$'||c==='*')boxes.push([x,y]);
    if(c==='@'||c==='+')player=[x,y];
  }
  return {name:def.name,par:def.par,map:map,w:w,h:h,goals:goals,boxes:boxes,player:player,boxCount:boxes.length};
}
function sokoWall(level,x,y){if(x<0||y<0||x>=level.w||y>=level.h)return true;return level.map[y].charAt(x)==='#';}
function sokoGoalAt(level,x,y){for(var i=0;i<level.goals.length;i++)if(level.goals[i]===y*level.w+x)return true;return false;}
function sokoBoxAt(s,x,y){for(var i=0;i<s.boxes.length;i++)if(s.boxes[i][0]===x&&s.boxes[i][1]===y)return i;return -1;}
function sokoOnGoalCount(s){var n=0;for(var i=0;i<s.boxes.length;i++)if(sokoGoalAt(s.level,s.boxes[i][0],s.boxes[i][1]))n++;return n;}
function sokoDeadlock(s){for(var i=0;i<s.boxes.length;i++){var b=s.boxes[i],x=b[0],y=b[1];if(sokoGoalAt(s.level,x,y))continue;
  if((sokoWall(s.level,x-1,y)&&sokoWall(s.level,x,y-1))||(sokoWall(s.level,x+1,y)&&sokoWall(s.level,x,y-1))||
     (sokoWall(s.level,x-1,y)&&sokoWall(s.level,x,y+1))||(sokoWall(s.level,x+1,y)&&sokoWall(s.level,x,y+1)))return true;
}return false;}
function sokoEmit(s,msg){s.events.push(msg);}
function sokoLoad(s,li){s.li=Math.max(0,Math.min(LEVELS.length-1,li));s.level=sokoParse(LEVELS[s.li]);s.boxes=s.level.boxes.map(function(b){return [b[0],b[1]];});s.px=s.level.player[0];s.py=s.level.player[1];s.moves=0;s.completed=false;s.stuck=false;s.highlight=0;sokoEmit(s,'L'+(s.li+1)+' moves=0 boxes=0/'+s.level.boxCount);}
function sokoState(li){var s={li:0,level:null,px:0,py:0,boxes:[],moves:0,completed:false,stuck:false,highlight:0,tick:0,events:[]};sokoLoad(s,li||0);return s;}
function sokoRestart(s){sokoLoad(s,s.li);}
/* Standard rules: push one box, never pull, never push two. */
function sokoMove(s,dx,dy){
  if(s.completed)return 'done';
  var nx=s.px+dx,ny=s.py+dy;
  if(sokoWall(s.level,nx,ny)){sokoEmit(s,'BLOCKED wall');return 'blocked';}
  var bi=sokoBoxAt(s,nx,ny),pushed=false;
  if(bi>=0){var bx=nx+dx,by=ny+dy;
    if(sokoWall(s.level,bx,by)||sokoBoxAt(s,bx,by)>=0){sokoEmit(s,'BLOCKED box');return 'blocked';}
    s.boxes[bi]=[bx,by];pushed=true;
  }
  s.px=nx;s.py=ny;s.moves++;s.highlight=1;
  var on=sokoOnGoalCount(s);
  sokoEmit(s,'L'+(s.li+1)+' moves='+s.moves+' boxes='+on+'/'+s.level.boxCount);
  s.stuck=sokoDeadlock(s);
  if(s.stuck)sokoEmit(s,'STUCK L'+(s.li+1)+' moves='+s.moves);
  if(on===s.level.boxCount){s.completed=true;var next=Math.min(LEVELS.length,s.li+2);
    if(next>sokoProgress())sokoSaveProgress(next);
    sokoEmit(s,'WIN L'+(s.li+1)+' moves='+s.moves+' par='+s.level.par);return 'win';
  }
  return pushed?'push':'move';
}

/* GAME UI */
var state=sokoState(0);
var frame=signal(0),levelSig=signal(1),movesSig=signal(0),parSig=signal(LEVELS[0].par),boxSig=signal(0),stuckSig=signal(false),unlockSig=signal(sokoProgress()),noteSig=signal('');
var root=View({style:{width:IW,height:IH,background:BG,scroll:'none'}});
function logEvent(msg){lume.log('SOKO '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.y+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
function hex565(hex){var v=parseInt(hex.slice(1),16);return ((((v>>16)&255)>>3)<<11)|((((v>>8)&255)>>2)<<5)|((v&255)>>3);}
var SLOT={},PIXELS={},spritesUploaded=false;
(function(){var keys=['wall','floor','goal','box','boxGoal','player'];
  for(var i=0;i<keys.length;i++){var k=keys[i],w=32,h=32,px=new Uint16Array(w*h),list=SPANS[k];
    for(var j=0;j<list.length;j++){var s=list[j],c=hex565(PAL[s[3]]);
      for(var dy=0;dy<4;dy++){var yy=s[1]*4+dy;for(var dx=0;dx<s[2]*4;dx++)px[yy*w+s[0]*4+dx]=c;}
    }
    SLOT[k]=i+1;PIXELS[k]={w:w,h:h,px:px};
  }
})();
function ensureSprites(ctx){if(spritesUploaded)return;for(var k in SLOT){var p=PIXELS[k];ctx.retainImage(SLOT[k],p.w,p.h,p.px);}spritesUploaded=true;}
function drawSprite(ctx,key,cx,cy){ctx.drawImage(SLOT[key],Math.floor(cx),Math.floor(cy),0);}
function paintCell(ctx,x,y,a,s){
  var px=GX+x*CELL,py=GY+y*CELL;
  if(sokoWall(s.level,x,y)){drawSprite(ctx,'wall',px,py);return;}
  drawSprite(ctx,'floor',px,py);
  if(sokoGoalAt(s.level,x,y))drawSprite(ctx,'goal',px,py);
  var bi=sokoBoxAt(s,x,y);
  if(bi>=0)drawSprite(ctx,sokoGoalAt(s.level,x,y)?'boxGoal':'box',px,py);
  if(s.px===x&&s.py===y){drawSprite(ctx,'player',px,py);if(s.highlight>0)drawRect(ctx,PAL.N,box(px,py,CELL,3),a);}
}
var painted=false,perfCount=0,perfSum=0,perfMax=0;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();ensureSprites(ctx);var s=state;
  var a=!painted?box(0,0,IW,IH):clip(box(GX,GY,s.level.w*CELL+10,s.level.h*CELL+10));if(!a)return undefined;
  ctx.fillColor(BG);ctx.fillRect(a.x,a.y,a.w,a.h);
  for(var y=0;y<s.level.h;y++)for(var x=0;x<s.level.w;x++)paintCell(ctx,x,y,a,s);
  painted=true;return [a];
}});
Text({parent:root,text:'SOKOBAN',style:{position:'absolute',x:84,y:78,width:120,fontSize:14,borderRadius:0,color:'#F2F7FB'}});
Text({parent:root,text:function(){return 'L'+(levelSig())+'/'+LEVELS.length+'  MV '+movesSig()+'  PAR '+parSig()+'  BOX '+boxSig()+'/'+state.level.boxCount;},style:{position:'absolute',x:204,y:78,width:192,fontSize:11,borderRadius:0,color:'#9EB3C6',textAlign:'right'}});
Text({parent:root,text:function(){return stuckSig()?'STUCK  -  PRESS RESET':(noteSig()||'SWIPE TO STEP  TAP A NEIGHBOUR');},style:{position:'absolute',x:84,y:96,width:312,fontSize:12,borderRadius:0,color:'#5B9DF7'}});
Text({parent:root,text:function(){return state.level.name+'  UNLOCKED '+unlockSig()+'/'+LEVELS.length;},style:{position:'absolute',x:84,y:112,width:312,fontSize:11,borderRadius:0,color:'#9EB3C6'}});
function btn(title,x,fn){return Button({title:title,style:{position:'absolute',x:x,y:352,width:92,height:48,borderRadius:8,background:'#1F2C3D',color:'#F2F7FB',fontSize:12},onPress:fn});}
btn('< PREV',84,function(){if(state.li>0){sokoLoad(state,state.li-1);sync();}});
btn('RESET',194,function(){sokoRestart(state);sync();});
btn('NEXT >',304,function(){if(state.li+1<LEVELS.length&&state.li+1<sokoProgress()){sokoLoad(state,state.li+1);sync();}});

function updateSignals(){levelSig.set(state.li+1);movesSig.set(state.moves);parSig.set(state.level.par);boxSig.set(sokoOnGoalCount(state));stuckSig.set(state.stuck);unlockSig.set(sokoProgress());}
function sync(){updateSignals();noteSig.set(state.completed?'CLEARED - NEXT UNLOCKED':'');frame.set(frame()+1);}
function applyMove(dx,dy){var r=sokoMove(state,dx,dy);while(state.events.length)logEvent(state.events.shift());sync();return r;}
function swipe(e){var d=e.dir==='up'?[0,-1]:e.dir==='down'?[0,1]:e.dir==='left'?[-1,0]:e.dir==='right'?[1,0]:null;if(d)applyMove(d[0],d[1]);}
function tap(e){var cx=Math.floor((e.x-GX)/CELL),cy=Math.floor((e.y-GY)/CELL);
  if(Math.abs(cx-state.px)+Math.abs(cy-state.py)!==1)return;
  applyMove(cx-state.px,cy-state.py);
}
lume.gesture.on(root,'swipe',swipe);lume.gesture.on(root,'tap',tap);
function tick(){var t0=Date.now();
  if(state.highlight>0){state.highlight--;frame.set(frame()+1);}
  perfCount++;perfSum+=Date.now()-t0;perfMax=Math.max(perfMax,Date.now()-t0);
  if(perfCount===25){logEvent('PERF js_avg_ms='+(perfSum/25).toFixed(2)+' js_max_ms='+perfMax);perfCount=0;perfSum=0;perfMax=0;}
}
lume.app.onPause(function(){});lume.app.onResume(function(){frame.set(frame()+1);});
var timer=lume.system.setInterval(tick,120);
updateSignals();noteSig.set('');logEvent('L1 moves=0 boxes=0/'+state.level.boxCount+'; '+state.level.name+' par='+state.level.par);
