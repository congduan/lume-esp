/* Game & Watch-inspired DUAL segment-LCD toy — self-authored "segment LCD
 * style", NOT a pixel-for-pixel replica of any Nintendo Game & Watch unit,
 * original silhouettes only, no trademarks or third-party bitmaps.
 *
 * PHYSICAL ANALOGY (the identifying detail, documented before any code): a
 * non-backlit transmissive LCD has electrodes at EVERY possible segment even
 * when unlit, so the whole character shape is faintly visible in ambient
 * light and only the driven segments go dark/bright. We imitate that with two
 * layers: (1) a GHOST layer containing every possible segment at ~8% of the
 * lit green, uploaded ONCE to the C side with ctx.retainSegments() and replayed
 * each frame via ctx.drawPath() — it costs no per-frame JS geometry; (2) an
 * ACTIVE layer of normally-coloured segments driven by game state and drawn
 * with hard-edge fillRect. The ghost layer is therefore always present as a
 * dim outline, and the lit segments move on top of it. Hard edges only (no
 * AA), stock 14px Montserrat kept (r68 simplification), no sound (r68 two apps
 * had none), single-point touch. NVS keys cap at 15 chars -> 'hisc.lcd'. */
var IW=480, IH=480, BG='#050A06', GHOST='#122A12', ON='#8CDA4A', ON2='#5FA832', LINE='#1C3A1A';
var SEG=6, AC=5, AR=6, CELL=48, AX=120, AY=80;
var BY=150, LANE_H=64, PX=128, OW=48, OH=48, MISS_MAX=3;

/* Segment templates. 'A' = segment that can light (also part of the ghost);
 * 'G' = possible segment that is never lit (bread's unlit loaf outline). Each
 * template pixel is SEG px. All shapes are hand-drawn originals. */
var SEGMENTS={
  chef:['..AAAA..','.AAAAAA.','..AAAA..','.AAAAAA.','AAAAAAAA','.AAAAAA.'],
  breadGhost:['.GGGGGG.','GGGGGGGG','GGGGGGGG','GGGGGGGG','GGGGGGGG','.GGGGGG.'],
  bread0:['.AAAAAA.','AAAAAAAA','........','........','........','........'],
  bread1:['........','........','AAAAAAAA','AAAAAAAA','........','........'],
  bread2:['........','........','........','........','AAAAAAAA','.AAAAAA.'],
  runner:['..AAAA..','.AAAAAA.','AAAAAAAA','.AAAAAA.','AA....AA','A......A'],
  obstacle:['AAAAAAAA','AAAAAAAA','AA....AA','AA....AA','AAAAAAAA','AAAAAAAA']
};
/* Precompute lit spans once (r68 mario pattern); spanBuilds stays stable. */
var SPANS={}, spanBuilds=0;
for(var sk in SEGMENTS){spanBuilds++;var rows=SEGMENTS[sk],out=[];for(var yy=0;yy<rows.length;yy++){var line=rows[yy],xx=0;while(xx<line.length){var ink=line.charAt(xx),st=xx;while(xx<line.length&&line.charAt(xx)===ink)xx++;if(ink==='A')out.push([st,yy,xx-st]);}}SPANS[sk]=out;}
/* Ghost geometry: every non-'.' cell of a template becomes one thick segment
 * (inset by SEG/2 so the AA line's round end matches a fillRect pixel run). */
