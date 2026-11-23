/* SkyCombat 3D: fixed camera, projected aircraft, and polled motion control. */
var SC_PI=Math.PI,SC_DT=33,SC_F=400,SC_FAR=2000,SC_POOL=6;
function scClamp(v,a,b){return Math.max(a,Math.min(b,v));}
function scRotate(x,y,deg){var a=deg*SC_PI/180,c=Math.cos(a),s=Math.sin(a);return [240+x*c-y*s,240+x*s+y*c];}
function scProject(x,y,z,aimX,aimY,roll){var p=scRotate((x-aimX)*SC_F/z,(y-aimY)*SC_F/z,roll);return {x:p[0],y:p[1]};}
function scIntegrate(roll,gz,bias,ms){return scClamp(roll+(gz-bias)*ms/1000,-60,60);}
function scPitch(ax,az,zero){return scClamp(Math.atan2(ax,az)*180/SC_PI-zero,-35,35);}
function scWaveCount(n){return 4+n;}
function scSpeed(n){return 7.5*Math.pow(1.08,n-1);}
function scRadius(e){return (e.type===2?115:e.type===1?82:58)*SC_F/e.z;}
function scHit(e,p){var r=scRadius(e)+28,dx=p.x-240,dy=p.y-240;return e.active&&e.z<600&&dx*dx+dy*dy<=r*r;}
function scCal(){return {roll:0,pitch:0,bias:0,zero:0,base:null,ms:0,quiet:0,sum:0,count:0};}
function scMotion(c,s,ms){if(!s||!isFinite(s.ax)||!isFinite(s.ay)||!isFinite(s.az)||!isFinite(s.gx)||!isFinite(s.gy)||!isFinite(s.gz))return false;
 if(!c.base)c.base={ax:s.ax,ay:s.ay,az:s.az};
 var dx=s.ax-c.base.ax,dy=s.ay-c.base.ay,dz=s.az-c.base.az;
 var still=Math.sqrt(dx*dx+dy*dy+dz*dz)<0.5&&Math.abs(s.gx)<8&&Math.abs(s.gy)<8&&Math.abs(s.gz)<8;
 c.ms+=ms;if(still){c.quiet+=ms;c.sum+=s.gz;c.count++;}
 if(c.ms>=1000&&c.count&&c.ms<1100){c.bias=c.sum/c.count;c.zero=Math.atan2(s.ax,s.az)*180/SC_PI;c.roll=0;}
 if(c.ms>=10000){if(c.quiet>=8000&&c.count){c.bias=c.sum/c.count;c.zero=Math.atan2(s.ax,s.az)*180/SC_PI;c.roll=0;}c.ms=0;c.quiet=0;c.sum=0;c.count=0;}
 c.roll=scIntegrate(c.roll,s.gz,c.bias,ms);c.pitch=scPitch(s.ax,s.az,c.zero);return true;}
