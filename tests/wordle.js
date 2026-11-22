/*
 * r149 host harness for examples/wordle (full Wordle-class game, pure app).
 *
 *   node tests/wordle.js
 *
 * Part 1 runs the logic half (split at the GAME UI marker) in a bare vm with a
 * mocked KV store: verdict semantics incl. the standard repeated-letter rule,
 * dictionary hygiene, win/loss transitions and streak persistence.
 * Part 2 boots the REAL app against the firmware prelude with runtime/shell.js
 * prepended (the CLI bundles it; Node cannot eval the import) and drives the
 * QWERTY keyboard through native Button presses.
 * Part 3 covers ASCII copy, byte-identical playground source, the 57-app
 * manifest, and the firmware/runtime zero-diff guard. Every source predicate
 * has a mutation proof. No hardware touch calibration: deferred to board
 * bring-up (docs/KNOWN-SIMPLIFICATIONS.md r149).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '6dddec1'; // r165: re-pinned to this round's daily-pick feat commit (app layer only)
const source = read('examples/wordle/app.js');
const shell = read('runtime/shell.js');
const manifest = read('tools/playground/build.mjs');
const playgroundSrc = read('website/playground/sources/wordle.js');
const marker = '/* ------------------------------ GAME UI';
const QWERTY = 'QWERTYUIOPASDFGHJKLZXCVBNM';
/* r165: fixed wall clock for the daily pick. Host _systemTime defaults to
 * Date.now(); pinned here so day-index assertions are deterministic. */
const FIXED_DAY_MS = Date.UTC(2026, 0, 15, 12, 0, 0);
const FIXED_DAY = Math.floor(FIXED_DAY_MS / 86400000);

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}
const wiring = sliceBetween(source, 'var keyboard = lume.ui.shell.Keyboard({', '\n});');

/* ---------------------------- part 1: logic ---------------------------- */
let kvStore = {};
let mockNowMs = FIXED_DAY_MS;
const mockLume = {
  system: { time: () => mockNowMs },
  storage: { kv: {
    get: k => (k in kvStore ? kvStore[k] : null),
    set: (k, v) => { kvStore[k] = v; return 0; },
    remove: k => { delete kvStore[k]; return 0; },
  } },
  log: () => {},
};
function logic() {
  const src = stripImport(source.split(marker)[0]);
  const ctx = vm.createContext({
    lume: mockLume, Math, JSON, console,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object,
  });
  vm.runInContext(src, ctx);
  return ctx;
}
const s = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); } // vm realm -> host realm

function setWord(st, word) {
  st.current = '';
  for (const ch of word) {
    assert.equal(s.wdKey(st, ch), 'added', 'key accepts ' + ch);
  }
  assert.equal(st.current, word);
}
function check(name, fn) { fn(); console.log('PASS wordle ' + name); }

// 0. r64 font discipline: no decorative Unicode in UI copy
check('UI strings ASCII-only (r64)', () => {
  const ui = source.split(marker)[1];
  const strings = ui.match(/'[^'\n]*'/g) || [];
  assert.ok(strings.length > 0);
  for (const str of strings) {
    const body = str.slice(1, -1);
    assert.ok(/^[\x20-\x7E]*$/.test(body), 'UI string ASCII-only: ' + body);
  }
});

// 1. dictionary hygiene: 200-400 unique five-letter ASCII words
check('dictionary 300 unique five-letter ASCII words, all self-green', () => {
  assert.ok(s.WORDS.length >= 200 && s.WORDS.length <= 400, 'size ' + s.WORDS.length);
  assert.equal(s.WORDS.length, 300);
  assert.equal(new Set(s.WORDS).size, s.WORDS.length, 'no duplicates');
  for (const w of s.WORDS) assert.match(w, /^[a-z]{5}$/, 'five lowercase ASCII: ' + w);
  for (const w of s.WORDS) assert.equal(s.wdJudge(w, w).join(''), 'GGGGG', 'self green: ' + w);
});

