/*
 * r118 host harness for examples/wordring (tap-only letter-ring word game).
 *
 *   node tests/wordring.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * like tests/minesweeper.js / tests/memory.js. lume.storage.kv is mocked so the
 * streak / fewest-tries record paths run without NVS. A second half boots the
 * real prelude (tests/lib/prelude_runner.js) to exercise the tap gesture ->
 * rotate / confirm -> draw pipeline and a ~60 s smoke.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/wordring/app.js', 'utf8');
const marker = '/* ------------------------------ GAME UI';
let kvStore = {};
const mockLume = {
  storage: { kv: {
    get: (k) => (k in kvStore ? kvStore[k] : null),
    set: (k, v) => { kvStore[k] = v; return 0; },
    remove: (k) => { delete kvStore[k]; return 0; },
  } },
  log: () => {},
};

function logic() {
  const src = source.split(marker)[0];
  const ctx = vm.createContext({
    lume: mockLume, Math, JSON, console,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object,
  });
  vm.runInContext(src, ctx);
  return ctx;
}
const s = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); } // vm-realm -> host realm

/* Fill a whole guess using the ring logic (set sel per letter, then confirm). */
function setWord(st, word) {
  st.current = '';
  for (const ch of word) {
    st.sel = s.ALPHABET.indexOf(ch.toUpperCase());
    assert.ok(st.sel >= 0, 'letter in alphabet: ' + ch);
    assert.equal(s.wrConfirm(st), 'added');
  }
}

// 0. r64 font discipline: no decorative Unicode in UI strings
{
  const ui = source.split(marker)[1];
  const strings = ui.match(/'[^'\n]*'/g) || [];
  for (const str of strings) {
    const body = str.slice(1, -1);
    assert.ok(/^[\x20-\x7E]*$/.test(body), 'UI string ASCII-only: ' + body);
  }
  console.log('PASS wordring UI strings ASCII-only (r64 font rule)');
}

// 1. embedded dictionary: >=200 unique, all exactly five ASCII lowercase letters
{
  assert.ok(s.WORDS.length >= 200, 'word list >= 200, got ' + s.WORDS.length);
  assert.equal(new Set(s.WORDS).size, s.WORDS.length, 'no duplicate answers');
  for (const w of s.WORDS) assert.match(w, /^[a-z]{5}$/, 'five lowercase ASCII letters: ' + w);
  for (const w of s.WORDS) assert.equal(s.wrJudge(w, w).join(''), 'GGGGG', 'self verdict all green: ' + w);
  console.log('PASS wordring dictionary: ' + s.WORDS.length + ' unique five-letter ASCII words, all self-green');
}

// 2. glyph spans: 26 A-Z + 2 arrows, 5x7 each, precomputed once
{
  assert.equal(Object.keys(s.SPANS).length, s.spanBuilds);
  assert.equal(s.spanBuilds, 28, '26 letters + 2 arrows');
  assert.equal(s.ALPHABET.length, 26);
  for (let i = 0; i < 26; i++) assert.ok(s.SPANS[s.ALPHABET.charAt(i)], 'glyph exists: ' + s.ALPHABET.charAt(i));
  for (const k in s.SPANS) {
    assert.equal(s.GLYPHS[k].length, 7, k + ' is 7 rows');
    for (const row of s.GLYPHS[k]) assert.equal(row.length, 5, k + ' row is 5 cols');
    assert.ok(s.SPANS[k].length >= 2, k + ' decodes to spans');
    for (const sp of s.SPANS[k]) {
      assert.equal(sp.length, 3, 'span = [x,y,len]');
      assert.ok(sp[0] >= 0 && sp[0] + sp[2] <= 5, 'span x within glyph');
      assert.ok(sp[1] >= 0 && sp[1] < 7, 'span row within glyph');
      assert.ok(sp[2] >= 1, 'span has length');
    }
  }
  console.log('PASS wordring glyphs: 28 five-by-seven glyphs decoded to valid spans');
}

// 3. verdict basics: green / yellow / grey, no mutation of inputs
{
  assert.equal(s.wrJudge('crane', 'crane').join(''), 'GGGGG', 'exact match');
  assert.equal(s.wrJudge('slate', 'crane').join(''), 'XXGXG', 'two greens only, shared letters in right slot');
  assert.equal(s.wrJudge('notes', 'stone').join(''), 'YYYYY', 'all letters present, all wrong slot');
  assert.equal(s.wrJudge('xxxxx', 'crane').join(''), 'XXXXX', 'nothing present');
  const g = 'crane', a = 'stone';
  s.wrJudge(g, a);
  assert.equal(g, 'crane'); assert.equal(a, 'stone');
  console.log('PASS wordring verdict: green/yellow/grey + input immutability');
}

