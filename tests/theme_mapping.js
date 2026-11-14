// Host harness for the exact C-embedded prelude and Queue A ATTR messages.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const block = source.match(/const char lume_prelude_js\[\] =\n([\s\S]*?)\n\nconst char lume_demo_js/);
assert(block);
const prelude = [...block[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
let messages = [], nextId = 0;
const ctx = vm.createContext({lume: {
  createNode: () => ++nextId,
  setAttr: (id, attr, value) => messages.push([id, attr, value]),
  setPressEvent: () => {}, log: () => {}
}});
const run = js => vm.runInContext(js, ctx);
vm.runInContext(prelude, ctx);
const rows = () => messages.splice(0);
function pass(name) { console.log('PASS ' + name); }
run("lume.theme.set({colors:{primary:'#0B1E3F',text:'#FFFFFF'},radius:12,fontScale:1.25})");
assert.deepStrictEqual(JSON.parse(JSON.stringify(run('lume.theme.get()'))),
  {colors:{primary:'#0B1E3F',text:'#FFFFFF'},radius:12,fontScale:1.25});
run("lume.theme.get().colors.primary = '#000000'");
assert.strictEqual(run('lume.theme.get().colors.primary'), '#0B1E3F');
pass('set/get returns an isolated snapshot');
run("var themed = View({style:{background:'primary',borderColor:'text'}})");
assert.deepStrictEqual(rows(), [[1,1,0x0B1E3F],[1,12,12],[1,14,0xffffff]]);
pass('named background and borderColor resolve');
run("var literal = View({style:{background:'#112233',borderColor:'#445566',borderRadius:3}})");
assert.deepStrictEqual(rows(), [[2,1,0x112233],[2,12,3],[2,14,0x445566]]);
pass('hex literals remain valid');
run("lume.theme.set({colors:{primary:'#E9F2FA',text:'#23425F'},radius:16,fontScale:1})");
const light = rows();
assert.deepStrictEqual(light, [[1,1,0xE9F2FA],[1,12,16],[1,14,0x23425F]]);
console.log('dark→light ATTR messages: ' + JSON.stringify(light));
pass('theme.set invalidates every named color and implicit radius');
run("lume.theme.set({colors:{primary:'#102030',text:'#405060'},radius:16,fontScale:1})");
assert.deepStrictEqual(rows(), [[1,1,0x102030],[1,14,0x405060]]);
pass('unreferenced literal colors and explicit radius post no messages');
run("lume.theme.set({colors:{primary:'#102030',text:'#405060'},fontScale:1})");
assert.deepStrictEqual(rows(), [[1,1,0x102030],[1,12,0],[1,14,0x405060]]);
pass('removing default radius clears inherited radius');
assert.throws(() => run("lume.theme.set({colors:{primary:'broken'}})"), /theme color/);
assert.deepStrictEqual(rows(), []);
pass('invalid theme is atomic');
run('__dispose(themed)');
run("lume.theme.set({colors:{primary:'#223344',text:'#667788'},radius:4})");
assert.deepStrictEqual(rows(), []);
pass('disposed node stops receiving theme updates');
assert.throws(() => run("View({style:{background:'missing'}})"), /expected #RRGGBB/);
pass('unknown token falls through to literal parser');
const demoBlock = source.match(/const char lume_demo_js\[\] =\n([\s\S]*?);\s*$/);
const demo = [...demoBlock[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
let demoMessages = [], demoId = 0;
const demoCtx = vm.createContext({lume: {
  createNode: () => ++demoId,
  setAttr: (id, attr, value) => demoMessages.push([id, attr, value]),
  setPressEvent: () => {}, log: () => {}
}});
vm.runInContext(prelude + '\n' + demo, demoCtx);
demoMessages = [];
vm.runInContext('__pressHandlers[lightButton]()', demoCtx);
const screenLight = demoMessages.splice(0);
assert.deepStrictEqual(screenLight, [
  [2,1,0xffffff],[2,14,0x23425f],
  [3,1,0xa4c7e5],[3,14,0x23425f],
  [4,1,0xa4c7e5],[4,14,0x23425f],
  [5,1,0xa4c7e5],[5,14,0x23425f],
  [6,1,0xe9f2fa]
]);
vm.runInContext('__pressHandlers[darkButton]()', demoCtx);
const screenDark = demoMessages.splice(0);
assert.strictEqual(screenDark.length, screenLight.length);
console.log('demo dark→light ATTR messages: ' + JSON.stringify(screenLight));
pass('demo buttons recolor card, controls and full-screen root');