// 2. glyph spans: 26 A-Z, 5x7, decoded once at eval
check('26 five-by-seven glyphs decoded to valid spans', () => {
  assert.equal(Object.keys(s.SPANS).length, s.spanBuilds);
  assert.equal(s.spanBuilds, 26);
  assert.equal(s.ALPHABET.length, 26);
  for (let i = 0; i < 26; i++) assert.ok(s.SPANS[s.ALPHABET.charAt(i)]);
  for (const k in s.SPANS) {
    assert.equal(s.GLYPHS[k].length, 7, k + ' has 7 rows');
    for (const row of s.GLYPHS[k]) assert.equal(row.length, 5, k + ' row has 5 cols');
    assert.ok(s.SPANS[k].length >= 2, k + ' decodes to spans');
    for (const sp of s.SPANS[k]) {
      assert.equal(sp.length, 3);
      assert.ok(sp[0] >= 0 && sp[0] + sp[2] <= 5);
      assert.ok(sp[1] >= 0 && sp[1] < 7);
      assert.ok(sp[2] >= 1);
    }
  }
});

// 3. verdict basics
check('verdict green/yellow/grey, inputs immutable', () => {
  assert.equal(s.wdJudge('crane', 'crane').join(''), 'GGGGG');
  assert.equal(s.wdJudge('slate', 'crane').join(''), 'XXGXG');
  assert.equal(s.wdJudge('notes', 'stone').join(''), 'YYYYY');
  assert.equal(s.wdJudge('xxxxx', 'crane').join(''), 'XXXXX');
  const g = 'crane', a = 'stone';
  s.wdJudge(g, a);
  assert.equal(g, 'crane'); assert.equal(a, 'stone');
});

// 4. the load-bearing standard repeated-letter rule (two-pass, no over-award)
check('repeated letters: two-pass count, no over-awarding', () => {
  assert.equal(s.wdJudge('eerie', 'level').join(''), 'YGXXX',
    'two guess E vs one remaining answer E -> second E grey');
  assert.equal(s.wdJudge('level', 'eerie').join(''), 'XGXYX',
    'answer three E, guess two -> one green + one yellow only');
  assert.equal(s.wdJudge('aabbc', 'abcde').join(''), 'GXYXY',
    'repeated A/B consumed left to right');
  assert.equal(s.wdJudge('pupil', 'apple').join(''), 'YXGXY',
    'answer two P + one L, guess two P + one L -> each matched once');
  assert.equal(s.wdJudge('sassy', 'glass').join(''), 'YYXGX',
    'three S in guess, two S in answer -> one green + one yellow only');
});

// 5. fresh round loads streak records from KV
check('new game defaults + KV load + event', () => {
  kvStore = {};
  const st = s.wdNewGame('crane', null);
  assert.equal(st.answer, 'crane');
  assert.equal(st.status, 'play');
  assert.equal(st.attempt, 0);
  assert.equal(st.current, '');
  assert.equal(plain(st.rows).length, 0);
  assert.equal(st.streak, 0); assert.equal(st.best, 0);
  assert.ok(st.events.some(e => e.startsWith('new words=300')));
});

// 6. wdKey / wdBackspace guards
check('letter input: lowercase, full/space/ignore guards, backspace', () => {
  const st = s.wdNewGame('crane', null);
  assert.equal(s.wdKey(st, 'Q'), 'added');
  assert.equal(st.current, 'q', 'uppercase key stored lowercase');
  assert.equal(s.wdKey(st, ' '), 'space', 'SPACE is a no-op');
  assert.equal(s.wdKey(st, '1'), 'ignore', 'non-letter ignored');
  assert.equal(s.wdBackspace(st), 'deleted');
  assert.equal(s.wdBackspace(st), 'empty');
  setWord(st, 'abcde');
  assert.equal(s.wdKey(st, 'f'), 'full', 'fifth slot caps input');
  assert.equal(st.current.length, 5);
});

// 7. submit guards spend no attempt
check('submit guards: short / non-dictionary / duplicate', () => {
  const st = s.wdNewGame('crane', null);
  assert.equal(s.wdSubmit(st), 'short');
  assert.equal(st.attempt, 0);
  setWord(st, 'zzzzz');
  assert.equal(s.wdSubmit(st), 'invalid', 'non-dictionary guess rejected');
  assert.equal(st.attempt, 0);
  setWord(st, 'slate');
  assert.equal(s.wdSubmit(st), 'submitted');
  assert.equal(st.attempt, 1);
  assert.equal(st.current, '');
  setWord(st, 'slate');
  assert.equal(s.wdSubmit(st), 'duplicate');
  assert.equal(st.attempt, 1, 'duplicate spends no attempt');
});

