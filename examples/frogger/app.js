/* Arcade-style road-and-river crossing game — original pixel approximations.
 * NES-inspired muted palette on a gray-blue base: desaturated red/yellow/blue
 * vehicle blocks, brown logs, green lily pads, a two-tone green frog. Hard-edge
 * fillRect only (no AA). All sprites are precomputed run-length spans (mario
 * pattern), decoded once at eval and replayed every frame. Each scrolling lane
 * owns an independent dirty rect. The stock 14px Montserrat font is kept (no
 * pixel font swap — see the r68 entry in docs/KNOWN-SIMPLIFICATIONS.md). No
 * third-party sprite bitmaps or marks are used. */
var IW=480, IH=480, CELL=33, COLS=13, ROWS=13, GX=25, GY=44;
var HOME_COLS=[1,3,5,7,9];
var PAL={
  A:'#9BD96A',B:'#4E8C3A',R:'#C85A5A',Y:'#D6B25E',U:'#6E92C8',
  L:'#A68056',M:'#6B4E32',K:'#5EA86A',W:'#E8E8F0'
};
var BAND={
  home:'#263726',river:'#1B3A52',median:'#2C4634',road:'#3A3A4E',safe:'#2A2A38'
};

/* Original silhouettes. 'A' in a template is replaced by a body colour so the
 * car/truck shapes are shared but liveries differ. '.' is transparent. */
var FROG=[
  '.AA......AA.','.AAAAAAAAAA.','AAWAAAAAAWAA','AAAAAAAAAAAA',
  '.AAAAAAAAAA.','..AAAAAAAA..','.AAAAAAAAAA.','AA........AA',
  'A..........A','.AA......AA.','..AA....AA..','...A....A...'
];
var CAR_TPL=[
  '....AAAAAAAAAA....','..AAAAAAAAAAAAAA..','.AAAWWWWAAWWWWAAA.',
  'AAAAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAA','.AAAAAAAAAAAAAAAA.',
  '..AA..........AA..','.A..............A.'
];
var TRUCK_TPL=[
  '......AAAAAAAAAAAAAAAAAA......','....AAAAAAAAAAAAAAAAAAAAAA....',
  '..AAAAAAAAAAAAAAAAAAAAAAAAAA..','.AAAAAAAAAAAAAAAAAAAAAAAAAAAA.',
  '.AAAWWWWWWWWWWWWWWWWWWWWWWAAA.','.AAAAAAAAAAAAAAAAAAAAAAAAAAAA.',
  '..AA......................AA..','.A..........................A.'
];
var LOG=[
  'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL','LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM','LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM'
];
var LILY=[
  '....KKKKKKKK....','..KKKKKKKKKKKK..','.KKKKKKKKKKKKKK.',
  'KKKKKKKKKKKKKKKK','KKKKKKKKKKKKKKKK','.KKKKKKKKKKKKKK.',
  '..KKKKKKKKKKKK..'
];
function tint(rows,ch){var out=[];for(var i=0;i<rows.length;i++)out.push(rows[i].replace(/A/g,ch));return out;}
var SPRITES={
  frog:FROG,carR:tint(CAR_TPL,'R'),carY:tint(CAR_TPL,'Y'),carU:tint(CAR_TPL,'U'),
  truckR:tint(TRUCK_TPL,'R'),truckU:tint(TRUCK_TPL,'U'),log:LOG,lily:LILY
};
/* Precompute once. spanBuilds is a stable count of sprite keys, never touched
 * by tick or onDraw — the harness asserts it does not grow per frame. */
var SPANS={},spanBuilds=0;
for(var sk in SPRITES){spanBuilds++;var rows=SPRITES[sk],out=[];for(var yy=0;yy<rows.length;yy++){var line=rows[yy],xx=0;while(xx<line.length){var ink=line.charAt(xx),st=xx;while(xx<line.length&&line.charAt(xx)===ink)xx++;if(ink!=='.')out.push([st,yy,xx-st,ink]);}}SPANS[sk]=out;}
/* NVS keys cap at 15 chars (lume_kv.c): 'hiscore.frogger' is 15 but a short
 * 'hisc.' prefix keeps the key convention identical to the other games. */
