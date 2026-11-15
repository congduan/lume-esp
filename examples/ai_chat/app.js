/* Provision ai_api_key, wifi_ssid and wifi_pass in NVS before launching. */
var questions = [
  'Summarize what an ESP32-S3 can do in two sentences.',
  'Suggest one useful wearable app idea.',
  'Explain one way to save battery on an AMOLED device.'
];
var nextQuestion = 0;
var page = signal(0);
var answer = signal('Press Send after provisioning WiFi and the API key.');
var state = signal('Ready');
var shownQuestion = signal(questions[0]);
var ssid = lume.storage.kv.get('wifi_ssid');
var password = lume.storage.kv.get('wifi_pass');
if (typeof ssid === 'string' && typeof password === 'string') lume.net.connect(ssid, password);
else state.set('Provision WiFi in NVS first');
if (typeof lume.storage.kv.get('ai_api_key') !== 'string') state.set('Provision AI key in NVS first');
function pageText() {
  var text = answer();
  var start = page() * 80;
  return text.slice(start, start + 80);
}
function sendQuestion() {
  if (lume.net.status().state !== lume.net.GOT_IP) { state.set('WiFi is not ready'); return; }
  var q = questions[nextQuestion];
  nextQuestion = (nextQuestion + 1) % questions.length;
  shownQuestion.set(q);
  state.set('Loading...');
  answer.set('Waiting for model response...');
  page.set(0);
  var result = lume.ai.chat({messages:[{role:'user',content:q}],maxTokens:512});
  if (typeof result === 'number') {
    state.set('Error ' + result);
    answer.set(result === -4 ? 'Response could not be parsed or exceeded 32 KB.' : 'Check WiFi, key and server.');
  } else {
    state.set('Done');
    answer.set(result.content || '(empty response)');
  }
}
var chatTheme={colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:12,fontScale:1};
lume.theme.set(chatTheme);
var dots=signal(0);
lume.system.setInterval(function(){if(state()==='Loading...')dots.set((dots()+1)%4);},400);
View({style:{width:'100%',height:'100%',padding:32,background:'bg',scroll:'none',display:'flex',flexDirection:'column',justifyContent:'space-between',gap:12}},[
  View({style:{width:'100%',height:56,display:'flex',flexDirection:'column',padding:0,gap:4}},[
    Text({text:'Lume AI',style:{fontSize:24,color:'text'}}),
    Text({text:function(){return state()==='Loading...'?'Thinking'+'.'.repeat(dots()):state();},style:{fontSize:13,color:'textDim'}})
  ]),
  View({style:{width:'100%',height:104,display:'flex',flexDirection:'row',justifyContent:'end',padding:0}},[
    View({style:{width:304,height:96,background:'surfaceAlt',borderRadius:20,padding:16}},[
      Text({text:shownQuestion,style:{width:272,height:72,fontSize:16,color:'text',longMode:'wrap'}})
    ])
  ]),
  View({style:{width:'100%',height:148,display:'flex',flexDirection:'row',padding:0}},[
    View({style:{width:344,height:144,background:'surface',borderRadius:20,padding:16}},[
      Text({text:pageText,style:{width:312,height:112,fontSize:16,color:'text',longMode:'wrap'}})
    ])
  ]),
  View({style:{width:'100%',height:64,display:'flex',flexDirection:'row',alignItems:'center',gap:8,padding:0}},[
    Button({title:'More',style:{width:88,height:56,borderRadius:999,background:'surfaceAlt'},onPress:function(){if((page()+1)*80<answer().length)page.set(page()+1);else page.set(0);}}),
    View({style:{width:252,height:56,background:'surfaceAlt',borderRadius:999,padding:16,display:'flex',alignItems:'center'}},[Text({text:'Next prompt',style:{fontSize:13,color:'textDim'}})]),
    Button({title:'Send',style:{width:56,height:56,borderRadius:999,background:'accent'},onPress:sendQuestion})
  ])
]);
