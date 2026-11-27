/* Word Ring - r118, original 5-letter word game, tap-only letter ring.
 * No keyboard / no swipe dependency: A-Z sit on a ring at the bottom; tap the
 * left arc to rotate back, the right arc to rotate on, and the ring centre to
 * place the selected letter into the current slot. DEL removes a letter, ENTER
 * submits a full 5-letter guess (a short or repeat guess is rejected). Six
 * guesses, green = right slot, yellow = in word wrong slot, grey = absent
 * (two-pass count so repeated letters are judged the usual way).
 *
 * Hard-edge fillRect on integer pixels (no AA). 26 A-Z (plus two arrows) are
 * hand-drawn 5x7 pixel glyphs precomputed into run-length spans ONCE at eval
 * and replayed every frame (the minesweeper / memory pattern); spanBuilds is a
 * stable count never touched by tick or onDraw. The answer list is embedded,
 * random pick (no RTC -> no daily puzzle), and any 5 letters may be submitted
 * (no guess dictionary - recorded simplification). KV keys are capped at 15
 * chars (lume_kv.c): 'wr.streak' / 'wr.best'. UI text is ASCII only (r64). */

/* ------------------- logic (host harness splits at GAME UI marker) ----- */

/* Single canvas 480x430 = 206,400 px, leaving a native-Text HUD band on top.
 * Full budget is one framebuffer 480x480 = 230,400 px. */
var IW = 480, IH = 430;
var WORD_LEN = 5, ROWS = 6;
/* r210: grid + ring band + button row stacked inside the 480-round safe
 * square ([75,405]). Old layout had DEL/ENTER/NEW at y=4 (unclickable) and
 * left no gap between the 56..328 grid and the 352..428 ring band. */
var CELL = 29, GAP = 2, GX = 163, GY = 116;
var RING_CY = 328, RING_RX = 150, RING_RY = 18;
/* 48px-tall tap band: the ring is interactive too (red line 3), not just the
 * button row. BAND 304..352, buttons 356..404 -> no overlap. */
var BAND_TOP = 304, BAND_BOT = 352, ROTL_X = 150, ROTR_X = 330;

var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
var KV_STREAK = 'wr.streak', KV_BEST = 'wr.best';   /* 9 / 7 chars, both < 15 */

var COL = {
  BG:'#0C0A10', EMPTY:'#191B24', EMPTY_B:'#333A48',
  PEND:'#2E3440', PEND_B:'#8AA0BC',
  GREEN:'#166B3E', GREEN_B:'#4FE08A',
  YELLOW:'#8A6A12', YELLOW_B:'#F2CE45',
  GRAY:'#30343E', GRAY_B:'#6E7585',
  INK:'#F2F4F8', RING:'#6E7A8C', SEL:'#27B3E8', SEL_INK:'#08161D'
};

/* 5x7 glyphs, '#' = ink, '.' = transparent. Original hand-drawn A-Z + arrows. */
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
  Z:['#####','....#','...#.','..#..','.#...','#....','#####'],
  '<':['...#.','..#..','.#...','#....','.#...','..#..','...#.'],
  '>':['.#...','..#..','...#.','....#','...#.','..#..','.#...']
};

/* Precompute spans once at eval; spanBuilds counts glyph keys (stable). */
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

