/* r225 evidence tool: dump per-face draw messages + host RGB565 framebuffers.
 * Usage: node artifacts/r225/dump_frames.js <out-prefix>
 * Reads the real example and firmware prelude through tests/lib/prelude_runner.
 * The rasterizer is a deterministic host mirror of the message stream; because
 * singleBuffer changes only the createNode flag, identical messages imply
 * identical pixels. Before/after .bin files are byte-compared by the report. */
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { runApp } = require('../../tests/lib/prelude_runner');
const prefix = process.argv[2] || 'artifacts/r225/dump';

let source = fs.readFileSync('examples/watchface/app.js', 'utf8');
/* Pin the boot clock so hand positions / Text effects are reproducible across
 * before/after runs. PRE_MIGRATION strips only the two singleBuffer flags. */
source = source.replace('signal(new Date())', 'signal(new Date(2026,0,1,10,31,0))');
if (process.env.PRE_MIGRATION) source = source.replace(/singleBuffer: true, /g, '');
const h = runApp(source);
const ctx = h.ctx;
const creates = h.messages.filter(m => m[0] === 'create' && m[2] === 3);
const faceNames = ['digital', 'analog', 'rings', 'goals'];
const faces = creates.map((m, i) => ({
  name: faceNames[i] || `canvas${i}`, id: m[1], w: m[4], h: m[5],
  single: (m[6] & 1) === 1, flags: m[6] === undefined ? 0 : m[6],
  px: new Uint16Array(m[4] * m[5]),
  paths: new Map(), sprites: new Map(),
}));
const byId = new Map(faces.map(f => [f.id, f]));

/* ---- minimal deterministic RGB565 replay of the bridge message stream ---- */
function plot(face, x, y, color) {
  if (x < 0 || y < 0 || x >= face.w || y >= face.h) return;
  face.px[y * face.w + x] = color & 0xffff;
}
function line(face, x1, y1, x2, y2, color) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(face, x1, y1, color);
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x1 += sx; }
    if (e2 <= dx) { err += dx; y1 += sy; }
  }
}
function rect(face, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < Math.min(face.h, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(face.w, x + w); xx++) plot(face, xx, yy, color);
}
function circle(face, cx, cy, r, color, fill) {
  for (let y = Math.max(0, cy - r - 1); y <= Math.min(face.h - 1, cy + r + 1); y++)
    for (let x = Math.max(0, cx - r - 1); x <= Math.min(face.w - 1, cx + r + 1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (fill ? d <= r : Math.abs(d - r) <= 0.75) plot(face, x, y, color);
    }
}
function arc(face, cx, cy, r, from, to, width, color) {
  for (let deg = from; deg <= to; deg += 0.5) {
    const a = (deg - 90) * Math.PI / 180;
    circle(face, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r),
      Math.max(0, (width - 1) / 2), color, true);
  }
}
function apply(m) {
  const face = byId.get(m[1]);
  if (!face) return;
  if (m[0] === 'draw') {
    const op = m[2];
    if (op === 0) face.px.fill(0);
    else if (op === 1) rect(face, m[3], m[4], m[5], m[6], m[7]);
    else if (op === 3) circle(face, m[3], m[4], m[5], m[6], false);
    else if (op === 5) arc(face, m[3], m[4], m[5], m[9], m[10], m[8], m[7]);
    else if (op === 6) circle(face, m[3], m[4], m[5], m[6], true);
    else if (op === 7) {
      for (let y = -m[6]; y <= m[6]; y++) for (let x = -m[5]; x <= m[5]; x++)
        if ((x * x) / (m[5] * m[5]) + (y * y) / (m[6] * m[6]) <= 1)
          plot(face, m[3] + x, m[4] + y, m[7]);
    }
  } else if (m[0] === 'batch') {
    for (let k = 0; k < m[2].length; k += 6)
      line(face, m[2][k], m[2][k + 1], m[2][k + 2], m[2][k + 3], m[2][k + 4]);
  } else if (m[0] === 'pathDefine') {
    face.paths.set(m[2], m[3]);
  } else if (m[0] === 'pathDraw') {
    const segs = face.paths.get(m[2]) || [];
    for (let k = 0; k < segs.length; k += 6)
      line(face, segs[k] + m[3], segs[k + 1] + m[4], segs[k + 2] + m[3], segs[k + 3] + m[4], segs[k + 4]);
  } else if (m[0] === 'spriteDefine') {
    face.sprites.set(m[2], [m[3], m[4], m[5]]);
  } else if (m[0] === 'spriteDraw') {
    const s = face.sprites.get(m[2]); if (!s) return;
    for (let y = 0; y < s[1]; y++) for (let x = 0; x < s[2]; x++)
      plot(face, m[3] + (m[5] ? s[2] - 1 - x : x), m[4] + y, s[3][y * s[2] + x]);
  }
}
for (const m of h.messages) apply(m);

