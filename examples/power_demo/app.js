/** Touch activity keeps the panel awake; idle 15 seconds enters light sleep. */
var powerTheme={colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:12,fontScale:1};
lume.theme.set(powerTheme);
var lastActivity=lume._nowMs();
var state=signal('awake at '+Math.floor(lastActivity));
var netStatus=lume.net.deinit();
var touch=function(){lastActivity=lume._nowMs();};
View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:32,gap:16},onPress:touch},[
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'Power',style:{fontSize:24,color:'text'}}),
    Text({text:'Sleep and wake status',style:{fontSize:13,color:'textDim'}})
  ]),
  View({style:{width:'100%',height:224,background:'surface',borderRadius:20,padding:24,display:'flex',flexDirection:'column',justifyContent:'center',gap:12}},[
    Text({text:'CURRENT STATE',style:{fontSize:13,color:'textDim'}}),
    Text({text:function(){return state().indexOf('awake')===0?'Awake':state().indexOf('sleep')===0?'Asleep':'Attention';},style:{fontSize:40,color:'success'}}),
    Text({text:function(){return state();},style:{fontSize:13,color:'textDim',longMode:'wrap'}})
  ]),
  View({style:{width:'100%',height:96,display:'flex',flexDirection:'column',padding:0,gap:8}},[
    Button({title:'Keep awake',style:{width:'100%',height:56,background:'accent',borderRadius:999},onPress:touch}),
    Text({text:'Sleeps after 15 seconds idle',style:{width:'100%',fontSize:13,color:'textDim',textAlign:'center'}})
  ])
]);
if(netStatus!==0)state.set('WiFi deinit error '+netStatus);
lume.power.onWake(function(){lastActivity=lume._nowMs();state.set('awake at '+Math.floor(lume._nowMs()));});
lume.system.setInterval(function(){if(lume._nowMs()-lastActivity<15000)return;var status=lume.power.sleepNow();if(status<0){state.set('sleep error '+status);lastActivity=lume._nowMs();}},1000);
