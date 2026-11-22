/* r149 - Wordle: 5 letters x 6 tries, on-screen QWERTY keyboard, pure app JS.
 *
 * Consumes the r148 shell.Keyboard plus its r153 per-key keyStates injection
 * (no firmware / prelude change). Two-pass verdict with the standard
 * repeated-letter rule (count the answer first, then hand out yellows
 * left-to-right, so no letter is over-awarded). Green = right slot, yellow =
 * present wrong slot, grey = absent. The highest verdict per letter (G > Y >
 * X) is fed straight to the keyboard's key cap backgrounds; the old self-drawn
 * 26-letter status bar is gone (tradeoff in KNOWN-SIMPLIFICATIONS).
 *
 * Dictionary: 300 embedded ASCII five-letter words, merged answer/guess list
 * (a guess must be in the list). NVS keys are <= 15 chars (lume_kv.c):
 * 'hisc.wordle' stores the longest win streak, 'wordle.cur' the current one,
 * 'wr.day' the dayIndex of the last win. All UI copy is ASCII (r64).
 *
 * r165: the answer is now deterministic per UTC day -- wdDayIndex() divides
 * lume.system.time() (unix ms) by 86400000 and wdPick() indexes WORDS with it.
 * Same day, same word; a new day means a new word. Before SNTP on a cold boot
 * time() is a small 1970 value, so dayIndex 0 maps to WORDS[0] ('about'). That
 * is the documented "clock not set" behaviour, not a bug; after SNTP the real
 * dayIndex takes over (it may switch the word within the same session). See
 * docs/KNOWN-SIMPLIFICATIONS.md. Touch feel stays deferred to board bring-up.
 */

import '../../runtime/shell.js';

/* ------------------- logic (host harness splits at GAME UI marker) ----- */

/* One canvas 480x228 = 109,440 px; the native HUD band and the shell keyboard
 * are separate nodes. Full framebuffer budget is 480x480 = 230,400 px. */
var IW = 480, CANVAS_H = 228, CANVAS_Y = 64;
var WORD_LEN = 5, ROWS = 6;
var CELL = 30, GAP = 4, GX = 157, GY = 4;
var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
var KV_BEST = 'hisc.wordle', KV_CUR = 'wordle.cur', KV_DAY = 'wr.day'; /* 11 / 10 / 7 chars */
var MS_PER_DAY = 86400000;

var COL = {
  BG:'#0C0A10', EMPTY:'#191B24', EMPTY_B:'#333A48',
  PEND:'#2E3440', PEND_B:'#8AA0BC',
  GREEN:'#166B3E', GREEN_B:'#4FE08A',
  YELLOW:'#8A6A12', YELLOW_B:'#F2CE45',
  GRAY:'#30343E', GRAY_B:'#6E7585',
  INK:'#F2F4F8'
};

