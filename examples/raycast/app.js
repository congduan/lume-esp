
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

/* Lantern Vault: an original three-stage pixel maze. Plain global script. */
var LEVELS=[
 {name:'ENTRY',goal:'exit',rows:[
 '111111111111','1S0000000001','100020000001','10002000P001',
 '100000000001','100000002001','100G00002001','100000000001',
 '1000030000E1','111111111111']},
 {name:'PASSAGE',goal:'exit',rows:[
 '111111111111','1S0002000001','101000200G01','100000000001',
 '120002220001','100000000001','100020000001','1P0020002001',
 '100000H000E1','111111111111']},
 {name:'VAULT',goal:'clear',rows:[
 '111111111111','100000000001','100G0000H001','100020020001',
 '100000000001','10P0000000P1','100000000001','100020020001',
 '100G00S0H001','111111111111']}
];
var TEX_ROWS=[
 '2222222222222222','2999999929999992','2999999929999992','2999999929999992',
 '2222222222222222','9222999999222999','9222999999222999','9222999999222999',
 '2222222222222222','2999999929999992','2999999929999992','2999999929999992',
 '2222222222222222','9222999999222999','9222999999222999','9222999999222999',
 '3344334433443344','3444344434443444','4443444344434443','4333433343334333',
 '3344334433443344','3444344434443444','4443444344434443','4333433343334333',
 '3344334433443344','3444344434443444','4443444344434443','4333433343334333',
 '3344334433443344','3444344434443444','4443444344434443','4333433343334333',
 '8888888888888888','8eeeeeeeeeeeeee8','8e555555555555e8','8e5bbbbbbbbbb5e8',
 '8e5b33333333b5e8','8e5b3bbbbbb3b5e8','8e5b3b8888b3b5e8','8e5b3b8ee8b3b5e8',
 '8e5b3b8ee8b3b5e8','8e5b3b8888b3b5e8','8e5b3bbbbbb3b5e8','8e5b33333333b5e8',
 '8e5bbbbbbbbbb5e8','8e555555555555e8','8eeeeeeeeeeeeee8','8888888888888888'
];
var textures=new Uint8Array(768);
for(var ti=0;ti<48;ti++)for(var tx=0;tx<16;tx++)textures[ti*16+tx]=parseInt(TEX_ROWS[ti].charAt(tx),16);
var SOUND={door:[330,42],pickup:[660,38],hurt:[170,45],win:[880,45]};
function makeSound(freq,ms){var n=Math.floor(ms*16),pcm=new ArrayBuffer(n*4),v=new DataView(pcm);
 for(var i=0;i<n;i++){var a=Math.min(1,i/48)*(1-i/n),s=Math.round(Math.sin(2*Math.PI*freq*i/16000)*9000*a);
  v.setInt16(i*4,s,true);v.setInt16(i*4+2,s,true);}return pcm;}
var sounds={};for(var sn in SOUND)sounds[sn]=makeSound(SOUND[sn][0],SOUND[sn][1]);
function play(name){try{if(lume.audio&&lume.audio.play)lume.audio.play(sounds[name]);}catch(e){}}
function cell(s,x,y){return x<0||y<0||x>=s.w||y>=s.h?1:s.map[y*s.w+x];}
function open(s,x,y){return cell(s,x,y)===0;}
function canStand(s,x,y){var r=0.19;return open(s,Math.floor(x-r),Math.floor(y-r))&&open(s,Math.floor(x+r),Math.floor(y-r))&&open(s,Math.floor(x-r),Math.floor(y+r))&&open(s,Math.floor(x+r),Math.floor(y+r));}
function loadLevel(s,index){var d=LEVELS[index];s.li=index;s.w=d.rows[0].length;s.h=d.rows.length;s.map=new Uint8Array(s.w*s.h);s.pickups=[];s.enemies=[];s.ex=null;s.hp=3;s.done=false;s.justDied=false;s.fog=new Uint8Array(s.w*s.h);
 for(var y=0;y<s.h;y++)for(var x=0;x<s.w;x++){var c=d.rows[y].charAt(x),k=y*s.w+x;
  if(c==='1'||c==='2'||c==='3')s.map[k]=+c;
  else if(c==='S'){s.x=x+0.5;s.y=y+0.5;s.angle=0;}
  else if(c==='E')s.ex=[x,y];
  else if(c==='P')s.pickups.push({x:x+0.5,y:y+0.5,taken:false});
  else if(c==='G'||c==='H')s.enemies.push({x:x+0.5,y:y+0.5,type:c,alive:true,dir:1,phase:'patrol',lastHit:0});
 }reveal(s);return s;}
