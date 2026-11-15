/** A single task per screen: count taps. */
var darkTheme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
var lightTheme = { colors: {
  bg:'#EAF2F7', primary:'#EAF2F7', surface:'#FFFFFF', surfaceAlt:'#DDEAF0',
  text:'#183247', textDim:'#617C90', accent:'#117B69', danger:'#C7485A', success:'#117B69'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(darkTheme);
var count = signal(0);
var dim = signal(false);
var darkButton, lightButton;
var card = View({ style: {
  width:'100%', height:208, background:'surface', borderRadius:20,
  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8,
  opacity:function(){ return dim() ? 0.7 : 1; }
}}, [
  Text({text:'TOTAL TAPS',style:{fontSize:13,color:'textDim'}}),
  Text({text:function(){return String(count());},style:{fontSize:48,color:'text'}}),
  Text({text:'Every touch counts',style:{fontSize:13,color:'textDim'}})
]);
View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:24,gap:16}},[
  View({style:{width:'100%',height:72,display:'flex',flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:0,gap:8}},[
    View({style:{width:180,height:72,display:'flex',flexDirection:'column',justifyContent:'center',padding:0,gap:4}},[
      Text({text:'Counter',style:{fontSize:24,color:'text'}}),
      Text({text:'A little daily tally',style:{fontSize:13,color:'textDim'}})
    ]),
    View({style:{width:152,height:56,display:'flex',flexDirection:'row',background:'surfaceAlt',borderRadius:999,padding:0,gap:0}},[
      darkButton=Button({title:'Dark',style:{width:76,height:56,borderRadius:999,background:'surface'},onPress:function(){lume.theme.set(darkTheme);}}),
      lightButton=Button({title:'Light',style:{width:76,height:56,borderRadius:999,background:'surface'},onPress:function(){lume.theme.set(lightTheme);}})
    ])
  ]),
  card,
  View({style:{width:'100%',height:88,display:'flex',flexDirection:'column',padding:0,gap:8}},[
    Button({title:'Add one',style:{width:'100%',height:56,borderRadius:999,background:'accent'},
      onPress:function(){count.set(count()+1);dim.set(count()%2===1);}}),
    Text({text:'TAP TO INCREMENT',style:{width:'100%',fontSize:11,color:'textDim',textAlign:'center'}})
  ])
]);
