/* Voice assistant (r74, roadmap E-cut): IDLE -> LISTEN -> THINK -> SPEAK.
 * Streaming mode needs a gateway URL provisioned as kv 'gw_url' (wss:// or
 * ws://). The gateway owns ASR/LLM/TTS and speaks a tiny dual-stream protocol:
 *   up   binary  16 kHz stereo s16le PCM chunks from the microphone
 *   up   text    {"type":"end"} when the user stops talking,
 *                {"type":"barge"} when the user interrupts playback
 *   down text    JSON frames: {"type":"delta","text":str} (typewriter text),
 *                {"type":"state","value":"THINK"|"SPEAK"|"DONE"}
 *   down binary  16 kHz stereo s16le PCM played via audio.playStream
 * Without 'gw_url' the app runs the legacy walkie-talkie: one tap issues one
 * synchronous lume.ai.chat turn (text answer on screen, no local TTS).
 * CALLBACK DISCIPLINE (roadmap, typewriter OOM lesson): ws/audio callbacks
 * only forward bytes and set signals; slicing/feeding playback happens in the
 * 50 ms tick. Zero firmware surface: everything here hot-reloads. */

var vaState = signal('IDLE');   /* IDLE | LISTEN | THINK | SPEAK */
var vaErr = signal('');
var vaTranscript = signal('');
var vaVu = signal(0);           /* 0..1 microphone level for the meter */
var vaRev = signal(0);          /* canvas redraw bump */

var vaGwUrl = lume.storage.kv.get('gw_url');
var vaStreaming = typeof vaGwUrl === 'string' && /^wss?:\/\//.test(vaGwUrl);
var vaSsid = lume.storage.kv.get('wifi_ssid');
var vaPass = lume.storage.kv.get('wifi_pass');
if (typeof vaSsid === 'string' && typeof vaPass === 'string') lume.net.connect(vaSsid, vaPass);
else vaErr.set('Provision wifi_ssid / wifi_pass in NVS');

var vaConn = null;              /* ws handle while a session is up */
var vaPending = null;           /* ArrayBuffer slice head for tick-fed playback */
var vaPendingOfs = 0;
var vaTimer = null;             /* 50 ms tick id, LISTEN/SPEAK only */
var vaDrops = 0;                /* ws send failures while streaming up */
var vaQuestions = [
  'Summarize what an ESP32-S3 can do in two sentences.',
  'Suggest one useful wearable app idea.',
  'Explain one way to save battery on an AMOLED device.'
];
var vaQIndex = 0;

function vaSetState(s) { vaState.set(s); vaRev.set(vaRev() + 1); }

function vaTickStart() {
  if (vaTimer === null) vaTimer = lume.system.setInterval(vaTick, 50);
}
function vaTickStop() {
  if (vaTimer !== null) { lume.system.clearInterval(vaTimer); vaTimer = null; }
}

/* ---- playback feed: <=4608 bytes per playStream call, retried on -3 ---- */
function vaFeed(buf, ofs) {
  var opts = { sampleRate: 16000, channels: 2, bits: 16 };
  while (ofs < buf.byteLength) {
    var end = Math.min(ofs + 4608, buf.byteLength);
    var rc = lume.audio.playStream(buf.slice(ofs, end), opts);
    if (rc === -3) return ofs;                    /* queue full: retry later */
    if (rc < 0) { vaPending = null; vaErr.set('PLAY ERR ' + rc); return -1; }
    ofs = end;
  }
  return ofs;
}

function vaTick() {
  if (vaPending !== null) {
    var ofs = vaFeed(vaPending, vaPendingOfs);
    if (ofs < 0) return;
    if (ofs >= vaPending.byteLength) vaPending = null;
    vaPendingOfs = ofs;
  }
}

