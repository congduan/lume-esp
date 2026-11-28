
/* r227 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r227Ctx) return c.__r227Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c.text(__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r227Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_View(p, kids) { return View(__A_style(p), kids); }
function __A_Text(p, kids) { return Text(__A_style(p), kids); }
function __A_Button(p, kids) { return Button(__A_style(p), kids); }
function __A_Image(p, kids) { return Image(__A_style(p), kids); }

/* Single-screen platform game. Coordinates below are local to the 480x352 canvas. */
var MW=480, MH=352, SKY='#83D9F5', SOIL='#8B4A2B', TOP='#60B84C';
var hud=signal(''), frame=signal(0);
/* r201: HUD and control buttons pulled into the 480-round safe square; the
   480x352 game world canvas and all physics constants stay unchanged.
   The HUD Text is created AFTER the canvas so it stacks above the game world. */
var root=__A_View({style:{width:480,height:480,background:'#0D1420',scroll:'none'}});
var ground=[{x:0,y:310,w:212,h:42},{x:270,y:310,w:210,h:42}];
var platforms=[{x:108,y:250,w:66,h:12,brick:true,live:true},{x:190,y:190,w:78,h:12,brick:false,live:true},{x:300,y:190,w:76,h:12,brick:false,live:true}];
var coins=[{x:141,y:218,live:true},{x:224,y:241,live:true},{x:335,y:202,live:true}];
var hero={x:32,y:290,w:16,h:20,vx:0,vy:0,face:1,walk:0};
var enemy={x:348,y:294,w:16,h:16,vx:1.1,live:true};
var score=0, money=0, lives=3, level=1, move=0, moveTicks=0, jumpHeld=false, invuln=0;
function logEvent(s){lume.log('MARIO '+s);}
function refreshHud(){hud.set('S '+score+'  C '+money+'  L '+lives+'  LV '+level);}
refreshHud();
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function box(x,y,w,h){return {x:Math.floor(x),y:Math.floor(y),w:w,h:h};}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function union(a,b){var x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return box(x,y,Math.max(a.x+a.w,b.x+b.w)-x,Math.max(a.y+a.h,b.y+b.h)-y);}
function clip(r){var x=clamp(r.x,0,MW),y=clamp(r.y,0,MH),rx=clamp(r.x+r.w,0,MW),by=clamp(r.y+r.h,0,MH);return rx>x&&by>y?box(x,y,rx-x,by-y):null;}
function pad(r,n){return box(r.x-n,r.y-n,r.w+2*n,r.h+2*n);}
function drawRect(ctx,color,r,area){var a=clip({x:Math.max(r.x,area.x),y:Math.max(r.y,area.y),w:Math.min(r.x+r.w,area.x+area.w)-Math.max(r.x,area.x),h:Math.min(r.y+r.h,area.y+area.h)-Math.max(r.y,area.y)});if(a){ctx.fillColor(color);ctx.fillRect(a.x,a.y,a.w,a.h);}}
/* Compact 8x10 character rows; runs are decoded once and reused every frame. */
var sprites={
  stand:['..RRRR..','.RRRRRR.','..SSSS..','.SBSBS..','..SSSS..','..BBBB..','.RBBBBR.','.RBBBBR.','..BB.BB.','.BB..BB.'],
  walk1:['..RRRR..','.RRRRRR.','..SSSS..','.SBSBS..','..SSSS..','..BBBB..','.RBBBBR.','.RBBBBR.','..BB.BB.','.BB...BB'],
  walk2:['..RRRR..','.RRRRRR.','..SSSS..','.SBSBS..','..SSSS..','..BBBB..','.RBBBBR.','.RBBBBR.','..BB.BB.','BB...BB.'],
  jump:['..RRRR..','.RRRRRR.','..SSSS..','.SBSBS..','..SSSS..','.RBBBBR.','R.BBBB.R','..BBBB..','.BB..BB.','BB....BB'],
  foe:['.MMMMMM.','MMMMMMMM','MWWMMWWM','MWWMMWWM','MMMMMMMM','.MMMMMM.','..MMMM..','.MM..MM.']
};
var palette={R:'#D4363C',S:'#F8C48C',B:'#1E568C',M:'#8A4936',W:'#FFFFFF'};
var spans={};
for(var key in sprites){var rows=sprites[key],out=[];for(var sy=0;sy<rows.length;sy++){var row=rows[sy],sx=0;while(sx<row.length){var ink=row.charAt(sx),start=sx;while(sx<row.length&&row.charAt(sx)===ink)sx++;if(ink!=='.')out.push([start,sy,sx-start,ink]);}}spans[key]=out;}
function drawSprite(ctx,key,x,y,flip,area){var list=spans[key];for(var i=0;i<list.length;i++){var s=list[i],rx=x+(flip?8-s[0]-s[2]:s[0])*2;drawRect(ctx,palette[s[3]],box(rx,y+s[1]*2,s[2]*2,2),area);}}
function staticScene(ctx,area){
 drawRect(ctx,SKY,area,area);
 drawRect(ctx,'#EAFBFF',box(24,38,66,12),area);drawRect(ctx,'#EAFBFF',box(55,28,42,12),area);
 drawRect(ctx,'#EAFBFF',box(302,46,72,12),area);
 for(var i=0;i<ground.length;i++){drawRect(ctx,SOIL,ground[i],area);drawRect(ctx,TOP,box(ground[i].x,310,ground[i].w,7),area);}
 for(i=0;i<platforms.length;i++){var p=platforms[i];if(!p.live)continue;drawRect(ctx,p.brick?'#B86039':'#4A8B4D',p,area);drawRect(ctx,p.brick?'#F5B464':'#7BD873',box(p.x,p.y,p.w,3),area);if(p.brick){for(var xx=p.x+16;xx<p.x+p.w;xx+=16)drawRect(ctx,'#663C31',box(xx,p.y+3,2,9),area);}}
 for(i=0;i<coins.length;i++)if(coins[i].live){var c=coins[i];drawRect(ctx,'#E9A915',box(c.x,c.y,10,12),area);drawRect(ctx,'#FFE484',box(c.x+2,c.y+2,6,8),area);}
 drawRect(ctx,'#F8FBFF',box(448,82,3,228),area);drawRect(ctx,'#E74949',box(451,84,23,17),area);
}
var oldHero=null,oldEnemy=null,changes=[],painted=false,dirtyPixels=0;
var canvas=__A_Canvas({parent:root,width:MW,height:MH,style:{position:'absolute',x:0,y:52},onDraw:function(ctx){
 frame();var h=box(Math.round(hero.x),Math.round(hero.y),16,20),e=box(Math.round(enemy.x),Math.round(enemy.y),16,16),areas=[];
 if(!painted){var all=box(0,0,MW,MH);staticScene(ctx,all);drawSprite(ctx,'stand',h.x,h.y,false,all);drawSprite(ctx,'foe',e.x,e.y,false,all);oldHero=h;oldEnemy=e;painted=true;return;}
 if(oldHero){var travel=union(oldHero,h);if(travel.w*travel.h>2500){areas.push(clip(pad(oldHero,2)));areas.push(clip(pad(h,2)));}else areas.push(clip(pad(travel,2)));}
 if(enemy.live&&oldEnemy)areas.push(clip(pad(union(oldEnemy,e),2)));
 else if(oldEnemy)areas.push(clip(pad(oldEnemy,2)));
 while(changes.length)areas.push(clip(pad(changes.shift(),2)));
 var valid=[];for(var i=0;i<areas.length;i++)if(areas[i]){var a=areas[i];staticScene(ctx,a);drawSprite(ctx,hero.vy!==0?'jump':hero.walk%8<4?'walk1':'walk2',h.x,h.y,hero.face<0,a);if(enemy.live)drawSprite(ctx,'foe',e.x,e.y,false,a);valid.push(a);}
 dirtyPixels=0;for(i=0;i<valid.length;i++)dirtyPixels+=valid[i].w*valid[i].h;
 oldHero=h;oldEnemy=enemy.live?e:null;return valid.length?valid:[box(h.x,h.y,1,1)];
}});
__A_Text({parent:root,text:function(){return hud();},style:{position:'absolute',x:44,y:18,width:392,textAlign:'center',fontSize:16,borderRadius:0,color:'#F2F7FB'}});
function resetHero(){hero.x=32;hero.y=290;hero.vx=0;hero.vy=0;move=0;moveTicks=0;invuln=20;}
function damage(){if(invuln)return;lives--;logEvent('HIT lives='+lives);if(lives<=0){lives=3;score=0;money=0;level=1;logEvent('RESTART');}resetHero();refreshHud();}
function win(){level++;score+=100;logEvent('LEVEL '+level+' score='+score);for(var i=0;i<coins.length;i++){coins[i].live=true;changes.push(box(coins[i].x,coins[i].y,10,12));}for(i=0;i<platforms.length;i++){if(!platforms[i].live)changes.push(platforms[i]);platforms[i].live=true;}enemy.live=true;enemy.x=348;oldEnemy=null;resetHero();refreshHud();}
var perfCount=0,perfSum=0,perfMax=0,dirtyMax=0;
function tick(){var tickStart=Date.now();
 if(invuln)invuln--;
 if(moveTicks>0){moveTicks--;hero.vx=clamp(hero.vx+move*0.8,-5,5);}else{hero.vx*=0.75;if(Math.abs(hero.vx)<0.2)hero.vx=0;}
 if(hero.vx){hero.face=hero.vx<0?-1:1;hero.walk++;}
 var prevY=hero.y;hero.x=clamp(hero.x+hero.vx,0,MW-16);hero.vy=clamp(hero.vy+0.65,-13,9);hero.y+=hero.vy;
 for(var i=0;i<platforms.length+ground.length;i++){var p=i<platforms.length?platforms[i]:ground[i-platforms.length];if(p.live===false)continue;
  if(hero.x+14<=p.x||hero.x+2>=p.x+p.w)continue;
  if(hero.vy>=0&&prevY+20<=p.y&&hero.y+20>=p.y){hero.y=p.y-20;hero.vy=0;}
  else if(hero.vy<0&&prevY>=p.y+p.h&&hero.y<=p.y+p.h){hero.y=p.y+p.h;hero.vy=1;if(p.brick){p.live=false;score+=25;changes.push(box(p.x,p.y,p.w,p.h));logEvent('BRICK score='+score);refreshHud();}}
 }
 for(i=0;i<coins.length;i++){var c=coins[i];if(c.live&&overlap(hero,box(c.x,c.y,10,12))){c.live=false;money++;score+=10;changes.push(box(c.x,c.y,10,12));logEvent('COIN score='+score);refreshHud();}}
 if(enemy.live){enemy.x+=enemy.vx;if(enemy.x<294||enemy.x>440){enemy.vx=-enemy.vx;enemy.x+=enemy.vx;}if(overlap(hero,enemy)){if(hero.vy>0&&prevY+20<=enemy.y+5){enemy.live=false;hero.vy=-7;score+=50;logEvent('STOMP score='+score);refreshHud();}else damage();}}
 if(hero.y>MH+24)damage();
 if(hero.x>=438&&hero.y+20>=85)win();
 frame.set(frame()+1);
 var elapsed=Date.now()-tickStart;perfCount++;perfSum+=elapsed;perfMax=Math.max(perfMax,elapsed);dirtyMax=Math.max(dirtyMax,dirtyPixels);
 if(perfCount===25){logEvent('PERF js_avg_ms='+(perfSum/25).toFixed(2)+' js_max_ms='+perfMax+' dirty_max_px='+dirtyMax+' x='+Math.round(hero.x)+' y='+Math.round(hero.y));perfCount=0;perfSum=0;perfMax=0;dirtyMax=0;}
}
function walk(dir,longer){move=dir;moveTicks=longer?32:14;}
function jump(high){if(hero.vy===0){hero.vy=high?-12:-9;logEvent('JUMP '+(high?'HIGH':'SHORT'));}}
function control(x,label,act,hold){var b=__A_Button({parent:root,title:label,style:{position:'absolute',x:x,y:412,width:124,height:48,background:'#1F2C3D',color:'#F2F7FB',borderRadius:8,fontSize:16},onPress:act});lume.gesture.on(b,'longpress',hold);return b;}
control(44,'LEFT',function(){walk(-1,false);},function(){walk(-1,true);});
control(178,'RIGHT',function(){walk(1,false);},function(){walk(1,true);});
var jumpButton=control(312,'JUMP',function(){jump(false);},function(){jump(true);});
/* A slight drag starts a held jump immediately; releasing early cuts ascent. */
lume.gesture.on(jumpButton,'panstart',function(){jump(true);jumpHeld=true;});
lume.gesture.on(jumpButton,'panend',function(){if(jumpHeld&&hero.vy<0)hero.vy*=0.4;jumpHeld=false;});
var timer=null;function runLoop(){if(timer===null)timer=lume.system.setInterval(tick,40);}function stopLoop(){if(timer!==null){lume.system.clearInterval(timer);timer=null;}}
lume.app.onPause(stopLoop);lume.app.onResume(runLoop);runLoop();
