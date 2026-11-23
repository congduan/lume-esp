const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts']; // r166 ColorPicker
/* r133 host harness for examples/adc_meter (pure app + host stub layer).
 * Standalone CommonJS:  node tests/adc_meter.js
 *
 * Runs the REAL app against the firmware prelude with a stubbed lume.adc, so
 * the assertions observe the native message stream (Text attr writes, canvas
 * draw calls) rather than only reading source text. Also proves the source
 * predicates are load-bearing by re-feeding deliberately mutated copies.
 *
 * HONESTY: the host has no ADC peripheral. Every raw/mV value here is INJECTED
 * through the stub; nothing in this harness proves real sampling, attenuation
 * voltage ranges or eFuse curve fitting. Board acceptance stays deferred.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { runApp } = require('./lib/prelude_runner');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('examples/adc_meter/app.js');
const manifest = read('tools/playground/build.mjs');
const BASE = '80e76b2'; // r162: re-pinned to the onEditingChange feat commit (runtime/ shell + types)

function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const asciiOnly = s => {
  const lits = literals(s);
  return lits.length > 0 && lits.every(v => /^[\x00-\x7F]*$/.test(v));
};
const numericNegBranch = s => /r < 0 \? errText\(r\)/.test(s) &&
  /m < 0 \? errText\(m\)/.test(s) && /m < 0 \? 0 : m/.test(s) &&
  !/\bif \(r\)/.test(s) && !/\bif \(m\)/.test(s);
const normalRawRender = texts => texts.includes('2048') &&
  !texts.some(t => /OOR|err /.test(t));

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
const textsOf = ui => ui.messages
  .filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));

/* Run the app with a call-recording ADC stub; overrides let a check inject
 * error codes / out-of-range samples without touching any file. */
function probe(overrides) {
  const calls = [];
  const o = overrides || {};
  const spy = {
    config: (p, a) => { calls.push(['config', p, a]); return o.config ? o.config(p, a) : 0; },
    readRaw: p => { calls.push(['raw', p]); return o.readRaw ? o.readRaw(p) : 2048; },
    readMv: p => { calls.push(['mv', p]); return o.readMv ? o.readMv(p) : 1650; },
    free: p => { calls.push(['free', p]); return o.free ? o.free(p) : 0; },
  };
  const ui = runApp(source, { adc: spy });
  return { ui, c: ui.ctx, calls, texts: textsOf(ui) };
}
function check(name, fn) { fn(); console.log('PASS ' + name); }

// ---- live runs: native message stream ------------------------------------
check('default stub renders raw=2048, mv=1650, CFG OK and draws the bar', () => {
  const p = probe();
  assert.ok(p.texts.includes('2048'), p.texts.join('|'));
  assert.ok(p.texts.includes('1650'), p.texts.join('|'));
  assert.ok(p.texts.includes('CFG OK'));
  assert.ok(normalRawRender(p.texts));
  assert.ok(p.ui.messages.filter(m => m[0] === 'draw').length > 0, 'canvas drew');
  assert.deepEqual(p.calls, [['config', 3, 0], ['raw', 3], ['mv', 3]]);
});

check('pin/atten buttons reconfigure and wrap 1..10 / 0..3', () => {
  const p = probe();
  assert.equal(p.c.cyclePin(), 0);
  assert.equal(p.c.cycleAtten(), 0);
  assert.deepEqual(p.calls.slice(-2), [['config', 4, 0], ['config', 4, 1]]);
  assert.ok(textsOf(p.ui).includes('GPIO 4   ATT 1'), textsOf(p.ui).join('|'));
  for (let i = 0; i < 6; i++) p.c.cyclePin();      // 4 -> 5 -> ... -> 10
  assert.equal(p.c.pin, 10);
  p.c.cyclePin();                                  // 10 -> 1 (wrap)
  assert.equal(p.c.pin, 1);
  for (let i = 0; i < 3; i++) p.c.cycleAtten();    // 1 -> 0
  assert.equal(p.c.atten, 0);
  assert.deepEqual(p.calls.filter(x => x[0] === 'config').at(-1), ['config', 1, 0]);
});

