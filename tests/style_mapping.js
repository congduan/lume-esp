// Host harness: evaluate the exact C-embedded prelude and inspect Queue A calls.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const { prelude } = require('./lib/prelude_runner');
let messages = [], nextId = 0;
const ctx = vm.createContext({ lume: {
  createNode: () => ++nextId,
  setAttr: (id, attr, value) => messages.push([id, attr, value]),
  setPressEvent: () => {}, log: () => {}
} });
vm.runInContext(prelude, ctx);
function check(name, style, expected) {
  messages = [];
  vm.runInContext(`View({style:${JSON.stringify(style)}})`, ctx);
  const got = messages.map(([, attr, value]) => [attr, value]);
  assert.deepStrictEqual(got, expected, name);
  console.log(`PASS ${name}: ${JSON.stringify(got)}`);
}
check('column + dimensions + color', {display:'flex',flexDirection:'column',width:'100%',height:'50%',background:'#0B1E3F'}, [[1,0x0B1E3F],[16,100],[17,50],[7,1]]);
check('row', {display:'flex',flexDirection:'row'}, [[7,0]]);
check('row wrap', {display:'flex',flexDirection:'row',flexWrap:'wrap'}, [[7,2]]);
check('column wrap', {display:'flex',flexDirection:'column',flexWrap:'wrap'}, [[7,3]]);
for (const [value, wire] of [['start',0],['end',1],['center',2],['space-between',3],['space-around',4],['space-evenly',5]]) {
  check('justify '+value, {justifyContent:value}, [[8,wire]]);
}
check('stretch + gap + padding', {alignItems:'stretch',gap:8,padding:16}, [[9,3],[10,16],[11,8]]);
check('radius + border + opacity', {borderRadius:12,borderWidth:2,borderColor:'#abcdef',opacity:0.5}, [[12,12],[13,2],[14,0xabcdef],[15,128]]);
check('pixel + legacy bg', {width:240,height:120,background:0x112233}, [[1,0x112233],[2,240],[3,120]]);
check('vertical scroll + auto scrollbar', {scroll:'vertical',scrollbar:'auto'}, [[20,1],[21,1]]);
check('horizontal scroll + on scrollbar', {scroll:'horizontal',scrollbar:'on'}, [[20,2],[21,2]]);
check('scroll disabled + scrollbar off', {scroll:'none',scrollbar:'off'}, [[20,0],[21,0]]);
check('per-side padding overrides box shorthand', {padding:8,paddingTop:2,paddingRight:4,paddingBottom:6,paddingLeft:10}, [[10,8],[30,2],[31,4],[32,6],[33,10]]);
check('margin box + per-side margin', {margin:4,marginLeft:12}, [[34,4],[38,12]]);
check('margin sides only', {marginTop:2,marginRight:3,marginBottom:5,marginLeft:7}, [[35,2],[36,3],[37,5],[38,7]]);
check('flex grow inside a flex row', {display:'flex',flexGrow:1}, [[7,0],[39,1]]);
check('auto sizing', {width:'auto',height:'auto'}, [[43,1],[44,1]]);
check('min/max size bounds', {minWidth:10,maxWidth:200,minHeight:20,maxHeight:40}, [[45,10],[46,200],[47,20],[48,40]]);
check('absolute position escapes the flow', {position:'absolute',x:4,y:8}, [[23,1],[18,4],[19,8]]);
check('relative position sends nothing', {position:'relative'}, []);
check('translate px + percent', {translateX:6,translateY:'50%'}, [[49,6],[52,50]]);
checkLayout('text align + long mode', "Text({style:{textAlign:'center',longMode:'dots'}})", [[53,1],[54,1]]);
function checkProps(name, props, expected) {
  messages = [];
  vm.runInContext(`View(${JSON.stringify(props)})`, ctx);
  const got = messages.map(([, attr, value]) => [attr, value]);
  assert.deepStrictEqual(got, expected, name);
  console.log(`PASS ${name}: ${JSON.stringify(got)}`);
}
checkProps('align string + alignTo + alignOffset', {align:'bottom-right',alignTo:5,alignOffset:{x:-8,y:-4}}, [[40,5],[41,-8],[42,-4],[4,6]]);
for (const [value, wire] of [['center',0],['top-left',1],['top-mid',2],['top-right',3],['bottom-mid',4],['bottom-left',5],['bottom-right',6],['left-mid',7],['right-mid',8]]) {
  checkProps('align '+value, {align:value}, [[4,wire]]);
}
checkProps('align numeric constant', {align:4}, [[4,4]]);
checkProps('aligned to parent with an offset', {align:'top-mid',alignTo:0,alignOffset:{y:12}}, [[40,0],[42,12],[4,2]]);
checkProps('outside align below a base node', {align:'below',alignTo:7}, [[40,7],[4,13]]);
checkProps('outside align above a base node', {align:'above',alignTo:7}, [[40,7],[4,10]]);
checkProps('outside align right of a base node', {align:'right-of',alignTo:7}, [[40,7],[4,19]]);
checkProps('outside align corner', {align:'outside-right-top',alignTo:7,alignOffset:{x:4}}, [[40,7],[41,4],[4,18]]);
checkProps('outside align numeric constant', {align:20}, [[4,20]]);
for (const props of [
  {align:21},{align:'middle'},{alignTo:'parent'},{alignOffset:4},{alignOffset:{x:1.5}},
  {style:{flexGrow:256}},{style:{margin:-1}},{style:{position:'fixed'}},
  {style:{translateX:'101%'}},{style:{translateX:1.5}},{style:{textAlign:'middle'}},
  {style:{longMode:'ellipsis'}},{style:{minWidth:-1}},{style:{width:'fit-content'}}
]) {
  assert.throws(() => vm.runInContext(`View(${JSON.stringify(props)})`, ctx));
}
console.log('PASS invalid align/alignTo/alignOffset/flexGrow/margin/position/translate/text rejected in prelude');
function checkLayout(name, expr, expected) {
  messages = [];
  vm.runInContext(expr, ctx);
  const got = messages.map(([, attr, value]) => [attr, value]);
  assert.deepStrictEqual(got, expected, name);
  console.log(`PASS ${name}: ${JSON.stringify(got)}`);
}
checkLayout('Row presets flex row', 'Row({})', [[7,0]]);
checkLayout('Column presets flex column', "Column({style:{width:'100%'}})", [[16,100],[7,1]]);
for (const style of [{width:'101%'}, {padding:'8'}, {background:'#bad'}, {opacity:2}]) {
  assert.throws(() => vm.runInContext(`View({style:${JSON.stringify(style)}})`, ctx));
}
console.log('PASS invalid percentage/metric/color/opacity rejected in prelude');
console.log('PASS all style mapping cases');

const demoBlock = source.match(/const char lume_demo_js\[\] =\n([\s\S]*?);\n/);
assert(demoBlock, 'embedded demo found');
const embeddedDemo = [...demoBlock[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)]
  .map(m => JSON.parse(m[0])).join('');
function runDemo(script) {
  let calls = [], id = 0;
  const sandbox = vm.createContext({lume: {
    createNode: kind => { calls.push(['create', kind]); return ++id; },
    setAttr: (...args) => calls.push(['attr', ...args]),
    setPressEvent: node => calls.push(['press', node]),
    canvasDraw: (...args) => calls.push(['draw', ...args]),
    canvasInvalidate: node => calls.push(['invalidate', node]), log: () => {}
  }});
  vm.runInContext(prelude + '\n' + script, sandbox);
  return calls;
}
assert.deepStrictEqual(runDemo(embeddedDemo), runDemo(fs.readFileSync('examples/counter/app.js', 'utf8')));
console.log('PASS embedded demo matches examples/counter/app.js messages');
