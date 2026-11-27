// r223 host harness: compile the SAME portable TX retry and SHOT stream helpers
// (lume_cmd.c + lume_frame.c) that firmware links, and run tests/shot_tx.c.
// Participates in the standard `for t in tests/*.js` regression sweep.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-shot-tx-'));
try {
  const cc = process.env.CC || 'cc';
  const bin = path.join(scratch, 'shot_tx');
  const args = [
    '-std=c11', '-Wall', '-Wextra', '-Werror',
    `-I${path.join(root, 'firmware/components/lume-hotreload/include')}`,
    `-I${path.join(root, 'firmware/components/lume-engine/include')}`,
    path.join(__dirname, 'shot_tx.c'),
    path.join(root, 'firmware/components/lume-hotreload/lume_cmd.c'),
    path.join(root, 'firmware/components/lume-hotreload/lume_frame.c'),
    '-o', bin,
  ];
  let r = spawnSync(cc, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  r = spawnSync(bin, [], { stdio: 'inherit' });
  process.exitCode = r.status || 0;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
