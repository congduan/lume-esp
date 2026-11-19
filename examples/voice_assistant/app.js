/* r95 — VOICE ASSISTANT / walkie-talkie card (legacy sync mode, pure app layer).
 *
 * r108 adds a GATEWAY mode: a thin `lume.net.ws` transport (docs/voice-gateway-
 * protocol.md v1) plugs into the same vaTransport slot and streams 60 ms PCM
 * uplink + text-delta + playStream audio, with ZERO change to the state machine.
 * With no gateway URL / no IP the app degrades to the legacy canned DEMO path.
 *
 * State machine IDLE -> LISTEN -> THINK -> SPEAK is signal-driven and lives
 * entirely in JS so the whole interaction can be hot-reloaded without a
 * firmware rebuild. Barge-in: a tap during SPEAK returns to IDLE at once.
 *
 * LEGACY MODE (this round): `lume.ai.chat` and `lume.audio.record` are
 * synchronous and block the single engine task. We therefore never call them
 * from the input handler: entering THINK/LISTEN only flips signals, and the
 * blocking work is deferred with `lume.system.setTimeout(..., 0)` so the card
 * gets at least one rendered frame first. Full-duplex / non-blocking streaming
 * is the job of the async gateway (roadmap knife D), not this demo.
 *
 * The "send -> reply" path is a single replaceable `vaTransport` slot: the
 * default legacy transport uses lume.ai.chat; a future WS/gateway transport
 * plugs in through vaSetTransport() with no change to the state machine.
 *
 * No backend / no mic (browser playground, host harness): auto-degrade to
 * DEMO mode with canned Q&A rotation (compass precedent). The mode badge
 * always states the active mode honestly. All UI text is pure ASCII (r64
 * firmware glyph discipline). */
var darkTheme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(darkTheme);

var VA_CW = 320, VA_CH = 160;          /* one canvas, 51,200 px << 230,400 budget */
var LISTEN_MS = 4000;                  /* LISTEN watchdog -> IDLE (no send) */
var TYPE_MS = 33;                      /* ~30 cps typewriter (typewriter precedent) */
var CURSOR_MS = 300;

var VA_CANNED = [
  { q: 'HELLO LUME',   a: 'HI. I AM LISTENING ON THE WATCH.' },
  { q: 'WHAT TIME',    a: 'THE CLOCK FACE HAS THE LOCAL TIME.' },
  { q: 'BATTERY',      a: 'OPEN THE POWER PAGE FOR LEVEL.' },
  { q: 'TELL A JOKE',  a: 'A BYTE WALKED INTO A BAR. IT DID NOT COMPUTE.' }
];

var vaState = signal('IDLE');
var vaModeLabel = signal('DEMO');
var vaTypingPos = signal(0);
var vaTyping = signal(false);
var vaCursor = signal(true);
var vaLevel = signal(0.08);
var vaRev = signal(0);
/* r117 v1.1 transcript: only integer/one-piece signal writes in the WS
 * callback; the bounded join happens at render time (typewriter OOM lesson). */
var vaTxRev = signal(0);
var vaTxFinal = signal('');

var vaMode = 'DEMO';
var vaFullText = '';
var vaCannedIndex = 0;
var vaPendingPrompt = '';
var vaWavePhase = 0;
var vaPlayCount = 0;
var vaTransportCalls = 0;
var vaWatchTimer = null, vaSendTimer = null, vaTypeTimer = null, vaSpeakTimer = null, vaCursorTimer = null;

/* ---- transition table (harness-visible pure helpers) ------------------- */
var VA_LEGAL = {
  IDLE:   ['LISTEN'],
  LISTEN: ['IDLE', 'THINK'],
  THINK:  ['SPEAK', 'IDLE'],
  SPEAK:  ['IDLE']
};
function vaCan(from, to) {
  var list = VA_LEGAL[from];
  return !!(list && list.indexOf(to) >= 0);
}
function vaSet(next) {
  var from = vaState();
  if (from === next) return false;
  if (!vaCan(from, next)) { lume.log('VA ILLEGAL ' + from + '-' + next); return false; }
  vaState.set(next);
  return true;
}

