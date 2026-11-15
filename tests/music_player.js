const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const source = fs.readFileSync('examples/music_player/app.js', 'utf8');
let decoded = 0, sent = 0, blocked = 0;
const player = runApp(source, { audio: {
  playStream: () => { if (blocked++ % 3 === 1) return -3; sent++; return 0; },
  streamFinished: () => true,
  mp3: {
    list: () => ['song.mp3', 'notes.txt'],
    open: () => 0, close: () => 0,
    id3v1: () => ({title:'Song',artist:'Artist'}),
    readText: () => '[00:00.00]Start\n[00:00.10]Middle\n[00:00.20]End',
    decode: () => decoded++ < 4 ? {pcm:new ArrayBuffer(4608),
      samples:1152,sampleRate:44100,channels:2,bitrateKbps:128,
      byteOffset:decoded*417,fileBytes:4096} : null,
  },
}});
function evalIn(code) { return vm.runInContext(code,player.ctx); }
const cases = [
  ['normal', '[01:02.34]Hello', 62340, 'Hello'],
  ['skip untimed', 'plain text\n[00:03.00]Timed', 3000, 'Timed'],
  ['sort', '[00:04.00]Later\n[00:02.00]Earlier', 2000, 'Earlier'],
  ['bad GBK bytes', '[00:01.00]�broken', 1000, '�broken'],
];
for (const [name,input,ms,value] of cases) {
  const rows = evalIn('musicParseLrc(' + JSON.stringify(input) + ')');
  assert.equal(rows[0].ms,ms); assert.equal(rows[0].text,value);
  console.log('LRC ' + name + ': PASS');
}
assert.equal(evalIn('musicFiles.length'),1);
for (let i=0;i<7;i++) evalIn('musicTick()');
assert.equal(decoded,5); assert.equal(sent,4);
assert.equal(evalIn('musicPending'),null);
console.log('Scheduler: ticks=7 decoded=' + decoded + ' sent=' + sent +
            ' retry=' + (blocked-sent) + ' PASS');
