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
    list: path => path === '/music' ? ['song.mp3', 'notes.txt'] : -2,
    open: () => 0, close: () => 0,
    id3v1: () => ({title:'Song',artist:'Artist'}),
    id3v2: () => null,
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
evalIn('musicStop()');
assert.equal(evalIn('musicIndex'),-1);
evalIn('musicSelect(-3)');
assert.equal(evalIn('musicIndex'),0);
console.log('Scheduler: stop and negative-index wrap PASS');
// Five-line lyric window, manual timing correction and per-track persistence.
evalIn("musicLyrics=musicParseLrc('[00:00]A\\n[00:01]B\\n[00:02]C\\n[00:03]D\\n[00:04]E');musicOffsetMs=0;musicShowLyric(2000)");
assert.equal(evalIn('musicLineBefore2()'),'A');
assert.equal(evalIn('musicLineBefore()'),'B');
assert.equal(evalIn('musicLineNow()'),'C');
assert.equal(evalIn('musicLineAfter()'),'D');
assert.equal(evalIn('musicLineAfter2()'),'E');
evalIn('musicLyrics=[];musicShowLyric(0)');
assert.equal(evalIn('musicLineNow()'),'未找到歌词');
console.log('Lyrics: five-line window and missing LRC PASS');
const kvData = new Map([['music.last',JSON.stringify({file:'sub/second.mp3',positionMs:22000})]]);
const kv = {get:k=>kvData.get(k) ?? null,set:(k,v)=>(kvData.set(k,v),0)};
const opened = [];
const restored = runApp(source, {kv, audio:{mp3:{
  list: path => path === '/music' ? ['sub','first.mp3'] : path === '/music/sub' ? ['second.mp3'] : -2,
  open: path => (opened.push(path),0),close:()=>0,
  id3v2: path => ({title:path.includes('second')?'A second':'Z first',artist:'Tester'}),
  id3v1:()=>null,readText:()=>-2,decode:()=>null,
}}});
const check = code => vm.runInContext(code,restored.ctx);
assert.equal(opened[0],'/music/sub/second.mp3');
assert.equal(check('musicFiles[0]'),'sub/second.mp3');
check('musicOffset(500)');
assert.equal(JSON.parse(kvData.get('lrc.offsets'))['sub/second.mp3'],500);
assert.equal(check('musicOffsetMs'),500);
assert.equal(check('musicLineNow()'),'未找到歌词');
assert.equal(JSON.parse(kvData.get('music.last')).file,'sub/second.mp3');
console.log('Library: recursive scan, ID3 title order, last track and offset KV PASS');
const reopened = runApp(source, {kv, audio:{mp3:{
  list: path => path === '/music' ? ['sub','first.mp3'] : path === '/music/sub' ? ['second.mp3'] : -2,
  open:()=>0,close:()=>0,id3v2:()=>null,id3v1:()=>null,
  readText:()=>-2,decode:()=>null,
}}});
assert.equal(vm.runInContext('musicOffsetMs',reopened.ctx),500);
assert.equal(vm.runInContext('musicFiles[musicIndex]',reopened.ctx),'sub/second.mp3');
assert.equal(vm.runInContext('musicDecodedMs',reopened.ctx),0);
console.log('Restart: last track and LRC offset restored, playback starts at zero PASS');
