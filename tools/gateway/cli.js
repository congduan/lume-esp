'use strict';
/* Start the mock gateway. Usage:
 *   node tools/gateway/cli.js [--port 8765] [--host 127.0.0.1]
 *                             [--answer "TEXT"] [--upstream mock]
 * Real upstreams are TODO stubs; selecting one exits with a clear message. */

const { createGateway } = require('./server');
const { createUpstream } = require('./upstream');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith('--')) return fallback;
  return v;
}

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function main() {
  const port = Number(arg('port', 8765));
  const host = arg('host', '127.0.0.1');
  const answer = arg('answer', 'HELLO FROM THE MOCK GATEWAY.');
  const upstreamName = arg('upstream', 'mock');
  if (upstreamName !== 'mock') {
    process.stderr.write('TODO(r107): upstream "' + upstreamName + '" is a stub; ' +
      'upstream selection is not decided. Use --upstream mock.\n');
    process.exit(2);
  }
  const log = (event, fields = {}) => {
    const parts = Object.keys(fields).map(k => k + '=' + fields[k]).join(' ');
    process.stdout.write('[gateway ' + stamp() + '] ' + event + (parts ? ' ' + parts : '') + '\n');
  };
  const gw = createGateway({
    port, host,
    log,
    upstreamFactory: () => createUpstream('mock', { answer })
  });
  gw.start().then(() => {
    log('ready', { url: 'ws://' + host + ':' + port + '/' });
  }).catch((e) => {
    process.stderr.write('gateway listen failed: ' + e.message + '\n');
    process.exit(1);
  });
  process.on('SIGINT', () => gw.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => gw.close().then(() => process.exit(0)));
}

if (require.main === module) main();
module.exports = { main };