// 8. win path persists both streak records
check('win: verdict all green, streak + best persisted', () => {
  kvStore = {};
  const st = s.wdNewGame('crane', null);
  setWord(st, 'slate'); s.wdSubmit(st);
  setWord(st, 'crane');
  assert.equal(s.wdSubmit(st), 'submitted');
  assert.equal(st.status, 'win');
  assert.equal(st.attempt, 2);
  assert.deepEqual(plain(st.rows[1].marks), ['G','G','G','G','G']);
  assert.ok(st.events.some(e => e.startsWith('WIN attempt=2')));
  assert.equal(st.streak, 1); assert.equal(st.best, 1);
  assert.equal(kvStore['wordle.cur'], 1);
  assert.equal(kvStore['hisc.wordle'], 1);
});

// 9. loss path locks the board and resets the current streak
check('loss: 6 tries, streak reset, board fully locked', () => {
  kvStore = { 'hisc.wordle': 4, 'wordle.cur': 4 };
  const st = s.wdNewGame('crane', null);
  assert.equal(st.streak, 4); assert.equal(st.best, 4);
  for (const w of ['slate','point','brown','fudge','mango','vivid']) {
    setWord(st, w);
    assert.equal(s.wdSubmit(st), 'submitted');
  }
  assert.equal(st.status, 'lose');
  assert.equal(st.attempt, 6);
  assert.equal(kvStore['wordle.cur'], 0, 'current streak reset');
  assert.equal(kvStore['hisc.wordle'], 4, 'longest streak unchanged');
  assert.ok(st.events.some(e => e.startsWith('LOSE answer=crane')));
  assert.equal(s.wdSubmit(st), 'done');
  assert.equal(s.wdKey(st, 'a'), 'done');
  assert.equal(s.wdBackspace(st), 'done');
  assert.equal(st.attempt, 6);
});

// 10. streak transitions: win -> win -> loss -> win, best never drops
check('streak transitions: best is the longest run', () => {
  kvStore = {};
  let st = s.wdNewGame('crane', null);
  setWord(st, 'crane'); s.wdSubmit(st);           // win, cur 1 best 1
  assert.equal(st.streak, 1);
  st = s.wdNewGame('slate', null);
  assert.equal(st.streak, 1, 'current streak carried into next round');
  setWord(st, 'slate'); s.wdSubmit(st);           // win, cur 2 best 2
  assert.equal(st.streak, 2); assert.equal(kvStore['hisc.wordle'], 2);
  st = s.wdNewGame('point', null);
  for (const w of ['slate','brown','fudge','mango','vivid','crane']) {
    setWord(st, w); s.wdSubmit(st);
  }
  assert.equal(st.status, 'lose');
  assert.equal(st.streak, 0);
  assert.equal(kvStore['hisc.wordle'], 2, 'loss keeps longest streak');
  st = s.wdNewGame('crane', null);
  assert.equal(st.streak, 0);
  setWord(st, 'crane'); s.wdSubmit(st);
  assert.equal(st.streak, 1);
  assert.equal(kvStore['hisc.wordle'], 2, 'new shorter run does not lower best');
});

// 11. letter-state bar uses highest verdict seen, G > Y > X
check('letter marks: highest feedback priority G > Y > X', () => {
  kvStore = {};
  const st = s.wdNewGame('crane', null);
  setWord(st, 'slate'); s.wdSubmit(st);   // s=X l=X a=G? no: crane vs slate -> X X G X G
  assert.deepEqual(plain(st.rows[0].marks), ['X','X','G','X','G']);
  setWord(st, 'candy'); s.wdSubmit(st);   // c=G a=G? crane/candy -> G G X X X; a already G keeps G
  let m = s.wdLetterMarks(st);
  assert.equal(m.c, 'G', 'green beats earlier yellow/absent');
  assert.equal(m.a, 'G');
  assert.equal(m.s, 'X', 'absent letters included');
  assert.equal(m.z, undefined, 'untouched letters absent from the map');
  const st2 = s.wdNewGame('crane', null);
  setWord(st2, 'notes'); s.wdSubmit(st2); // n=Y o=X t=X e=Y s=X
  const m2 = s.wdLetterMarks(st2);
  assert.equal(m2.n, 'Y'); assert.equal(m2.e, 'Y');
  setWord(st2, 'eerie'); s.wdSubmit(st2); // e=G at slot 0 -> G beats Y
  assert.equal(s.wdLetterMarks(st2).e, 'G', 'green overrides a previous yellow');
});

