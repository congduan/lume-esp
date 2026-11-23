/* r172 StoryBook host checks. These exercise the app's real pure functions. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {runApp} = require('./lib/prelude_runner');
const source = fs.readFileSync(path.join(__dirname, '../examples/storybook/app.js'), 'utf8');
const pureSource = source.split('var sbBooks,')[0];
function load(s=pureSource) {
  const ctx={lume:{audio:{mp3:{}},storage:{Sd:{},kv:{}}}};
  vm.createContext(ctx); vm.runInContext(s,ctx); return ctx;
}
function check(label,fn) { fn(load()); console.log('PASS '+label); }
function proof(label,oldText,newText,predicate) {
  assert.ok(pureSource.includes(oldText),'mutation anchor '+label);
  assert.equal(predicate(load()),true,'baseline '+label);
  const mutant=pureSource.replace(oldText,newText);
  assert.equal(predicate(load(mutant)),false,'mutation must be caught: '+label);
  console.log('PASS mutation '+label);
}
const files=['page-10.mp3','page-02.mp3','page-02.meta.js','page-01.mp3','noise.mp3'];
const read=p=>p.endsWith('page-02.meta.js') ? "{image:'page-02.png',caption:'HELLO STAR',mood:'happy',hotspot:{x:200,y:150,r:40,sound:'tap.mp3'}}" : -2;
check('pack: sorted pages, optional meta and audio-only page',c=>{
  const p=c.sbPack('MOON',files,read);
  assert.deepEqual(Array.from(p.pages,x=>x.number),[1,2,10]);
  assert.equal(p.pages[0].meta,null);
  assert.equal(p.pages[1].meta.image,'page-02.png');
  assert.equal(p.pages[1].meta.caption,'HELLO STAR');
  assert.equal(p.pages[1].meta.hotspot.sound,'tap.mp3');
  assert.equal(p.pages[2].audio,'/storybook/MOON/page-10.mp3');
});
proof('page order','a.number-b.number','b.number-a.number',c=>c.sbPack('MOON',files,read).pages[0].number===1);
proof('optional meta','return out;\n}','return null;\n}',c=>c.sbPack('MOON',files,read).pages[1].meta?.caption==='HELLO STAR');
check('MP3 EOF advances only in automatic mode and within bounds',c=>{
  assert.equal(c.sbAdvance(0,3,true,true),1);
  assert.equal(c.sbAdvance(0,3,true,false),0);
  assert.equal(c.sbAdvance(0,3,false,true),0);
  assert.equal(c.sbAdvance(2,3,true,true),2);
});
proof('EOF gate','eof && auto &&','!eof && auto &&',c=>c.sbAdvance(0,3,true,true)===1);
proof('auto gate','eof && auto &&','eof && !auto &&',c=>c.sbAdvance(0,3,true,true)===1);
proof('last page bound','page+1<count','page+1<=count',c=>c.sbAdvance(2,3,true,true)===2);
check('hotspot circle inside, edge, outside',c=>{
  const h={x:100,y:100,r:10};
  assert.equal(c.sbHit(h,100,100),true);
  assert.equal(c.sbHit(h,110,100),true);
  assert.equal(c.sbHit(h,111,100),false);
  assert.equal(c.sbHit(null,100,100),false);
});
proof('hotspot boundary','<=h.r*h.r','<h.r*h.r',c=>c.sbHit({x:100,y:100,r:10},110,100));
proof('hotspot outside','dx*dx+dy*dy<=h.r*h.r','dx*dx+dy*dy>=h.r*h.r',c=>!c.sbHit({x:100,y:100,r:10},111,100));
check('KV continuation roundtrip and rejection of stale page',c=>{
  const books=[c.sbPack('MOON',files,read)];
  const kv=new Map();kv.set('storybook.last',c.sbSaved('MOON',1));
  const found=c.sbRestore(kv.get('storybook.last'),books);
  assert.equal(found.book,0);assert.equal(found.page,1);
  assert.equal(c.sbRestore(c.sbSaved('MOON',99),books),null);
});
proof('KV page value','page:page','page:page+1',c=>c.sbRestore(c.sbSaved('MOON',1),[c.sbPack('MOON',files,read)]).page===1);
check('missing TF directory activates labelled three-page sample',c=>{
  const b=c.sbLibrary([],()=>[],()=>-2);
  assert.equal(b.length,1);assert.equal(b[0].name,'BUILT-IN SAMPLE');
  assert.equal(b[0].pages.length,3);
});
proof('empty-library fallback','return books.length ? books : [sbSample]','return books',c=>c.sbLibrary([],()=>[],()=>-2).length===1);
check('host prelude loads the actual app with a three-page sample',()=>{
  const ui=runApp(source);
  assert.equal(ui.ctx.sbBooks[0].pages.length,3);
  assert.equal(ui.ctx.sbBooks[0].sample,true);
  assert.ok(ui.messages.some(m=>m[0]==='attr' && m[3]==='BUILT-IN SAMPLE'));
});
check('live sample ticks advance all three pages and stop at THE END',()=>{
  const ui=runApp(source), c=ui.ctx;
  c.sbOpen(0,0);
  for(let i=0;i<90;i++) c.sbTick();
  assert.equal(c.sbPage,1);
  for(let i=0;i<90;i++) c.sbTick();
  assert.equal(c.sbPage,2);
  for(let i=0;i<90;i++) c.sbTick();
  assert.equal(c.sbPage,2);assert.equal(c.sbPaused,true);
  assert.equal(c.sbMode(),'THE END');
});
check('playback failure switches the live reader to MUTE',()=>{
  const ui=runApp(source,{audio:{playStream:()=>-3}}), c=ui.ctx;
  c.sbOpen(0,0);c.sbTick();
  assert.equal(c.sbMute,true);assert.equal(c.sbMode(),'MUTE');
  c.sbGo(1);assert.equal(c.sbPage,1);
});
proof('sample has three pages','number:3, audio:null','number:4, audio:null',c=>c.sbSample.pages[2].number===3);
