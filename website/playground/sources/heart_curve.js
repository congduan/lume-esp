/** Simulated pulse history. */
import '../../runtime/shell.js';
var heartTheme={colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:12,fontScale:1};
lume.theme.set(heartTheme);
var samples=signal([28,31,26,38,45,39,54,61,58,72,64,77]);
var tick=signal(0);
/* r194: hand-rolled Canvas polyline replaced by shell.Sparkline. `samples`
 * remains the caller-owned signal, read by the component inside onDraw. The
 * old surface fill and baseline hairline were visual-only; auto min/max keeps
 * the same relative pulse shape and showDots keeps a marker per sample. */
var chart=lume.ui.shell.Sparkline({width:304,height:116,x:12,y:62,data:samples,strokeWidth:3,showDots:true});
View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:76,gap:8}},[
  View({style:{width:'100%',height:44,display:'flex',flexDirection:'column',padding:0,gap:2}},[
    Text({text:'Heart curve',style:{fontSize:20,color:'text',borderRadius:0}}),
    Text({text:'Simulated pulse',style:{fontSize:12,color:'textDim',borderRadius:0}})
  ]),
  View({style:{width:'100%',height:216,background:'surface',borderRadius:12,padding:12,display:'flex',flexDirection:'column',justifyContent:'space-between',gap:6}},[
    View({style:{width:'100%',height:44,display:'flex',flexDirection:'row',alignItems:'center',padding:0,gap:8}},[
      Text({text:function(){return String(samples()[samples().length-1]);},style:{fontSize:32,color:'text',borderRadius:0}}),
      Text({text:'BPM  /  latest',style:{fontSize:12,color:'textDim',borderRadius:0}})
    ]),
    chart,
    Text({text:function(){return 'Pulse    /    '+tick()+' new samples';},style:{fontSize:12,color:'textDim',borderRadius:0}})
  ]),
  Button({title:'Next sample',style:{width:'100%',height:48,background:'accent',borderRadius:12},onPress:function(){var n=tick()+1;var old=samples();samples.set(old.slice(1).concat([35+((n*37)%50)]));tick.set(n);}})
]);
