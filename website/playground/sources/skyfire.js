/* Skyfire: original portrait shooter. Fixed pools keep the draw budget bounded. */
var SF_W=480,SF_H=480,SF_DT=33,SF_ENEMIES=8,SF_SHOTS=32,SF_PARTICLES=40;
var SF_BG='#07142B',SF_CYAN='#77F6F1',SF_WHITE='#E7FFFF',SF_RED='#F2645A',SF_ORANGE='#FFAD66',SF_YELLOW='#FFE879',SF_GREEN='#5BE8A4';
function sfClamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function sfNear(a,b,r){var x=a.x-b.x,y=a.y-b.y;return x*x+y*y<=r*r;}
function sfPool(n){var a=[];for(var i=0;i<n;i++)a.push({active:false,x:0,y:0,vx:0,vy:0,life:0});return a;}
function sfTake(pool){for(var i=0;i<pool.length;i++)if(!pool[i].active){pool[i].active=true;return pool[i];}return null;}
function sfActive(pool){var n=0;for(var i=0;i<pool.length;i++)if(pool[i].active)n++;return n;}
function sfWaveGap(w){return Math.max(90,220-(w-1)*11);}
function sfSpeed(w){return Math.min(5.1,1.75+(w-1)*0.19);}
function sfUpgrade(s){if(s.upgrade===0){s.weapon=2;s.upgrade=1;}else if(s.upgrade===1){s.weapon=3;s.upgrade=2;}else{s.shield=true;s.upgrade=0;}return s.upgrade;}
function sfState(){return {tick:0,wave:0,waveClock:0,spawnLeft:0,spawnClock:0,score:0,lives:3,invuln:0,over:false,drag:false,player:{x:240,y:400},weapon:1,shield:false,upgrade:0,far:0,near:0,shotClock:0,enemies:sfPool(SF_ENEMIES),friendly:sfPool(SF_SHOTS),hostile:sfPool(SF_SHOTS),particles:sfPool(SF_PARTICLES),pickup:null,explosions:[],events:[]};}
function sfMovePlayer(s,x,y){s.player.x=sfClamp(x,18,SF_W-18);s.player.y=sfClamp(y,165,SF_H-25);}
function sfWaveReady(s){return s.waveClock<=0&&s.spawnLeft===0&&sfActive(s.enemies)===0;}
function sfBeginWave(s){s.wave++;s.spawnLeft=s.wave%5===0?1:Math.min(7,3+Math.floor(s.wave/2));s.spawnClock=0;s.events.push('WAVE '+s.wave);}
function sfEnemy(s,rand){var e=sfTake(s.enemies);if(!e)return false;var elite=s.wave%5===0,type=elite?2:(s.spawnLeft%3===0?1:0);e.type=type;e.hp=type===2?6:(type===1?2:1);e.base=type===2?38:35+rand()*410;e.x=e.base;e.y=-28;e.age=0;e.phase=rand()*6.28;e.fire=type===2?28:68;e.vx=type===2?2.2:0;e.vy=sfSpeed(s.wave)*(type===2?0.52:(type===1?0.73:1));s.spawnLeft--;s.spawnClock=type===2?0:23;return true;}
function sfBullet(pool,x,y,vx,vy){var b=sfTake(pool);if(!b)return false;b.x=x;b.y=y;b.vx=vx;b.vy=vy;return true;}
function sfBurst(s,x,y){s.explosions.push({x:x,y:y,age:0});if(s.explosions.length>4)s.explosions.shift();for(var i=0;i<8;i++){var p=sfTake(s.particles);if(!p)break;var a=i*6.283/8;p.x=x;p.y=y;p.vx=Math.cos(a)*(1.5+i%3);p.vy=Math.sin(a)*(1.5+i%3);p.life=12;}}
function sfDamage(s){if(s.invuln||s.over)return false;if(s.shield){s.shield=false;s.invuln=30;s.events.push('SHIELD');return true;}s.lives--;s.invuln=30;s.events.push('HIT');if(s.lives<=0){s.over=true;s.drag=false;s.events.push('OVER');}return true;}
function sfKill(s,e){e.active=false;s.score+=(e.type===2?300:(e.type===1?120:50))*Math.max(1,s.wave);sfBurst(s,e.x,e.y);s.events.push('KILL');if(e.type===2)s.pickup={x:e.x,y:e.y};}
function sfStep(s,rand){if(s.over)return;s.tick++;s.far=(s.far+0.45)%480;s.near=(s.near+1.7)%480;if(s.invuln)s.invuln--;
 if(sfWaveReady(s))sfBeginWave(s);if(s.waveClock>0)s.waveClock--;if(s.spawnClock>0)s.spawnClock--;if(s.spawnLeft&&s.spawnClock===0)sfEnemy(s,rand);
 if(s.drag){if(--s.shotClock<=0){var offsets=s.weapon===1?[0]:(s.weapon===2?[-9,9]:[-14,0,14]);for(var a=0;a<offsets.length;a++)sfBullet(s.friendly,s.player.x+offsets[a],s.player.y-20,offsets[a]*0.045,-9);s.shotClock=7;s.events.push('SHOT');}}else s.shotClock=0;
 for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i];if(!e.active)continue;e.age++;e.y+=e.vy;if(e.type===1)e.x=e.base+Math.sin(e.age*0.075+e.phase)*37;else if(e.type===2)e.x=sfClamp(e.x+e.vx,25,455);e.x=sfClamp(e.x,22,458);
  if(e.type>0&&--e.fire<=0){var dx=s.player.x-e.x,dy=s.player.y-e.y,len=Math.max(1,Math.sqrt(dx*dx+dy*dy)),vx=dx/len*3.5,vy=dy/len*3.5;sfBullet(s.hostile,e.x,e.y+14,vx,vy);if(e.type===2){sfBullet(s.hostile,e.x,e.y+14,vx-1.15,vy);sfBullet(s.hostile,e.x,e.y+14,vx+1.15,vy);}e.fire=e.type===2?32:76;}
  if(e.y>510)e.active=false;else if(sfNear(e,s.player,20)){e.active=false;sfBurst(s,e.x,e.y);sfDamage(s);}
 }
 for(i=0;i<s.friendly.length;i++){var b=s.friendly[i];if(!b.active)continue;b.x+=b.vx;b.y+=b.vy;if(b.y<30||b.x<0||b.x>480){b.active=false;continue;}for(var j=0;j<s.enemies.length;j++){e=s.enemies[j];if(e.active&&sfNear(b,e,e.type===2?27:18)){b.active=false;if(--e.hp<=0)sfKill(s,e);break;}}}
 for(i=0;i<s.hostile.length;i++){b=s.hostile[i];if(!b.active)continue;b.x+=b.vx;b.y+=b.vy;if(b.y>490||b.x<0||b.x>480){b.active=false;continue;}if(sfNear(b,s.player,14)){b.active=false;sfDamage(s);}}
 if(s.pickup){s.pickup.y+=2.2;if(s.pickup.y>490)s.pickup=null;else if(sfNear(s.pickup,s.player,22)){sfUpgrade(s);s.pickup=null;s.events.push('PICKUP');}}
 for(i=0;i<s.particles.length;i++){var p=s.particles[i];if(!p.active)continue;p.x+=p.vx;p.y+=p.vy;if(--p.life<=0)p.active=false;}
 for(i=s.explosions.length-1;i>=0;i--){if(++s.explosions[i].age>=4)s.explosions.splice(i,1);}
 if(s.spawnLeft===0&&s.waveClock===0)s.waveClock=sfWaveGap(s.wave);
}
/* GAME UI */
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


