#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=resolve(process.argv[2]||'website');
let chromium;
try { ({chromium}=await import('playwright')); }
catch { try { ({chromium}=await import(pathToFileURL('/tmp/lume-playwright/node_modules/playwright/index.mjs').href)); } catch { console.error('Playwright not found. Install with: npm install --prefix /tmp/lume-playwright playwright && npx playwright@latest install chromium --with-deps'); process.exit(2); } }
const files=['index.html','guide.html','api.html','examples.html','faq.html','404.html'];
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{let path=resolve(dir,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(dir+'/'))throw Error('bad path');let bytes=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(bytes)}catch{res.statusCode=404;res.end('not found')}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const port=server.address().port;
let browser,fail=0;
try{browser=await chromium.launch({headless:true});for(const width of [320,375]){const page=await browser.newPage({viewport:{width,height:800},deviceScaleFactor:1});for(const file of files){await page.goto(`http://127.0.0.1:${port}/${file}`);await page.evaluate(()=>document.fonts.ready);const result=await page.evaluate(()=>{const w=document.documentElement.clientWidth,offenders=[];for(const el of document.querySelectorAll('body *')){if(el.closest('.table-scroll')&&el!==el.closest('.table-scroll'))continue;const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||el.getClientRects().length===0)continue;const r=el.getBoundingClientRect();if(r.left<-.5||r.right>w+.5)offenders.push({tag:el.tagName,cls:el.className?.toString().slice(0,40),left:r.left,right:r.right})}return {scrollWidth:document.documentElement.scrollWidth,clientWidth:w,offenders}});if(result.scrollWidth>width||result.offenders.length){fail++;console.log(`${width}px ${file}: FAIL`,JSON.stringify(result))}else console.log(`${width}px ${file}: pass; overflow=0; elements out of bounds=0`)}await page.close()}}finally{await browser?.close();server.close()}
process.exitCode=fail?1:0;
