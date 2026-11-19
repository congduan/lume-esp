'use strict';
/* Start the voice gateway. Usage:
 *   node tools/gateway/cli.js [--port 8765] [--host 127.0.0.1]
 *                             [--answer "TEXT"] [--upstream mock|openai]
 *                             [--device-token TOKEN] [--history-limit N]
 *                             [--system-prompt TEXT] [--multiturn]
 * `--upstream openai` needs OPENAI_API_KEY (plus optional OPENAI_* env);
 * no key -> clear error and exit 2. xiaozhi/direct remain TODO stubs.
 * r119: --device-token overrides GATEWAY_DEVICE_TOKEN env; empty = open LAN
 * mode (legacy behaviour). Token is never logged (only auth=on/off).
 * r120: --history-limit / GATEWAY_HISTORY_LIMIT sets the per-session window
 * (0 = off, byte-for-byte r119). --system-prompt / GATEWAY_SYSTEM_PROMPT
 * overrides the adapter default; never logged verbatim (custom|default only).
 * --multiturn / GATEWAY_MULTITURN=1 keeps one connection alive for several
 * turns so session history can carry across them (default off = r119). */

const { createGateway } = require('./server');
const { createUpstream } = require('./upstream');
const { normalizeLimit } = require('./history');

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
  /* r119: CLI flag wins over env; neither is ever printed verbatim. */
  const deviceToken = arg('device-token', process.env.GATEWAY_DEVICE_TOKEN || '');
  /* r120: CLI wins over env for all three. The prompt value is passed to the
   * adapter but never written to any log or error message. */
  const systemPrompt = arg('system-prompt', process.env.GATEWAY_SYSTEM_PROMPT || '');
  const historyLimit = normalizeLimit(
    arg('history-limit', process.env.GATEWAY_HISTORY_LIMIT || ''));
  const multiturn = process.argv.indexOf('--multiturn') >= 0 ||
    process.env.GATEWAY_MULTITURN === '1';
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
      voice: process.env.OPENAI_TTS_VOICE || 'alloy',
      /* r117: streaming ASR is opt-in and never points at a hardcoded address.
       * Both this config gate and device hello.caps must be on to engage it. */
      streamTranscript: process.env.OPENAI_STREAM_ASR === '1',
      asrWsUrl: process.env.OPENAI_ASR_WS_URL || '',
      /* r120: empty -> adapter keeps its hardcoded default fallback. */
      ...(systemPrompt ? { systemPrompt } : {})
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
    deviceToken,
    log,
    historyLimit,
    multiturn,
    upstreamFactory: () => createUpstream(upstreamName, upstreamOpts)
  });
  gw.start().then(() => {
    log('ready', { url: 'ws://' + host + ':' + port + '/',
      deviceAuth: deviceToken ? 'on' : 'off',
      /* r120: never echo the prompt text - only which source is active. */
      systemPrompt: systemPrompt ? 'custom' : 'default',
      historyLimit,
      multiturn: multiturn ? 'on' : 'off' });
  }).catch((e) => {
    process.stderr.write('gateway listen failed: ' + e.message + '\n');
    process.exit(1);
  });
  process.on('SIGINT', () => gw.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => gw.close().then(() => process.exit(0)));
}

if (require.main === module) main();
module.exports = { main };
