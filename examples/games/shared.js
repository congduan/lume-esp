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
