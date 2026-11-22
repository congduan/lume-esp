/* r155 ClickWheel music UI. DEMO: transport and progress are visual only; no audio output. */
import '../../runtime/shell.js';

lume.theme.set({colors:{bg:'#08111E',primary:'#08111E',surface:'#173047',
  surfaceAlt:'#24465D',text:'#F2F7FB',textDim:'#A7BCCC',accent:'#55D7B5',
  danger:'#FF7180',success:'#55D7B5'},radius:16,spacing:0});

var tracks = [
  {name:'Paper Satellites',seconds:194}, {name:'Copper Rain',seconds:207},
  {name:'Afterglow Harbor',seconds:181}, {name:'Low Tide Signals',seconds:228},
  {name:'Glass Orchard',seconds:203}, {name:'Midnight Current',seconds:216},
  {name:'Soft Neon Road',seconds:188}, {name:'Cloudline Echo',seconds:199},
  {name:'Blue Hour Engine',seconds:211}, {name:'Quiet Frequency',seconds:176}
];
var selected = signal(0), page = signal('list'), position = signal(0), playing = signal(false);
var root = View({style:{x:0,y:0,width:480,height:480,background:'primary',scroll:'none'}});
Text({parent:root,text:function(){return page()==='list'?'LUME MUSIC':'NOW PLAYING';},
  style:{x:38,y:23,width:404,height:34,fontSize:22,color:'text',textAlign:'center'}});
Text({parent:root,text:'DEMO - UI ONLY / NO AUDIO',
  style:{x:70,y:55,width:340,height:25,fontSize:13,color:'textDim',textAlign:'center'}});

/* Five rows scroll around the selected track; state belongs to the app. */
for (var row=0;row<5;row++) (function(slot){
  var y=85+slot*34;
  View({parent:root,style:{position:'absolute',x:61,y:y,width:358,height:31,
    borderRadius:8,background:function(){
      if(page()!=='list')return 'primary';
      var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
      return first+slot===selected()?'accent':'surface';
    },scroll:'none'}});
  Text({parent:root,text:function(){
    if(page()!=='list')return '';
    var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
    var idx=first+slot;
    return (idx+1<10?'0':'')+(idx+1)+'  '+tracks[idx].name;
  },style:{x:72,y:y+4,width:336,height:26,fontSize:18,
    color:function(){
      var first=Math.max(0,Math.min(tracks.length-5,selected()-2));
      return page()==='list'&&first+slot===selected()?'primary':'text';
    }}});
})(row);

/* The large progress dial is drawn on the playback page only. */
Canvas({parent:root,width:156,height:156,style:{position:'absolute',x:162,y:75,borderRadius:78,opacity:function(){return page()==='play'?1:0;},scroll:'none'},
  onDraw:function(c){
    c.clear();
    if(page()!=='play')return;
    var colors=lume.theme.get().colors;
    c.arc(78,78,63,-90,270,12,colors.surfaceAlt);
    var fraction=position()/tracks[selected()].seconds;
    if(fraction>0)c.arc(78,78,63,-90,-90+360*fraction,12,colors.accent);
    c.fillCircle(78,78,46,colors.surface);
    c.text(50,72,playing()?'PLAY':'PAUSE',colors.text);
  }});
Text({parent:root,text:function(){return page()==='play'?tracks[selected()].name:'';},
  style:{x:45,y:232,width:390,height:30,fontSize:21,color:'text',textAlign:'center'}});
function stamp(t){var m=Math.floor(t/60),s=t%60;return m+':'+(s<10?'0':'')+s;}
Text({parent:root,text:function(){return page()==='play'?stamp(position())+' / '+stamp(tracks[selected()].seconds):'';},
  style:{x:75,y:258,width:330,height:27,fontSize:16,color:'textDim',textAlign:'center'}});

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
var wheel=lume.ui.shell.ClickWheel({parent:root,cx:240,cy:380,outerR:95,innerR:36,
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
