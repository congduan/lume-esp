/* Minesweeper — r76, r68 retro pixel dialect, original art. 10x10 grid, 15 mines.
 * Hard-edge fillRect on integer pixels (no AA); digits 1-8, the flag and the
 * mine are 5x7 / 7x7 pixel sprites precomputed into run-length spans decoded
 * ONCE at eval and replayed every frame (the mario/sokoban/memory pattern);
 * spanBuilds is a stable count never touched by tick or onDraw. First tap is
 * always safe: mines are placed AFTER the first dig, excluding the tapped cell
 * and its 8 neighbours. Tap digs (flood fill through zero cells, explicit
 * stack, no recursion), long-press flags. Flagged cells cannot be dug. Hitting
 * a mine reveals the board; digging every safe cell wins. Best (lowest) time
 * goes to lume.storage.kv — NVS keys cap at 15 chars (lume_kv.c), so the key
 * is 'hisc.mine' (9 chars). UI text is ASCII only (firmware font has no
 * decorative Unicode — r64). */

/* ------------------- logic (host harness splits at /* GAME UI *​/) ------- */
var COLS=10, ROWS=10, MINES=15, CELLS=COLS*ROWS;
var PAL={
  '1':'#5B9BC4','2':'#7A8F4E','3':'#D94F3D','4':'#7A5BC4',
  '5':'#D9A21B','6':'#4FB0A1','7':'#C9BC96','8':'#9A94A8',
  F:'#D94F3D',  /* flag banner */
  P:'#C9BC96',  /* flag pole */
  M:'#C9BC96',  /* mine body */
  H:'#F2E7C9'   /* mine highlight */
};

/* 5x7 digit glyphs ('1'..'8' — ink char = its own palette key), 7x7 flag and
 * mine sprites. '.' transparent. */
var SPRITES={
  '1':['.1...','11...','.1...','.1...','.1...','.1...','11111'],
  '2':['22222','....2','....2','22222','2....','2....','22222'],
  '3':['33333','....3','....3','33333','....3','....3','33333'],
  '4':['4...4','4...4','4...4','44444','....4','....4','....4'],
  '5':['55555','5....','5....','55555','....5','....5','55555'],
  '6':['66666','6....','6....','66666','6...6','6...6','66666'],
  '7':['77777','....7','...7.','..7..','.7...','.7...','.7...'],
  '8':['88888','8...8','8...8','88888','8...8','8...8','88888'],
  flag:['FFFF...','FFFFF..','FFFF...','P......','P......','P......','P......'],
  mine:['...M...','.M.M.M.','..MMM..','MMMHMMM','..MMM..','.M.M.M.','...M...']
};

/* Precompute spans once at eval; spanBuilds counts sprite keys (stable). */
var SPANS={}, spanBuilds=0;
(function(){for(var k in SPRITES){spanBuilds++;var rows=SPRITES[k],out=[];
  for(var y=0;y<rows.length;y++){var line=rows[y],x=0;
    while(x<line.length){var ink=line.charAt(x),st=x;
      while(x<line.length&&line.charAt(x)===ink)x++;
      if(ink!=='.')out.push([st,y,x-st,ink]);}}
  SPANS[k]=out;}})();

/* Neighbour indices of cell c (0..99), edges and corners included. */
function mineNeighbors(c){
  var out=[],r=Math.floor(c/COLS),col=c%COLS;
  for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){
    if(dr===0&&dc===0)continue;
    var nr=r+dr,nc=col+dc;
    if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS)out.push(nr*COLS+nc);
  }
  return out;
}

/* Model. mask[c]: 0 hidden, 1 revealed, 2 flagged. mines[]/counts[] are null
 * until the first dig — first tap (and its 8 neighbours) is always safe. */
function mineDeal(){
  var mask=[];
  for(var c=0;c<CELLS;c++)mask.push(0);
  return {mines:null,counts:null,mask:mask,started:false,over:false,won:false,
          time:0,events:[]};
}
function mineEmit(s,msg){s.events.push(msg);}