// 12. KV key cap + throwing storage never crashes a record path
check('KV keys <= 15 chars, storage failures non-fatal', () => {
  assert.ok(s.KV_BEST.length <= 15, 'KV_BEST ' + s.KV_BEST);
  assert.ok(s.KV_CUR.length <= 15, 'KV_CUR ' + s.KV_CUR);
  assert.ok(s.KV_DAY.length <= 15, 'KV_DAY ' + s.KV_DAY);
  assert.equal(s.KV_BEST, 'hisc.wordle');
  assert.equal(s.KV_DAY, 'wr.day');
  const g0 = mockLume.storage.kv.get, s0 = mockLume.storage.kv.set;
  mockLume.storage.kv.get = () => { throw new Error('nvs unavailable'); };
  mockLume.storage.kv.set = () => { throw new Error('nvs full'); };
  assert.equal(s.wdBest(), 0);
  assert.equal(s.wdCur(), 0);
  assert.equal(s.wdSaveBest(7), 7);
  assert.equal(s.wdSaveCur(3), 3);
  mockLume.storage.kv.get = g0;
  mockLume.storage.kv.set = s0;
});

// 13. canvas budget + geometry (keyboard geometry is asserted live below).
// r153 removed the self-drawn 26-letter bar: letter verdicts now tint the
// shell keyboard keys via keyStates, so the grid only has to fit the canvas
// and the canvas must clear the keyboard.
check('canvas budget 109440/230400 px, grid in bounds', () => {
  assert.equal(s.IW * s.CANVAS_H, 109440);
  assert.ok(s.IW * s.CANVAS_H <= 230400);
  const gridRight = s.GX + 5 * (s.CELL + s.GAP) - s.GAP;
  const gridBottom = s.GY + 6 * (s.CELL + s.GAP) - s.GAP;
  assert.ok(gridRight <= s.IW, 'grid right inside canvas');
  assert.ok(gridBottom <= s.CANVAS_H, 'grid bottom inside canvas');
  assert.ok(s.CANVAS_Y + s.CANVAS_H <= 300, 'canvas clears the keyboard at y 300');
  assert.ok(300 + 4 * 40 + 2 * 4 <= 480, '4-row keyboard fits the 480 px screen');
});

// 14. r165: day ordinal + deterministic pick from the wall clock
check('r165 wdDayIndex + deterministic daily pick (no random path)', () => {
  mockNowMs = FIXED_DAY_MS;
  assert.equal(s.wdDayIndex(), FIXED_DAY);
  assert.equal(s.MS_PER_DAY, 86400000);
  assert.equal(s.wdPick(), s.WORDS[FIXED_DAY % s.WORDS.length]);
  assert.equal(s.wdPick(FIXED_DAY), s.wdPick(), 'same day picks the same word');
  const a = s.wdNewGame();
  const b = s.wdNewGame();
  assert.equal(b.answer, a.answer, 'same day reopen -> same word');
  assert.equal(a.answer, s.WORDS[FIXED_DAY % s.WORDS.length]);
  assert.equal(a.day, FIXED_DAY, 'state carries the ordinal for the HUD');
  mockNowMs = FIXED_DAY_MS + 86400000;
  const c = s.wdNewGame();
  assert.equal(c.day, FIXED_DAY + 1);
  assert.notEqual(c.answer, a.answer, 'next day -> different word');
  assert.equal(c.answer, s.WORDS[(FIXED_DAY + 1) % s.WORDS.length]);
  mockNowMs = 1000; // cold boot before SNTP: honest 1970-era value
  assert.equal(s.wdDayIndex(), 0);
  assert.equal(s.wdPick(), s.WORDS[0], 'clock-not-set maps to first word, honestly');
  mockNowMs = FIXED_DAY_MS;
});

