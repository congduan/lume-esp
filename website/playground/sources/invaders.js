/* Arcade-style single-screen shooter -- original pixel approximations.
 * Game Boy/NES-inspired 3-shade low-saturation green palette, hard edges only
 * (fillRect on integer pixels, no AA). Sprites are precomputed run-length spans
 * (the mario pattern): the geometry is decoded ONCE at eval and replayed every
 * frame. The stock 14px Montserrat font is kept (no pixel font swap -- see the
 * r68 entry in docs/KNOWN-SIMPLIFICATIONS.md). No third-party sprite bitmaps
 * or marks are used; the alien silhouettes are original approximations of the
 * classic arcade visual language. */
var IW=480, IH=480, BG='#0F380F';
var PLAY_L=80, PLAY_R=400, UFO_Y=124, BULLET_TOP=120;
var COLS=11, ROWS=5, CELL_W=26, CELL_H=26, FORM_X=98, FORM_Y=142;
var GROUND_Y=396, CANNON_Y=372, CANNON_PX=32, CANNON_H=24;
var PAL={A:'#9BBC0F',B:'#8BAC0F',C:'#306230'};

/* Two animation frames per alien type; 'A'/'B' are two brightness levels,
 * '.' is transparent. These are hand-drawn original silhouettes. */
var SPRITES={
  smallA:['..A..A..','...AA...','..AAAA..','.A.AA.A.','A..AA..A'],
  smallB:['..A..A..','...AA...','..AAAA..','.A.AA.A.','..A..A..'],
  medA:['...A...A...','....AAA....','...AAAAA...','..AA.A.AA..','.AAAAAAAAA.','.A.AAAAA.A.','.A.A...A.A.','..AA...AA..'],
  medB:['...A...A...','....AAA....','...AAAAA...','..AA.A.AA..','.AAAAAAAAA.','.A.AAAAA.A.','.A.A...A.A.','.AA.....AA.'],
  largeA:['....A..A....','...AAAAAAAA.','..AAAAAAAAAA','.AA.AAAA.AA.','AAAAAAAAAAAA','A.A.AAAA.A.A','A.A......A.A','..AA....AA..'],
  largeB:['....A..A....','...AAAAAAAA.','..AAAAAAAAAA','.AA.AAAA.AA.','AAAAAAAAAAAA','A.A.AAAA.A.A','A.A......A.A','.AA......AA.'],
  cannon:['.......AA.......','......AAAA......','.....AAAAAA.....','....AAAAAAAA....','...AAAAAAAAAA...','..AAAAAAAAAAAA..'],
  ufo:['....AAAAAAAA....','..AAAAAAAAAAAA..','.A.A.A.A.A.A.A.A','.AA..AA..AA..AA.','....AA....AA....']
};
/* Precompute once. spanBuilds is a stable count of sprite keys, never touched
 * by tick or onDraw -- the harness asserts it does not grow per frame. */
var SPANS={}, spanBuilds=0;
for(var sk in SPRITES){spanBuilds++;var rows=SPRITES[sk],out=[];for(var yy=0;yy<rows.length;yy++){var line=rows[yy],xx=0;while(xx<line.length){var ink=line.charAt(xx),st=xx;while(xx<line.length&&line.charAt(xx)===ink)xx++;if(ink!=='.')out.push([st,yy,xx-st,ink]);}}SPANS[sk]=out;}
function spriteDim(type){return type==='small'?{w:8,h:5}:(type==='medium'?{w:11,h:8}:{w:12,h:8});}
/* NVS keys cap at 15 chars (lume_kv.c): 'hiscore.invaders' is 16 and is
 * rejected on hardware, so the short 'hisc.' prefix keeps the full game name. */
function gameHigh(name){try{var n=lume.storage.kv.get('hisc.'+name);return typeof n==='number'&&n>0?n:0;}catch(e){return 0;}}
function gameSave(name,score,previous){if(score<=previous)return previous;try{lume.storage.kv.set('hisc.'+name,score);}catch(e){/* volatile score still works */}return score;}

