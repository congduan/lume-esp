/* r166: ColorPicker -> live app tint -> KV on SAVE. ASCII-only app layer. */
import '../../runtime/shell.js';

var stored = lume.storage.kv.get('demo.color');
var initial = lume.ui.shell.hexToHsv(stored) ? stored : '#40D8B0';
var selected = signal(initial);
var saved = signal(false);
/* r203: compact 210x252 picker plus title / live value / swatches all inside
 * the 466 px round safe area [75,405]. Default ColorPicker remains 300x360. */
var root = View({style:{x:0,y:0,width:480,height:480,background:'#07111D',scroll:'none'}});
Text({parent:root,text:'COLOR STUDIO',style:{x:135,y:76,width:210,height:20,
  fontSize:16,textAlign:'center',color:'#F2F7FB'}});
var picker = lume.ui.shell.ColorPicker({parent:root,x:135,y:104,compact:true,initialHex:initial,
  onChange:function (hex) { selected.set(hex); saved.set(false); },
  onConfirm:function (hex) {
    selected.set(hex);
    if (lume.storage.kv.set('demo.color',hex) === 0) saved.set(true);
  }});
var display = Text({parent:root,text:function () { return selected(); },
  style:{x:160,y:360,width:160,height:18,fontSize:14,color:'#F2F7FB',textAlign:'center'}});
var circle = View({parent:root,style:{x:150,y:382,width:22,height:22,borderRadius:11,
  background:function () { return selected(); }}});
var rectangle = View({parent:root,style:{x:214,y:384,width:34,height:18,borderRadius:5,
  background:function () { return selected(); }}});
var sample = Canvas({parent:root,width:28,height:22,style:{x:285,y:382},
  onDraw:function (c) { c.fillColor('#07111D'); c.fillRect(0,0,28,22);
    c.text(5,5,'Aa',selected()); }});
var toast = Text({parent:root,text:function () { return saved() ? 'SAVED' : 'LIVE'; },
  style:{x:330,y:76,width:72,height:20,fontSize:14,textAlign:'center',color:'#F2F7FB'}});
globalThis.colorDemo = {picker:picker,display:display,circle:circle,rectangle:rectangle,
  sample:sample,toast:toast};