function scParticles(){var a=[];for(var i=0;i<16;i++)a.push({active:false,x:0,y:0,vx:0,vy:0,life:0,kind:0});return a;}
function scState(){return {tick:0,wave:0,left:0,lives:3,score:0,best:0,over:false,roll:0,pitch:0,sim:true,cal:scCal(),flash:0,stop:0,travel:0,enemies:[],particles:scParticles(),next:0,scorePop:0};}
function scBegin(s){s.wave++;s.left=scWaveCount(s.wave);s.next=0;}
function scSpawn(s){if(!s.left||s.enemies.length>=SC_POOL)return;var i=s.left,type=s.wave<2?(i%3===0?1:0):((i+s.wave)%5===0?2:(i%3===0?1:0));s.enemies.push({active:true,type:type,hp:type===2?3:1,x:((i*137+s.wave*71)%601)-300,y:((i*89+s.wave*43)%281)-140,z:SC_FAR,phase:i*1.7,age:0,white:0});s.left--;s.next=17;}
function scBurst(s,x,y){for(var i=0;i<s.particles.length;i++){var p=s.particles[i],a=i*SC_PI*2/s.particles.length;p.active=true;p.x=x;p.y=y;p.kind=i<6?0:1;p.vx=Math.cos(a)*(i<6?2.4:3.5+i%3);p.vy=Math.sin(a)*(i<6?2.4:3.5+i%3);p.life=i<6?7:15;}}
function scFire(s){if(s.over){var best=s.best;s=scState();s.best=best;return s;}s.flash=5;for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i],p=scProject(e.x,e.y,e.z,s.pitch*5,s.pitch*3,s.roll);if(scHit(e,p)){e.hp--;e.white=4;s.stop=3;if(e.hp<=0){scBurst(s,p.x,p.y);e.active=false;s.score+=(e.type===2?300:e.type===1?150:80)*s.wave;s.best=Math.max(s.best,s.score);s.scorePop=3;}break;}}return s;}
function scStep(s){if(s.over)return;s.tick++;if(s.flash)s.flash--;if(s.scorePop)s.scorePop--;if(s.stop){s.stop--;return;}s.travel+=1;if(!s.wave)scBegin(s);if(s.next)s.next--;if(s.left&&s.next===0)scSpawn(s);
 for(var i=s.enemies.length-1;i>=0;i--){var e=s.enemies[i];if(!e.active){s.enemies.splice(i,1);continue;}e.age++;if(e.white)e.white--;if(e.type===1)e.x+=Math.sin(e.age*0.08+e.phase)*2.5;e.z-=scSpeed(s.wave)*(e.type===2?0.65:e.type===1?0.85:1);if(e.z<50){s.enemies.splice(i,1);s.lives--;if(!s.lives){s.over=true;s.best=Math.max(s.best,s.score);}}}
 for(i=0;i<s.particles.length;i++){var p=s.particles[i];if(!p.active)continue;p.x+=p.vx;p.y+=p.vy;if(--p.life<=0)p.active=false;}
 if(!s.over&&!s.left&&!s.enemies.length)scBegin(s);}