// 15. r165: streak counts consecutive days won, enforced by the wr.day key
check('r165 streak gap: 2+ days since last win breaks the run', () => {
  mockNowMs = FIXED_DAY_MS;
  kvStore = { 'wordle.cur': 4, 'hisc.wordle': 5, 'wr.day': FIXED_DAY - 1 };
  assert.equal(s.wdNewGame().streak, 4, 'next day carries the streak');
  kvStore = { 'wordle.cur': 4, 'hisc.wordle': 5, 'wr.day': FIXED_DAY };
  assert.equal(s.wdNewGame().streak, 4, 'same day carries the streak');
  kvStore = { 'wordle.cur': 4, 'hisc.wordle': 5, 'wr.day': FIXED_DAY - 2 };
  const st = s.wdNewGame();
  assert.equal(st.streak, 0, 'a missed day resets the current streak');
  assert.equal(st.best, 5, 'best survives the reset');
  assert.equal(kvStore['wordle.cur'], 0);
  assert.equal(kvStore['hisc.wordle'], 5);
  kvStore = {};
  mockNowMs = FIXED_DAY_MS;
});

/* ------------------------ part 2: live prelude ------------------------- */
let ui = null;
const uiKv = {};
const logs = [];
function stripImport(x) {
  return x.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
}
function lastAttr(st, id, attr) {
  const hits = st.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === attr);
  return hits.length ? hits[hits.length - 1][3] : undefined;
}
function probe(clockMs, appSrc) {
  uiKv.cur = undefined; delete uiKv.cur;
  Object.keys(uiKv).forEach(k => delete uiKv[k]);
  logs.length = 0;
  /* r165: pin the wall clock before the app evaluates. The prelude reads
   * lume._systemTime dynamically, so this survives the boot-time wdNewGame.
   * No shared runner change: tests/sntp.js locks the literal Date.now() stub. */
  const clock = clockMs === undefined ? FIXED_DAY_MS : clockMs;
  const clockInit = 'lume._systemTime = function () { return ' + clock + '; };\n';
  const st = runApp(clockInit + shell + '\n' + stripImport(appSrc === undefined ? source : appSrc), {
    filename: 'examples/wordle/app.js',
    kv: {
      get: k => (k in uiKv ? uiKv[k] : null),
      set: (k, v) => { uiKv[k] = v; return 0; },
      remove: k => { delete uiKv[k]; return 0; },
    },
    onLog: m => logs.push(m),
  });
  const creates = st.messages.filter(m => m[0] === 'create');
  const rows = creates.filter(m => m[3] === st.ctx.wdKb && m[2] === 0).map(m => m[1]);
  const rowSet = new Set(rows);
  const keys = creates.filter(m => m[2] === 2 && rowSet.has(m[3])).map(m => m[1]);
  const labels = keys.map(id => lastAttr(st, id, 0));
  const newBtn = creates.filter(m => m[2] === 2).map(m => m[1])
    .find(id => lastAttr(st, id, 0) === 'NEW');
  return { s: st, rows, keys, labels, newBtn };
}
function press(p, label) {
  const i = p.labels.indexOf(label);
  assert.ok(i >= 0, 'missing key: ' + label);
  p.s.press(p.keys[i]);
}
function typeWord(p, word) {
  vm.runInContext('wdGetGame().current = ""', p.s.ctx);
  for (const ch of word) press(p, ch.toUpperCase());
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).current, word);
}
const texts = (p, id) => p.s.messages
  .filter(m => m[0] === 'attr' && m[1] === id && m[2] === 0).map(m => m[3]);

// 14. real prelude boot: full paint, HUD attrs, draw stream, keyboard nodes
check('prelude boot: paint + HUD + 4 keyboard rows / 29 keys', () => {
  ui = probe();
  assert.equal(ui.rows.length, 4, '4 rows');
  assert.equal(ui.keys.length, 29, '26 letters + SPACE + BKSP + ENTER');
  assert.equal(ui.labels.join(''), QWERTY + 'SPACEBKSPENTER');
  assert.ok(ui.newBtn > 0, 'NEW button mounted');
  assert.equal(vm.runInContext('wdGetGame()', ui.s.ctx).status, 'play');
  assert.ok(logs.some(m => m.indexOf('WD boot words=300') === 0), 'boot log: ' + logs[0]);
  assert.ok(ui.s.messages.filter(m => m[0] === 'attr').length > 0, 'HUD text attrs');
  const invs = ui.s.messages.filter(m => m[0] === 'invalidate');
  assert.ok(invs.length >= 1, 'first paint');
  assert.deepEqual(invs[0].slice(2), [0, 0, 480, 228], 'first paint covers the canvas');
  assert.ok(ui.s.messages.filter(m => m[0] === 'draw').length > 100, 'span replay draw stream');
});

