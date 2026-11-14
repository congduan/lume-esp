const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const block = source.match(/const char lume_prelude_js\[\] =\n([\s\S]*?)\n\nconst char lume_demo_js/);
const prelude = [...block[1].matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(x => JSON.parse(x[0])).join('');
function run(script, size = {width: 1, height: 1}, rc = 0) {
  const calls = []; let id = 0;
  const lume = {image: {sizeOf: () => size, _setSource: (...a) => {calls.push(['source', ...a]); return rc;}},
    createNode: (...a) => {calls.push(['create', ...a]); return ++id;},
    setAttr: (...a) => calls.push(['attr', ...a]), removeChild: x => calls.push(['remove', x]),
    log: () => {}};
  const ctx = vm.createContext({lume});
  vm.runInContext(prelude + '\n' + script, ctx);
  return {calls, ctx};
}
function pass(name, fn) { fn(); console.log('PASS ' + name); }
pass('Image create/source/size message order', () => {
  const h = run('var n=Image({src:new ArrayBuffer(1)});');
  assert.deepStrictEqual(h.calls[0], ['create', 4, 0]);
  assert.deepStrictEqual(h.calls[1].slice(0,2), ['source', 1]);
  assert(h.calls.some(x => x[0] === 'attr' && x[2] === 2 && x[3] === 1));
});
pass('Image participates in View flex child adoption', () => {
  const h = run('View({style:{display:"flex"}},[Image({src:new ArrayBuffer(1)})]);');
  assert(h.calls.some(x => x[0] === 'attr' && x[1] === 1 && x[2] === 6 && x[3] === 2));
});
pass('Image preserves aspect ratio for one explicit dimension', () => {
  const h = run('Image({src:new ArrayBuffer(1),style:{width:40}});', {width:20,height:10});
  assert(h.calls.some(x => x[0] === 'attr' && x[2] === 3 && x[3] === 20));
});
pass('Image propagates decoder error and removes failed node', () => {
  const h = run('var n=Image({src:new ArrayBuffer(1)});', {width:1,height:1}, -3);
  assert.strictEqual(h.ctx.n, -3); assert.deepStrictEqual(h.calls.at(-1), ['remove',1]);
});
pass('Image rejects invalid input and propagates header error', () => {
  assert.strictEqual(run('var n=Image({src:"bad"});').ctx.n, -1);
  assert.strictEqual(run('var n=Image({src:new ArrayBuffer(1)});', -2).ctx.n, -2);
});
pass('embedded PNG 1x1 decodes to exact opaque red RGBA bytes', () => {
  const app = fs.readFileSync('examples/image_gallery/app.js','utf8');
  const list = app.match(/new Uint8Array\(\[([^\]]+)\]\)/)[1].split(',').map(Number);
  const png = Buffer.from(list);
  assert.strictEqual(png.readUInt32BE(16), 1); assert.strictEqual(png.readUInt32BE(20), 1);
  const data = zlib.inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
  assert.deepStrictEqual([...data], [0,255,0,0,255]);
});