/* Seeded shuffle (injectable rnd for tests): Fisher-Yates, rnd() in [0,1). */
function mineShuffle(items,rnd){var a=items.slice();
  for(var i=a.length-1;i>0;i--){var j=Math.floor((rnd?rnd():Math.random())*(i+1));
    var t=a[i];a[i]=a[j];a[j]=t;}
  return a;}

/* Place MINES mines outside the safe zone (first tap + neighbours), then
 * compute per-cell adjacency counts. */
function minePlace(s,safeC,rnd){
  var safe={};safe[safeC]=1;
  var nb=mineNeighbors(safeC);
  for(var i=0;i<nb.length;i++)safe[nb[i]]=1;
  var cand=[];
  for(var c=0;c<CELLS;c++)if(!safe[c])cand.push(c);
  var picked=mineShuffle(cand,rnd).slice(0,MINES);
  var mines=[],counts=[];
  for(c=0;c<CELLS;c++){mines.push(false);counts.push(0);}
  for(i=0;i<picked.length;i++)mines[picked[i]]=true;
  for(c=0;c<CELLS;c++){
    if(mines[c])continue;
    var n=mineNeighbors(c),k=0;
    for(i=0;i<n.length;i++)if(mines[n[i]])k++;
    counts[c]=k;
  }
  s.mines=mines;s.counts=counts;s.started=true;
  mineEmit(s,'place safe='+safeC+' mines='+picked.length);
}

/* Flood fill from a revealed zero cell using an explicit stack (no recursion
 * — QuickJS depth budget stays untouched). Flagged cells are never auto-
 * opened by the flood; the player keeps their flag. */
function mineFlood(s,c0){
  var stack=[c0],opened=0;
  while(stack.length){
    var c=stack.pop();
    if(s.mask[c]!==0)continue;
    s.mask[c]=1;opened++;
    if(s.counts[c]===0){
      var nb=mineNeighbors(c);
      for(var i=0;i<nb.length;i++)
        if(s.mask[nb[i]]===0&&!s.mines[nb[i]])stack.push(nb[i]);
    }
  }
  return opened;
}

function mineRevealed(s){
  var n=0;
  for(var c=0;c<CELLS;c++)if(s.mask[c]===1)n++;
  return n;
}

/* Win: every safe cell revealed (flags are irrelevant to the verdict). */
function mineCheckWin(s){
  if(s.over||!s.started)return false;
  if(mineRevealed(s)!==CELLS-MINES)return false;
  s.over=true;s.won=true;
  var best=mineBest();
  if(best===0||s.time<best)mineSave(s.time);
  mineEmit(s,'WIN time='+s.time+' best='+mineBest());
  return true;
}

/* Dig cell c. Returns 'dig'|'boom'|'ignore'|'done'. */
function mineTap(s,c){
  if(s.over)return 'done';
  if(typeof c!=='number'||c<0||c>=CELLS)return 'ignore';
  if(s.mask[c]!==0)return 'ignore';        /* flagged or already revealed */
  if(!s.started)minePlace(s,c,null);
  if(s.mines[c]){
    s.over=true;s.won=false;
    for(var i=0;i<CELLS;i++)if(s.mines[i])s.mask[i]=1;
    s.mask[c]=2;                            /* the hit mine keeps a marker */
    mineEmit(s,'boom c='+c+' time='+s.time);
    return 'boom';
  }
  mineFlood(s,c);
  mineCheckWin(s);
  mineEmit(s,'dig c='+c+' n='+s.counts[c]+' time='+s.time);
  return 'dig';
}

/* Long-press: toggle a flag on a hidden cell. Returns 'flag'|'unflag'|'ignore'|'done'. */
function mineFlag(s,c){
  if(s.over)return 'done';
  if(typeof c!=='number'||c<0||c>=CELLS)return 'ignore';
  if(s.mask[c]===1)return 'ignore';        /* revealed cells cannot be flagged */
  if(s.mask[c]===2){s.mask[c]=0;mineEmit(s,'unflag c='+c);return 'unflag';}
  s.mask[c]=2;mineEmit(s,'flag c='+c);return 'flag';
}