/* 5x7 hand-drawn glyphs, '#' = ink. Precomputed to run-length spans once. */
var GLYPHS = {
  A:['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
  B:['####.','#...#','#...#','####.','#...#','#...#','####.'],
  C:['.###.','#...#','#....','#....','#....','#...#','.###.'],
  D:['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  E:['#####','#....','#....','####.','#....','#....','#####'],
  F:['#####','#....','#....','####.','#....','#....','#....'],
  G:['.###.','#...#','#....','#.###','#...#','#...#','.###.'],
  H:['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  I:['#####','..#..','..#..','..#..','..#..','..#..','#####'],
  J:['..###','...#.','...#.','...#.','...#.','#..#.','.##..'],
  K:['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
  L:['#....','#....','#....','#....','#....','#....','#####'],
  M:['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
  N:['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
  O:['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
  P:['####.','#...#','#...#','####.','#....','#....','#....'],
  Q:['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
  R:['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
  S:['.####','#....','#....','.###.','....#','....#','####.'],
  T:['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  U:['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
  V:['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
  W:['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  X:['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
  Y:['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
  Z:['#####','....#','...#.','..#..','.#...','#....','#####']
};

var SPANS = {}, spanBuilds = 0;
(function () {
  for (var k in GLYPHS) {
    spanBuilds++;
    var rows = GLYPHS[k], out = [];
    for (var y = 0; y < rows.length; y++) {
      var line = rows[y], x = 0;
      while (x < line.length) {
        var ink = line.charAt(x), st = x;
        while (x < line.length && line.charAt(x) === ink) x++;
        if (ink === '#') out.push([st, y, x - st]);
      }
    }
    SPANS[k] = out;
  }
})();

/* 300 embedded answer words (also the accepted guess list). All exactly five
 * lowercase ASCII letters, unique, spread across the alphabet. */
var WORDS = [
  'about','slate','point','brown','fudge','mango','vivid','notes','eerie','agent',
  'angry','apply','argue','array','aside','avoid','award','baker','basin','begin',
  'below','birth','blade','blank','blend','blind','bloom','blues','bonus','booth',
  'brake','brass','break','brick','bring','broke','build','burst','camel','candy',
  'catch','chain','charm','cheap','cheek','chest','child','civil','clamp','clear',
  'click','clock','close','clown','coast','comic','count','crack','crane','cream',
  'creep','crude','crush','cycle','dance','death','delay','devil','dirty','dough',
  'drain','drank','dried','drive','drown','eager','earth','elbow','elite','enemy',
  'entry','error','exact','extra','false','fatal','favor','fever','fifth','final',
  'fixed','fleet','flick','flock','floor','flush','focus','forge','forty','fresh',
  'front','fruit','ghost','giver','glide','glory','going','grain','grant','graph',
  'grave','green','grill','groan','grove','grown','guest','guilt','hardy','heart',
  'hello','hinge','honor','hotel','humid','hurry','imply','inner','ivory','jewel',
  'joker','jumbo','kayak','knock','label','laser','laugh','lease','leave','level',
  'limit','local','loose','lucky','magic','march','maybe','medal','mercy','metal',
  'midst','minor','model','month','mount','mouth','nasty','needy','night','noise',
  'nurse','offer','onion','other','owner','panel','party','patch','peach','phase',
  'piece','pitch','pizza','plane','plate','porch','power','pride','print','probe',
  'proud','punch','puppy','queen','quest','quiet','quota','radio','rally','ratio',
  'react','rebel','relax','renew','ridge','right','risen','river','rough','route',
  'rumor','sadly','salon','salty','scare','scene','score','screw','setup','shade',
  'shame','share','sheep','sheet','shift','shiny','shoot','shout','sight','sixth',
  'skirt','sleep','slide','smart','smell','snack','sneak','solve','south','speak',
  'spell','spike','spite','spray','stack','stain','stake','stalk','stand','start',
  'steel','steer','stiff','sting','stood','store','stove','straw','stuck','stuff',
  'suite','super','swing','table','teach','teeth','theft','theme','these','thing',
  'third','threw','thumb','timer','title','tooth','torch','tough','track','train',
  'treat','tribe','tried','truly','trust','twist','union','until','upset','usage',
  'value','vault','video','visit','voter','waist','water','weave','weird','wheat',
  'which','white','widen','witch','world','worse','would','woven','wrote','young'
];

function wdEmit(s, msg) { s.events.push(msg); }

/* r165: UTC day ordinal from the wall clock. time() is a number by contract
 * and never throws, but a defensive check keeps a broken host stub harmless.
 * A cold boot before SNTP yields a small -> dayIndex 0 (honest, see header). */
function wdDayIndex() {
  var t = lume.system.time();
  if (typeof t !== 'number' || !isFinite(t)) return 0;
  return Math.floor(t / MS_PER_DAY);
}

/* r165: deterministic daily pick -- same dayIndex always maps to the same
 * word. No random path remains. Negative dayIndex (not expected) wraps in. */
function wdPick(day) {
  var d = typeof day === 'number' ? day : wdDayIndex();
  var i = d % WORDS.length;
  if (i < 0) i += WORDS.length;
  return WORDS[i];
}

/* Streak records. get() may return null / negative error code; only a
 * nonnegative number is accepted. Every access is guarded (NVS may be off). */
function wdCur() { try { var n = lume.storage.kv.get(KV_CUR); return typeof n === 'number' && n >= 0 ? n : 0; } catch (e) { return 0; } }
function wdBest() { try { var n = lume.storage.kv.get(KV_BEST); return typeof n === 'number' && n >= 0 ? n : 0; } catch (e) { return 0; } }
function wdDay() { try { var n = lume.storage.kv.get(KV_DAY); return typeof n === 'number' && n >= 0 ? n : -1; } catch (e) { return -1; } }
function wdSaveCur(v) { try { lume.storage.kv.set(KV_CUR, v); } catch (e) {} return v; }
function wdSaveBest(v) { try { lume.storage.kv.set(KV_BEST, v); } catch (e) {} return v; }
function wdSaveDay(v) { try { lume.storage.kv.set(KV_DAY, v); } catch (e) {} return v; }

function wdNewGame(answer) {
  var day = wdDayIndex();
  var last = wdDay();
  /* r165: streak means consecutive days won. A gap of 2+ days since the last
   * win breaks it; same-day replays and the next day carry it forward. */
  if (last >= 0 && day - last >= 2) wdSaveCur(0);
  var s = {
    day: day,
    answer: answer || wdPick(day),
    rows: [], current: '', attempt: 0, status: 'play',
    streak: wdCur(), best: wdBest(), events: []
  };
  wdEmit(s, 'new words=' + WORDS.length + ' day=' + day);
  return s;
}

/* Two-pass verdict: fix greens and tally the remaining answer letters, then
 * spend that tally on non-green guess letters left to right. Repeated letters
 * are never over-awarded. G = right slot, Y = present wrong slot, X = absent. */
function wdJudge(guess, answer) {
  var res = [], counts = {}, i, ch;
  for (i = 0; i < WORD_LEN; i++) res.push('X');
  for (i = 0; i < WORD_LEN; i++) {
    if (guess.charAt(i) === answer.charAt(i)) res[i] = 'G';
    else { ch = answer.charAt(i); counts[ch] = (counts[ch] || 0) + 1; }
  }
  for (i = 0; i < WORD_LEN; i++) {
    if (res[i] === 'G') continue;
    ch = guess.charAt(i);
    if (counts[ch] > 0) { res[i] = 'Y'; counts[ch]--; }
  }
  return res;
}

/* Keyboard onKey -> one lowercase letter, or SPACE (ignored by the game).
 * Returns 'added' | 'full' | 'space' | 'ignore' | 'done'. */
function wdKey(s, ch) {
  if (s.status !== 'play') return 'done';
  if (ch === ' ') return 'space';
  if (typeof ch !== 'string' || ch.length !== 1) return 'ignore';
  ch = ch.toLowerCase();
  if (ch < 'a' || ch > 'z') return 'ignore';
  if (s.current.length >= WORD_LEN) return 'full';
  s.current += ch;
  wdEmit(s, 'add ' + ch + ' current=' + s.current);
  return 'added';
}

function wdBackspace(s) {
  if (s.status !== 'play') return 'done';
  if (s.current.length === 0) return 'empty';
  s.current = s.current.substring(0, s.current.length - 1);
  wdEmit(s, 'del current=' + s.current);
  return 'deleted';
}

/* Submit a full in-dictionary guess. Short / unknown / duplicate guesses spend
 * no attempt. Win grows and persists the streak; loss resets it to zero. */
function wdSubmit(s) {
  if (s.status !== 'play') return 'done';
  if (s.current.length !== WORD_LEN) return 'short';
  if (WORDS.indexOf(s.current) < 0) return 'invalid';
  for (var i = 0; i < s.rows.length; i++)
    if (s.rows[i].word === s.current) return 'duplicate';
  var guess = s.current, marks = wdJudge(guess, s.answer);
  s.rows.push({ word: guess, marks: marks });
  s.attempt++;
  s.current = '';
  wdEmit(s, 'submit ' + guess + ' -> ' + marks.join(''));
  if (guess === s.answer) {
    s.status = 'win';
    s.streak = wdSaveCur(wdCur() + 1);
    wdSaveDay(s.day);
    if (s.best < s.streak) s.best = wdSaveBest(s.streak);
    wdEmit(s, 'WIN attempt=' + s.attempt + ' streak=' + s.streak);
  } else if (s.attempt >= ROWS) {
    s.status = 'lose';
    s.streak = wdSaveCur(0);
    wdEmit(s, 'LOSE answer=' + s.answer);
  }
  return 'submitted';
}

/* Highest feedback per letter over all submitted rows, G > Y > X. Fed to the
 * keyboard's keyStates as hit (G) / present (Y) / miss (X). */
function wdLetterMarks(s) {
  var m = {}, rank = { X: 1, Y: 2, G: 3 }, r, c, ch, mark;
  for (r = 0; r < s.rows.length; r++)
    for (c = 0; c < WORD_LEN; c++) {
      ch = s.rows[r].word.charAt(c);
      mark = s.rows[r].marks[c];
      if (!m[ch] || rank[mark] > rank[m[ch]]) m[ch] = mark;
    }
  return m;
}

/* ------------------------------ GAME UI ------------------------------ */

var state = wdNewGame();
var frame = signal(0), hudSig = signal(''), noteSig = signal('TYPE A WORD - ENTER TO SUBMIT');
/* r153: translate the highest per-letter verdict into shell keyStates and
 * publish it as a signal; only keys whose tint changes rewrite their ATTR. */
var keyStatesSig = signal({});
function refreshKeyStates() {
  var marks = wdLetterMarks(state), out = {}, ch;
  for (ch in marks) out[ch] = marks[ch] === 'G' ? 'hit' : marks[ch] === 'Y' ? 'present' : 'miss';
  keyStatesSig.set(out);
}

lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435',
  surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var root = View({ style: { x: 0, y: 0, width: IW, height: 480,
  background: '#0C0A10', scroll: 'none' } });

function logEvent(msg) { lume.log('WD ' + msg); }
function box(x, y, w, h) { return { x: Math.floor(x), y: Math.floor(y), w: w, h: h }; }
function clip(r) {
  var x = Math.max(0, r.x), y = Math.max(0, r.y);
  var rx = Math.min(IW, r.x + r.w), by = Math.min(CANVAS_H, r.y + r.h);
  return rx > x && by > y ? box(x, y, rx - x, by - y) : null;
}
function drawRect(ctx, color, r, a) {
  var x = Math.max(r.x, a.x), y = Math.max(r.y, a.y);
  var x2 = Math.min(r.x + r.w, a.x + a.w), y2 = Math.min(r.y + r.h, a.y + a.h);
  if (x2 > x && y2 > y) { ctx.fillColor(color); ctx.fillRect(x, y, x2 - x, y2 - y); }
}
function drawGlyph(ctx, key, cx, cy, scale, color, a) {
  var list = SPANS[key]; if (!list) return;
  for (var i = 0; i < list.length; i++) {
    var sp = list[i];
    drawRect(ctx, color, box(cx + sp[0] * scale, cy + sp[1] * scale, sp[2] * scale, scale), a);
  }
}

function paintGrid(ctx, a) {
  var r, c, cx, cy, row, mark, bg, edge, ch;
  for (r = 0; r < ROWS; r++) {
    row = r < state.rows.length ? state.rows[r] : null;
    for (c = 0; c < WORD_LEN; c++) {
      cx = GX + c * (CELL + GAP); cy = GY + r * (CELL + GAP);
      bg = COL.EMPTY; edge = COL.EMPTY_B; ch = '';
      if (row) {
        mark = row.marks[c];
        bg = mark === 'G' ? COL.GREEN : mark === 'Y' ? COL.YELLOW : COL.GRAY;
        edge = mark === 'G' ? COL.GREEN_B : mark === 'Y' ? COL.YELLOW_B : COL.GRAY_B;
        ch = row.word.charAt(c);
      } else if (r === state.attempt && state.status === 'play' && c < state.current.length) {
        bg = COL.PEND; edge = COL.PEND_B; ch = state.current.charAt(c);
      }
      drawRect(ctx, bg, box(cx, cy, CELL, CELL), a);
      drawRect(ctx, edge, box(cx, cy, CELL, 2), a);
      drawRect(ctx, edge, box(cx, cy, 2, CELL), a);
      drawRect(ctx, edge, box(cx, cy + CELL - 2, CELL, 2), a);
      drawRect(ctx, edge, box(cx + CELL - 2, cy, 2, CELL), a);
      if (ch) drawGlyph(ctx, ch.toUpperCase(), cx + 7, cy + 4, 3, COL.INK, a);
    }
  }
}

var painted = false;
var canvas = Canvas({ parent: root, width: IW, height: CANVAS_H,
  style: { position: 'absolute', x: 0, y: CANVAS_Y }, onDraw: function (ctx) {
    frame();
    var a = !painted ? box(0, 0, IW, CANVAS_H) :
      clip(box(0, GY - 2, IW, CANVAS_H - (GY - 2)));
    if (!a) return undefined;
    ctx.fillColor(COL.BG); ctx.fillRect(a.x, a.y, a.w, a.h);
    paintGrid(ctx, a);
    painted = true;
    return [a];
  } });

Text({ parent: root, text: 'WORDLE', style: { position: 'absolute', x: 8, y: 6,
  fontSize: 14, color: '#F2F4F8' } });
Text({ parent: root, text: function () { return hudSig(); },
  style: { position: 'absolute', x: 8, y: 26, fontSize: 14, color: '#F2CE45' } });
Text({ parent: root, text: function () {
  if (state.status === 'win') return 'WIN IN ' + state.attempt + ' - TAP NEW';
  if (state.status === 'lose') return 'LOST - ' + state.answer.toUpperCase() + ' - TAP NEW';
  return noteSig();
}, style: { position: 'absolute', x: 8, y: 46, fontSize: 14, color: '#9FD8F0' } });

function updateHud() {
  hudSig.set('DAY #' + state.day + '  TRY ' + Math.min(state.attempt + 1, ROWS) + '/' + ROWS +
    '  STREAK ' + state.streak + '  BEST ' + state.best);
}
function flush() { while (state.events.length) logEvent(state.events.shift()); updateHud(); }
function newRound() {
  state = wdNewGame();
  refreshKeyStates();
  noteSig.set('TYPE A WORD - ENTER TO SUBMIT');
  painted = false;
  frame.set(frame() + 1);
  flush();
}

Button({ parent: root, title: 'NEW', style: { position: 'absolute', x: 402, y: 4,
  width: 70, height: 32, borderRadius: 6, background: '#3A2A1F',
  color: '#F2CE45', fontSize: 14 }, onPress: newRound });

/* r148 shell keyboard: keySize 40 (the touch floor), gap 0 so ten columns fit
 * 480 px, y 300 so the 168 px keyboard sits above the bottom bezel. */
var keyboard = lume.ui.shell.Keyboard({
  parent: root, width: IW, keySize: 40, gap: 0, y: 300,
  keyStates: keyStatesSig,
  onKey: function (ch) {
    var r = wdKey(state, ch);
    if (r === 'full') noteSig.set('SLOT FULL - ENTER TO SUBMIT');
    else if (r === 'space') noteSig.set('SPACE IGNORED - LETTERS ONLY');
    else if (r === 'added') noteSig.set('TYPE A WORD - ENTER TO SUBMIT');
    if (r !== 'done' && r !== 'ignore') frame.set(frame() + 1);
    flush();
  },
  onBackspace: function () {
    if (wdBackspace(state) === 'deleted') {
      noteSig.set('TYPE A WORD - ENTER TO SUBMIT');
      frame.set(frame() + 1);
    }
    flush();
  },
  onSubmit: function () {
    var r = wdSubmit(state);
    if (r === 'submitted') refreshKeyStates();
    if (r === 'short') noteSig.set('NEED 5 LETTERS');
    else if (r === 'invalid') noteSig.set('NOT IN WORD LIST');
    else if (r === 'duplicate') noteSig.set('ALREADY TRIED');
    else if (r === 'submitted') {
      noteSig.set(state.status === 'win' ? 'SOLVED - TAP NEW' :
        state.status === 'lose' ? 'GAME OVER - TAP NEW' : 'TYPE A WORD - ENTER TO SUBMIT');
      frame.set(frame() + 1);
    }
    flush();
  }
});

lume.app.onPause(function () {});
lume.app.onResume(function () { frame.set(frame() + 1); });

/* Handles for the host harness / dev console; no device-side effect. */
globalThis.wdGetGame = function () { return state; };
globalThis.wdKb = keyboard;
globalThis.wdNewRound = newRound;
globalThis.wdCanvas = canvas;
globalThis.wdKeyStates = keyStatesSig;

updateHud();
logEvent('boot words=' + WORDS.length + ' keys=' + KV_BEST + '/' + KV_CUR + '/' + KV_DAY);
frame.set(frame() + 1);
