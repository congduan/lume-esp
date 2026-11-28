/* r228 480px equivalence evidence (host, deterministic mirror of the bridge).
 * Before = origin/main (r227, no singleBuffer); after = merged worktree.
 * Both run the frozen-clock watchface at 480 logical px through the real
 * firmware prelude in tests/lib/prelude_runner.js. Compares the raw bridge
 * message streams (normalizing only the createNode singleBuffer flag) and the
 * RGB565 framebuffers byte-for-byte across boot + 6 faceTick frames.
 * Usage: node artifacts/r228/equivalence.js
 */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = process.cwd();
const beforeSrc = execFileSync('git', ['show', 'origin/main:examples/watchface/app.js'],
  { cwd: root, encoding: 'utf8' });
const afterSrc = fs.readFileSync('examples/watchface/app.js', 'utf8');
const PIN = s => s.replace('signal(new Date())', 'signal(new Date(2026,0,1,10,31,0))');

/* ---- minimal deterministic RGB565 replay (from artifacts/r225/dump_frames.js) ---- */
function makeRunner(source) {
  const h = runApp(PIN(source));
  const ctx = h.ctx;
  const creates = h.messages.filter(m => m[0] === 'create' && m[2] === 3);
  const names = ['digital', 'analog', 'rings', 'goals'];
  const faces = creates.map((m, i) => ({
    name: names[i] || `canvas${i}`, id: m[1], w: m[4], h: m[5],
    single: (m[6] || 0) & 1, flags: m[6] === undefined ? 0 : m[6],
    px: new Uint16Array(m[4] * m[5]), paths: new Map(), sprites: new Map(),
  }));
  const byId = new Map(faces.map(f => [f.id, f]));
  const plot = (f, x, y, c) => {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
    f.px[y * f.w + x] = c & 0xffff;
  };
  const line = (f, x1, y1, x2, y2, c) => {
    x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
    const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(f, x1, y1, c);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x1 += sx; }
      if (e2 <= dx) { err += dx; y1 += sy; }
    }
  };
  const rect = (f, x, y, w, h, c) => {
    for (let yy = Math.max(0, y); yy < Math.min(f.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(f.w, x + w); xx++) plot(f, xx, yy, c);
  };
  const circle = (f, cx, cy, r, c, fill) => {
    for (let y = Math.max(0, cy - r - 1); y <= Math.min(f.h - 1, cy + r + 1); y++)
      for (let x = Math.max(0, cx - r - 1); x <= Math.min(f.w - 1, cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (fill ? d <= r : Math.abs(d - r) <= 0.75) plot(f, x, y, c);
      }
  };
  const arc = (f, cx, cy, r, from, to, wd, c) => {
    for (let deg = from; deg <= to; deg += 0.5) {
      const a = (deg - 90) * Math.PI / 180;
      circle(f, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r),
        Math.max(0, (wd - 1) / 2), c, true);
    }
  };
  const apply = m => {
    const f = byId.get(m[1]);
    if (!f) return;
    if (m[0] === 'draw') {
      const op = m[2];
      if (op === 0) f.px.fill(0);
      else if (op === 1) rect(f, m[3], m[4], m[5], m[6], m[7]);
      else if (op === 3) circle(f, m[3], m[4], m[5], m[6], false);
      else if (op === 5) arc(f, m[3], m[4], m[5], m[9], m[10], m[8], m[7]);
      else if (op === 6) circle(f, m[3], m[4], m[5], m[6], true);
      else if (op === 7) {
        for (let y = -m[6]; y <= m[6]; y++) for (let x = -m[5]; x <= m[5]; x++)
          if ((x * x) / (m[5] * m[5]) + (y * y) / (m[6] * m[6]) <= 1)
            plot(f, m[3] + x, m[4] + y, m[7]);
      }
    } else if (m[0] === 'batch') {
      for (let k = 0; k < m[2].length; k += 6)
        line(f, m[2][k], m[2][k + 1], m[2][k + 2], m[2][k + 3], m[2][k + 4]);
    } else if (m[0] === 'pathDefine') {
      f.paths.set(m[2], m[3]);
    } else if (m[0] === 'pathDraw') {
      const segs = f.paths.get(m[2]) || [];
      for (let k = 0; k < segs.length; k += 6)
        line(f, segs[k] + m[3], segs[k + 1] + m[4], segs[k + 2] + m[3], segs[k + 3] + m[4], segs[k + 4]);
    } else if (m[0] === 'spriteDefine') {
      f.sprites.set(m[2], [m[3], m[4], m[5]]);
    } else if (m[0] === 'spriteDraw') {
      const s = f.sprites.get(m[2]); if (!s) return;
      for (let y = 0; y < s[1]; y++) for (let x = 0; x < s[2]; x++)
        plot(f, m[3] + (m[5] ? s[2] - 1 - x : x), m[4] + y, s[3][y * s[2] + x]);
    }
  };
  for (const m of h.messages) apply(m);

  let t = new Date(2026, 0, 1, 10, 31, 0).getTime();
  h.lume._nowMs = () => t;
  const RealDate = vm.runInContext('Date', ctx);
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(t); }
  FakeDate.now = () => t;
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
  ctx.Date = FakeDate;

  const frames = [];
  for (let i = 0; i < 6; i++) {
    t += 1000;
    const start = h.messages.length;
    vm.runInContext('faceTick()', ctx);
    for (const m of h.messages.slice(start)) apply(m);
    frames.push(faces.map(f => Uint16Array.from(f.px)));
  }
  return { h, faces, frames };
}