// 15. keyboard callback injection: onKey / BKSP / SPACE / ENTER routing
check('keyboard injection: onKey -> state, BKSP, SPACE ignored, ENTER submit', () => {
  const p = probe();
  press(p, 'Q'); press(p, 'W');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).current, 'qw');
  press(p, 'SPACE');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).current, 'qw', 'SPACE ignored');
  press(p, 'BKSP');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).current, 'q', 'BKSP removes one');
  press(p, 'ENTER');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).attempt, 0, 'short submit rejected');
  assert.equal(texts(p, p.s.ctx.wdKb).length, 0); // keyboard root itself carries no text
  const answer = vm.runInContext('wdGetGame()', p.s.ctx).answer;
  typeWord(p, answer);
  press(p, 'ENTER');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).status, 'win');
  assert.equal(uiKv['hisc.wordle'], 1, 'real prelude KV write on win');
});

// 16. feedback colors actually reach the draw stream (grid + letter bar)
check('feedback colors reach draw stream after a submitted guess', () => {
  const p = probe();
  const st = vm.runInContext('wdGetGame()', p.s.ctx);
  const answer = st.answer;
  const guess = answer === 'slate' ? 'crane' : 'slate';
  const before = p.s.messages.length;
  typeWord(p, guess);
  press(p, 'ENTER');
  const draws = p.s.messages.slice(before).filter(m => m[0] === 'draw');
  const inks = new Set(draws.map(m => m[7]));
  const rgb = h => parseInt(h.slice(1), 16); // host mirror of __canvasColor
  assert.ok(inks.has(rgb('#166B3E')) || inks.has(rgb('#8A6A12')),
    'a green or yellow cell fill was drawn');
  assert.ok(inks.has(rgb('#30343E')), 'a grey cell fill was drawn');
  assert.ok(inks.has(rgb('#4FE08A')) || inks.has(rgb('#F2CE45')),
    'letter-state bar ink was drawn');
});

// 17. NEW button starts a fresh round after a win
check('NEW button resets board after win', () => {
  const p = probe();
  const answer = vm.runInContext('wdGetGame()', p.s.ctx).answer;
  typeWord(p, answer);
  press(p, 'ENTER');
  assert.equal(vm.runInContext('wdGetGame()', p.s.ctx).status, 'win');
  p.s.press(p.newBtn);
  const fresh = vm.runInContext('wdGetGame()', p.s.ctx);
  assert.equal(fresh.status, 'play');
  assert.equal(fresh.attempt, 0);
  assert.equal(fresh.current, '');
  assert.equal(fresh.rows.length, 0);
});

// 18. dispose chain removes all 33 keyboard nodes once; second call is a no-op
check('shell.dispose removes 33 nodes once', () => {
  const p = probe();
  const before = p.s.messages.filter(m => m[0] === 'remove').length;
  vm.runInContext('lume.ui.shell.dispose(wdKb)', p.s.ctx);
  const after = p.s.messages.filter(m => m[0] === 'remove').length;
  assert.equal(after - before, 33);
  vm.runInContext('lume.ui.shell.dispose(wdKb)', p.s.ctx);
  assert.equal(p.s.messages.filter(m => m[0] === 'remove').length, after);
});

// 19. ~60 s smoke: keyboard traffic, submit/restart cycles, bounded state
check('~60 s smoke: bounded state, draws and invalidates in canvas', () => {
  const p = probe();
  const before = p.s.messages.length;
  let keys = 0, submits = 0, restarts = 0;
  for (let t = 0; t < 1800; t++) {
    if (t % 15 === 0) {
      const r = Math.random();
      if (r < 0.08) press(p, 'BKSP');
      else if (r < 0.12) press(p, 'SPACE');
      else press(p, QWERTY.charAt(Math.floor(Math.random() * 26)));
      keys++;
    }
    if (t % 45 === 0 && t > 0) { press(p, 'ENTER'); submits++; }
    if (t % 120 === 0 && t > 0) { p.s.press(p.newBtn); restarts++; }
  }
  const fresh = p.s.messages.slice(before);
  const draws = fresh.filter(m => m[0] === 'draw');
  const invs = fresh.filter(m => m[0] === 'invalidate');
  assert.ok(draws.length > 1000, 'draw traffic ' + draws.length);
  for (const m of invs) {
    const [, , x, y, w, h] = m;
    assert.ok(x + w <= 480 && y + h <= 228, 'invalidate inside canvas');
    assert.ok(w * h <= 480 * 228, 'invalidate within budget');
  }
  const st = vm.runInContext('wdGetGame()', p.s.ctx);
  assert.ok(st.current.length <= 5, 'slot bounded');
  assert.ok(st.attempt >= 0 && st.attempt <= 6, 'attempt bounded');
  assert.ok(st.rows.length <= 6, 'rows bounded');
  assert.ok(st.streak >= 0 && st.best >= 0, 'records bounded');
  console.log('PASS wordle ~60 s smoke (keys=' + keys + ', submits=' + submits +
    ', restarts=' + restarts + ', draws=' + draws.length + ', paints=' + invs.length + ')');
});