function ghostSprite(key,ox,oy){var rows=SEGMENTS[key],out=[];for(var y=0;y<rows.length;y++){var line=rows[y],x=0;while(x<line.length){var c=line.charAt(x),st=x;while(x<line.length&&line.charAt(x)===c)x++;if(c!=='.')out.push([ox+st*SEG+SEG/2,oy+y*SEG+SEG/2,ox+x*SEG-SEG/2,oy+y*SEG+SEG/2]);}}return out;}
var GHOST_A=[],GHOST_B=[];
for(var c=1;c<AC;c++)GHOST_A.push([AX+c*CELL,AY,AX+c*CELL,AY+AR*CELL]);
for(c=0;c<AC;c++)GHOST_A=GHOST_A.concat(ghostSprite('chef',AX+c*CELL,AY+(AR-1)*CELL));
for(var r=0;r<3;r++)for(c=0;c<AC;c++)GHOST_A=GHOST_A.concat(ghostSprite('breadGhost',AX+c*CELL,AY+r*CELL));
for(var l=0;l<3;l++)GHOST_B.push([0,BY+l*LANE_H,IW,BY+l*LANE_H]);
for(l=0;l<3;l++)GHOST_B=GHOST_B.concat(ghostSprite('runner',PX,BY+l*LANE_H+8));
for(l=0;l<3;l++)for(var k=0;k<3;k++)GHOST_B=GHOST_B.concat(ghostSprite('obstacle',200+k*96,BY+l*LANE_H+8));

function lcdHigh(){try{var n=lume.storage.kv.get('hisc.lcd');return typeof n==='number'&&n>0?n:0;}catch(e){return 0;}}
function lcdSave(score,prev){if(score<=prev)return prev;try{lume.storage.kv.set('hisc.lcd',score);}catch(e){/* volatile score still works */}return score;}
function gameA(){return {chef:2,bread:null,row:0,phase:0,drop:0,spawn:0,miss:0,score:0,over:false};}
function gameB(){return {lane:1,obstacles:[],spawn:0,miss:0,score:0,over:false};}
function lcdState(){return {mode:'a',a:gameA(),b:gameB(),hi:lcdHigh(),tick:0,frame:0,events:[],note:'SWIPE L/R CATCH  SWIPE U/D DODGE  MODE TO SWITCH'};}
function lcdEmit(s,msg){s.events.push(msg);}
function lcdScore(s){return s.mode==='a'?s.a.score:s.b.score;}
function lcdMiss(s){return s.mode==='a'?s.a.miss:s.b.miss;}
function lcdActive(s){return s.mode==='a'?s.a:s.b;}
/* Standard three-stage bread fall: one row per stage, phase cycles 0->1->2. */
function lcdStepA(s){var g=s.a;if(g.over)return 'over';
  if(g.bread===null){g.spawn++;if(g.spawn>=4){g.bread=Math.floor(Math.random()*AC);g.row=0;g.phase=0;g.drop=0;g.spawn=0;lcdEmit(s,'SPAWN col='+g.bread);}return 'idle';}
  g.drop++;if(g.drop<2)return 'fall';g.drop=0;g.row++;g.phase=(g.phase+1)%3;
  if(g.row>=AR){if(g.bread===g.chef){g.score++;lcdEmit(s,'CATCH col='+g.bread+' score='+g.score);}
    else{g.miss++;lcdEmit(s,'MISS '+g.miss);if(g.miss>=MISS_MAX){g.over=true;lcdEmit(s,'OVER score='+g.score+' miss='+g.miss);}}
    g.bread=null;}
  return 'stage';
}
function lcdStepB(s){var g=s.b;if(g.over)return 'over';
  g.spawn++;if(g.spawn>=6){var ln=Math.floor(Math.random()*3);g.obstacles.push({x:IW,lane:ln});g.spawn=0;lcdEmit(s,'OB lane='+ln);}
  for(var i=g.obstacles.length-1;i>=0;i--){var o=g.obstacles[i];o.x-=8;
    if(o.x+OW<0){g.obstacles.splice(i,1);g.score++;lcdEmit(s,'DODGE score='+g.score);continue;}
    if(o.lane===g.lane&&o.x<PX+32&&o.x+OW>PX){g.miss=1;g.over=true;lcdEmit(s,'HIT lane='+g.lane+' score='+g.score);break;}
  }
  return 'run';
}
/* Only the active mode advances: the other state machine is untouched. */
function lcdStep(s){s.tick++;return s.mode==='a'?lcdStepA(s):lcdStepB(s);}
function lcdMoveChef(s,d){var g=s.a;if(g.over)return 'over';var n=Math.max(0,Math.min(AC-1,g.chef+d));if(n===g.chef){lcdEmit(s,'CHEF edge');return 'blocked';}g.chef=n;lcdEmit(s,'CHEF col='+n);return 'move';}
function lcdMoveLane(s,d){var g=s.b;if(g.over)return 'over';var n=Math.max(0,Math.min(2,g.lane+d));if(n===g.lane){lcdEmit(s,'LANE edge');return 'blocked';}g.lane=n;lcdEmit(s,'LANE '+n);return 'move';}
/* MODE switch = clean hand-off: clear incoming game's transient objects and
 * miss/over flags, keep its score; the outgoing machine keeps its own state. */