/* ---- mode detection / honest badge (compass fallback pattern) ---------- */
function vaDetectMode() {
  var key = null, gw = null;
  try { key = lume.storage.kv.get('ai_api_key'); } catch (e) { key = null; }
  try { gw = lume.storage.kv.get(VA_GATEWAY_KEY); } catch (e) { gw = null; }
  var ip = (lume.net && lume.net.status) ? lume.net.status().state : 0;
  var gotIp = (lume.net && lume.net.GOT_IP !== undefined) ? lume.net.GOT_IP : 3;
  /* An explicit gateway URL + a usable IP selects the WS transport. */
  if (typeof gw === 'string' && gw && ip === gotIp) return 'GATEWAY';
  return (typeof key === 'string' && key && ip === gotIp) ? 'LIVE' : 'DEMO';
}
function vaSetMode(next) {
  vaMode = next === 'GATEWAY' ? 'GATEWAY' : (next === 'LIVE' ? 'LIVE' : 'DEMO');
  vaModeLabel.set(vaMode);
  /* GATEWAY -> WS transport, everything else -> legacy canned/chat transport. */
  vaSetTransport(vaMode === 'GATEWAY' ? vaTransportWS : vaTransportLegacy);
  lume.log('VA MODE ' + vaMode);
}
function vaDemoReply() {
  var a = VA_CANNED[vaCannedIndex % VA_CANNED.length].a;
  vaCannedIndex++;
  return a;
}

/* ---- transport slot: only this function knows HOW a reply is obtained ---
 * Default legacy transport is synchronous and may block. DEMO always uses the
 * canned rotation. Inject a fake with vaSetTransport() for gateway/WS/tests. */
function vaTransportLegacy(prompt, done) {
  if (vaMode !== 'LIVE' || !lume.ai || typeof lume.ai.chat !== 'function') {
    done(vaDemoReply(), 0); return;
  }
  var r = lume.ai.chat({ messages: [{ role: 'user', content: prompt }], maxTokens: 256 });
  if (typeof r === 'number') done(null, r);
  else done(r.content || '(empty)', 0);
}
var vaTransport = vaTransportLegacy;
function vaSetTransport(fn) { vaTransport = (typeof fn === 'function') ? fn : vaTransportLegacy; }

/* ---- audio helpers ----------------------------------------------------- */
function vaRecordOnce() {
  if (vaState() !== 'LISTEN') return;
  if (!lume.audio || typeof lume.audio.record !== 'function') return;
  var pcm = -3;
  try { pcm = lume.audio.record(2); } catch (e) { pcm = -3; }
  if (typeof pcm === 'number') { lume.log('VA MIC UNAVAILABLE ' + pcm); return; }
  /* Crude RMS -> level. No ASR in legacy mode; the prompt is the canned
   * utterance chosen on LISTEN, the PCM only drives the waveform. */
  var v = new DataView(pcm), sum = 0, n = Math.min(4096, Math.floor(v.byteLength / 4)), i;
  for (i = 0; i < n; i++) { var s = v.getInt16(i * 4, true) / 32768; sum += s * s; }
  vaLevel.set(Math.max(0.1, Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 6)));
  lume.log('VA MIC PCM ' + v.byteLength);
}
function vaPlayReply() {
  var frames = 2880, rate = 16000, bytes = frames * 4;   /* 0.18 s stereo 16 kHz */
  var pcm = new ArrayBuffer(bytes), v = new DataView(pcm), i;
  for (i = 0; i < frames; i++) {
    var env = Math.sin(Math.PI * i / frames);
    var s = Math.round(6000 * env * Math.sin(i * 2 * Math.PI * 660 / rate));
    v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
  }
  if (!lume.audio || typeof lume.audio.play !== 'function') return;
  var rc = lume.audio.play(pcm);
  if (rc === 0) vaPlayCount++; else lume.log('VA PLAY ERR ' + rc);
}