var SC_SKY='#081B38',SC_GROUND='#102D3D',SC_GRID='#286E80',SC_HORIZON='#91D9D8',SC_WHITE='#E8FFFF',SC_GOLD='#FFD78E',SC_RED='#FF756D';
function scLerpColor(a,b,t){t=scClamp(t,0,1);var out='#';for(var i=1;i<7;i+=2){var x=parseInt(a.slice(i,i+2),16),y=parseInt(b.slice(i,i+2),16),v=Math.round(x+(y-x)*t).toString(16);out+=(v.length<2?'0':'')+v;}return out.toUpperCase();}
function scDepthColor(base,z){return scLerpColor(base,SC_SKY,0.7*scClamp((z-100)/1900,0,1));}
/* GAME UI */
var sc=scState(),scFrame=signal(0),scRoot=View({style:{width:480,height:480,background:SC_SKY,scroll:'none'}});
function scLine(c,x1,y1,x2,y2,col,w){var dx=x2-x1,dy=y2-y1,t0=0,t1=1,a=[-dx,dx,-dy,dy],b=[x1,479-x1,y1,479-y1];for(var k=0;k<4;k++){if(a[k]===0){if(b[k]<0)return;}else{var t=b[k]/a[k];if(a[k]<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);}}if(t0>t1)return;c.line(Math.round(x1+dx*t0),Math.round(y1+dy*t0),Math.round(x1+dx*t1),Math.round(y1+dy*t1),col,w||1);}
function scWorldLine(c,x1,y1,x2,y2,col,w){var a=scRotate(x1,y1,sc.roll),b=scRotate(x2,y2,sc.roll);scLine(c,a[0],a[1],b[0],b[1],col,w);}
function scShipLine(c,x,y,r,pts,col,w){for(var k=0;k<pts.length-2;k+=2)scLine(c,x+pts[k]*r,y+pts[k+1]*r,x+pts[k+2]*r,y+pts[k+3]*r,col,w);}
/* Each silhouette is a continuous 12+ segment airframe outline. */
var SC_SHIPS=[
 [0,-1, .22,-.24, .75,.36, .37,.29, .22,.65, .08,.55, 0,.84, -.08,.55, -.22,.65, -.37,.29, -.75,.36, -.22,-.24, 0,-1],
 [0,-1, .16,-.53, .31,-.31, .97,.20, .92,.40, .31,.29, .27,.72, .12,.60, 0,.82, -.12,.60, -.27,.72, -.31,.29, -.92,.40, -.97,.20, -.31,-.31, -.16,-.53, 0,-1],
 [0,-.95, .29,-.82, .39,-.36, 1,.01, 1,.37, .52,.33, .51,.77, .32,.77, .27,.49, .12,.47, 0,.82, -.12,.47, -.27,.49, -.32,.77, -.51,.77, -.52,.33, -1,.37, -1,.01, -.39,-.36, -.29,-.82, 0,-.95]
];
function scStar(i){return {x:((i*127+37)*73)%460-230,y:((i*83+19)*47)%209-228};}
function scDraw(c){scFrame();var i,e,p,r,x,y,z,t,col,near=false,lead=null,leadZ=9999;
 c.clear();c.fillColor(SC_SKY);c.fillRect(0,0,480,480);
 /* Sparse starfield and horizon haze share the world's roll. */
 for(i=0;i<40;i++){p=scStar(i);var sp=scRotate(p.x,p.y,sc.roll*0.12);if(sp[0]>=2&&sp[0]<478&&sp[1]>=2&&sp[1]<239)c.circle(Math.round(sp[0]),Math.round(sp[1]),i%5===0?2:1,i%5===0?'#A9DDEB':'#537D9F');}
 for(i=0;i<20;i++){y=247+i*14;scWorldLine(c,-360,y-240,360,y-240,i<3?'#173B4B':SC_GROUND,12);}
 scWorldLine(c,-360,5,360,5,SC_HORIZON,2);
 /* Perspective: longitudinal rails converge to a single vanishing point. */
 for(i=-6;i<=6;i++)scWorldLine(c,0,5,i*94,360,i===0?'#4EB7BD':SC_GRID,1);
 for(i=0;i<6;i++){z=((i/6+sc.travel*.012)%1);t=z*z;scWorldLine(c,-360,7+t*350,360,7+t*350,scLerpColor(SC_GRID,SC_HORIZON,t*.35),1);}
 for(i=0;i<5;i++){z=((i*.2+sc.travel*.048)%1);y=28+z*z*330;scWorldLine(c,(i-2)*70,y,(i-2)*70+z*16,y+9+z*22,'#65C5CA',1);}
 for(i=0;i<sc.enemies.length;i++){e=sc.enemies[i];p=scProject(e.x,e.y,e.z,sc.pitch*5,sc.pitch*3,sc.roll);r=scClamp(scRadius(e),3,94);if(e.z<leadZ){lead=e;leadZ=e.z;}
  if(Math.abs(p.x-240)<42+scRadius(e)&&Math.abs(p.y-240)<42+scRadius(e))near=true;
  if(p.x<-95||p.x>575||p.y<-95||p.y>575)continue;
  x=Math.round(p.x);y=Math.round(p.y);col=e.white?SC_WHITE:scDepthColor(e.type===2?'#F7AD73':e.type===1?'#F17579':'#7DDCDA',e.z);
  if(r>20){scLine(c,x-r*.88,y+r*.27,x,y+r*.10,scDepthColor('#325974',e.z),Math.max(2,Math.round(r*.17)));scLine(c,x,y+r*.10,x+r*.88,y+r*.27,scDepthColor('#325974',e.z),Math.max(2,Math.round(r*.17)));}
  scShipLine(c,x,y,r,SC_SHIPS[e.type],col,Math.max(1,Math.round(r/23)));
  scShipLine(c,x,y,r,[0,-.79,0,.55],scDepthColor('#C6F7F5',e.z),Math.max(1,Math.round(r/28)));
  if(r>12){scShipLine(c,x,y,r,[-.25,.30,0,.07,.25,.30],scDepthColor('#E9FFFF',e.z),1);scShipLine(c,x,y,r,[-.32,.53,-.22,.65,.22,.65,.32,.53],scDepthColor('#2B637A',e.z),1);}
  if(x>=3&&x<477&&y>=3&&y<477)c.circle(x,y,Math.max(2,Math.round(r*.15)),scDepthColor('#FFE4B1',e.z));
 }
 for(i=0;i<sc.particles.length;i++){p=sc.particles[i];if(p.active){col=p.kind===0?(p.life>3?'#FFFFFF':'#FFC26B'):(p.life>7?'#FFAA70':'#B9605E');if(p.x>=8&&p.x<472&&p.y>=8&&p.y<472)c.circle(Math.round(p.x),Math.round(p.y),p.kind===0?Math.max(2,8-p.life):2,col);if(p.kind===1)scLine(c,p.x,p.y,p.x-p.vx*1.5,p.y-p.vy*1.5,col,1);}}
 /* Cockpit, swept wings, twin exhausts and attitude-linked plume. */
 scShipLine(c,240,390,62,[0,-.75,.18,-.25,.75,.20,.90,.33,.32,.24,.26,.65,.12,.55,0,.78,-.12,.55,-.26,.65,-.32,.24,-.90,.33,-.75,.20,-.18,-.25,0,-.75],'#78D6DD',3);
 scShipLine(c,240,390,62,[0,-.70,0,.54],SC_WHITE,2);scShipLine(c,240,390,62,[-.11,-.15,0,-.48,.11,-.15,0,.03,-.11,-.15],'#BAF4F3',2);
 for(i=-1;i<=1;i+=2){x=240+i*19;scLine(c,x,426,x+i*sc.roll*.10,435+Math.abs(sc.roll)*.11,'#53D7F1',3);c.circle(x,426,4,'#E7FAFD');}
 var sight=near?21:28,scol=near?SC_RED:SC_GOLD;c.circle(240,240,sight,scol);for(i=0;i<4;i++){var a=i*SC_PI/2;scLine(c,240+Math.cos(a)*(sight+5),240+Math.sin(a)*(sight+5),240+Math.cos(a)*(sight+17),240+Math.sin(a)*(sight+17),scol,2);}
 if(near)c.text(195,194,'LOCKING',SC_RED,14);
 if(lead&&lead.z>750){p=scProject(lead.x,lead.y,lead.z,sc.pitch*5,sc.pitch*3,sc.roll);var a=Math.atan2(p.y-240,p.x-240),ax=240+Math.cos(a)*213,ay=240+Math.sin(a)*195;scShipLine(c,ax,ay,7,[1,0,-.6,-.6,-.3,0,-.6,.6,1,0],SC_RED,2);}
 if(sc.flash)for(i=0;i<2;i++)scLine(c,240+(i?9:-9),365,240,240,SC_GOLD,2);
 c.fillColor('#071627');c.fillRect(9,8,462,56);
 c.text(18,14,'SKYCOMBAT // 03',SC_WHITE,14);c.text(18,39,'SCORE '+sc.score+'   WAVE '+sc.wave,sc.scorePop?SC_GOLD:SC_WHITE,sc.scorePop?18:14);
 c.text(365,17,'LIVES '+sc.lives,SC_GOLD,14);c.text(405,40,sc.sim?'SIM':'IMU',SC_GOLD,14);
 c.text(18,448,sc.over?'GAME OVER  TAP TO RESTART':'TAP FIRE  TILT TO AIM',SC_WHITE,14);
 if(sc.over){c.fillColor('#061423');c.fillRect(85,165,310,128);c.text(154,180,'MISSION OVER',SC_GOLD,14);c.text(130,218,'SCORE '+sc.score+'  WAVE '+sc.wave,SC_WHITE,14);c.text(177,251,'BEST '+sc.best,SC_WHITE,14);}
}
Canvas({parent:scRoot,width:480,height:480,onDraw:scDraw});
function scTick(){var sample=null;try{if(lume.imu&&lume.imu.read)sample=lume.imu.read();}catch(err){}
 if(scMotion(sc.cal,sample,SC_DT)){sc.sim=false;sc.roll=sc.cal.roll;sc.pitch=sc.cal.pitch;}
 else{sc.sim=true;var t=sc.tick*SC_DT/1000;sc.roll=Math.sin(t*0.7)*25;sc.pitch=Math.sin(t*0.5)*12;}
 scStep(sc);scFrame.set(scFrame()+1);}
lume.gesture.on(scRoot,'tap',function(){sc=scFire(sc);scFrame.set(scFrame()+1);});
var scTimer=null;function scStart(){if(scTimer===null)scTimer=lume.system.setInterval(scTick,SC_DT);}function scStop(){if(scTimer!==null){lume.system.clearInterval(scTimer);scTimer=null;}}
lume.app.onPause(scStop);lume.app.onResume(scStart);scStart();
