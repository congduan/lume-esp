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
  hdr.includes('REMAINS the single source of') && hdr.includes('runtime board registry') &&
  hdr.includes('no dispatch consumer yet'));
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

// --- 1b. r176 registration API + one-way dependency ----------------------
check('header declares registration API and invalid-arg code',
  /int lume_board_hal_register\(const lume_board_t \*board\);/.test(hdr) &&
  hdr.includes('LUME_BOARD_ERR_INVALID_ARG') &&
  hdr.includes('LUME_BOARD_ERR_INVALID_ARG   (-2)'));
check('impl copies the board and keeps a stable current pointer',
  src.includes('static lume_board_t s_lume_board_registered;') &&
  src.includes('static const lume_board_t *s_lume_board_current = &s_lume_board_generic;') &&
  src.includes('int lume_board_hal_register(const lume_board_t *board)') &&
  src.includes('s_lume_board_registered = *board;') &&
  src.includes('s_lume_board_current = &s_lume_board_registered;'));
const boardSrc = read('firmware/components/lume-board/lume_board.c');
const boardCmake = read('firmware/components/lume-board/CMakeLists.txt');
const halCmake = read('firmware/components/lume-board-hal/CMakeLists.txt');
check('lume-board registers real drivers with the profile board name',
  boardSrc.includes('#include "lume_board_hal.h"') &&
  boardSrc.includes('(void)lume_board_hal_register(&s_runtime_board);') &&
  boardSrc.includes('.board_id   = LUME_BOARD_NAME,') &&
  boardSrc.includes('lume_display_init((lv_display_t **)out_panel)') &&
  boardSrc.includes('lume_touch_init((i2c_master_bus_handle_t)bus,') &&
  boardSrc.includes('lume_pmic_display_power_on((i2c_master_bus_handle_t)bus)'));
check('touch_read drift documented: no standalone driver point-read API',
  boardSrc.includes('no standalone point-read API') &&
  boardSrc.includes('return LUME_BOARD_ERR_NOT_SUPPORTED;') &&
  hdr.includes('NO standalone driver API') && hdr.includes('exists today'));
const halReg = (halCmake.match(/idf_component_register\(([\s\S]*?)\)/) || [])[1] || '';
check('dependency points lume-board -> lume-board-hal, never the reverse',
  boardCmake.includes('REQUIRES lume-board-hal') && !/REQUIRES/.test(halReg));

// --- 2. zero-diff guard (extended for the new sibling component) --------
/* r148: the guard was pinned to the r146 merge (4155d15) and had already gone
 * red at dafa1ed once r147 re-pinned the app-only harness baselines. Re-pin to
 * the round-start baseline and exclude the surfaces this round legitimately
 * lands (runtime/ shell Keyboard, generated website/, examples/, tools/,
 * tests/, docs/). Every other path -- notably firmware/ outside the two board
 * components -- still fails the guard; the assertion is not weakened to a
 * self-comparison. r177: BASE re-pinned to the board-id feat commit; the
 * exclusion set and diff predicate are unchanged (no semantic relaxation). */
const guardOut = execFileSync('git', [
  'diff', '3514c76', 'HEAD', '--',
  ':!firmware/components/lume-board',
  ':!firmware/components/lume-board-hal',
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL landed in
  // lume-hotreload; everything else under firmware/ still fails the guard.
  ':!firmware/components/lume-hotreload',
  // r75 raster and refresh changes are already present on origin/main.
  ':!firmware/components/lume-svg/lume_svg.c',
  ':!firmware/components/lvgl/lv_conf.h',
  // r181 UI-queue backpressure and r183 SVG raster-result cache.
  ':!firmware/components/lume-ui-bridge',
  ':!firmware/components/lume-engine',
  // r179: WiFi PS/coexist knife -- the only firmware paths this round lands.
  ':!firmware/components/lume-net/lume_net.c',
  ':!firmware/sdkconfig', ':!firmware/sdkconfig.defaults',
  ':!runtime/', ':!website/', ':!examples/', ':!tools/', ':!tests/', ':!docs',
  // r150: docs-refresh round lands README.md / README.zh-CN.md (43->53 apps,
  // SNTP/TF/SafeArea/esp-emu sections). Root READMEs live outside docs/, so
  // they need their own exclusion; everything else outside the listed surfaces
  // still fails the guard.
  ':!README.md', ':!README.zh-CN.md',
  // r188: artifacts-retention policy documented in AGENTS.md (docs-only edit,
  // same class as the r150 README refresh). r186: source-of-truth guidance
  // follows the JS extraction.
  ':!AGENTS.md',
  // r189: examples gallery is generated from the playground catalog by
  // scripts/gen_examples_gallery.py and gated by a --check hook in
  // scripts/check_website.py (same generated-surface class as website/).
  ':!scripts/gen_examples_gallery.py', ':!scripts/check_website.py',
  // r186: extracted prelude JS sources feed the build-time generator.
  ':!firmware/components/lume-engine/prelude/',
  ':!.gitignore', // already changed on origin/main after the historical guard base
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
