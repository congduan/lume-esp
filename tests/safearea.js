const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const shell = fs.readFileSync('runtime/shell.js', 'utf8');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS safearea ' + name); }
function app() { return runApp(shell); }
function evaluate(s, code) { return vm.runInContext(code, s.ctx); }
function attr(s, id, key) {
  return s.messages.findLast(m => m[0] === 'attr' && m[1] === id && m[2] === key)?.[3];
}

check('square insets are zero and children stay in full-size view', () => {
  const s = app();
  assert.deepEqual(JSON.parse(evaluate(s, 'JSON.stringify(lume.ui.shell.safeInsets("square", 466))')),
    {top:0,right:0,bottom:0,left:0});
  evaluate(s, 'globalThis.child=View({style:{width:466,height:466}});globalThis.root=lume.ui.shell.SafeArea({shape:"square",size:466,children:[child]});');
  assert.equal(attr(s, s.ctx.root, 2), 466);
  assert.equal(attr(s, s.ctx.root, 3), 466);
  assert.equal(attr(s, s.ctx.child, 6), s.ctx.root);
});

check('round 466 uses a centered inscribed 329 px square', () => {
  const s = app();
  assert.deepEqual(JSON.parse(evaluate(s, 'JSON.stringify(lume.ui.shell.safeInsets("round", 466))')),
    {top:68,right:69,bottom:69,left:68});
  assert.deepEqual(JSON.parse(evaluate(s, 'JSON.stringify(lume.ui.shell.safeInsets("round", 480))')),
    {top:70,right:71,bottom:71,left:70});
  evaluate(s, 'globalThis.root=lume.ui.shell.SafeArea({shape:"round",size:466});');
  assert.equal(attr(s, s.ctx.root, 2), 329);
  assert.equal(attr(s, s.ctx.root, 3), 329);
  assert.equal(attr(s, s.ctx.root, 18), 68);
  assert.equal(attr(s, s.ctx.root, 19), 68);
});

check('oversized direct View children warn once without throwing', () => {
  const s = app();
  const warnings = [];
  s.ctx.console = {warn: message => warnings.push(message)};
  evaluate(s, 'var a=View({style:{width:330,height:100}});var b=View({style:{x:300,width:40,height:40}});globalThis.root=lume.ui.shell.SafeArea({shape:"round",size:466,children:[a,b]});');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /329x329 safe bounds/);
});

check('fitting direct children do not warn', () => {
  const s = app();
  const warnings = [];
  s.ctx.console = {warn: message => warnings.push(message)};
  evaluate(s, 'var child=View({style:{x:20,y:30,width:300,height:290}});lume.ui.shell.SafeArea({shape:"round",size:466,children:[child]});');
  assert.equal(warnings.length, 0);
});

check('invalid shape and size throw TypeError', () => {
  const s = app();
  for (const code of [
    'lume.ui.shell.safeInsets("oval",466)',
    'lume.ui.shell.safeInsets("round",0)',
    'lume.ui.shell.SafeArea({shape:"oval",size:466})',
    'lume.ui.shell.SafeArea({shape:"round",size:0})',
  ]) assert.throws(() => evaluate(s, code), error => error.name === 'TypeError' && /lume: SafeArea/.test(error.message));
});

console.log('PASS ' + cases + ' safearea cases');