/* ---- state machine actions --------------------------------------------- */
function vaStartListen() {
  if (!vaSet('LISTEN')) return false;
  vaFullText = ''; vaTypingPos.set(0); vaTyping.set(false);
  vaPendingPrompt = VA_CANNED[vaCannedIndex % VA_CANNED.length].q;
  vaLevel.set(0.2);
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  /* Defer the blocking record() so the LISTEN card renders one frame first. */
  if (vaMode === 'LIVE') lume.system.setTimeout(vaRecordOnce, 0);
  vaWatchTimer = lume.system.setTimeout(vaListenTimeout, LISTEN_MS);
  lume.log('VA LISTEN mode=' + vaMode + ' prompt=' + vaPendingPrompt);
  return true;
}
function vaSend() {
  if (vaState() !== 'LISTEN') { lume.log('VA SEND NOOP'); return false; }
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  return vaAsk(vaPendingPrompt);
}
function vaListenTimeout() {
  if (vaState() !== 'LISTEN') return false;
  if (vaWatchTimer !== null) { lume.system.clearTimeout(vaWatchTimer); vaWatchTimer = null; }
  lume.log('VA LISTEN TIMEOUT -> IDLE');
  return vaSet('IDLE');
}
function vaAsk(prompt) {
  if (!vaSet('THINK')) return false;
  vaPendingPrompt = prompt || '';
  vaFullText = ''; vaTypingPos.set(0); vaTyping.set(false);
  if (vaSendTimer !== null) { lume.system.clearTimeout(vaSendTimer); vaSendTimer = null; }
  /* Frame deferral: THINK is rendered on this tick, transport runs on the next. */
  vaSendTimer = lume.system.setTimeout(vaDeferredSend, 0);
  return true;
}
function vaDeferredSend() {
  if (vaSendTimer !== null) { lume.system.clearTimeout(vaSendTimer); vaSendTimer = null; }
  if (vaState() !== 'THINK') return;
  var fn = vaTransport || vaTransportLegacy;
  var stream = (fn === vaTransportWS);   /* WS streaming uses its own completion */
  vaTransportCalls++;
  fn(vaPendingPrompt, function (text, err) {
    if (typeof err === 'number' && err !== 0) { vaFail(err); return; }
    if (stream) vaOnStreamReply(text); else vaOnReply(text);
  });
}
function vaOnStreamReply(text) {
  /* WS deltas already drove the answer signal char-by-char; never restart the
   * canned typewriter or replay the demo beep here. Audio came via playStream. */
  if (vaState() === 'THINK') vaSet('SPEAK');
  vaFullText = String(text === undefined || text === null ? '' : text);
  vaTypingPos.set(vaFullText.length);
  vaTyping.set(false);
  if (vaSpeakTimer !== null) { lume.system.clearTimeout(vaSpeakTimer); vaSpeakTimer = null; }
  vaSpeakTimer = lume.system.setTimeout(vaSpeakDone, 600);
  lume.log('VA WS REPLY chars=' + vaFullText.length + ' audio=' + vaStreamAudioFrames +
    ' deltas=' + vaStreamDeltas);
}
function vaOnReply(text) {
  vaFullText = String(text === undefined || text === null ? '' : text);
  vaTypingPos.set(0);
  if (!vaSet('SPEAK')) return;
  vaTyping.set(true);
  vaPlayReply();
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  vaTypeTimer = lume.system.setInterval(vaTypewriterTick, TYPE_MS);
  if (vaSpeakTimer !== null) { lume.system.clearTimeout(vaSpeakTimer); vaSpeakTimer = null; }
  vaSpeakTimer = lume.system.setTimeout(vaSpeakDone, Math.max(1500, vaFullText.length * TYPE_MS + 1500));
  lume.log('VA SPEAK len=' + vaFullText.length);
}
function vaTypewriterTick() {
  if (vaState() !== 'SPEAK') return;
  var p = vaTypingPos();
  if (p >= vaFullText.length) { vaTyping.set(false); return; }
  /* Integer-only signal write in the timer (typewriter OOM lesson). */
  vaTypingPos.set(p + 1);
}
function vaSpeakDone() {
  if (vaState() !== 'SPEAK') return false;
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  vaTyping.set(false);
  return vaSet('IDLE');
}
function vaFail(code) {
  lume.log('VA ERROR ' + code);
  if (vaState() === 'THINK') vaSet('IDLE');
}
function vaBargeIn() {
  if (vaState() !== 'SPEAK') { lume.log('VA BARGE NOOP'); return false; }
  if (vaTypeTimer !== null) { lume.system.clearInterval(vaTypeTimer); vaTypeTimer = null; }
  if (vaSpeakTimer !== null) { lume.system.clearTimeout(vaSpeakTimer); vaSpeakTimer = null; }
  if (lume.audio && typeof lume.audio.stop === 'function') lume.audio.stop();
  if (vaMode === 'GATEWAY') vaWSAbort();     /* stop mic + deliver end frame */
  vaTyping.set(false);
  var ok = vaSet('IDLE');
  lume.log('VA BARGE IN ok=' + ok);
  return ok;
}
function vaActivate() {
  var s = vaState();
  if (s === 'IDLE') { vaStartListen(); return; }
  if (s === 'LISTEN') { vaSend(); return; }
  if (s === 'SPEAK') { vaBargeIn(); return; }
  lume.log('VA BUSY ' + s);            /* THINK: no action, no illegal jump */
}
function vaLongPress() {
  lume.log('VA LONG PRESS in ' + vaState());
  vaActivate();                        /* push-to-talk wake / send / interrupt */
}
function vaWaveTick() {
  vaWavePhase = (vaWavePhase + 0.35) % 6.2832;
  var s = vaState(), target;
  if (s === 'LISTEN') target = 0.55 + 0.35 * Math.sin(vaWavePhase * 2);
  else if (s === 'SPEAK') target = 0.45 + 0.30 * Math.sin(vaWavePhase * 1.7);
  else target = 0.08;
  vaLevel.set(Math.max(0, Math.min(1, target)));
  vaRev.set(vaRev() + 1);
}
function vaAnswerText() {
  /* r117: time-share the single line. LISTEN/THINK shows "YOU:" + interim
   * transcript; SPEAK shows the assistant's text-delta answer. They never
   * overwrite each other because they live on different timeline phases. */
  var st = vaState();
  if (st === 'LISTEN' || st === 'THINK') {
    vaTxRev();
    var t = vaTxFinal() || vaTxParts.join('');
    if (t.length > VA_TX_MAX_CHARS) t = t.substring(0, VA_TX_MAX_CHARS);
    return t ? 'YOU: ' + t : '';
  }
  var s = vaFullText.substring(0, vaTypingPos());
  return vaTyping() ? s + (vaCursor() ? '|' : ' ') : s;
}