// 4. duplicate letters: count answer first, then consume yellows left-to-right
{
  assert.equal(s.wrJudge('eerie', 'level').join(''), 'YGXXX',
    'two guess E vs one remaining answer E -> second E is grey');
  assert.equal(s.wrJudge('level', 'eerie').join(''), 'XGXYX',
    'answer has three E, guess has two -> one green and one yellow only');
  assert.equal(s.wrJudge('aabbc', 'abcde').join(''), 'GXYXY',
    'repeated A/B consumed left-to-right');
  assert.equal(s.wrJudge('pupil', 'apple').join(''), 'YXGXY',
    'answer two P + one L, guess two P + one L -> each matched once, left-to-right');
  console.log('PASS wordring duplicate letters: two-pass count, no over-awarding');
}

// 5. fresh round + ring rotation wraps both directions
{
  kvStore = {};
  const st = s.wrNewGame('crane', null);
  assert.equal(st.answer, 'crane');
  assert.equal(st.status, 'play');
  assert.equal(st.attempt, 0);
  assert.equal(st.current, '');
  assert.equal(st.sel, 0);
  assert.equal(plain(st.rows).length, 0);
  assert.equal(st.streak, 0); assert.equal(st.best, 0);
  assert.ok(st.events.some((e) => e.startsWith('new words=')));
  assert.equal(s.wrRotate(st, -1), 'rotated');
  assert.equal(st.sel, 25, 'left from A wraps to Z');
  assert.equal(s.wrRotate(st, 1), 'rotated');
  assert.equal(st.sel, 0, 'right from Z wraps to A');
  for (let i = 0; i < 5; i++) s.wrRotate(st, 1);
  assert.equal(st.sel, 5, 'five steps -> F');
  console.log('PASS wordring new game + rotation: wrap 0..25 both directions');
}

// 6. ring confirm / backspace and the full-slot guard
{
  const st = s.wrNewGame('crane', null);
  st.sel = 0;
  assert.equal(s.wrConfirm(st), 'added');
  assert.equal(st.current, 'a', 'confirm stores lowercase letter');
  assert.equal(s.wrBackspace(st), 'deleted');
  assert.equal(st.current, '');
  assert.equal(s.wrBackspace(st), 'empty', 'empty backspace is a no-op');
  setWord(st, 'abcde');
  assert.equal(st.current, 'abcde');
  assert.equal(s.wrConfirm(st), 'full', 'confirm at 5 letters rejected');
  assert.equal(st.current.length, 5, 'slot count stays capped at 5');
  console.log('PASS wordring confirm/backspace: lowercase slots, full guard');
}

// 7. illegal submit: short row and repeat guess consume no attempt
{
  const st = s.wrNewGame('crane', null);
  assert.equal(s.wrSubmit(st), 'short');
  assert.equal(st.attempt, 0);
  setWord(st, 'slate');
  assert.equal(s.wrSubmit(st), 'submitted');
  assert.equal(st.attempt, 1);
  assert.equal(st.current, '', 'slot clears after submit');
  assert.equal(plain(st.rows).length, 1);
  setWord(st, 'slate');
  assert.equal(s.wrSubmit(st), 'duplicate');
  assert.equal(st.attempt, 1, 'duplicate submit does not spend an attempt');
  console.log('PASS wordring submit guards: short + duplicate rejected, no attempt spent');
}

// 8. win path: records updated, WIN event emitted
{
  kvStore = {};
  const st = s.wrNewGame('crane', null);
  setWord(st, 'slate'); s.wrSubmit(st);
  setWord(st, 'crane');
  assert.equal(s.wrSubmit(st), 'submitted');
  assert.equal(st.status, 'win');
  assert.equal(st.attempt, 2);
  assert.deepEqual(plain(st.rows[1].marks), ['G', 'G', 'G', 'G', 'G']);
  assert.ok(st.events.some((e) => e.startsWith('WIN attempt=2')));
  assert.equal(st.streak, 1); assert.equal(st.best, 2);
  assert.equal(kvStore['wr.streak'], 1);
  assert.equal(kvStore['wr.best'], 2);
  console.log('PASS wordring win: verdict all green, streak + best persisted');
}

