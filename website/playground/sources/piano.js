/* Single-octave touch piano -- pure app layer, no firmware/protocol changes.
 *
 * AUDIO CONTRACT (verified before coding, see docs/r67-piano-compass-report.md):
 *  - lume.audio.play() is SYNCHRONOUS, 16 kHz / 16-bit / interleaved STEREO.
 *    Mono would be misread as stereo (half the frames, wrong pitch/duration).
 *    The 48 ms figure in gameBeep is a SELF-IMPOSED engine-block budget, not a
 *    firmware cap: lume_audio_play() writes the whole buffer in 4096-B chunks.
 *  - lume.audio.playStream() copies <=4608 B (1152 stereo frames) into a
 *    16-chunk PSRAM queue; it REQUIRES {sampleRate,channels:2,bits:16}.
 *
 * VOICE DESIGN (brief option 1): a single note is ONE continuous envelope
 * split at ATTACK_MS. The <=48 ms head goes out through synchronous play()
 * (immediate sound), the exponentially decaying tail is fed through
 * playStream() in 1152-frame chunks. Both halves are samples of the SAME
 * envelope function, so the amplitude is continuous at the handoff (no click
 * by construction). streamReset() cuts the previous note before a new one.
 * If on-board acceptance ever hears a handoff artefact, the documented
 * fallback is brief option 2: feed the WHOLE envelope through playStream().
 *
 * Layout (r219): 7 white keys x 46 px = 322 px centered at x=79 ([79..401])
 * inside the 480 px round-screen safe square [75..405] (7 * 48 = 336 > 330,
 * so 46 px is the widest symmetric even key width inside [76..404]; height is
 * 190 px >= 2*48). 5 black keys (28x114) sit over the C/D/F/G/A seams.
 * Single-point touch only; pan gestures sweep across keys for glissando.
 * Key highlight is an in-place ATTR_BG_COLOR change on a persistent node --
 * never a node rebuild and never a per-frame redraw.
 *
 * Conservative global script: var / function only, no import/export.
 * HUD stays ASCII (the bundled font has no symbol glyphs). */
var SR = 16000;                 /* only rate play() accepts */
var NOTE_MS = 400;              /* one note envelope: 6400 stereo frames */
var ATTACK_MS = 40;             /* <= 48 ms synchronous engine block */
var CHUNK_FRAMES = 1152;        /* 1152 * 4 B = 4608 B playStream cap */
var PEAK = 11000;               /* int16 headroom with 3 harmonics */
var STREAM_OPTS = { sampleRate: SR, channels: 2, bits: 16 };

var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
/* Single octave from a base C. White key -> semitone offset; black keys carry
 * the white-seam index they sit on. */
var WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
var BLACK_KEYS = [
  { seam: 0, off: 1 }, { seam: 1, off: 3 },
  { seam: 3, off: 6 }, { seam: 4, off: 8 }, { seam: 5, off: 10 }
];
var OCTAVE_LABELS = ['C3', 'C4', 'C5'];
var OCTAVE_BASE = [48, 60, 72]; /* MIDI of the base C for each octave */

/* ---- pure synthesis / mapping helpers (host-harness visible) ----------- */
function pianoFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function pianoNoteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function pianoNoteFrames(ms) { return Math.floor(SR * ms / 1000); }
/* Attack ramp (4 ms) x exponential decay (tau = 120 ms), one function for
 * both halves so the play -> playStream junction is amplitude-continuous. */
function pianoEnvelope(frame) {
  var t = frame / SR;
  return Math.min(1, t / 0.004) * Math.exp(-t / 0.12);
}
/* One sample of additive piano-ish tone (fundamental + 2 harmonics). */
function pianoSample(freq, frame) {
  var t = frame / SR, w = 2 * Math.PI * freq * t;
  var s = Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.25 * Math.sin(3 * w);
  return PEAK * (s / 1.75) * pianoEnvelope(frame);
}
/* Build a full note as signed LE stereo 16-bit PCM (L = R = mono sample). */
function pianoBuildPcm(freq, ms) {
  var frames = pianoNoteFrames(ms), pcm = new ArrayBuffer(frames * 4), v = new DataView(pcm);
  for (var i = 0; i < frames; i++) {
    var s = Math.max(-32767, Math.min(32767, Math.round(pianoSample(freq, i))));
    v.setInt16(i * 4, s, true); v.setInt16(i * 4 + 2, s, true);
  }
  return pcm;
}
/* Slice [from,to) stereo frames out of a full note into a fresh ArrayBuffer. */
function pianoSlice(pcm, from, to) {
  var out = new ArrayBuffer((to - from) * 4);
  new Uint8Array(out).set(new Uint8Array(pcm, from * 4, (to - from) * 4));
  return out;
}
function pianoMidiAt(base, semitone) { return base + semitone; }
/* White key index for an absolute screen x, or -1 outside the keyboard. */
var KB_X = 44, WHITE_W = 56;
function pianoKeyAtX(x) {
  var i = Math.floor((x - KB_X) / WHITE_W);
  return i >= 0 && i < WHITE_OFFSETS.length ? i : -1;
}

