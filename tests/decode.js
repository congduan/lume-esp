// Compile a host QuickJS runner against the exact firmware decode / imgscale /
// RGB565A8 sources, then run marshalling, chain, error and bit-pattern cases.
// Only the PNG codec is shimmed (see tests/decode_host.c); no third-party dep.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qjs = path.join(root, 'firmware/components/quickjs-ng');
const scratchRoot = path.join(root, 'artifacts/r85');
fs.mkdirSync(scratchRoot, {recursive: true});
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'decode-host-'));
try {
  const cc = process.env.CC || 'cc';
  const args = ['-O2', '-std=gnu11', '-D_GNU_SOURCE', '-DQUICKJS_NG_BUILD', '-funsigned-char',
    `-I${qjs}`,
    `-I${path.join(root, 'firmware/components/lume-engine/include')}`,
    path.join(root, 'tests/decode_host.c'),
    path.join(root, 'firmware/components/lume-engine/lume_image_decode.c'),
    path.join(root, 'firmware/components/lume-engine/lume_imgscale.c'),
    path.join(root, 'firmware/components/lume-engine/lume_image_pixels.c'),
    ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'].map(p => path.join(qjs, p)),
    '-o', path.join(scratch, 'decode_host'), '-lm', '-lpthread', '-ldl', '-lz'];
  let r = spawnSync(cc, args, {stdio: 'inherit'});
  if (r.status !== 0) process.exit(r.status || 1);
  r = spawnSync(path.join(scratch, 'decode_host'), [path.join(__dirname, 'lib/decode_cases.js')], {stdio: 'inherit'});
  process.exitCode = r.status || 0;
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