var sf=sfState(),sfFrame=signal(0),sfRoot=__A_View({style:{width:480,height:480,background:SF_BG,scroll:'none'}});
function sfSound(freq,ms){var n=Math.floor(ms*16),buf=new ArrayBuffer(n*4),v=new DataView(buf);for(var i=0;i<n;i++){var env=(1-i/n)*Math.min(1,i/32),sample=Math.round(Math.sin(6.283*freq*i/16000)*8500*env);v.setInt16(i*4,sample,true);v.setInt16(i*4+2,sample,true);}return buf;}
var sfSounds={SHOT:sfSound(740,22),KILL:sfSound(125,48),PICKUP:sfSound(1000,45)};
function sfPlay(name){try{if(lume.audio&&lume.audio.play)lume.audio.play(sfSounds[name]);}catch(err){}}
function sfStarX(i,seed){return (i*137+seed*73)%476+2;}
function sfDraw(ctx){sfFrame();var i,e,b,p,x,y;ctx.fillColor(SF_BG);ctx.fillRect(0,0,480,480);
 for(i=0;i<24;i++){x=sfStarX(i,2);y=(i*91+Math.floor(sf.far))%480;ctx.fillCircle(x,y,1,'#28486B');}
 for(i=0;i<18;i++){x=sfStarX(i,5);y=(i*131+Math.floor(sf.near))%480;ctx.fillCircle(x,y,2,'#77AECB');}
 for(i=0;i<sf.enemies.length;i++){e=sf.enemies[i];if(!e.active||e.y<35||e.y>460)continue;var c=e.type===2?SF_ORANGE:SF_RED;ctx.fillEllipse(Math.round(e.x),Math.round(e.y),e.type===2?25:16,e.type===2?16:12,c);ctx.fillRect(Math.round(e.x-(e.type===2?35:24)),Math.round(e.y-3),e.type===2?70:48,6,c);ctx.fillEllipse(Math.round(e.x),Math.round(e.y-4),7,6,'#FFD3A4');if(e.type===2)ctx.fillRect(Math.round(e.x-8),Math.round(e.y-18),16,7,SF_RED);}
 for(i=0;i<sf.friendly.length;i++){b=sf.friendly[i];if(b.active)ctx.fillCircle(Math.round(b.x),Math.round(b.y),3,SF_CYAN);}
 for(i=0;i<sf.hostile.length;i++){b=sf.hostile[i];if(b.active)ctx.fillCircle(Math.round(b.x),Math.round(b.y),4,SF_YELLOW);}
 for(i=0;i<sf.particles.length;i++){p=sf.particles[i];if(p.active&&p.x>=2&&p.x<=478&&p.y>=2&&p.y<=478)ctx.fillCircle(Math.round(p.x),Math.round(p.y),2,SF_ORANGE);}
 for(i=0;i<sf.explosions.length;i++){e=sf.explosions[i];var r=7+e.age*7;ctx.fillCircle(Math.round(e.x),Math.round(e.y),r,SF_ORANGE);ctx.fillCircle(Math.round(e.x),Math.round(e.y),Math.max(1,r-3),SF_BG);}
 if(sf.pickup){ctx.fillCircle(Math.round(sf.pickup.x),Math.round(sf.pickup.y),12,SF_GREEN);ctx.fillCircle(Math.round(sf.pickup.x),Math.round(sf.pickup.y),5,SF_BG);}
 if(!sf.over&&(sf.invuln===0||sf.tick%4<2)){x=Math.round(sf.player.x);y=Math.round(sf.player.y);ctx.fillEllipse(x,y,12,20,SF_CYAN);ctx.fillRect(x-25,y+3,50,8,SF_CYAN);ctx.fillEllipse(x,y-8,5,9,SF_WHITE);ctx.fillRect(x-9,y+18,18,5,'#5B98CC');if(sf.shield){ctx.fillCircle(x,y,28,SF_GREEN);ctx.fillCircle(x,y,26,SF_BG);}}
}
__A_Canvas({parent:sfRoot,width:480,height:480,onDraw:sfDraw});
/* r202: HUD and footer moved into [84,396]; the full-bleed 480x480 render
   canvas, wave logic and entity pools are unchanged. */
