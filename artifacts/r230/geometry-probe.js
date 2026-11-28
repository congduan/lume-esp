/* r230: native-466 geometry probe for the 11 migrated apps.
 * Prints the outermost node geometry from the real bridge message stream so
 * the +7px anchor offset can be checked without a device.
 * Usage: node artifacts/r230/geometry-probe.js
 */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { runApp } = require('../../tests/lib/prelude_runner');
const SHELL = fs.readFileSync('runtime/shell.js', 'utf8');
const inlineShell = s => s.replace(/^\s*import\s+['"][^'"]*runtime\/shell\.js['"];?\s*$/m, SHELL);

const APPS = [
  'files', 'settings', 'weather', 'music_player', 'control_center',
  'launcher_grid', 'image_gallery', 'adc_meter', 'crypto_check',
  'archive_view', 'img_view',
];
const PRE = `lume.image.sizeOf = function(){return {w:1,h:1};}; lume.image.decode = function(){return {pixels:new Uint16Array(1),w:1,h:1};};\n`;

console.log('screen center 466 = (233,233); safe reference [72.8125, 393.1875]');
for (const name of APPS) {
  const src = inlineShell(fs.readFileSync(`examples/${name}/app.js`, 'utf8'));
  const h = runApp(PRE + src, { screen: { w: 466, h: 466 } });
  // create messages: ['create', id, kind, parent, w, h, (flags)]
  const creates = h.messages.filter(m => m[0] === 'create');
  const first = creates.slice(0, 4).map(m => `#${m[1]}(k${m[2]}) ${m[4]}x${m[5]}`);
  // prelude.js: ATTR_WIDTH=2, ATTR_HEIGHT=3, ATTR_X=18, ATTR_Y=19.
  const attr = {};
  for (const m of h.messages) {
    if (m[0] !== 'attr') continue;
    const k = m[1], id = m[2];
    attr[k] = attr[k] || {};
    if ([2, 3, 18, 19].includes(id)) attr[k][id] = m[3];
  }
  function box(id) {
    const a = attr[id] || {};
    const x = a[18] === undefined ? 0 : a[18], y = a[19] === undefined ? 0 : a[19];
    const w = a[2] === undefined ? 0 : a[2], hh = a[3] === undefined ? 0 : a[3];
    return `(${x},${y}) ${w}x${hh} center=(${x + w / 2},${y + hh / 2})`;
  }
  const rootId = creates[0][1];
  const canvases = creates.filter(m => m[2] === 3).map(m => `${m[4]}x${m[5]}`);
  // Find the largest positioned node (the round bezel / safe-area container).
  let largest = null;
  for (const k of Object.keys(attr)) {
    const a = attr[k];
    const w = a[2] || 0, hh = a[3] || 0;
    const x = a[18] === undefined ? 0 : a[18], y = a[19] === undefined ? 0 : a[19];
    if (w >= 300 && hh >= 300 && (!largest || w * hh > largest.area)) largest = { k, x, y, w, hh, area: w * hh };
  }
  const largeBox = largest ? `node#${largest.k} ${box(largest.k)}` : 'none';
  console.log(`${name.padEnd(17)} nodes=${creates.length} root#${rootId} ${box(rootId)} | large=${largeBox} | canvas=[${canvases.slice(0,4).join(', ')}]`);
}
