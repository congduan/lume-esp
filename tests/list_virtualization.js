// Host harness: execute the exact C-embedded prelude with a deferred LVGL remove queue.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('firmware/components/lume-engine/lume_scripts.c', 'utf8');
const { prelude } = require('./lib/prelude_runner');
let next = 0, creates = [], attrs = [], removed = [], parents = {}, live = new Set(), presses = new Set();
const ctx = vm.createContext({lume: {
  createNode(kind, parent) {
    let id = 1;
    while (live.has(id) && id < 128) id++;
    if (id >= 128) throw new Error('node table full');
    next = id; creates.push([id, kind]); live.add(id); parents[id] = parent; return id;
  },
  setAttr(id, attr, value) { attrs.push([id, attr, value]); if (attr === 6) parents[id] = value; },
  setPressEvent(id) { presses.add(id); },
  removeChild(id) { removed.push(id); },
  _nowMs() { return 0; }, log() {}
}});
vm.runInContext(prelude, ctx);
const run = code => vm.runInContext(code, ctx);
function ack() {
  while (removed.length) {
    const root = removed.shift();
    const subtree = [...live].filter(id => id === root || ancestor(id, root));
    for (const id of subtree.reverse()) { live.delete(id); run(`__lume_dispatchRemove(${id})`); }
  }
}
function ancestor(id, root) {
  let p = parents[id];
  while (p) { if (p === root) return true; p = parents[p]; }
  return false;
}
function ok(name, fn) { fn(); console.log('PASS ' + name); }
run(`var items = signal(Array.from({length:1000}, (_, i) => i));
var list = List({items:items,itemHeight:36,style:{width:480,height:432},
  renderItem:function (item) { return View({style:{height:36},onPress:function () {}}); }});`);
ok('1000 items, 12 visible: initial 15 rows, 17 total nodes', () => {
  assert.equal(creates.length, 17); assert.equal(live.size, 17);
  console.log('EVIDENCE 1000 items / 12 visible: actual created nodes=' + creates.length + ' (15 rows + container + spacer)');
});
ok('scroll maps to 18-row middle window', () => {
  run('__lume_dispatchScroll(list, 3600); __lume_tick()');
  assert.equal(removed.length, 15); assert.equal(live.size, 17);
  ack(); run('__lume_tick()');
  assert.equal(live.size, 20);
  assert.equal(creates.length, 35);
  console.log('EVIDENCE 1000 items / 12 visible: middle window live nodes=' + live.size + ' (18 rows + 2 fixed)');
});
ok('scroll window reclaims old rows before creating replacements', () => {
  const before = creates.length;
  run('__lume_dispatchScroll(list, 7200); __lume_tick()');
  assert.equal(creates.length, before);
  assert.equal(removed.length, 18);
  ack(); run('__lume_tick()');
  assert.equal(live.size, 20);
});
ok('small scroll within same window does not churn nodes', () => {
  run('__lume_dispatchScroll(list, 7201); __lume_tick()');
  ack(); run('__lume_tick()');
  const before = creates.length;
  run('__lume_dispatchScroll(list, 7202); __lume_tick()');
  assert.equal(creates.length, before); assert.equal(removed.length, 0);
});
ok('same-length items replacement rebuilds window and keeps offset', () => {
  const before = attrs.length;
  run('items.set(Array.from({length:1000}, (_, i) => i + 1000))');
  assert.equal(removed.length, 19);
  ack(); run('__lume_tick()');
  assert.equal(live.size, 21);
  assert.equal(attrs.slice(before).filter(a => a[1] === 22).length, 0);
});
ok('length change rebuilds and resets scroll to top', () => {
  run('items.set(Array.from({length:999}, (_, i) => i))');
  assert(attrs.some(a => a[0] === run('list') && a[1] === 22 && a[2] === 0));
  ack(); run('__lume_tick()');
  assert.equal(live.size, 17);
});
ok('removed row loses press callback and signal effects', () => {
  run(`var label = signal('old'); var nested = View({style:{height:36},onPress:function(){globalThis.hit = true}},
    [Text({text:function(){return label()}})]);`);
  const id = run('nested');
  const textId = next;
  ctx.lume.removeChild(id); ack();
  const before = attrs.length;
  run(`__lume_dispatchPress(${id}); label.set('new')`);
  assert.equal(run('globalThis.hit'), undefined);
  assert.equal(attrs.slice(before).filter(a => a[0] === textId).length, 0);
});
ok('1000-item traversal stays within the 127-node table', () => {
  for (let y = 0; y < 999 * 36; y += 360) {
    run(`__lume_dispatchScroll(list, ${y}); __lume_tick()`);
    ack(); run('__lume_tick()');
    assert(live.size < 127);
  }
});
ok('bridge throttle and overflow policy are present', () => {
  const c = fs.readFileSync('firmware/components/lume-ui-bridge/lume_ui_bridge.c', 'utf8');
  const e = fs.readFileSync('firmware/components/lume-engine/lume_engine.c', 'utf8');
  assert.match(c, /now - s_scroll_last_tick\[id\]\) < 25/);
  assert.match(c, /delta > -12 && delta < 12/);
  assert.match(c, /now - s_scroll_last_tick\[id\]\) < 40/);
  assert.match(e, /scroll id=%u dropped: evt queue full/);
});
ok('files example seeds 1000 entries without creating 1000 rows', () => {
  ctx.Fs = {list: () => [], exists: () => false, remove: () => 0};
  vm.runInContext(fs.readFileSync('examples/files/app.js', 'utf8'), ctx);
  const before = creates.length;
  run('seedTestEntries(); __lume_tick()');
  const made = creates.length - before;
  assert(made > 0 && made < 60, 'files app created ' + made + ' nodes');
  console.log('EVIDENCE files seedTestEntries(): 1000 entries, ' + made + ' new nodes');
});
console.log('PASS 10 list virtualization cases');
