/* r215 reproducible geometry evidence.
 * Usage: node artifacts/r215/geometry_dump.js games_breakout files image_gallery crypto_check archive_view
 *
 * Runs each real app source through tests/lib/prelude_runner.js (firmware
 * prelude in a Node vm), prepending runtime/shell.js when the app imports it,
 * and ticks one frame if __lume_tick exists so virtualized List rows mount.
 * Prints each created node's parent, local x/y, resolved screen-space
 * [absX..absX2,absY..absY2], w/h, radius, press flag, and text.
 * Host-only evidence; no firmware/board needed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = path.resolve(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'runtime/shell.js'), 'utf8');
const ATTR = { TEXT: 0, WIDTH: 2, HEIGHT: 3, PARENT: 6, RADIUS: 12, X: 18, Y: 19 };
const KIND = ['View', 'Text', 'Btn', 'Canvas', 'Img', 'Arc', 'Slider', 'Switch'];

for (const name of process.argv.slice(2)) {
  const raw = fs.readFileSync(path.join(root, 'examples', name, 'app.js'), 'utf8');
  const hasShell = /runtime\/shell\.js/.test(raw);
  const src = raw.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
  const s = runApp((hasShell ? shell + '\n' : '') + src, { filename: name + '/app.js' });
  if (typeof s.ctx.__lume_tick === 'function') s.ctx.__lume_tick();
  const nodes = new Map();
  const pressSet = new Set();
  for (const m of s.messages) {
    if (m[0] === 'create') nodes.set(m[1], { kind: m[2], parent: m[3], w: m[4], h: m[5] });
    else if (m[0] === 'attr') {
      const n = nodes.get(m[1]);
      if (!n) continue;
      if (m[2] === ATTR.X) n.x = m[3];
      else if (m[2] === ATTR.Y) n.y = m[3];
      else if (m[2] === ATTR.WIDTH) n.w = m[3];
      else if (m[2] === ATTR.HEIGHT) n.h = m[3];
      else if (m[2] === ATTR.TEXT) n.text = m[3];
      else if (m[2] === ATTR.PARENT) n.parent = m[3];
      else if (m[2] === ATTR.RADIUS) n.r = m[3];
    } else if (m[0] === 'press') pressSet.add(m[1]);
  }
  function absPos(n) {
    let x = n.x || 0, y = n.y || 0, cur = n.parent, seen = new Set();
    while (cur && nodes.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = nodes.get(cur);
      x += (p.x || 0);
      y += (p.y || 0);
      cur = p.parent;
    }
    return [x, y];
  }
  console.log('=== ' + name.toUpperCase() + ' ===');
  for (const [id, n] of nodes) {
    const [ax, ay] = absPos(n);
    const w = n.w || 0, h = n.h || 0;
    const press = pressSet.has(id) ? ' [PRESS]' : '';
    console.log(
      'node ' + id + ' (' + (KIND[n.kind] || n.kind) + ', p=' + n.parent + '):' +
      ' x=' + n.x + ' y=' + n.y + ' w=' + n.w + ' h=' + n.h +
      ' abs=[' + ax + '..' + (ax + w) + ',' + ay + '..' + (ay + h) + ']' +
      ' r=' + n.r + press +
      ' text="' + String(n.text === undefined ? '' : n.text).replace(/\n/g, '\\n') + '"'
    );
  }
}
