'use strict';
/* Simulated device client for the end-to-end smoke run. Follows the
 * lume.net.ws callback shape (onOpen/onMessage/onClose/onError). Usage:
 *   node tools/gateway/device-sim.js [ws://127.0.0.1:8765/] [--legacy] [--token TOKEN] [--device-token TOKEN]
 *                                   [--turns N] [--drop-after N]
 * `--legacy` omits the v1.1 streamTranscript cap and ignores transcript-delta,
 * exercising the backward-compat "old device ignores unknown downlink" path.
 * r119: --device-token (fallback GATEWAY_DEVICE_TOKEN env) adds hello.auth.token
 * for the gateway's locked mode; token value is never logged.
 * r120: --turns N (default 1 = unchanged) drives N consecutive turns on one
 * connection; requires a gateway started with --multiturn so history carries.
 * r122: --drop-after N disconnects mid-run after turn N via a device-initiated
 * close(4000, forced-drop), then reconnects with hello.resume set to the last
 * gateway sessionId (history rebind smoke). */

const { connect, UPLINK_BYTES } = require('./index');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith('--')) return fallback;
  return v;
}

const url = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : 'ws://127.0.0.1:8765/';
const legacy = process.argv.indexOf('--legacy') >= 0;
const deviceToken = arg('device-token', process.env.GATEWAY_DEVICE_TOKEN || '');
const handshakeToken = arg('token', process.env.GATEWAY_TOKEN || '');
const turns = Math.max(1, Number(arg('turns', '1')) || 1);
const dropAfter = Number(arg('drop-after', '0')) || 0;   /* 0 = never force-drop */
let turn = 0;
let ack = false, uplink = 0, deltas = 0, audioFrames = 0, text = '';
let txDeltas = 0, txText = '';
let resumeId = '';                 /* r122: retained gateway sessionId */
let client = null;

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function log(event, fields = {}) {
  const parts = Object.keys(fields).map(k => k + '=' + fields[k]).join(' ');
  process.stdout.write('[device  ' + stamp() + '] ' + event + (parts ? ' ' + parts : '') + '\n');
}

/* r120: one uplink turn. The optional text control frame is folded into the
 * chat user message by the upstream; the fake STT endpoint varies its result
 * per turn so consecutive turns are distinguishable in the request body. */
function sendTurn(withText) {
  turn++;
  for (let i = 0; i < 5; i++) {
    const seed = withText ? (turn * 16 + i) : i;
    client.sendBinary(Buffer.alloc(UPLINK_BYTES, seed & 0xff));
    uplink++;
  }
  log('send.uplink', { frames: uplink, bytesEach: UPLINK_BYTES,
    totalBytes: uplink * UPLINK_BYTES, turn });
  if (withText) {
    client.sendText(JSON.stringify({ v: 1, type: 'text', text: 'TURN ' + turn + ' USER UTTERANCE' }));
    log('send.text', { turn });
  }
  client.sendText(JSON.stringify({ v: 1, type: 'end' }));
  log('send.end', { turn });
}

/* r122: open (or reopen) the WS. `resume` is only non-empty on a reconnect,
 * where it asks the gateway to rebind the history of the previous session. */
function openConnection(resume) {
  client = connect(url, {
    onOpen() {
      log('open', { endpoint: new URL(url).origin, resume: resume ? 'on' : 'off' });
      const hello = {
        v: 1, type: 'hello',
        device: { model: 'lume', fw: 'r117' },
        caps: { audioFormats: ['pcm_s16le_16000_2ch'], streamTranscript: !legacy }
      };
      if (deviceToken) hello.auth = { token: deviceToken };
      if (resume) hello.resume = resume;
      client.sendText(JSON.stringify(hello));
      log('send.hello', { auth: deviceToken ? 'on' : 'off', resume: resume ? 'on' : 'off' });
    },
    onMessage(data) {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'hello-ack') {
          ack = true;
          if (typeof msg.sessionId === 'string' && msg.sessionId) resumeId = msg.sessionId;
          log('recv.hello-ack', { sessionId: msg.sessionId, audioFormat: msg.audioFormat });
          if (turns > 1) {
            sendTurn(true);
          } else {
            for (let i = 0; i < 5; i++) {
              client.sendBinary(Buffer.alloc(UPLINK_BYTES, i & 0xff));
              uplink++;
            }
            log('send.uplink', { frames: uplink, bytesEach: UPLINK_BYTES, totalBytes: uplink * UPLINK_BYTES });
            client.sendText(JSON.stringify({ v: 1, type: 'end' }));
            log('send.end', {});
          }
        } else if (msg.type === 'text-delta') {
          deltas++;
          text += msg.text;
          log('recv.text-delta', { seq: msg.seq, chars: msg.text.length, final: msg.final });
        } else if (msg.type === 'transcript-delta') {
          /* v1.1: consume (new device) or ignore (--legacy old device). The final
           * frame is the COMPLETE transcript, not another increment. */
          if (legacy) { log('ignore.transcript-delta', { seq: msg.seq }); return; }
          txDeltas++;
          if (msg.final === true) txText = String(msg.text || '');
          else txText += String(msg.text || '');
          log('recv.transcript-delta', { seq: msg.seq, chars: String(msg.text || '').length,
            final: msg.final, all: JSON.stringify(txText) });
        } else if (msg.type === 'state') {
          log('recv.state', { state: msg.state });
          /* r120: 'idle' after a turn means the gateway re-armed a fresh adapter
           * on the same session. Drive the next turn, or close after the last.
           * r122: --drop-after N tears the socket down mid-run and reconnects. */
          if (msg.state === 'idle' && turns > 1) {
            setTimeout(() => {
              if (turn === dropAfter && turn < turns) {
                log('force.drop', { turn, sessionId: resumeId });
                /* Explicit non-1000 close: a device-initiated mid-run disconnect
                 * (the vendored WS server does not notice a bare TCP destroy
                 * until it next writes, which would race the reconnect). */
                if (!client.closed) client.close(4000, 'forced-drop');
              } else if (turn < turns) {
                sendTurn(true);
              } else if (!client.closed) {
                client.close();
              }
            }, 10);
          }
        } else if (msg.type === 'error') {
          log('recv.error', { code: msg.code, fatal: msg.fatal, message: msg.message });
        }
      } else {
        audioFrames++;
        log('recv.audio', {
          seq: data[7], bytes: data.length,
          version: data[0], type: data[1], format: data[2],
          rate: data.readUInt16LE(3), channels: data[5], bits: data[6]
        });
      }
    },
    onClose() {
      log('close', { ack, uplink, deltas, audioFrames, text: JSON.stringify(text),
        txDeltas, txText: JSON.stringify(txText), legacy, auth: deviceToken ? 'on' : 'off' });
      /* r122: a forced drop is followed by a fresh hello carrying resume. */
      if (dropAfter > 0 && dropAfter === turn && turn < turns && resumeId) {
        setTimeout(() => {
          log('reconnect', { resume: resumeId });
          openConnection(resumeId);
        }, 10);
      }
    },
    onError(code) { log('error', { code }); }
  }, handshakeToken ? { Authorization: 'Bearer ' + handshakeToken } : {});
}

openConnection('');

setTimeout(() => {
  if (client && !client.closed) { log('timeout', {}); client.close(); }
}, 5000).unref();
