/* Flapdot — r102, one-tap arcade flyer, procedically gated course.
 * One 480x400 canvas (192,000 px, under the 230,400 budget); HUD is native
 * Text nodes, never canvas pixels. Retro-classics rules: original dot-styled
 * bird and pipes (no trademark sprites), ASCII-only UI (r64 font rule).
 *
 * World model (pure, deterministic for the host harness): the world scrolls
 * LEFT at SCROLL px/s; pipe pair i sits at world x i*PIPE_EVERY and its gap
 * geometry comes from a hash of the pipe index, so pipe i is identical on
 * host and device and the whole course is replayable from the elapsed scroll
 * distance alone. Difficulty = gap width shrinking with the pipe index
 * (GAP_STEP px every GAP_EVERY pipes, floored at GAP_MIN) — continuous, no
 * jumps. Score = pipes whose right edge has passed the bird.
 *
 * Input: tap = flap (fixed upward velocity against gravity). Tap on GAME OVER
 * restarts. Rendering keeps a dirty band discipline: per frame only the pipes
 * band, the ground strip and the bird box are repainted; full repaint on
 * phase changes and boot. Best score goes to lume.storage.kv — NVS keys cap
 * at 15 chars (lume_kv.c), so the key is 'hisc.flapdot' (12 chars). */

/* ------------------- logic (host harness splits at the GAME UI marker) -- */
var FW = 480, FH = 400;                    /* canvas size and pixel budget */
var FY = 80;                               /* canvas y on the 480x480 screen */
var GROUND_H = 24;                         /* scrolling ground strip */
var BIRD_X = 120, BIRD_R = 9;              /* bird column and radius */
var GRAV = 1300, FLAP_VY = -400;           /* px/s^2 and px/s */
var MAX_FALL = 560;                        /* terminal velocity */
var SCROLL = 150;                          /* world speed px/s */
var PIPE_W = 56, PIPE_EVERY = 220;         /* pipe width and spacing px */
var PIPE0 = FW;                            /* pipe 0 enters right at s=PIPE0 */
var GAP_START = 150, GAP_MIN = 110;        /* gap px, difficulty ramp */
var GAP_STEP = 8, GAP_EVERY = 3;           /* shrink per GAP_EVERY pipes */
var MARGIN = 36;                           /* gap placement margin px */
var DT = 1 / 30;                           /* tick, 30 fps */
var SEED = 20261118;

/* Seeded PRNG (mulberry32), same generator as golf/r79. */
function mulberry32(seed) {
  var t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | t)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Pipe i geometry: gap width from the difficulty ramp, gap top from a hash
 * of the index. Pure: identical on host and device, no shared stream state. */
function pipeGeom(i) {
  var gap = Math.max(GAP_MIN, GAP_START - Math.floor(i / GAP_EVERY) * GAP_STEP);
  var rnd = mulberry32((SEED + i * 7919) >>> 0)();
  var span = FH - GROUND_H - gap - MARGIN * 2;
  var top = MARGIN + Math.floor(rnd * Math.max(1, span));
  return { top: top, gap: gap, bottom: top + gap };
}

/* Screen x of pipe i when the world has scrolled s px. */
function pipeX(i, s) { return i * PIPE_EVERY + PIPE0 - s; }

/* Visible pipe indices at scroll s: screen x in (-PIPE_W, FW]. */
function pipeRange(s) {
  var lo = Math.max(0, Math.ceil((s - PIPE0 - PIPE_W + 1) / PIPE_EVERY));
  var hi = Math.floor((s + PIPE0 - 1) / PIPE_EVERY);
  return { lo: lo, hi: Math.max(lo - 1, hi) };
}

/* Score = pipes whose right edge has passed the bird column. */
function flapScore(s) {
  var n = 0, r = pipeRange(s);
  for (var i = 0; i <= r.hi; i++) if (pipeX(i, s) + PIPE_W < BIRD_X) n++;
  return n;
}