/* ---- streaming session ---- */
function vaBeginListen() {
  if (!lume.audio || !lume.audio.recordStream) { vaErr.set('MIC UNAVAILABLE'); return; }
  var rc = lume.audio.recordStream({ chunkSamples: 1024, onChunk: vaChunk, onError: vaMicError });
  if (rc < 0) { vaErr.set('MIC ERR ' + rc); vaSetState('IDLE'); return; }
  vaTranscript.set('');
  vaTickStart();
  vaSetState('LISTEN');
}

function vaChunk(pcm, samples) {
  /* Audio callback: numeric peak + one forward only. No strings, no slicing. */
  if (vaState() !== 'LISTEN' || !vaConn) return;
  var v = new DataView(pcm), peak = 0;
  for (var i = 0; i + 1 < pcm.byteLength; i += 4) {
    var s = v.getInt16(i, true); if (s < 0) s = -s;
    if (s > peak) peak = s;
  }
  vaVu.set(peak / 32768);
  if (vaConn.send(pcm) < 0) vaDrops++;
}

function vaMicError(code) {
  vaTickStop();
  vaErr.set('MIC ERR ' + code);
  vaSetState('IDLE');
}

function vaEndListen() {
  lume.audio.stopStream();
  if (vaConn) vaConn.send(JSON.stringify({ type: 'end' }));
  vaSetState('THINK');
}

function vaBarge() {
  lume.audio.stopStream();
  lume.audio.streamReset();           /* C side kills playback immediately */
  vaPending = null; vaPendingOfs = 0;
  if (vaConn) vaConn.send(JSON.stringify({ type: 'barge' }));
  vaBeginListen();                    /* straight back to LISTEN */
}

function vaTeardown(msg) {
  vaTickStop();
  lume.audio.stopStream();
  lume.audio.streamReset();
  vaConn = null; vaPending = null; vaPendingOfs = 0;
  vaVu.set(0);
  if (msg) vaErr.set(msg);
  vaSetState('IDLE');
}

function vaOnMessage(data) {
  if (typeof data === 'string') {
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (msg.type === 'delta' && typeof msg.text === 'string') {
      vaTranscript.set(vaTranscript() + msg.text);   /* typewriter via deltas */
    } else if (msg.type === 'state' && msg.value === 'THINK') {
      vaSetState('THINK');
    } else if (msg.type === 'state' && msg.value === 'SPEAK') {
      vaSetState('SPEAK');
    } else if (msg.type === 'state' && msg.value === 'DONE') {
      vaTickStop(); vaVu.set(0);
      vaSetState('IDLE');                            /* transcript stays up */
    }
  } else if (data && typeof data === 'object' && data.byteLength > 0) {
    if (vaState() === 'SPEAK') { vaPending = data; vaPendingOfs = 0; }
    /* binary outside SPEAK is ignored (protocol violation, not fatal) */
  }
}

function vaSessionStart() {
  if (!vaStreaming) return;
  vaErr.set('');
  lume.net.ws.connect(vaGwUrl, {
    onOpen: function () { vaBeginListen(); },
    onMessage: vaOnMessage,
    onClose: function () { if (vaState() !== 'IDLE') vaTeardown('GW CLOSED'); },
    onError: function () { if (vaState() !== 'IDLE') vaTeardown('GW ERROR'); }
  }, function (err, handle) {
    if (err) { vaErr.set('GW CONNECT ERR ' + err); vaSetState('IDLE'); }
    else vaConn = handle;
  });
}

/* ---- legacy walkie-talkie: one tap = one synchronous chat turn ---- */
function vaLegacyTalk() {
  if (typeof lume.storage.kv.get('ai_api_key') !== 'string') {
    vaErr.set('Provision ai key in NVS first'); return;
  }
  vaErr.set('');
  vaSetState('THINK');
  var q = vaQuestions[vaQIndex];
  vaQIndex = (vaQIndex + 1) % vaQuestions.length;
  vaTranscript.set('Q: ' + q);
  var r = lume.ai.chat({ messages: [{ role: 'user', content: q }], maxTokens: 512 });
  if (typeof r === 'number') {
    vaErr.set('CHAT ERR ' + r + (r === -1 ? ' (check key/wifi)' : ''));
    vaSetState('IDLE'); vaTranscript.set('');
    return;
  }
  vaTranscript.set(r.content || '(empty response)');
  vaSetState('IDLE');
}

