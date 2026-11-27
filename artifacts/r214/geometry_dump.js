/* r214 reproducible geometry evidence.
 * Usage: node artifacts/r214/geometry_dump.js dashboard app_manager
 *
 * Runs the real app source through tests/lib/prelude_runner.js (firmware
 * prelude in a Node vm), prepending runtime/shell.js and stripping the ESM
 * import line exactly as the host harnesses do. Prints each created node's
 * x/y/w/h/text from the create/attr message stream. No firmware/board needed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = path.resolve(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'runtime/shell.js'), 'utf8');
const ATTR = { TEXT: 0, WIDTH: 2, HEIGHT: 3, X: 18, Y: 19 };

for (const name of process.argv.slice(2)) {
  const src = fs.readFileSync(path.join(root, 'examples', name, 'app.js'), 'utf8')
    .replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
  const s = runApp(shell + '\n' + src, { filename: name + '/app.js' });
  const nodes = new Map();
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
    }
  }
  console.log('=== ' + name.toUpperCase() + ' ===');
  for (const [id, n] of nodes) {
    console.log('node ' + id + ': x=' + n.x + ' y=' + n.y + ' w=' + n.w + ' h=' + n.h +
      ' text="' + String(n.text === undefined ? '' : n.text).replace(/\n/g, '\\n') + '"');
  }
}
