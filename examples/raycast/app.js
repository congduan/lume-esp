/* r79 raycaster spike: one map, one native DDA render per frame. */
var rows = [
  '1111111111111111',
  '1000000000000001',
  '1000000000000001',
  '1000000020000001',
  '1000000020000001',
  '1000300000000001',
  '1000300000000001',
  '1000000000000001',
  '1000000000400001',
  '1000000000400001',
  '1000000000000001',
  '1000000000000001',
  '1000000000000001',
  '1000000000000001',
  '1000000000000001',
  '1111111111111111'
];
var map = new Uint8Array(256);
for (var y=0;y<16;y++) for(var x=0;x<16;x++) map[y*16+x]=rows[y].charCodeAt(x)-48;
lume.raycast.setMap(16,16,map);
var player={x:3.5,y:7.5,angle:-0.20};
var frame=signal(0), hud=signal('t=-- ms  -- fps    x=3.5 y=7.5');
var root=View({style:{width:480,height:480,background:'#0A1428',scroll:'none'}});
var scene=Canvas({parent:root,width:480,height:480,onDraw:function(ctx){
  frame();
  lume.raycast.render(ctx.nodeId,player.x,player.y,player.angle);
}});
Text({parent:root,text:function(){return hud();},style:{position:'absolute',x:12,y:12,width:456,height:32,fontSize:20,color:'#FFFFFF',background:'#101820'}});
Text({parent:root,text:'PAN TURN   TAP STEP',style:{position:'absolute',x:12,y:449,width:300,height:25,fontSize:14,color:'#FFFFFF',background:'#101820'}});
var panX=null;
function pan(e){if(panX!==null){player.angle+=(e.x-panX)*0.012;frame.set(frame()+1);}panX=e.x;}
function step(){var nx=player.x+Math.cos(player.angle)*0.34,ny=player.y+Math.sin(player.angle)*0.34;
  var ix=Math.floor(nx),iy=Math.floor(ny);
  if(ix>=0&&iy>=0&&ix<16&&iy<16&&map[iy*16+ix]===0){player.x=nx;player.y=ny;frame.set(frame()+1);}
}
lume.gesture.on(root,'panstart',function(e){panX=e.x;});
lume.gesture.on(root,'pan',pan);
lume.gesture.on(root,'panend',function(){panX=null;});
lume.gesture.on(root,'tap',step);
lume.gesture.on(scene,'panstart',function(e){panX=e.x;});
lume.gesture.on(scene,'pan',pan);
lume.gesture.on(scene,'panend',function(){panX=null;});
lume.gesture.on(scene,'tap',step);
var last=Date.now(),count=0,timer=null;
function tick(){frame.set(frame()+1);count++;if(count%15===0){var now=Date.now(),ms=(now-last)/15;last=now;
  hud.set('t='+ms.toFixed(1)+' ms  '+(1000/ms).toFixed(1)+' fps  x='+player.x.toFixed(1)+' y='+player.y.toFixed(1));}}
function start(){if(timer===null){last=Date.now();count=0;timer=lume.system.setInterval(tick,20);}}
function stop(){if(timer!==null){lume.system.clearInterval(timer);timer=null;}}
lume.app.onPause(stop);lume.app.onResume(start);start();