function gameHigh(name){try{var n=lume.storage.kv.get('hisc.'+name);return typeof n==='number'&&n>0?n:0;}catch(e){return 0;}}
function gameSave(name,score,previous){if(score<=previous)return previous;try{lume.storage.kv.set('hisc.'+name,score);}catch(e){/* volatile score still works */}return score;}

function resetFrog(f){f.row=12;f.col=6;f.ox=0;f.highlight=0;}
function froggerLanes(){
  var defs=[
    {row:1,kind:'river',sprite:'log',w:68,dir:-1,speed:1.3,count:4},
    {row:2,kind:'river',sprite:'lily',w:32,dir:1,speed:1.8,count:5},
    {row:3,kind:'river',sprite:'log',w:68,dir:1,speed:1.1,count:4},
    {row:4,kind:'river',sprite:'lily',w:32,dir:-1,speed:2.0,count:5},
    {row:6,kind:'road',sprite:'carR',w:36,dir:1,speed:1.6,count:4},
    {row:7,kind:'road',sprite:'truckU',w:60,dir:-1,speed:1.2,count:3},
    {row:8,kind:'road',sprite:'carY',w:36,dir:1,speed:2.1,count:4},
    {row:9,kind:'road',sprite:'truckR',w:60,dir:-1,speed:1.5,count:3},
    {row:10,kind:'road',sprite:'carU',w:36,dir:1,speed:1.9,count:4}
  ];
  var lanes=[];for(var i=0;i<defs.length;i++){var d=defs[i],items=[];
    for(var j=0;j<d.count;j++)items.push({x:((j*130+d.row*37)%560)-30});
    lanes.push({row:d.row,kind:d.kind,sprite:d.sprite,w:d.w,dir:d.dir,speed:d.speed,items:items});
  }
  return lanes;
}
function froggerState(){var f={row:12,col:6,ox:0,highlight:0};return {frog:f,homes:[false,false,false,false,false],homeCols:HOME_COLS.slice(),lanes:froggerLanes(),score:0,lives:3,level:1,tick:0,frame:0,state:'alive',over:false,events:[]};}
function froggerEmit(s,msg){s.events.push(msg);}
function froggerBox(f){return {x:GX+f.col*CELL+4+f.ox,y:GY+f.row*CELL+4,w:24,h:24};}
function itemBox(lane,item){return {x:item.x,y:GY+lane.row*CELL+8,w:lane.w,h:16};}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function froggerLaneAt(s,row){for(var i=0;i<s.lanes.length;i++)if(s.lanes[i].row===row)return s.lanes[i];return null;}
function froggerRoadHit(s){var ln=froggerLaneAt(s,s.frog.row);if(!ln||ln.kind!=='road')return false;var fb=froggerBox(s.frog);for(var i=0;i<ln.items.length;i++)if(overlap(fb,itemBox(ln,ln.items[i])))return true;return false;}
function froggerPlatformAt(s){var ln=froggerLaneAt(s,s.frog.row);if(!ln||ln.kind!=='river')return null;var fb=froggerBox(s.frog);for(var i=0;i<ln.items.length;i++)if(overlap(fb,itemBox(ln,ln.items[i])))return ln.items[i];return null;}
function froggerDie(s,reason){s.lives--;s.state='dead';froggerEmit(s,'DEAD '+reason+' lives='+s.lives);if(s.lives<=0){s.over=true;froggerEmit(s,'OVER score='+s.score);}else resetFrog(s.frog);}
function froggerNextLevel(s){s.level++;for(var i=0;i<5;i++)s.homes[i]=false;s.score+=100;froggerEmit(s,'LEVEL'+s.level+' score='+s.score);resetFrog(s.frog);}
function froggerResolve(s){
  var f=s.frog,row=f.row;
  if(row===0){var idx=s.homeCols.indexOf(f.col);
    if(idx>=0&&!s.homes[idx]){s.homes[idx]=true;s.score+=50;s.state='home';froggerEmit(s,'HOME'+idx+' score='+s.score);if(s.homes.every(Boolean))froggerNextLevel(s);else resetFrog(f);return 'home';}
    froggerDie(s,'hedge');return 'dead';}
  if(row>=1&&row<=4){if(!froggerPlatformAt(s)){froggerDie(s,'water');return 'dead';}s.state='alive';return 'alive';}
  if(row>=6&&row<=10){if(froggerRoadHit(s)){froggerDie(s,'car');return 'dead';}s.state='alive';return 'alive';}
  s.state='alive';return 'alive';
}
function froggerHop(s,dx,dy){
  if(s.over)return 'over';var f=s.frog;
  var dir=dy<0?'up':dy>0?'down':dx<0?'left':'right';
  var nr=Math.max(0,Math.min(ROWS-1,f.row+dy)),nc=Math.max(0,Math.min(COLS-1,f.col+dx));
  if(nr===f.row&&nc===f.col){froggerEmit(s,'LANE'+nr+' hop='+dir+' state=blocked');return 'blocked';}
  var row=nr;f.row=nr;f.col=nc;f.ox=0;f.highlight=6;
  var st=froggerResolve(s);
  froggerEmit(s,'LANE'+row+' hop='+dir+' state='+st);
  return st;
}
function froggerStep(s){
  if(s.over)return 'idle';s.tick++;s.frame^=1;
  if(s.frog.highlight>0)s.frog.highlight--;
  var row=s.frog.row,mul=1+(s.level-1)*0.35;
  for(var i=0;i<s.lanes.length;i++){var ln=s.lanes[i],d=ln.dir*ln.speed*mul;
    for(var j=0;j<ln.items.length;j++){var it=ln.items[j];it.x+=d;
      if(ln.dir>0&&it.x>500)it.x=-ln.w-20;
      if(ln.dir<0&&it.x+ln.w<-20)it.x=500;
    }
  }
  var p=froggerPlatformAt(s);
  if(p){var pl=froggerLaneAt(s,s.frog.row);s.frog.ox+=pl.dir*pl.speed*mul;
    if(s.frog.ox>CELL){s.frog.col++;s.frog.ox-=CELL;}
    if(s.frog.ox<-CELL){s.frog.col--;s.frog.ox+=CELL;}
    if(s.frog.col<0||s.frog.col>COLS-1){froggerDie(s,'swept');froggerEmit(s,'LANE'+row+' hop=hold state=dead');return 'dead';}
  }
  var before=s.state,st=froggerResolve(s);
  if(st==='dead'&&before!=='dead')froggerEmit(s,'LANE'+row+' hop=hold state=dead');
  return st;
}
function froggerRestart(s){var n=froggerState();for(var k in n)s[k]=n[k];froggerEmit(s,'LANE12 hop=start state=alive');}
function froggerPeriod(level){return Math.max(20,90-(level-1)*12);}