const hash = buf => crypto.createHash('sha256').update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)).digest('hex').slice(0, 16);
const snap = () => Object.fromEntries(faces.map(f => [f.name, hash(f.px)]));
/* Normalise away only the createNode flags argument (the single difference
 * introduced by singleBuffer) so the remaining message stream must match. */
const normalized = h.messages.map(m => m[0] === 'create' ? m.slice(0, 6) : m);
const streamHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
const out = { faces: faces.map(f => ({ name: f.name, id: f.id, w: f.w, h: f.h, flags: f.flags, single: f.single })), streamHash, frames: [] };
console.log('CANVASES: ' + JSON.stringify(out.faces));
console.log('NORMALIZED message-stream sha256: ' + streamHash);
console.log('Budget px (1x faces at half cost): ' +
  faces.reduce((s, f) => s + f.w * f.h * (f.single ? 0.5 : 1), 0) + '/230400');

/* advance the app clock one second per frame through the real faceTick path */
let t = new Date(2026, 0, 1, 10, 31, 0).getTime();
h.lume._nowMs = () => t;
const RealDate = vm.runInContext('Date', ctx);
function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(t); }
FakeDate.now = () => t;
FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
ctx.Date = FakeDate;

const FRAMES = 6;
for (let i = 0; i < FRAMES; i++) {
  t += 1000;
  const start = h.messages.length;
  vm.runInContext('faceTick()', ctx);
  const msgs = h.messages.slice(start);
  for (const m of msgs) apply(m);
  const row = { frame: i, hashes: snap(), perFace: {} };
  for (const f of faces) {
    const fm = msgs.filter(m => m[1] === f.id);
    const invalidates = fm.filter(m => m[0] === 'invalidate');
    row.perFace[f.name] = {
      draws: fm.filter(m => m[0] === 'draw').length,
      ops: fm.filter(m => m[0] === 'draw').map(m => m[2]),
      batches: fm.filter(m => m[0] === 'batch').length,
      pathDefines: fm.filter(m => m[0] === 'pathDefine').length,
      pathDraws: fm.filter(m => m[0] === 'pathDraw').length,
      spriteDefines: fm.filter(m => m[0] === 'spriteDefine').length,
      spriteDraws: fm.filter(m => m[0] === 'spriteDraw').length,
      invalidates: invalidates.map(m => m.length === 2
        ? 'FULL' : `RECT(${m[2]},${m[3]},${m[4]},${m[5]})=${m[4] * m[5]}px`),
      messages: fm.length,
    };
    fs.writeFileSync(`${prefix}-${f.name}-frame${i}.rgb565.bin`, Buffer.from(f.px.buffer));
  }
  out.frames.push(row);
  console.log(`FRAME ${i} t=${new Date(t).toISOString()}: ` + JSON.stringify(row.perFace));
  console.log(`FRAME ${i} RGB565 hashes: ` + JSON.stringify(row.hashes));
}
out.fullStreamHash = crypto.createHash('sha256')
  .update(JSON.stringify(h.messages.map(m => m[0] === 'create' ? m.slice(0, 6) : m))).digest('hex');
console.log('FULL normalized message-stream sha256 (boot + 6 ticks): ' + out.fullStreamHash);
fs.writeFileSync(`${prefix}.json`, JSON.stringify(out, null, 2));
console.log('WROTE ' + prefix + '.json and ' + (faces.length * FRAMES) + ' RGB565 .bin files');
