/* Memory Match - r75, r68 retro pixel dialect, original art. 4x4 = 8 pairs.
 * Hard-edge fillRect on integer pixels (no AA); every card face is a
 * precomputed run-length span list decoded ONCE at eval and replayed every
 * frame (the mario/sokoban pattern); spanBuilds is a stable count never
 * touched by tick or onDraw. Tap to flip, matching pair stays revealed,
 * mismatch flips back after a short delay (teleport + highlight, no tween -
 * the r68 simplification). Stock 14px Montserrat, no font swap. NVS keys cap
 * at 15 chars (lume_kv.c), so the hiscore key is 'hisc.memory' (11 chars).
 * UI text is ASCII only (firmware font has no decorative Unicode - r64). */

/* ------------------- logic (host harness splits at GAME UI marker) ------ */
/* r210: 4x4 board + HUD + DEAL all fit the 480-round 329px safe square
 * ([75,405]); the old CELL=88/GAP=8 board (GX=64..440, GY=44..420) and the
 * y=424 DEAL row sat outside it and were unclickable near the bezel. */
var IW=480, IH=480, CELL=52, GAP=4, COLS=4, ROWS=4, GX=130, GY=132;
var BG='#141018', FACE_COL='#F2E7C9';
var PAL={
  A:'#D94F3D', B:'#A33428', C:'#7A1F17', /* berry */
  D:'#F5C542', E:'#D9A21B',              /* sun */
  F:'#9FD8F0', G:'#5B9BC4', H:'#2A4A66', /* cloud */
  J:'#7A8F4E', K:'#4C5E33', L:'#3A7A4E', /* leaf */
  M:'#D94F9E', N:'#A3346E',              /* heart */
  P:'#7A5BC4', Q:'#4C338F',              /* star */
  R:'#E8D46A', S:'#8A6A14',              /* bolt */
  T:'#C9BC96', U:'#28331F',              /* card back face / lattice */
  W:'#1A141E'                            /* removed slot */
};

/* 8x8 tile templates scaled x10 to fill an 80px inner area. '.' transparent. */
var FACES={
  berry:['.AAAA...','AABAAA..','CCAAAA..','AAAAAA..','.ABAB...','AABAA...','.ABAB...','CCAAAC..'],
  sun:['...DD...','D.EEE.D.','..EEE...','DEEFEED.','..EEE...','D.EEE.D.','...DD...','........'],
  cloud:['........','..FFF...','.FFFFFF.','GFFGGFF.','HHHHHHH.','HHHHHHH.','........','........'],
  leaf:['..JJ....','.JJJJJ..','JKJJJJ..','JJJKJJ..','.JJJKJ..','..JJKJ..','...L....','...L....'],
  heart:['.MM.MM..','MMMMMMM.','MNNMMNM.','MMMMMMM.','.NMMMN..','..NMN...','...N....','........'],
  star:['...RR...','..PPPP..','PPPPPPP.','RPPQPPP.','..PQP...','.PPQPP..','.PP.PP..','.P...P..'],
  bolt:['....RR..','...RR...','..RRR...','.RRRR...','...RR...','..RR....','.RR.....','RR......'],
  ring:['........','..QQQ...','.Q...Q..','Q..S..Q.','Q.....Q.','.Q...Q..','..QQQ...','........']
};

/* Precompute spans once at eval; spanBuilds counts sprite keys (stable). */
var SPANS={}, spanBuilds=0;
(function(){for(var k in FACES){spanBuilds++;var rows=FACES[k],out=[];
  for(var y=0;y<rows.length;y++){var line=rows[y],x=0;
    while(x<line.length){var ink=line.charAt(x),st=x;
      while(x<line.length&&line.charAt(x)===ink)x++;
      if(ink!=='.')out.push([st,y,x-st,ink]);}}
  SPANS[k]=out;}})();

/* Seeded shuffle (injectable rnd for tests): Fisher-Yates, rnd() in [0,1). */
function memoryShuffle(items,rnd){var a=items.slice();
  for(var i=a.length-1;i>0;i--){var j=Math.floor((rnd?rnd():Math.random())*(i+1));
    var t=a[i];a[i]=a[j];a[j]=t;}
  return a;}

/* Model. deck[c] = face index 0..7, or -1 once that pair is matched away.
 * open[] holds currently face-up cards (len 0..2). After a miss the pair
 * stays in open[] with flipTimer counting down; memoryTick clears it. */
