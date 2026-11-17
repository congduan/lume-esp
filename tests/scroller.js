/*
 * r83 host harness for examples/scroller (camera scroll + retained-sprite blit).
 *
 *   node tests/scroller.js
 *
 * Logic half runs in a bare vm (split at the GAME UI marker), like tests/invaders.
 * Integration half runs the real prelude via tests/lib/prelude_runner.js and
 * asserts the r81 upload path is idempotent: 8 spriteDefine messages, never
 * re-uploaded per frame, and no fillRect ('draw') messages for sprites.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const APP = fs.readFileSync('examples/scroller/app.js', 'utf8');

function logic() {
  const ctx = vm.createContext({});
  vm.runInContext(APP.split('/* GAME UI */')[0], ctx);
  ctx.lume = { storage: { kv: { get: () => null, set: () => 0 } } };
  return ctx;
}
const a = logic();
const W = 480, H = 352;

// 1. camera advances by CAM_STEP per tick; dash doubles it for 20 ticks
{
  const s = a.scrollState();
  a.scrollStep(s, null);
  assert.equal(s.cam, 3);
  a.scrollStep(s, { dash: true });
  assert.equal(s.cam, 9, 'dash tick advances 6');
  assert.equal(s.dash, 19);
  assert.equal(s.crouch, true);
  for (let i = 0; i < 19; i++) a.scrollStep(s, null);
  assert.equal(s.dash, 0);
  assert.equal(s.crouch, false);
  console.log('PASS scroller camera advance + 20-tick dash/crouch');
}

// 2. jump: impulse on ground only, gravity brings the runner back
{
  const s = a.scrollState();
  a.scrollStep(s, { jump: true });
  assert.equal(s.onGround, false);
  assert.equal(s.vy, a.JUMP_V + a.GRAV);
  assert.ok(s.heroY < a.GROUND_Y - a.HERO_H);
  assert.ok(s.events.includes('JUMP'));
  let landed = false;
  for (let i = 0; i < 60; i++) { a.scrollStep(s, null); if (s.onGround) { landed = true; break; } }
  assert.ok(landed, 'runner lands after jump');
  assert.equal(s.heroY, a.GROUND_Y - a.HERO_H);
  console.log('PASS scroller jump impulse + gravity landing');
}

// 3. coin pickup is one-shot and adds score
{
  const s = a.scrollState();
  s.cam = 160; s.heroY = 208; s.vy = 0; s.onGround = false;
  const ev = a.scrollStep(s, null);
  assert.equal(ev, 'coin');
  assert.equal(s.coins, 1);
  assert.ok(s.events.some(e => e === 'COIN coins=1'));
  const ev2 = a.scrollStep(s, null);
  assert.notEqual(ev2, 'coin', 'same coin not collected twice');
  assert.equal(s.coins, 1);
  console.log('PASS scroller one-shot coin pickup + score');
}

// 4. spike hit costs a life and grants invulnerability; second hit suppressed
{
  const s = a.scrollState();
  s.cam = 190; // hero world x 238..254 overlaps spike at 240
  assert.ok(a.overlap(a.heroWorldBox(s), a.spikeBox(a.WORLD.spikes[0])));
  const ev = a.scrollStep(s, null);
  assert.equal(ev, 'hit');
  assert.equal(s.lives, 2);
  assert.ok(s.invuln > 0);
  const lives = s.lives;
  a.scrollStep(s, null);
  assert.equal(s.lives, lives, 'invulnerable tick does not damage again');
  console.log('PASS scroller spike collision + invulnerability window');
}

// 5. game over after lives run out, restart resets state
{
  const s = a.scrollState();
  s.lives = 1; s.cam = 190; s.invuln = 0;
  assert.equal(a.scrollStep(s, null), 'over');
  assert.equal(s.over, true);
  assert.equal(a.scrollStep(s, null), 'idle', 'no motion after over');
  a.scrollRestart(s);
  assert.equal(s.over, false);
  assert.equal(s.lives, 3);
  assert.equal(s.cam, 0);
  assert.equal(s.coins, 0);
  assert.equal(s.heroY, a.GROUND_Y - a.HERO_H);
  assert.ok(s.events.includes('RESTART'));
  console.log('PASS scroller game over + restart reset');
}

// 6. KV hiscore key <= 15 chars, graceful KV failure
{
  let key = null;
  a.lume = { storage: { kv: { get: k => { key = k; return 77; }, set: (k, v) => { key = k; return 0; } } } };
  assert.equal(a.gameHigh('scroller'), 77);
  assert.equal(key, 'hisc.scroller');
  assert.ok(key.length <= 15, `NVS key length ${key.length}`);
  assert.equal(a.gameSave('scroller', 120, 77), 120);
  assert.equal(a.gameSave('scroller', 50, 120), 120);
  a.lume.storage.kv.get = () => { throw Error('offline'); };
  a.lume.storage.kv.set = () => { throw Error('offline'); };
  assert.equal(a.gameHigh('scroller'), 0);
  assert.equal(a.gameSave('scroller', 200, 120), 200);
  console.log('PASS scroller KV hiscore (13-char key) + offline fallback');
}

