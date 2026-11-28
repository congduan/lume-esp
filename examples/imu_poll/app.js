/** Clock + IMU polling. The interval is owned by this app and stops on pause. */
var imuTheme={colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:12,fontScale:1};
lume.theme.set(imuTheme);
var seconds=signal(0);
var motion=signal('IMU: waiting');
var axisX=signal('--'),axisY=signal('--'),axisZ=signal('--');
var pollId=null;
function poll(){seconds.set(seconds()+1);var sample=lume.imu.read();motion.set(sample?'az: '+sample.az.toFixed(2)+' m/s2':'IMU unavailable');if(sample){axisX.set(sample.ax.toFixed(2));axisY.set(sample.ay.toFixed(2));axisZ.set(sample.az.toFixed(2));}}
function startPolling(){if(pollId===null)pollId=lume.system.setInterval(poll,1000);}
function stopPolling(){if(pollId!==null)lume.system.clearInterval(pollId);pollId=null;}
lume.app.onStart(startPolling);lume.app.onPause(stopPolling);lume.app.onResume(startPolling);
function axis(label,value){return View({style:{width:124,height:152,background:'surface',borderRadius:12,padding:12,display:'flex',flexDirection:'column',justifyContent:'center',gap:8}},[
  Text({text:label,style:{fontSize:12,color:'textDim',borderRadius:0}}),Text({text:value,style:{fontSize:20,color:'text',borderRadius:0}})
]);}
View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:44,gap:12}},[
  View({style:{width:'100%',height:44,display:'flex',flexDirection:'column',padding:0,gap:2}},[
    Text({text:'Motion',style:{fontSize:20,color:'text',borderRadius:0}}),
    Text({text:'Live accelerometer',style:{fontSize:12,color:'textDim',borderRadius:0}})
  ]),
  View({style:{width:'100%',height:212,display:'flex',flexDirection:'column',padding:0,gap:12}},[
    View({style:{width:'100%',height:152,display:'flex',flexDirection:'row',padding:0,gap:10}},[axis('X  /  m/s2',axisX),axis('Y  /  m/s2',axisY),axis('Z  /  m/s2',axisZ)]),
    View({style:{width:'100%',height:48,background:'surfaceAlt',borderRadius:12,padding:12,display:'flex',flexDirection:'column',justifyContent:'center'}},[
      Text({text:function(){return motion();},style:{fontSize:13,color:'textDim',borderRadius:0}})
    ])
  ]),
  View({style:{width:'100%',height:74,display:'flex',flexDirection:'column',padding:0,gap:6}},[
    Button({title:'Poll now',style:{width:'100%',height:48,background:'accent',borderRadius:12},onPress:poll}),
    Text({text:function(){return '1 Hz  /  '+seconds()+' readings';},style:{width:'100%',fontSize:12,color:'textDim',textAlign:'center',borderRadius:0}})
  ])
]);