function memoryDeal(rnd){var faces=[];for(var i=0;i<8;i++){faces.push(i);faces.push(i);}
  var deck=memoryShuffle(faces,rnd);
  return {deck:deck,open:[],moves:0,matched:0,won:false,
          events:[],flipTimer:0,lastResult:''};}

function memoryEmit(s,msg){s.events.push(msg);}

/* Tap on cell c (0..15). Returns 'flip'|'match'|'miss'|'ignore'|'done'. */
function memoryTap(s,c){
  if(s.won)return 'done';
  if(typeof c!=='number'||c<0||c>15)return 'ignore';
  if(s.deck[c]<0)return 'ignore';               /* already matched away */
  if(s.open.indexOf(c)>=0)return 'ignore';      /* already face up */
  if(s.open.length>=2)return 'ignore';          /* pair still showing */
  s.open.push(c);
  if(s.open.length===1){memoryEmit(s,'open c='+c+' f='+s.deck[c]);return 'flip';}
  s.moves++;
  var a=s.open[0],b=s.open[1];
  if(s.deck[a]===s.deck[b]){
    s.deck[a]=-1;s.deck[b]=-1;s.open=[];s.matched++;s.lastResult='match';
    memoryEmit(s,'match f='+a+' deck='+s.deck[a]+' moves='+s.moves);
    if(s.matched===8){s.won=true;
      var best=memoryBest();
      if(best===0||s.moves<best)memorySave(s.moves);
      memoryEmit(s,'WIN moves='+s.moves+' best='+memoryBest());
    }
    return 'match';
  }
  s.flipTimer=2;s.lastResult='miss';           /* 2 ticks before flip back */
  memoryEmit(s,'miss f1='+s.deck[a]+' f2='+s.deck[b]+' moves='+s.moves);
  return 'miss';
}

/* Count down the miss flip-back timer. Returns true when the board must be
 * repainted (the pair just flipped back down). */
function memoryTick(s){
  if(s.flipTimer>0){s.flipTimer--;
    if(s.flipTimer===0){s.open=[];memoryEmit(s,'flipback');return true;}
    return false;}
  return false;
}

/* Best (fewest) moves across sessions; NVS key capped at 15 chars. */
function memoryBest(){try{var n=lume.storage.kv.get('hisc.memory');
  return typeof n==='number'&&n>0?n:0;}catch(e){return 0;}}
function memorySave(m){try{lume.storage.kv.set('hisc.memory',m);}catch(e){/* volatile best still works */}return m;}

/* ------------------------------ GAME UI ------------------------------ */
var state=memoryDeal(null);
var frame=signal(0),movesSig=signal(0),matchedSig=signal(0),bestSig=signal(0),wonSig=signal(false),noteSig=signal('TAP TWO CARDS');
var root=View({style:{width:IW,height:IH,background:BG,scroll:'none'}});
function logEvent(msg){lume.log('MEM '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.x+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
/* 8x8 face templates scaled down with the cell (r210: TS=5 @ CELL=52) so the
 * sprite stays inside its card instead of spilling past the safe square. */
var TS=Math.floor((CELL-8)/8);
function drawSprite(ctx,key,cx,cy,a){var list=SPANS[key],off=Math.floor((CELL-TS*8)/2);
  for(var i=0;i<list.length;i++){var sp=list[i];drawRect(ctx,PAL[sp[3]],box(cx+off+sp[0]*TS,cy+off+sp[1]*TS,sp[2]*TS,TS),a);}}

/* Card back: parchment face + dark border + diagonal lattice, original art. */
function drawBack(ctx,cx,cy,a){
  drawRect(ctx,PAL.U,box(cx,cy,CELL,CELL),a);
  drawRect(ctx,PAL.T,box(cx+4,cy+4,CELL-8,CELL-8),a);
  for(var i=1;i<8;i++){
    drawRect(ctx,PAL.U,box(cx+4+i*TS,cy+4,4,4),a);
    drawRect(ctx,PAL.U,box(cx+4,cy+4+i*TS,4,4),a);
  }
}

function paintCard(ctx,c,a,s){
  var cx=GX+(c%COLS)*(CELL+GAP),cy=GY+Math.floor(c/COLS)*(CELL+GAP);
  var faceIdx=s.deck[c];
  if(faceIdx<0){drawRect(ctx,PAL.W,box(cx,cy,CELL,CELL),a);return;}
  var isOpen=(s.open.indexOf(c)>=0);
  if(!isOpen){drawBack(ctx,cx,cy,a);return;}
  var keys=['berry','sun','cloud','leaf','heart','star','bolt','ring'];
  drawRect(ctx,FACE_COL,box(cx,cy,CELL,CELL),a);
  drawSprite(ctx,keys[faceIdx],cx,cy,a);
}

var painted=false,perfCount=0,perfSum=0,perfMax=0;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();var s=state;
  var a=!painted?box(0,0,IW,IH):clip(box(GX,GY,COLS*(CELL+GAP)-GAP,ROWS*(CELL+GAP)-GAP));
  if(!a)return undefined;
  ctx.fillColor(BG);ctx.fillRect(a.x,a.y,a.w,a.h);
  for(var c=0;c<16;c++)paintCard(ctx,c,a,s);
  painted=true;return [a];
}});

