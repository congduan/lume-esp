const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const vm = require('node:vm');
const { buildSync } = require('../tools/lume/node_modules/esbuild');
const { runApp } = require('./lib/prelude_runner');
const before = cp.execFileSync('git', ['show', 'e0716d8:examples/files/app.js'], {encoding:'utf8'});
const after = buildSync({stdin:{contents:fs.readFileSync('examples/files/app.js','utf8') + '\nglobalThis.__r37AskDelete=askDelete;',resolveDir:process.cwd() + '/examples/files',sourcefile:'app.js'},bundle:true,format:'iife',
  platform:'neutral',target:'es2020',write:false}).outputFiles[0].text;
const oldApp = runApp(before), newApp = runApp(after);
vm.runInContext('askDelete("demo.txt")', oldApp.ctx);
assert.equal(vm.runInContext('status()', oldApp.ctx), 'press DEL again to delete demo.txt');
assert.equal(oldApp.ctx.Fs.list('/').includes('demo.txt'), true);
vm.runInContext('askDelete("demo.txt")', oldApp.ctx);
assert.equal(oldApp.ctx.Fs.list('/').includes('demo.txt'), false);
console.log('PASS files before: DEL -> status confirmation -> DEL -> remove');
newApp.ctx.__r37AskDelete('demo.txt');
assert.equal(newApp.ctx.Fs.list('/').includes('demo.txt'), true);
const deleteText = newApp.messages.find(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'Delete');
assert.ok(deleteText, 'dialog Delete button');
newApp.press(deleteText[1]);
assert.equal(newApp.ctx.Fs.list('/').includes('demo.txt'), false);
assert.ok(newApp.messages.some(m => m[0] === 'attr' && m[2] === 0 && m[3] === 'Deleted demo.txt'));
console.log('PASS files after: DEL -> Dialog -> Delete -> remove -> Toast');

// r206 frame draw-call budget: scrolling a 1000-entry file list stays <= 240 draw calls/frame
const scrollBundle = buildSync({
  stdin: {
    contents: fs.readFileSync('examples/files/app.js', 'utf8') + '\nglobalThis.__r206Seed=seedTestEntries;',
    resolveDir: process.cwd() + '/examples/files', sourcefile: 'app.js'
  },
  bundle: true, format: 'iife', platform: 'neutral', target: 'es2020', write: false
}).outputFiles[0].text;
const scrollApp = runApp(scrollBundle);
const beforeSeed = scrollApp.messages.length;
scrollApp.ctx.__r206Seed();
if (typeof scrollApp.ctx.__lume_tick === 'function') scrollApp.ctx.__lume_tick();
const drawCalls = scrollApp.messages.slice(beforeSeed).filter(m => m[0] === 'draw').length;
assert.ok(drawCalls <= 240, 'files scroll draw calls exceeded 240: ' + drawCalls);
console.log('PASS files r206 frame budget: 1000-entry list draw calls=' + drawCalls + ' (budget <=240)');
