// r96 host harness: compile the SAME portable OTA codec (lume_frame.c) the
// firmware links, plus a real mbedTLS SHA-256 HMAC provider (minimal r91
// config), and run tests/ota_protocol.c. This is the Node entry so the C
// harness participates in the standard `for t in tests/*.js` loop.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mb = '/opt/esp/esp-idf/components/mbedtls/mbedtls';
const scratchRoot = path.join(root, 'artifacts/r96');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'ota-host-'));
try {
  const cc = process.env.CC || 'cc';
  const args = ['-std=c11', '-Wall', '-Wextra', '-Werror',
    `-DMBEDTLS_CONFIG_FILE="r91_crypto_mbedtls_config.h"`,
    `-I${path.join(__dirname, 'lib')}`,
    `-I${path.join(root, 'firmware/components/lume-hotreload/include')}`,
    `-I${path.join(mb, 'include')}`,
    path.join(__dirname, 'ota_protocol.c'),
    path.join(root, 'firmware/components/lume-hotreload/lume_frame.c'),
    ...['sha256.c', 'md.c', 'platform_util.c', 'constant_time.c']
      .map(p => path.join(mb, 'library', p)),
    '-o', path.join(scratch, 'ota_protocol')];
  let r = spawnSync(cc, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  r = spawnSync(path.join(scratch, 'ota_protocol'), [], { stdio: 'inherit' });
  process.exitCode = r.status || 0;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