function invaderMembers(){var m=[];for(var r=0;r<ROWS;r++){var type=r===0?'small':(r<4?'medium':'large');for(var c=0;c<COLS;c++)m.push({c:c,r:r,type:type,alive:true});}return m;}
function invaderState(){return {members:invaderMembers(),fx:FORM_X,fy:FORM_Y,fdir:1,movePx:2,descents:0,cannonX:IW/2-CANNON_PX/2,bullet:null,enemyBullets:[],ufo:null,ufoTimer:0,score:0,lives:3,wave:1,tick:0,frame:0,aliveCount:COLS*ROWS,over:false,paused:false,events:[]};}
function invaderEmit(s,msg){s.events.push(msg);}
function invaderBox(m,fx,fy){var d=spriteDim(m.type);return {x:fx+m.c*CELL_W,y:fy+m.r*CELL_H,w:d.w*2,h:d.h*2};}
function invaderFormationBox(s,fx,fy,alive){var minX=IW,minY=IH,maxX=0,maxY=0,found=false;for(var i=0;i<s.members.length;i++){if(alive&&!alive[i])continue;var m=s.members[i];if(!m.alive)continue;var b=invaderBox(m,fx,fy);if(b.x<minX)minX=b.x;if(b.y<minY)minY=b.y;if(b.x+b.w>maxX)maxX=b.x+b.w;if(b.y+b.h>maxY)maxY=b.y+b.h;found=true;}return found?{x:minX,y:minY,w:maxX-minX,h:maxY-minY}:null;}
function invaderHit(s,b){for(var i=0;i<s.members.length;i++){var m=s.members[i];if(!m.alive)continue;var o=invaderBox(m,s.fx,s.fy);if(b.x>=o.x&&b.x<=o.x+o.w&&b.y>=o.y&&b.y<=o.y+o.h){m.alive=false;s.aliveCount--;s.score+=m.type==='small'?30:(m.type==='medium'?20:10);return true;}}return false;}
function invaderPlayerHit(s){s.lives--;s.enemyBullets=[];invaderEmit(s,'HIT lives='+s.lives);if(s.lives<=0){s.over=true;invaderEmit(s,'OVER score='+s.score);}}
function invaderNextWave(s){s.wave++;s.members=invaderMembers();s.aliveCount=COLS*ROWS;s.fx=FORM_X;s.fy=FORM_Y;s.fdir=1;s.movePx=Math.min(5,s.movePx+1);s.bullet=null;s.enemyBullets=[];s.ufo=null;s.ufoTimer=0;s.descents=0;invaderEmit(s,'WAVE'+s.wave+' alive='+s.aliveCount+' score='+s.score);}
function invaderShoot(s){if(s.over||s.paused||s.bullet)return false;s.bullet={x:s.cannonX+CANNON_PX/2-2,y:CANNON_Y-8};return true;}
function invaderRestart(s){var n=invaderState();for(var k in n)s[k]=n[k];invaderEmit(s,'WAVE1 alive='+s.aliveCount+' score=0');}
function invaderPeriod(wave){return Math.max(20,60-(wave-1)*8);}

