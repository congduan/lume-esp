/* r174 instrument: JS-side geometry rebuilds per frame, BEFORE vs AFTER r49.
 *
 * Method (r49 emu A/B shape, but counting JS segment rebuilds instead of CPU
 * instructions): load an app in the real prelude host, call its draw functions
 * with a counting canvas ctx. A "JS segment rebuild" is one c.line() or one
 * polyline edge; retainPath/retainSegments are counted once at DEFINE time and
 * drawPath replay costs zero JS segments. Native c.arc()/c.circle() also cost
 * zero JS segments.
 *
 * BEFORE is reconstructed from the CURRENT source by mechanically restoring
 * only the code that r49 replaced (commits 38ad8f7 watchface, 31f2689
 * gravity_ball). Everything else is byte-identical, so the delta isolates the
 * retained-path migration and is not contaminated by later features.
 *
 * Usage: node artifacts/r174/instrument.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runApp } = require('../../tests/lib/prelude_runner');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
function replaceOnce(src, from, to, label) {
  if (!src.includes(from)) throw new Error('missing pattern for ' + label);
  return src.replace(from, to);
}

function countingCtx() {
  const c = {
    counts: { line: 0, polylineEdges: 0, arc: 0, circle: 0,
      retainSegments: 0, retainPath: 0, drawPath: 0, fillRect: 0 },
    defined: [],
    fillColor() {}, clear() {}, text() {},
    line() { c.counts.line++; },
    polyline(points) { c.counts.polylineEdges += Math.max(0, points.length - 1); },
    arc() { c.counts.arc++; },
    circle() { c.counts.circle++; },
    retainSegments(segs) { c.counts.retainSegments += segs.length; c.defined.push(['segments', segs.length]); return c.defined.length; },
    retainPath(points) { c.counts.retainPath += Math.max(0, points.length - 1); c.defined.push(['path', points.length - 1]); return c.defined.length; },
    drawPath() { c.counts.drawPath++; },
    fillRect() { c.counts.fillRect++; },
  };
  return c;
}

function measureDraw(appSource, drawExpr) {
  const h = runApp(appSource);
  vm.runInContext(
    "faceNow.set(new Date(2026,0,1,10,30,45)); faceBatt.set(78); " +
    "faceSteps.set(3000); goalProgress.set([24,18,35]);", h.ctx);
  const ctx = countingCtx();
  h.ctx.__countCtx = ctx;
  vm.runInContext(drawExpr, h.ctx);
  return { counts: ctx.counts, defined: ctx.defined };
}

function reportWatchface(name, r) {
  const c = r.counts, segs = c.line + c.polylineEdges;
  console.log(`${name}: JS segments/frame=${segs} (line=${c.line}, polylineEdges=${c.polylineEdges})` +
    ` | native arc=${c.arc} circle=${c.circle}` +
    ` | DEFINE segments=${c.retainSegments} pathEdges=${c.retainPath}` +
    ` | drawPath/frame=${c.drawPath}`);
  console.log(`  retained definitions: ${JSON.stringify(r.defined)}`);
}

// ---- watchface -------------------------------------------------------------
const WF_AFTER_BLOCK = `  /* r49 #6: the 60 tick marks are static geometry, uploaded once as two
   * retained paths (minor / major differ in colour and width) and replayed
   * from C, instead of sampling 60 facePoint()/line() pairs in JS each frame. */
  if (!c.minorTicks) {
    var minor = [], major = [];
    for (var i = 0; i < 60; i++) {
      var a = i * 6, p = facePoint(i % 5 ? 126 : 116, a), q = facePoint(133, a);
      (i % 5 ? minor : major).push([p[0], p[1], q[0], q[1]]);
    }
    c.minorTicks = c.retainSegments(minor, '#667F8B', 1);
    c.majorTicks = c.retainSegments(major, '#E9F5F8', 2);
  }
  c.drawPath(c.minorTicks);
  c.drawPath(c.majorTicks);`;
const WF_BEFORE_TICKS = `  for (var i = 0; i < 60; i++) { var a = i * 6, p = facePoint(i % 5 ? 126 : 116, a), q = facePoint(133, a); c.line(p[0], p[1], q[0], q[1], i % 5 ? '#667F8B' : '#E9F5F8', i % 5 ? 1 : 2); }`;
const WF_AFTER_RINGS = `  /* r49 #6: the three full background rings are static (~121 segments each,
   * ~360 total); upload them once and replay from C. Retained paths replay the
   * same canvas_line() raster as polyline(), so the picture is unchanged. The
   * three progress arcs depend on battery/steps/seconds and stay per-frame. */
  if (!c.bgRings) {
    c.bgRings = [
      c.retainPath(faceArcPoints(0, 360, 136), '#1C3449', 8),
      c.retainPath(faceArcPoints(0, 360, 111), '#1C3449', 8),
      c.retainPath(faceArcPoints(0, 360, 86), '#1C3449', 8)
    ];
  }
  for (var i = 0; i < c.bgRings.length; i++) c.drawPath(c.bgRings[i]);`;
const WF_BEFORE_RINGS = `  faceArc(c, 0, 360, 136, '#1C3449', 8); faceArc(c, 0, 360, 111, '#1C3449', 8); faceArc(c, 0, 360, 86, '#1C3449', 8);`;

const wfCur = read('examples/watchface/app.js');
let wfOld = replaceOnce(wfCur, WF_AFTER_BLOCK, WF_BEFORE_TICKS, 'watchface ticks');
wfOld = replaceOnce(wfOld, WF_AFTER_RINGS, WF_BEFORE_RINGS, 'watchface rings');
const wfExpr = 'analogDraw(__countCtx); ringDraw(__countCtx); goalDraw(__countCtx);';
const wfBefore = measureDraw(wfOld, wfExpr);
const wfAfter = measureDraw(wfCur, wfExpr);

console.log('=== watchface: analogDraw + ringDraw + goalDraw, one frame, fixed data ===');
reportWatchface('BEFORE (r49 reverted for ticks + bg rings)', wfBefore);
reportWatchface('AFTER  (shipped retained paths)', wfAfter);
const wfSegB = wfBefore.counts.line + wfBefore.counts.polylineEdges;
const wfSegA = wfAfter.counts.line + wfAfter.counts.polylineEdges;
console.log(`RESULT watchface JS segments/frame ${wfSegB} -> ${wfSegA} (-${wfSegB - wfSegA}, ${(100 * (wfSegB - wfSegA) / wfSegB).toFixed(1)}%)`);

// ---- gravity_ball (renamed imu_ball) ---------------------------------------
const GB_AFTER = `/* r49 #6: the ball disc has a fixed shape; only its position changes. Its
 * 2*BALL_R+1 horizontal rows are precomputed once (retained geometry) instead
 * of recomputing sqrt()/floor()/max()/min() in JS on every frame. The rows are
 * still drawn with fillRect (cheap span raster): a filled disc is not
 * line-segment geometry, so C-side retained paths (which replay via the AA
 * canvas_line) would cost far more core0 raster work than they save in JS. */
