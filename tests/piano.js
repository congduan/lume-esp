/* Host harness for examples/piano — runs the app against the firmware prelude.
 * Standalone CommonJS script (same shape as tests/games.js); run: node tests/piano.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/piano/app.js', 'utf8');
const logs = [];
const ui = runApp(source, { onLog: s => logs.push(s) });
const c = ui.ctx;

/* 1. note -> frequency table (equal temperament, A4 = 440) */
for (const [midi, hz, name] of [[60, 440 * Math.pow(2, -9 / 12), 'C4'],
  [61, 440 * Math.pow(2, -8 / 12), 'C#4'], [69, 440, 'A4'],
  [72, 523.2511306011972, 'C5'], [73, 554.3652619537442, 'C#5'], [83, 987.7666025122483, 'B5']]) {
  assert.ok(Math.abs(c.pianoFreq(midi) - hz) < 1e-9, `freq ${midi}`);
  assert.equal(c.pianoNoteName(midi), name, `name ${midi}`);
}
console.log('PASS piano note->frequency and note-name table');

/* 2. envelope sample count == duration(ms) * sample rate / 1000 */
assert.equal(c.SR, 16000);
assert.equal(c.NOTE_MS, 400);
assert.equal(c.pianoNoteFrames(400), 6400);
assert.equal(c.pianoNoteFrames(c.ATTACK_MS), 640);
assert.ok(c.ATTACK_MS <= 48, 'synchronous play() block budget');
assert.equal((6400 - 640) / c.CHUNK_FRAMES, 5, 'release = 5 x 1152-frame chunks');
assert.equal(c.CHUNK_FRAMES * 4, 4608, 'playStream 4608-byte cap');
console.log('PASS piano envelope sample count, attack budget and stream chunking');

/* 3. single continuous envelope: amplitude continuous at play->playStream seam */
const seamFrame = c.pianoNoteFrames(c.ATTACK_MS);
assert.ok(Math.abs(c.pianoEnvelope(seamFrame) - c.pianoEnvelope(seamFrame - 1)) < 0.002);
assert.ok(c.pianoEnvelope(10) < c.pianoEnvelope(200), 'attack ramps up');
assert.ok(c.pianoEnvelope(1000) > c.pianoEnvelope(4000), 'decay falls after peak');
console.log('PASS piano envelope continuity at handoff and decay shape');

/* 4. PCM buffer is stereo 16-bit LE with duplicated L/R channels */
const pcm = c.pianoBuildPcm(440, 400);
assert.equal(pcm.byteLength, 6400 * 4);
const v = new DataView(pcm);
for (const i of [0, 100, 640, 4000, 6399]) assert.equal(v.getInt16(i * 4, true), v.getInt16(i * 4 + 2, true));
assert.ok(Math.abs(v.getInt16(0, true)) < 100, 'attack starts near zero');
console.log('PASS piano stereo 16-bit LE PCM, L=R, soft attack');

/* 5. 14 white + 10 black keys fit 480 px on one row */
assert.equal(c.WHITE_OFFSETS.length, 14);
assert.equal(c.BLACK_KEYS.length, 10);
assert.equal(c.WHITE_W * 14, 476);
assert.ok(c.KB_X + 476 <= 480);
for (const b of c.BLACK_KEYS) assert.ok(b.seam >= 0 && b.seam < 13, 'black key sits on a white seam');
console.log('PASS piano 14x34px white row + 10 black seam keys fit 480px');

/* 6. tap injects PIANO KEY with name and frequency */
const kb = c.kbLayer;
ui.gesture(kb, 0, 240, 275, 1000); ui.gesture(kb, 2, 240, 275, 1050);
assert.ok(logs.some(l => /^PIANO KEY C5 freq=523\.25$/.test(l)), logs.join('\n'));
assert.equal(c.lastMidi, 72);
console.log('PASS piano tap injection emits PIANO KEY C5 freq=523.25');

/* 7. highlight changes ATTR_BG_COLOR in place, never rebuilds nodes */
const before = ui.messages.filter(m => m[0] === 'create').length;
const keyNode = c.whiteNodes[7];
const beforeAttr = ui.messages.filter(m => m[0] === 'attr' && m[1] === keyNode && m[2] === 1).length;
ui.gesture(kb, 0, 100, 275, 1200); ui.gesture(kb, 2, 100, 275, 1250);
const afterAttr = ui.messages.filter(m => m[0] === 'attr' && m[1] === keyNode && m[2] === 1).length;
assert.ok(afterAttr > beforeAttr, 'bg attribute written on press');
assert.equal(ui.messages.filter(m => m[0] === 'create').length, before, 'no node rebuild');
console.log('PASS piano highlight is ATTR_BG_COLOR change, no node rebuild');

/* 8. pan glissando crosses keys (distinct notes, deduped per key) */
const start = logs.length;
ui.gesture(kb, 0, 100, 275, 2000);
ui.gesture(kb, 1, 140, 275, 2030);
ui.gesture(kb, 1, 240, 275, 2060);
ui.gesture(kb, 1, 300, 275, 2090);
ui.gesture(kb, 2, 300, 275, 2120);
const emitted = logs.slice(start).filter(l => l.startsWith('PIANO KEY '));
assert.ok(emitted.length >= 2, `glissando emitted ${emitted.length} notes`);
assert.equal(new Set(emitted).size, emitted.length, 'no duplicate note for same key');
console.log('PASS piano pan glissando crosses keys with per-key dedupe');

/* 9. octave switch remaps base MIDI by 12 semitones per step */
c.setOctave(0); assert.equal(c.baseMidi(), 48);
c.setOctave(2); assert.equal(c.baseMidi(), 72);
const oStart = logs.length;
ui.gesture(kb, 0, 240, 275, 3000); ui.gesture(kb, 2, 240, 275, 3050);
assert.ok(logs.slice(oStart).some(l => /^PIANO KEY C6 freq=1046\.50$/.test(l)), logs.slice(oStart).join('\n'));
assert.equal(c.octaveLabel(), 'C5-C6');
c.setOctave(1);
console.log('PASS piano octave switch maps C4->C3/C5 (12-semitone steps)');

/* 10. demo melody button schedules timed notes and is stoppable */
const dStart = logs.length;
c.demoStart();
assert.ok(logs.slice(dStart).some(l => l === 'PIANO DEMO START'));
assert.ok(logs.slice(dStart).some(l => l.startsWith('PIANO KEY ')));
assert.equal(c.demoBusy, true);
c.demoStop();
assert.equal(c.demoBusy, false);
console.log('PASS piano demo melody starts/stops and plays notes');

console.log('PASS piano host harness: 10/10 assertions');
