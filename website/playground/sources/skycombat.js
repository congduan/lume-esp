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
function scParticles(){var a=[];for(var i=0;i<12;i++)a.push({active:false,x:0,y:0,vx:0,vy:0,life:0});return a;}
function scState(){return {tick:0,wave:0,left:0,lives:3,score:0,best:0,over:false,roll:0,pitch:0,sim:true,cal:scCal(),flash:0,stop:0,travel:0,enemies:[],particles:scParticles(),next:0};}
function scBegin(s){s.wave++;s.left=scWaveCount(s.wave);s.next=0;}
function scSpawn(s){if(!s.left||s.enemies.length>=SC_POOL)return;var i=s.left,type=s.wave<2?(i%3===0?1:0):((i+s.wave)%5===0?2:(i%3===0?1:0));s.enemies.push({active:true,type:type,hp:type===2?3:1,x:((i*137+s.wave*71)%601)-300,y:((i*89+s.wave*43)%281)-140,z:SC_FAR,phase:i*1.7,age:0,white:0});s.left--;s.next=17;}
function scBurst(s,x,y){for(var i=0;i<6;i++){var a=i*SC_PI/3;for(var j=0;j<s.particles.length;j++)if(!s.particles[j].active){var p=s.particles[j];p.active=true;p.x=x;p.y=y;p.vx=Math.cos(a)*3;p.vy=Math.sin(a)*3;p.life=12;break;}}}
function scFire(s){if(s.over){var best=s.best;s=scState();s.best=best;return s;}s.flash=5;for(var i=0;i<s.enemies.length;i++){var e=s.enemies[i],p=scProject(e.x,e.y,e.z,s.pitch*5,s.pitch*3,s.roll);if(scHit(e,p)){e.hp--;e.white=4;s.stop=3;if(e.hp<=0){scBurst(s,p.x,p.y);e.active=false;s.score+=(e.type===2?300:e.type===1?150:80)*s.wave;s.best=Math.max(s.best,s.score);}break;}}return s;}
function scStep(s){if(s.over)return;s.tick++;if(s.flash)s.flash--;if(s.stop){s.stop--;return;}s.travel+=1;if(!s.wave)scBegin(s);if(s.next)s.next--;if(s.left&&s.next===0)scSpawn(s);
 for(var i=s.enemies.length-1;i>=0;i--){var e=s.enemies[i];if(!e.active){s.enemies.splice(i,1);continue;}e.age++;if(e.white)e.white--;if(e.type===1)e.x+=Math.sin(e.age*0.08+e.phase)*2.5;e.z-=scSpeed(s.wave)*(e.type===2?0.65:e.type===1?0.85:1);if(e.z<50){s.enemies.splice(i,1);s.lives--;if(!s.lives){s.over=true;s.best=Math.max(s.best,s.score);}}}
 for(i=0;i<s.particles.length;i++){var p=s.particles[i];if(!p.active)continue;p.x+=p.vx;p.y+=p.vy;if(--p.life<=0)p.active=false;}
 if(!s.over&&!s.left&&!s.enemies.length)scBegin(s);}
/* GAME UI */
var SC_SKY='#081B38',SC_GROUND='#133C42',SC_GRID='#267B80',SC_HORIZON='#91D9D8',SC_WHITE='#E8FFFF',SC_GOLD='#FFD78E',SC_RED='#FF756D';
var sc=scState(),scFrame=signal(0),scRoot=View({style:{width:480,height:480,background:SC_SKY,scroll:'none'}});
function scLine(c,x1,y1,x2,y2,col,w){var dx=x2-x1,dy=y2-y1,t0=0,t1=1,a=[-dx,dx,-dy,dy],b=[x1,479-x1,y1,479-y1];for(var k=0;k<4;k++){if(a[k]===0){if(b[k]<0)return;}else{var t=b[k]/a[k];if(a[k]<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);}}if(t0>t1)return;c.line(Math.round(x1+dx*t0),Math.round(y1+dy*t0),Math.round(x1+dx*t1),Math.round(y1+dy*t1),col,w||1);}
function scWorldLine(c,x1,y1,x2,y2,col,w){var a=scRotate(x1,y1,sc.roll),b=scRotate(x2,y2,sc.roll);scLine(c,a[0],a[1],b[0],b[1],col,w);}
function scDraw(c){scFrame();var i,e,p,r,x,y,z,t;
 c.clear();c.fillColor(SC_SKY);c.fillRect(0,0,480,480);
 /* Broad scan lines make a rotated ground half-plane without a polygon API. */
 for(i=0;i<48;i++){y=244+i*6;scWorldLine(c,-340,y-240,340,y-240,SC_GROUND,7);}
 scWorldLine(c,-340,4,340,4,SC_HORIZON,3);
 for(i=-6;i<=5;i++){scWorldLine(c,i*92,4,i*215,330,SC_GRID,1);}
 for(i=0;i<5;i++){z=(i*73+sc.travel*5)%345;var gy=15+z*z/350;scWorldLine(c,-340,gy,340,gy,SC_GRID,1);}
 for(i=0;i<sc.enemies.length;i++){e=sc.enemies[i];p=scProject(e.x,e.y,e.z,sc.pitch*5,sc.pitch*3,sc.roll);r=scRadius(e);if(p.x<0||p.x>479||p.y<0||p.y>479)continue;
  x=Math.round(p.x);y=Math.round(p.y);var w=scClamp(Math.round(r),3,90),body=e.white?SC_WHITE:e.type===2?SC_GOLD:e.type===1?'#FF9586':'#E8C8A3';
  c.fillEllipse(x,y,Math.max(2,Math.round(w*0.3)),Math.max(2,Math.round(w*0.65)),body);
  c.fillEllipse(x-Math.round(w*0.53),y,Math.max(2,Math.round(w*0.49)),Math.max(2,Math.round(w*0.12)),body);
  c.fillEllipse(x+Math.round(w*0.53),y,Math.max(2,Math.round(w*0.49)),Math.max(2,Math.round(w*0.12)),body);
  scLine(c,x,y-w-6,x,y-w-12,e.type===2?SC_GOLD:SC_RED,1);
 }
 for(i=0;i<sc.particles.length;i++){p=sc.particles[i];if(p.active)c.circle(Math.round(p.x),Math.round(p.y),2,SC_GOLD);}
 /* Player silhouette stays fixed; world alone rolls. */
 c.fillEllipse(240,389,13,32,'#263F5B');c.fillEllipse(240,382,7,20,'#A9E9E7');
 c.fillEllipse(190,400,48,6,'#65BFC6');c.fillEllipse(290,400,48,6,'#65BFC6');
 c.fillEllipse(240,420,23,5,'#34768B');
 c.circle(240,240,28,SC_GOLD);scLine(c,240,203,240,219,SC_GOLD,2);scLine(c,240,261,240,277,SC_GOLD,2);scLine(c,203,240,219,240,SC_GOLD,2);scLine(c,261,240,277,240,SC_GOLD,2);
 if(sc.flash)for(i=0;i<2;i++)scLine(c,240+(i?9:-9),365,240,240,SC_GOLD,2);
 c.text(18,15,'SKYCOMBAT 3D',SC_WHITE,14);c.text(18,39,'SCORE '+sc.score+'  WAVE '+sc.wave,SC_WHITE,14);
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
