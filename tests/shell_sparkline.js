/* r193 host harness for shell.Sparkline (pure JS app-layer component).
 * Standalone CommonJS:
 *   node tests/shell_sparkline.js
 *
 * Runs the REAL component against the firmware prelude with runtime/shell.js
 * prepended. Static checks cover the canvas node, single / multi series,
 * auto vs explicit domain, flat-sequence degradation, empty / single point,
 * fillArea, dots / last-dot and dispose. Live checks drive a signal-backed
 * data getter and prove the owned onDraw effect repaints. Every predicate has
 * a mutation proof. There is NO hardware pixel / touch verification here:
 * board-level fidelity is deferred to board bring-up.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;

function make(code, source) {
  return runApp((source === undefined ? shell : source) + '\n' + code);
}
function segments(s, id) {
  const out = [];
  s.messages.filter(m => m[0] === 'batch' && m[1] === id).forEach(m => {
    for (let i = 0; i < m[2].length; i += 6) out.push(m[2].slice(i, i + 6));
  });
  return out;
}
function dots(s, id, op) {
  return s.messages.filter(m => m[0] === 'draw' && m[1] === id && m[2] === op);
}
function check(name, fn, mutation) {
  fn(shell);
  if (mutation) {
    const bad = mutation(shell);
    assert.notEqual(bad, shell, 'mutation unchanged: ' + name);
    assert.throws(() => fn(bad), undefined, 'mutation survived: ' + name);
  }
  cases++;
  console.log('PASS shell_sparkline ' + name + (mutation ? '; mutation FAIL as expected' : ''));
}

check('single series mounts one canvas and draws a full-width polyline', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[0,5,10],width:100,height:50,x:0,y:0});', src);
  const id = s.ctx.p;
  assert.equal(s.messages.filter(m => m[0] === 'create' && m[2] === 3).length, 1);
  const segs = segments(s, id);
  assert.equal(segs.length, 2, 'three points -> two segments');
  assert.equal(segs[0][0], 1, 'first x = inset');
  assert.equal(segs[1][2], 99, 'last x = width - inset');
  assert.equal(segs[0][4], 0x40D8B0, 'theme accent default colour');
}, src => src.replace('if (n > 1) c.polyline(pts, ink, s.strokeWidth);', ''));

check('auto min/max maps extremes to inset rows', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[0,5,10],width:100,height:50,x:0,y:0});', src);
  const segs = segments(s, s.ctx.p);
  assert.deepEqual([segs[0][1], segs[1][3]], [48, 1], 'min -> bottom inset, max -> top inset');
  assert.equal(segs[0][3], 25, 'midpoint -> centre');
}, src => src.replace('if (lo === undefined || hi === undefined) {', 'if (false) {'));

check('explicit min/max overrides auto and validates the domain', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[50,60,70],min:0,max:100,width:100,height:50,x:0,y:0});', src);
  const segs = segments(s, s.ctx.p);
  assert.equal(segs[0][1], 25, 'v=50 is mid with 0..100 domain');
  assert.equal(segs[1][3], 15, 'v=70 maps above mid');
  assert.throws(() => make('lume.ui.shell.Sparkline({data:[1],min:5,max:5});', src), /min < max/);
  assert.throws(() => make('lume.ui.shell.Sparkline({data:[1],min:"a"});', src), /min must be a finite number/);
}, src => src.replace('var all = resolve(), lo = loProp, hi = hiProp, i, j;',
  'var all = resolve(), lo = undefined, hi = undefined, i, j;'));

check('series takes precedence over data and palette colours cycle', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,2,3],series:[{data:[1,2]},{data:[3,4]}],width:100,height:50,x:0,y:0});', src);
  const segs = segments(s, s.ctx.p);
  assert.equal(segs.length, 2, 'two series, not the single data array');
  assert.deepEqual([...new Set(segs.map(g => g[4]))].sort((a, b) => a - b),
    [0x40D8B0, 0x5AA9E6].sort((a, b) => a - b), 'per-series palette colours');
}, src => src.replace('var useSeries = p.series !== undefined;', 'var useSeries = false;'));

check('per-series color / strokeWidth and colors[] fallback are respected', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({series:[{data:[1,2],color:"#FF0000",strokeWidth:4},{data:[2,1]}],colors:["#00FF00","#0000FF"],width:100,height:50,x:0,y:0});', src);
  const segs = segments(s, s.ctx.p);
  assert.equal(segs[0][4], 0xFF0000, 'explicit series colour wins');
  assert.equal(segs[0][5], 4, 'explicit series stroke width');
  assert.equal(segs[1][4], 0x0000FF, 'colors[] fallback for series without colour');
}, src => src.replace('if (p.colors && p.colors[i] !== undefined) fallback = sparkColor(p.colors[i], fallback);', ''));

check('flat sequence degenerates to centre with no divide-by-zero', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[5,5,5],width:100,height:50,x:0,y:0});', src);
  const segs = segments(s, s.ctx.p);
  assert.ok(segs.length > 0);
  assert.ok(segs.every(g => g[1] === 25 && g[3] === 25), 'all samples at y=25');
}, src => src.replace('var flat = !(hi > lo), range = hi - lo;', 'var flat = false, range = 0;'));

check('empty data and a single point do not crash', src => {
  const empty = make('globalThis.p=lume.ui.shell.Sparkline({data:[],width:100,height:50,x:0,y:0,showLast:true});', src);
  assert.equal(segments(empty, empty.ctx.p).length, 0, 'nothing drawn');
  assert.equal(dots(empty, empty.ctx.p, 6).length, 0, 'no last dot for empty data');
  const one = make('globalThis.p=lume.ui.shell.Sparkline({data:[7],width:100,height:50,x:0,y:0,showLast:true});', src);
  assert.equal(segments(one, one.ctx.p).length, 0, 'no segment for one point');
  const d = dots(one, one.ctx.p, 6);
  assert.equal(d.length, 1, 'one last dot');
  assert.deepEqual([d[0][3], d[0][4]], [50, 25], 'centred x/y');
}, src => src.replace('if (!n) return; /* empty / all non-finite: nothing to draw */', ''));