function lcdSwitchMode(s,mode){s.mode=mode||(s.mode==='a'?'b':'a');var g=lcdActive(s);
  if(s.mode==='a'){g.bread=null;g.row=0;g.phase=0;g.drop=0;g.spawn=0;}else{g.obstacles=[];g.spawn=0;}
  g.miss=0;g.over=false;lcdEmit(s,'MODE '+s.mode);return s.mode;}
function lcdReset(s){var g=lcdActive(s);if(s.mode==='a'){var a=gameA();for(var k in a)g[k]=a[k];}else{var b=gameB();for(var k2 in b)g[k2]=b[k2];}lcdEmit(s,'RESET '+s.mode);}

/* GAME UI */
var state=lcdState();
var frame=signal(0),modeSig=signal('a'),scoreSig=signal(0),bestSig=signal(state.hi),missSig=signal(0),noteSig=signal(state.note);
var root=View({style:{width:IW,height:IH,background:BG,scroll:'none'}});
function logEvent(msg){lume.log('LCD '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.y+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
function drawLit(ctx,key,x,y,color,a){var list=SPANS[key];for(var i=0;i<list.length;i++){var p=list[i];drawRect(ctx,color,box(x+p[0]*SEG,y+p[1]*SEG,p[2]*SEG,SEG),a);}}
var ghostPidA=0,ghostPidB=0,pathDefines=0,painted=false,prevMode=null;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();var s=state;
  if(!ghostPidA){ghostPidA=ctx.retainSegments(GHOST_A,GHOST,SEG);ghostPidB=ctx.retainSegments(GHOST_B,GHOST,SEG);pathDefines+=2;}
  var a=s.mode==='a'?clip(box(AX-6,AY-6,AC*CELL+12,AR*CELL+12)):clip(box(0,BY-6,IW,3*LANE_H+12));
  var ab=clip(box(160,348,160,48)); /* r202: MODE affordance inside round safe row */
  /* A MODE change repaints the whole canvas once so the outgoing mode's lit
   * pixels cannot linger outside the incoming mode's smaller dirty region. */
  if(!painted||(prevMode!==null&&prevMode!==s.mode)){a=box(0,0,IW,IH);ab=null;}
  prevMode=s.mode;
  if(!a)return undefined;
  ctx.fillColor(BG);ctx.fillRect(a.x,a.y,a.w,a.h);
  if(ab){ctx.fillColor(GHOST);ctx.fillRect(ab.x,ab.y,ab.w,ab.h);}
  ctx.drawPath(s.mode==='a'?ghostPidA:ghostPidB,0,0); /* static ghost, no JS geometry */
  if(s.mode==='a'){
    var g=s.a;
    drawLit(ctx,'chef',AX+g.chef*CELL,AY+(AR-1)*CELL,ON,a);
    if(g.bread!==null)drawLit(ctx,'bread'+g.phase,AX+g.bread*CELL,AY+g.row*CELL,ON2,a);
  } else {
    var b=s.b;
    drawLit(ctx,'runner',PX,BY+b.lane*LANE_H+8,ON,a);
    for(var i=0;i<b.obstacles.length;i++)drawLit(ctx,'obstacle',b.obstacles[i].x,BY+b.obstacles[i].lane*LANE_H+8,ON2,a);
  }
  painted=true;return ab?[a,ab]:[a];
}});
/* r202: HUD and MODE caption moved into [84,396]; the canvas-drawn MODE
   affordance and its tap zone moved with them. Game geometry/KV unchanged. */