// 20. r165 live: fixed clock -> same word twice; +1 day -> new word; DAY #N
check('r165 live: same clock same word, +1 day new word, DAY #N in HUD', () => {
  const p = probe(FIXED_DAY_MS);
  const w1 = vm.runInContext('wdGetGame().answer', p.s.ctx);
  assert.equal(w1, vm.runInContext('wdPick(' + FIXED_DAY + ')', p.s.ctx), 'boot word is day-indexed');
  p.s.press(p.newBtn);
  const w2 = vm.runInContext('wdGetGame().answer', p.s.ctx);
  assert.equal(w2, w1, 'same-day NEW -> same word');

  const hud = p.s.messages.filter(m => m[0] === 'attr' && m[2] === 0)
    .map(m => m[3]).filter(v => typeof v === 'string' && v.indexOf('DAY #') === 0);
  assert.ok(hud.length > 0, 'HUD carries DAY #N');
  assert.ok(hud.some(v => v.indexOf('DAY #' + FIXED_DAY) === 0), 'DAY # matches injected clock');

  vm.runInContext('lume._systemTime = function () { return ' + (FIXED_DAY_MS + 86400000) + '; };', p.s.ctx);
  p.s.press(p.newBtn);
  const w3 = vm.runInContext('wdGetGame().answer', p.s.ctx);
  assert.notEqual(w3, w2, 'one day later -> different word');
  assert.equal(w3, vm.runInContext('wdPick(' + (FIXED_DAY + 1) + ')', p.s.ctx));
  assert.ok(p.s.messages.filter(m => m[0] === 'attr' && m[2] === 0)
    .some(m => typeof m[3] === 'string' && m[3].indexOf('DAY #' + (FIXED_DAY + 1)) === 0),
    'HUD DAY # advances with the clock');
});