check('fillArea paints vertical columns in surfaceAlt and toggles off', src => {
  const on = make('globalThis.p=lume.ui.shell.Sparkline({data:[0,10],width:100,height:50,x:0,y:0,fillArea:true});', src);
  const segs = segments(on, on.ctx.p);
  const area = segs.filter(g => g[0] === g[2] && g[4] === 0x1C3449);
  assert.ok(area.length > 90, 'one column per integer x: ' + area.length);
  assert.ok(area.every(g => g[3] === 49), 'columns reach the bottom edge');
  const off = make('globalThis.p=lume.ui.shell.Sparkline({data:[0,10],width:100,height:50,x:0,y:0});', src);
  assert.equal(segments(off, off.ctx.p).filter(g => g[0] === g[2]).length, 0, 'no area when off');
}, src => src.replace('if (fillArea && n > 1) {', 'if (false) {'));

check('showDots and showLast place the expected circles', src => {
  const dotsOnly = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,2,3],width:100,height:50,x:0,y:0,showDots:true});', src);
  assert.equal(dots(dotsOnly, dotsOnly.ctx.p, 6).length, 3);
  assert.ok(dots(dotsOnly, dotsOnly.ctx.p, 6).every(m => m[5] === 2));
  const lastOnly = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,2,3],width:100,height:50,x:0,y:0,showLast:true});', src);
  const last = dots(lastOnly, lastOnly.ctx.p, 6);
  assert.equal(last.length, 1);
  assert.equal(last[0][5], 3, 'last dot radius');
  assert.equal(last[0][3], 99, 'last dot at the right edge');
}, src => src.replace('if (showLast) {', 'if (false) {'));

check('showDots is independently switchable', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,2,3],width:100,height:50,x:0,y:0,showDots:true});', src);
  assert.equal(dots(s, s.ctx.p, 6).length, 3);
}, src => src.replace('if (showDots) pts.forEach', 'if (false) pts.forEach'));

check('non-finite samples are skipped and long series are downsampled', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,NaN,2,Infinity,3],width:100,height:50,x:0,y:0});', src);
  assert.equal(segments(s, s.ctx.p).length, 2, 'three finite samples');
  const long = make('globalThis.p=lume.ui.shell.Sparkline({data:Array.from({length:500},(_,i)=>i),width:100,height:50,x:0,y:0});', src);
  assert.equal(segments(long, long.ctx.p).length, 239, '240 points -> 239 segments, within Canvas cap');
}, src => src.replace('if (clean.length <= SPARK_POINTS) return clean;', 'if (true) return clean;'));

function liveCase(appCode) {
  const s = make(appCode);
  assert.ok(s.messages.some(m => m[0] === 'batch'), 'initial paint');
  s.messages.length = 0;
  vm.runInContext('d.set([9,1,8,2])', s.ctx);
  assert.ok(s.messages.some(m => m[0] === 'batch'), 'publish triggers a repaint');
  assert.equal(segments(s, s.ctx.p).length, 3, 'new sample count reflected');
}
const liveCode = 'globalThis.d=signal([1,2,3]);globalThis.p=lume.ui.shell.Sparkline({data:d,width:100,height:50,x:0,y:0});';
liveCase(liveCode);
const frozen = liveCode.replace('{data:d,', '{data:[1,2,3],');
assert.notEqual(frozen, liveCode, 'live mutation unchanged');
assert.throws(() => liveCase(frozen), undefined, 'live mutation survived');
cases++;
console.log('PASS shell_sparkline live signal data repaints through the owned onDraw effect; mutation FAIL as expected');

check('dispose removes the canvas and is idempotent', src => {
  const s = make('globalThis.p=lume.ui.shell.Sparkline({data:[1,2],width:100,height:50,x:0,y:0});', src);
  vm.runInContext('lume.ui.shell.dispose(p);lume.ui.shell.dispose(p)', s.ctx);
  assert.equal(s.messages.filter(m => m[0] === 'remove' && m[1] === s.ctx.p).length, 1);
}, src => src.replace('cleanups[canvas] = function () { lume.removeChild(canvas); };', ''));

check('invalid props throw before mounting', src => {
  assert.throws(() => make('lume.ui.shell.Sparkline({data:[1],strokeWidth:0});', src), /strokeWidth/);
  assert.throws(() => make('lume.ui.shell.Sparkline({data:[1],colors:"red"});', src), /colors must be an array/);
  assert.throws(() => make('lume.ui.shell.Sparkline({series:[1]});', src), /series entries must be objects/);
  assert.throws(() => make('lume.ui.shell.Sparkline({data:"abc"});', src), /data must be an array/);
}, src => src.replace("throw new RangeError('lume: Sparkline strokeWidth must be 1..16 pixels');", ''));

console.log('ALL SHELL SPARKLINE CASES PASSED (' + cases + ' cases)');