// 9. loss path: six wrong guesses lock the board and reset streak
{
  kvStore = { 'wr.streak': 4, 'wr.best': 3 };
  const st = s.wrNewGame('crane', null);
  assert.equal(st.streak, 4, 'streak loaded from KV');
  assert.equal(st.best, 3, 'best loaded from KV');
  for (const w of ['slate', 'point', 'brown', 'fudge', 'mango', 'vivid']) {
    setWord(st, w);
    assert.equal(s.wrSubmit(st), 'submitted');
  }
  assert.equal(st.status, 'lose');
  assert.equal(st.attempt, 6);
  assert.equal(kvStore['wr.streak'], 0, 'streak reset on loss');
  assert.equal(kvStore['wr.best'], 3, 'best unchanged on loss');
  assert.ok(st.events.some((e) => e.startsWith('LOSE answer=crane')));
  assert.equal(s.wrSubmit(st), 'done', 'submit locked after game over');
  assert.equal(s.wrConfirm(st), 'done', 'confirm locked after game over');
  assert.equal(s.wrRotate(st, 1), 'done', 'rotation locked after game over');
  assert.equal(s.wrBackspace(st), 'done', 'backspace locked after game over');
  assert.equal(st.attempt, 6);
  console.log('PASS wordring loss: 6 tries, streak reset, board fully locked');
}

// 10. fewest-tries policy: strictly fewer overwrites, equal/worse keeps
{
  kvStore = { 'wr.best': 5, 'wr.streak': 0 };
  let st = s.wrNewGame('crane', null);
  setWord(st, 'slate'); s.wrSubmit(st);
  setWord(st, 'point'); s.wrSubmit(st);
  setWord(st, 'crane'); s.wrSubmit(st);
  assert.equal(st.status, 'win');
  assert.equal(st.attempt, 3);
  assert.equal(kvStore['wr.best'], 3, 'fewer tries overwrite');

  kvStore = { 'wr.best': 2, 'wr.streak': 0 };
  st = s.wrNewGame('crane', null);
  setWord(st, 'slate'); s.wrSubmit(st);
  setWord(st, 'crane'); s.wrSubmit(st);
  assert.equal(st.status, 'win');
  assert.equal(kvStore['wr.best'], 2, 'worse tries keep old best');

  kvStore = { 'wr.best': 2, 'wr.streak': 0 };
  st = s.wrNewGame('crane', null);
  setWord(st, 'slate'); s.wrSubmit(st);
  setWord(st, 'crane'); s.wrSubmit(st);
  assert.equal(kvStore['wr.best'], 2, 'equal tries keep old best');
  console.log('PASS wordring best: fewer overwrites / worse and equal keep');
}

// 11. KV keys fit NVS cap; throwing storage never crashes a record path
{
  assert.ok(s.KV_STREAK.length <= 15, 'KV_STREAK <= 15 chars: ' + s.KV_STREAK);
  assert.ok(s.KV_BEST.length <= 15, 'KV_BEST <= 15 chars: ' + s.KV_BEST);
  const realGet = mockLume.storage.kv.get;
  const realSet = mockLume.storage.kv.set;
  mockLume.storage.kv.get = () => { throw new Error('nvs unavailable'); };
  mockLume.storage.kv.set = () => { throw new Error('nvs full'); };
  assert.equal(s.wrStreak(), 0);
  assert.equal(s.wrBest(), 0);
  assert.equal(s.wrSaveStreak(7), 7, 'save returns value even if NVS throws');
  assert.equal(s.wrSaveBest(4), 4);
  mockLume.storage.kv.get = realGet;
  mockLume.storage.kv.set = realSet;
  console.log('PASS wordring KV: keys <= 15 chars, storage failures non-fatal');
}

// 12. canvas budget + geometry (single canvas leaves a native HUD band)
{
  assert.equal(s.IW * s.IH, 206400, '480x430 canvas');
  assert.ok(s.IW * s.IH < 230400, 'canvas under the 230400 px full-frame budget');
  const gridRight = s.GX + 5 * (s.CELL + s.GAP) - s.GAP; // 125 + 230 - 5 = 350
  const gridBottom = s.GY + 6 * (s.CELL + s.GAP) - s.GAP; // 56 + 277 - 5 = 328
  assert.ok(gridRight <= s.IW, 'grid right edge inside canvas');
  assert.ok(gridBottom < s.BAND_TOP, 'grid bottom clears the ring band');
  assert.ok(s.BAND_BOT <= s.IH, 'ring band inside canvas');
  assert.ok(s.IW * (s.IH - (s.GY - 4)) <= 230400, 'dirty rect within budget');
  console.log('PASS wordring canvas budget: 206400/230400 px, grid and ring in bounds');
}

/* ---- device render path: real prelude, real draw/gesture stream --------- */
let ui = null;
const uiKv = {};
const logs = [];
function tap(x, y) { ui.gesture(1, 0, x, y, 10); ui.gesture(1, 2, x, y, 30); }
function tapLetter(ch) {
  const target = s.ALPHABET.indexOf(ch.toUpperCase());
  let cur = ui.ctx.state.sel;
  const forward = (target - cur + 26) % 26;
  if (forward <= 13) { for (let i = 0; i < forward; i++) tap(400, 388); }
  else { for (let i = 0; i < 26 - forward; i++) tap(80, 388); }
  assert.equal(ui.ctx.state.sel, target, 'ring rotated to ' + ch);
  tap(240, 388);
}

