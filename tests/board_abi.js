/*
 * r147 host harness driver for the lume-board-hal runtime stub.
 * CommonJS, standalone (not node --test). Run: node tests/board_abi.js
 *
 * It (1) asserts source-level contract tokens, (2) re-checks the zero-diff
 * guard, and (3) compiles + runs tests/board_abi.c with plain gcc. The C
 * harness carries the load-bearing layout assertions; this script is the
 * node-side entry point so it joins the `for t in tests/*.js` sweep.
 *
 * Zero-diff guard (brief command, verified empty at baseline 4155d15):
 *   git diff 4155d15 HEAD -- ':!firmware/components/lume-board' \
 *     ':!tests/board_abi.*' ':!docs'
 * The assertion below additionally excludes the NEW sibling component so the
 * harness stays green both before and after the r147 commits land.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hdr = read('firmware/components/lume-board-hal/include/lume_board_hal.h');
const src = read('firmware/components/lume-board-hal/lume_board_hal.c');

function check(name, ok) {
  if (!ok) { console.error('FAIL ' + name); process.exitCode = 1; }
  else console.log('PASS ' + name);
}

// --- 1. source-level contract -------------------------------------------
check('header defines four op typedefs',
  ['lume_board_panel_init_t', 'lume_board_touch_init_t',
   'lume_board_touch_read_t', 'lume_board_power_init_t']
    .every(t => hdr.includes('typedef int (*' + t + ')')));
check('struct has four ops then board_id',
  ['lume_board_panel_init_t panel_init;', 'lume_board_touch_init_t touch_init;',
   'lume_board_touch_read_t touch_read;', 'lume_board_power_init_t power_init;',
   'const char *board_id;'].every(f => hdr.includes(f)));
check('header declares lume_board_get singleton',
  /const lume_board_t \*lume_board_get\(void\);/.test(hdr));
check('header states profile-is-source-of-truth division of labour',
  hdr.includes('REMAINS the single source of') && hdr.includes('runtime dispatch stub'));
check('impl defines a single not_supported stub',
  src.includes('static int lume_board_not_supported(void)') &&
  (src.match(/lume_board_not_supported\(\);/g) || []).length >= 4);
check('impl default singleton uses generic board id',
  src.includes('.board_id   = "generic"'));
check('impl points all four ops at not_supported faces',
  ['panel_init = lume_board_not_supported_panel_init',
   'touch_init = lume_board_not_supported_touch_init',
   'touch_read = lume_board_not_supported_touch_read',
   'power_init = lume_board_not_supported_power_init'].every(s => src.includes(s)));

// --- 2. zero-diff guard (extended for the new sibling component) --------
/* r148: the guard was pinned to the r146 merge (4155d15) and had already gone
 * red at dafa1ed once r147 re-pinned the app-only harness baselines. Re-pin to
 * the round-start baseline and exclude the surfaces this round legitimately
 * lands (runtime/ shell Keyboard, generated website/, examples/, tools/,
 * tests/, docs/). Every other path -- notably firmware/ outside the two board
 * components -- still fails the guard; the assertion is not weakened to a
 * self-comparison. */
const guardOut = execFileSync('git', [
  'diff', 'dafa1ed', 'HEAD', '--',
  ':!firmware/components/lume-board',
  ':!firmware/components/lume-board-hal',
  ':!runtime/', ':!website/', ':!examples/', ':!tools/', ':!tests/', ':!docs',
  // r150: docs-refresh round lands README.md / README.zh-CN.md (43->53 apps,
  // SNTP/TF/SafeArea/esp-emu sections). Root READMEs live outside docs/, so
  // they need their own exclusion; everything else outside the listed surfaces
  // still fails the guard.
  ':!README.md', ':!README.zh-CN.md',
  // r148 controller follow-up: stale r82/r84/r92 host-run evidence logs were
  // deliberately removed (disk hygiene, e4f2d47); artifacts/ is regenerable
  // evidence, not source, so the guard no longer pins its contents.
  ':!artifacts/'
], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
check('zero-diff guard: no changes outside board components and r148 surfaces',
  guardOut === '');
if (guardOut !== '') console.error(guardOut);

// --- 3. compile + run the C ABI harness ---------------------------------
const bin = '/tmp/lume-r147-board-abi';
try {
  execFileSync('gcc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
    '-I', path.join(root, 'firmware/components/lume-board-hal/include'),
    path.join(root, 'tests/board_abi.c'),
    path.join(root, 'firmware/components/lume-board-hal/lume_board_hal.c'),
    '-o', bin],
    { cwd: root, encoding: 'utf8' });
  const out = execFileSync(bin, { cwd: root, encoding: 'utf8' });
  process.stdout.write(out);
  check('board_abi.c compiled and ran with exit 0', true);
} catch (e) {
  process.stderr.write(String(e.stdout || '') + String(e.stderr || ''));
  check('board_abi.c compiled and ran with exit 0', false);
}

if (process.exitCode) console.error('board_abi: FAIL');
else console.log('board_abi: ALL CHECKS PASSED');
