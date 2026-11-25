/* r196: end-to-end handshake-auth chain for the voice gateway (host only).
 *
 * Honesty scope: this file is the semantic bridge between r195's device-side
 * header construction (tests/va_ws.js asserts the prelude builds the string
 * "Authorization: Bearer <token>\r\n" and hands it to _connect) and r187's
 * gateway 401 gate (tools/gateway/ws.js authorized()). The same header name
 * and value are sent here through the real tools/gateway/ws-client.js
 * connect(url, cb, headers) into the real tools/gateway/server.js on an
 * ephemeral port. r197 adds the split-deployment proof: the upgrade gate uses
 * --token T1 while the hello gate uses --device-token T2 (T1 != T2), and each
 * token is rejected by the other gate. No board, no firmware, no real-device
 * verification is claimed: this proves host-side chain semantics only.
 *
 * Run: node tests/gateway_e2e_auth.js
 */
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createGateway, connect } = require('../tools/gateway');

const HS = 'r196-handshake-secret';
const WRONG_HS = 'r196-wrong-handshake';
const DT = 'r196-device-secret';
const WRONG_DT = 'r196-wrong-device';

/* Literal HTTP status, so the 401 / 101 assertions are on the wire and not
 * inferred from ws-client's abstract onError(1). */
function rawUpgrade(port, path, headers = {}) {
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

function helloFrame(deviceToken) {
  return JSON.stringify({
    v: 1, type: 'hello',
    device: { model: 'lume', app: 'gateway-e2e-auth' },
    ...(deviceToken ? { auth: { token: deviceToken } } : {})
  });
}

/* Drive the real device-side client. `out` is snapshotted on settle so late
 * socket callbacks after our own close() cannot mutate a resolved result. */
function deviceAttempt(url, headers, deviceToken) {
  return new Promise((resolve) => {
    const out = { opened: false, error: null, ack: false, ctrlError: null };
    let settled = false, timer = null, cli = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cli && !cli.closed) cli.close(1000, 'e2e-done');
      resolve(Object.assign({}, out));
    };
    cli = connect(url, {
      onOpen(client) {
        out.opened = true;
        if (deviceToken !== undefined) client.sendText(helloFrame(deviceToken));
      },
      onMessage(data) {
        if (typeof data !== 'string') return;
        let msg;
        try { msg = JSON.parse(data); } catch (_) { return; }
        if (msg.type === 'hello-ack') { out.ack = true; settle(); }
        else if (msg.type === 'error') { out.ctrlError = msg; settle(); }
      },
      onError(code) { out.error = code; settle(); },
      onClose() { settle(); }
    }, headers);
    timer = setTimeout(settle, 4000);
  });
}