function invaderStep(s,rnd){
  if(s.over||s.paused)return 'idle';
  s.tick++;s.frame^=1;var ev='move';
  s.fx+=s.fdir*s.movePx;
  var right=s.fx+(COLS-1)*CELL_W+24,left=s.fx;
  if(right>PLAY_R&&s.fdir>0){s.fdir=-1;s.fx=PLAY_R-((COLS-1)*CELL_W+24);s.fy+=CELL_H;s.descents++;ev='descend';invaderEmit(s,'DESCEND row='+s.descents);}
  else if(left<PLAY_L&&s.fdir<0){s.fdir=1;s.fx=PLAY_L;s.fy+=CELL_H;s.descents++;ev='descend';invaderEmit(s,'DESCEND row='+s.descents);}
  if(s.fy+(ROWS-1)*CELL_H+16>GROUND_Y-20){s.over=true;ev='over';invaderEmit(s,'OVER score='+s.score);}
  if(s.bullet){s.bullet.y-=7;
    if(s.bullet.y<BULLET_TOP)s.bullet=null;
    else if(invaderHit(s,s.bullet)){s.bullet=null;ev='kill';invaderEmit(s,'WAVE'+s.wave+' alive='+s.aliveCount+' score='+s.score);if(!s.aliveCount){invaderNextWave(s);ev='wave';}}
  }
  if(s.aliveCount&&rnd()<0.05){var pool=[];for(var i=0;i<s.members.length;i++)if(s.members[i].alive)pool.push(s.members[i]);var m=pool[Math.floor(rnd()*pool.length)];var mb=invaderBox(m,s.fx,s.fy);s.enemyBullets.push({x:mb.x+mb.w/2-2,y:mb.y+mb.h});}
  for(var j=s.enemyBullets.length-1;j>=0;j--){var eb=s.enemyBullets[j];eb.y+=4;
    if(eb.y>GROUND_Y){s.enemyBullets.splice(j,1);continue;}
    if(eb.x>=s.cannonX&&eb.x<=s.cannonX+CANNON_PX&&eb.y>=CANNON_Y&&eb.y<=CANNON_Y+CANNON_H){s.enemyBullets.splice(j,1);invaderPlayerHit(s);ev='hit';}
  }
  if(!s.ufo){s.ufoTimer++;if(s.ufoTimer>160){s.ufo={x:PLAY_L,y:UFO_Y};s.ufoTimer=0;}}
  else{s.ufo.x+=3;if(s.ufo.x+32>PLAY_R)s.ufo=null;else if(s.bullet&&s.bullet.x>=s.ufo.x&&s.bullet.x<=s.ufo.x+32&&s.bullet.y>=s.ufo.y&&s.bullet.y<=s.ufo.y+10){s.score+=100;s.bullet=null;s.ufo=null;invaderEmit(s,'UFO +100 score='+s.score);}}
  return ev;
}