function state(){return loadLevel({li:0,score:0},0);}
function reveal(s){var px=Math.floor(s.x),py=Math.floor(s.y);for(var y=Math.max(0,py-2);y<=Math.min(s.h-1,py+2);y++)for(var x=Math.max(0,px-2);x<=Math.min(s.w-1,px+2);x++)s.fog[y*s.w+x]=1;}
function lineOfSight(s,ax,ay,bx,by){var d=Math.hypot(bx-ax,by-ay),n=Math.ceil(d*8);for(var i=1;i<n;i++){var t=i/n;if(cell(s,Math.floor(ax+(bx-ax)*t),Math.floor(ay+(by-ay)*t)))return false;}return true;}
function damage(s,now){if(now-s.lastDamage<750)return false;s.lastDamage=now;s.hp--;if(s.hp<=0){var score=s.score,li=s.li;loadLevel(s,li);s.score=score;s.lastDamage=now;s.justDied=true;}return true;}
function updateEnemies(s,dt,now){var hit=false;for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i];if(!e.alive)continue;
  var dx=s.x-e.x,dy=s.y-e.y,dist=Math.hypot(dx,dy),seen=dist<5&&lineOfSight(s,e.x,e.y,s.x,s.y);
  e.phase=e.type==='H'&&seen?'chase':'patrol';
  var vx=e.phase==='chase'?dx/Math.max(dist,0.01):e.dir,vy=e.phase==='chase'?dy/Math.max(dist,0.01):0;
  var speed=e.phase==='chase'?0.55:0.28,nx=e.x+vx*speed*dt,ny=e.y+vy*speed*dt;
  if(canStand(s,nx,ny)){e.x=nx;e.y=ny;}else if(e.phase==='patrol')e.dir=-e.dir;
  if(dist<0.46&&damage(s,now))hit=true;
 }return hit;}
function move(s,step){var nx=s.x+Math.cos(s.angle)*step,ny=s.y+Math.sin(s.angle)*step;
 if(canStand(s,nx,ny)){s.x=nx;s.y=ny;reveal(s);return true;}return false;}
function interact(s){var ix=Math.floor(s.x+Math.cos(s.angle)*0.8),iy=Math.floor(s.y+Math.sin(s.angle)*0.8),k=iy*s.w+ix;
 if(cell(s,ix,iy)===3){s.map[k]=0;return 'door';}return '';}
function collect(s){var found=false;for(var i=0;i<s.pickups.length;i++){var p=s.pickups[i];if(!p.taken&&Math.hypot(s.x-p.x,s.y-p.y)<0.45){p.taken=true;s.score+=100;found=true;}}return found;}
function shoot(s){var best=null,bd=5;for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i];if(!e.alive)continue;var dx=e.x-s.x,dy=e.y-s.y,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx)-s.angle;while(a>Math.PI)a-=2*Math.PI;while(a< -Math.PI)a+=2*Math.PI;
  if(d<bd&&Math.abs(a)<0.18&&lineOfSight(s,s.x,s.y,e.x,e.y)){best=e;bd=d;}}
 if(best){best.alive=false;s.score+=250;return true;}return false;}
function won(s){if(LEVELS[s.li].goal==='clear'){for(var i=0;i<s.enemies.length;i++)if(s.enemies[i].alive)return false;return true;}
 return s.ex&&Math.floor(s.x)===s.ex[0]&&Math.floor(s.y)===s.ex[1];}
var game=state(),revision=signal(0),hud=signal(''),banner=signal('LANTERN VAULT / FIND EXIT');
lume.raycast.setMap(game.w,game.h,game.map);lume.raycast.setTextures(textures);
function spriteData(s){var n=0;for(var i=0;i<s.enemies.length;i++)if(s.enemies[i].alive)n++;
 var a=new Float32Array(n*3),j=0;for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i];if(e.alive){a[j++]=e.x;a[j++]=e.y;a[j++]=e.type==='H'?1:0;}}return a;}
