/* Real HTTP upgrade checks for the optional gateway handshake token. */
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createGateway } = require('../tools/gateway');

function upgrade(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      ...headers
    } });
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const gw = createGateway({ port: 0, token: 'secret-r187' });
  await gw.start();
  try {
    const port = gw.address().port;
    for (const [label, path, headers, expected] of [
      ['no token', '/', {}, 401],
      ['wrong token', '/?token=wrong', {}, 401],
      ['correct query token', '/?token=secret-r187', {}, 101],
      ['correct Bearer token', '/', { Authorization: 'Bearer secret-r187' }, 101]
    ]) {
      const status = await upgrade(port, path, headers);
      assert.equal(status, expected, label);
      console.log(label + ': HTTP ' + status);
    }
    assert.equal(gw.sessions.length, 2, 'rejected upgrades create no sessions');
  } finally { await gw.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
