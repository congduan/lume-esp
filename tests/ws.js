const assert = require('node:assert/strict');
const { runApp } = require('./lib/prelude_runner');
const sent = [];
let id = 0;
const app = runApp(`
var opened = 0, closed = 0, errors = 0, text = '', binary = null, conn = null;
lume.net.ws.connect('ws://localhost:8765/echo', {
  headers: {'X-Test':'hello'},
  onOpen:function(){ opened++; },
  onMessage:function(data){ if (typeof data === 'string') text = data; else binary = data; },
  onClose:function(){ closed++; },
  onError:function(){ errors++; }
}, function(err, handle){ if (!err) conn = handle; });
`, { net: { ws: {
  _connect: (url, headers) => { assert.match(url, /^ws:/); assert.equal(headers, 'X-Test: hello\r\n'); return ++id; },
  _send: (handle, data) => { sent.push([handle, data]); return 0; },
  _close: () => 0,
} } });
assert.equal(app.ctx.opened, 0);
app.ctx.__lume_dispatchWS(id, 1, null);
assert.equal(app.ctx.opened, 1);
assert.equal(app.ctx.conn.send('hello'), 0);
assert.deepEqual(sent, [[id, 'hello']]);
app.ctx.__lume_dispatchWS(id, 2, 'hello');
assert.equal(app.ctx.text, 'hello');
const bytes = new ArrayBuffer(3);
new Uint8Array(bytes).set([0, 255, 4]);
app.ctx.__lume_dispatchWS(id, 2, bytes);
assert.deepEqual([...new Uint8Array(app.ctx.binary)], [0, 255, 4]);
assert.equal(app.ctx.conn.close(), 0);
app.ctx.__lume_dispatchWS(id, 3, null);
assert.equal(app.ctx.closed, 1);
assert.equal(app.ctx.errors, 0);
console.log('WebSocket host prelude: PASS');
