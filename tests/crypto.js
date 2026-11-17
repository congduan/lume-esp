// Compile a host QuickJS runner against the exact firmware lume_crypto.c
// source plus the IDF mbedTLS minimal closure (sha256/md/aes), then run the
// NIST vectors, offset/error cases and host-only perf sample in that engine.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qjs = path.join(root, 'firmware/components/quickjs-ng');
const mb = '/opt/esp/esp-idf/components/mbedtls/mbedtls';
const scratchRoot = path.join(root, 'artifacts/r91');
fs.mkdirSync(scratchRoot, {recursive: true});
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'crypto-host-'));
try {
  const cc = process.env.CC || 'cc';
  const args = ['-O2', '-std=gnu11', '-D_GNU_SOURCE', '-DQUICKJS_NG_BUILD', '-funsigned-char',
    '-DMBEDTLS_CONFIG_FILE="r91_crypto_mbedtls_config.h"',
    `-I${path.join(__dirname, 'lib')}`,
    `-I${qjs}`, `-I${path.join(mb, 'include')}`,
    path.join(root, 'tests/crypto_host.c'),
    path.join(root, 'firmware/components/lume-crypto/lume_crypto.c'),
    ...['sha256.c', 'md.c', 'aes.c', 'platform_util.c', 'constant_time.c'].map(p => path.join(mb, 'library', p)),
    ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'].map(p => path.join(qjs, p)),
    '-o', path.join(scratch, 'crypto_host'), '-lm', '-lpthread', '-ldl'];
  let r = spawnSync(cc, args, {stdio: 'inherit'});
  if (r.status !== 0) process.exit(r.status || 1);
  r = spawnSync(path.join(scratch, 'crypto_host'), [path.join(__dirname, 'lib/crypto_cases.js')], {stdio: 'inherit'});
  process.exitCode = r.status || 0;
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