(async () => {
  const gw = createGateway({ port: 0, host: '127.0.0.1', token: HS,
    deviceToken: DT, log: () => {} });
  await gw.start();
  const port = gw.address().port;
  const url = 'ws://127.0.0.1:' + port + '/';
  const pass = label => console.log('PASS gateway e2e auth: ' + label);
  try {
    let status = await rawUpgrade(port, '/');
    assert.equal(status, 401, 'no header must be rejected at the upgrade');
    let r = await deviceAttempt(url, {});
    assert.equal(r.opened, false, 'no header: ws-client must not open');
    assert.equal(r.error, 1, 'no header: ws-client sees non-101 handshake');
    assert.equal(r.ack, false, 'no header: no hello-ack');
    pass('no headers: HTTP 401, ws-client onError(1), no upgrade');

    status = await rawUpgrade(port, '/', { Authorization: 'Bearer ' + WRONG_HS });
    assert.equal(status, 401, 'wrong Bearer must be rejected at the upgrade');
    r = await deviceAttempt(url, { Authorization: 'Bearer ' + WRONG_HS });
    assert.equal(r.opened, false, 'wrong Bearer: ws-client must not open');
    assert.equal(r.error, 1, 'wrong Bearer: ws-client sees non-101 handshake');
    assert.equal(gw.sessions.length, 0, '401 rejections create no device sessions');
    pass('wrong Bearer: HTTP 401, ws-client onError(1), no session');

    status = await rawUpgrade(port, '/', { Authorization: 'Bearer ' + HS });
    assert.equal(status, 101, 'correct Bearer must upgrade');
    r = await deviceAttempt(url, { Authorization: 'Bearer ' + HS }, DT);
    assert.equal(r.opened, true, 'correct Bearer: ws-client opened');
    assert.equal(r.ack, true, 'correct device token: hello-ack received');
    assert.equal(r.ctrlError, null, 'correct device token: no error frame');
    pass('correct Bearer: HTTP 101 + hello-ack with correct device token');

    r = await deviceAttempt(url, { Authorization: 'Bearer ' + HS }, WRONG_DT);
    assert.equal(r.opened, true, 'correct Bearer lets the frame reach hello gate');
    assert.equal(r.ack, false, 'wrong device token: no hello-ack');
    assert.ok(r.ctrlError && r.ctrlError.type === 'error' &&
      r.ctrlError.code === 'unauthorized', 'wrong device token: unauthorized frame');
    pass('correct Bearer + wrong device token: hello gate rejects (unauthorized)');

    status = await rawUpgrade(port, '/', { 'x-gateway-token': HS });
    assert.equal(status, 101, 'x-gateway-token must upgrade');
    r = await deviceAttempt(url, { 'x-gateway-token': HS }, DT);
    assert.equal(r.opened, true);
    assert.equal(r.ack, true, 'x-gateway-token: hello-ack received');
    pass('x-gateway-token compatibility form: HTTP 101 + hello-ack');

    status = await rawUpgrade(port, '/?token=' + HS);
    assert.equal(status, 101, '?token= must upgrade');
    r = await deviceAttempt(url + '?token=' + HS, {}, DT);
    assert.equal(r.opened, true);
    assert.equal(r.ack, true, '?token=: hello-ack received');
    pass('?token= compatibility form: HTTP 101 + hello-ack');

    /* ---- r197: the two gateway keys are independent (T1 != T2) ---------- */
    status = await rawUpgrade(port, '/', { Authorization: 'Bearer ' + DT });
    assert.equal(status, 401, 'hello device-token must NOT open the upgrade gate');
    r = await deviceAttempt(url, { Authorization: 'Bearer ' + DT }, DT);
    assert.equal(r.opened, false, 'device-token-as-Bearer: ws-client must not open');
    assert.equal(r.error, 1, 'device-token-as-Bearer: ws-client sees non-101 handshake');
    assert.equal(r.ack, false, 'device-token-as-Bearer: no hello-ack');
    pass('r197: Bearer=device-token (wrong handshake) -> HTTP 401, no upgrade');

    r = await deviceAttempt(url, { Authorization: 'Bearer ' + HS }, HS);
    assert.equal(r.opened, true, 'correct Bearer lets the frame reach the hello gate');
    assert.equal(r.ack, false, 'handshake-token-as-hello: no hello-ack');
    assert.ok(r.ctrlError && r.ctrlError.type === 'error' &&
      r.ctrlError.code === 'unauthorized', 'handshake-token-as-hello: unauthorized frame');
    /* The gateway sets closeReason from the error code before sending its
     * close(CLOSE_FOR_ERROR.unauthorized = 1008); the client onClose callback
     * carries no code, so assert the stable server-side fault marker here. */
    assert.equal(gw.sessions[gw.sessions.length - 1].closeReason, 'unauthorized',
      'r197: wrong hello closes the fatal unauthorized path');
    pass('r197: Bearer=handshake + hello=handshake (wrong device token) -> unauthorized/1008');

    console.log('ALL GATEWAY E2E AUTH CASES PASSED');
  } finally {
    await gw.close();
  }
})().catch(e => { console.error('FAIL ' + (e && e.stack || e)); process.exitCode = 1; });
