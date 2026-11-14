const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('./lib/prelude_runner');
const logs = [];
const run = runApp(`var value = signal('before'); var id = Text({text: value});`,
  { onWarn: msg => logs.push(msg) });
const id = run.ctx.id;
assert(id > 0);
run.ctx.__lume_dispatchCreateFailed(id);
const before = run.messages.length;
run.ctx.value.set('after');
assert.equal(run.messages.length, before);
assert.deepEqual(logs, [`lume create failed for node ${id}`]);
console.log('PASS: create-failed notice disposes signal effects and warns once');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'firmware/components/lume-engine/lume_engine.c'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'firmware/components/lume-ui-bridge/lume_ui_bridge.c'), 'utf8');
assert.match(bridge, /if \(!pixels\).*fail_create\(m->node_id\)/);
assert.match(bridge, /s_failed_nodes\[id\] = true;\s*lume_engine_mark_create_failed\(id\)/);
assert.match(engine, /s_node_dead\[id\] = true/);
assert.match(engine, /s_node_dead\[node_id\]\)\s*return JS_UNDEFINED/);
console.log('PASS: Canvas failure latches dead id and native attrs become no-op');
