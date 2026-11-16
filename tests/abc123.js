/*
 * r70 host harness for examples/abc123 (pure logic + host simulator).
 *
 *   node tests/abc123.js
 *
 * The logic half is split at the ABC UI marker and run in a bare vm context,
 * like tests/frogger.js / tests/invaders.js. Integration uses the real prelude
 * via tests/lib/prelude_runner.js to check nodes, serial events, taps and the
 * bounce animation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

function logic() {
  const src = fs.readFileSync('examples/abc123/app.js', 'utf8').split('/* ABC UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const a = logic();
const ROOT = 1;
function tap(ui, x, y, t) {
  ui.gesture(ROOT, 0, x, y, t);
  ui.gesture(ROOT, 2, x, y, t + 50);
}

// 1. 36-card sequence integrity: A-Z then 0-9, no gap / no duplicate.
{
  const cards = a.ABC_CARDS;
  assert.equal(cards.length, 36);
  assert.equal(cards.slice(0, 26).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.equal(cards.slice(26).join(''), '0123456789');
  assert.equal(new Set(cards).size, 36);
  console.log('PASS abc123 36-card A-Z0-9 sequence integrity');
}

// 2. sequential cycle boundaries: Z->0 and 9->A (no manual special-case).
{
  assert.equal(a.abcNextSeq(25), 26);   // index 25 = 'Z' -> 26 = '0'
  assert.equal(a.abcNextSeq(35), 0);    // index 35 = '9' -> 0 = 'A'
  assert.equal(a.abcNextSeq(0), 1);
  for (let i = 0; i < 36; i++) assert.equal(a.abcNextSeq(i), (i + 1) % 36);
  console.log('PASS abc123 sequential cycle boundaries Z->0 and 9->A');
}

// 3. digit cards carry exactly value-many dots (0 has none).
{
  for (let d = 0; d <= 9; d++) assert.equal(a.abcDotCount(String(d)), d);
  for (const ch of 'ABCZ') assert.equal(a.abcDotCount(ch), 0);
  console.log('PASS abc123 number-card dot count equals digit value');
}

// 4. render-plan chooses the right drawing primitive per card + mode.
{
  assert.equal(a.abcRenderSpec('7', 'seq').type, 'digit');
  assert.equal(a.abcRenderSpec('7', 'case').segs, a.ABC_SEG_MAP['7']);
  assert.equal(a.abcRenderSpec('7', 'case').dots, 7);
  const letter = a.abcRenderSpec('A', 'seq');
  assert.equal(letter.type, 'letter');
  assert.ok(letter.strokes.length > 0);
  const both = a.abcRenderSpec('A', 'case');
  assert.equal(both.type, 'case');
  assert.ok(both.upper.length > 0 && both.lower.length > 0);
  console.log('PASS abc123 glyph render-plan dispatch (digit / letter / case)');
}

// 5. word + icon + stroke tables cover the whole deck.
{
  for (const ch of a.ABC_CARDS) assert.ok(a.abcWord(ch).length > 0, `missing word ${ch}`);
  for (let i = 0; i < 26; i++) {
    const upper = String.fromCharCode(65 + i), lower = upper.toLowerCase();
    assert.ok(a.ABC_UPPER[upper] && a.ABC_UPPER[upper].length, `missing stroke ${upper}`);
    assert.ok(a.ABC_LOWER[lower] && a.ABC_LOWER[lower].length, `missing stroke ${lower}`);
  }
  assert.deepEqual(a.ABC_ICON_LETTERS.join(''), 'ABCDE');
  for (let d = 0; d <= 9; d++) assert.ok(a.ABC_SEG_MAP[String(d)]);
  console.log('PASS abc123 word/icon/stroke tables complete for all 36 cards');
}

// 6. integration: node structure, gesture registration, startup serial event.
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/abc123/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  const creates = ui.messages.filter(m => m[0] === 'create');
  assert.equal(creates.length, 5);                                   // root + 2 canvas + 2 text
  assert.equal(creates.filter(m => m[2] === 3).length, 2);           // two canvases
  assert.equal(ui.messages.filter(m => m[0] === 'gesture').length, 2); // root tap + prelude global swipe-up
  assert.equal(ui.messages.filter(m => m[0] === 'gesture' && m[1] === ROOT).length, 1);
  assert.ok(events.includes('ABC CARD A mode=seq'));
  console.log('PASS abc123 nodes (2 canvases) + one gesture + startup event');
}

// 7. integration: a tap anywhere on the body advances the sequential deck.
{
  const ui = runApp(fs.readFileSync('examples/abc123/app.js', 'utf8'));
  assert.equal(ui.ctx.card(), 'A');
  tap(ui, 240, 300, 1000);
  assert.equal(ui.ctx.card(), 'B');
  tap(ui, 40, 430, 1100);          // a corner, far from centre: still responds
  assert.equal(ui.ctx.card(), 'C');
  for (let i = 0; i < 23; i++) tap(ui, 240, 240, 1200 + i * 100);
  assert.equal(ui.ctx.card(), 'Z');
  tap(ui, 240, 240, 3600);          // Z -> 0, the wrap boundary on screen
  assert.equal(ui.ctx.card(), '0');
  console.log('PASS abc123 full-screen tap advances deck incl. Z->0 wrap');
}

// 8. integration: random mode draws all 36 once before any repeat.
{
  const ui = runApp(fs.readFileSync('examples/abc123/app.js', 'utf8'));
  tap(ui, 240, 40, 1000);           // HUD strip -> rand (first card auto-drawn)
  assert.equal(ui.ctx.mode(), 'rand');
  const seen = [ui.ctx.card()];
  for (let i = 0; i < 35; i++) { tap(ui, 240, 240, 1100 + i * 100); seen.push(ui.ctx.card()); }
  assert.equal(seen.length, 36);
  assert.equal(new Set(seen).size, 36, 'random mode repeated a card before exhausting deck');
  assert.deepEqual(new Set(seen), new Set(ui.ctx.ABC_CARDS));
  tap(ui, 240, 240, 5000);          // 37th: deck exhausted -> reshuffle, still a valid card
  assert.ok(ui.ctx.ABC_CARDS.includes(ui.ctx.card()));
  console.log('PASS abc123 random mode no-repeat-until-exhausted + reshuffle');
}

// 9. integration: mode switch resets the first card and cycles all three modes.
{
  const events = [];
  const ui = runApp(fs.readFileSync('examples/abc123/app.js', 'utf8'), { onLog: m => events.push(String(m)) });
  tap(ui, 240, 300, 1000);          // advance to B
  assert.equal(ui.ctx.card(), 'B');
  tap(ui, 240, 40, 1100);           // seq -> rand, reset
  assert.equal(ui.ctx.mode(), 'rand');
  assert.ok(ui.ctx.ABC_CARDS.includes(ui.ctx.card()));
  tap(ui, 240, 40, 1200);           // rand -> case, reset to A
  assert.equal(ui.ctx.mode(), 'case');
  assert.equal(ui.ctx.card(), 'A');
  tap(ui, 240, 40, 1300);           // case -> seq, reset to A
  assert.equal(ui.ctx.mode(), 'seq');
  assert.equal(ui.ctx.card(), 'A');
  assert.ok(events.includes('ABC MODE rand') && events.includes('ABC MODE case'));
  console.log('PASS abc123 mode switch resets deck and cycles seq/rand/case');
}

// 10. integration: digit dots rendered on aux canvas; tap fires one bounce.
{
  const ui = runApp(fs.readFileSync('examples/abc123/app.js', 'utf8'));
  const auxId = ui.messages.find(m => m[0] === 'create' && m[2] === 3 && m[4] === 320)[1];
  const dotCount = () => ui.messages.filter(m => m[0] === 'draw' && m[1] === auxId && m[2] === 5).length;
  const before = dotCount();
  ui.ctx.card.set('3');
  assert.equal(dotCount() - before, 3, `expected 3 filled dots, drew ${dotCount() - before}`);
  const anims = ui.messages.filter(m => m[0] === 'animate').length;
  tap(ui, 240, 300, 1000);          // A -> B bounce = cancel+to on y and opacity = 4
  const animsAfter = ui.messages.filter(m => m[0] === 'animate').length;
  assert.ok(animsAfter - anims >= 2, 'tap did not emit bounce animation');
  console.log('PASS abc123 digit dots on canvas + bounce animation on tap');
}
console.log('ALL ABC123 HARNESS CASES PASSED');
