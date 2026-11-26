/* Shared game helpers, duplicated so this app is a standalone deploy bundle. */
function gameLoop(fn, ms) { return lume.system.setInterval(fn, ms); }
function gameHigh(name) { var n = lume.storage.kv.get('hiscore.' + name); return typeof n === 'number' && n > 0 ? n : 0; }
function gameSave(name, score, previous) { if (score > previous) { lume.storage.kv.set('hiscore.' + name, score); return score; } return previous; }
function gameBeep(hz, ms) {
  /* 16 kHz, signed 16-bit LE stereo; <= 48 ms synchronous playback. */
  if (!lume.audio || !lume.audio.play) return;
  var samples = Math.floor(16000 * Math.min(ms, 48) / 1000);
  var pcm = new ArrayBuffer(samples * 4), v = new DataView(pcm);
  for (var i = 0; i < samples; i++) {
    var amplitude = (i % Math.max(2, Math.floor(16000 / hz))) < 8000 / hz ? 1800 : -1800;
    v.setInt16(i * 4, amplitude, true); v.setInt16(i * 4 + 2, amplitude, true);
  }
  lume.audio.play(pcm);
}
function gameAabb(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

function emptyBoard() { var b = []; for (var i = 0; i < 16; i++) b.push(0); return b; }
function addTile(board, random) {
  var free = []; for (var i = 0; i < 16; i++) if (!board[i]) free.push(i);
  if (!free.length) return false;
  var at = free[Math.floor(random() * free.length)]; board[at] = random() < .9 ? 2 : 4; return true;
}
function moveBoard(board, dir) {
  var out = board.slice(), gained = 0, changed = false, merges = [];
  for (var line = 0; line < 4; line++) {
    var indexes = [];
    for (var step = 0; step < 4; step++) indexes.push(dir === 'left' ? line * 4 + step : dir === 'right' ? line * 4 + 3 - step : dir === 'up' ? step * 4 + line : (3 - step) * 4 + line);
    var values = []; for (var j = 0; j < 4; j++) if (board[indexes[j]]) values.push(board[indexes[j]]);
    var packed = [];
    for (var k = 0; k < values.length; k++) {
      if (k + 1 < values.length && values[k] === values[k + 1]) {
        packed.push(values[k] * 2); gained += values[k] * 2; merges.push(indexes[packed.length - 1]); k++;
      } else packed.push(values[k]);
    }
    for (var p = 0; p < 4; p++) { out[indexes[p]] = packed[p] || 0; if (out[indexes[p]] !== board[indexes[p]]) changed = true; }
  }
  return { board: out, score: gained, changed: changed, merges: merges };
}
function boardOver(board) {
  for (var i = 0; i < 16; i++) {
    if (!board[i]) return false;
    if (i % 4 < 3 && board[i] === board[i + 1]) return false;
    if (i < 12 && board[i] === board[i + 4]) return false;
  }
  return true;
}
/* GAME UI */
var board = emptyBoard(); addTile(board, Math.random); addTile(board, Math.random);
var score = signal(0), best = signal(gameHigh('2048')), status = signal('Swipe to merge');
var color = { 2:'#EEE4DA',4:'#EDE0C8',8:'#F2B179',16:'#F59563',32:'#F67C5F',64:'#F65E3B',128:'#EDCF72',256:'#EDCC61',512:'#EDC850',1024:'#EDC53F',2048:'#EDC22E' };
var revision = signal(0);
var cells = [];
/* r201: absolute HUD/board pulled inside the 480-round safe square x,y in [75,405].
   Title/score/status and every tile now sit in the inscribed square; no gameplay change. */
var root = View({style:{width:480,height:480,background:'#0D1420',scroll:'none'}});
Text({parent:root,text:'2048',style:{position:'absolute',x:120,y:80,width:240,textAlign:'center',fontSize:24,borderRadius:0,color:'#F2F7FB'}});
Text({parent:root,text:function(){return 'SCORE '+score()+'    BEST '+best();},style:{position:'absolute',x:120,y:112,width:240,textAlign:'center',fontSize:16,borderRadius:0,color:'#9EB3C6'}});
Text({parent:root,text:function(){return status();},style:{position:'absolute',x:120,y:388,width:240,textAlign:'center',fontSize:14,borderRadius:0,color:'#40D8B0'}});
View({parent:root,style:{position:'absolute',x:120,y:146,width:240,height:240,background:'#16202E',borderRadius:12}});
for (var n = 0; n < 16; n++) (function(i) {
  var x = 123 + (i % 4) * 60, y = 149 + Math.floor(i / 4) * 60;
  var tile = View({parent:root,style:{position:'absolute',x:x,y:y,width:54,height:54,borderRadius:6,background:function(){revision();return color[board[i]] || (board[i] ? '#3C3A32' : '#1F2C3D');},transition:{property:'width',durationMs:90}}});
  var label = Text({parent:tile,text:function(){revision();return board[i] ? ''+board[i] : '';},style:{position:'absolute',x:0,y:15,width:54,textAlign:'center',fontSize:20,borderRadius:0,color:'#332D27'}});
  cells.push({tile:tile,label:label});
})(n);
function play2048(dir) {
  if (boardOver(board)) return;
  var result = moveBoard(board, dir); if (!result.changed) return;
  board = result.board; score.set(score() + result.score); best.set(gameSave('2048',score(),best()));
  addTile(board, Math.random); revision.set(revision()+1);
  status.set(boardOver(board) ? 'GAME OVER - tap' : result.score ? '+'+result.score : 'Swipe to merge');
  gameBeep(boardOver(board) ? 180 : result.score ? 620 : 360, 30);
  for (var i = 0; i < result.merges.length; i++) {
    var tile = cells[result.merges[i]].tile;
    lume.anim.to(tile,{attr:'width',from:48,to:54,durationMs:100});
  }
}
lume.gesture.on(root,'swipe',function(e){play2048(e.dir);});
for(var g=0;g<cells.length;g++) { lume.gesture.on(cells[g].tile,'swipe',function(e){play2048(e.dir);}); lume.gesture.on(cells[g].label,'swipe',function(e){play2048(e.dir);}); }
function restart2048(){if(boardOver(board)){board=emptyBoard();addTile(board,Math.random);addTile(board,Math.random);score.set(0);status.set('Swipe to merge');revision.set(revision()+1);}}
lume.gesture.on(root,'tap',restart2048);
for(var g=0;g<cells.length;g++){lume.gesture.on(cells[g].tile,'tap',restart2048);lume.gesture.on(cells[g].label,'tap',restart2048);}