// 7. sprite spans precomputed once; stable across 120 ticks
{
  assert.equal(a.spanBuilds, 5);
  assert.equal(a.pixelBuilds, 5);
  assert.equal(a.TOTAL_SPANS, 85);
  assert.equal(Object.keys(a.PIXELS).length, 5);
  assert.equal(a.PIXELS.hero.px.length, a.PIXELS.hero.w * a.PIXELS.hero.h);
  const s = a.scrollState();
  for (let i = 0; i < 120; i++) a.scrollStep(s, null);
  assert.equal(a.spanBuilds, 5);
  assert.equal(a.pixelBuilds, 5);
  assert.equal(a.TOTAL_SPANS, 85);
  console.log('PASS scroller sprite spans -> Uint16Array precomputed once');
}

// 8. integration: 8 uploads once, zero fillRect, blits grow, dirty budget held
{
  const ui = runApp(APP);
  const n = kind => ui.messages.filter(m => m[0] === kind).length;
  const defs = () => ui.messages.filter(m => m[0] === 'spriteDefine');
  assert.equal(n('spriteDefine'), 8, 'all 8 slots uploaded at init');
  assert.deepEqual(defs().map(m => m[2]), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const d of defs()) {
    assert.equal(d[3] * d[4], d[5].length, 'Uint16Array length == w*h');
    assert.ok(d[3] >= 1 && d[3] <= 480 && d[4] >= 1 && d[4] <= 480);
  }
  assert.equal(n('draw'), 0, 'sprites never redrawn via per-pixel fillRect');
  const initialDraws = n('spriteDraw');
  assert.ok(initialDraws >= 20, `first frame blits ${initialDraws}`);
  const firstInv = ui.messages.filter(m => m[0] === 'invalidate')[0];
  assert.deepEqual(firstInv.slice(2), [0, 0, W, H], 'first frame repaints whole canvas');
  for (let i = 0; i < 60; i++) {
    ui.ctx.scrollStep(ui.ctx.state, null);
    ui.ctx.frame.set(ui.ctx.frame() + 1);
  }
  assert.equal(n('spriteDefine'), 8, 'NO re-upload across 60 frames');
  assert.equal(ui.ctx.spanBuilds, 5);
  assert.equal(ui.ctx.pixelBuilds, 5);
  assert.ok(n('spriteDraw') > initialDraws + 60 * 20, 'drawImage replayed every frame');
  assert.equal(n('draw'), 0);
  const inv = ui.messages.filter(m => m[0] === 'invalidate').slice(1);
  assert.ok(inv.length <= 8 * 60, 'at most 8 rects per frame');
  const lastFrame = inv.slice(-4);
  const rectCount = lastFrame.length;
  const dirty = lastFrame.reduce((sum, m) => sum + m[4] * m[5], 0);
  assert.ok(rectCount >= 3 && rectCount <= 8, `rect count ${rectCount}`);
  assert.ok(dirty > 0 && dirty < 0.45 * W * H, `steady dirty px ${dirty}`);
  console.log(`PASS scroller integration: 8 uploads (idempotent), ${n('spriteDraw')} blits, 0 fillRect, ${rectCount} rects / ${dirty} px`);
}

// 9. gestures: tap jumps, swipe down dashes; buttons also drive input
{
  const ui = runApp(APP);
  const root = 1;
  ui.gesture(root, 0, 240, 300, 1000);
  ui.gesture(root, 2, 240, 300, 1060);
  assert.equal(ui.ctx.pending.jump, true, 'tap sets jump');
  ui.ctx.tick();
  assert.equal(ui.ctx.state.onGround, false);
  const before = ui.ctx.state.cam;
  ui.gesture(root, 0, 240, 300, 2000);
  ui.gesture(root, 1, 240, 380, 2060);
  ui.gesture(root, 2, 240, 380, 2120);
  assert.equal(ui.ctx.pending.dash, true, 'swipe down sets dash');
  ui.ctx.tick();
  assert.equal(ui.ctx.state.cam - before, 6, 'dash doubles camera step');
  // buttons emit press registrations; both must be present
  const presses = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.equal(presses.length, 2, 'JUMP + DASH buttons registered');
  console.log('PASS scroller tap jump + swipe-down dash + 2 buttons');
}

console.log('ALL SCROLLER HARNESS CASES PASSED');
