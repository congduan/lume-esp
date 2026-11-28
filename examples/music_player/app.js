/* r230 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args).
 * Mechanism mirrors the r227 __A_* shim (13 round flagships + 16 others). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r230Ctx) return c.__r230Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c['text'](__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r230Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_props(p, minTouch) {
  if (!__A_ADAPT || !p || typeof p !== 'object') return p;
  var o = {}, k;
  for (k in p) o[k] = (k === 'style') ? __A_style(p[k]) : p[k];
  if (minTouch && p.style && o.style) {
    if (typeof p.style.width === 'number' && p.style.width >= 48 && o.style.width < 48) o.style.width = 48;
    if (typeof p.style.height === 'number' && p.style.height >= 48 && o.style.height < 48) o.style.height = 48;
  }
  return o;
}
function __A_View(p, kids) { return View(__A_props(p, !!(p && p.onPress)), kids); }
function __A_Text(p, kids) { return Text(__A_props(p), kids); }
function __A_Button(p, kids) { return Button(__A_props(p, true), kids); }
function __A_Image(p, kids) { return Image(__A_props(p), kids); }
function __A_List(p) {
  if (!__A_ADAPT || !p) return List(p);
  var o = __A_props(p);
  o.itemHeight = __A_SY(p.itemHeight);
  return List(o);
}

/*
 * r204: music_player v2 -- Wear OS 4-band radial media player translated from
 * artifacts/r201/design/media.html (8.5/10 benchmark design).
 * Preserves ALL TF-card MP3 decode/stream/LRC/KV functional semantics:
 *   - One MP3 frame decoded per musicTick() callback.
 *   - Recursive /music scan, ID3v2/ID3v1 title sort, last-track resume KV
 *     ('music.last'), per-track LRC offset KV ('lrc.offsets'), 5-line lyric window.
 *   - Visual upgrades:
 *       1) Circular aurora vinyl cover disc + orbiting Canvas progress ring +
 *          scrubber knob dot (tap disc to open secondary Library & Lyrics page).
 *       2) Clean centered Track Title + Artist / Time metadata.
 *       3) 3-key circular transport controls: side Prev/Next >= 48px (52x52,
 *          vision fix) and center Play/Pause 1.3x larger (66x66, bright accent).
 *       4) Tactile pill volume slider bar (48px tall, 32px circular thumb,
 *          speaker icons, supports tap Vol-/Vol+ and drag).
 *       5) Per-frame Canvas draw call count <= 240.
 */
