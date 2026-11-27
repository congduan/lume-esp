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
check('Card and IconButton expose watch-sized defaults', () => {
  const s = app('globalThis.card=lume.ui.shell.Card({children:[Text({text:"Metric"})]});globalThis.icon=lume.ui.shell.IconButton({title:"Mode"});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[1] === s.ctx.card && m[2] === 10 && m[3] === 16));
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[1] === s.ctx.icon && m[2] === 2 && m[3] === 56));
});
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
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 3 && m[3] === 2520), 'List spacer contains all rows');
  const canvases = s.messages.filter(m => m[0] === 'create' && m[2] === 3);
  assert.ok(canvases.length > 0 && canvases.length < 90, 'only visible icons mounted');
});
check('Launcher round shape inscribes defaults in the 466 safe square', () => {
  const s = app('globalThis.apps=Array.from({length:9},(_,i)=>({id:"app"+i,label:"App "+i,color:"#117B69",ring:"#40D8B0"}));globalThis.root=lume.ui.shell.Launcher({apps,shape:"round"});');
  /* safeInsets('round', 480) -> 339x339 box at (70,70); r219 tightens round
   * StatusBar by 8px per side to 323px at (78,78) [78..401], matching listX. */
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 2 && m[3] === 323), 'bar width is safe side minus 16');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 18 && m[3] === 78), 'bar x 8px inside safe left');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 19 && m[3] === 78), 'bar y 8px inside safe top');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 18 && m[3] === 345), 'edit button right edge inside safe square');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 19 && m[3] === 126), 'edit button below bar');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 18 && m[3] === 78), 'list x inside safe square');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 19 && m[3] === 190), 'list y below edit button');
  const icon = s.messages.find(m => m[0] === 'create' && m[2] === 3 && m[4] === 44 && m[5] === 44);
  assert.ok(icon, '44px round icon canvas');
  const draws = s.messages.filter(m => m[0] === 'draw' && m[1] === icon[1]);
  assert.ok(draws.some(m => m[2] === 6 && m[3] === 22 && m[4] === 22 && m[5] === 20), 'fillCircle badge');
  assert.ok(draws.some(m => m[2] === 3 && m[3] === 22 && m[4] === 22 && m[5] === 19), 'token colour ring');
  assert.ok(draws.some(m => m[2] === 4 && m[9] === 'A'), 'centred white glyph');
  assert.ok(!draws.some(m => m[2] === 1), 'no octagonal fillRect placeholder');
  assert.ok(!s.messages.some(m => m[0] === 'attr' && m[2] === 12 && m[3] === 24), 'no borderRadius:24 clip');
});
check('Launcher rejects an unknown shape', () => {
  assert.throws(() => app('lume.ui.shell.Launcher({shape:"oval"});'), /shape must be square or round/);
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
check('spacing injects missing View padding and gap and follows theme changes', () => {
  const s = app('lume.theme.set({spacing:8});globalThis.box=View({style:{width:100}});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[1] === s.ctx.box && m[2] === 10 && m[3] === 8));
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[1] === s.ctx.box && m[2] === 11 && m[3] === 8));
  s.messages.length = 0;
  evalIn(s, 'lume.theme.set({spacing:12})');
  assert.ok(s.messages.some(m => m[1] === s.ctx.box && m[2] === 10 && m[3] === 12));
});
check('explicit spacing wins and invalid token is atomic', () => {
  const s = app('lume.theme.set({spacing:8});globalThis.box=View({style:{padding:3,gap:4}});');
  s.messages.length = 0;
  evalIn(s, 'lume.theme.set({spacing:12})');
  assert.ok(!s.messages.some(m => m[1] === s.ctx.box && (m[2] === 10 || m[2] === 11)));
  assert.throws(() => evalIn(s, 'lume.theme.set({spacing:-1})'), /spacing/);
  assert.equal(evalIn(s, 'lume.theme.get().spacing'), 12);
});
check('Dialog opens and close is idempotent', () => {
  const s = app('globalThis.close=lume.ui.shell.Dialog({title:"Confirm",buttons:[{label:"Cancel"}]});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'Confirm'));
  evalIn(s, 'close();close()');
  assert.equal(s.messages.filter(m => m[0] === 'remove').length, 2);
});
check('Dialog stack ignores covered button and closes top first', () => {
  const s = app('globalThis.hits=[];globalThis.a=lume.ui.shell.Dialog({title:"A",buttons:[{label:"First",style:"primary",onPress:()=>hits.push("A")}]});globalThis.b=lume.ui.shell.Dialog({title:"B",buttons:[{label:"Second",style:"primary",onPress:()=>hits.push("B")}]});');
  const buttons = s.messages.filter(m => m[0] === 'press').map(m => m[1]);
  s.press(buttons[1]);
  assert.deepEqual([...s.ctx.hits], []);
  s.press(buttons[4]);
  assert.deepEqual([...s.ctx.hits], ['B']);
  s.press(buttons[1]);
  assert.deepEqual([...s.ctx.hits], ['B','A']);
});
check('Dialog lifecycle pause removes overlays', () => {
  const s = app('lume.ui.shell.Dialog({title:"A",buttons:[]});lume.ui.shell.Dialog({title:"B",buttons:[]});');
  evalIn(s, '__lume_pause()');
  assert.equal(s.messages.filter(m => m[0] === 'remove').length, 4);
});
check('danger button follows theme danger token', () => {
  const s = app('lume.theme.set({colors:{danger:"#AA1122"}});lume.ui.shell.Dialog({title:"Danger",buttons:[{label:"Delete",style:"danger"}]});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 1 && m[3] === 0xAA1122));
  evalIn(s, 'lume.theme.set({colors:{danger:"#BB2233"}})');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 1 && m[3] === 0xBB2233));
});
check('primary button follows theme primary token', () => {
  const s = app('lume.theme.set({colors:{primary:"#123456"}});lume.ui.shell.Dialog({title:"Choice",buttons:[{label:"OK",style:"primary"}]});');
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 1 && m[3] === 0x123456));
});
check('Toast replaces current and resets timer', () => {
  const s = app('lume.ui.shell.Toast.show("one",{durationMs:100});');
  const first = s.messages.find(m => m[0] === 'create')[1];
  evalIn(s, 'lume.ui.shell.Toast.show("two",{durationMs:200})');
  assert.ok(s.messages.some(m => m[0] === 'remove' && m[1] === first));
  assert.equal(evalIn(s, 'Object.keys(__timers).length'), 1);
  assert.ok(s.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'two'));
});
check('Toast fades then removes itself', () => {
  const s = app('lume.ui.shell.Toast.show("Saved",{durationMs:100});');
  const id = s.messages.find(m => m[0] === 'create')[1];
  evalIn(s, 'Object.values(__timers)[0].cb()');
  assert.ok(s.messages.some(m => m[0] === 'animate' && m[1] === id && m[2] === 15));
  evalIn(s, 'Object.values(__timers).at(-1).cb()');
  assert.ok(s.messages.some(m => m[0] === 'remove' && m[1] === id));
});
console.log('PASS ' + cases + ' shell component cases');
