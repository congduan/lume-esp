'use strict';
/* Start the voice gateway. Usage:
 *   node tools/gateway/cli.js [--port 8765] [--host 127.0.0.1]
 *                             [--answer "TEXT"] [--upstream mock|openai]
 * `--upstream openai` needs OPENAI_API_KEY (plus optional OPENAI_* env);
 * no key -> clear error and exit 2. xiaozhi/direct remain TODO stubs. */

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
  let upstreamOpts = { answer };
  if (upstreamName === 'openai') {
    const key = process.env.OPENAI_API_KEY || '';
    if (!key) {
      process.stderr.write('[gateway] --upstream openai requires OPENAI_API_KEY env ' +
        '(no key configured; refusing to start). Use --upstream mock instead.\n');
      process.exit(2);
    }
    upstreamOpts = {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      chatBaseUrl: process.env.OPENAI_CHAT_BASE_URL || '',
      apiKey: key,
      sttModel: process.env.OPENAI_STT_MODEL || 'whisper-1',
      chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      ttsModel: process.env.OPENAI_TTS_MODEL || 'tts-1',
      voice: process.env.OPENAI_TTS_VOICE || 'alloy'
    };
  } else if (upstreamName !== 'mock') {
    process.stderr.write('TODO(r107): upstream "' + upstreamName + '" is a stub; ' +
      'use --upstream mock or --upstream openai.\n');
    process.exit(2);
  }
  const log = (event, fields = {}) => {
    const parts = Object.keys(fields).map(k => k + '=' + fields[k]).join(' ');
    process.stdout.write('[gateway ' + stamp() + '] ' + event + (parts ? ' ' + parts : '') + '\n');
  };
  const gw = createGateway({
    port, host,
    log,
    upstreamFactory: () => createUpstream(upstreamName, upstreamOpts)
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
