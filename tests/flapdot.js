/*
 * r102 host harness for examples/flapdot — one-tap arcade flyer.
 *
 *   node tests/flapdot.js
 *
 * Honesty scope: host-only. The course is hash-deterministic (pipe i geometry
 * comes from a seeded PRNG of the index), so the whole run is replayable on
 * the host; the device touch path is exercised through the real prelude's
 * gesture pipeline, not on hardware. The render replay pins the dirty-band
 * budget (pipes band + ground strip + bird box; HUD is native Text).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/flapdot/app.js', 'utf8');

/* ---- 0. no decorative Unicode in UI strings (firmware font, r64) -------- */
{
  const ui = source.split('/* GAME UI */')[1];
  const strings = ui.match(/'[^'\n]*'/g) || [];
  for (const s of strings) {
    const body = s.slice(1, -1);
    assert.ok(/^[\x20-\x7E]*$/.test(body), `UI string is ASCII-only: ${body}`);
  }
  console.log('PASS flapdot UI strings are ASCII-only (r64 font rule)');
}

/* ---- pure logic in a bare vm context (split at the GAME UI marker) ------ */
function logic() {
  const src = source.split('/* GAME UI */')[0];
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  return ctx;
}
const g = logic();
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ---- 1. pipe geometry: deterministic, gaps sane, ramp continuous -------- */
{
  for (let i = 0; i < 40; i++) {
    const a = plain(g.pipeGeom(i)), b = plain(g.pipeGeom(i));
    assert.deepEqual(a, b, 'pipe ' + i + ' deterministic');
    assert.ok(a.top >= g.MARGIN, 'gap top >= margin');
    assert.ok(a.bottom <= g.FH - g.GROUND_H - g.MARGIN + 1, 'gap bottom inside');
    assert.ok(a.gap >= g.GAP_MIN, 'gap >= floor: ' + a.gap);
    assert.ok(a.gap <= g.GAP_START, 'gap <= start: ' + a.gap);
    /* gap bottom == top + gap (no drift) */
    assert.equal(a.bottom, a.top + a.gap, 'bottom = top + gap');
  }
  /* ramp shrinks exactly every GAP_EVERY pipes and never jumps inside a step */
  const widths = [];
  for (let i = 0; i < 30; i++) widths.push(g.pipeGeom(i).gap);
  for (let i = 1; i < widths.length; i++) {
    const d = widths[i - 1] - widths[i];
    assert.ok(d === 0 || Math.abs(d - g.GAP_STEP) < 1e-9, 'ramp is stepwise-continuous at ' + i + ': ' + d);
  }
  /* reaches the GAP_MIN floor exactly at pipe ceil((START-MIN)/STEP)*EVERY,
   * then stays flat */
  const floorAt = Math.ceil((g.GAP_START - g.GAP_MIN) / g.GAP_STEP) * g.GAP_EVERY;
  assert.equal(widths[floorAt], g.GAP_MIN, 'floor reached at pipe ' + floorAt + ': ' + widths[floorAt]);
  assert.ok(widths[floorAt - 1] > g.GAP_MIN, 'still above the floor one pipe earlier');
  for (let i = floorAt; i < widths.length; i++) assert.equal(widths[i], g.GAP_MIN, 'flat at floor from pipe ' + floorAt);
  console.log('PASS flapdot pipe geometry deterministic, gaps sane, ramp stepwise');
}

/* ---- 2. pipeRange/pipeX: window matches geometry, no negatives ---------- */
{
  for (const s of [0, 100, 500, 1234, 9999]) {
    const r = g.pipeRange(s);
    assert.ok(r.lo >= 0, 'lo >= 0');
    /* every pipe whose band intersects the screen is inside the window */
    for (let i = 0; i < 60; i++) {
      const x = g.pipeX(i, s);
      if (x + g.PIPE_W > 0 && x < g.FW) assert.ok(i >= r.lo && i <= r.hi, 'pipe ' + i + ' in window at s=' + s);
    }
    /* window starts at the first pipe still (partially) on screen */
    assert.ok(g.pipeX(r.lo, s) + g.PIPE_W > 0, 'lo does not skip a pipe still visible at s=' + s);
  }
  console.log('PASS flapdot pipe window covers exactly the visible pipes');
}