/* ---- UI ---------------------------------------------------------------- */
function vaDraw(ctx) {
  vaRev(); vaLevel();                  /* subscribe to animation signals */
  ctx.fillColor('#0B1624'); ctx.fillRect(0, 0, VA_CW, VA_CH);
  ctx.line(8, VA_CH / 2, VA_CW - 8, VA_CH / 2, '#2C4468', 2);
  var bars = 16, bw = 12, gap = 4, lv = vaLevel();
  var x0 = Math.round((VA_CW - bars * (bw + gap)) / 2);
  var col = lv > 0.7 ? '#FF6B79' : lv > 0.4 ? '#FFD166' : '#40D8B0';
  ctx.fillColor(col);
  for (var i = 0; i < bars; i++) {
    var amp = lv * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.6 + vaWavePhase)));
    var h = Math.max(2, Math.round(amp * (VA_CH - 16)));
    ctx.fillRect(x0 + i * (bw + gap), Math.round((VA_CH - h) / 2), bw, h);
  }
  return [{ x: 0, y: 0, w: VA_CW, h: VA_CH }];
}

/* ---- WebSocket / gateway transport (r108) -------------------------------
 * Thin device-side client for docs/voice-gateway-protocol.md v1. Still just a
 * (prompt, done) slot: the state machine above is untouched. All streaming
 * side effects are small signal writes, never string builds in an audio cb.
 * Frame facts (authoritative: lume.d.ts audio/ws + lume_ws.c): hello first;
 * uplink = 60 ms bare s16le stereo = 3840 B; native recordStream emits 1024
 * stereo-frame = 4096 B chunks, reassembled here; downlink = 8-byte header
 * {v,type=1,format=1,rate:u16,ch=2,bits=16,seq:u8} + <=4608 B PCM. */
