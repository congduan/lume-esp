/* r230: 480-logical native stream equivalence for the 11 migrated apps.
 * before = origin/main (hard (240,240) anchors), after = migrated worktree.
 * Both run through the real firmware prelude in tests/lib/prelude_runner.js
 * with a frozen clock, default 480x480 screen and a few driven frames.
 * Compares the raw bridge message stream byte-for-byte (JSON per message).
 * Usage: node artifacts/r230/stream-equivalence-480.js
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { runApp } = require('../../tests/lib/prelude_runner');

const SHELL = fs.readFileSync('runtime/shell.js', 'utf8');
// Examples that opt into the optional shell use a plain ESM import of the
// no-export IIFE shell.js. Inline it at the same position on both sides so
// the raw source can run in the CommonJS vm harness.
const inlineShell = src => src.replace(/^\s*import\s+['"][^'"]*runtime\/shell\.js['"];?\s*$/m, SHELL);

const APPS = [
  'files', 'settings', 'weather', 'music_player', 'control_center',
  'launcher_grid', 'image_gallery', 'adc_meter', 'crypto_check',
  'archive_view', 'img_view',
];

/* Identical frozen clock injected into BOTH sides before app evaluation. */
const FREEZE = `var __R230_RealDate = Date;
var __R230_NOW = 1767225600000;
lume._nowMs = function () { return __R230_NOW; };
lume._systemTime = function () { return __R230_NOW; };
globalThis.Date = function () {
  if (!arguments.length) return new __R230_RealDate(__R230_NOW);
  return Reflect.construct(__R230_RealDate, arguments);
};
Date.now = function () { return __R230_NOW; };
Date.parse = __R230_RealDate.parse;
Date.UTC = __R230_RealDate.UTC;
Date.prototype = __R230_RealDate.prototype;
`;

function stream(source) {
  const h = runApp(FREEZE + source);
  for (let i = 0; i < 3; i++) vm.runInContext('__lume_tick()', h.ctx);
  return h.messages;
}

const sha = msgs => crypto.createHash('sha256').update(JSON.stringify(msgs)).digest('hex').slice(0, 16);
let identical = 0, different = 0;
for (const name of APPS) {
  const beforeSrc = inlineShell(execFileSync('git', ['show', `origin/main:examples/${name}/app.js`], { encoding: 'utf8' }));
  const afterSrc = inlineShell(fs.readFileSync(`examples/${name}/app.js`, 'utf8'));
  const a = stream(beforeSrc), b = stream(afterSrc);
  const same = a.length === b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]));
  const sa = sha(a), sb = sha(b);
  if (same) identical++; else different++;
  console.log(`${same ? 'IDENTICAL' : 'DIFFERENT'} ${name.padEnd(17)} msgs=${String(a.length).padStart(3)}/${String(b.length).padEnd(3)} sha256/16=${sa} / ${sb}`);
  if (!same) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
      if (x !== y) { console.log(`  DIFF[${i}] before=${x} after=${y}`); break; }
    }
  }
}
console.log(`TOTAL=${APPS.length} IDENTICAL=${identical} DIFFERENT=${different}`);
process.exitCode = different === 0 ? 0 : 1;
