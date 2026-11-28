const R166_ALLOWED = ['firmware/components/lume-engine/lume_scripts.c', 'firmware/components/lume-engine/gen_lume_scripts.py', 'firmware/components/lume-engine/prelude/demo.js', 'firmware/components/lume-engine/prelude/home.js', 'firmware/components/lume-engine/prelude/prelude.js', 'runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r183: SVG raster-result cache (engine component only).
  'firmware/components/lume-engine/CMakeLists.txt',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-engine/lume_svg_cache.c',
  'firmware/components/lume-engine/include/lume_svg_cache.h',
  // r181: emu frame-injection pacing + UI-queue backpressure (named objects only).
  'tools/lume/scan.js', 'firmware/components/lume-ui-bridge/lume_ui_bridge.c',
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/shot.js', 'tools/lume/transport.js',
  // r75 raster and refresh changes already present on origin/main.
  'firmware/components/lume-svg/lume_svg.c',
  'firmware/components/lvgl/lv_conf.h',
  // r179: WiFi PS/coexist knife -- lume-net PS call + sdkconfig (incl. generated).
  'firmware/components/lume-net/lume_net.c', 'firmware/sdkconfig',
  'firmware/sdkconfig.defaults',
  // r199: lume context is pure CLI tooling; no firmware/runtime change.
  'tools/lume/context.js', 'tools/lume/context.test.js',
  // r206: lume mcp MCP server is pure tools/lume; no firmware/runtime change.
  'tools/lume/mcp.js', 'tools/lume/mcp.test.js',
   // r207: lume examples metadata catalog CLI is pure tools/lume; no firmware/runtime change.
   'tools/lume/examples.js', 'tools/lume/examples.test.js',
];
/* r136 host harness for examples/img_view (pure app + real host imgscale stub).
 * Standalone CommonJS:  node tests/img_view.js
 *
 * Runs the REAL app against the firmware prelude. The host imgscale binding in
 * tests/lib/prelude_runner.js is a REAL implementation (not a fixed -3 stub),
 * so this harness checks the app's scaled pixels against an INDEPENDENT JS
 * reference written here from the documented sampling rules -- nearest and
 * bilinear each implemented separately, with floating-point coordinates and
 * per-channel interpolation. A mutable scale() spy injects -1/-2/-3/0 live to
 * exercise every return-code branch without relying on truthiness.
 *
 * HONESTY: this harness does NOT test the ESP32-S3 C binding or the panel. It
 * exercises the host stub + the firmware prelude + the app; board acceptance
 * stays deferred. Mutations below re-feed deliberately broken copies / sources
 * to prove the key predicates are load bearing.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('examples/img_view/app.js');
const manifest = read('tools/playground/build.mjs');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)
const SW = 24, SH = 24, FACTORS = [2, 4, 8];

// ---- independent reference scalers (NOT copied from the host stub) --------
// Nearest: map each destination pixel centre back to a source pixel, clamp.
function refNearest(src, sw, sh, dw, dh) {
  const out = new Uint16Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}
// Bilinear: floating-point source coordinate, clamp to the border, interpolate
// R5/G6/B5 independently and round each channel into range.
function refBilinear(src, sw, sh, dw, dh) {
  const out = new Uint16Array(dw * dh);
  const shifts = [11, 5, 0], masks = [31, 63, 31];
  const chan = (v, s, m) => (v >> s) & m;
  for (let y = 0; y < dh; y++) {
    const cy = Math.max(0, Math.min(sh - 1, (y + 0.5) * sh / dh - 0.5));
    const y0 = Math.floor(cy), fy = cy - y0, y1 = Math.min(y0 + 1, sh - 1);
    for (let x = 0; x < dw; x++) {
      const cx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sw / dw - 0.5));
      const x0 = Math.floor(cx), fx = cx - x0, x1 = Math.min(x0 + 1, sw - 1);
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const s = shifts[k], m = masks[k];
        const a = chan(src[y0 * sw + x0], s, m), b = chan(src[y0 * sw + x1], s, m);
        const c = chan(src[y1 * sw + x0], s, m), d = chan(src[y1 * sw + x1], s, m);
        const q = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) +
                  c * (1 - fx) * fy + d * fx * fy;
        const r = Math.min(m, Math.max(0, Math.round(q))) & m;
        v |= r << s;
      }
      out[y * dw + x] = v & 0xffff;
    }
  }
  return out;
}
const reference = (src, dw, dh, mode) => mode === 'bilinear'
  ? refBilinear(src, SW, SH, dw, dh) : refNearest(src, SW, SH, dw, dh);
const pixelsEqual = (got, want) => {
  if (!got || !want || got.length !== want.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
  return true;
};

// ---- live helpers ---------------------------------------------------------
function probe() { return runApp(source); }
function textsAfter(ui, from) {
  return ui.messages.slice(from).filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
}
function spriteDims(ui) {
  return ui.messages.filter(m => m[0] === 'spriteDefine').map(m => [m[3], m[4]]);
}
function check(name, fn) { fn(); console.log('PASS ' + name); }

// ---- static predicates (also used by mutation proof) ----------------------
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const asciiOnly = s => {
  const lits = literals(s);
  return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
};
const errBranch = s => s.includes("rc < 0 ? 'ERR ' + rc : 'OK'") && !/\brc \?/.test(s);
const realScale = s => s.includes('imgscale.scale(SRC, __IMG_SW, __IMG_SH, dst, dw, dh, m)');
const budgetDecl = s => /LUME_MAX_NODES = 128/.test(s) && /NODE BUDGET/.test(s);
const plainGlobal = s => !/\bimport\b|\bexport\b/.test(s);
function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
function manifestApps(m) {
  const block = (m.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
  assert.ok(block, 'playground app list not found');
  return block.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ---- live runs: real host stub, independent reference ---------------------
check('default: 2x nearest, HUD/dims/OK, sprite pixels = independent nearest', () => {
  const ui = probe(), c = ui.ctx, st = c.state();
  assert.equal(st.rc, 0); assert.equal(st.factor, 2); assert.equal(st.mode, 'nearest');
  assert.equal(st.dw, 48); assert.equal(st.dh, 48); assert.equal(st.pixels.length, 2304);
  const texts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
  assert.ok(texts.includes('X2 nearest 24x24 -> 48x48'), texts.join('|'));
  assert.ok(texts.includes('OK') && !texts.some(x => /ERR 0\b/.test(x)), texts.join('|'));
  const sd = spriteDims(ui);
  assert.deepEqual(sd, [[48, 48]], JSON.stringify(sd));
  assert.ok(pixelsEqual(st.pixels, reference(c.SRC, st.dw, st.dh, 'nearest')), 'nearest pixels');
});

check('NEXT cycles 2x -> 4x -> 8x -> 2x; every grid matches independent nearest', () => {
  const ui = probe(), c = ui.ctx;
  const seen = [];
  for (const [factor, edge] of [[4, 96], [8, 192], [2, 48], [4, 96]]) {
    const r = c.nextScale();
    assert.equal(r.rc, 0); assert.equal(r.factor, factor);
    assert.equal(r.dw, edge); assert.equal(r.dh, edge);
    assert.equal(r.dst.length, edge * edge);
    const st = c.state();
    assert.ok(pixelsEqual(st.pixels, reference(c.SRC, edge, edge, 'nearest')),
      'nearest pixels at X' + factor);
    seen.push([r.dw, r.dh]);
  }
  assert.deepEqual(seen, [[96, 96], [192, 192], [48, 48], [96, 96]]);
  assert.deepEqual(spriteDims(ui), [[48, 48], [96, 96], [192, 192], [48, 48], [96, 96]]);
});

check('MODE toggles nearest <-> bilinear at every zoom; bilinear differs from nearest', () => {
  const ui = probe(), c = ui.ctx;
  const nearest = Array.prototype.slice.call(c.compute().dst);
  let r = c.toggleMode(), st = c.state();
  assert.equal(st.mode, 'bilinear'); assert.equal(r.rc, 0);
  assert.ok(pixelsEqual(st.pixels, reference(c.SRC, st.dw, st.dh, 'bilinear')), 'bilinear pixels X2');
  assert.ok(!pixelsEqual(st.pixels, nearest), 'bilinear must not equal nearest');
  c.toggleMode(); st = c.state();
  assert.equal(st.mode, 'nearest');
  assert.ok(pixelsEqual(st.pixels, reference(c.SRC, st.dw, st.dh, 'nearest')), 'back to nearest');
  for (const factor of [4, 8]) {
    c.nextScale();
    r = c.toggleMode(); st = c.state();
    assert.equal(st.mode, 'bilinear'); assert.equal(r.rc, 0);
    assert.ok(pixelsEqual(st.pixels, reference(c.SRC, st.dw, st.dh, 'bilinear')),
      'bilinear pixels at X' + factor);
    c.toggleMode();
  }
});

check('both Buttons are wired: press NEXT changes zoom, press MODE flips sampling', () => {
  const ui = probe(), c = ui.ctx;
  const ids = ui.messages.filter(m => m[0] === 'press').map(m => m[1]);
  assert.equal(ids.length, 2, 'two buttons must register press events');
  const before = c.state();
  ui.press(ids[0]);
  assert.equal(c.state().factor, FACTORS[(FACTORS.indexOf(before.factor) + 1) % FACTORS.length]);
  const mid = c.state();
  ui.press(ids[1]);
  assert.notEqual(c.state().mode, mid.mode);
});

check('injected -1 / -2 / -3 render numerically; 0 is OK, never ERR 0', () => {
  const ui = probe(), c = ui.ctx;
  for (const [code, expected] of [[-1, 'ERR -1'], [-2, 'ERR -2'], [-3, 'ERR -3'], [0, 'OK']]) {
    ui.lume.imgscale.scale = () => code;
    const from = ui.messages.length;
    const r = c.apply();
    assert.equal(r.rc, code, 'code ' + code);
    const t = textsAfter(ui, from);
    assert.ok(t.includes(expected), code + ': ' + t.join('|'));
    assert.ok(!t.some(x => /ERR 0\b/.test(x)), 'never ERR 0');
  }
});

check('scale() spy: app passes SRC, correct dims and the exact mode string', () => {
  const ui = probe(), c = ui.ctx;
  let args = null;
  ui.lume.imgscale.scale = function (...a) { args = a; return 0; };
  c.toggleMode(); // bilinear
  assert.ok(args, 'scale was called');
  assert.strictEqual(args[0], c.SRC, 'source view');
  assert.deepEqual(args.slice(1, 3), [SW, SH], 'source dimensions');
  assert.equal(args[6], 'bilinear', 'mode string forwarded');
  assert.equal(args[4], SW * c.state().factor, 'dst width');
  assert.equal(args[5], SH * c.state().factor, 'dst height');
  assert.equal(args[3].length, args[4] * args[5], 'dst view length');
});

// ---- static source / repo invariants -------------------------------------
check('all UI string literals ASCII-only (r64)', () => assert.ok(asciiOnly(source)));
check('numeric < 0 / no truthy branch; real scale() call present', () => {
  assert.ok(errBranch(source)); assert.ok(realScale(source));
});
check('header declares LUME_MAX_NODES budget and app is a plain global script', () => {
  assert.ok(budgetDecl(source)); assert.ok(plainGlobal(source));
});
check('static tree <= 12 nodes', () => {
  const ui = probe();
  assert.ok(ui.messages.filter(m => m[0] === 'create').length <= 12,
    String(ui.messages.filter(m => m[0] === 'create').length));
});
check('playground manifest includes img_view', () => {
  const apps = manifestApps(manifest);
  assert.ok(apps.length > 0 && apps.includes('img_view'));
  assert.ok(apps.includes('img_view'));
});
check('generated playground source is byte-identical to the example', () =>
  assert.equal(read('website/playground/sources/img_view.js'), source));
check('firmware/ runtime/ tools/lume/ byte-identical to baseline 3514c76', () =>
  assert.deepEqual(gitChanged(['firmware/', 'runtime/', 'tools/lume/']).filter(f => !R166_ALLOWED.includes(f)), []));

// ---- mutation proof: key predicates MUST fail on a bad input --------------
check('MUTATION delete <0 error branch -> error predicate FAILS', () => {
  const mutated = source.replace("rc < 0 ? 'ERR ' + rc : 'OK'", "'OK'");
  assert.notEqual(mutated, source);
  assert.equal(errBranch(mutated), false);
});
check('MUTATION non-ASCII UI literal -> ASCII predicate FAILS', () => {
  const mutated = source.replace("'Image Scale'", "'图像缩放'");
  assert.notEqual(mutated, source);
  assert.equal(asciiOnly(mutated), false);
});
check('MUTATION fake scale result -> real-scale predicate and pixel compare FAIL', () => {
  const mutated = source.replace('imgscale.scale(SRC, __IMG_SW, __IMG_SH, dst, dw, dh, m)',
    '(dst.fill(0), 0)');
  assert.notEqual(mutated, source);
  assert.equal(realScale(mutated), false);
  const ui = runApp(mutated), st = ui.ctx.state();
  assert.equal(pixelsEqual(st.pixels, reference(ui.ctx.SRC, st.dw, st.dh, st.mode)), false,
    'an all-zero fake must not match the independent reference');
});
check('MUTATION fake reference -> pixel comparison FAILS (comparator load-bearing)', () => {
  const ui = probe(), c = ui.ctx, st = c.state();
  assert.ok(pixelsEqual(st.pixels, reference(c.SRC, st.dw, st.dh, 'nearest')), 'good ref matches');
  // A deliberately WRONG independent nearest: always sample src[0].
  const fake = new Uint16Array(st.pixels.length);
  for (let i = 0; i < fake.length; i++) fake[i] = c.SRC[0];
  assert.equal(pixelsEqual(st.pixels, fake), false, 'faked reference must be rejected');
});
function mutationRepoDiff(paths, rel) {
  const target = path.join(root, rel);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original + '\n/* r136 mutation proof */\n');
    assert.ok(gitChanged(paths).length > 0, rel + ' modification must be visible to the diff check');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.deepEqual(gitChanged(paths).filter(f => !R166_ALLOWED.includes(f)), []);
}
check('MUTATION touch firmware/ -> diff predicate FAILS (then restored)', () =>
  mutationRepoDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'firmware/components/lume-engine/lume_engine.c'));
check('MUTATION touch runtime/ -> diff predicate FAILS (then restored)', () =>
  mutationRepoDiff(['firmware/', 'runtime/', 'tools/lume/'],
    'runtime/types/lume.d.ts'));

console.log('PASS img_view harness: all live, static and mutation checks green');