/* ---- 3. scoring: pipe count when its right edge passes the bird --------- */
{
  assert.equal(g.flapScore(0), 0, 'no score at start');
  /* pipe 0 right edge at world x PIPE_W; passes BIRD_X when s > PIPE_W + PIPE0 - BIRD_X... direct: */
  const sPass = g.PIPE0 + g.PIPE_W - g.BIRD_X + 1;
  assert.equal(g.flapScore(sPass), 1, 'one pipe scored after passing');
  assert.equal(g.flapScore(sPass - 2), 0, 'not scored while still overlapping');
  const sTwo = g.PIPE0 + g.PIPE_EVERY + g.PIPE_W - g.BIRD_X + 1;
  assert.equal(g.flapScore(sTwo), 2, 'two pipes scored');
  console.log('PASS flapdot scoring gate at pipe right edge');
}

/* ---- 4. collision: pipe box, ground, forgiving top clamp ---------------- */
{
  const s = g.PIPE0 - g.BIRD_X + g.PIPE_W / 2;    /* pipe 0 covers the bird column (x=92) */
  const geo = g.pipeGeom(0);
  const x0 = g.pipeX(0, s);
  assert.ok(x0 >= 0 && x0 + g.PIPE_W <= g.FW + 1, 'pipe 0 on screen');
  /* dead centre of the gap -> alive */
  assert.equal(g.flapDead(geo.top + geo.gap / 2, s), '', 'through the gap = alive');
  /* inside the top pipe -> pipe */
  assert.equal(g.flapDead(geo.top - 20, s), 'pipe', 'top pipe kills');
  /* inside the bottom pipe -> pipe */
  assert.equal(g.flapDead(geo.bottom + 20, s), 'pipe', 'bottom pipe kills');
  /* just at the gap edge (rim overlaps half a radius) -> pipe */
  assert.equal(g.flapDead(geo.top + 4, s), 'pipe', 'gap rim kills');
  /* ground */
  assert.equal(g.flapDead(g.FH - g.GROUND_H - 4, 0), 'ground', 'ground kills');
  /* high above the pipes with no pipe at the bird column -> alive (top clamp) */
  assert.equal(g.flapDead(20, 0), '', 'top strip is forgiving when no pipe');
  console.log('PASS flapdot collision: pipes/ground kill, gap passes, top clamps');
}

/* ---- 5. physics: gravity, flap impulse, terminal velocity ---------------- */
{
  const st = g.flapState();
  st.phase = 'run';
  g.flapFlap(st);
  assert.equal(st.vy, g.FLAP_VY, 'flap sets upward velocity');
  g.flapStep(st, g.DT);
  assert.ok(st.vy > g.FLAP_VY, 'gravity reduces upward velocity');
  assert.ok(st.s > 0, 'world scrolled');
  /* terminal velocity: free fall from the ceiling converges at MAX_FALL
   * (a drop from mid-screen hits the ground in ~14 ticks, before terminal) */
  const free = g.flapState();
  free.phase = 'run';
  free.y = g.BIRD_R + 1;
  let maxVy = 0;
  for (let i = 0; i < 300 && free.phase === 'run'; i++) {
    g.flapStep(free, g.DT);
    maxVy = Math.max(maxVy, free.vy);
  }
  assert.equal(free.phase, 'dead', 'long free fall hits the ground');
  assert.ok(Math.abs(maxVy - g.MAX_FALL) < 2, 'terminal velocity reached: ' + maxVy);
  /* finite: no NaN after long run with flaps every few ticks */
  const chaos = g.flapState();
  chaos.phase = 'run';
  for (let i = 0; i < 3000; i++) {
    if (i % 17 === 0) g.flapFlap(chaos);
    if (chaos.phase === 'dead') break;
    g.flapStep(chaos, g.DT);
  }
  assert.ok(Number.isFinite(chaos.y) && Number.isFinite(chaos.s), 'finite after 3000 steps');
  console.log('PASS flapdot physics: gravity/flap/terminal, no NaN');
}