/* GAME UI */
var state=froggerState();
var frame=signal(0),scoreSig=signal(0),bestSig=signal(gameHigh('frogger')),livesSig=signal(3),levelSig=signal(1),homeSig=signal(0),noteSig=signal('');
var root=View({style:{width:IW,height:IH,background:BAND.safe,scroll:'none'}});
function logEvent(msg){lume.log('FROGGER '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.y+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
function hex565(hex){var v=parseInt(hex.slice(1),16);return ((((v>>16)&255)>>3)<<11)|((((v>>8)&255)>>2)<<5)|((v&255)>>3);}
var SLOT={},PIXELS={},spritesUploaded=false;
(function(){var keys=['frog','carR','carY','carU','truckR','truckU','log','lily'];
  for(var i=0;i<keys.length;i++){var k=keys[i],rows=SPRITES[k],rw=rows[0].length,rh=rows.length,w=rw*2,h=rh*2,px=new Uint16Array(w*h),list=SPANS[k];
    for(var j=0;j<list.length;j++){var s=list[j],c=hex565(PAL[s[3]]);
      for(var dy=0;dy<2;dy++){var yy=s[1]*2+dy;for(var dx=0;dx<s[2]*2;dx++)px[yy*w+s[0]*2+dx]=c;}
    }
    SLOT[k]=i+1;PIXELS[k]={w:w,h:h,px:px};
  }
})();
function ensureSprites(ctx){if(spritesUploaded)return;for(var k in SLOT){var p=PIXELS[k];ctx.retainImage(SLOT[k],p.w,p.h,p.px);}spritesUploaded=true;}
function drawSprite(ctx,key,x,y,a){var ix=Math.floor(x),iy=Math.floor(y),p=PIXELS[key];if(ix+p.w<=GX||ix>=GX+COLS*CELL||iy+p.h<=0||iy>=IH)return;ctx.drawImage(SLOT[key],ix,iy,0);}
function laneBand(row){return row===0?BAND.home:(row>=1&&row<=4?BAND.river:row===5?BAND.median:(row>=6&&row<=10?BAND.road:BAND.safe));}
function laneRect(row){return clip(box(GX-2,GY+row*CELL-2,COLS*CELL+4,CELL+4));}
function paintRow(ctx,row,a,s){
  drawRect(ctx,laneBand(row),box(GX,GY+row*CELL,COLS*CELL,CELL),a);
  if(row===0){
    for(var h=0;h<s.homeCols.length;h++){var hx=GX+s.homeCols[h]*CELL+2,hy=GY+2;
      drawRect(ctx,BAND.median,box(hx,hy,CELL-4,CELL-4),a);
      if(s.homes[h])drawSprite(ctx,'frog',hx+4,hy+4,a);
    }
  }
  var ln=froggerLaneAt(s,row);
  if(ln)for(var i=0;i<ln.items.length;i++){var ib=itemBox(ln,ln.items[i]);if(ib.x<a.x+a.w&&ib.x+ib.w>a.x)drawSprite(ctx,ln.sprite,ib.x,ib.y,a);}
  if(s.frog.row===row){var fb=froggerBox(s.frog);
    drawSprite(ctx,'frog',fb.x,fb.y,a);
    if(s.frog.highlight>0)drawRect(ctx,PAL.W,box(fb.x-2,fb.y-2,28,2),a);
  }
}

var prevFrogRow=null,prevHomes=null,painted=false;
var dirtyPixels=0,dirtyMax=0,perfCount=0,perfSum=0,perfMax=0;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();ensureSprites(ctx);var s=state,rows={};
  if(!painted){for(var r=0;r<ROWS;r++)rows[r]=true;}
  else{
    for(var i=0;i<s.lanes.length;i++)rows[s.lanes[i].row]=true;
    if(prevFrogRow!==null&&prevFrogRow!==s.frog.row)rows[prevFrogRow]=true;
    rows[s.frog.row]=true;
    if(prevHomes){for(var h=0;h<5;h++)if(prevHomes[h]!==s.homes[h])rows[0]=true;}
  }
  /* The bridge accepts at most 8 dirty rects, so contiguous dirty lane rows
   * are merged into band ranges (initial paint = one band; play = 2-4 bands). */
  var list=[];for(var key in rows)list.push(+key);list.sort(function(x,y){return x-y;});
  var ranges=[],start=-1,last=-1;
  for(i=0;i<list.length;i++){if(start<0){start=last=list[i];}
    else if(list[i]===last+1)last=list[i];else{ranges.push([start,last]);start=last=list[i];}}
  if(start>=0)ranges.push([start,last]);
  var first=!painted;
  var valid=[];for(i=0;i<ranges.length;i++){var lo=ranges[i][0],hi=ranges[i][1];
    var a=first?box(0,0,IW,IH):clip(box(GX-2,GY+lo*CELL-2,COLS*CELL+4,(hi-lo+1)*CELL+4));if(!a)continue;
    if(first){ctx.fillColor(BAND.safe);ctx.fillRect(a.x,a.y,a.w,a.h);}
    for(var rr=lo;rr<=hi;rr++)paintRow(ctx,rr,a,s);
    /* Mask left/right playfield margins so unclipped drawImage blits stay crisp. */
    ctx.fillColor(BAND.safe);ctx.fillRect(0,a.y,GX,a.h);ctx.fillRect(GX+COLS*CELL,a.y,IW-(GX+COLS*CELL),a.h);
    valid.push(a);
  }
  dirtyPixels=0;for(i=0;i<valid.length;i++)dirtyPixels+=valid[i].w*valid[i].h;dirtyMax=Math.max(dirtyMax,dirtyPixels);
  prevFrogRow=s.frog.row;prevHomes=s.homes.slice();painted=true;
  return valid.length?valid:undefined;
}});
/* r209: HUD/hint moved into the 480-round safe square ([84,396]) following the
   r202 invaders pattern; the full-bleed canvas, grid (GX/GY/CELL) and hop
   logic are unchanged. HUD draws after the canvas so text stays on top;
   slight overdraw over lane sprites is the accepted r202 trade-off. */