var BALL_SPANS = [];
for (var sy = -BALL_R; sy <= BALL_R; sy++) {
  BALL_SPANS.push([sy, Math.floor(Math.sqrt(BALL_R * BALL_R - sy * sy))]);
}
function disc(ctx, cx, cy) {
  ctx.fillColor(BALL_INK);
  for (var i = 0; i < BALL_SPANS.length; i++) {
    var sy = BALL_SPANS[i][0], half = BALL_SPANS[i][1], y = cy + sy;
    if (y < 0 || y >= H) continue;
    var x1 = cx - half, x2 = cx + half + 1;
    if (x1 < 0) x1 = 0;
    if (x2 > W) x2 = W;
    if (x2 > x1) ctx.fillRect(x1, y, x2 - x1, 1);
  }
}`;
const GB_BEFORE = `function disc(ctx, cx, cy, r, color) {
  ctx.fillColor(color);
  for (var y = -r; y <= r; y++) {
    var half = Math.floor(Math.sqrt(r * r - y * y));
    var x1 = Math.max(0, cx - half), x2 = Math.min(W, cx + half + 1);
    if (x2 > x1 && cy + y >= 0 && cy + y < H) ctx.fillRect(x1, cy + y, x2 - x1, 1);
  }
}`;

function measureDisc(appSource, callExpr) {
  const h = runApp(appSource);
  const ctx = countingCtx();
  h.ctx.__countCtx = ctx;
  // Patch Math.sqrt INSIDE the vm context (Node does not expose built-ins on
  // the context object). The BALL_SPANS precompute ran during runApp(), before
  // this patch, so only per-frame sqrt() in disc() is counted.
  vm.runInContext(`(function () {
    var real = Math.sqrt; globalThis.__sqrtCalls = 0;
    Math.sqrt = function (x) { globalThis.__sqrtCalls++; return real(x); };
    globalThis.__restoreSqrt = function () { Math.sqrt = real; };
  })();`, h.ctx);
  vm.runInContext(callExpr, h.ctx);
  const sqrtCalls = vm.runInContext('globalThis.__sqrtCalls', h.ctx);
  vm.runInContext('globalThis.__restoreSqrt();', h.ctx);
  return { sqrtCalls, fillRect: ctx.counts.fillRect };
}

const gbCur = read('examples/gravity_ball/app.js');
let gbOld = replaceOnce(gbCur, GB_AFTER, GB_BEFORE, 'gravity_ball disc');
gbOld = gbOld.split('disc(ctx, bx, by);').join('disc(ctx, bx, by, BALL_R, BALL_INK);');
const gbBefore = measureDisc(gbOld, 'disc(__countCtx, 240, 240, 24, "#F5F4E9");');
const gbAfter = measureDisc(gbCur, 'disc(__countCtx, 240, 240);');
console.log('\n=== gravity_ball (imu_ball successor): disc(), one frame ===');
console.log(`BEFORE per-frame Math.sqrt calls=${gbBefore.sqrtCalls}, fillRect spans=${gbBefore.fillRect}`);
console.log(`AFTER  per-frame Math.sqrt calls=${gbAfter.sqrtCalls}, fillRect spans=${gbAfter.fillRect}`);
console.log(`RESULT gravity_ball per-frame trig evaluations ${gbBefore.sqrtCalls} -> ${gbAfter.sqrtCalls} (-${gbBefore.sqrtCalls - gbAfter.sqrtCalls})`);
console.log('C-side retained line segments: 49 replayed via drawPath -> REJECTED in r49 (+12% total),');
console.log('                               see docs/roadmap.md r49 result section.');
