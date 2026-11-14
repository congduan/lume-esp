const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS shell ' + name); }
function app(code) { return runApp(shell + '\n' + code); }
function evalIn(s, code) { return vm.runInContext(code, s.ctx); }
function drag(s, id, from, to) {
  s.gesture(id, 0, from, 200, 0);
  s.gesture(id, 1, to, 200, 50);
  s.gesture(id, 2, to, 200, 100);
}
check('StatusBar getter follows signal', () => {
  const s = app('globalThis.value=signal(1);globalThis.bar=lume.ui.shell.StatusBar({left:()=>"L"+value(),right:"R"});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'L1'));
  evalIn(s, 'value.set(2)');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'L2'));
});
check('StatusBar clock timer and disposal', () => {
  const s = app('globalThis.bar=lume.ui.shell.StatusBar({clock:true});');
  assert.equal(evalIn(s, 'Object.keys(__timers).length'), 1);
  evalIn(s, 'lume.ui.shell.dispose(bar)');
  assert.equal(evalIn(s, 'Object.keys(__timers).length'), 0);
});
check('EdgeNavigation true handles back', () => {
  const s = app('globalThis.calls=[];globalThis.edge=lume.ui.shell.EdgeNavigation({onBack:()=>{calls.push("back");return true},onPageSwipe:d=>calls.push(d)});');
  drag(s, s.ctx.edge, 10, 90);
  assert.deepEqual([...s.ctx.calls], ['back']);
});
check('EdgeNavigation false forwards page swipe', () => {
  const s = app('globalThis.calls=[];globalThis.edge=lume.ui.shell.EdgeNavigation({onBack:()=>false,onPageSwipe:d=>calls.push(d)});');
  drag(s, s.ctx.edge, 10, 90);
  assert.deepEqual([...s.ctx.calls], ['right']);
  const right = s.messages.filter(m => m[0] === 'gesture').at(-1)[1];
  drag(s, right, 470, 390);
  assert.deepEqual([...s.ctx.calls], ['right', 'left']);
});
check('indicator draws and rebounds, mask toggles', () => {
  const s = app('globalThis.edge=lume.ui.shell.EdgeNavigation({indicator:true});');
  drag(s, s.ctx.edge, 10, 90);
  assert.ok(s.messages.some(m => m[0] === 'draw' && m[2] === 1));
  assert.ok(s.messages.some(m => m[0] === 'animate' && m[1] === s.ctx.edge));
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 5 && m[3] === 1));
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 5 && m[3] === 0));
});
check('Launcher creates bounded virtual grid', () => {
  const s = app('globalThis.apps=Array.from({length:90},(_,i)=>({id:"app"+i,label:"App "+i}));globalThis.root=lume.ui.shell.Launcher({apps});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 3 && m[3] === 3000), 'List spacer contains all rows');
  const canvases = s.messages.filter(m => m[0] === 'create' && m[2] === 3);
  assert.ok(canvases.length > 0 && canvases.length < 90, 'only visible icons mounted');
});
check('app press and edge gesture route independently', () => {
  const s = app('globalThis.hits=[];globalThis.btn=Button({title:"Go",onPress:()=>hits.push("press")});globalThis.edge=lume.ui.shell.EdgeNavigation({onBack:()=>{hits.push("back");return true}});');
  s.press(s.ctx.btn); drag(s, s.ctx.edge, 10, 90);
  assert.deepEqual([...s.ctx.hits], ['press', 'back']);
});
check('dispose unregisters gestures and app close clears resources', () => {
  const s = app('globalThis.hits=0;globalThis.edge=lume.ui.shell.EdgeNavigation({onBack:()=>{hits++;return true}});globalThis.bar=lume.ui.shell.StatusBar({clock:true,left:()=>"time"});');
  evalIn(s, 'lume.ui.shell.dispose(edge);lume.ui.shell.dispose(edge);__lume_shutdown()');
  drag(s, s.ctx.edge, 10, 90);
  assert.equal(s.ctx.hits, 0);
  assert.equal(evalIn(s, 'Object.keys(__timers).length'), 0);
  assert.equal(evalIn(s, '__allEffects.length'), 0);
});
console.log('PASS ' + cases + ' shell component cases');