/* ------------------- part 3: static guards + mutations ----------------- */
function gitChanged(paths, base) {
  const b = base || BASE;
  const head = execFileSync('git',
    ['diff', '--name-only', b, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', b, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const preludeChanged = gitChanged(['firmware/components/lume-engine/lume_scripts.c'], 'dafa1ed');

function literals(x) {
  return [...x.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = literals(source);

const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const apps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const labelString = probe().labels.join('');

const checks = [
  ['Keyboard registered on lume.ui.shell', [shell, x =>
    x.includes('shell.Keyboard = Keyboard;') && x.includes('lume.ui.shell = shell;')]],

  ['app wires onKey/onBackspace/onSubmit into game logic', [wiring, x =>
    x.includes('wdKey(state, ch)') && x.includes('wdBackspace(state)') &&
    x.includes('wdSubmit(state)')]],

  ['Keyboard geometry: 40 px key, gap 0, y 300', [wiring, x =>
    x.includes('keySize: 40, gap: 0, y: 300')]],

  ['keyStates consume wdLetterMarks (r153 tint replaces the letter bar)', [source, x =>
    x.includes('var marks = wdLetterMarks(state)') &&
    x.includes("marks[ch] === 'G' ? 'hit'") &&
    x.includes("'Y' ? 'present'") &&
    x.includes("'miss'")]],

  ['native nodes carry QWERTY + SPACE/BKSP/ENTER', [labelString, x =>
    x === QWERTY + 'SPACEBKSPENTER']],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(v => /^[\x00-\x7F]*$/.test(v))]],

  ['playground sources/wordle.js byte-identical to example', [playgroundSrc, x =>
    x === source]],

  ['wordle is in the 57-app playground manifest', [apps,
    list => list.length === 61 && list.includes('wordle')]],

  ['firmware/ runtime/ tools/lume/ identical to 6dddec1', [fwChanged, c => c.length === 0]],

  ['prelude lume_scripts.c unchanged since dafa1ed', [preludeChanged, c => c.length === 0]],

  ['r165 wdDayIndex derives the ordinal from lume.system.time()', [source, x =>
    x.includes('function wdDayIndex()') &&
    x.includes('var t = lume.system.time();') &&
    x.includes('Math.floor(t / MS_PER_DAY)') &&
    x.includes('var MS_PER_DAY = 86400000;')]],

  ['r165 wdPick is deterministic day % WORDS.length, no random path', [source, x =>
    x.includes('var i = d % WORDS.length') &&
    !x.includes('Math.random') &&
    !/\brnd\b/.test(x)]],

  ['r165 KV_DAY key fits the 15-char NVS cap', [source, x =>
    x.includes("KV_DAY = 'wr.day'")]],

  ['r165 HUD renders DAY #N', [source, x =>
    x.includes("hudSig.set('DAY #' + state.day")]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL wordle: ' + name);
  console.log('PASS wordle static: ' + name);
}

function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS wordle mutation: ' + name + ' -> FAIL as expected');
}

const REG = 'Keyboard registered on lume.ui.shell';
const WIRE = 'app wires onKey/onBackspace/onSubmit into game logic';
const GEO = 'Keyboard geometry: 40 px key, gap 0, y 300';
const TINT = 'keyStates consume wdLetterMarks (r153 tint replaces the letter bar)';
const LABELS = 'native nodes carry QWERTY + SPACE/BKSP/ENTER';
const ASCII = 'all UI string literals ASCII-only (r64)';
const SRC = 'playground sources/wordle.js byte-identical to example';
const MANIFEST = 'wordle is in the 57-app playground manifest';
const GUARD = 'firmware/ runtime/ tools/lume/ identical to 6dddec1';
const PRELUDE = 'prelude lume_scripts.c unchanged since dafa1ed';
const DAY_INDEX = 'r165 wdDayIndex derives the ordinal from lume.system.time()';
const DAILY_PICK = 'r165 wdPick is deterministic day % WORDS.length, no random path';
const DAY_KV = 'r165 KV_DAY key fits the 15-char NVS cap';
const HUD_DAY = 'r165 HUD renders DAY #N';

must('drop shell.Keyboard registration',
  x => x.replace('shell.Keyboard = Keyboard;', ''), REG, shell);
must('app stops forwarding onKey',
  x => x.replace('wdKey(state, ch)', 'null'), WIRE, wiring);
must('shrink the keyboard touch target',
  x => x.replace('keySize: 40, gap: 0, y: 300', 'keySize: 40, gap: 8, y: 300'), GEO, wiring);
must('keyStates drop feedback marks',
  x => x.replace('var marks = wdLetterMarks(state)', 'var marks = {}'), TINT, source);
must('a key label drifts from QWERTY',
  x => x.slice(0, -1) + 'X', LABELS, labelString);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'), ASCII, lits);
must('playground generated source drifts from the example',
  x => x + '\n// drift', SRC, playgroundSrc);
must('playground manifest drops wordle',
  list => list.filter(x => x !== 'wordle'), MANIFEST, apps);
must('a firmware/runtime/CLI file changes after the feat commit',
  () => ['runtime/shell.js'], GUARD, fwChanged);
must('the prelude changes vs dafa1ed',
  () => ['firmware/components/lume-engine/lume_scripts.c'], PRELUDE, preludeChanged);
must('wdPick falls back to random pick',
  x => x.replace('var i = d % WORDS.length;', 'var i = Math.floor(Math.random() * WORDS.length);'),
  DAILY_PICK, source);
must('wdDayIndex ignores the wall clock',
  x => x.replace('var t = lume.system.time();', 'var t = 1000;'), DAY_INDEX, source);
must('KV_DAY grows past the NVS cap',
  x => x.replace("KV_DAY = 'wr.day'", "KV_DAY = 'wordle.last.day.index'"), DAY_KV, source);
must('HUD drops the DAY #N label',
  x => x.replace("hudSig.set('DAY #' + state.day", "hudSig.set('TRY' + state.day"), HUD_DAY, source);

console.log('ALL WORDLE HARNESS CASES PASSED');
