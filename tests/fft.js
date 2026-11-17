// Compile a host QuickJS runner against the exact firmware FFT source, then
// execute the numerical and performance checks in the same JS engine.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qjs = path.join(root, 'firmware/components/quickjs-ng');
const scratchRoot = path.join(root, 'artifacts/r82');
fs.mkdirSync(scratchRoot, {recursive: true});
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'fft-host-'));
try {
  fs.writeFileSync(path.join(scratch, 'sdkconfig.h'), '#define CONFIG_LUME_PERF_PROFILE 0\n');
  const cc = process.env.CC || 'cc';
  const args = ['-O2', '-std=gnu11', '-D_GNU_SOURCE', '-DQUICKJS_NG_BUILD', '-funsigned-char',
    `-I${qjs}`, `-I${scratch}`,
    path.join(root, 'tests/fft_host.c'),
    path.join(root, 'firmware/components/lume-engine/lume_fft.c'),
    ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'].map(p => path.join(qjs, p)),
    '-o', path.join(scratch, 'fft_host'), '-lm', '-lpthread', '-ldl'];
  let r = spawnSync(cc, args, {stdio: 'inherit'});
  if (r.status !== 0) process.exit(r.status || 1);
  r = spawnSync(path.join(scratch, 'fft_host'), [path.join(__dirname, 'lib/fft_cases.js')], {stdio: 'inherit'});
  process.exitCode = r.status || 0;
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
