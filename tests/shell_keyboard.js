/* r203 host harness for the shell.Keyboard control-key knife.
 *
 *   node tests/shell_keyboard.js
 *
 * With no new props the entire native message stream must match the golden
 * fixture captured from origin/main (pre-r203). `controlKeyRatio` widens only
 * BKSP / ENTER; `keyHeight` decouples key height from keySize. Both default to
 * the r148 geometry (ratio 1, height = keySize). Standalone CommonJS. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');
const shell = fs.readFileSync('runtime/shell.js', 'utf8');
const golden = JSON.parse(fs.readFileSync('tests/fixtures/shell_keyboard_default.json', 'utf8'));
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS shell_keyboard ' + name); }
const KEYBOARD = 'globalThis.k=lume.ui.shell.Keyboard({width:400,keySize:40,gap:0,x:40,y:240';
function launch(extra) { return runApp(shell + '\n' + KEYBOARD + (extra || '') + '});'); }
function attr(s, id, attrId) {
  return s.messages.filter(m => m[0] === 'attr' && m[1] === id && m[2] === attrId).at(-1)?.[3];
}
function keyId(s, label) {
  const hit = s.messages.find(m => m[0] === 'attr' && m[2] === 0 && m[3] === label);
  assert.ok(hit, 'missing key: ' + label);
  return hit[1];
}

check('default native message stream is byte-identical to pre-r203', () => {
  assert.deepEqual(launch().messages, golden);
});

check('mutation proof: golden stream rejects a default-path change', () => {
  const mutated = shell.replace('Math.round(keyWidth * controlRatio) : keyWidth',
    'Math.round(keyWidth * controlRatio) + 1 : keyWidth');
  assert.notEqual(mutated, shell);
  const s = runApp(mutated + '\n' + KEYBOARD + '});');
  assert.notDeepEqual(s.messages, golden);
});

check('controlKeyRatio 1.8 widens only BKSP / ENTER to 72 px', () => {
  const s = launch(',controlKeyRatio:1.8');
  assert.equal(attr(s, keyId(s, 'BKSP'), 2), 72);
  assert.equal(attr(s, keyId(s, 'ENTER'), 2), 72);
  assert.equal(attr(s, keyId(s, 'SPACE'), 2), 160, 'SPACE unchanged');
  assert.equal(attr(s, keyId(s, 'Q'), 2), 40, 'letter keys unchanged');
  assert.equal(attr(s, 1, 3), 168, 'root height unchanged');
});

check('keyHeight decouples height from keySize without changing widths', () => {
  const s = launch(',keyHeight:48');
  assert.equal(attr(s, keyId(s, 'Q'), 3), 48);
  assert.equal(attr(s, keyId(s, 'ENTER'), 3), 48);
  assert.equal(attr(s, keyId(s, 'Q'), 2), 40);
  assert.equal(attr(s, 1, 3), 4 * 48 + 2 * 4, 'root height tracks keyHeight');
});

check('new params validate without touching the default path', () => {
  assert.throws(() => launch(',controlKeyRatio:0.5'), /controlKeyRatio/);
  assert.throws(() => launch(',controlKeyRatio:4'), /controlKeyRatio/);
  assert.throws(() => launch(',controlKeyRatio:"2"'), /controlKeyRatio/);
  assert.throws(() => launch(',keyHeight:39'), /keyHeight/);
  assert.throws(() => launch(',keyHeight:48.5'), /keyHeight/);
  assert.deepEqual(launch().messages, golden, 'rejected params leave defaults intact');
});

console.log('PASS ' + cases + ' shell Keyboard cases');
