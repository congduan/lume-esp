'use strict';
/* Simulated device client for the end-to-end smoke run. Follows the
 * lume.net.ws callback shape (onOpen/onMessage/onClose/onError). Usage:
 *   node tools/gateway/device-sim.js [ws://127.0.0.1:8765/] [--legacy]
 * `--legacy` omits the v1.1 streamTranscript cap and ignores transcript-delta,
 * exercising the backward-compat "old device ignores unknown downlink" path. */

const { connect, UPLINK_BYTES } = require('./index');

const url = process.argv[2] || 'ws://127.0.0.1:8765/';
const legacy = process.argv.indexOf('--legacy') >= 0;
let ack = false, uplink = 0, deltas = 0, audioFrames = 0, text = '';
let txDeltas = 0, txText = '';

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function log(event, fields = {}) {
  const parts = Object.keys(fields).map(k => k + '=' + fields[k]).join(' ');
  process.stdout.write('[device  ' + stamp() + '] ' + event + (parts ? ' ' + parts : '') + '\n');
}

const client = connect(url, {
  onOpen() {
    log('open', { url });
    client.sendText(JSON.stringify({
      v: 1, type: 'hello',
      device: { model: 'lume', fw: 'r117' },
      caps: { audioFormats: ['pcm_s16le_16000_2ch'], streamTranscript: !legacy }
    }));
    log('send.hello', {});
  },
  onMessage(data) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'hello-ack') {
        ack = true;
        log('recv.hello-ack', { sessionId: msg.sessionId, audioFormat: msg.audioFormat });
        for (let i = 0; i < 5; i++) {
          client.sendBinary(Buffer.alloc(UPLINK_BYTES, i & 0xff));
          uplink++;
        }
        log('send.uplink', { frames: uplink, bytesEach: UPLINK_BYTES, totalBytes: uplink * UPLINK_BYTES });
        client.sendText(JSON.stringify({ v: 1, type: 'end' }));
        log('send.end', {});
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
      txDeltas, txText: JSON.stringify(txText), legacy });
  },
  onError(code) { log('error', { code }); }
});

setTimeout(() => {
  if (!client.closed) { log('timeout', {}); client.close(); }
}, 5000).unref();