/* ---- 6. state machine: ready -> run -> dead -> restart, score persists --- */
{
  const st = g.flapState();
  assert.equal(st.phase, 'ready', 'boots to ready');
  g.flapStep(st, 1);            /* ready bob does not scroll or die */
  assert.equal(st.phase, 'ready');
  assert.equal(st.s, 0, 'ready does not scroll');
  let ns = g.flapTap(st);
  assert.equal(ns.phase, 'run', 'tap starts run');
  assert.equal(ns.vy, g.FLAP_VY, 'first tap is also a flap');
  /* die: fly past pipe 0 with the held-centre policy, then free fall.
   * (idle free fall from mid-screen dies at score 0 in ~14 ticks) */
  let guard = 0;
  while (ns.phase === 'run' && ns.score < 1 && guard++ < 600) {
    const np = g.flapNextPipe(ns.s);
    const ng = g.pipeGeom(np);
    const target = ng.top + ng.gap / 2;
    if (ns.y > target + 6 && ns.vy > -40) g.flapFlap(ns);
    g.flapStep(ns, g.DT);
  }
  for (let i = 0; i < 300 && ns.phase === 'run'; i++) g.flapStep(ns, g.DT);
  assert.equal(ns.phase, 'dead', 'run ends in death');
  assert.ok(ns.hit === 'ground' || ns.hit === 'pipe', 'hit reason recorded: ' + ns.hit);
  const score = ns.score;
  assert.ok(score > 0, 'score survived to death: ' + score);
  /* restart resets the world but the caller keeps the old score object */
  const fresh = g.flapTap(ns);
  assert.equal(fresh.phase, 'run', 'tap on dead restarts');
  assert.equal(fresh.score, 0, 'fresh run score is 0');
  assert.ok(fresh.s < ns.s, 'world scrolled back');
  /* tap while running just flaps */
  const mid = g.flapState(); mid.phase = 'run'; mid.vy = 100;
  g.flapTap(mid);
  assert.equal(mid.vy, g.FLAP_VY, 'run tap only flaps, no reset');
  console.log('PASS flapdot state machine ready/run/dead/restart');
}

/* ---- 7. full run is winnable: scripted flap policy survives 20 pipes ----- */
{
  const st = g.flapState();
  st.phase = 'run';
  g.flapFlap(st);
  let guard = 0;
  while (st.phase === 'run' && guard++ < 6000) {
    /* hold-centre policy: aim for the middle of the next gap; flap early
     * enough (vy gate) that the bird can still arrest in a narrow gap */
    const i = g.flapNextPipe(st.s);
    const geo = g.pipeGeom(i);
    const target = geo.top + geo.gap / 2;
    if (st.y > target + 8 && st.vy > -150) g.flapFlap(st);
    g.flapStep(st, g.DT);
  }
  assert.ok(st.phase !== 'dead' || st.score >= 20, 'policy survives: died at ' + st.score);
  assert.ok(st.score >= 20, 'policy cleared 20 pipes, got ' + st.score);
  console.log('PASS flapdot course winnable: scripted policy cleared ' + st.score + ' pipes');
}

/* ---- device render path: real prelude, real draw stream ---------------- */
const logs = [];
const ui = runApp(source, {
  filename: 'examples/flapdot/app.js',
  kv: { set: () => 0, get: () => null, remove: () => 0, keys: () => [], clear: () => 0 },
  onLog: s => logs.push(s),
});
const c = ui.ctx;
const ROOT_ID = 1;

/* 8. boots to ready, HUD published, first paint is a full canvas */
{
  assert.equal(c.state.phase, 'ready', 'boots to ready');
  assert.ok(logs.some(s => s.includes('FLAP seed=')), 'boot log: ' + logs[0]);
  const texts = ui.messages.filter(m => m[0] === 'attr').length;
  assert.ok(texts > 0, 'HUD text attrs emitted');
  const invs = ui.messages.filter(m => m[0] === 'invalidate');
  assert.ok(invs.length >= 1, 'at least the first paint');
  const [, , x, y, w, h] = invs[0];
  assert.deepEqual([x, y, w, h], [0, 0, g.FW, g.FH], 'first paint invalidates the whole canvas');
  console.log('PASS flapdot boots in ready mode with HUD and full first paint');
}

/* 9. tap starts the run through the real gesture pipeline; bird rises */
{
  const y0 = c.state.y;
  ui.gesture(ROOT_ID, 0, 240, 240, 10);           /* DOWN */
  ui.gesture(ROOT_ID, 2, 240, 240, 30);           /* UP quickly -> tap */
  assert.equal(c.state.phase, 'run', 'tap started the run');
  assert.equal(c.state.vy, g.FLAP_VY, 'first tap flapped');
  c.tick();
  assert.ok(c.state.s > 0, 'world scrolled after tick');
  const y1 = c.state.y;
  assert.ok(y1 < y0 + 5, 'bird rose or nearly held after flap: ' + y0 + ' -> ' + y1);
  console.log('PASS flapdot tap -> run through the gesture pipeline');
}