const norm = msgs => msgs.map(m => m[0] === 'create' ? m.slice(0, 6) : m);
const sha = xs => crypto.createHash('sha256').update(JSON.stringify(xs)).digest('hex');
const before = makeRunner(beforeSrc);
const after = makeRunner(afterSrc);

console.log('BEFORE canvases: ' + JSON.stringify(before.faces.map(f => [f.name, f.w, f.h, f.flags])));
console.log('AFTER  canvases: ' + JSON.stringify(after.faces.map(f => [f.name, f.w, f.h, f.flags])));
console.log('RAW message count before/after: ' + before.h.messages.length + '/' + after.h.messages.length);
const rawDiff = [];
for (let i = 0; i < Math.max(before.h.messages.length, after.h.messages.length); i++) {
  const a = JSON.stringify(before.h.messages[i]), b = JSON.stringify(after.h.messages[i]);
  if (a !== b) rawDiff.push({ i, before: a, after: b });
}
console.log('RAW differences: ' + rawDiff.length);
for (const d of rawDiff) console.log('  DIFF[' + d.i + '] before=' + d.before + ' after=' + d.after);
const onlyCreateFlags = rawDiff.length > 0 && rawDiff.every(d =>
  JSON.parse(d.before)[0] === 'create' && JSON.parse(d.after)[0] === 'create' &&
  JSON.parse(d.before).length === 6 && JSON.parse(d.after).length === 7 &&
  JSON.parse(d.after)[6] === 1 &&
  JSON.stringify(JSON.parse(d.after).slice(0, 6)) === d.before);
console.log('All raw differences are createNode singleBuffer flags only: ' + onlyCreateFlags);
console.log('NORMALIZED stream IDENTICAL: ' + (sha(norm(before.h.messages)) === sha(norm(after.h.messages))));
console.log('  before sha256: ' + sha(norm(before.h.messages)));
console.log('  after  sha256: ' + sha(norm(after.h.messages)));

let totalPx = 0, totalDiff = 0;
const pixelLines = [];
const label = ['digital', 'analog', 'rings', 'goals'];
for (let fi = 0; fi < 6; fi++) {
  for (let ci = 0; ci < 4; ci++) {
    const a = before.frames[fi][ci], b = after.frames[fi][ci];
    if (a.length !== b.length) throw new Error('frame size mismatch');
    let d = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) d++;
    totalPx += a.length; totalDiff += d;
    const file = `artifacts/r228/eq-${label[ci]}-frame${fi}.bin`;
    fs.writeFileSync(file, Buffer.from(b.buffer, b.byteOffset, b.byteLength));
    pixelLines.push('  ' + label[ci] + '-frame' + fi + ': ' + d + '/' + a.length + ' px diff');
  }
}
console.log('RGB565 pixel diff lines:');
console.log(pixelLines.join('\n'));
console.log('TOTAL RGB565 diff: ' + totalDiff + ' / ' + totalPx + ' px ' +
  (totalDiff === 0 ? '(IDENTICAL)' : '(MISMATCH)'));
const pass = onlyCreateFlags && sha(norm(before.h.messages)) === sha(norm(after.h.messages)) && totalDiff === 0;
console.log(pass ? 'PASS 480px message stream + pixels IDENTICAL' : 'FAIL 480px equivalence');
if (!pass) process.exitCode = 1;
