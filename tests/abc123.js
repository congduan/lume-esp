/* r73 abc123 host harness: SVG data, four modes, image refresh and dots. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');
const glyphSource = fs.readFileSync('examples/abc123/glyphs.js', 'utf8').replaceAll('export var ', 'var ');
const appSource = fs.readFileSync('examples/abc123/app.js', 'utf8').replace(/^import .*;\n/m, '');
const script = glyphSource + '\n' + appSource;
const mock = `
var __imageSources = [];
lume.image.sizeOf = function(bytes) {
  if (!(bytes instanceof ArrayBuffer)) return -1;
  var head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  return String.fromCharCode.apply(null, head) === '<svg' ? {width:100,height:100} : -2;
};
lume.image._setSource = function(id, bytes, width, height) {
  __imageSources.push({id:id, bytes:bytes, width:width, height:height});
  return 0;
};
`;
const decode = buffer => String.fromCharCode.apply(null, new Uint8Array(buffer));
const makeUI = onLog => runApp(mock + script, { onLog });
function tap(ui, x, y, t) {
  ui.gesture(1, 0, x, y, t);
  ui.gesture(1, 2, x, y, t + 50);
}
const ui = makeUI();
const a = ui.ctx;
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
assert.equal(Object.keys(a.GLYPHS).length, 62);
assert.equal(Object.keys(a.GLYPH_PAIRS).length, 26);
for (const ch of chars) {
  const svg = a.GLYPHS[ch];
  assert.ok(svg && svg.startsWith('<svg '), `missing SVG ${ch}`);
  assert.match(svg, /width="100" height="100" viewBox="0 0 100 100"/);
  assert.match(svg, /<path d="[^"]+" fill="#FFFFFF"\/>/);
}
for (const ch of chars.slice(0, 26)) {
  assert.equal((a.GLYPH_PAIRS[ch].match(/<path /g) || []).length, 2);
}
console.log('PASS 62 SVG outlines and 26 Aa pairs have valid structure');
assert.equal(a.ABC_CARDS.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
assert.equal(a.abcNextSeq(25), 26);
assert.equal(a.abcNextSeq(35), 0);
assert.equal(a.ABC_MODES.join(','), 'seq,rand,lower,case');
for (let d = 0; d < 10; d++) {
  assert.equal(a.abcDotCount(String(d)), d);
  assert.equal(a.abcRenderSpec(String(d), 'case').key, String(d));
}
for (const ch of a.ABC_CARDS) assert.ok(a.abcWord(ch));
console.log('PASS 36-card deck, words and digit dot counts');
const creates = ui.messages.filter(m => m[0] === 'create');
assert.equal(creates.filter(m => m[2] === 4).length, 1, 'one Image glyph node');
assert.equal(creates.filter(m => m[2] === 3).length, 1, 'one auxiliary Canvas');
assert.equal(a.__imageSources.length, 1);
const glyphId = a.__imageSources[0].id;
assert.equal(a.__imageSources[0].width, 320);
assert.equal(a.__imageSources[0].height, 320);
assert.ok(decode(a.__imageSources[0].bytes).includes('viewBox="0 0 100 100"'));
console.log('PASS Image glyph and auxiliary Canvas nodes');
tap(ui, 240, 300, 1000);
assert.equal(a.card(), 'B');
assert.equal(a.__imageSources.at(-1).id, glyphId);
assert.equal(decode(a.__imageSources.at(-1).bytes), a.GLYPHS.B);
assert.ok(ui.messages.some(m => m[0] === 'animate' && m[1] === glyphId));
for (let i = 0; i < 24; i++) tap(ui, 240, 300, 1100 + i * 100);
assert.equal(a.card(), 'Z');
tap(ui, 240, 300, 3600);
assert.equal(a.card(), '0');
console.log('PASS page advance, Z-to-0 transition and Image bounce');
tap(ui, 240, 40, 3700);
assert.equal(a.mode(), 'rand');
const seen = [a.card()];
for (let i = 0; i < 35; i++) { tap(ui, 240, 300, 3800 + i * 100); seen.push(a.card()); }
assert.equal(new Set(seen).size, 36);
tap(ui, 240, 40, 7500);
assert.equal(a.mode(), 'lower');
assert.equal(a.card(), 'A');
assert.equal(decode(a.__imageSources.at(-1).bytes), a.GLYPHS.a);
tap(ui, 240, 40, 7600);
assert.equal(a.mode(), 'case');
assert.equal(decode(a.__imageSources.at(-1).bytes), a.GLYPH_PAIRS.A);
tap(ui, 240, 40, 7700);
assert.equal(a.mode(), 'seq');
console.log('PASS four-mode cycle, random bag and vertical Aa source');
const auxId = creates.find(m => m[2] === 3)[1];
const dotCount = () => ui.messages.filter(m => m[0] === 'draw' && m[1] === auxId && m[2] === 5).length;
const before = dotCount();
a.card.set('3');
assert.equal(dotCount() - before, 3);
console.log('PASS number-dot Canvas draws three filled arcs');
console.log('ALL ABC123 HARNESS CASES PASSED');
