/* Host harness for examples/piano -- runs the app against the firmware prelude.
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

/* 5. 7 white + 5 black keys fit inside the round-screen [75,405] safe square */
assert.equal(c.WHITE_OFFSETS.length, 7);
assert.equal(c.BLACK_KEYS.length, 5);
assert.equal(c.WHITE_W, 46);
assert.equal(c.WHITE_W * 7, 322);
assert.equal(c.KB_X, 79);
assert.ok(c.KB_X >= 75 && c.KB_X + c.WHITE_W * 7 <= 405, 'white key row strictly IN_SAFE [75,405]');
assert.ok(c.KEY_Y >= 75 && c.KEY_Y + c.WHITE_H <= 405, 'white key vertical span strictly IN_SAFE');
assert.ok(c.WHITE_H >= 96 && c.BLACK_H >= 96, 'key heights >= 2x48px');
for (const [x, y] of [[c.KB_X, c.KEY_Y], [c.KB_X + 322, c.KEY_Y],
  [c.KB_X, c.KEY_Y + c.WHITE_H], [c.KB_X + 322, c.KEY_Y + c.WHITE_H]]) {
  assert.ok(Math.hypot(x - 240, y - 240) <= 233, `keyboard corner (${x},${y}) clears R=233 bezel`);
}
for (const b of c.BLACK_KEYS) {
  assert.ok(b.seam >= 0 && b.seam < 6, 'black key sits on a white seam');
  const bx = c.KB_X + (b.seam + 1) * c.WHITE_W - c.BLACK_W / 2;
  assert.ok(bx >= 75 && bx + c.BLACK_W <= 405, 'black key strictly IN_SAFE [75,405]');
}
console.log('PASS piano 7x46px white row + 5 black seam keys fit IN_SAFE [75,405]');

/* 6. tap injects PIANO KEY with name and frequency (white and black keys) */
const kb = c.kbLayer;
ui.gesture(kb, 0, 102, 275, 1000); ui.gesture(kb, 2, 102, 275, 1050);
assert.ok(logs.some(l => /^PIANO KEY C4 freq=261\.63$/.test(l)), logs.join('\n'));
assert.equal(c.lastMidi, 60);
ui.gesture(kb, 0, 125, 200, 1100); ui.gesture(kb, 2, 125, 200, 1150);
assert.ok(logs.some(l => /^PIANO KEY C#4 freq=277\.18$/.test(l)), logs.join('\n'));
assert.equal(c.lastMidi, 61);
console.log('PASS piano tap injection emits PIANO KEY C4 and C#4');

/* 7. highlight changes ATTR_BG_COLOR in place, never rebuilds nodes */
const before = ui.messages.filter(m => m[0] === 'create').length;
const keyNode = c.whiteNodes[0];
const beforeAttr = ui.messages.filter(m => m[0] === 'attr' && m[1] === keyNode && m[2] === 1).length;
ui.gesture(kb, 0, 102, 275, 1200); ui.gesture(kb, 2, 102, 275, 1250);
const afterAttr = ui.messages.filter(m => m[0] === 'attr' && m[1] === keyNode && m[2] === 1).length;
assert.ok(afterAttr > beforeAttr, 'bg attribute written on press');
assert.equal(ui.messages.filter(m => m[0] === 'create').length, before, 'no node rebuild');
console.log('PASS piano highlight is ATTR_BG_COLOR change, no node rebuild');

/* 8. pan glissando crosses keys (distinct notes, deduped per key) */
const start = logs.length;
ui.gesture(kb, 0, 102, 275, 2000);
ui.gesture(kb, 1, 148, 275, 2030);
ui.gesture(kb, 1, 194, 275, 2060);
ui.gesture(kb, 1, 198, 275, 2075);
ui.gesture(kb, 1, 240, 275, 2090);
ui.gesture(kb, 1, 286, 275, 2110);
ui.gesture(kb, 2, 286, 275, 2120);
const emitted = logs.slice(start).filter(l => l.startsWith('PIANO KEY '));
assert.ok(emitted.length >= 4, `glissando emitted ${emitted.length} notes`);
assert.equal(new Set(emitted).size, emitted.length, 'no duplicate note for same key');
console.log('PASS piano pan glissando crosses keys with per-key dedupe');

/* 9. octave switch remaps base MIDI by 12 semitones per step */
c.setOctave(0); assert.equal(c.baseMidi(), 48);
c.setOctave(2); assert.equal(c.baseMidi(), 72);
const oStart = logs.length;
ui.gesture(kb, 0, 102, 275, 3000); ui.gesture(kb, 2, 102, 275, 3050);
assert.ok(logs.slice(oStart).some(l => /^PIANO KEY C5 freq=523\.25$/.test(l)), logs.slice(oStart).join('\n'));
assert.equal(c.octaveLabel(), 'C5');
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
