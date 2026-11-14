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
View({style:{width:'100%',height:'100%',padding:35,background:'#101B2A',display:'flex',flexDirection:'column',gap:12}},[
  Text({text:'Lume AI chat',style:{width:'100%',height:35}}),
  Text({text:function(){return state();},style:{width:'100%',height:25}}),
  Text({text:function(){return shownQuestion();},style:{width:'100%',height:55,longMode:'wrap'}}),
  View({style:{width:'100%',height:245,background:'#26384D',padding:12}},[
    Text({text:pageText,style:{width:'100%',height:220,longMode:'wrap'}})
  ]),
  Button({title:'Send next question',style:{width:'100%',height:52},onPress:sendQuestion}),
  Button({title:'More answer',style:{width:'100%',height:52},onPress:function(){
    if ((page()+1)*80 < answer().length) page.set(page()+1); else page.set(0);
  }})
]);
