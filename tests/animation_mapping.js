// Host protocol harness: execute the firmware's exact embedded prelude.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const block = source.match(/const char lume_prelude_js\[\] =\n([\s\S]*?)\n\nconst char lume_demo_js/);
assert(block);
const prelude = [...block[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
let calls = [], id = 0, token = 0;
const ctx = vm.createContext({lume: {
  createNode: () => ++id,
  setAttr: (...args) => calls.push(['set', ...args]),
  nativeAnimate: (...args) => { calls.push(['animate', ...args]); return ++token; },
  nativeAnimateCancel: (...args) => calls.push(['cancel', ...args]),
  setPressEvent: () => {}, log: () => {}
}});
vm.runInContext(prelude, ctx);
vm.runInContext("var slide = signal(200); var card = View({style:{y:slide, transition:{property:'y',durationMs:300,easing:'ease-out'}}});", ctx);
assert(calls.some(c => c[0] === 'set' && c[2] === 19 && c[3] === 200));
assert(!calls.some(c => c[0] === 'animate'));
console.log('PASS initial transition value uses SET_ATTR');
calls = [];
vm.runInContext('slide.set(80)', ctx);
assert.deepStrictEqual(calls, [['animate', 1, 19, null, 80, 300, 2]]);
console.log('PASS transition signal.set emits ANIMATE with omitted from and ease-out');
calls = [];
vm.runInContext("lume.anim.cancel(card, 'y')", ctx);
assert.deepStrictEqual(calls, [['cancel', 1, 19]]);
console.log('PASS ANIMATE_CANCEL path');
calls = [];
vm.runInContext("var completed = 0; var t = lume.anim.to(card,{attr:'opacity',to:1,durationMs:150,onComplete:function(){completed++}})", ctx);
assert.deepStrictEqual(calls, [['animate', 1, 15, null, 255, 150, 0]]);
vm.runInContext('__lume_dispatchAnimComplete(t)', ctx);
assert.strictEqual(vm.runInContext('completed', ctx), 1);
console.log('PASS onComplete registered and dispatched through reverse event hook');
calls = [];
vm.runInContext("var old = lume.anim.to(card,{attr:'y',to:90,durationMs:300,onComplete:function(){completed+=10}}); var newer = lume.anim.to(card,{attr:'y',to:100,durationMs:300,onComplete:function(){completed+=100}}); __lume_dispatchAnimComplete(old); __lume_dispatchAnimComplete(newer)", ctx);
assert.strictEqual(vm.runInContext('completed', ctx), 101);
assert.strictEqual(calls.length, 2);
console.log('PASS same-property replacement discards old completion');
assert.throws(() => vm.runInContext("lume.anim.to(card,{attr:'bg',to:123,durationMs:300})", ctx));
console.log('PASS color animation rejected');