var root=__A_View({style:{width:480,height:480,background:'#101722',scroll:'none'}});
var scene=__A_Canvas({parent:root,width:480,height:460,onDraw:function(ctx){revision();lume.raycast.render(ctx.nodeId,game.x,game.y,game.angle,game.hp,spriteData(game));}});
var mini=__A_Canvas({parent:root,width:96,height:96,style:{position:'absolute',x:84,y:150},onDraw:function(ctx){revision();ctx.fillColor('#16202E');ctx.fillRect(0,0,96,96);
 var size=8;for(var y=0;y<game.h;y++)for(var x=0;x<game.w;x++)if(game.fog[y*game.w+x]){ctx.fillColor(game.map[y*game.w+x]?'#6B7791':'#223C4B');ctx.fillRect(x*size,y*size,size,size);}
 ctx.fillColor('#FFD166');ctx.fillRect(Math.floor(game.x*size)-2,Math.floor(game.y*size)-2,4,4);
 for(var i=0;i<game.enemies.length;i++){var e=game.enemies[i];if(e.alive&&game.fog[Math.floor(e.y)*game.w+Math.floor(e.x)]){ctx.fillColor('#E4656B');ctx.fillRect(Math.floor(e.x*size)-1,Math.floor(e.y*size)-1,3,3);}}
 }});
/* r202: HUD/banner/footer moved into [84,396] and Text style.background
   removed -- the playground renderer consumes it as color (dark-on-dark).
   Nodes are created after the canvases so they stay on top. */
__A_Text({parent:root,text:function(){return hud();},style:{position:'absolute',x:84,y:80,width:312,height:30,fontSize:16,color:'#F2F7FB',borderRadius:0}});
__A_Text({parent:root,text:function(){return banner();},style:{position:'absolute',x:84,y:114,width:312,height:26,fontSize:14,color:'#40D8B0',borderRadius:0}});
__A_Text({parent:root,text:'TAP STEP  |  HOLD FIRE  |  PAN TURN',style:{position:'absolute',x:84,y:372,width:312,height:24,fontSize:12,color:'#9EB3C6',textAlign:'center',borderRadius:0}});
function refresh(){var hearts=['','<3','<3 <3','<3 <3 <3'];hud.set('L'+(game.li+1)+'  HP '+hearts[game.hp]+'  SCORE '+game.score);revision.set(revision()+1);}
function next(){if(game.li===LEVELS.length-1){game.done=true;banner.set('VAULT CLEARED  TAP TO RESTART');}else{var score=game.score;loadLevel(game,game.li+1);game.score=score;lume.raycast.setMap(game.w,game.h,game.map);lume.raycast.setTextures(textures);banner.set(game.li===2?'CLEAR ALL SENTRIES':LEVELS[game.li].name+' / FIND EXIT');}play('win');refresh();}
function step(){if(game.done){game=state();banner.set('LANTERN VAULT / FIND EXIT');lume.raycast.setMap(game.w,game.h,game.map);lume.raycast.setTextures(textures);refresh();return;}
 if(interact(game))play('door');else move(game,0.32);if(collect(game))play('pickup');if(won(game))next();else refresh();}
function fire(){if(game.done)return;if(shoot(game)){banner.set('TARGET CLEARED');if(won(game))next();else refresh();}}
var panX=null;function pan(e){if(panX!==null){game.angle+=(e.x-panX)*0.012;refresh();}panX=e.x;}
function bind(node){lume.gesture.on(node,'panstart',function(e){panX=e.x;});lume.gesture.on(node,'pan',pan);lume.gesture.on(node,'panend',function(){panX=null;});lume.gesture.on(node,'tap',step);lume.gesture.on(node,'longpress',fire);}
bind(root);bind(scene);
var timer=null,lastTick=Date.now(),frameCount=0,frameStart=Date.now();
function tick(){var now=Date.now(),dt=Math.min(0.1,(now-lastTick)/1000);lastTick=now;if(!game.done){if(updateEnemies(game,dt,now))play('hurt');if(game.justDied){game.justDied=false;lume.raycast.setMap(game.w,game.h,game.map);lume.raycast.setTextures(textures);banner.set('RETRY '+LEVELS[game.li].name);}if(won(game))next();}
 revision.set(revision()+1);frameCount++;if(now-frameStart>=1000){frameStart=now;frameCount=0;refresh();}}
function start(){if(timer===null){lastTick=Date.now();timer=lume.system.setInterval(tick,40);}}
function stop(){if(timer!==null){lume.system.clearInterval(timer);timer=null;}}
refresh();
lume.app.onPause(stop);lume.app.onResume(start);start();