var VA_GATEWAY_KEY = 'voice_gateway_url';
var VA_GATEWAY_URL = 'ws://192.168.1.50:18770/';   /* edit here or set the KV key */
var VA_UPLINK_BYTES = 3840;                        /* 60 ms, 16 kHz, s16le stereo */
var VA_STREAM_FRAMES = 3;                          /* push-to-talk window before end */
var VA_PLAY_OPTS = { sampleRate: 16000, channels: 2, bits: 16 };

var vaStreamSession = null;      /* active recordStream session {active,...} */
var vaStreamCarry = new ArrayBuffer(0);            /* <3840 B tail of native chunks */
var vaStreamQueue = [];                            /* wire frames awaiting hello-ack */
var vaStreamText = '';
var vaStreamDeltas = 0, vaStreamAudioFrames = 0, vaStreamUplinkFrames = 0;
var vaStreamLastLogged = 0;
var vaStreamAcked = false, vaStreamEndSent = false, vaStreamFinal = false;
var vaStreamFinished = false;
var vaStreamConn = null, vaStreamDone = null, vaStreamPumpTimer = null;
var vaStreamPendingAudio = null;
var vaTxParts = [];                     /* bounded interim pieces, joined at render only */
var vaStreamTxDeltas = 0;
var VA_TX_MAX_PARTS = 24, VA_TX_MAX_PIECE = 128, VA_TX_MAX_CHARS = 512;

function vaGatewayUrl() {
  var u = null;
  try { u = lume.storage.kv.get(VA_GATEWAY_KEY); } catch (e) { u = null; }
  return (typeof u === 'string' && u) ? u : VA_GATEWAY_URL;
}

/* ---- r117 transcript helpers: callbacks only bump an integer signal ------ */
function vaTxReset() {
  vaTxParts = [];
  vaTxFinal.set('');
  vaTxRev.set(vaTxRev() + 1);
}
function vaTxPush(text) {
  if (typeof text !== 'string' || !text) return;
  if (vaTxParts.length >= VA_TX_MAX_PARTS) vaTxParts.shift();
  vaTxParts.push(text.substring(0, VA_TX_MAX_PIECE));
  vaTxRev.set(vaTxRev() + 1);                    /* integer signal write only */
}
function vaTxSeal(text) {
  var t = typeof text === 'string' ? text : '';
  vaTxParts = [t.substring(0, VA_TX_MAX_CHARS)]; /* final = COMPLETE transcript */
  vaTxFinal.set(vaTxParts[0]);
  vaTxRev.set(vaTxRev() + 1);
}
function vaWSOnTranscript(msg) {
  vaStreamTxDeltas++;
  if (msg.final === true) {
    vaTxSeal(msg.text);
    lume.log('VA WS TRANSCRIPT FINAL n=' + vaStreamTxDeltas +
      ' chars=' + (typeof msg.text === 'string' ? msg.text.length : 0));
  } else {
    vaTxPush(msg.text);
    lume.log('VA WS TRANSCRIPT n=' + vaStreamTxDeltas +
      ' chars=' + (typeof msg.text === 'string' ? msg.text.length : 0));
  }
}

function vaWSReset() {
  vaTxReset();
  vaStreamTxDeltas = 0;
  vaStreamSession = null; vaStreamCarry = new ArrayBuffer(0); vaStreamQueue = [];
  vaStreamText = ''; vaStreamDeltas = 0; vaStreamAudioFrames = 0;
  vaStreamUplinkFrames = 0; vaStreamLastLogged = 0;
  vaStreamAcked = false; vaStreamEndSent = false; vaStreamFinal = false;
  vaStreamFinished = false; vaStreamConn = null; vaStreamDone = null;
  vaStreamPendingAudio = null;
  if (vaStreamPumpTimer !== null) {
    lume.system.clearInterval(vaStreamPumpTimer); vaStreamPumpTimer = null;
  }
}