var musicAudio = lume.audio;
var musicMp3 = musicAudio && musicAudio.mp3;
var musicFiles = [], musicTags = {}, musicPage = 0;
var musicKv = lume.storage.kv, musicOffsets = {};
try { var savedOffsets = musicKv.get('lrc.offsets'); if (typeof savedOffsets === 'string') musicOffsets = JSON.parse(savedOffsets) || {}; } catch (_) {}
var musicOffsetMs = 0, musicLastSaveMs = 0;
var musicIndex = -1, musicPending = null, musicEof = false;
var musicPaused = false, musicStarted = 0, musicPauseAt = 0, musicPauseTotal = 0;
var musicDecodedMs = 0, musicDurationMs = 0, musicLyrics = [];
var musicTitle = signal('Midnight Pulse');
var musicArtist = signal('TF card /music');
var musicStatus = signal('Loading library...');
var musicTime = signal('0:00 / 0:00');
var musicProgress = signal('____________________');
var musicFrac = signal(0);
var musicPausedSig = signal(false);
var musicVolSig = signal(70);
var musicLineBefore = signal('');
var musicLineNow = signal('Select a track');
var musicLineAfter = signal('');
var musicLineBefore2 = signal(''), musicLineAfter2 = signal('');
var musicOffsetLabel = signal('LRC +0.0s');
var musicPauseLabel = signal('Pause');
var musicVolume = 70;
var musicLastDrawCalls = 0;

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
  musicFrac.set(0);
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
  musicTitle.set(musicShort(tag && tag.title || name.replace(/\.mp3$/i, ''), 24));
  musicArtist.set(musicShort(tag && tag.artist || 'Unknown artist', 22));
  musicOffsetMs = Number(musicOffsets[name]) || 0;
  musicOffsetLabel.set('LRC ' + (musicOffsetMs >= 0 ? '+' : '') + (musicOffsetMs / 1000).toFixed(1) + 's');
  musicLyrics = musicReadLyrics(name);
  musicDecodedMs = 0; musicDurationMs = 0;
  musicStarted = Date.now(); musicPauseTotal = 0; musicPaused = false;
  musicPausedSig.set(false);
  musicPauseLabel.set('Pause'); musicStatus.set('Playing ' + (musicIndex + 1) + '/' + musicFiles.length);
  musicFrac.set(0);
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
  var frac = musicDurationMs > 0 ? Math.max(0, Math.min(1, position / musicDurationMs)) : 0;
  musicFrac.set(Math.round(frac * 100) / 100);
  var bars = musicDurationMs ? Math.min(20, Math.floor(frac * 20)) : 0;
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
  musicPausedSig.set(musicPaused);
  musicPauseLabel.set(musicPaused ? 'Resume' : 'Pause');
  musicStatus.set(musicPaused ? 'Paused' : 'Playing');
  musicSaveState();
}
function musicSetVolume(v) {
  musicVolume = Math.max(0, Math.min(100, Math.round(v)));
  musicVolSig.set(musicVolume);
  if (musicAudio && musicAudio.setVolume) musicAudio.setVolume(musicVolume);
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
var musicTheme={colors:{bg:'#000000',primary:'#0D1420',surface:'#16202E',surfaceAlt:'#1F2C3D',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',danger:'#FF6B79',success:'#40D8B0'},radius:12,spacing:8,fontScale:1};
lume.theme.set(musicTheme);

/* ---- Band 1: 140x140 Cover Disc + Outer Progress Ring Canvas ----------- */
function drawCoverStage(c) {
  var calls = 0;
  var frac = musicFrac();
  var cx = 70, cy = 70;
  c.fillColor('#09131C'); c.fillRect(0, 0, 140, 140); calls++;

  /* Outer playback progress track (r = 62, width 5). */
  c.arc(cx, cy, 62, 0, 360, 5, '#1F2C3D'); calls++;
  if (frac > 0.005) {
    var sweep = Math.max(3, Math.round(frac * 360));
    /* Subtle glow approximation + crisp accent progress arc. */
    c.arc(cx, cy, 62, -90, -90 + sweep, 9, '#133C36'); calls++;
    c.arc(cx, cy, 62, -90, -90 + sweep, 5, '#40D8B0'); calls++;
    c.fillCircle(cx, cy - 62, 3, '#40D8B0'); calls++;
    var rad = (-90 + frac * 360) * Math.PI / 180;
    var dx = Math.round(cx + Math.cos(rad) * 62);
    var dy = Math.round(cy + Math.sin(rad) * 62);
    /* Scrubber knob dot at progress tip. */
    c.fillCircle(dx, dy, 6, '#1B5E53'); calls++;
    c.fillCircle(dx, dy, 4, '#F2F7FB'); calls++;
  } else {
    c.fillCircle(cx, cy - 62, 4, '#40D8B0'); calls++;
  }

  /* Circular vinyl cover disc (r = 53): layered aurora art + note motif. */
  c.fillCircle(cx, cy, 54, '#243547'); calls++;
  c.fillCircle(cx, cy, 52, '#102436'); calls++;
  c.fillCircle(cx - 10, cy - 14, 34, '#153445'); calls++;
  /* Golden moon/sun glow inside upper-right of disc. */
  c.fillCircle(cx + 18, cy - 22, 16, '#3B392C'); calls++;
  c.fillCircle(cx + 18, cy - 22, 9, '#9C8A5C'); calls++;
  /* Layered aurora wave bands clipped inside disc radius. */
  c.fillEllipse(cx + 4, cy + 16, 44, 18, '#2C8E9B'); calls++;
  c.fillEllipse(cx - 8, cy + 20, 34, 12, '#3AC0A8'); calls++;
  c.fillEllipse(cx + 2, cy + 30, 38, 15, '#B07B7E'); calls++;
  c.fillEllipse(cx + 10, cy + 36, 28, 10, '#C29B86'); calls++;
  /* Restore crisp circular mask edge over waves. */
  c.arc(cx, cy, 56, 0, 360, 8, '#09131C'); calls++;
  c.arc(cx, cy, 53, 0, 360, 2, '#2B3E52'); calls++;
  /* Subtle vinyl grooves + center spindle + musical note accent. */
  c.circle(cx, cy, 43, '#22384B'); calls++;
  c.circle(cx, cy, 33, '#1D3144'); calls++;
  c.fillCircle(cx, cy, 11, '#0D1420'); calls++;
  c.circle(cx, cy, 11, '#58718A'); calls++;
  c.fillCircle(cx, cy, 4, '#40D8B0'); calls++;
  /* Minimal crisp music note glyph near upper-left for no-cover clarity. */
  c.line(cx - 21, cy - 8, cx - 21, cy - 20, '#F2F7FB', 2);
  c.line(cx - 13, cy - 10, cx - 13, cy - 22, '#F2F7FB', 2);
  c.line(cx - 21, cy - 20, cx - 13, cy - 22, '#F2F7FB', 2);
  c.fillCircle(cx - 23, cy - 7, 2, '#F2F7FB');
  c.fillCircle(cx - 15, cy - 9, 2, '#F2F7FB');
  calls += 5;

  musicLastDrawCalls = calls;
}

/* ---- Band 3: 3-Key Transport Controls Canvas (Prev 52 / Play 66 / Next 52) */
function drawTransportCanvas(c) {
  var paused = musicPausedSig();
  c.fillColor('#09131C'); c.fillRect(0, 0, 240, 72);

  /* Prev circular button (center 32, 36; r = 26 -> 52x52 >= 48px vision fix). */
  c.fillCircle(32, 38, 26, '#050A10');
  c.fillCircle(32, 36, 26, '#3C5068');
  c.fillCircle(32, 36, 25, '#1D2B3D');
  c.fillColor('#F2F7FB');
  c.fillRect(23, 29, 3, 14);
  c.fillRect(38, 29, 2, 14);
  c.fillRect(36, 30, 2, 12);
  c.fillRect(34, 31, 2, 10);
  c.fillRect(32, 32, 2, 8);
  c.fillRect(30, 33, 2, 6);
  c.fillRect(28, 34, 2, 4);

  /* Center Play/Pause button (center 120, 36; r = 33 -> 66x66, ~1.3x side keys). */
  c.fillCircle(120, 36, 35, '#133B34');
  c.fillCircle(120, 36, 33, '#40D8B0');
  c.fillCircle(120, 34, 30, '#4EE0B9');
  c.fillCircle(120, 37, 29, '#40D8B0');
  if (!paused) {
    /* Pause bars in dark #0D1420 (10.7:1 contrast). */
    c.fillColor('#0D1420');
    c.fillRect(111, 26, 6, 20);
    c.fillRect(123, 26, 6, 20);
  } else {
    /* Solid play triangle in dark #0D1420. */
    c.fillColor('#0D1420');
    c.fillRect(113, 26, 3, 20);
    c.fillRect(116, 28, 3, 16);
    c.fillRect(119, 30, 3, 12);
    c.fillRect(122, 32, 3, 8);
    c.fillRect(125, 34, 3, 4);
  }

  /* Next circular button (center 208, 36; r = 26 -> 52x52 >= 48px vision fix). */
  c.fillCircle(208, 38, 26, '#050A10');
  c.fillCircle(208, 36, 26, '#3C5068');
  c.fillCircle(208, 36, 25, '#1D2B3D');
  c.fillColor('#F2F7FB');
  c.fillRect(214, 29, 3, 14);
  c.fillRect(200, 29, 2, 14);
  c.fillRect(202, 30, 2, 12);
  c.fillRect(204, 31, 2, 10);
  c.fillRect(206, 32, 2, 8);
  c.fillRect(208, 33, 2, 6);
  c.fillRect(210, 34, 2, 4);
}

/* ---- Band 4: 276x48 Pill Volume Slider Canvas -------------------------- */
function drawVolumeCanvas(c) {
  var v = musicVolSig();
  c.fillColor('#09131C'); c.fillRect(0, 0, 276, 48);
  /* Outer capsule background. */
  c.fillCircle(24, 24, 24, '#243447');
  c.fillCircle(252, 24, 24, '#243447');
  c.fillColor('#243447'); c.fillRect(24, 0, 228, 48);
  c.fillCircle(24, 24, 23, '#15202E');
  c.fillCircle(252, 24, 23, '#15202E');
  c.fillColor('#15202E'); c.fillRect(24, 1, 228, 46);

  /* Left low-volume speaker icon. */
  c.fillColor('#9EB3C6'); c.fillRect(14, 21, 4, 6);
  c.polyline([[18, 21], [23, 17], [23, 31], [18, 27]], '#9EB3C6', 2);

  /* Right high-volume speaker + teal waves icon. */
  c.fillColor('#F2F7FB'); c.fillRect(244, 21, 4, 6);
  c.polyline([[248, 21], [253, 17], [253, 31], [248, 27]], '#F2F7FB', 2);
  c.arc(253, 24, 4, -45, 45, 2, '#40D8B0');
  c.arc(253, 24, 7, -45, 45, 2, '#40D8B0');

  /* Center track (x=48..228, width 180) + teal fill + 32px circular thumb. */
  var rx = 48, rw = 180, ry = 24;
  c.fillCircle(rx, ry, 4, '#2A3B50');
  c.fillCircle(rx + rw, ry, 4, '#2A3B50');
  c.fillColor('#1F2C3D'); c.fillRect(rx, ry - 3, rw, 6);
  var fillW = Math.round((v / 100) * rw);
  if (fillW > 2) {
    c.fillColor('#24B398'); c.fillRect(rx, ry - 3, Math.floor(fillW / 2), 6);
    c.fillColor('#40D8B0'); c.fillRect(rx + Math.floor(fillW / 2), ry - 3, fillW - Math.floor(fillW / 2), 6);
    c.fillCircle(rx, ry, 3, '#24B398');
  }
  var tx = rx + fillW;
  c.fillCircle(tx, ry + 2, 16, '#091018');
  c.fillCircle(tx, ry, 16, '#40D8B0');
  c.fillCircle(tx, ry, 14, '#EAF2F8');
  c.fillCircle(tx, ry - 1, 12, '#FFFFFF');
  c.fillCircle(tx, ry, 4, '#117B69');
}

/* ---- Now Playing Page (Wear OS 4-band centered radial stage) ----------- */
var coverCanvas = __A_Canvas({ width: 140, height: 140, style: { position: 'absolute', x: 170, y: 76, scroll: 'none' },
  onDraw: drawCoverStage });
var coverTap = __A_View({ style: { position: 'absolute', x: 170, y: 76, width: 140, height: 140, borderRadius: 70, scroll: 'none' },
  onPress: function () { musicShowPage(true); } });

var transportCanvas = __A_Canvas({ width: 240, height: 72, style: { position: 'absolute', x: 120, y: 270, scroll: 'none' },
  onDraw: drawTransportCanvas });
var btnPrev = __A_View({ style: { position: 'absolute', x: 126, y: 280, width: 52, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { musicSelect(musicIndex - 1); } });
var btnPlay = __A_View({ style: { position: 'absolute', x: 207, y: 273, width: 66, height: 66, borderRadius: 999, scroll: 'none' },
  onPress: musicPause });
var btnNext = __A_View({ style: { position: 'absolute', x: 302, y: 280, width: 52, height: 52, borderRadius: 999, scroll: 'none' },
  onPress: function () { musicSelect(musicIndex + 1); } });

var volCanvas = __A_Canvas({ width: 276, height: 48, style: { position: 'absolute', x: 102, y: 352, scroll: 'none' },
  onDraw: drawVolumeCanvas });
var btnVolDown = __A_View({ style: { position: 'absolute', x: 102, y: 352, width: 52, height: 48, borderRadius: 24, scroll: 'none' },
  onPress: function () { musicSetVolume(musicVolume - 10); } });
var btnVolUp = __A_View({ style: { position: 'absolute', x: 326, y: 352, width: 52, height: 48, borderRadius: 24, scroll: 'none' },
  onPress: function () { musicSetVolume(musicVolume + 10); } });

var volDragStart = 70;
lume.gesture.on(volCanvas, 'panstart', function () { volDragStart = musicVolume; });
lume.gesture.on(volCanvas, 'pan', function (e) {
  musicSetVolume(volDragStart + (e.dx || 0) * 100 / 180);
});

var musicNowPage = __A_View({ style: { width: 480, height: 480, background: '#000000', padding: 0, gap: 0, scroll: 'none' } }, [
  /* Ambient circular watch screen bezel (r = 218 <= 220). */
  __A_View({ style: { position: 'absolute', x: 22, y: 22, width: 436, height: 436,
    borderRadius: 218, background: '#09131C', borderWidth: 1, borderColor: '#1B2A3B',
    padding: 0, gap: 0, scroll: 'none' } }),
  coverCanvas,
  coverTap,
  /* Track metadata: Title (20px bold) + Artist & Time (14px dim). */
  __A_Text({ text: musicTitle, style: { position: 'absolute', x: 90, y: 220, width: 300, height: 26,
    fontSize: 20, textAlign: 'center', longMode: 'dots', scroll: 'none' } }),
  __A_Text({ text: function () { return musicShort(musicArtist(), 15) + '  |  ' + musicTime(); },
    style: { position: 'absolute', x: 90, y: 248, width: 300, height: 18,
      fontSize: 14, textAlign: 'center', opacity: 0.72, longMode: 'dots', scroll: 'none' } }),
  /* 3-key transport controls + hit targets (52 / 66 / 52). */
  transportCanvas,
  btnPrev,
  btnPlay,
  btnNext,
  /* Tactile pill volume bar + Vol-/Vol+ touch zones. */
  volCanvas,
  btnVolDown,
  btnVolUp
]);

/* ---- Secondary Library & Lyrics Drawer Page (safe square [75, 405]) ---- */
var musicLibraryItems = [
  __A_View({ style: { position: 'absolute', x: 22, y: 22, width: 436, height: 436,
    borderRadius: 218, background: '#09131C', borderWidth: 1, borderColor: '#1B2A3B',
    padding: 0, gap: 0, scroll: 'none' } }),
  __A_Text({ text: 'Library & Lyrics', style: { position: 'absolute', x: 84, y: 80, width: 312, height: 26,
    fontSize: 20, textAlign: 'center', scroll: 'none' } }),
  __A_Text({ text: musicLineNow, style: { position: 'absolute', x: 84, y: 108, width: 312, height: 20,
    fontSize: 14, textAlign: 'center', opacity: 0.85, longMode: 'dots', scroll: 'none' } }),
  __A_Button({ title: 'Back', style: { position: 'absolute', x: 84, y: 348, width: 72, height: 48,
    background: '#1F2C3D', borderRadius: 999, fontSize: 14 }, onPress: function () { musicShowPage(false); } }),
  __A_Button({ title: '-0.5', style: { position: 'absolute', x: 162, y: 348, width: 54, height: 48,
    background: '#16202E', borderRadius: 999, fontSize: 14 }, onPress: function () { musicOffset(-500); } }),
  __A_Button({ title: '+0.5', style: { position: 'absolute', x: 222, y: 348, width: 54, height: 48,
    background: '#16202E', borderRadius: 999, fontSize: 14 }, onPress: function () { musicOffset(500); } }),
  __A_Button({ title: '<', style: { position: 'absolute', x: 284, y: 348, width: 52, height: 48,
    background: '#1F2C3D', borderRadius: 999, fontSize: 14 }, onPress: function () { musicPageBy(-1); } }),
  __A_Button({ title: '>', style: { position: 'absolute', x: 344, y: 348, width: 52, height: 48,
    background: '#1F2C3D', borderRadius: 999, fontSize: 14 }, onPress: function () { musicPageBy(1); } })
];
for (var m = 0; m < 4; m++) (function (index) {
  musicLibraryItems.push(__A_Button({ title: musicRows[index],
    style: { position: 'absolute', x: 84, y: 136 + index * 52, width: 312, height: 48,
      background: index % 2 ? '#1F2C3D' : '#16202E', borderRadius: 12, fontSize: 14 },
    onPress: function () { if (musicPage * 4 + index < musicFiles.length) musicSelect(musicPage * 4 + index); } }));
})(m);
musicLibraryPage = __A_View({ visible: false, style: { width: 480, height: 480, background: '#000000', padding: 0, gap: 0, scroll: 'none' } }, musicLibraryItems);

globalThis.musicUi = {
  coverCanvas: coverCanvas,
  transportCanvas: transportCanvas,
  volCanvas: volCanvas,
  btnPrev: btnPrev, btnPlay: btnPlay, btnNext: btnNext,
  btnVolDown: btnVolDown, btnVolUp: btnVolUp,
  getLastDrawCalls: function () { return musicLastDrawCalls; },
  FRAME_DRAW_BUDGET: 240,
  SKIP_BTN_PX: 52,
  PLAY_BTN_PX: 66
};

if (musicAudio && musicAudio.setVolume) musicAudio.setVolume(musicVolume);
musicScan();
lume.system.setInterval(musicTick, 20);