/* Embedded answer list (all exactly five ASCII lowercase letters). */
var WORDS = [
  'about','above','actor','acute','adapt','admit','adopt','after','again','agent',
  'agree','ahead','alarm','album','alert','alike','alive','allow','alone','along',
  'alter','among','anger','angle','angry','apart','apple','apply','arena','argue',
  'arise','armed','array','arrow','aside','asset','audio','avoid','awake','award',
  'aware','badly','baker','basic','basin','basis','beast','begin','being','below',
  'bench','berry','birth','black','blade','blame','blank','blast','blaze','blend',
  'bless','blind','block','blood','bloom','blown','blues','blunt','board','bonus',
  'boost','booth','bound','brain','brake','brand','brass','brave','bread','break',
  'breed','brick','bride','brief','bring','broad','broke','brown','brush','build',
  'bunch','burst','cabin','cable','camel','canal','candy','canoe','carve','catch',
  'cause','chain','chair','chalk','charm','chase','cheap','check','cheek','cheer',
  'chess','chest','chief','child','chill','chose','civil','claim','clamp','clash',
  'clean','clear','clerk','click','cliff','climb','clock','clone','close','cloth',
  'cloud','clown','coach','coast','color','comet','comic','coral','count','court',
  'cover','crack','craft','crane','crash','crazy','cream','creek','creep','crept',
  'crown','crude','cruel','crush','curse','curve','cycle','daily','dance','dealt',
  'death','debut','decay','delay','depth','devil','diary','digit','dirty','doubt',
  'dough','dozen','draft','drain','drama','drank','dream','dress','dried','drink',
  'drive','drone','drove','drown','drums','eager','eagle','early','earth','eight',
  'elbow','elder','elect','elite','empty','enemy','enjoy','enter','entry','equal',
  'error','event','every','exact','exist','extra','fable','faith','false','fancy',
  'fatal','fault','favor','feast','fence','fever','field','fifth','fifty','fight',
  'final','first','fixed','flame','flash','fleet','flesh','flick','fling','float',
  'flock','flood','floor','flour','fluid','flush','focal','focus','foggy','force',
  'forge','forth','forty','found','frame','fresh','fried','front','frost','frown',
  'fruit','funny','ghost','giant','given','giver','glass','glide','globe','gloom',
  'glory','glove','going','grace','grade','grain','grand','grant','grape','graph',
  'grasp','grass','grave','great','green','greet','grief','grill','grind','groan',
  'groom','group','grove','growl','grown','guard','guess','guest','guide','guilt',
  'habit','happy','hardy','harsh','heart','heavy','hedge','hello','hence','hinge',
  'hobby','honey','honor','horse','hotel','house','human','humid','humor','hurry',
  'ideal','image','imply','index','inner','input','issue','ivory','jelly','jewel',
  'joint','joker','judge','juice','jumbo','karma','kayak','kneel','knife','knock',
  'known','label','labor','large','laser','later','laugh','layer','learn','lease',
  'least','leave','legal','lemon','level','light','limit','linen','liver','local',
  'logic','loose','lower','loyal','lucky','lunch','magic','major','maker','march',
  'match','maybe','mayor','meant','medal','media','mercy','merit','merry','metal',
  'meter','midst','might','minor','minus','mixed','model','money','month','moral',
  'motor','mount','mouse','mouth','movie','music','nasty','naval','needy','never',
  'newer','night','noble','noise','north','novel','nurse','ocean','offer','often',
  'olive','onion','order','other','ought','outer','owner','paint','panel','panic',
  'paper','party','paste','patch','pause','peace','peach','pearl','phase','photo',
  'piano','piece','pilot','pitch','pixel','pizza','place','plain','plane','plant',
  'plate','point','polar','porch','pound','power','press','price','pride','prime',
  'print','prior','prize','probe','proof','proud','prove','pulse','punch','pupil',
  'puppy','purge','purse','queen','query','quest','queue','quick','quiet','quite',
  'quota','quote','radar','radio','raise','rally','range','rapid','ratio','reach',
  'react','ready','realm','rebel','reign','relax','relay','renew','reply','rider',
  'ridge','rifle','right','rigid','rinse','risen','rival','river','roast','robot',
  'rough','round','route','royal','ruler','rumor','rural','sadly','safer','salad',
  'salon','salsa','salty','sandy','scale','scare','scarf','scene','scent','scope',
  'score','scout','screw','sense','serve','setup','seven','shade','shake','shall',
  'shame','shape','share','shark','sharp','sheep','sheer','sheet','shelf','shell',
  'shift','shine','shiny','shock','shoot','shore','short','shout','shown','sight',
  'silly','since','sixth','skill','skirt','skull','slate','sleep','slice','slide',
  'slope','small','smart','smash','smell','smile','smoke','snack','snake','sneak',
  'solar','solid','solve','sound','south','space','spare','speak','speed','spell',
  'spend','spice','spike','spine','spite','split','sport','spray','squad','stack',
  'staff','stage','stain','stair','stake','stale','stalk','stall','stamp','stand',
  'stare','start','state','steam','steel','steep','steer','stern','stick','stiff',
  'still','sting','stock','stone','stood','stool','store','storm','story','stove',
  'strap','straw','stray','strip','stuck','study','stuff','style','sugar','suite',
  'sunny','super','sweet','swift','swing','sword','table','taken','taste','teach',
  'tears','teeth','tempo','thank','theft','their','theme','there','these','thick',
  'thief','thing','think','third','those','three','threw','throw','thumb','tiger',
  'tight','timer','tired','title','today','token','tooth','topic','torch','total',
  'touch','tough','tower','track','trade','trail','train','trait','treat','trend',
  'trial','tribe','trick','tried','troop','truck','truly','trunk','trust','truth',
  'twice','twist','under','union','unite','unity','until','upper','upset','urban',
  'usage','usual','valid','value','vapor','vault','venue','verse','video','virus',
  'visit','vital','voice','voter','wagon','waist','waste','watch','water','weary',
  'weave','wedge','weigh','weird','whale','wheat','wheel','where','which','while',
  'white','whole','whose','widen','width','witch','woman','women','world','worry',
  'worse','worst','worth','would','wound','woven','write','wrong','wrote','yield',
  'young','youth','zebra'
];

