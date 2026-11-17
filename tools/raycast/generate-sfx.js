#!/usr/bin/env node
/* Generate the four original short stereo sound effects as inspectable WAVs.
 * The app uses the same frequencies, durations, and 16 kHz attack/decay. */
const fs=require('fs'),path=require('path');
const sounds={door:[330,42],pickup:[660,38],hurt:[170,45],win:[880,45]};
const out=process.argv[2]||path.join(__dirname,'../../artifacts/raycast/sfx');
fs.mkdirSync(out,{recursive:true});
for(const [name,[hz,ms]] of Object.entries(sounds)){
 const frames=Math.floor(ms*16),bytes=frames*4,b=Buffer.alloc(44+bytes);
 b.write('RIFF',0);b.writeUInt32LE(36+bytes,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
 b.writeUInt32LE(16000,24);b.writeUInt32LE(64000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);
 b.write('data',36);b.writeUInt32LE(bytes,40);
 for(let i=0;i<frames;i++){
  const amp=Math.min(1,i/48)*(1-i/frames),v=Math.round(Math.sin(2*Math.PI*hz*i/16000)*9000*amp);
  b.writeInt16LE(v,44+i*4);b.writeInt16LE(v,46+i*4);
 }
 const file=path.join(out,name+'.wav');fs.writeFileSync(file,b);
 console.log(`${name}: ${hz}Hz ${ms}ms ${bytes} PCM bytes ${file}`);
}
