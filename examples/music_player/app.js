/* TF card MP3 player. Each timer callback decodes at most one frame. */
var musicAudio = lume.audio;
var musicMp3 = musicAudio && musicAudio.mp3;
var musicFiles = [], musicTags = {}, musicPage = 0;
var musicKv = lume.storage.kv, musicOffsets = {};
try { var savedOffsets = musicKv.get('lrc.offsets'); if (typeof savedOffsets === 'string') musicOffsets = JSON.parse(savedOffsets) || {}; } catch (_) {}
var musicOffsetMs = 0, musicLastSaveMs = 0;
var musicIndex = -1, musicPending = null, musicEof = false;
var musicPaused = false, musicStarted = 0, musicPauseAt = 0, musicPauseTotal = 0;
var musicDecodedMs = 0, musicDurationMs = 0, musicLyrics = [];
var musicTitle = signal('Music player');
var musicArtist = signal('TF card /music');
var musicStatus = signal('Loading library...');
var musicTime = signal('0:00 / 0:00');
var musicProgress = signal('____________________');
var musicLineBefore = signal('');
var musicLineNow = signal('Select a track');
var musicLineAfter = signal('');
var musicLineBefore2 = signal(''), musicLineAfter2 = signal('');
var musicOffsetLabel = signal('LRC +0.0s');
var musicPauseLabel = signal('Pause');
var musicVolume = 70;

