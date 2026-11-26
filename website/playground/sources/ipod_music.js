/* r155 ClickWheel music UI. DEMO: transport and progress are visual only; no audio output.
 * r200: aligned to docs/DESIGN-TOKENS.md for round 480x480 screens (all titles,
 * track rows, playback dial and ClickWheel sit inside global [75, 405]). */
import '../../runtime/shell.js';

lume.theme.set({colors:{bg:'#0D1420',primary:'#0D1420',surface:'#16202E',
  surfaceAlt:'#1F2C3D',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',
  danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:0});

var tracks = [
  {name:'Paper Satellites',seconds:194}, {name:'Copper Rain',seconds:207},
  {name:'Afterglow Harbor',seconds:181}, {name:'Low Tide Signals',seconds:228},
  {name:'Glass Orchard',seconds:203}, {name:'Midnight Current',seconds:216},
  {name:'Soft Neon Road',seconds:188}, {name:'Cloudline Echo',seconds:199},
  {name:'Blue Hour Engine',seconds:211}, {name:'Quiet Frequency',seconds:176}
];
var selected = signal(0), page = signal('list'), position = signal(0), playing = signal(false);
var root = View({style:{x:0,y:0,width:480,height:480,padding:0,gap:0,background:'primary',scroll:'none'}});
Text({parent:root,text:function(){return page()==='list'?'LUME MUSIC':'NOW PLAYING';},
  style:{x:80,y:76,width:320,height:24,fontSize:20,color:'text',textAlign:'center',scroll:'none'}});
Text({parent:root,text:'DEMO - UI ONLY / NO AUDIO',
  style:{x:80,y:100,width:320,height:18,fontSize:14,color:'textDim',textAlign:'center',scroll:'none'}});

/* Five rows scroll around the selected track inside global [80..400] x [122..260]. */
for (var row=0;row<5;row++) (function(slot){
  var y=122+slot*28;
  View({parent:root,style:{position:'absolute',x:80,y:y,width:320,height:25,
    padding:0,gap:0,borderRadius:8,
    background:function(){
      if(page()!=='list')return 'primary';
      var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
      return first+slot===selected()?'#117B69':'surface';
    },
    borderWidth:1,
    borderColor:function(){
      if(page()!=='list')return '#0D1420';
      var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
      return first+slot===selected()?'#40D8B0':'#16202E';
    },scroll:'none'}});
  Text({parent:root,text:function(){
    if(page()!=='list')return '';
    var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
    var idx=first+slot;
    return (idx+1<10?'0':'')+(idx+1)+'  '+tracks[idx].name;
  },style:{x:90,y:y+3,width:300,height:20,fontSize:16,borderRadius:0,color:'text',scroll:'none'}});
})(row);

/* The progress dial is drawn on the playback page inside the safe area. */
Canvas({parent:root,width:108,height:108,style:{position:'absolute',x:186,y:122,borderRadius:54,opacity:function(){return page()==='play'?1:0;},scroll:'none'},
  onDraw:function(c){
    c.clear();
    if(page()!=='play')return;
    var colors=lume.theme.get().colors;
    c.arc(54,54,44,-90,270,10,colors.surfaceAlt);
    var fraction=position()/tracks[selected()].seconds;
    if(fraction>0)c.arc(54,54,44,-90,-90+360*fraction,10,colors.accent);
    c.fillCircle(54,54,32,colors.surface);
    c.text(32,47,playing()?'PLAY':'PAUSE',colors.text);
  }});
Text({parent:root,text:function(){return page()==='play'?tracks[selected()].name:'';},
  style:{x:80,y:232,width:320,height:24,fontSize:18,color:'text',textAlign:'center',scroll:'none'}});
function stamp(t){var m=Math.floor(t/60),s=t%60;return m+':'+(s<10?'0':'')+s;}
Text({parent:root,text:function(){return page()==='play'?stamp(position())+' / '+stamp(tracks[selected()].seconds):'';},
  style:{x:80,y:256,width:320,height:20,fontSize:14,color:'textDim',textAlign:'center',scroll:'none'}});

function rotate(steps){
  if(page()==='list')selected.set(Math.max(0,Math.min(tracks.length-1,selected()+steps)));
  else position.set(Math.max(0,Math.min(tracks[selected()].seconds,position()+steps*5)));
}
function center(){if(page()==='list'){position.set(0);playing.set(true);page.set('play');}}
function outer(q){
  if(q===0){page.set('list');playing.set(false);}
  else if(q===1&&page()==='play')playing.set(!playing());
  else if((q===2||q===3)&&page()==='play'){
    selected.set((selected()+(q===2?-1:1)+tracks.length)%tracks.length);
    position.set(0);
  }
}
/* ClickWheel inside safe bounds: cy=342, outerR=62 -> y in [280, 404] <= 405;
 * innerR=24 -> 48 px diameter center target. */
var wheel=lume.ui.shell.ClickWheel({parent:root,cx:240,cy:342,outerR:62,innerR:24,
  onRotate:rotate,onCenterTap:center,onOuterTap:outer});
lume.system.setInterval(function(){
  if(page()==='play'&&playing()){
    var next=position()+1;
    if(next>=tracks[selected()].seconds){playing.set(false);position.set(tracks[selected()].seconds);}
    else position.set(next);
  }
},1000);
/* Exposed for host harness and simulator inspection. */
globalThis.musicDemo={tracks:tracks,selected:selected,page:page,position:position,playing:playing,wheel:wheel};
