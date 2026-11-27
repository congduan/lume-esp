/* r220 host harness for the shell.Slider round-thumb default (graduated from
 * the r203 opt-in knife).
 *
 *   node tests/shell_slider.js
 *
 * Since r220, roundThumb defaults to true: a Slider without roundThumb draws a
 * 36px diameter Canvas.fillCircle thumb (opcode 6, radius 18) and keeps the
 * whole canvas as the gesture target. Explicit roundThumb:false preserves the
 * pre-r203 square fillRect draw stream byte-for-byte. Standalone CommonJS, no
 * node --test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS shell_slider ' + name); }

const SLIDER = 'globalThis.seen=[];globalThis.sl=lume.ui.shell.Slider({' +
  'width:320,height:48,min:0,max:100,step:5,value:50,x:10,y:20,' +
  'onChange:function(v){seen.push(v);}';
function launch(extra) { return runApp(shell + '\n' + SLIDER + (extra || '') + '});'); }
function draws(s) { return s.messages.filter(m => m[0] === 'draw'); }

/* r220 default golden stream: clear, track fillRect, accent fillRect to thumb
 * centre (142 + 18 = 160), round fillCircle thumb (r=18 at 480x480 defaults). */
const ROUND_GOLDEN = [
  ['draw', 1, 0, 0, 0, 0, 0, 0, 1],
  ['draw', 1, 1, 0, 22, 320, 4, 1848393, 1],
  ['draw', 1, 1, 0, 22, 160, 4, 4249776, 1],
  ['draw', 1, 6, 160, 24, 18, 0, 15923195, 1],
];

/* Pre-r203 legacy golden stream: clear, track fillRect, accent fillRect,
 * square fillRect thumb (24px at 480x480 theme defaults). */
const LEGACY_GOLDEN = [
  ['draw', 1, 0, 0, 0, 0, 0, 0, 1],
  ['draw', 1, 1, 0, 22, 320, 4, 1848393, 1],
  ['draw', 1, 1, 0, 22, 172, 4, 4249776, 1],
  ['draw', 1, 1, 148, 12, 24, 24, 15923195, 1],
];

check('default draw stream draws round thumb (r=18) matching ROUND_GOLDEN', () => {
  const d = draws(launch());
  assert.deepEqual(d, ROUND_GOLDEN);
  assert.deepEqual(draws(launch(',roundThumb:true')), ROUND_GOLDEN);
  assert.equal(d.length, 4, 'clear + track + fill + thumb');
  assert.deepEqual(d.slice(0, 2), LEGACY_GOLDEN.slice(0, 2), 'clear + track unchanged');
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

check('explicit roundThumb:false preserves pre-r203 square draw stream byte-for-byte', () => {
  assert.deepEqual(draws(launch(',roundThumb:false')), LEGACY_GOLDEN);
});

check('mutation proof: golden streams reject default and legacy path changes', () => {
  const mutatedRound = shell.replace('var tx = Math.round(frac * (width - 2 * r));',
    'var tx = Math.round(frac * (width - 2 * r)) + 1;');
  assert.notEqual(mutatedRound, shell);
  assert.notDeepEqual(draws(runApp(mutatedRound + '\n' + SLIDER + '});')), ROUND_GOLDEN);

  const mutatedLegacy = shell.replace('var kx = Math.round(frac * (width - knob));',
    'var kx = Math.round(frac * (width - knob)) + 1;');
  assert.notEqual(mutatedLegacy, shell);
  assert.notDeepEqual(draws(runApp(mutatedLegacy + '\n' + SLIDER + ',roundThumb:false});')), LEGACY_GOLDEN);
});

check('default round thumb fits inside minimum 40px height track', () => {
  const s = runApp(shell + '\nlume.ui.shell.Slider({width:320,min:0,max:100,value:50});');
  const thumb = draws(s)[3];
  assert.equal(thumb[2], 6, 'Canvas.fillCircle opcode');
  assert.equal(thumb[4], 20, 'mid = floor(40/2)');
  assert.equal(thumb[5], 18, 'r = 18 fits inside 40px height (y=2..38)');
});

check('knobDiameter tunes the radius within the track height on default path', () => {
  const defThumb = draws(launch(',knobDiameter:40'))[3];
  const expThumb = draws(launch(',roundThumb:true,knobDiameter:40'))[3];
  assert.deepEqual(defThumb, expThumb);
  assert.equal(defThumb[2], 6);
  assert.equal(defThumb[5], 20, 'radius = floor(40/2)');
});

check('params validate without corrupting the default path', () => {
  assert.throws(() => launch(',roundThumb:"true"'), /roundThumb/);
  assert.throws(() => launch(',knobDiameter:31'), /knobDiameter/);
  assert.throws(() => launch(',knobDiameter:1.5'), /knobDiameter/);
  assert.throws(() => launch(',knobDiameter:49'), /knobDiameter/);
  assert.deepEqual(draws(launch()), ROUND_GOLDEN, 'rejected params leave defaults intact');
});

check('roundThumb keeps the canvas gesture target and step quantisation', () => {
  function drag(s) {
    s.gesture(s.ctx.sl, 0, 100, 20, 0);
    s.gesture(s.ctx.sl, 1, 132, 20, 16);
    s.gesture(s.ctx.sl, 2, 132, 20, 32);
    return [...s.ctx.seen];
  }
  const def = drag(launch()), round = drag(launch(',roundThumb:true')), legacy = drag(launch(',roundThumb:false'));
  assert.deepEqual(def, round, 'default matches explicit roundThumb:true');
  assert.deepEqual(def, legacy, 'same dx -> same quantised value stream as legacy');
  assert.deepEqual(def, [60], 'dx 32 -> 50 + 32*100/320 = 60, step 5');
});

console.log('PASS ' + cases + ' shell Slider cases');