Text({parent:root,text:'LCD DUAL',style:{position:'absolute',x:84,y:80,fontSize:14,color:'#40D8B0',borderRadius:0}});
Text({parent:root,text:function(){return 'GAME '+modeSig().toUpperCase()+'  SCORE '+scoreSig()+'  HI '+bestSig()+'  MISS '+missSig()+'/'+MISS_MAX;},style:{position:'absolute',x:176,y:80,width:220,fontSize:13,color:'#9EB3C6',textAlign:'right',borderRadius:0}});
Text({parent:root,text:function(){return noteSig();},style:{position:'absolute',x:84,y:104,width:312,fontSize:13,color:'#F2F7FB',borderRadius:0}});
Text({parent:root,text:function(){return 'GHOST SEGMENTS: dim = all positions, bright = driven';},style:{position:'absolute',x:84,y:126,width:312,fontSize:12,color:'#9EB3C6',borderRadius:0}});
Text({parent:root,text:'MODE',style:{position:'absolute',x:160,y:358,width:160,fontSize:14,color:'#FFD78E',textAlign:'center',borderRadius:0}});
/* MODE is drawn INTO THE CANVAS (no LVGL Button node) and handled by the tap
 * gesture's bottom-zone branch below. A Button node would swallow the touch
 * in the emulator and double-fire with the canvas gesture in the browser, so
 * one gesture target makes one decision — no interaction conflict. */

function updateSignals(){modeSig.set(state.mode);scoreSig.set(lcdScore(state));bestSig.set(lcdSave(lcdScore(state),bestSig()));missSig.set(lcdMiss(state));
  noteSig.set(lcdActive(state).over?'GAME OVER - TAP TO RESTART':(state.mode==='a'?'GAME A  CATCH BREAD - 3 MISSES END':'GAME B  DODGE - ONE HIT ENDS'));}
function sync(){updateSignals();frame.set(frame()+1);}
function drain(){while(state.events.length)logEvent(state.events.shift());}
function status(){logEvent('GAME='+state.mode+' score='+lcdScore(state)+' miss='+lcdMiss(state));}
function swipe(e){
  if(state.mode==='a'){if(e.dir==='left')lcdMoveChef(state,-1);else if(e.dir==='right')lcdMoveChef(state,1);}
  else{if(e.dir==='up')lcdMoveLane(state,-1);else if(e.dir==='down')lcdMoveLane(state,1);}
  drain();sync();
}
function tap(e){var g=lcdActive(state);
  if(e.y>=344){lcdSwitchMode(state);drain();sync();return;} /* MODE button zone (r202: inside round safe row) */
  if(g.over){lcdReset(state);drain();sync();return;}
  if(state.mode==='a')lcdMoveChef(state,e.x<IW/2?-1:1);else lcdMoveLane(state,e.y<IH/2?-1:1);drain();sync();}
lume.gesture.on(root,'swipe',swipe);lume.gesture.on(root,'tap',tap);
function tick(){var t0=Date.now(),wasOver=lcdActive(state).over;lcdStep(state);drain();
  updateSignals();
  if(state.tick%10===0)status();
  if(!wasOver)frame.set(frame()+1);
  perfSample(Date.now()-t0);
}
var pc=0,ps=0,pm=0;
function perfSample(dt){pc++;ps+=dt;pm=Math.max(pm,dt);if(pc===25){logEvent('PERF js_avg_ms='+(ps/25).toFixed(2)+' js_max_ms='+pm);pc=0;ps=0;pm=0;}}
lume.app.onPause(function(){});lume.app.onResume(function(){frame.set(frame()+1);});
var timer=lume.system.setInterval(tick,100);
updateSignals();status();frame.set(frame()+1);