__A_Text({parent:sfRoot,text:function(){sfFrame();return 'SKYFIRE   '+sf.score+'   L '+sf.lives+'   W '+sf.wave+(sf.shield?'   SHIELD':'');},style:{position:'absolute',x:84,y:80,width:312,height:26,fontSize:14,color:'#F2F7FB',borderRadius:0}});
__A_Text({parent:sfRoot,text:function(){sfFrame();return sf.over?'GAME OVER   SCORE '+sf.score+'   TAP TO RESTART':(sf.drag?'':'DRAG TO MOVE AND FIRE');},style:{position:'absolute',x:84,y:372,width:312,height:26,fontSize:14,color:'#40D8B0',textAlign:'center',borderRadius:0}});
var SF_IDLE_DT=100,sfTimer=null,sfTimerDt=0,sfOverPainted=false;
function sfSchedule(){var dt=sf.over?SF_IDLE_DT:SF_DT;if(sfTimer!==null&&sfTimerDt===dt)return;if(sfTimer!==null)lume.system.clearInterval(sfTimer);sfTimerDt=dt;sfTimer=lume.system.setInterval(sfTick,dt);}
function sfStart(){sfSchedule();}
function sfStop(){if(sfTimer!==null){lume.system.clearInterval(sfTimer);sfTimer=null;}sfTimerDt=0;}
function sfTick(){if(sf.over){sfSchedule();if(!sfOverPainted){sfOverPainted=true;sfFrame.set(sfFrame()+1);}return;}sfStep(sf,Math.random);for(var i=0;i<sf.events.length;i++)sfPlay(sf.events[i]);sf.events.length=0;if(sf.over){sfOverPainted=true;sfSchedule();}sfFrame.set(sfFrame()+1);}
function sfDrag(e){if(sf.over)return;sf.drag=true;sfMovePlayer(sf,e.x,e.y);sfFrame.set(sfFrame()+1);}
function sfStopDrag(){sf.drag=false;}
function sfRestart(){sf=sfState();sfOverPainted=false;sfSchedule();sfFrame.set(sfFrame()+1);}
lume.gesture.on(sfRoot,'panstart',sfDrag);lume.gesture.on(sfRoot,'pan',sfDrag);lume.gesture.on(sfRoot,'panend',sfStopDrag);lume.gesture.on(sfRoot,'tap',function(e){if(sf.over)sfRestart();else sfStopDrag();});
lume.app.onPause(sfStop);lume.app.onResume(sfStart);sfStart();
