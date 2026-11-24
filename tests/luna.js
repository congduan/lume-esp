#!/usr/bin/env node
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {buildSync}=require('../tools/lume/node_modules/esbuild');
const out=buildSync({entryPoints:[path.resolve(__dirname,'../examples/luna/app.js')],bundle:true,format:'cjs',platform:'neutral',target:'es2020',write:false,minify:false}).outputFiles[0].text;
const gesture={},timers=new Map();let next=1,draw=null,updates=0,wall=Date.parse('2024-04-08T18:00:00Z');
function signal(initial){let val=initial;return Object.assign(function(){return val},{set(x){val=x;updates++;}});}
const canvas={calls:0,labels:[],fillColor(){this.calls++},fillRect(){this.calls++},fillCircle(){this.calls++},retainImage(){this.calls++},drawImage(){this.calls++},text(_x,_y,s){this.calls++;this.labels.push(s)}};
const mod={exports:{}};
const lume={system:{time:()=>wall,setInterval:(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id)},gesture:{on:(_target,type,fn)=>{gesture[type]=fn;}},app:{onPause(){},onResume(){}}};
vm.runInNewContext(out,{module:mod,exports:mod.exports,Uint8Array,Uint16Array,Math,Date,View:()=>1,Canvas:props=>{draw=props.onDraw;return 2},signal,lume}, {timeout:10000});
const m=mod.exports;
function pass(name,fn,mutant){fn();if(mutant)assert.throws(mutant,undefined,name+' mutation escaped');console.log('PASS luna: '+name+'; mutation proof');}
function jd(s){return Date.parse(s+'T12:00:00Z')/86400000+2440587.5;}
function cyclic(p,target){return Math.min(Math.abs(p-target),1-Math.abs(p-target));}
for(const [date,expected] of [['2024-04-08',0],['2024-02-24',.5],['2025-01-13',.5]])
 pass('phase '+date,()=>assert.ok(cyclic(m.moonPhase(jd(date)).phase,expected)<.02),()=>assert.ok(cyclic((m.moonPhase(jd(date)).phase+.1)%1,expected)<.02));
pass('2000 new-moon epoch',()=>assert.ok(cyclic(m.moonPhase(2451550.26).phase,0)<.01),()=>assert.ok(cyclic(m.moonPhase(2451550.26).phase+.1,0)<.01));
pass('eight phase boundaries',()=>{for(let i=0;i<8;i++){assert.equal(m.phaseName(i/8),['NEW MOON','WAXING CRESCENT','FIRST QUARTER','WAXING GIBBOUS','FULL MOON','WANING GIBBOUS','LAST QUARTER','WANING CRESCENT'][i]);assert.equal(m.phaseName((i+.49)/8),m.phaseName(i/8));}},()=>assert.equal(m.phaseName(1/8),'NEW MOON'));
pass('distance April perigee window',()=>{const v=m.moonDistance(jd('2024-04-07'));assert.ok(v>=356500&&v<366000);assert.ok(m.moonDistance(jd('2024-04-21'))>395000);},()=>assert.ok(m.moonDistance(jd('2024-04-07'))>390000));
pass('terminator longitude wrap',()=>assert.equal(m.terminatorLon(.25,350),350),()=>assert.equal(m.terminatorLon(.25,350),0));
pass('texture wrap and nonflat albedo',()=>{const a=m.luSample(359,0),b=m.luSample(-1,0);assert.equal(a,b);assert.notEqual(m.luSample(0,0),m.luSample(90,0));},()=>assert.equal(m.luSample(0,0),m.luSample(90,0)));
pass('latitude compression',()=>{let prev=-91;for(let y=-.9;y<=.9;y+=.1){const v=m.luLatitude(y,0);assert.ok(v>prev);prev=v;}assert.ok(m.luLatitude(.9,0)>60);},()=>assert.ok(m.luLatitude(.9,0)<30));
pass('inertia ends within 20 frames',()=>{let v=10;for(let i=0;i<20;i++)v=m.luInertia(v);assert.equal(v,0);},()=>{let v=10;for(let i=0;i<20;i++)v*=.95;assert.ok(v<.1)});
pass('frame call cap',()=>{draw(canvas);assert.ok(canvas.calls<=220,canvas.calls+' calls');assert.ok(m.luPixels.some(x=>x!==0));},()=>assert.ok(canvas.calls>220));
pass('idle tick causes zero draws',()=>{const before=updates;for(const t of timers.values())if(t.ms===60000)t.fn();assert.equal(updates,before);},()=>assert.ok(updates>100000));
pass('unset clock is labelled and uses example phase',()=>{wall=0;for(const t of timers.values())if(t.ms===60000)t.fn();assert.equal(m.lu.live,false);assert.equal(m.lu.phase,.38);canvas.labels=[];draw(canvas);assert.ok(canvas.labels.some(s=>s.includes('CLOCK NOT SET')));wall=Date.parse('2024-04-08T18:00:00Z');for(const t of timers.values())if(t.ms===60000)t.fn();assert.equal(m.lu.live,true);},()=>assert.equal(m.lu.phase,.38));
pass('pan and double tap reset',()=>{gesture.panstart({dx:12,dy:0});gesture.pan({dx:62,dy:20});assert.notEqual(m.lu.rot,0);assert.ok(m.lu.pitch>0);gesture.panend();assert.ok([...timers.values()].some(t=>t.ms===50));gesture.tap();gesture.tap();assert.equal(m.lu.rot,0);assert.equal(m.lu.pitch,0);},()=>assert.notEqual(m.lu.rot,0));
