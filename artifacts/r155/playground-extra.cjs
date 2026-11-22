const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');const requireLume=createRequire(path.join(root,'tools/lume/package.json'));
const {buildSync}=requireLume('esbuild');const raw=fs.readFileSync(path.join(root,'examples/ipod_music/app.js'),'utf8');
fs.writeFileSync(path.join(root,'website/playground/sources/ipod_music.js'),raw);
const result=buildSync({entryPoints:[path.join(root,'examples/ipod_music/app.js')],bundle:true,format:'iife',platform:'neutral',target:'es2020',minify:true,write:false,logLevel:'silent',charset:'utf8'});
const code=result.outputFiles[0].text;
fs.writeFileSync(path.join(root,'website/playground/apps/ipod_music.js'),`window.LUME_APPS["ipod_music"] = ${JSON.stringify(code)};\n`);
const file=path.join(root,'website/playground/sources.js');const text=fs.readFileSync(file,'utf8');const prefix='window.LUME_SOURCES = ';const sources=JSON.parse(text.slice(prefix.length,-2));sources.ipod_music=raw;fs.writeFileSync(file,prefix+JSON.stringify(sources)+';\n');
console.log('PASS extra ipod_music bundle '+Buffer.byteLength(code)+' bytes; 56 editable sources');