function vaTap() {
  if (!vaStreaming) {                       /* legacy walkie-talkie */
    if (vaState() === 'IDLE') vaLegacyTalk();
    return;
  }
  if (vaState() === 'IDLE') vaSessionStart();
  else if (vaState() === 'LISTEN') vaEndListen();
  else if (vaState() === 'SPEAK') vaBarge();
  /* THINK: taps ignored (chat is in flight on the gateway) */
}

/* ---- UI: 480x480 dark card, badge + meter + transcript ---- */
var vaTheme = { colors: { bg: '#07111D', primary: '#07111D', surface: '#132435', surfaceAlt: '#1C3449', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0' }, radius: 12, spacing: 12, fontScale: 1 };
lume.theme.set(vaTheme);

function vaStateLabel() {
  var s = vaState();
  if (vaStreaming) return s === 'IDLE' ? 'TAP TO TALK' : s === 'LISTEN' ? 'LISTENING' : s === 'THINK' ? 'THINKING' : 'SPEAKING';
  return s === 'IDLE' ? 'WALKIE-TALKIE' : 'THINKING';
}
function vaHint() {
  var s = vaState();
  if (!vaStreaming) return s === 'IDLE' ? 'TAP FOR ONE AI TURN' : 'PLEASE WAIT';
  return s === 'IDLE' ? 'TAP TO TALK' : s === 'LISTEN' ? 'TAP TO STOP' : s === 'THINK' ? 'ONE MOMENT' : 'TAP TO INTERRUPT';
}
function vaMeterDraw(ctx) {
  vaRev(); vaVu();
  ctx.fillColor('#132435'); ctx.fillRect(0, 0, 400, 56);
  var w = Math.round(vaVu() * 396);
  ctx.fillColor(vaVu() > 0.72 ? '#FF6B79' : '#40D8B0');
  ctx.fillRect(2, 2, w, 52);
  return { x: 0, y: 0, w: 400, h: 56 };
}

var vaMeter = Canvas({ width: 400, height: 56, style: { position: 'absolute', x: 40, y: 330 }, onDraw: vaMeterDraw });
var vaRoot = View({ style: { width: '100%', height: '100%', background: 'bg', scroll: 'none' } }, [
  Text({ text: 'VOICE ASSISTANT', style: { position: 'absolute', x: 40, y: 54, width: 400, height: 36, fontSize: 26, color: 'text' } }),
  Text({ text: vaStreaming ? 'GW STREAM' : 'LEGACY CHAT', style: { position: 'absolute', x: 40, y: 100, width: 200, height: 25, fontSize: 14, color: 'textDim' } }),
  Text({ text: function () { return vaErr(); }, style: { position: 'absolute', x: 40, y: 128, width: 400, height: 25, fontSize: 14, color: 'danger' } }),
  Text({ text: function () { return vaStateLabel(); }, style: { position: 'absolute', x: 40, y: 170, width: 400, height: 32, fontSize: 32, color: 'accent' } }),
  Text({ text: function () { return vaHint(); }, style: { position: 'absolute', x: 40, y: 212, width: 400, height: 25, fontSize: 16, color: 'textDim' } }),
  vaMeter,
  Text({ text: function () { return vaTranscript(); }, style: { position: 'absolute', x: 40, y: 400, width: 400, height: 60, fontSize: 16, color: 'text', longMode: 'wrap' } })
]);
lume.gesture.on(vaRoot, 'tap', vaTap);

/* Host-harness introspection handle (tests/voice_assistant.js). Harmless on
 * device: one global, no firmware surface, replaced wholesale on hot reload. */
globalThis.__va = {
  state: vaState, transcript: vaTranscript, err: vaErr, vu: vaVu,
  pending: function () { return vaPending; }, pendingOfs: function () { return vaPendingOfs; }
};
