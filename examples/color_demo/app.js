/* r166: ColorPicker -> live app tint -> KV on SAVE. ASCII-only app layer. */
import '../../runtime/shell.js';

var stored = lume.storage.kv.get('demo.color');
var initial = lume.ui.shell.hexToHsv(stored) ? stored : '#40D8B0';
var selected = signal(initial);
var saved = signal(false);
var root = View({style:{x:0,y:0,width:480,height:480,background:'#07111D',scroll:'none'}});
Text({parent:root,text:'COLOR STUDIO',style:{x:122,y:4,width:236,height:24,
  fontSize:18,textAlign:'center',color:'#F2F7FB'}});
var picker = lume.ui.shell.ColorPicker({parent:root,x:90,y:25,initialHex:initial,
  onChange:function (hex) { selected.set(hex); saved.set(false); },
  onConfirm:function (hex) {
    selected.set(hex);
    if (lume.storage.kv.set('demo.color',hex) === 0) saved.set(true);
  }});
var display = Text({parent:root,text:function () { return selected(); },
  style:{x:184,y:387,width:112,height:24,fontSize:16,color:'#F2F7FB',textAlign:'center'}});
var circle = View({parent:root,style:{x:105,y:418,width:42,height:42,borderRadius:21,
  background:function () { return selected(); }}});
var rectangle = View({parent:root,style:{x:215,y:422,width:56,height:34,borderRadius:6,
  background:function () { return selected(); }}});
var sample = Canvas({parent:root,width:48,height:42,style:{x:332,y:418},
  onDraw:function (c) { c.fillColor('#07111D'); c.fillRect(0,0,48,42);
    c.text(10,12,'Aa',selected()); }});
var toast = Text({parent:root,text:function () { return saved() ? 'SAVED' : 'LIVE'; },
  style:{x:195,y:460,width:90,height:20,fontSize:14,textAlign:'center',color:'#F2F7FB'}});
globalThis.colorDemo = {picker:picker,display:display,circle:circle,rectangle:rectangle,
  sample:sample,toast:toast};