function wrEmit(s, msg) { s.events.push(msg); }

/* Seeded/injectable pick; clamps a bad rnd() back into range. */
function wrPick(rnd) {
  var r = rnd ? rnd() : Math.random();
  var i = Math.floor(r * WORDS.length);
  if (i < 0) i = 0;
  if (i >= WORDS.length) i = WORDS.length - 1;
  return WORDS[i];
}

/* Streak / fewest-tries records. NVS keys <= 15 chars. */
function wrStreak() { try { var n = lume.storage.kv.get(KV_STREAK); return typeof n === 'number' && n >= 0 ? n : 0; } catch (e) { return 0; } }
function wrBest() { try { var n = lume.storage.kv.get(KV_BEST); return typeof n === 'number' && n > 0 ? n : 0; } catch (e) { return 0; } }
function wrSaveStreak(v) { try { lume.storage.kv.set(KV_STREAK, v); } catch (e) {} return v; }
function wrSaveBest(v) { try { lume.storage.kv.set(KV_BEST, v); } catch (e) {} return v; }

/* Fresh round. Records are loaded from KV at game start. */
function wrNewGame(answer, rnd) {
  var s = {
    answer: answer || wrPick(rnd),
    rows: [], current: '', sel: 0, attempt: 0, status: 'play',
    streak: wrStreak(), best: wrBest(), events: []
  };
  wrEmit(s, 'new words=' + WORDS.length);
  return s;
}

/* Two-pass verdict: first fix greens and tally the remaining answer letters,
 * then hand yellows from that tally left-to-right. G=right slot, Y=present
 * wrong slot, X=absent. Handles repeated letters the conventional way. */
