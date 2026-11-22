const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {buildSync} = require('../tools/lume/node_modules/esbuild');
const {runApp} = require('./lib/prelude_runner');
const source = fs.readFileSync('examples/color_demo/app.js','utf8');
function bundle(text) { return buildSync({stdin:{contents:text,resolveDir:process.cwd()+'/examples/color_demo',sourcefile:'app.js'},bundle:true,format:'iife',platform:'neutral',write:false}).outputFiles[0].text; }
function launch(text, kv) { return runApp(bundle(text), {kv:{get:key=>kv[key]||null,set:(key,v)=>{kv[key]=v;return 0;}}}); }
function tap(s,x,y) { const id=s.ctx.colorDemo.picker; s.gesture(id,0,x,y,0); s.gesture(id,2,x,y,20); }
function last(s,id,attr) { return s.messages.filter(m=>m[0]==='attr'&&m[1]===id&&m[2]===attr).at(-1)?.[3]; }
function proof(name,fn,mutate) { fn(source);const bad=mutate(source);assert.notEqual(bad,source);assert.throws(()=>fn(bad),undefined,'mutation survived '+name);console.log('PASS color_demo '+name+'; mutation FAIL as expected'); }
proof('live selection tints circle rectangle and text and HEX',src=>{
  const s=launch(src,{'demo.color':'#00FF00'}); tap(s,330,135); // ring +x, hue red
  assert.equal(last(s,s.ctx.colorDemo.display,0),'#FF0000');
  assert.equal(last(s,s.ctx.colorDemo.circle,1),0xFF0000);
  assert.equal(last(s,s.ctx.colorDemo.rectangle,1),0xFF0000);
  assert.ok(s.messages.some(m=>m[0]==='draw'&&m[1]===s.ctx.colorDemo.sample&&m[2]===4&&m[7]===0xFF0000));
},src=>src.replace('selected.set(hex); saved.set(false);','saved.set(false);'));
proof('SAVE writes KV; next launch restores selection',src=>{
  const kv={}; const s=launch(src,kv); tap(s,240,225); // ring bottom -> greenish hue
  const picked=last(s,s.ctx.colorDemo.display,0); tap(s,335,359); // SAVE local x245 y334
  assert.equal(kv['demo.color'],picked);
  assert.equal(last(s,s.ctx.colorDemo.toast,0),'SAVED');
  const next=launch(src,kv); assert.equal(last(next,next.ctx.colorDemo.display,0),picked);
},src=>src.replace("lume.storage.kv.set('demo.color',hex)","lume.storage.kv.set('demo.other',hex)"));
console.log('ALL COLOR_DEMO CASES PASSED');
