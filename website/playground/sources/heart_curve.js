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
var chart=lume.ui.shell.Sparkline({width:400,height:152,data:samples,strokeWidth:3,showDots:true});
View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:24,gap:12}},[
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[Text({text:'Heart curve',style:{fontSize:24,color:'text'}}),Text({text:'Simulated pulse',style:{fontSize:13,color:'textDim'}})]),
  View({style:{width:'100%',height:264,background:'surface',borderRadius:20,padding:16,display:'flex',flexDirection:'column',gap:8}},[
    View({style:{width:'100%',height:64,display:'flex',flexDirection:'row',alignItems:'center',padding:0,gap:8}},[
      Text({text:function(){return String(samples()[samples().length-1]);},style:{fontSize:48,color:'text'}}),
      Text({text:'BPM  /  latest',style:{fontSize:13,color:'textDim'}})
    ]),chart,Text({text:function(){return 'Pulse    /    '+tick()+' new samples';},style:{fontSize:13,color:'textDim'}})
  ]),
  Button({title:'Next sample',style:{width:'100%',height:56,background:'accent',borderRadius:999},onPress:function(){var n=tick()+1;var old=samples();samples.set(old.slice(1).concat([35+((n*37)%50)]));tick.set(n);}})
]);
