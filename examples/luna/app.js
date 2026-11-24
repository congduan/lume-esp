/* Luna r182. NASA LROC WAC RGB565 globe; JS app layer only. */
import {MOON_TEX} from './moon_tex.js';
var LU_PI=Math.PI,LU_RAD=LU_PI/180,LU_SIZE=320,LU_R=156;
var LU_NEW_MOON_JD=2451550.26,LU_SYNODIC=29.530588853;
function luWrap(x){return (x%360+360)%360;}
function luClamp(x,a,b){return Math.max(a,Math.min(b,x));}
function luSin(x){return Math.sin(x*LU_RAD);}
function luJD(ms){return ms/86400000+2440587.5;}
/* Simplified Meeus geocentric ecliptic longitudes, roughly one day accuracy. */
function moonPhase(jd){
 var t=jd-LU_NEW_MOON_JD+5.26,mm=134.963+13.064993*t,d=297.850+12.190749*t,f=93.272+13.229350*t;
 var lm=218.316+13.176396*t,ms=357.52911+.98560028*t,ls=280.46646+.98564736*t;
 var moon=lm+6.289*luSin(mm)+1.274*luSin(2*d-mm)+.658*luSin(2*d)+.214*luSin(2*mm)-.186*luSin(ms)-.114*luSin(2*f);
 var sun=ls+1.914602*luSin(ms)+.019993*luSin(2*ms);
 var phase=luWrap(moon-sun)/360;
 return {phase:phase,moonAgeDays:phase*LU_SYNODIC};
}
var LU_NAMES=['NEW MOON','WAXING CRESCENT','FIRST QUARTER','WAXING GIBBOUS','FULL MOON','WANING GIBBOUS','LAST QUARTER','WANING CRESCENT'];
function phaseName(p){return LU_NAMES[Math.floor(luWrap(p*360+22.5)/45)];}
function terminatorLon(phase,rot){return luWrap(rot+90-phase*360);}
/* 27.55455-day anomalistic cycle, anchored at the 2024 April perigee window. */
function moonDistance(jd){return 381600-25100*Math.cos(2*LU_PI*(jd-2460407.5)/27.55455);}
function luDecode(b64){var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',lut={},out=new Uint8Array(65536),n=0,v=0,bits=0;for(var i=0;i<chars.length;i++)lut[chars[i]]=i;for(i=0;i<b64.length;i++){var q=lut[b64[i]];if(q===undefined)break;v=(v<<6)|q;bits+=6;if(bits>=8){bits-=8;out[n++]=(v>>bits)&255;}}return out;}
var luTexBytes=luDecode(MOON_TEX.base64),luTex=new Uint16Array(256*128);
for(var luI=0;luI<luTex.length;luI++)luTex[luI]=luTexBytes[luI*2]|luTexBytes[luI*2+1]<<8;
function luSample(lon,lat){
 var fx=luWrap(lon+180)*MOON_TEX.w/360,fy=luClamp((90-lat)*MOON_TEX.h/180,0,MOON_TEX.h-1.001);
 var x0=Math.floor(fx),y0=Math.floor(fy),x1=(x0+1)%MOON_TEX.w,y1=Math.min(y0+1,MOON_TEX.h-1),a=fx-x0,b=fy-y0;
 var p00=luTex[y0*256+x0],p10=luTex[y0*256+x1],p01=luTex[y1*256+x0],p11=luTex[y1*256+x1];
 var w00=(1-a)*(1-b),w10=a*(1-b),w01=(1-a)*b,w11=a*b;
 var r=((p00>>11)*w00+(p10>>11)*w10+(p01>>11)*w01+(p11>>11)*w11+.5)|0;
 var g=(((p00>>5)&63)*w00+((p10>>5)&63)*w10+((p01>>5)&63)*w01+((p11>>5)&63)*w11+.5)|0;
 var blue=((p00&31)*w00+(p10&31)*w10+(p01&31)*w01+(p11&31)*w11+.5)|0;
 return r<<11|g<<5|blue;
}
function luLatitude(ny,pitch){return Math.asin(luClamp(ny*Math.cos(pitch*LU_RAD)+Math.sqrt(Math.max(0,1-ny*ny))*Math.sin(pitch*LU_RAD),-1,1))/LU_RAD;}
function luShade(pixel,light){var r=Math.max(1,Math.min(31,Math.round(((pixel>>11)&31)*light))),g=Math.max(1,Math.min(63,Math.round(((pixel>>5)&63)*light))),b=Math.max(1,Math.min(31,Math.round((pixel&31)*light)));return r<<11|g<<5|b;}
function luInertia(v){v*=.72;return Math.abs(v)<.1?0:v;}
var lu={rot:0,pitch:0,phase:.38,age:.38*LU_SYNODIC,distance:384400,live:false,card:false,vx:0,drag:false,lastDx:0,lastDy:0,lastTap:0,draws:0};
function luClock(){var now=0;try{now=lume.system.time();}catch(e){}var live=typeof now==='number'&&now>1577836800000;
 var p=live?moonPhase(luJD(now)):{phase:.38,moonAgeDays:.38*LU_SYNODIC};
 var changed=live!==lu.live||Math.abs(p.phase-lu.phase)>.0001;
 lu.live=live;lu.phase=p.phase;lu.age=p.moonAgeDays;lu.distance=live?moonDistance(luJD(now)):384400;
 return changed;
}
function luTrySync(){if(lu.live)return;try{var st=lume.net.status();if(st&&st.state===lume.net.GOT_IP)lume.system.setTimeNtp();}catch(e){}luClock();}
luClock();
luTrySync();
var luFrame=signal(0),luRoot=View({style:{width:480,height:480,background:'#030711',scroll:'none'}});
var luPixels=new Uint16Array(LU_SIZE*LU_SIZE);
function luRender(){
 var pitch=lu.pitch*LU_RAD,cp=Math.cos(pitch),sp=Math.sin(pitch),sun=lu.phase*2*LU_PI;
 var sx=Math.sin(sun),sz=-Math.cos(sun),rot=lu.rot;
 luPixels.fill(0);
 /* Two pixel row strips: inverse sphere, equirectangular bilinear sample,
  * solar incidence, then limb falloff. One retained bitmap is submitted. */
 for(var y=4;y<316;y+=2){var ny=(LU_SIZE/2-y-1)/LU_R,ry=ny*ny;if(ry>=1)continue;
  var width=Math.sqrt(1-ry)*LU_R;
  for(var x=Math.ceil(160-width);x<Math.floor(160+width);x+=2){var nx=(x+1-160)/LU_R,r2=nx*nx+ry;if(r2>=1)continue;
   var z=Math.sqrt(1-r2),worldY=ny*cp+z*sp,worldZ=z*cp-ny*sp;
   var lat=Math.asin(luClamp(worldY,-1,1))/LU_RAD,lon=rot+Math.atan2(nx,worldZ)/LU_RAD;
   var solar=nx*sx+z*sz,twilight=luClamp((solar+.28)/.56,0,1);
   twilight=twilight*twilight*(3-2*twilight);
   var limb=luClamp((1-Math.sqrt(r2)-.02)/.14,0,1);
   var light=(.25+.75*twilight)*(.48+.52*limb);
   var pixel=luShade(luSample(lon,lat),light),j=y*320+x;
   luPixels[j]=pixel;luPixels[j+1]=pixel;luPixels[j+320]=pixel;luPixels[j+321]=pixel;
  }
 }
}
function luStar(i){return {x:((i*127+37)*73)%480,y:((i*83+19)*47)%480};}
function luDraw(c){luFrame();lu.draws++;c.fillColor('#030711');c.fillRect(0,0,480,480);
 for(var i=0;i<40;i++){var p=luStar(i),x=(p.x-lu.rot*.08%480+480)%480;if(x>32&&x<448&&p.y>38&&p.y<442)c.fillCircle(Math.round(x),p.y,i%7===0?2:1,i%7===0?'#B7C9E3':'#53647C');}
 c.fillCircle(240,240,166,'#101A2B');luRender();c.retainImage(1,320,320,luPixels);c.drawImage(1,80,80);
 c.text(30,22,'LUNA  /  '+(lu.live?'LIVE':'CLOCK NOT SET'),'#DDE9F6');
 c.text(30,444,phaseName(lu.phase)+'  ·  TAP FOR DETAILS','#BCCADB');
 if(lu.card){c.fillColor('#091321');c.fillRect(60,314,360,123);c.text(79,326,phaseName(lu.phase),'#F1E8D7');c.text(79,350,'AGE  '+lu.age.toFixed(1)+' DAYS    '+Math.round(lu.distance)+' KM','#B9C8D8');c.text(79,374,'CENTER  '+Math.round(luWrap(lu.rot))+' E  /  '+Math.round(lu.pitch)+' N','#B9C8D8');c.text(79,400,lu.live?'SNTP WALL CLOCK':'EXAMPLE PHASE · SET CLOCK','#D3AA78');}
}
Canvas({parent:luRoot,width:480,height:480,onDraw:luDraw});
var luTimer=null;
function luWake(){luFrame.set(luFrame()+1);}
function luStop(){if(luTimer!==null){lume.system.clearInterval(luTimer);luTimer=null;}}
function luTick(){if(lu.drag)return;lu.vx=luInertia(lu.vx);if(!lu.vx){luStop();return;}lu.rot=luWrap(lu.rot+lu.vx);luWake();}
function luStart(){if(luTimer===null&&lu.vx)luTimer=lume.system.setInterval(luTick,50);}
lume.gesture.on(luRoot,'panstart',function(e){lu.drag=true;luStop();lu.vx=0;lu.lastDx=e.dx||0;lu.lastDy=e.dy||0;lu.prevDy=lu.lastDy;});
lume.gesture.on(luRoot,'pan',function(e){var dx=e.dx||0,dy=e.dy||0,step=dx-lu.lastDx;lu.lastDx=dx;lu.lastDy=dy;lu.rot=luWrap(lu.rot-step*.48);lu.pitch=luClamp(lu.pitch+(dy-(lu.prevDy||0))*.2,-30,30);lu.prevDy=dy;lu.vx=-step*.48;luWake();});
lume.gesture.on(luRoot,'panend',function(){lu.drag=false;lu.prevDy=0;luStart();});
lume.gesture.on(luRoot,'tap',function(){var t=Date.now();if(t-lu.lastTap<350){luClock();lu.rot=0;lu.pitch=0;lu.vx=0;luStop();lu.card=false;lu.lastTap=0;}else{lu.card=!lu.card;lu.lastTap=t;}luWake();});
lume.app.onPause(luStop);lume.app.onResume(function(){if(luClock())luWake();luStart();});
/* The wall clock may become valid after startup. Polling alone never redraws. */
lume.system.setInterval(function(){var old=lu.live;luTrySync();if(luClock()||old!==lu.live)luWake();},60000);
export {moonPhase,phaseName,terminatorLon,moonDistance,luSample,luLatitude,luInertia,luRender,lu,luPixels};
