/* A button callback resumes after a Promise job and updates reactive text. */
var status = signal('Ready');

async function updateStatus() {
  status.set('Waiting');
  var result = await Promise.resolve('Done');
  status.set(result);
  lume.log('ASYNC_DEMO_PRESS_AWAIT_OK');
}

View({style:{width:'100%',height:'100%',background:'#07111D',padding:24,
  display:'flex',flexDirection:'column',justifyContent:'center',gap:16}},[
  Text({text:status,style:{fontSize:28,color:'#F2F7FB'}}),
  Button({title:'Run async',style:{height:64,background:'#40D8B0'},
    onPress:updateStatus})
]);

/* Also make the firmware job drain observable without injecting a touch. */
(async function () {
  await Promise.resolve();
  lume.log('ASYNC_DEMO_BOOT_AWAIT_OK');
})();