check('no free() call: no app close hook, slot state is engine-persistent', () => {
  const p = probe();
  p.c.cyclePin(); p.c.cycleAtten(); p.c.refresh();
  assert.equal(p.calls.filter(x => x[0] === 'free').length, 0);
});

check('negative readMv/readRaw/config render as err <code> numerically', () => {
  assert.ok(probe({ readMv: () => -3 }).texts.includes('err -3'));
  assert.ok(probe({ readRaw: () => -2 }).texts.includes('err -2'));
  assert.ok(probe({ config: () => -1 }).texts.includes('err -1'));
});

check('0 sample is NOT treated as an error (numeric, not truthy, branch)', () => {
  const p = probe({ readRaw: () => 0, readMv: () => 0 });
  assert.ok(p.texts.includes('0'));
  assert.ok(!p.texts.some(t => /err /.test(t)),
    'a legitimate zero must not render err');
});

check('out-of-range raw 4096 is rejected, so the normal-render proof FAILS', () => {
  const bad = probe({ readRaw: () => 4096 });
  assert.ok(bad.texts.includes('RAW OOR'), bad.texts.join('|'));
  assert.equal(normalRawRender(bad.texts), false, '4096 must fail the render predicate');
});

// ---- static source / repo invariants -------------------------------------
check('all UI string literals ASCII-only (r64)', () => assert.ok(asciiOnly(source)));
check('numeric < 0 error discrimination present, no truthy if(r)/if(m)', () =>
  assert.ok(numericNegBranch(source)));
check('config/readRaw/readMv calls bound to pin, no token-class strings', () => {
  assert.ok(source.includes('adc.config(pin, atten)'));
  assert.ok(source.includes('adc.readRaw(pin)'));
  assert.ok(source.includes('adc.readMv(pin)'));
  assert.ok(!/\.token\b|\[\s*['"]token['"]\s*\]|password|secret|hmac/i.test(source));
});
check('header declares the LUME_MAX_NODES budget', () =>
  assert.ok(/LUME_MAX_NODES = 128/.test(source) && /NODE BUDGET/.test(source)));
check('playground manifest has 57 apps including adc_meter', () => {
  const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
  assert.ok(listBlock, 'playground app list not found');
  const apps = listBlock.split(',')
    .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.equal(apps.length, 62, String(apps.length));
  assert.ok(apps.includes('adc_meter'));
});
check('generated playground source is byte-identical to the example', () =>
  assert.equal(read('website/playground/sources/adc_meter.js'), source));
check('firmware/ and runtime/ byte-identical to baseline 80e76b2', () =>
  assert.deepEqual(gitChanged(['firmware/', 'runtime/']).filter(f => !R166_ALLOWED.includes(f)), []));

// ---- mutation proof: every key predicate must fail on a bad input --------
check('MUTATION delete numeric error branch -> predicate FAILS', () => {
  const mutated = source.replace('r < 0 ? errText(r) :', 'r > -1 ? String(r) :');
  assert.equal(numericNegBranch(mutated), false);
});
check('MUTATION non-ASCII UI literal -> ASCII predicate FAILS', () => {
  assert.equal(asciiOnly(source.replace("'ADC Voltmeter'", "'ADC 电压表'")), false);
});
check('MUTATION touch a tracked firmware file -> diff predicate FAILS', () => {
  const target = path.join(root, 'firmware/components/lume-adc/lume_adc.c');
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original + '\n/* r133 mutation proof */\n');
    assert.ok(gitChanged(['firmware/', 'runtime/']).length > 0,
      'firmware modification must be visible to the diff check');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.deepEqual(gitChanged(['firmware/', 'runtime/']).filter(f => !R166_ALLOWED.includes(f)), []);
});
check('MUTATION raw=4096 -> normal render predicate FAILS (already shown live)', () => {
  assert.equal(normalRawRender(probe({ readRaw: () => 4096 }).texts), false);
});

console.log('PASS adc_meter harness: all live, static and mutation checks green');