/* APP UI */
var octaveIndex = 1;            /* default single-octave keyboard C4..B4 */
var lastMidi = -1, lastNote = signal('--');
var octaveLabel = signal(OCTAVE_LABELS[octaveIndex]);
var highlightMidi = -1, highlightRev = signal(0), hlTimer = null;
/* r233: square-screen single octave [44..436, 112..360] (7 x 56 px = 392 px). */
var KEY_Y = 112, WHITE_H = 248, BLACK_W = 34, BLACK_H = 148;
var WHITE_OFF = '#F2F7FB', WHITE_ON = '#FFD166';
var BLACK_OFF = '#1B2436', BLACK_ON = '#40D8B0';
/* Text nodes have no color attribute in this prelude (always white), so key
 * letters sit on a dark chip to stay readable on a white key. */
var whiteNodes = [], blackNodes = [];

function baseMidi() { return OCTAVE_BASE[octaveIndex]; }
function setOctave(i) {
  octaveIndex = ((i % OCTAVE_LABELS.length) + OCTAVE_LABELS.length) % OCTAVE_LABELS.length;
  octaveLabel.set(OCTAVE_LABELS[octaveIndex]);
  highlightMidi = -1; highlightRev.set(highlightRev() + 1);
  lume.log('PIANO OCTAVE ' + OCTAVE_LABELS[octaveIndex]);
}
function highlight(midi) {
  highlightMidi = midi; highlightRev.set(highlightRev() + 1);
  if (hlTimer !== null) lume.system.clearTimeout(hlTimer);
  hlTimer = lume.system.setTimeout(function () {
    highlightMidi = -1; highlightRev.set(highlightRev() + 1); hlTimer = null;
  }, 130);
}
function audioAvailable() { return !!(lume.audio && lume.audio.play && lume.audio.playStream); }
function playVoice(freq) {
  if (!audioAvailable()) return;
  var pcm = pianoBuildPcm(freq, NOTE_MS);
  var attackFrames = pianoNoteFrames(ATTACK_MS), frames = pianoNoteFrames(NOTE_MS);
  try {
    if (lume.audio.streamReset) lume.audio.streamReset();
    lume.audio.play(pianoSlice(pcm, 0, attackFrames));
    for (var a = attackFrames; a < frames; a += CHUNK_FRAMES)
      lume.audio.playStream(pianoSlice(pcm, a, Math.min(a + CHUNK_FRAMES, frames)), STREAM_OPTS);
  } catch (e) { lume.log('PIANO AUDIO ERR ' + e); }
}
var demoBusy = false;
function pressKey(semitone) {
  var midi = pianoMidiAt(baseMidi(), semitone);
  var freq = pianoFreq(midi), name = pianoNoteName(midi);
  lastMidi = midi; lastNote.set(name);
  highlight(midi);
  lume.log('PIANO KEY ' + name + ' freq=' + freq.toFixed(2));
  playVoice(freq);
}

/* ---- demo melody: Twinkle Twinkle (relative semitones from base C) ------ */
var TWINKLE = [0,0,7,7,9,9,7, 5,5,4,4,2,2,0, 7,7,5,5,4,4,2, 7,7,5,5,4,4,2, 0,0,7,7,9,9,7, 5,5,4,4,2,2,0];
var demoNote = 0, demoTimer = null;
function demoStep() {
  if (demoNote >= TWINKLE.length) { demoStop(); return; }
  pressKey(TWINKLE[demoNote++]);
}
function demoStart() {
  if (demoBusy) { demoStop(); return; }
  demoBusy = true; demoNote = 0; demoStep();
  demoTimer = lume.system.setInterval(demoStep, 280);
  lume.log('PIANO DEMO START');
}
function demoStop() {
  if (demoTimer !== null) { lume.system.clearInterval(demoTimer); demoTimer = null; }
  if (demoBusy) { demoBusy = false; lume.log('PIANO DEMO STOP'); }
}