function vaWSStartMic() {
  if (!lume.audio || typeof lume.audio.recordStream !== 'function') {
    lume.log('VA WS MIC UNAVAILABLE'); return -3;
  }
  var rc = lume.audio.recordStream({
    chunkSamples: 1024,
    onChunk: function (pcm, samples) { vaWSOnChunk(pcm, samples); },
    onError: function (code) { lume.log('VA WS MIC ERR ' + code); }
  });
  if (rc === 0) {
    vaStreamSession = { active: true, chunkSamples: 1024 };
    lume.log('VA WS MIC START');
  } else lume.log('VA WS MIC START ERR ' + rc);
  return rc;
}

/* Reassemble native 4096 B chunks into 3840 B 60 ms wire frames. */
function vaWSOnChunk(pcm, samples) {
  if (!pcm || typeof pcm.byteLength !== 'number' ||
      !vaStreamSession || !vaStreamSession.active) return;
  var total = vaStreamCarry.byteLength + pcm.byteLength;
  var joined = new ArrayBuffer(total), out = new Uint8Array(joined);
  if (vaStreamCarry.byteLength) out.set(new Uint8Array(vaStreamCarry), 0);
  out.set(new Uint8Array(pcm), vaStreamCarry.byteLength);
  var off = 0;
  while (total - off >= VA_UPLINK_BYTES) {
    var frame = new ArrayBuffer(VA_UPLINK_BYTES);
    new Uint8Array(frame).set(out.subarray(off, off + VA_UPLINK_BYTES));
    vaStreamQueue.push(frame); off += VA_UPLINK_BYTES;
  }
  vaStreamCarry = total > off ? joined.slice(off) : new ArrayBuffer(0);
  vaWSFlushUplink();
}

function vaWSFlushUplink() {
  if (!vaStreamConn || !vaStreamAcked) return;          /* no audio before ack */
  while (vaStreamQueue.length) {
    var f = vaStreamQueue.shift();
    if (vaStreamConn.send(f) !== 0) { lume.log('VA WS UPLINK ERR'); return; }
    vaStreamUplinkFrames++;
  }
  if (vaStreamUplinkFrames > vaStreamLastLogged) {
    vaStreamLastLogged = vaStreamUplinkFrames;
    lume.log('VA WS UPLINK frames=' + vaStreamUplinkFrames);
  }
}

function vaWSMicStop() {
  if (vaStreamSession && vaStreamSession.active) {
    if (lume.audio && typeof lume.audio.stopStream === 'function') lume.audio.stopStream();
    vaStreamSession.active = false;
    lume.log('VA WS MIC STOP');
  }
  if (vaStreamConn && vaStreamAcked && !vaStreamEndSent) {
    vaStreamEndSent = true;
    var rc = vaStreamConn.send(JSON.stringify({ v: 1, type: 'end' }));
    lume.log(rc === 0 ? 'VA WS SEND END' : 'VA WS END ERR ' + rc);
  }
}

/* Timer/host-driven pump: flush uplink, retry a full playStream queue, and
 * close the push-to-talk window after a deterministic frame count. */
function vaWSPump() {
  vaWSFlushUplink();
  if (vaStreamPendingAudio) {
    var rc = lume.audio.playStream(vaStreamPendingAudio, VA_PLAY_OPTS);
    if (rc === 0) { vaStreamAudioFrames++; vaStreamPendingAudio = null; }
    else if (rc !== -3) { lume.log('VA WS PLAY RETRY ERR ' + rc); vaStreamPendingAudio = null; }
  }
  if (vaStreamSession && vaStreamSession.active &&
      !vaStreamEndSent && vaStreamUplinkFrames >= VA_STREAM_FRAMES) vaWSMicStop();
}

