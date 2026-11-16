/*
 * r75 host harness for examples/memory (Memory Match logic).
 *
 *   node tests/memory.js
 *
 * The logic half is split at the GAME-UI marker and run in a bare vm context,
 * like tests/sokoban.js / tests/invaders.js. lume.storage.kv is mocked so the
 * best-score path is exercised without NVS.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
  const src = fs.readFileSync('examples/memory/app.js', 'utf8').split('/* ------------------------------ GAME UI')[0];
  const ctx = vm.createContext({
    lume: mockLume,
    Math, JSON, console,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object,
  });
  vm.runInContext(src, ctx);
  return ctx;
}
const s = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); } // vm-realm arrays -> host realm

function deckFaces(st) { return st.deck.map((f) => f); }

// 1. deal: 16 cards, exactly 8 pairs of face indices 0..7
{
  const st = s.memoryDeal(() => 0);
  assert.equal(st.deck.length, 16);
  const counts = {};
  for (const f of st.deck) { assert.ok(f >= 0 && f <= 7); counts[f] = (counts[f] || 0) + 1; }
  assert.equal(Object.keys(counts).length, 8);
  for (const f in counts) assert.equal(counts[f], 2, 'face ' + f + ' appears twice');
  assert.equal(st.moves, 0); assert.equal(st.matched, 0); assert.equal(st.won, false);
  assert.equal(st.open.length, 0);
  console.log('PASS memory deal: 16 cards, 8 faces x2');
}

// 2. shuffle determinism with injected rnd (constant rnd = a specific permutation)
{
  let step = 0;
  const rnd = () => { const v = [0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95, 0.15, 0.85, 0.25, 0.75][step++ % 15]; return v; };
  const a = s.memoryShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rnd);
  const b = s.memoryShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rnd);
  step = 0;
  const c = s.memoryShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rnd);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  assert.deepEqual(a.slice().sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'permutation, no lost elements');
  console.log('PASS memory shuffle: deterministic under injected rnd, true permutation');
}

// 3. single flip: state machine idle -> one-open, no move counted yet
{
  const st = s.memoryDeal(null);
  const r = s.memoryTap(st, 3);
  assert.equal(r, 'flip');
  assert.deepEqual(plain(st.open), [3]);
  assert.equal(st.moves, 0);
  assert.ok(st.events.some((e) => e.startsWith('open c=3')));
  console.log('PASS memory single flip: one-open, moves not yet counted');
}

// 4. match: pair removed, matched++ and deck cells go to -1
{
  const st = s.memoryDeal(null);
  // find any two cells with the same face
  let ca = -1, cb = -1;
  for (let i = 0; i < 16 && ca < 0; i++)
    for (let j = i + 1; j < 16; j++)
      if (st.deck[i] === st.deck[j] && st.deck[i] >= 0) { ca = i; cb = j; break; }
  assert.equal(s.memoryTap(st, ca), 'flip');
  assert.equal(s.memoryTap(st, cb), 'match');
  assert.equal(st.moves, 1);
  assert.equal(st.matched, 1);
  assert.equal(st.deck[ca], -1);
  assert.equal(st.deck[cb], -1);
  assert.equal(st.open.length, 0);
  assert.equal(st.lastResult, 'match');
  console.log('PASS memory match: pair removed, counter advanced');
}

// 5. miss: pair stays face-up with a flip timer, then flips back on tick
{
  const st = s.memoryDeal(null);
  // find two cells with different faces
  let ca = -1, cb = -1;
  outer:
  for (let i = 0; i < 16; i++)
    for (let j = i + 1; j < 16; j++)
      if (st.deck[i] !== st.deck[j]) { ca = i; cb = j; break outer; }
  assert.equal(s.memoryTap(st, ca), 'flip');
  assert.equal(s.memoryTap(st, cb), 'miss');
  assert.equal(st.moves, 1);
  assert.equal(st.flipTimer, 2);
  assert.deepEqual(plain(st.open), [ca, cb], 'both still face-up during the miss window');
  assert.equal(s.memoryTick(st), false, 'first tick only counts down');
  assert.equal(s.memoryTick(st), true, 'second tick flips back -> repaint');
  assert.equal(plain(st.open).length, 0);
  // cells are NOT removed after a miss
  assert.ok(st.deck[ca] >= 0 && st.deck[cb] >= 0);
  console.log('PASS memory miss: face-up window, flipback on tick, cards stay in play');
}

// 6. negative: double-tap the same card and three-in-a-row are both ignored
{
  const st = s.memoryDeal(null);
  assert.equal(s.memoryTap(st, 5), 'flip');
  assert.equal(s.memoryTap(st, 5), 'ignore', 'same card twice');
  assert.deepEqual(plain(st.open), [5]);
  assert.equal(s.memoryTap(st, 6), 'miss');
  assert.equal(s.memoryTap(st, 7), 'ignore', 'third flip while a pair is showing');
  assert.equal(st.moves, 1, 'ignored taps do not count as moves');
  assert.deepEqual(st.open.length <= 2, true);
  console.log('PASS memory negative: no double-flip, no third-card flip');
}

// 7. negative: out-of-range, matched-away cards, taps after win are ignored
{
  const st = s.memoryDeal(null);
  assert.equal(s.memoryTap(st, -1), 'ignore');
  assert.equal(s.memoryTap(st, 16), 'ignore');
  st.deck[2] = -1;
  assert.equal(s.memoryTap(st, 2), 'ignore', 'matched-away card');
  st.won = true;
  assert.equal(s.memoryTap(st, 9), 'done', 'board locked after win');
  console.log('PASS memory negative: range/matched/won guards');
}

// 8. full game: 8 pairs cleared by reading the deck (always match) -> win + best saved
{
  kvStore = {};
  const st = s.memoryDeal(null);
  let taps = 0;
  let guard = 0;
  while (!st.won && guard++ < 200) {
    // find an open-or-new matching pair
    const byFace = {};
    for (let i = 0; i < 16; i++) {
      const f = st.deck[i];
      if (f < 0) continue;
      if (byFace[f] !== undefined) { // pair available
        const r1 = s.memoryTap(st, byFace[f]); taps++;
        const r2 = s.memoryTap(st, i); taps++;
        assert.ok(r1 === 'flip' && r2 === 'match');
        break;
      }
      byFace[f] = i;
    }
    s.memoryTick(st); s.memoryTick(st); // drain any miss window (none expected)
  }
  assert.equal(st.won, true);
  assert.equal(st.matched, 8);
  assert.equal(st.moves, 8, 'perfect play = 8 moves');
  assert.equal(st.deck.every((f) => f === -1), true, 'all cards removed');
  assert.ok(st.events.some((e) => e.startsWith('WIN moves=8')));
  assert.equal(kvStore['hisc.memory'], 8, 'best persisted under 15-char NVS key');
  console.log('PASS memory full game: 8-pair clear, WIN event, best=8 saved');
}

// 9. best-score policy: only a strictly smaller move count overwrites
{
  // (a) worse round: stored best=6, win lands on 7 moves -> no overwrite
  kvStore = { 'hisc.memory': 6 };
  const stW = s.memoryDeal(null);
  stW.moves = 6; stW.matched = 7;
  let pw = -1;
  for (let i = 0; i < 16; i++) if (stW.deck[i] >= 0) { pw = i; break; }
  let qw = -1;
  for (let i = pw + 1; i < 16; i++) if (stW.deck[i] === stW.deck[pw]) { qw = i; break; }
  assert.equal(s.memoryTap(stW, pw), 'flip');
  assert.equal(s.memoryTap(stW, qw), 'match');
  assert.equal(stW.won, true);
  assert.equal(stW.moves, 7);
  assert.equal(kvStore['hisc.memory'], 6, 'worse round does NOT overwrite');

  // (b) better round: stored best=12, win lands on 9 moves -> overwritten
  kvStore = { 'hisc.memory': 12 };
  const stB = s.memoryDeal(null);
  stB.moves = 8; stB.matched = 7;
  let pb = -1;
  for (let i = 0; i < 16; i++) if (stB.deck[i] >= 0) { pb = i; break; }
  let qb = -1;
  for (let i = pb + 1; i < 16; i++) if (stB.deck[i] === stB.deck[pb]) { qb = i; break; }
  s.memoryTap(stB, pb); s.memoryTap(stB, qb);
  assert.equal(stB.won, true);
  assert.equal(stB.moves, 9);
  assert.equal(kvStore['hisc.memory'], 9, 'strictly fewer moves overwrite the best');

  // (c) equal moves: stored best=9, win lands on 9 -> policy 9 < 9 is false, no write
  kvStore = { 'hisc.memory': 9 };
  const stE = s.memoryDeal(null);
  stE.moves = 8; stE.matched = 7;
  let pe = -1;
  for (let i = 0; i < 16; i++) if (stE.deck[i] >= 0) { pe = i; break; }
  let qe = -1;
  for (let i = pe + 1; i < 16; i++) if (stE.deck[i] === stE.deck[pe]) { qe = i; break; }
  s.memoryTap(stE, pe); s.memoryTap(stE, qe);
  assert.equal(stE.won, true);
  assert.equal(stE.moves, 9);
  assert.equal(kvStore['hisc.memory'], 9, 'equal moves keep the old best');
  console.log('PASS memory best: worse keeps / fewer overwrites / equal keeps');
}

// 10. span precompute integrity: every face decodes to >= 4 spans, palette refs valid
{
  assert.equal(Object.keys(s.SPANS).length, s.spanBuilds);
  assert.equal(s.spanBuilds, 8, '8 faces');
  for (const k in s.SPANS) {
    assert.ok(s.SPANS[k].length >= 4, k + ' has spans');
    for (const sp of s.SPANS[k]) {
      assert.equal(sp.length, 4);
      assert.ok(s.PAL[sp[3]] !== undefined, 'palette colour ' + sp[3] + ' exists');
      assert.ok(sp[2] >= 1 && sp[0] >= 0 && sp[1] >= 0);
    }
  }
  console.log('PASS memory spans: 8 faces decoded, palette refs all valid');
}

// 11. canvas budget: 480x480 single canvas = exactly the 230,400 px cap
{
  assert.equal(s.IW * s.IH, 230400, 'single full-screen canvas is the whole budget');
  assert.equal(s.CELL, 88); assert.equal(s.GAP, 8);
  const gridW = s.GX + s.COLS * (s.CELL + s.GAP) - s.GAP; // 64 + 4*96 - 8 = 440
  const gridH = s.GY + s.ROWS * (s.CELL + s.GAP) - s.GAP; // 44 + 4*96 - 8 = 420
  assert.ok(gridW <= 480, 'grid right edge inside 480');
  assert.ok(gridH <= 424, 'grid bottom (' + gridH + ') must not overlap the button row (y=424)');
  console.log('PASS memory canvas budget: 230400 px single canvas, grid in bounds');
}

// 12. every dealt board is fully solvable (trivially true by construction: 8 pairs)
{
  for (let n = 0; n < 20; n++) {
    const st = s.memoryDeal(Math.random);
    const sorted = deckFaces(st).slice().sort((a, b) => a - b);
    for (let f = 0; f < 8; f++) {
      assert.equal(sorted[f * 2], f); assert.equal(sorted[f * 2 + 1], f);
    }
  }
  console.log('PASS memory solvability: 20 random deals all contain exactly 8 pairs');
}

console.log('ALL tests/memory.js PASS');