/* ---- keyboard nodes (persistent; only bg attribute changes on touch) --- */
var root = View({ style: { width: 480, height: 480, background: '#0A1020', scroll: 'none' } });
for (var wi = 0; wi < WHITE_OFFSETS.length; wi++) {
  (function (i) {
    whiteNodes[i] = View({ parent: root, style: {
      position: 'absolute', x: KB_X + i * WHITE_W, y: KEY_Y, width: WHITE_W, height: WHITE_H,
      borderRadius: 6, borderWidth: 1, borderColor: '#9FB0CC',
      background: function () { highlightRev(); return highlightMidi === pianoMidiAt(baseMidi(), WHITE_OFFSETS[i]) ? WHITE_ON : WHITE_OFF; }
    } });
    View({ parent: root, style: { position: 'absolute', x: KB_X + i * WHITE_W + 16, y: KEY_Y + WHITE_H - 32,
      width: 24, height: 22, borderRadius: 4, background: '#1B2436' } });
    Text({ parent: root, text: NOTE_NAMES[WHITE_OFFSETS[i] % 12], style: {
      position: 'absolute', x: KB_X + i * WHITE_W + 16, y: KEY_Y + WHITE_H - 30,
      width: 24, height: 18, fontSize: 12, textAlign: 'center'
    } });
  })(wi);
}
for (var bi = 0; bi < BLACK_KEYS.length; bi++) {
  (function (b) {
    var bx = KB_X + (b.seam + 1) * WHITE_W - BLACK_W / 2;
    blackNodes.push(View({ parent: root, style: {
      position: 'absolute', x: bx, y: KEY_Y, width: BLACK_W, height: BLACK_H,
      borderRadius: 5,
      background: function () { highlightRev(); return highlightMidi === pianoMidiAt(baseMidi(), b.off) ? BLACK_ON : BLACK_OFF; }
    } }));
  })(BLACK_KEYS[bi]);
}
var kbLayer = View({ parent: root, style: {
  position: 'absolute', x: KB_X, y: KEY_Y, width: WHITE_W * WHITE_OFFSETS.length, height: WHITE_H
} });
Text({ parent: root, text: 'TOUCH PIANO', style: { position: 'absolute', x: 44, y: 40, width: 392, height: 28,
  fontSize: 24, color: '#F2F7FB', textAlign: 'center', borderRadius: 0 } });
Text({ parent: root, text: function () { return 'OCT ' + octaveLabel() + '   LAST ' + lastNote(); },
  style: { position: 'absolute', x: 44, y: 74, width: 392, height: 24,
    fontSize: 16, color: '#FFD78E', textAlign: 'center', borderRadius: 0 } });
/* All four controls share one 52px-tall square row (x=44..436, y=380..432). */
Button({ parent: root, title: 'DEMO', onPress: demoStart,
  style: { position: 'absolute', x: 44, y: 380, width: 92, height: 52,
    background: '#1F2C3D', borderRadius: 8, fontSize: 14, color: '#F2F7FB' } });
for (var oi = 0; oi < OCTAVE_LABELS.length; oi++) {
  (function (k) {
    Button({ parent: root, title: OCTAVE_LABELS[k], onPress: function () { setOctave(k); },
      style: { position: 'absolute', x: 144 + k * 100, y: 380, width: 92, height: 52,
        background: '#1F2C3D', borderRadius: 8, fontSize: 14, color: '#F2F7FB' } });
  })(oi);
}

/* Tap and pan are both registered on the transparent hit layer above keys. */
var panLast = -1;
function blackAtX(x) {
  for (var i = 0; i < BLACK_KEYS.length; i++) {
    var bx = KB_X + (BLACK_KEYS[i].seam + 1) * WHITE_W - BLACK_W / 2;
    if (x >= bx && x <= bx + BLACK_W) return BLACK_KEYS[i];
  }
  return null;
}
function semitoneAt(x, y) {
  if (y === undefined || y <= KEY_Y + BLACK_H) {
    var b = blackAtX(x);
    if (b) return b.off;
  }
  var w = pianoKeyAtX(x);
  return w < 0 ? -1 : WHITE_OFFSETS[w];
}
function triggerSemitone(s) { if (s >= 0) pressKey(s); }
lume.gesture.on(kbLayer, 'tap', function (e) { triggerSemitone(semitoneAt(e.x, e.y)); });
lume.gesture.on(kbLayer, 'panstart', function (e) { panLast = semitoneAt(e.x, e.y); triggerSemitone(panLast); });
lume.gesture.on(kbLayer, 'pan', function (e) {
  var s = semitoneAt(e.x, e.y);
  if (s >= 0 && s !== panLast) { panLast = s; triggerSemitone(s); }
  else if (s < 0) panLast = -1;
});
lume.gesture.on(kbLayer, 'panend', function () { panLast = -1; });

lume.app.onPause(demoStop);
lume.log('PIANO READY keys=12 oct=' + OCTAVE_LABELS[octaveIndex] + ' note_ms=' + NOTE_MS);