/* r210: HUD folded from four full-bleed lines (x=8, y=6/26/46) into three
 * lines inside the 480-round safe square ([75,405]). BEST merges into the
 * MV/PAIRS line (no second BEST line = no redundant status). */
Text({parent:root,text:'MEMORY',style:{position:'absolute',x:80,y:76,fontSize:14,color:'#F2E7C9'}});
Text({parent:root,text:function(){return 'MV '+movesSig()+'  PAIRS '+matchedSig()+'/8  BEST '+(bestSig()>0?bestSig():'-');},style:{position:'absolute',x:80,y:94,fontSize:14,color:'#D9A21B'}});

/* Status line: WIN shows moves + best; otherwise the hint note. */
Text({parent:root,text:function(){
  if(wonSig())return 'CLEARED IN '+movesSig()+' MOVES! TAP DEAL';
  return noteSig()||'TAP TWO CARDS';
},style:{position:'absolute',x:80,y:112,fontSize:14,color:'#9FD8F0'}});

/* r210: DEAL moved from y=424..468 to y=356..404 (48px tall, in safe square). */
function btn(title,x,fn){return Button({title:title,style:{position:'absolute',x:x,y:356,width:144,height:48,borderRadius:6,background:'#28331F',color:'#E8D46A',fontSize:14},onPress:fn});}
btn('DEAL',168,function(){newDeal();});

function newDeal(){
  state=memoryDeal(null);
  movesSig.set(0);matchedSig.set(0);wonSig.set(false);
  noteSig.set('TAP TWO CARDS');bestSig.set(memoryBest());
  painted=false;                    /* next frame is a full repaint */
  frame.set(frame()+1);
}

/* Map a tap to a card cell, rejecting taps inside the 8px gap. */
function cellAt(e){
  var cx=(e.x-GX)/(CELL+GAP),cy=(e.y-GY)/(CELL+GAP);
  if(cx<0||cy<0||cx>=COLS||cy>=ROWS)return -1;
  var fx=cx-Math.floor(cx),fy=cy-Math.floor(cy);
  if(fx>CELL/(CELL+GAP)||fy>CELL/(CELL+GAP))return -1;
  return Math.floor(cy)*COLS+Math.floor(cx);
}

function tap(e){var c=cellAt(e);if(c<0)return;
  var r=memoryTap(state,c);
  if(r==='match'||r==='miss'){movesSig.set(state.moves);matchedSig.set(state.matched);}
  if(r==='flip'||r==='match')frame.set(frame()+1);
  /* miss: both faces stay up until the flipback tick triggers the repaint */
  while(state.events.length)logEvent(state.events.shift());
}

lume.gesture.on(root,'tap',tap);

function tick(){var t0=Date.now();
  if(memoryTick(state)){          /* pair flipped back down: repaint */
    frame.set(frame()+1);
    if(!state.won)noteSig.set('TAP TWO CARDS');
  }
  perfCount++;perfSum+=Date.now()-t0;perfMax=Math.max(perfMax,Date.now()-t0);
  if(perfCount===25){logEvent('PERF js_avg_ms='+(perfSum/25).toFixed(2)+' js_max_ms='+perfMax);perfCount=0;perfSum=0;perfMax=0;}
}
lume.app.onPause(function(){});
lume.app.onResume(function(){frame.set(frame()+1);});
var timer=lume.system.setInterval(tick,150);
bestSig.set(memoryBest());
logEvent('deal 16 cards 8 pairs; best='+(bestSig()>0?bestSig():'-'));
frame.set(frame()+1);
