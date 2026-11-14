const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('./lib/prelude_runner');
const root = path.join(__dirname, '..');
const run = runApp(`
  Text({text: '中'.repeat(80)});
  Text({text: 'a'.repeat(256)});
  try { Text({text: 'a'.repeat(257)}); } catch (e) { globalThis.over = String(e); }
  Canvas({width: 10, height: 10, onDraw: function(ctx) {
    ctx.text(0, 0, '中'.repeat(80), 0xffffff);
  }});
`);
assert(run.messages.some(m => m[0] === 'attr' && m[2] === 0 && Buffer.byteLength(m[3]) === 240));
assert(run.messages.some(m => m[0] === 'attr' && m[2] === 0 && Buffer.byteLength(m[3]) === 256));
assert.match(run.ctx.over, /exceeds 256 bytes/);
assert(run.messages.some(m => m[0] === 'draw' && m.some(v => typeof v === 'string' && Buffer.byteLength(v) === 240)));
console.log('PASS: 240-byte Chinese and 256-byte ASCII text accepted; 257 bytes rejected');

const engine = fs.readFileSync(path.join(root, 'firmware/components/lume-engine/lume_engine.c'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'firmware/components/lume-ui-bridge/lume_ui_bridge.c'), 'utf8');
assert.match(engine, /m->text_heap = heap_caps_malloc\(len \+ 1, MALLOC_CAP_SPIRAM\)/);
assert.match(engine, /heap_caps_free\(m\.text_heap\)/);
assert.match(bridge, /heap_caps_free\(m\.text_heap\)/);
console.log('PASS: external text payload has sender rollback and receiver release paths');
