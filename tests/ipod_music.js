const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {runApp}=require('./lib/prelude_runner');
const shell=fs.readFileSync('runtime/shell.js','utf8');
const source=fs.readFileSync('examples/ipod_music/app.js','utf8');
assert.match(source,/DEMO - UI ONLY \/ NO AUDIO/);
const s=runApp(shell+'\n'+source.replace(/^import .*;\n/m,''));
const w=s.ctx.musicDemo.wheel;
function at(deg,r=44){const a=deg*Math.PI/180;return [Math.round(240+r*Math.sin(a)),Math.round(342-r*Math.cos(a))];}
function drag(degrees){degrees.forEach((d,i)=>{const [x,y]=at(d);s.gesture(w,i?1:0,x,y,i*70);});const [x,y]=at(degrees.at(-1));s.gesture(w,2,x,y,degrees.length*70);}
function tap(x,y){s.gesture(w,0,x,y,0);s.gesture(w,2,x,y,30);}
function state(){return vm.runInContext('({selected:musicDemo.selected(),page:musicDemo.page(),position:musicDemo.position(),playing:musicDemo.playing()})',s.ctx);}
assert.equal(state().page,'list');
drag([0,10,20,30,40,50,60,70]);assert.equal(state().selected,3);
tap(240,342);assert.deepEqual({...state()},{selected:3,page:'play',position:0,playing:true});
drag([0,10,20,30,40,50]);assert.equal(state().position,10);
let [x,y]=at(90);tap(x,y);assert.equal(state().playing,false);
[x,y]=at(270);tap(x,y);assert.equal(state().selected,4);assert.equal(state().position,0);
[x,y]=at(180);tap(x,y);assert.equal(state().selected,3);
[x,y]=at(0);tap(x,y);assert.equal(state().page,'list');
console.log('PASS ipod_music list, select, play demo, scrub, pause, next, previous, menu');