function musicShort(s, n) {
  s = String(s || '').replace(/[\r\n]+/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '~' : s;
}
function musicClock(ms) {
  var s = Math.floor(Math.max(0, ms) / 1000);
  return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
}
function musicParseLrc(text) {
  var rows = [], lines = String(text || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], regex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    var matches = [], m, lyricStart = 0;
    while ((m = regex.exec(line))) {
      lyricStart = regex.lastIndex;
      var sec = Number(m[2]);
      if (sec < 60) matches.push((Number(m[1]) * 60 + sec) * 1000 +
        Number(((m[3] || '') + '000').slice(0, 3)));
    }
    if (!matches.length) continue;
    var lyric = musicShort(line.slice(lyricStart).trim(), 70);
    if (!lyric) continue;
    for (var j = 0; j < matches.length; j++) rows.push({ms: matches[j], text: lyric});
  }
  rows.sort(function (a, b) { return a.ms - b.ms; });
  return rows;
}
function musicShowLyric(ms) {
  if (!musicLyrics.length) {
    musicLineBefore2.set(''); musicLineBefore.set('');
    musicLineNow.set('未找到歌词'); musicLineAfter.set(''); musicLineAfter2.set('');
    return;
  }
  var idx = -1, adjusted = ms + musicOffsetMs;
  for (var i = 0; i < musicLyrics.length; i++) {
    if (musicLyrics[i].ms > adjusted) break;
    idx = i;
  }
  function at(i) { return i >= 0 && i < musicLyrics.length ? musicShort(musicLyrics[i].text, 34) : ''; }
  musicLineBefore2.set(at(idx - 2)); musicLineBefore.set(at(idx - 1));
  musicLineNow.set(idx < 0 ? '♪' : at(idx));
  musicLineAfter.set(at(idx + 1)); musicLineAfter2.set(at(idx + 2));
}
function musicOffset(delta) {
  if (musicIndex < 0) return;
  musicOffsetMs = Math.max(-30000, Math.min(30000, musicOffsetMs + delta));
  musicOffsets[musicFiles[musicIndex]] = musicOffsetMs;
  musicKv.set('lrc.offsets', JSON.stringify(musicOffsets));
  musicOffsetLabel.set('LRC ' + (musicOffsetMs >= 0 ? '+' : '') + (musicOffsetMs / 1000).toFixed(1) + 's');
  musicShowLyric(musicPosition());
}
function musicSaveState() {
  if (musicIndex < 0) return;
  musicKv.set('music.last', JSON.stringify({file:musicFiles[musicIndex],positionMs:Math.floor(musicPosition())}));
  musicLastSaveMs = Date.now();
}
function musicReadLyrics(name) {
  var stem = name.replace(/\.mp3$/i, '');
  var paths = ['/lyrics/' + stem + '.lrc', '/music/' + stem + '.lrc'];
  for (var i = 0; i < paths.length; i++) {
    var data = musicMp3.readText(paths[i]);
    if (typeof data === 'string') return musicParseLrc(data);
  }
  return [];
}
function musicStop() {
  musicIndex = -1;
  musicPending = null; musicEof = false;
  if (musicMp3) musicMp3.close();
  if (musicAudio && musicAudio.streamReset) musicAudio.streamReset();
}
function musicSelect(index) {
  if (!musicMp3 || !musicFiles.length) return;
  musicStop();
  musicIndex = ((index % musicFiles.length) + musicFiles.length) % musicFiles.length;
  var name = musicFiles[musicIndex];
  var rc = musicMp3.open('/music/' + name);
  if (rc < 0) { musicStatus.set('Open failed ' + rc); return; }
  var tag = musicTags[name] || null;
  musicTitle.set(musicShort(tag && tag.title || name.replace(/\.mp3$/i, ''), 32));
  musicArtist.set(musicShort(tag && tag.artist || 'Unknown artist', 32));
  musicOffsetMs = Number(musicOffsets[name]) || 0;
  musicOffsetLabel.set('LRC ' + (musicOffsetMs >= 0 ? '+' : '') + (musicOffsetMs / 1000).toFixed(1) + 's');
  musicLyrics = musicReadLyrics(name);
  musicDecodedMs = 0; musicDurationMs = 0;
  musicStarted = Date.now(); musicPauseTotal = 0; musicPaused = false;
  musicPauseLabel.set('Pause'); musicStatus.set('Playing ' + (musicIndex + 1) + '/' + musicFiles.length);
  musicShowLyric(0);
  musicSaveState(); musicShowPage(false);
}
function musicPosition() {
  if (musicIndex < 0) return 0;
  var now = musicPaused ? musicPauseAt : Date.now();
  return Math.min(musicDecodedMs, Math.max(0, now - musicStarted - musicPauseTotal));
}
function musicTick() {
  if (musicIndex < 0 || musicPaused || !musicMp3) return;
  if (!musicPending && !musicEof) {
    musicPending = musicMp3.decode();
    if (musicPending === null) musicEof = true;
    else if (typeof musicPending === 'number') {
      musicStatus.set('Decode failed ' + musicPending); musicStop(); return;
    }
  }
  if (musicPending) {
    var frame = musicPending;
    var pcm = frame.pcm;
    if (frame.channels === 1) {
      var mono = new Int16Array(pcm), stereo = new Int16Array(mono.length * 2);
      for (var i = 0; i < mono.length; i++) stereo[i * 2] = stereo[i * 2 + 1] = mono[i];
      pcm = stereo.buffer;
    }
    var rc = musicAudio.playStream(pcm,
      {sampleRate: frame.sampleRate, channels: 2, bits: 16});
    if (rc === 0) {
      musicPending = null;
      musicDecodedMs += frame.samples * 1000 / frame.sampleRate;
      if (frame.bitrateKbps > 0)
        musicDurationMs = frame.fileBytes * 8 / frame.bitrateKbps;
    } else if (rc !== -3) {
      musicStatus.set('Audio failed ' + rc); musicStop(); return;
    }
  }
  var position = musicPosition();
  musicTime.set(musicClock(position) + ' / ' + musicClock(musicDurationMs));
  var bars = musicDurationMs ? Math.min(20, Math.floor(position / musicDurationMs * 20)) : 0;
  musicProgress.set('█'.repeat(bars) + '─'.repeat(20 - bars));
  musicShowLyric(position);
  if (Date.now() - musicLastSaveMs >= 5000) musicSaveState();
  if (musicEof && !musicPending && musicAudio.streamFinished()) musicSelect(musicIndex + 1);
}
function musicPause() {
  if (musicIndex < 0) return;
  musicPaused = !musicPaused;
  if (musicPaused) musicPauseAt = Date.now();
  else musicPauseTotal += Date.now() - musicPauseAt;
  musicAudio.streamPause(musicPaused);
  musicPauseLabel.set(musicPaused ? 'Resume' : 'Pause');
  musicStatus.set(musicPaused ? 'Paused' : 'Playing');
  musicSaveState();
}
function musicScanDir(dir, depth) {
  if (depth > 4 || musicFiles.length >= 256) return;
  var names = musicMp3.list(dir);
  if (!Array.isArray(names)) return;
  names.sort();
  for (var i = 0; i < names.length && musicFiles.length < 256; i++) {
    var name = names[i];
    if (!name || name[0] === '.' || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) continue;
    var relative = dir === '/music' ? name : dir.slice(7) + '/' + name;
    if (/\.mp3$/i.test(name)) musicFiles.push(relative);
    else musicScanDir(dir + '/' + name, depth + 1);
  }
}
function musicShowLibraryRows() {
  for (var i = 0; i < 4; i++) {
    var index = musicPage * 4 + i;
    musicRows[i].set(index < musicFiles.length ? (index + 1) + '. ' +
      musicShort((musicTags[musicFiles[index]] || {}).title || musicFiles[index], 23) : '');
  }
}
function musicPageBy(delta) {
  musicPage = Math.max(0, Math.min(Math.ceil(musicFiles.length / 4) - 1, musicPage + delta));
  musicShowLibraryRows();
}
function musicScan() {
  if (!musicMp3) { musicStatus.set('MP3 API unavailable'); return; }
  musicFiles = []; musicTags = {}; musicPage = 0;
  var root = musicMp3.list('/music');
  if (typeof root === 'number') { musicStatus.set('TF card /music unavailable'); return; }
  musicScanDir('/music', 0);
  for (var i = 0; i < musicFiles.length; i++) {
    var tag = musicMp3.id3v2('/music/' + musicFiles[i]);
    if (!tag || typeof tag !== 'object') tag = musicMp3.id3v1('/music/' + musicFiles[i]);
    if (tag && typeof tag === 'object') musicTags[musicFiles[i]] = tag;
  }
  musicFiles.sort(function (a,b) {
    var aa=(musicTags[a] && musicTags[a].title || a).toLowerCase();
    var bb=(musicTags[b] && musicTags[b].title || b).toLowerCase();
    return aa < bb ? -1 : aa > bb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  musicStatus.set(musicFiles.length + ' tracks'); musicShowLibraryRows();
  var saved = null;
  try { var raw = musicKv.get('music.last'); if (typeof raw === 'string') saved = JSON.parse(raw); } catch (_) {}
  var found = saved && typeof saved.file === 'string' ? musicFiles.indexOf(saved.file) : -1;
  if (musicFiles.length) musicSelect(found >= 0 ? found : 0);
}
var musicRows = [signal(''),signal(''),signal(''),signal('')];
var musicNowPage, musicLibraryPage;
function musicShowPage(library) {
  if (musicNowPage) lume.setAttr(musicNowPage, 5, library ? 0 : 1);
  if (musicLibraryPage) lume.setAttr(musicLibraryPage, 5, library ? 1 : 0);
}
var musicNowPage = View({style:{width:480,height:480,background:'#09131f',scroll:'none'}}, [
  Text({text:'LUME  /  MUSIC',style:{x:48,y:36,width:380,height:28,color:'#65d9c4'}}),
  Text({text:musicTitle,style:{x:48,y:76,width:385,height:42,color:'#ffffff',fontSize:24}}),
  Text({text:musicArtist,style:{x:48,y:119,width:385,height:28,color:'#9bb3c9'}}),
  Text({text:musicLineBefore2,style:{x:48,y:155,width:380,height:22,color:'#657b91',textAlign:'center'}}),
  Text({text:musicLineBefore,style:{x:48,y:177,width:380,height:25,color:'#7890a7',textAlign:'center'}}),
  Text({text:musicLineNow,style:{x:48,y:205,width:380,height:38,
    background:'#17554e',borderRadius:10,textAlign:'center',fontSize:21}}),
  Text({text:musicLineAfter,style:{x:48,y:245,width:380,height:25,color:'#7890a7',textAlign:'center'}}),
  Text({text:musicLineAfter2,style:{x:48,y:270,width:380,height:22,color:'#657b91',textAlign:'center'}}),
  Text({text:musicProgress,style:{x:48,y:294,width:380,height:25,color:'#65d9c4'}}),
  Text({text:musicTime,style:{x:48,y:318,width:380,height:25,color:'#b7c9db'}}),
  Button({title:'Prev',style:{x:48,y:355,width:85,height:44},onPress:function(){musicSelect(musicIndex-1);}}),
  Button({title:musicPauseLabel,style:{x:145,y:355,width:100,height:44},onPress:musicPause}),
  Button({title:'Next',style:{x:257,y:355,width:85,height:44},onPress:function(){musicSelect(musicIndex+1);}}),
  Button({title:'Vol+',style:{x:354,y:355,width:78,height:44},onPress:function(){musicVolume=Math.min(100,musicVolume+10);musicAudio.setVolume(musicVolume);}}),
  Button({title:'Vol-',style:{x:354,y:405,width:78,height:35},onPress:function(){musicVolume=Math.max(0,musicVolume-10);musicAudio.setVolume(musicVolume);}}),
  Text({text:musicStatus,style:{x:48,y:414,width:175,height:25,color:'#9bb3c9'}}),
  Button({title:'-0.5',style:{x:48,y:442,width:72,height:30},onPress:function(){musicOffset(-500);}}),
  Text({text:musicOffsetLabel,style:{x:125,y:445,width:180,height:25,color:'#9bb3c9'}}),
  Button({title:'+0.5',style:{x:350,y:442,width:82,height:30},onPress:function(){musicOffset(500);}}),
  Button({title:'Library',style:{x:240,y:405,width:100,height:36},onPress:function(){musicShowPage(true);}})
]);
var musicLibraryItems = [
  Text({text:'MUSIC LIBRARY',style:{x:48,y:42,width:380,height:35,color:'#65d9c4',fontSize:22}}),
  Button({title:'Back',style:{x:48,y:385,width:105,height:48},onPress:function(){musicShowPage(false);}}),
  Button({title:'Refresh',style:{x:170,y:385,width:110,height:48},onPress:musicScan}),
  Text({text:musicStatus,style:{x:48,y:440,width:380,height:25,color:'#9bb3c9'}}),
  Button({title:'<',style:{x:300,y:385,width:55,height:48},onPress:function(){musicPageBy(-1);}}),
  Button({title:'>',style:{x:370,y:385,width:55,height:48},onPress:function(){musicPageBy(1);}})
];
for (var m = 0; m < 4; m++) (function (index) {
  musicLibraryItems.push(Button({title:musicRows[index],style:{x:48,y:105+index*65,width:380,height:52},
    onPress:function(){if(musicPage*4+index<musicFiles.length)musicSelect(musicPage*4+index);}}));
})(m);
musicLibraryPage = View({visible:false,style:{width:480,height:480,background:'#09131f',scroll:'none'}},musicLibraryItems);
if (musicAudio && musicAudio.setVolume) musicAudio.setVolume(musicVolume);
musicScan();
lume.system.setInterval(musicTick, 20);