/* 1 Hz tick: advance the clock while the round is live. */
function mineTick(s){
  if(s.started&&!s.over){s.time++;return true;}
  return false;
}

/* Best (lowest) time across sessions; NVS key capped at 15 chars. */
function mineBest(){try{var n=lume.storage.kv.get('hisc.mine');
  return typeof n==='number'&&n>0?n:0;}catch(e){return 0;}}
function mineSave(t){try{lume.storage.kv.set('hisc.mine',t);}catch(e){/* volatile best still works */}return t;}

/* ------------------------------ GAME UI ------------------------------ */
var IW=480, IH=480, CELL=38, GAP=2, GX=41, GY=64;
var BG='#141018', HID='#3A4150', HID_B='#5A6273', REV='#191520', REV_B='#232A36';
var BOOM_BG='#3A1F1F', FLAG_BG='#3A4150';

var state=mineDeal();
var frame=signal(0),hudSig=signal(''),noteSig=signal('TAP TO DIG - HOLD TO FLAG'),bestSig=signal(0);
var root=View({style:{width:IW,height:IH,background:BG,scroll:'none'}});
function logEvent(msg){lume.log('MINE '+msg);}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function clip(r){var x=Math.max(0,r.x),y=Math.max(0,r.y),rx=Math.min(IW,r.x+r.w),by=Math.min(IH,r.y+r.h);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function drawRect(ctx,color,r,a){var x=Math.max(r.x,a.x),y=Math.max(r.y,a.y),x2=Math.min(r.x+r.w,a.x+a.w),y2=Math.min(r.y+r.h,a.y+a.h);if(x2>x&&y2>y){ctx.fillColor(color);ctx.fillRect(x,y,x2-x,y2-y);}}
function drawSprite(ctx,key,cx,cy,scale,a){var list=SPANS[key];for(var i=0;i<list.length;i++){var sp=list[i];drawRect(ctx,PAL[sp[3]],box(cx+sp[0]*scale,cy+sp[1]*scale,sp[2]*scale,scale),a);}}

function paintCell(ctx,c,a){
  var cx=GX+(c%COLS)*(CELL+GAP),cy=GY+Math.floor(c/COLS)*(CELL+GAP);
  var m=state.mask[c];
  if(m===0){                       /* hidden: face + light top-left border */
    drawRect(ctx,HID,box(cx,cy,CELL,CELL),a);
    drawRect(ctx,HID_B,box(cx,cy,CELL,2),a);
    drawRect(ctx,HID_B,box(cx,cy,2,CELL),a);
    return;
  }
  if(m===2){                       /* flagged: hidden face + flag sprite */
    drawRect(ctx,FLAG_BG,box(cx,cy,CELL,CELL),a);
    drawRect(ctx,HID_B,box(cx,cy,CELL,2),a);
    drawRect(ctx,HID_B,box(cx,cy,2,CELL),a);
    drawSprite(ctx,'flag',cx+5,cy+5,4,a);
    return;
  }
  /* revealed */
  var boom=state.over&&!state.won&&state.mines[c];
  drawRect(ctx,boom?BOOM_BG:REV,box(cx,cy,CELL,CELL),a);
  drawRect(ctx,REV_B,box(cx,cy,CELL,1),a);
  drawRect(ctx,REV_B,box(cx,cy,1,CELL),a);
  if(state.mines[c]){drawSprite(ctx,'mine',cx+5,cy+5,4,a);return;}
  var n=state.counts[c];
  if(n>0)drawSprite(ctx,String(n),cx+9,cy+5,4,a);
}

var painted=false;
var canvas=Canvas({parent:root,width:IW,height:IH,style:{position:'absolute',x:0,y:0},onDraw:function(ctx){
  frame();var s=state;
  var grid=box(GX,GY,COLS*(CELL+GAP)-GAP,ROWS*(CELL+GAP)-GAP);
  var a=!painted?box(0,0,IW,IH):clip(grid);
  if(!a)return undefined;
  ctx.fillColor(BG);ctx.fillRect(a.x,a.y,a.w,a.h);
  for(var c=0;c<CELLS;c++)paintCell(ctx,c,a);
  painted=true;return [a];
}});

/* r201: HUD + RESTART inside the 480-round safe square. The 480x480 canvas,
   CELL/GAP/GX/GY grid math and all game logic are harness anchors and unchanged. */
Text({parent:root,text:'MINESWEEPER',style:{position:'absolute',x:84,y:80,width:110,fontSize:14,borderRadius:0,color:'#F2F7FB'}});
Text({parent:root,text:function(){return hudSig()||'FLAGS '+MINES+'  TIME 000';},style:{position:'absolute',x:194,y:80,width:102,fontSize:11,borderRadius:0,color:'#9EB3C6'}});
Text({parent:root,text:function(){
  if(state.over&&state.won)return 'CLEARED IN '+state.time+'S! TAP RESTART';
  if(state.over)return 'BOOM! TAP RESTART';
  return noteSig()||'TAP TO DIG - HOLD TO FLAG';
},style:{position:'absolute',x:84,y:100,width:312,fontSize:12,borderRadius:0,color:'#5B9DF7'}});
Text({parent:root,text:function(){return bestSig()>0?('BEST '+bestSig()+'S'):('BEST -');},style:{position:'absolute',x:84,y:116,width:200,fontSize:11,borderRadius:0,color:'#9EB3C6'}});

Button({title:'RESTART',style:{position:'absolute',x:304,y:78,width:92,height:48,borderRadius:8,background:'#1F2C3D',color:'#F2F7FB',fontSize:12},onPress:function(){newGame();}});

function hudText(){
  var flags=0;
  for(var c=0;c<CELLS;c++)if(state.mask[c]===2)flags++;
  var t=String(state.time);while(t.length<3)t='0'+t;
  return 'FLAGS '+(MINES-flags)+'  TIME '+t;
}

function newGame(){
  state=mineDeal();
  noteSig.set('TAP TO DIG - HOLD TO FLAG');
  bestSig.set(mineBest());
  hudSig.set(hudText());
  painted=false;                    /* next frame is a full repaint */
  frame.set(frame()+1);
  logEvent('new game');
}

/* Map a pointer event to a cell, rejecting taps inside the 2px gap. */
function cellAt(e){
  var cx=(e.x-GX)/(CELL+GAP),cy=(e.y-GY)/(CELL+GAP);
  if(cx<0||cy<0||cx>=COLS||cy>=ROWS)return -1;
  var fx=cx-Math.floor(cx),fy=cy-Math.floor(cy);
  if(fx>CELL/(CELL+GAP)||fy>CELL/(CELL+GAP))return -1;
  return Math.floor(cy)*COLS+Math.floor(cx);
}

function tap(e){var c=cellAt(e);if(c<0)return;
  var r=mineTap(state,c);
  if(r==='dig'||r==='boom'){
    hudSig.set(hudText());
    if(state.over)noteSig.set(state.won?('CLEARED IN '+state.time+'S!'):('BOOM!'));
    frame.set(frame()+1);
  }
  while(state.events.length)logEvent(state.events.shift());
}

function longpress(e){var c=cellAt(e);if(c<0)return;
  var r=mineFlag(state,c);
  if(r==='flag'||r==='unflag'){
    hudSig.set(hudText());
    frame.set(frame()+1);
  }
  while(state.events.length)logEvent(state.events.shift());
}

lume.gesture.on(root,'tap',tap);
lume.gesture.on(root,'longpress',longpress);

function tick(){
  if(mineTick(state))hudSig.set(hudText());
}
lume.app.onPause(function(){});
lume.app.onResume(function(){frame.set(frame()+1);});
var timer=lume.system.setInterval(tick,1000);
bestSig.set(mineBest());
hudSig.set(hudText());
logEvent('10x10 15 mines; best='+(bestSig()>0?bestSig():'-')+'s');
frame.set(frame()+1);