function wrJudge(guess, answer) {
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

/* Ring rotation: dir -1 = left arc (back), +1 = right arc (on), wrap 0..25. */
function wrRotate(s, dir) {
  if (s.status !== 'play') return 'done';
  s.sel = (s.sel + dir + 26) % 26;
  return 'rotated';
}

/* Ring centre: place the selected letter into the next free slot. */
function wrConfirm(s) {
  if (s.status !== 'play') return 'done';
  if (s.current.length >= WORD_LEN) return 'full';
  var ch = ALPHABET.charAt(s.sel).toLowerCase();
  s.current += ch;
  wrEmit(s, 'add ' + ch + ' current=' + s.current);
  return 'added';
}

function wrBackspace(s) {
  if (s.status !== 'play') return 'done';
  if (s.current.length === 0) return 'empty';
  s.current = s.current.substring(0, s.current.length - 1);
  wrEmit(s, 'del current=' + s.current);
  return 'deleted';
}

/* Submit the 5-letter guess. Rejects short rows and repeat guesses without
 * consuming an attempt, and locks the board after a win or a loss. */
function wrSubmit(s) {
  if (s.status !== 'play') return 'done';
  if (s.current.length !== WORD_LEN) return 'short';
  for (var i = 0; i < s.rows.length; i++)
    if (s.rows[i].word === s.current) return 'duplicate';
  var guess = s.current;
  var marks = wrJudge(guess, s.answer);
  s.rows.push({ word: guess, marks: marks });
  s.attempt++;
  s.current = '';
  wrEmit(s, 'submit ' + guess + ' -> ' + marks.join(''));
  if (guess === s.answer) {
    s.status = 'win';
    s.streak = wrSaveStreak(wrStreak() + 1);
    if (s.best === 0 || s.attempt < s.best) s.best = wrSaveBest(s.attempt);
    wrEmit(s, 'WIN attempt=' + s.attempt + ' streak=' + s.streak);
  } else if (s.attempt >= ROWS) {
    s.status = 'lose';
    s.streak = wrSaveStreak(0);
    wrEmit(s, 'LOSE answer=' + s.answer);
  }
  return 'submitted';
}

/* ------------------------------ GAME UI ------------------------------ */

var state = wrNewGame(null, null);
var frame = signal(0), hudSig = signal(''), noteSig = signal('TAP A LETTER - OK TO PLACE');
var root = View({ style: { width: IW, height: 480, background: COL.BG, scroll: 'none' } });
function logEvent(msg) { lume.log('WR ' + msg); }
function box(x, y, w, h) { return { x: Math.floor(x), y: Math.floor(y), w: w, h: h }; }
function clip(r) { var x = Math.max(0, r.x), y = Math.max(0, r.y), rx = Math.min(IW, r.x + r.w), by = Math.min(IH, r.y + r.h); return rx > x && by > y ? box(x, y, rx - x, by - y) : null; }
function drawRect(ctx, color, r, a) { var x = Math.max(r.x, a.x), y = Math.max(r.y, a.y), x2 = Math.min(r.x + r.w, a.x + a.w), y2 = Math.min(r.y + r.h, a.y + a.h); if (x2 > x && y2 > y) { ctx.fillColor(color); ctx.fillRect(x, y, x2 - x, y2 - y); } }
function drawGlyph(ctx, key, cx, cy, scale, color, a) {
  var list = SPANS[key]; if (!list) return;
  for (var i = 0; i < list.length; i++) { var sp = list[i]; drawRect(ctx, color, box(cx + sp[0] * scale, cy + sp[1] * scale, sp[2] * scale, scale), a); }
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

function ringPos(i) {
  var ang = (i / 26) * Math.PI * 2 - Math.PI / 2;
  return { x: 240 + RING_RX * Math.cos(ang), y: RING_CY + RING_RY * Math.sin(ang) };
}
function paintRing(ctx, a) {
  var i, p, gx, gy, sel;
  for (i = 0; i < 26; i++) {
    p = ringPos(i); gx = Math.floor(p.x) - 2; gy = Math.floor(p.y) - 3;
    sel = i === state.sel;
    if (sel) {
      drawRect(ctx, COL.SEL, box(gx - 2, gy - 2, 9, 11), a);
      drawGlyph(ctx, ALPHABET.charAt(i), gx, gy, 1, COL.SEL_INK, a);
    } else {
      drawGlyph(ctx, ALPHABET.charAt(i), gx, gy, 1, COL.RING, a);
    }
  }
  drawGlyph(ctx, ALPHABET.charAt(state.sel), 230, RING_CY - 14, 4, COL.SEL, a);
  /* r210: rotate hints pulled in from x=36/430 to the safe square x [75,405]. */
  drawGlyph(ctx, '<', 78, RING_CY - 3, 2, COL.PEND_B, a);
  drawGlyph(ctx, '>', 394, RING_CY - 3, 2, COL.PEND_B, a);
}

var painted = false;
var canvas = Canvas({ parent: root, width: IW, height: IH, style: { position: 'absolute', x: 0, y: 0 }, onDraw: function (ctx) {
  frame();
  var a = !painted ? box(0, 0, IW, IH) : clip(box(0, GY - 4, IW, IH - (GY - 4)));
  if (!a) return undefined;
  ctx.fillColor(COL.BG); ctx.fillRect(a.x, a.y, a.w, a.h);
  paintGrid(ctx, a);
  paintRing(ctx, a);
  painted = true;
  return [a];
}});

/* r210: HUD moved from the full-bleed top-left corner (x=8, y=6/26/46) into
 * the safe square. It draws after the canvas and overlays the top of the
 * canvas band - the accepted r202/r209 trade-off (frogger/invaders pattern). */
Text({ parent: root, text: 'WORD RING', style: { position: 'absolute', x: 84, y: 76, width: 120, fontSize: 14, color: '#F2F4F8' } });
Text({ parent: root, text: function () { return hudSig(); }, style: { position: 'absolute', x: 210, y: 76, width: 186, fontSize: 14, color: '#F2CE45', textAlign: 'right' } });
Text({ parent: root, text: function () {
  if (state.status === 'win') return 'WIN IN ' + state.attempt + ' TRIES - TAP NEW';
  if (state.status === 'lose') return 'LOST - ' + state.answer.toUpperCase() + ' - TAP NEW';
  return noteSig() || 'TAP A LETTER - OK TO PLACE';
}, style: { position: 'absolute', x: 84, y: 94, width: 312, fontSize: 13, color: '#9FD8F0' } });

function updateHud() {
  hudSig.set('TRY ' + Math.min(state.attempt + 1, ROWS) + '/' + ROWS +
    '  STREAK ' + state.streak + '  BEST ' + (state.best > 0 ? state.best : '-'));
}
function flush() { while (state.events.length) logEvent(state.events.shift()); updateHud(); }

/* r210: button row moved from y=4 (top bezel, unclickable) to y=356..404.
 * 48px tall targets, centred within the safe square x [75,405]; DEL danger-
 * tinted versus ENTER/NEW primary, separated by a 16px gutter. */
Button({ title: 'DEL', style: { position: 'absolute', x: 104, y: 356, width: 72, height: 48, borderRadius: 6, background: '#3A2A1F', color: '#F2CE45', fontSize: 14 }, onPress: function () {
  if (wrBackspace(state) !== 'done') { noteSig.set('TAP A LETTER - OK TO PLACE'); frame.set(frame() + 1); }
  flush();
}});
Button({ title: 'ENTER', style: { position: 'absolute', x: 192, y: 356, width: 96, height: 48, borderRadius: 6, background: '#28331F', color: '#E8D46A', fontSize: 14 }, onPress: function () {
  var r = wrSubmit(state);
  if (r === 'short') noteSig.set('NEED 5 LETTERS');
  else if (r === 'duplicate') noteSig.set('ALREADY TRIED');
  else if (r === 'submitted') noteSig.set('TAP A LETTER - OK TO PLACE');
  frame.set(frame() + 1);
  flush();
}});
Button({ title: 'NEW', style: { position: 'absolute', x: 304, y: 356, width: 72, height: 48, borderRadius: 6, background: '#28331F', color: '#E8D46A', fontSize: 14 }, onPress: function () {
  state = wrNewGame(null, null);
  noteSig.set('TAP A LETTER - OK TO PLACE');
  painted = false;
  frame.set(frame() + 1);
  flush();
}});

/* Pure tap: left arc rotates back, right arc rotates on, centre confirms. */
function tap(e) {
  if (e.y < BAND_TOP || e.y > BAND_BOT) return;
  var r;
  if (e.x < ROTL_X) r = wrRotate(state, -1);
  else if (e.x > ROTR_X) r = wrRotate(state, 1);
  else r = wrConfirm(state);
  if (r === 'full') noteSig.set('SLOT FULL - ENTER TO SUBMIT');
  if (r !== 'done') frame.set(frame() + 1);
  flush();
}

lume.gesture.on(root, 'tap', tap);
lume.app.onPause(function () {});
lume.app.onResume(function () { frame.set(frame() + 1); });

updateHud();
logEvent('boot words=' + WORDS.length + ' keys=' + KV_STREAK + '/' + KV_BEST);
frame.set(frame() + 1);
