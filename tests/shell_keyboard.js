/* r203/r217 host harness for shell.Keyboard touch-target and control-key specs.
 *
 *   node tests/shell_keyboard.js
 *
 * r217 raises the keyHeight floor and default from 40 to 48 px (Math.max(48,
 * keySize)) and tapers SPACE to 3 * keySize + 2 * gap so 48 px-tall rows stay
 * inside R<=240 on a 480 px round screen. With no extra props the native
 * message stream must match the r217 golden fixture; `controlKeyRatio` widens
 * only BKSP / ENTER; `keyHeight` decouples height (>=48) from keySize.
 * Standalone CommonJS. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
const golden = JSON.parse(fs.readFileSync('tests/fixtures/shell_keyboard_default.json', 'utf8'));
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS shell_keyboard ' + name); }
const KEYBOARD = 'globalThis.k=lume.ui.shell.Keyboard({width:448,keySize:44,gap:0,x:16,y:240';
function launch(extra) { return runApp(shell + '\n' + KEYBOARD + (extra || '') + '});'); }
function attr(s, id, attrId) {
  return s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === attrId).at(-1)?.[3];
}
function keyId(s, label) {
  const hit = s.messages.find(m => m[0] === 'attr' && m[2] === 0 && m[3] === label);
  assert.ok(hit, 'missing key: ' + label);
  return hit[1];
}

check('default native message stream matches r217 golden (44x48 keys, 3x SPACE)', () => {
  assert.deepEqual(launch().messages, golden);
});

check('mutation proof: golden stream rejects a default-path change', () => {
  const mutated = shell.replace('Math.round(keyWidth * controlRatio) : keyWidth',
    'Math.round(keyWidth * controlRatio) + 1 : keyWidth');
  assert.notEqual(mutated, shell);
  const s = runApp(mutated + '\n' + KEYBOARD + '});');
  assert.notDeepEqual(s.messages, golden);
});

check('default keyHeight enforces 48 px floor and tracks keySize above 48', () => {
  const s = launch();
  assert.equal(attr(s, keyId(s, 'Q'), 2), 44, 'letter key width 44');
  assert.equal(attr(s, keyId(s, 'Q'), 3), 48, 'letter key height clamped up to 48');
  assert.equal(attr(s, keyId(s, 'SPACE'), 2), 132, 'SPACE spans 3 keys');
  assert.equal(attr(s, keyId(s, 'ENTER'), 3), 48, 'control key height 48');
  assert.equal(attr(s, 1, 3), 4 * 48 + 2 * 4, 'root height tracks 48 px keyHeight');
  const tall = runApp(shell + '\nglobalThis.k=lume.ui.shell.Keyboard({width:560,keySize:56,gap:0,x:0});');
  assert.equal(attr(tall, keyId(tall, 'Q'), 3), 56, 'keySize > 48 keeps square default height');
});

check('controlKeyRatio 1.5 widens only BKSP / ENTER to 66 px', () => {
  const s = launch(',controlKeyRatio:1.5');
  assert.equal(attr(s, keyId(s, 'BKSP'), 2), 66);
  assert.equal(attr(s, keyId(s, 'ENTER'), 2), 66);
  assert.equal(attr(s, keyId(s, 'SPACE'), 2), 132, 'SPACE unchanged');
  assert.equal(attr(s, keyId(s, 'Q'), 2), 44, 'letter keys unchanged');
  assert.equal(attr(s, 1, 3), 200, 'root height unchanged');
});

check('keyHeight decouples height from keySize without changing widths', () => {
  const s = launch(',keyHeight:56');
  assert.equal(attr(s, keyId(s, 'Q'), 3), 56);
  assert.equal(attr(s, keyId(s, 'ENTER'), 3), 56);
  assert.equal(attr(s, keyId(s, 'Q'), 2), 44);
  assert.equal(attr(s, 1, 3), 4 * 56 + 2 * 4, 'root height tracks keyHeight');
});

check('new params validate without touching the default path', () => {
  assert.throws(() => launch(',controlKeyRatio:0.5'), /controlKeyRatio/);
  assert.throws(() => launch(',controlKeyRatio:4'), /controlKeyRatio/);
  assert.throws(() => launch(',controlKeyRatio:"2"'), /controlKeyRatio/);
  assert.throws(() => launch(',keyHeight:40'), /keyHeight/);
  assert.throws(() => launch(',keyHeight:47'), /keyHeight/);
  assert.throws(() => launch(',keyHeight:48.5'), /keyHeight/);
  assert.throws(() => launch(',keyHeight:129'), /keyHeight/);
  assert.deepEqual(launch().messages, golden, 'rejected params leave defaults intact');
});

console.log('PASS ' + cases + ' shell Keyboard cases');