/* 10. raster budget: steady-state paints stay inside the canvas and below it.
 * (ready->run phase changes intentionally do a full repaint; measure a run
 * window with no phase transition instead) */
{
  const draws = ui.messages.filter(m => m[0] === 'draw');
  assert.ok(draws.length > 0, 'draw ops exist');
  const boot = ui.messages.filter(m => m[0] === 'invalidate')[0];
  assert.deepEqual([boot[2], boot[3], boot[4], boot[5]], [0, 0, g.FW, g.FH], 'first paint is full canvas');
  const total = g.FW * g.FH;
  const mark = ui.messages.length;
  const phaseBefore = c.state.phase;
  for (let i = 0; i < 8; i++) c.tick();
  assert.equal(c.state.phase, phaseBefore, 'steady window has no phase change');
  const invs = ui.messages.slice(mark).filter(m => m[0] === 'invalidate');
  assert.ok(invs.length >= 2, 'incremental paints exist: ' + invs.length);
  let maxInc = 0;
  for (const m of invs) {
    const [, , x, y, w, h] = m;
    assert.ok(x >= 0 && y >= 0, 'rect origin >= 0');
    assert.ok(x + w <= g.FW && y + h <= g.FH, 'rect inside canvas');
    assert.ok(w >= 1 && h >= 1, 'rect non-empty');
    maxInc = Math.max(maxInc, w * h);
  }
  assert.ok(maxInc < total, 'no full repaint in steady state (max incremental ' + maxInc + ' < ' + total + ')');
  /* one canvas of 480x400 = 192,000 px < 230,400 budget */
  assert.ok(total <= 230400, 'canvas within pixel budget');
  console.log('PASS flapdot dirty-band discipline + canvas pixel budget (max inc ' + maxInc + ' px)');
}

/* 11. death is reachable through the real prelude: fly past a few pipes with
 * the held-centre policy, then stop flapping and fall to the death screen */
{
  let guard = 0;
  while (c.state.phase === 'run' && guard++ < 1200) {
    if (c.state.score < 5) {
      const geo = g.pipeGeom(g.flapNextPipe(c.state.s));
      const target = geo.top + geo.gap / 2;
      if (c.state.y > target + 6) {
        ui.gesture(ROOT_ID, 0, 240, 240, 10);
        ui.gesture(ROOT_ID, 2, 240, 240, 30);
      }
    }
    c.tick();
  }
  assert.equal(c.state.phase, 'dead', 'idle run dies (no flaps after score 5)');
  assert.ok(c.state.score > 0, 'score counted before death');
  assert.ok(logs.some(s => s.includes('dead')), 'death logged');
  ui.gesture(ROOT_ID, 0, 240, 240, 10);
  ui.gesture(ROOT_ID, 2, 240, 240, 30);
  assert.equal(c.state.phase, 'run', 'tap after death restarts');
  assert.equal(c.state.score, 0, 'restart clears score');
  console.log('PASS flapdot death + restart through the real prelude');
}

/* 12. 60 s smoke: flapping every ~0.5 s, no exceptions, budget holds */
{
  const before = ui.messages.length;
  let flapClock = 0;
  for (let t = 0; t < 1800; t++) {          /* 1800 ticks x 33 ms = ~59.4 s */
    if (flapClock++ >= 15) { flapClock = 0; ui.gesture(ROOT_ID, 0, 240, 240, 10); ui.gesture(ROOT_ID, 2, 240, 240, 30); }
    c.tick();
  }
  const draws = ui.messages.slice(before).filter(m => m[0] === 'draw');
  const invs = ui.messages.slice(before).filter(m => m[0] === 'invalidate');
  assert.ok(draws.length > 1000, 'smoke produced draw traffic: ' + draws.length);
  const total = g.FW * g.FH;
  for (const m of invs) {
    const [, , x, y, w, h] = m;
    assert.ok(x + w <= g.FW && y + h <= g.FH, 'smoke invalidate inside canvas');
    assert.ok(w * h <= total, 'smoke invalidate within budget');
  }
  assert.ok(Number.isFinite(c.state.y) && Number.isFinite(c.state.s), 'smoke state finite');
  console.log('PASS flapdot 60 s smoke (draws=' + draws.length + ', paints=' + invs.length + ', phase=' + c.state.phase + ', score=' + c.state.score + ')');
}

console.log('ALL flapdot harness checks passed');