/* GAME UI */
var state=invaderState();
var frame=signal(0),scoreSig=signal(0),bestSig=signal(gameHigh('invaders')),livesSig=signal(3),waveSig=signal(1),noteSig=signal('PAN MOVE   TAP FIRE   SWIPE UP PAUSE');
var root=View({style:{width:IW,height:IH,background:BG,scroll:'none'}});
function logEvent(msg){lume.log('INVADER '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function pad(r,n){return box(r.x-n,r.y-n,r.w+2*n,r.h+2*n);}
function union(a,b){if(!a)return b;if(!b)return a;var x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return box(x,y,Math.max(a.x+a.w,b.x+b.w)-x,Math.max(a.y+a.h,b.y+b.h)-y);}
function intersects(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.y+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
function hex565(hex){var v=parseInt(hex.slice(1),16);return ((((v>>16)&255)>>3)<<11)|((((v>>8)&255)>>2)<<5)|((v&255)>>3);}
var SLOT={},PIXELS={},spritesUploaded=false;
(function(){var keys=['smallA','smallB','medA','medB','largeA','largeB','cannon','ufo'];
  for(var i=0;i<keys.length;i++){var k=keys[i],rows=SPRITES[k],rw=rows[0].length,rh=rows.length,w=rw*2,h=rh*2,px=new Uint16Array(w*h),list=SPANS[k];
    for(var j=0;j<list.length;j++){var s=list[j],c=hex565(PAL[s[3]]);
      for(var dy=0;dy<2;dy++){var yy=s[1]*2+dy;for(var dx=0;dx<s[2]*2;dx++)px[yy*w+s[0]*2+dx]=c;}
    }
    SLOT[k]=i+1;PIXELS[k]={w:w,h:h,px:px};
  }
})();
function ensureSprites(ctx){if(spritesUploaded)return;for(var k in SLOT){var p=PIXELS[k];ctx.retainImage(SLOT[k],p.w,p.h,p.px);}spritesUploaded=true;}
function drawSprite(ctx,key,x,y,a){var ix=Math.floor(x),iy=Math.floor(y),p=PIXELS[key];if(ix+p.w<=0||ix>=IW||iy+p.h<=0||iy>=IH)return;ctx.drawImage(SLOT[key],ix,iy,0);}
function drawStatic(ctx,a){ctx.fillColor(BG);ctx.fillRect(a.x,a.y,a.w,a.h);drawRect(ctx,PAL.C,box(PLAY_L,GROUND_Y,PLAY_R-PLAY_L,2),a);}
function bulletBBox(list){if(!list||!list.length)return null;var minX=IW,minY=IH,maxX=0,maxY=0;for(var i=0;i<list.length;i++){var e=list[i];if(e.x<minX)minX=e.x;if(e.y<minY)minY=e.y;if(e.x+4>maxX)maxX=e.x+4;if(e.y+8>maxY)maxY=e.y+8;}return box(minX,minY,maxX-minX,maxY-minY);}

var prevFx=null,prevFy=null,prevCannonX=null,prevAlive=null,prevBullet=null,prevEnemy=[],prevUfo=null;
var dirtyPixels=0,dirtyMax=0,perfCount=0,perfSum=0,perfMax=0,painted=false;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();ensureSprites(ctx);var s=state,areas=[];
  if(!painted){areas.push(box(0,0,IW,IH));}
  else{
    var fb=invaderFormationBox(s,s.fx,s.fy,null);
    var ofb=prevFx!==null?invaderFormationBox(s,prevFx,prevFy,prevAlive):null;
    var f=union(fb,ofb);if(f)areas.push(clip(pad(f,2)));
    var cb=box(s.cannonX,CANNON_Y,CANNON_PX,CANNON_H),ocb=prevCannonX!==null?box(prevCannonX,CANNON_Y,CANNON_PX,CANNON_H):null;
    var c=union(cb,ocb);if(c)areas.push(clip(pad(c,2)));
    var b=s.bullet?box(s.bullet.x,s.bullet.y,4,8):null,ob=prevBullet?box(prevBullet.x,prevBullet.y,4,8):null;
    var bu=union(b,ob);if(bu)areas.push(clip(pad(bu,2)));
    var eu=union(bulletBBox(s.enemyBullets),bulletBBox(prevEnemy));if(eu)areas.push(clip(pad(eu,2)));
    var ub=s.ufo?box(s.ufo.x,s.ufo.y,32,10):null,oub=prevUfo?box(prevUfo.x,prevUfo.y,32,10):null;
    var uu=union(ub,oub);if(uu)areas.push(clip(pad(uu,2)));
  }
  var cb=box(s.cannonX,CANNON_Y,CANNON_PX,CANNON_H);
  var ub=s.ufo?box(s.ufo.x,s.ufo.y,32,10):null;
  var valid=[];for(var i=0;i<areas.length;i++){var a=areas[i];if(!a)continue;
    drawStatic(ctx,a);
    for(var j=0;j<s.members.length;j++){var m=s.members[j];if(!m.alive)continue;var mb=invaderBox(m,s.fx,s.fy);if(!intersects(mb,a))continue;var key=(m.type==='small'?'small':m.type==='medium'?'med':'large')+(s.frame?'A':'B');drawSprite(ctx,key,mb.x,mb.y,a);}
    if(intersects(cb,a))drawSprite(ctx,'cannon',cb.x,cb.y,a);
    if(s.bullet){var bb=box(s.bullet.x,s.bullet.y,4,8);if(intersects(bb,a))drawRect(ctx,PAL.A,bb,a);}
    for(j=0;j<s.enemyBullets.length;j++){var ebr=box(s.enemyBullets[j].x,s.enemyBullets[j].y,4,8);if(intersects(ebr,a))drawRect(ctx,PAL.B,ebr,a);}
    if(s.ufo&&ub&&intersects(ub,a))drawSprite(ctx,'ufo',s.ufo.x,s.ufo.y,a);
    valid.push(a);
  }
  dirtyPixels=0;for(i=0;i<valid.length;i++)dirtyPixels+=valid[i].w*valid[i].h;dirtyMax=Math.max(dirtyMax,dirtyPixels);
  prevFx=s.fx;prevFy=s.fy;prevCannonX=s.cannonX;prevAlive=s.members.map(function(m){return m.alive;});
  prevBullet=s.bullet?{x:s.bullet.x,y:s.bullet.y}:null;
  prevEnemy=s.enemyBullets.map(function(e){return {x:e.x,y:e.y};});
  prevUfo=s.ufo?{x:s.ufo.x,y:s.ufo.y}:null;
  painted=true;
  return valid.length?valid:undefined;
}});
/* r202/r216: HUD/hint and playfield (formation, UFO, cannon, ground) all sit
   inside the 480-round safe square ([80..400, 80..398]). */