// 13. boot through the real prelude: full first paint, HUD, draw stream
{
  ui = runApp(source, {
    filename: 'examples/wordring/app.js',
    kv: {
      get: (k) => (k in uiKv ? uiKv[k] : null),
      set: (k, v) => { uiKv[k] = v; return 0; },
      remove: (k) => { delete uiKv[k]; return 0; },
    },
    onLog: (msg) => logs.push(msg),
  });
  assert.equal(ui.ctx.state.status, 'play', 'boots to a live round');
  assert.ok(logs.some((m) => m.indexOf('WR boot words=') === 0), 'boot log: ' + logs[0]);
  assert.ok(ui.messages.filter((m) => m[0] === 'attr').length > 0, 'HUD text attrs emitted');
  const invs = ui.messages.filter((m) => m[0] === 'invalidate');
  assert.ok(invs.length >= 1, 'at least the first paint');
  assert.deepEqual(invs[0].slice(2), [0, 0, 480, 430], 'first paint covers the whole canvas');
  assert.ok(ui.messages.filter((m) => m[0] === 'draw').length > 100, 'onDraw replayed spans');
  console.log('PASS wordring prelude boot: full paint, HUD attrs, span draw stream');
}

// 14. pure-tap path: left/right rotate, centre confirms, DEL/ENTER/NEW buttons
{
  assert.equal(ui.ctx.state.sel, 0);
  tap(80, 388); assert.equal(ui.ctx.state.sel, 25, 'left arc rotates back to Z');
  tap(400, 388); assert.equal(ui.ctx.state.sel, 0, 'right arc rotates on to A');
  tap(240, 388); assert.equal(ui.ctx.state.current, 'a', 'centre places letter');
  ui.press(6); assert.equal(ui.ctx.state.current, '', 'DEL clears the slot');
  const answer = ui.ctx.state.answer;
  for (const ch of answer) tapLetter(ch);
  assert.equal(ui.ctx.state.current, answer, 'ring placements match the drawn answer');
  ui.press(7); // ENTER
  assert.equal(ui.ctx.state.status, 'win');
  assert.equal(ui.ctx.state.attempt, 1);
  assert.equal(uiKv['wr.streak'], 1, 'real prelude KV write on win');
  ui.press(8); // NEW
  assert.equal(ui.ctx.state.status, 'play');
  assert.equal(ui.ctx.state.attempt, 0);
  console.log('PASS wordring tap pipeline: rotate/confirm, DEL/ENTER/NEW, KV write');
}

// 15. ~60 s smoke: tap traffic + periodic submits/restarts, bounded state
{
  const before = ui.messages.length;
  let taps = 0, submits = 0, restarts = 0;
  for (let t = 0; t < 1800; t++) {          /* 1800 ticks x 33 ms = ~59.4 s */
    if (t % 15 === 0) {                     /* one tap every ~0.5 s */
      const r = Math.random();
      if (r < 0.15) tap(80, 388);
      else if (r < 0.30) tap(400, 388);
      else tap(240, 388);
      taps++;
    }
    if (t % 45 === 0 && t > 0) { ui.press(7); submits++; }
    if (t % 120 === 0 && t > 0) { ui.press(6); ui.press(8); restarts++; }
  }
  const draws = ui.messages.slice(before).filter((m) => m[0] === 'draw');
  const invs = ui.messages.slice(before).filter((m) => m[0] === 'invalidate');
  assert.ok(draws.length > 1000, 'smoke draw traffic: ' + draws.length);
  for (const m of invs) {
    const [, , x, y, w, h] = m;
    assert.ok(x + w <= s.IW && y + h <= s.IH, 'smoke invalidate inside canvas');
    assert.ok(w * h <= s.IW * s.IH, 'smoke invalidate within budget');
  }
  assert.ok(Number.isInteger(ui.ctx.state.sel) && ui.ctx.state.sel >= 0 && ui.ctx.state.sel < 26, 'sel bounded');
  assert.ok(ui.ctx.state.current.length <= 5, 'slot bounded');
  assert.ok(ui.ctx.state.attempt >= 0 && ui.ctx.state.attempt <= 6, 'attempt bounded');
  console.log('PASS wordring ~60 s smoke (taps=' + taps + ', submits=' + submits +
    ', restarts=' + restarts + ', draws=' + draws.length + ', paints=' + invs.length + ')');
}

console.log('ALL tests/wordring.js PASSED');