Text({parent:root,text:'FROGGER',style:{position:'absolute',x:84,y:80,fontSize:14,color:'#40D8B0',borderRadius:0}});
Text({parent:root,text:function(){return 'S '+scoreSig()+'  HI '+bestSig()+'  L '+livesSig()+'  LV '+levelSig();},style:{position:'absolute',x:224,y:80,width:172,fontSize:14,color:'#9EB3C6',textAlign:'right',borderRadius:0}});
Text({parent:root,text:function(){return noteSig()||('HOMES '+homeSig()+'/5   TAP AROUND FROG TO HOP');},style:{position:'absolute',x:84,y:104,width:312,fontSize:13,color:'#FFD78E',borderRadius:0}});

function updateSignals(){scoreSig.set(state.score);bestSig.set(gameSave('frogger',state.score,bestSig()));livesSig.set(state.lives);levelSig.set(state.level);homeSig.set(state.homes.filter(Boolean).length);}
function start(){if(timer===null&&!state.over)timer=lume.system.setInterval(tick,period);}
function stop(){if(timer!==null)lume.system.clearInterval(timer);timer=null;}
function tick(){if(state.over)return;var t0=Date.now();var st=froggerStep(state);
  if(st==='idle')return;
  while(state.events.length)logEvent(state.events.shift());
  if(st==='dead'||st==='home')updateSignals();
  if(state.over){noteSig.set('GAME OVER - TAP TO RESTART');stop();}
  frame.set(frame()+1);
  var dt=Date.now()-t0;perfCount++;perfSum+=dt;perfMax=Math.max(perfMax,dt);
  if(perfCount===25){logEvent('PERF js_avg_ms='+(perfSum/25).toFixed(2)+' js_max_ms='+perfMax+' dirty_max_px='+dirtyMax);perfCount=0;perfSum=0;perfMax=0;dirtyMax=0;}
}
function restart(){froggerRestart(state);while(state.events.length)logEvent(state.events.shift());updateSignals();noteSig.set('');period=froggerPeriod(state.level);painted=false;prevFrogRow=null;start();frame.set(frame()+1);}
function hop(e){if(state.over){restart();return;}
  var f=state.frog,fx=GX+f.col*CELL+CELL/2,fy=GY+f.row*CELL+CELL/2;
  var dx=e.x-fx,dy=e.y-fy,ddx=0,ddy=0;
  if(Math.abs(dx)>Math.abs(dy))ddx=dx>0?1:-1;else ddy=dy>0?1:-1;
  var st=froggerHop(state,ddx,ddy);
  while(state.events.length)logEvent(state.events.shift());
  updateSignals();noteSig.set('');frame.set(frame()+1);
}
lume.gesture.on(root,'tap',hop);
lume.app.onPause(stop);lume.app.onResume(start);
var timer=null,period=froggerPeriod(1);
updateSignals();logEvent('LANE12 hop=start state=alive');start();