/* Barge-in: stop capture, deliver end, close socket; do not fire done(). */
function vaWSAbort() {
  vaStreamFinished = true; vaStreamDone = null;   /* before close(): onClose is sync */
  vaWSMicStop();
  if (vaStreamConn) { try { vaStreamConn.close(); } catch (e) {} vaStreamConn = null; }
  if (vaStreamPumpTimer !== null) {
    lume.system.clearInterval(vaStreamPumpTimer); vaStreamPumpTimer = null;
  }
  lume.log('VA WS ABORT');
}

/* Idempotent turn completion (idle frame, close, fatal error). */
function vaWSFinish(err) {
  if (vaStreamFinished) return;
  vaStreamFinished = true;
  vaWSMicStop();
  if (vaStreamPumpTimer !== null) {
    lume.system.clearInterval(vaStreamPumpTimer); vaStreamPumpTimer = null;
  }
  if (vaStreamConn) { try { vaStreamConn.close(); } catch (e) {} vaStreamConn = null; }
  var done = vaStreamDone; vaStreamDone = null;
  if (done) done(err ? null : vaStreamText, err || 0);
}

function vaWSOnDelta(msg) {
  if (vaState() === 'THINK' && vaSet('SPEAK')) vaTyping.set(true);
  if (typeof msg.text === 'string' && msg.text) {
    vaStreamText += msg.text;
    vaFullText = vaStreamText;
    vaTypingPos.set(vaFullText.length);             /* char-by-char on screen */
    lume.log('VA WS DELTA n=' + vaStreamDeltas + ' chars=' + vaFullText.length);
  }
  vaStreamDeltas++;
  if (msg.final === true) vaStreamFinal = true;
}

function vaWSOnAudio(ab) {
  if (!ab || ab.byteLength < 8) { lume.log('VA WS AUDIO SHORT'); return; }
  var dv = new DataView(ab);
  var ver = dv.getUint8(0), typ = dv.getUint8(1), fmt = dv.getUint8(2);
  var rate = dv.getUint16(3, true), ch = dv.getUint8(5), bits = dv.getUint8(6);
  var seq = dv.getUint8(7);
  if (ver !== 1 || typ !== 1 || fmt !== 1 || ch !== 2 || bits !== 16) {
    lume.log('VA WS AUDIO FORMAT ' + ver + '/' + typ + '/' + fmt + '/' + ch + '/' + bits);
    return;
  }
  var pcm = new ArrayBuffer(ab.byteLength - 8);
  new Uint8Array(pcm).set(new Uint8Array(ab, 8));
  lume.log('VA WS AUDIO hdr=1/1/1/' + rate + '/2/16 seq=' + seq + ' bytes=' + pcm.byteLength);
  var rc = lume.audio.playStream(pcm, { sampleRate: rate, channels: ch, bits: bits });
  if (rc === 0) vaStreamAudioFrames++;
  else if (rc === -3) vaStreamPendingAudio = pcm;     /* retry on a later pump */
  else lume.log('VA WS PLAY ERR ' + rc);
}

