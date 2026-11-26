/* r203 host harness for the shell.Slider round-thumb knife.
 *
 *   node tests/shell_slider.js
 *
 * The r203 contract is purely additive: without `roundThumb`/`knobDiameter`
 * an existing app must produce the same native draw stream as before the
 * knife. The golden array below is the pre-r203 stream captured from the
 * real firmware prelude via tests/lib/prelude_runner.js. Opt-in round thumbs
 * use the prelude's Canvas.fillCircle primitive (opcode 6) and keep the whole
 * canvas as the gesture target. Standalone CommonJS, no node --test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS shell_slider ' + name); }

const SLIDER = 'globalThis.seen=[];globalThis.sl=lume.ui.shell.Slider({' +
  'width:320,height:48,min:0,max:100,step:5,value:50,x:10,y:20,' +
  'onChange:function(v){seen.push(v);}';
function launch(extra) { return runApp(shell + '\n' + SLIDER + (extra || '') + '});'); }
function draws(s) { return s.messages.filter(m => m[0] === 'draw'); }

/* Pre-r203 golden stream: clear, track fillRect, accent fillRect, square
 * fillRect thumb (24px at 480x480 theme defaults). */
const GOLDEN = [
  ['draw', 1, 0, 0, 0, 0, 0, 0, 1],
  ['draw', 1, 1, 0, 22, 320, 4, 1848393, 1],
  ['draw', 1, 1, 0, 22, 172, 4, 4249776, 1],
  ['draw', 1, 1, 148, 12, 24, 24, 15923195, 1],
];

check('default draw stream is byte-identical to pre-r203', () => {
  assert.deepEqual(draws(launch()), GOLDEN);
});

check('mutation proof: golden stream rejects a default-path change', () => {
  const mutated = shell.replace('var kx = Math.round(frac * (width - knob));',
    'var kx = Math.round(frac * (width - knob)) + 1;');
  assert.notEqual(mutated, shell);
  assert.notDeepEqual(draws(runApp(mutated + '\n' + SLIDER + '});')), GOLDEN);
});

check('roundThumb draws a filled circle with radius >= 16 px', () => {
  const d = draws(launch(',roundThumb:true'));
  assert.equal(d.length, 4, 'clear + track + fill + thumb');
  assert.deepEqual(d.slice(0, 2), GOLDEN.slice(0, 2), 'clear + track unchanged');
  assert.equal(d[2][5], 160, 'accent fill ends at thumb centre (142 + 18)');
  const thumb = d[3];
  assert.equal(thumb[2], 6, 'Canvas.fillCircle opcode');
  assert.equal(thumb[5], 18, 'radius = floor(36/2)');
  assert.ok(thumb[5] * 2 >= 32, 'diameter >= 32 px');
  assert.equal(thumb[3], 160, 'thumb centre x inside canvas');
  assert.equal(thumb[4], 24, 'thumb centre y on track mid');
  assert.equal(thumb[7], 15923195, 'theme text colour');
  assert.ok(!d.some(m => m[2] === 1 && m[3] === 148 && m[4] === 12), 'square thumb gone');
});

check('knobDiameter tunes the radius within the track height', () => {
  const thumb = draws(launch(',roundThumb:true,knobDiameter:40'))[3];
  assert.equal(thumb[2], 6);
  assert.equal(thumb[5], 20, 'radius = floor(40/2)');
});

check('new params validate without touching the default path', () => {
  assert.throws(() => launch(',roundThumb:"true"'), /roundThumb/);
  assert.throws(() => launch(',roundThumb:true,knobDiameter:31'), /knobDiameter/);
  assert.throws(() => launch(',roundThumb:true,knobDiameter:1.5'), /knobDiameter/);
  assert.throws(() => launch(',roundThumb:true,knobDiameter:49'), /knobDiameter/);
  assert.deepEqual(draws(launch()), GOLDEN, 'rejected params leave defaults intact');
});

check('roundThumb keeps the canvas gesture target and step quantisation', () => {
  function drag(s) {
    s.gesture(s.ctx.sl, 0, 100, 20, 0);
    s.gesture(s.ctx.sl, 1, 132, 20, 16);
    s.gesture(s.ctx.sl, 2, 132, 20, 32);
    return [...s.ctx.seen];
  }
  const plain = drag(launch()), round = drag(launch(',roundThumb:true'));
  assert.deepEqual(round, plain, 'same dx -> same quantised value stream');
  assert.deepEqual(plain, [60], 'dx 32 -> 50 + 32*100/320 = 60, step 5');
});

console.log('PASS ' + cases + ' shell Slider cases');