/* Circle-vs-rect (circle centre, radius; axis-aligned rect). */
function flapHitRect(cx, cy, r, rx, ry, rw, rh) {
  var nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
  var dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/* Death test. Top is forgiving (clamped in the step), ground and pipes kill. */
function flapDead(y, s) {
  if (y + BIRD_R >= FH - GROUND_H) return 'ground';
  var r = pipeRange(s);
  for (var i = r.lo; i <= r.hi; i++) {
    var x = pipeX(i, s), g = pipeGeom(i);
    if (flapHitRect(BIRD_X, y, BIRD_R - 1, x, g.top - 400, PIPE_W, 400)) return 'pipe';
    if (flapHitRect(BIRD_X, y, BIRD_R - 1, x, g.bottom, PIPE_W, FH - GROUND_H - g.bottom + 400)) return 'pipe';
  }
  return '';
}

function flapState() {
  return { phase: 'ready', t: 0, s: 0, y: FH / 2, vy: 0, score: 0, hit: '' };
}

/* Advance one tick. Ready bobs the bird on a sine; run integrates gravity
 * and scrolls the world; dead freezes (the tap restarts). */
function flapStep(st, dt) {
  st.t += dt;
  if (st.phase === 'ready') {
    st.y = FH / 2 + Math.round(Math.sin(st.t * 3) * 10);
    return st;
  }
  if (st.phase !== 'run') return st;
  st.s += SCROLL * dt;
  st.vy = Math.min(MAX_FALL, st.vy + GRAV * dt);
  st.y += st.vy * dt;
  if (st.y < BIRD_R + 1) { st.y = BIRD_R + 1; st.vy = Math.max(st.vy, 0); }
  st.score = flapScore(st.s);
  var hit = flapDead(st.y, st.s);
  if (hit) { st.phase = 'dead'; st.hit = hit; st.vy = 0; }
  return st;
}

function flapFlap(st) { st.vy = FLAP_VY; }

/* Tap: ready/dead -> fresh run with one flap; run -> flap in place. */
function flapTap(st) {
  if (st.phase === 'run') { flapFlap(st); return st; }
  var ns = flapState();
  ns.phase = 'run';
  flapFlap(ns);
  return ns;
}

/* The pipe the bird must clear next (right edge at/ahead of the bird). */
function flapNextPipe(s) {
  var r = pipeRange(s);
  for (var i = r.lo; i <= r.hi; i++) if (pipeX(i, s) + PIPE_W >= BIRD_X) return i;
  return r.hi + 1;
}

/* GAME UI */
var PAL = {
  sky: '#7FC4DE', skyDim: '#6FB2CC', pipe: '#3E9C4F', pipeRim: '#2C7438',
  ground: '#C9A66B', dash: '#8A6F3D', bird: '#F2C14E', wing: '#D99025',
  eye: '#FFFFFF', pupil: '#1A1A1A', dead: '#E26D5C'
};
function logEvent(msg) { lume.log('FLAP ' + msg); }

/* kv best (highest score); try/catch so a volatile best still works. */
function flapBest() { try { var n = lume.storage.kv.get('hisc.flapdot');
  return typeof n === 'number' && n > 0 ? n : 0; } catch (e) { return 0; } }
function flapSaveBest(score) { try { var old = flapBest();
  if (score > old) { lume.storage.kv.set('hisc.flapdot', score); return score; } } catch (e) {}
  return flapBest(); }

var state = flapState();
var frame = signal(0), scoreSig = signal(0), noteSig = signal(''), bestSig = signal(0);
var root = View({ style: { width: 480, height: 480, background: '#1B2530', scroll: 'none' } });

function noteText() {
  if (state.phase === 'dead') return 'GAME OVER - SCORE ' + state.score + ' - TAP';
  if (state.phase === 'ready') return 'TAP TO FLAP';
  return 'TAP TO FLAP';
}
function sync() {
  scoreSig.set(state.score);
  noteSig.set(noteText());
  frame.set(frame() + 1);
}

/* ---- bird sprite: disc spans + wing frames, one box --------------------- */
var BIRD_SPANS = [];
for (var sy = -BIRD_R; sy <= BIRD_R; sy++) {
  BIRD_SPANS.push([sy, Math.floor(Math.sqrt(BIRD_R * BIRD_R - sy * sy))]);
}
function disc(ctx, cx, cy, r, color, spans, a) {
  cx = Math.round(cx); cy = Math.round(cy);
  for (var i = 0; i < spans.length; i++) {
    var yy = cy + spans[i][0];
    if (yy < a.y || yy >= a.y + a.h) continue;
    var x1 = cx - spans[i][1], x2 = cx + spans[i][1] + 1;
    var cx1 = Math.max(x1, a.x), cx2 = Math.min(x2, a.x + a.w);
    if (cx2 > cx1) { ctx.fillColor(color); ctx.fillRect(cx1, yy, cx2 - cx1, 1); }
  }
}
function drawBird(ctx, st, a) {
  var blink = st.phase === 'dead' && Math.floor(st.t * 8) % 2 === 0;
  var body = blink ? PAL.dead : PAL.bird;
  if (st.phase === 'run') {
    disc(ctx, BIRD_X, st.y, BIRD_R, body, BIRD_SPANS, a);
  } else {
    /* Idle/dead bob: one native circle opcode instead of 19 clipped span
     * fillRects. Same disc, same color; this is the idle-only cheap path
     * that keeps the gated ready screen inside the draw budget (r185). */
    ctx.fillCircle(BIRD_X, Math.round(st.y), BIRD_R, body);
  }
  if (blink) return;
  var wingY = Math.round(st.y) + (st.phase === 'run' && st.vy < 0 ? -4 : 2);
  ctx.fillColor(PAL.wing);
  ctx.fillRect(BIRD_X - 8, wingY, 8, 4);
  ctx.fillColor(PAL.eye);
  ctx.fillRect(BIRD_X + 2, Math.round(st.y) - 4, 4, 4);
  ctx.fillColor(PAL.pupil);
  ctx.fillRect(BIRD_X + 4, Math.round(st.y) - 3, 2, 2);
}

/* ---- dirty-band renderer ------------------------------------------------ */
/* All canvas coords must be integers (prelude __canvasInt rejects fractions);
 * world positions are floats, so every rect is floored at draw time. */
function box(x, y, w, h) {
  var x0 = Math.floor(x), y0 = Math.floor(y);
  var x1 = Math.floor(x + w), y1 = Math.floor(y + h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
function clipRect(r, a) {
  var x = Math.max(r.x, a.x), y = Math.max(r.y, a.y);
  var x2 = Math.min(r.x + r.w, a.x + a.w), y2 = Math.min(r.y + r.h, a.y + a.h);
  return x2 > x && y2 > y ? box(x, y, x2 - x, y2 - y) : null;
}
function drawRectClip(ctx, color, r, a) {
  var c = clipRect(r, a);
  if (c) { ctx.fillColor(color); ctx.fillRect(c.x, c.y, c.w, c.h); }
}
/* Pipes band: union over visible pipes of their rects at scroll s.
 * Clipped to the canvas: entering pipes push x2 past FW and the prelude
 * rejects any dirty rect outside the canvas bounds. */
function pipeBand(s, pad) {
  var r = pipeRange(s), x1 = FW, x2 = 0, any = false;
  for (var i = r.lo; i <= r.hi; i++) {
    var x = pipeX(i, s);
    if (x + PIPE_W < -pad || x > FW + pad) continue;
    any = true;
    if (x - pad < x1) x1 = x - pad;
    if (x + PIPE_W + pad > x2) x2 = x + PIPE_W + pad;
  }
  if (!any) return null;
  var band = box(x1, 0, x2 - x1, FH - GROUND_H);
  return clipRect(band, box(0, 0, FW, FH));
}
function drawPipes(ctx, s, a) {
  var r = pipeRange(s);
  for (var i = r.lo; i <= r.hi; i++) {
    var g = pipeGeom(i), x = Math.round(pipeX(i, s));
    if (x + PIPE_W < a.x || x > a.x + a.w) continue;
    drawRectClip(ctx, PAL.pipe, box(x, -8, PIPE_W, g.top + 8), a);
    drawRectClip(ctx, PAL.pipeRim, box(x, g.top - 4, PIPE_W, 4), a);
    drawRectClip(ctx, PAL.pipe, box(x, g.bottom, PIPE_W, FH - GROUND_H - g.bottom), a);
    drawRectClip(ctx, PAL.pipeRim, box(x, g.bottom, PIPE_W, 4), a);
  }
}
function drawGround(ctx, s, a) {
  var g = box(0, FH - GROUND_H, FW, GROUND_H);
  drawRectClip(ctx, PAL.ground, g, a);
  var c = clipRect(g, a);
  if (!c) return;
  var off = Math.floor(s) % 24;
  ctx.fillColor(PAL.dash);
  for (var x = -24 - off; x < FW; x += 24) {
    var d = clipRect(box(x + 6, FH - GROUND_H + 10, 12, 4), c);
    if (d) ctx.fillRect(d.x, d.y, d.w, d.h);
  }
}
function birdBox(st) { return box(BIRD_X - BIRD_R - 5, st.y - BIRD_R - 6, 2 * BIRD_R + 10, 2 * BIRD_R + 12); }
function unionBox(a, b) {
  var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return box(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
}

var CANVAS_X = 0, CANVAS_Y = FY;
var painted = false, prevDrawnS = 0, prevDrawnY = FH / 2;
var scene = Canvas({ parent: root, width: FW, height: FH,
  style: { position: 'absolute', x: CANVAS_X, y: CANVAS_Y },
  onDraw: function (ctx) {
    frame();
    var a = !painted ? box(0, 0, FW, FH) : null;
    var rects = [];
    if (a) {
      drawRectClip(ctx, PAL.sky, box(0, 0, FW, FH), a);
      drawPipes(ctx, state.s, a);
      drawGround(ctx, state.s, a);
      drawBird(ctx, state, a);
      painted = true;
      prevDrawnS = state.s;
      prevDrawnY = state.y;
      return [a];
    }
    /* incremental: pipes band (old scroll + new scroll), ground strip, bird.
     * r185: when the world has not scrolled (ready/dead) the pipes and the
     * ground strip are unchanged -- only the bird box is dirty. Publishing
     * them anyway would burn ~27 draw messages per gated paint for nothing. */
    if (state.s !== prevDrawnS) {
      var band = pipeBand(state.s, 10);
      var oldBand = pipeBand(prevDrawnS, 10);
      if (band && oldBand) band = unionBox(band, oldBand);
      else if (oldBand) band = oldBand;
      if (band) rects.push(band);
      rects.push(box(0, FH - GROUND_H, FW, GROUND_H));
    }
    var yLo = Math.min(prevDrawnY, state.y) - BIRD_R - 8;
    var yHi = Math.max(prevDrawnY, state.y) + BIRD_R + 8;
    var birdPath = unionBox(box(BIRD_X - BIRD_R - 5, yLo, 2 * BIRD_R + 10, yHi - yLo), birdBox(state));
    rects.push(clipRect(birdPath, box(0, 0, FW, FH)));
    var used = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      drawRectClip(ctx, PAL.sky, box(0, 0, FW, FH), r);
      drawPipes(ctx, state.s, r);
      drawGround(ctx, state.s, r);
      drawBird(ctx, state, r);
      used.push(r);
    }
    prevDrawnS = state.s;
    prevDrawnY = state.y;
    return used;
  } });

/* HUD is native Text nodes above the canvas: zero canvas-pixel cost. */
/* r202: HUD moved into the 480-round safe square ([84,396]); pipe/flap
   physics and the full-bleed render canvas are unchanged. */
Text({ parent: root, text: 'FLAPDOT', style: { position: 'absolute', x: 84, y: 80, fontSize: 14, color: '#40D8B0', borderRadius: 0 } });
Text({ parent: root, text: function () { return 'SCORE ' + (scoreSig() || 0); },
  style: { position: 'absolute', x: 188, y: 80, width: 112, height: 20, fontSize: 14, color: '#F2F7FB', textAlign: 'center', borderRadius: 0 } });
Text({ parent: root, text: function () { return bestSig() > 0 ? 'BEST ' + bestSig() : 'BEST -'; },
  style: { position: 'absolute', x: 296, y: 80, width: 100, height: 20, fontSize: 14, color: '#9EB3C6', textAlign: 'right', borderRadius: 0 } });
Text({ parent: root, text: function () { return noteSig() || noteText(); },
  style: { position: 'absolute', x: 84, y: 104, width: 312, height: 20, fontSize: 13, color: '#FFD78E', borderRadius: 0 } });

/* ---- input -------------------------------------------------------------- */
var ROOT_ID = 1;
function tap() {
  var was = state.phase;
  state = flapTap(state);
  if (was === 'dead') { bestSig.set(flapBest()); painted = false; logEvent('restart'); }
  else if (was === 'ready') { painted = false; logEvent('start'); }
  sync();
}
lume.gesture.on(root, 'tap', tap);

/* ---- tick --------------------------------------------------------------- */
/* Frame gating (r185): the browser visual budget counts every canvas draw
 * message cumulatively (tools/lume/check.js:203), so the app must not paint
 * every logic tick. Policy:
 *  - 'run': full 30 fps paint; physics, pipes, dashes and bird rendering are
 *    unchanged, so gameplay feel is untouched.
 *  - 'ready'/'dead': 5 fps bob (one paint per 6 ticks on device). The world is
 *    frozen there, so onDraw publishes only the bird box (see below) and the
 *    idle bird is one native circle opcode instead of 19 span fillRects. */
var DRAW_SKIP = 6;                         /* publish every 6th idle tick */
var paintGate = 0;
function shouldPaint(st) {
  if (st.phase === 'run') return true;
  paintGate = (paintGate + 1) % DRAW_SKIP;
  return paintGate === 1;                  /* first idle tick of each cycle paints */
}
var lastScore = 0;
function tick() {
  var before = state.phase;
  flapStep(state, DT);
  if (state.phase !== before) {
    painted = false;
    if (state.phase === 'dead') {
      logEvent('dead ' + state.hit + ' score=' + state.score);
      flapSaveBest(state.score);
      bestSig.set(flapBest());
    }
  }
  if (state.score !== lastScore) lastScore = state.score;
  if (shouldPaint(state)) sync();
}
lume.app.onPause(function () {});
lume.app.onResume(function () { painted = false; sync(); });
lume.system.setInterval(tick, 33);
bestSig.set(flapBest());
logEvent('seed=' + SEED);
sync();