function vaTransportWS(prompt, done) {
  vaWSReset();
  vaStreamDone = done;
  var url = vaGatewayUrl();
  lume.log('VA WS CONNECT ' + url);
  lume.net.ws.connect(url, {
    onOpen: function (conn) {
      vaStreamConn = conn;
      var hello = { v: 1, type: 'hello',
        device: { model: 'lume', fw: 'r108', app: 'voice_assistant' },
        caps: { audioFormats: ['pcm_s16le_16000_2ch'], streamTranscript: true } };
      lume.log('VA WS HELLO');
      conn.send(JSON.stringify(hello));
      if (vaStreamPumpTimer === null) vaStreamPumpTimer = lume.system.setInterval(vaWSPump, 60);
      vaWSStartMic();
    },
    onMessage: function (data) {
      if (typeof data !== 'string') { vaWSOnAudio(data); return; }
      var msg = null;
      try { msg = JSON.parse(data); } catch (e) { msg = null; }
      if (!msg || typeof msg !== 'object') { lume.log('VA WS BAD JSON'); return; }
      if (msg.type === 'hello-ack') {
        vaStreamAcked = true;
        lume.log('VA WS ACK fmt=' + (msg.audioFormat || '-'));
        vaWSFlushUplink();
      } else if (msg.type === 'text-delta') vaWSOnDelta(msg);
      /* v1.1: consume transcript-delta; unknown downlink types continue to be
       * logged and ignored (old devices simply ignore this new message). */
      else if (msg.type === 'transcript-delta') vaWSOnTranscript(msg);
      else if (msg.type === 'state') {
        lume.log('VA WS STATE ' + msg.state);
        if (msg.state === 'idle') vaWSFinish(0);
      } else if (msg.type === 'error') {
        lume.log('VA WS FRAME ERROR ' + msg.code + ' fatal=' + !!msg.fatal);
        if (msg.fatal) { vaSet('IDLE'); vaWSFinish(-3); }
      } else if (msg.type === 'pong') { /* heartbeat placeholder */ }
      else lume.log('VA WS UNKNOWN ' + msg.type);
    },
    onClose: function () {
      lume.log('VA WS CLOSE');
      if (!vaStreamFinal && !vaStreamFinished) vaSet('IDLE');
      vaWSFinish(vaStreamFinal ? 0 : -3);
    },
    onError: function (code) {
      lume.log('VA WS ERR ' + code);
      vaSet('IDLE'); vaWSFinish(-3);
    }
  }, function (err) {
    if (err) { lume.log('VA WS CONNECT ERR ' + err); vaSet('IDLE'); vaWSFinish(err); }
  });
}

var vaRoot = View({ style: { width: 480, height: 480, background: '#07111D', scroll: 'none' } });
Text({ parent: vaRoot, text: 'LUME VOICE', style: { position: 'absolute', x: 0, y: 34,
  width: 480, height: 34, fontSize: 26, color: '#F2F7FB', textAlign: 'center' } });
Text({ parent: vaRoot, text: function () { return 'MODE ' + vaModeLabel(); },
  style: { position: 'absolute', x: 0, y: 72, width: 480, height: 24,
    fontSize: 14, color: '#9EB3C6', textAlign: 'center' } });
Text({ parent: vaRoot, text: vaState, style: { position: 'absolute', x: 0, y: 110,
  width: 480, height: 58, fontSize: 40, color: '#40D8B0', textAlign: 'center' } });
var vaCanvas = Canvas({ width: VA_CW, height: VA_CH, parent: vaRoot,
  style: { position: 'absolute', x: 80, y: 176 }, onDraw: vaDraw });
Text({ parent: vaRoot, text: vaAnswerText, style: { position: 'absolute', x: 40, y: 344,
  width: 400, height: 62, fontSize: 16, color: '#F2F7FB', textAlign: 'center', longMode: 'wrap' } });
Text({ parent: vaRoot, text: 'TAP TALK / TAP SEND / TAP INTERRUPT',
  style: { position: 'absolute', x: 0, y: 412, width: 480, height: 22,
    fontSize: 12, color: '#9EB3C6', textAlign: 'center' } });
Button({ parent: vaRoot, title: 'TALK', onPress: vaActivate,
  style: { position: 'absolute', x: 170, y: 436, width: 140, height: 40,
    background: '#1C3449', borderRadius: 999, fontSize: 18 } });
lume.gesture.on(vaRoot, 'tap', vaActivate);
lume.gesture.on(vaCanvas, 'tap', vaActivate);
lume.gesture.on(vaRoot, 'longpress', vaLongPress);
lume.gesture.on(vaCanvas, 'longpress', vaLongPress);

/* ---- boot -------------------------------------------------------------- */
vaSetMode(vaDetectMode());
vaCursorTimer = lume.system.setInterval(function () { vaCursor.set(!vaCursor()); }, CURSOR_MS);
var vaWaveTimer = lume.system.setInterval(vaWaveTick, 80);
lume.log('VA READY mode=' + vaMode + ' canned=' + VA_CANNED.length + ' canvas=' + (VA_CW * VA_CH));