Text({parent:root,text:'INVADERS',style:{position:'absolute',x:84,y:80,fontSize:14,color:'#40D8B0',borderRadius:0}});
Text({parent:root,text:function(){return 'S '+scoreSig()+'  HI '+bestSig()+'  L '+livesSig()+'  W'+waveSig();},style:{position:'absolute',x:224,y:80,width:172,fontSize:14,color:'#9EB3C6',textAlign:'right',borderRadius:0}});
Text({parent:root,text:function(){return noteSig();},style:{position:'absolute',x:84,y:104,width:312,fontSize:13,color:'#FFD78E',borderRadius:0}});

function updateSignals(){scoreSig.set(state.score);bestSig.set(gameSave('invaders',state.score,bestSig()));livesSig.set(state.lives);waveSig.set(state.wave);}
function start(){if(timer===null&&!state.over&&!state.paused)timer=lume.system.setInterval(tick,period);}
function stop(){if(timer!==null)lume.system.clearInterval(timer);timer=null;}
function tick(){if(state.over||state.paused)return;var t0=Date.now();var ev=invaderStep(state,Math.random);
  if(ev==='idle')return;
  while(state.events.length)logEvent(state.events.shift());
  if(ev==='kill'||ev==='wave'||ev==='hit'||ev==='over'||ev==='ufo')updateSignals();
  if(ev==='wave'){period=invaderPeriod(state.wave);stop();start();}
  if(ev==='over'){noteSig.set('GAME OVER - TAP / SWIPE UP');stop();}
  frame.set(frame()+1);
  var dt=Date.now()-t0;perfCount++;perfSum+=dt;perfMax=Math.max(perfMax,dt);
  if(perfCount===25){logEvent('PERF js_avg_ms='+(perfSum/25).toFixed(2)+' js_max_ms='+perfMax+' dirty_max_px='+dirtyMax);perfCount=0;perfSum=0;perfMax=0;dirtyMax=0;}
}
function restart(){invaderRestart(state);while(state.events.length)logEvent(state.events.shift());updateSignals();noteSig.set('PAN MOVE   TAP FIRE   SWIPE UP PAUSE');period=invaderPeriod(state.wave);prevFx=null;prevAlive=null;painted=false;start();frame.set(frame()+1);}
function moveCannon(e){if(state.over)return;state.cannonX=Math.max(PLAY_L,Math.min(PLAY_R-CANNON_PX,e.x-CANNON_PX/2));frame.set(frame()+1);}
function shoot(){if(state.over){restart();return;}if(invaderShoot(state))frame.set(frame()+1);}
function swipe(e){if(e.dir!=='up'||Math.abs(e.dy)<50)return;if(state.over){restart();return;}state.paused=!state.paused;noteSig.set(state.paused?'PAUSED - SWIPE UP':'PAN MOVE   TAP FIRE   SWIPE UP PAUSE');if(state.paused)stop();else start();}
lume.gesture.on(root,'panstart',moveCannon);lume.gesture.on(root,'pan',moveCannon);
lume.gesture.on(root,'tap',shoot);lume.gesture.on(root,'swipe',swipe);
lume.app.onPause(stop);lume.app.onResume(start);
var timer=null,period=invaderPeriod(1);
updateSignals();logEvent('WAVE1 alive='+state.aliveCount+' score=0');start();
