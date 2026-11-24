#!/usr/bin/env node
/* Build-time NASA LROC equirectangular JPEG -> 256x128 RGB565.
 * ImageMagick's convert is used for JPEG decode; --builtin needs no tools. */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const W=256,H=128,OUT=path.resolve(__dirname,'../../examples/luna/moon_tex.js');
function builtin(){
  const rgb=Buffer.alloc(W*H*3);
  /* Approximate selenographic centres: Oceanus Procellarum, Imbrium,
   * Tranquillitatis, Crisium. This is an offline fallback, not LRO data. */
  const maria=[[-55,12,37,19,.34],[-16,33,19,15,.30],[31,8,19,13,.28],[59,17,10,11,.31],[-43,-18,16,10,.19],[18,-14,15,8,.14]];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const lon=x*360/W-180,lat=90-y*180/H;
    let v=170+11*Math.sin(x*1.71+y*.83)+6*Math.sin(x*4.23-y*2.12);
    for(const [cx,cy,rx,ry,drop] of maria){const dx=((lon-cx+540)%360)-180,d=(dx*dx/(rx*rx)+(lat-cy)*(lat-cy)/(ry*ry));v*=1-drop/(1+Math.exp((d-1)*5));}
    const p=(y*W+x)*3;rgb[p]=Math.max(0,Math.min(255,v));rgb[p+1]=Math.max(0,Math.min(255,v*.96));rgb[p+2]=Math.max(0,Math.min(255,v*.90));
  }return rgb;
}
function source(file){
  if(!file||file==='--builtin')return null;
  const r=spawnSync('convert',[file,'-resize',W+'x'+H+'!','-depth','8','rgb:-'],{maxBuffer:W*H*4});
  if(r.error||r.status!==0||r.stdout.length!==W*H*3){console.error('JPEG decode failed; using built-in fallback:',String(r.stderr||r.error));return null;}
  return r.stdout;
}
const src=source(process.argv[2]),rgb=src||builtin(),raw=Buffer.alloc(W*H*2);
for(let i=0;i<W*H;i++){const j=i*3,k=i*2,n=((rgb[j]>>3)<<11)|((rgb[j+1]>>2)<<5)|(rgb[j+2]>>3);raw[k]=n&255;raw[k+1]=n>>8;}
const b64=raw.toString('base64');
const js=`/* ${src?'NASA SVS CGI Moon Kit LROC WAC color map (2025), downsampled':'Built-in approximate maria fallback; regenerate from NASA JPEG for LRO imagery'}. RGB565 little endian. */\nexport var MOON_TEX={w:${W},h:${H},base64:'${b64}'};\n`;
fs.writeFileSync(OUT,js);
if(Buffer.byteLength(js)>=100000)throw Error('texture JS exceeds 100KB');
console.log(`${src?'NASA':'BUILTIN'} ${OUT} ${Buffer.byteLength(js)} bytes; RGB565 ${raw.subarray(0,16).toString('hex')}`);
