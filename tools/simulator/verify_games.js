#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {for(const [name,port,label,minimum] of [['2048',8791,'2048',20],['snake',8792,'SNAKE',5],['breakout',8793,'BREAKOUT',40]]){
  const child=spawn(process.execPath,['tools/simulator/sim.js',`examples/games_${name}/app.js`],{cwd:root,env:{...process.env,LUME_SIM_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  try {for(let i=0;i<60&&!output.includes('Host Simulator http://');i++){if(child.exitCode!==null)throw Error(output);await sleep(100);}
   assert.match(output,/Host Simulator http:\/\//);
   const page=await browser.newPage({viewport:{width:600,height:640}});await page.goto(`http://localhost:${port}/`);
   await page.getByText(label,{exact:true}).waitFor();await page.waitForTimeout(250);
   const nodes=await page.locator('#device [data-node-id]').count();assert.ok(nodes>=minimum,`${name} nodes=${nodes}`);
   const error=await page.locator('#error').textContent();assert.equal(error,'');
   const canvas=await page.locator('#device canvas').count();
   if(name==='2048'){assert.equal(canvas,0);assert.equal(await page.locator('#device .kind-0').count(),18);}
   else {assert.equal(canvas,1);const pixels=await page.locator('#device canvas').evaluate(el=>{const a=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let nonzero=0;for(let i=0;i<a.length;i+=4)if(a[i]||a[i+1]||a[i+2])nonzero++;return nonzero;});assert.ok(pixels>100,`${name} canvas pixels=${pixels}`);}
   const dest=path.join(root,'artifacts/simulator',`games-${name}.png`);await page.locator('#device').screenshot({path:dest});
   console.log(`PASS games-${name} DOM nodes=${nodes} canvas=${canvas} screenshot=artifacts/simulator/games-${name}.png`);await page.close();
  }finally{child.kill('SIGTERM');}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
