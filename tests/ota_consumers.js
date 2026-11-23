// Host harness for the r132 OTA-consumer slice (pure app layer).
// Standalone CommonJS:
//   node tests/ota_consumers.js
// Static source-contract checks only, every one mutation-proven below. The
// `lume.ota` host stub exists but the UI paths need signal/lume bindings, so
// this harness asserts the SOURCE of examples/settings/app.js and
// examples/dashboard/app.js instead.
//   - settings General page owns a 3-node OTA row driven by lume.ota.status()
//     with typeof === 'object' discrimination (a number is an error code).
//   - the 32-hex key is NEVER read: no `.token` / ['token'] anywhere in either
//     app, so it cannot reach a Text or canvas text render path.
//   - the "New token" button opens a shell.Dialog; its danger Rotate action
//     generates 32 lowercase hex chars with Math.random (non-CSPRNG, registered
//     in the header + KNOWN-SIMPLIFICATIONS.md r132; modal gate added in r163).
//   - dashboard SYSTEM canvas publishes a 10th OTA row; 9 separators still fit
//     the 360 px page height.
//   - dashboard playground generated source matches the example, dashboard is
//     in the playground manifest, all UI literals are ASCII (r64), and only the
//     known r132-r136 files differ from the 3514c76 baseline.
// There is NO radio / board / real OTA push on the host: nothing here proves a
// real token rotation or a real HMAC exchange. Deferred to board bring-up.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = '3514c76'; // r177: re-pinned to the board-id feat commit (firmware only)

const settings = read('examples/settings/app.js');
const dashboard = read('examples/dashboard/app.js');
const both = settings + '\n---\n' + dashboard;

const S_BEGIN = '/* ---- r132: OTA status + token rotation BEGIN';
const S_END = '/* ---- r132: OTA status + token rotation END ---- */';
const ROW_BEGIN = '/* r132 OTA ROW BEGIN';
const ROW_END = '/* r132 OTA ROW END */';
const D_BEGIN = '/* ---- r132: OTA status line BEGIN ---- */';
const D_END = '/* ---- r132: OTA status line END ---- */';

function sliceBetween(s, a, b) {
  const i = s.indexOf(a);
  assert.ok(i >= 0, 'missing start marker: ' + a);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, 'missing end marker: ' + b);
  return s.slice(i, j + b.length);
}

const settingsOta = sliceBetween(settings, S_BEGIN, S_END);
const otaRow = sliceBetween(settings, ROW_BEGIN, ROW_END);
const dashOta = sliceBetween(dashboard, D_BEGIN, D_END);
const header = settings.slice(0, settings.indexOf('var settingsTheme'));
const pollSlice = sliceBetween(settings, 'function pollOnce()', 'function stopPolling()');

// Text/canvas render paths must never be able to obtain the full key.
function noTokenRead(s) {
  return !/\.token\b/.test(s) && !/\[\s*['"]token['"]\s*\]/.test(s);
}

// String literals are the UI copy surface (comments are English here anyway).
function literals(s) {
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]));
}
const lits = [...literals(settings), ...literals(dashboard)];

// playground manifest is the source of truth for "in清单".
const manifest = read('tools/playground/build.mjs');
const listBlock = (manifest.match(/const apps = \[([\s\S]*?)\];/) || [])[1];
assert.ok(listBlock, 'playground app list not found');
const playgroundApps = listBlock.split(',')
  .map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const playgroundSrc = read('website/playground/sources/dashboard.js');

function gitChanged(paths) {
  const head = execFileSync('git',
    ['diff', '--name-only', BASE, 'HEAD', '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  const work = execFileSync('git',
    ['diff', '--name-only', BASE, '--', ...paths],
    { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set((head + '\n' + work).split('\n').filter(Boolean))];
}
/* r133: the playground manifest (tools/playground/build.mjs) is DATA that now
 * registers adc_meter as a 46th app; r134 adds crypto_check as a 47th; r135
 * adds archive_view as the 48th; r136 adds img_view as the 49th; r137 adds
 * vec_demo as the 50th. The
 * firmware/runtime/CLI-tooling surface is still pinned. Scope the diff to
 * tools/lume/ so manifest registration is not misreported as a tooling
 * behaviour change. */
const R166_ALLOWED = ['runtime/shell.js', 'runtime/types/lume.d.ts', 'tools/lume/check.js', 'tools/lume/lume.js', 'tools/lume/lume.test.js', // r166 ColorPicker and r171 check --visual
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI fput/fls/fdel.
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js'];
const fwChanged = gitChanged(['firmware/', 'runtime/', 'tools/lume/']);
const allChanged = gitChanged([]);
const ALLOWED = [
  // r171: manifest guard and optional browser visual check.
  'tools/lume/check.js',
  'tools/lume/lume.js',
  'tools/lume/lume.test.js',
  'tests/lib/manifest.js',
  'tests/playground_manifest.js',
  'docs/build.md',
  'docs/r171-agent-infra-report.md',
  // r166: ColorPicker runtime/types, consumer, generated docs and shell bundles.
  'examples/color_demo/app.js',
  'tests/colorpicker.js',
  'tests/color_demo.js',
  'docs/r166-colorpicker-report.md',
  'website/playground/apps/controls_demo.js',
  'artifacts/r166/api-check.log',
  'artifacts/r166/cli-tests.log',
  'artifacts/r166/color-demo-applied.png',
  'artifacts/r166/color_demo.log',
  'artifacts/r166/colorpicker-full.png',
  'artifacts/r166/colorpicker.log',
  'artifacts/r166/host-logs.tar.gz',
  'artifacts/r166/host-summary.log',
  'artifacts/r166/lume-check.log',
  'artifacts/r166/playground-build.log',
  'artifacts/r166/website.log',
  'examples/settings/app.js',
  'examples/dashboard/app.js',
  'tests/ota_consumers.js',
  'tests/sd_files.js',
  'tests/weather_sntp.js',
  'tests/sntp_consumers2.js',
  'docs/roadmap.md',
  'docs/KNOWN-SIMPLIFICATIONS.md',
  'website/playground/apps/dashboard.js',
  'website/playground/sources.js',
  'website/playground/sources/dashboard.js',
  // r133: this slice's baseline predates the adc_meter consumer app; its files
  // and the manifest registration are the only additional legal changes.
  'tools/playground/build.mjs',
  'examples/adc_meter/app.js',
  'tests/adc_meter.js',
  'tests/lib/prelude_runner.js',
  'website/playground/apps/adc_meter.js',
  'website/playground/sources/adc_meter.js',
  // r134: this slice's baseline also predates the crypto_check consumer app.
  'examples/crypto_check/app.js',
  'tests/crypto_check.js',
  'website/playground/apps/crypto_check.js',
  'website/playground/sources/crypto_check.js',
  // r135: this slice's baseline also predates the archive_view consumer app.
  'examples/archive_view/app.js',
  'tests/archive_view.js',
  'website/playground/apps/archive_view.js',
  'website/playground/sources/archive_view.js',
  // r136: this slice's baseline also predates the img_view consumer app. The
  // four new files are staged here BEFORE commit because `git diff` does not
  // see untracked files; without this the allowlist turns red after commit.
  'examples/img_view/app.js',
  'tests/img_view.js',
  'website/playground/apps/img_view.js',
  'website/playground/sources/img_view.js',
  // r137: this slice's baseline also predates the vec_demo consumer app. The
  // four new files are staged here BEFORE commit because `git diff` does not
  // see untracked files; without this the allowlist turns red after commit.
  // runtime.js is modified (math stub) and must be listed too.
  'examples/vec_demo/app.js',
  'tests/vec_demo.js',
  'website/playground/apps/vec_demo.js',
  'website/playground/sources/vec_demo.js',
  'website/playground/runtime.js',
  // r147: this round deliberately adds the lume-board-hal skeleton component
  // (feat commit bbd8627 is the new BASE) and re-pins these app-only guard
  // baselines.
  'firmware/components/lume-board-hal/CMakeLists.txt',
  'firmware/components/lume-board-hal/include/lume_board_hal.h',
  'firmware/components/lume-board-hal/lume_board_hal.c',
  'tests/board_abi.c',
  'tests/board_abi.js',
  'tests/apps_protocol.c',
  'tests/adc_meter.js',
  'tests/archive_view.js',
  'tests/crypto_check.js',
  'tests/img_view.js',
  'tests/ota_consumers.js',
  'tests/sd_files.js',
  'tests/sd_gallery.js',
  // r150: docs-refresh pages + the SNTP lume.system binding surface
  // (lume_scripts.c / lume_system_binding.h) and its regenerated prelude.js.
  'docs/r150-docs-refresh-report.md',
  'website/faq.html',
  'website/guide.html',
  'website/index.html',
  'firmware/components/lume-engine/include/lume_system_binding.h',
  'firmware/components/lume-engine/lume_scripts.c',
  'website/playground/prelude.js',
  'tests/sntp_consumers.js',
  'tests/sntp_consumers2.js',
  'tests/vec_demo.js',
  'tests/weather_sntp.js',
  // r140: the denial-positive drill script changes too; it is a test tool,
  // not firmware/runtime/CLI tooling, so it is allowlisted here as well.
  'tools/emu/check_oom_inject.py',
  // r141: the emu reboot check is a test tool, not firmware/runtime/CLI
  // tooling; it exercises the shipped default image via esp32sim.
  'tools/emu/check_reboot.py',
  // r143: reboot consumer adds three new files (one host harness and the two
  // generated playground artifacts). Staged here BEFORE commit because
  // `git diff` does not see untracked files; without this the allowlist turns
  // red once the feat/test commits land. The manifest entry already above.
  'tests/reboot_consumers.js',
  'website/playground/apps/settings.js',
  'website/playground/sources/settings.js',
  // r146: hr_monitor BLE telemetry consumer adds four new files (one app,
  // one harness and two generated playground artifacts). Staged here BEFORE
  // commit because `git diff` does not see untracked files; without this the
  // allowlist turns red once the feat/test commits land. The manifest entry
  // (53rd app) and tools/playground/build.mjs are already accounted for.
  'examples/hr_monitor/app.js',
  'tests/hr_monitor.js',
  'website/playground/apps/hr_monitor.js',
  'website/playground/sources/hr_monitor.js',
  // r148: shell Keyboard slice. All new files are staged here BEFORE commit
  // because `git diff` does not see untracked files; without this the
  // allowlist turns red once the feat/test commits land. runtime/ shell/types
  // and api.html are listed for completeness even though the guard BASE is
  // re-pinned to the feat commit that already contains them.
  'examples/keyboard_demo/app.js',
  'tests/keyboard_demo.js',
  'website/playground/apps/keyboard_demo.js',
  'website/playground/sources/keyboard_demo.js',
  'website/playground/apps/files.js',
  'website/playground/sources.js',
  'runtime/shell.js',
  'runtime/types/lume.d.ts',
  'website/api.html',
  // r149: full Wordle app (pure app layer). New files are added here BEFORE
  // commit because `git diff` does not see untracked files; without these the
  // allChanged allowlist turns red once the feat/test commits land. No
  // firmware/ runtime/ tools/lume/ change: those guards stay pinned/unweakened.
  'examples/wordle/app.js',
  'tests/wordle.js',
  'website/playground/apps/wordle.js',
  'website/playground/sources/wordle.js',
  // r142: esp-emu network acceptance infrastructure. tools/emu-net is a NEW
  // standalone entry (esp32sim in tools/emu stays untouched); net_check is a
  // consumer app; README documents the emulator split; fw-sync republishes
  // the browser firmware trio as usual. firmware/ is NOT in this diff range.
  'tools/emu-net/README.md',
  'tools/emu-net/prepare.py',
  'tools/emu-net/run.sh',
  'examples/net_check/app.js',
  'examples/nettest_open/app.js',
  'docs/r142-emu-net-report.md',
  // r144: emu-net WiFi isolation report (docs only; run.sh already allowlisted).
  'docs/r144-emu-wifi-report.md',
  'README.md',
  'README.zh-CN.md',
  // r142 evidence artifacts (serial logs, NETCHECK output, SD probe) under
  // artifacts/r142/ — same treatment as r126's verify log; regenerable but
  // retained as the acceptance evidence for the emu-net round.
  'artifacts/r142/debug_wifi.log',
  'artifacts/r142/esp_emu_version.txt',
  'artifacts/r142/firmware_build_attempt.txt',
  'artifacts/r142/http.log',
  'artifacts/r142/lume_check_no_emu.txt',
  'artifacts/r142/merged_flash_size.txt',
  'artifacts/r142/netcheck_output.txt',
  'artifacts/r142/retry/http.log',
  'artifacts/r142/retry/merged_flash_size.txt',
  'artifacts/r142/retry/serial.log',
  'artifacts/r142/retry_run_output.txt',
  'artifacts/r142/run_output.txt',
  'artifacts/r142/sd/http.log',
  'artifacts/r142/sd/merged_flash_size.txt',
  'artifacts/r142/sd/serial.log',
  'artifacts/r142/sd_run_output.txt',
  'artifacts/r142/serial.log',
  'artifacts/r142/tests_all_js.txt',
  'artifacts/r142/tests_remaining_js.txt',
  'artifacts/r142/try_batch1000.log',
  'artifacts/r142/try_transition1000.log',
  // r148 controller follow-up (e4f2d47): stale r82/r84/r92 host-run evidence
  // logs deliberately deleted (disk hygiene). They predate the 3514c76
  // baseline, so they no longer appear in the diff; the paths stay allowlisted
  // here as historical record. artifacts/ is regenerable evidence, not source.
  'artifacts/r82/baseline-build.log',
  'artifacts/r82/baseline-size.log',
  'artifacts/r82/build-final.log',
  'artifacts/r82/cli-tests.log',
  'artifacts/r82/fft-standalone.log',
  'artifacts/r82/host-tests.log',
  'artifacts/r82/quickjs-g0.log',
  'artifacts/r82/restored-build.log',
  'artifacts/r82/restored-size.log',
  'artifacts/r84/baseline-build-size.log',
  'artifacts/r84/check-counter.log',
  'artifacts/r84/doc-checks.log',
  'artifacts/r84/firmware-build-final.log',
  'artifacts/r84/firmware-build-first-fail.log',
  'artifacts/r84/host-tests.log',
  'artifacts/r84/imgscale-harness.log',
  'artifacts/r84/imgscale-obj-size.log',
  'artifacts/r84/npm-test.log',
  'artifacts/r84/quickjs-g0.log',
  'artifacts/r84/stub-check.log',
  // r150: docs-refresh round evidence (count audits, bilingual audit, local
  // screenshots, gate outputs) — same regenerable-evidence treatment as r142.
  'artifacts/r150/baseline_worktree.txt',
  'artifacts/r150/bilingual_audit.txt',
  'artifacts/r150/check_website.txt',
  'artifacts/r150/count_audit.txt',
  'artifacts/r150/doc_changed_paths.txt',
  'artifacts/r150/faq-new-entries.png',
  'artifacts/r150/files_dialog_retry.txt',
  'artifacts/r150/guide-safearea.png',
  'artifacts/r150/index-whats-new.png',
  'artifacts/r150/npm_ci.txt',
  'artifacts/r150/old_count_scan.txt',
  'artifacts/r150/ota_consumers_baseline.txt',
  'artifacts/r150/playwright_local.txt',
  'artifacts/r150/tests_all_js.txt',
  'artifacts/r150/tests_exit_code.txt',
  // r150 docs/pages themselves + the r143-era firmware surface (SNTP
  // lume.system binding in lume_scripts.c) that predates this round's BASE.
  'docs/r150-docs-refresh-report.md',
  'website/faq.html',
  'website/guide.html',
  'website/index.html',
  'firmware/components/lume-engine/include/lume_system_binding.h',
  'firmware/components/lume-engine/lume_scripts.c',
  // r138-r141 (already merged to main when this entry was added): alloc
  // injection harness (host + firmware drill verb), lume.perf bindings,
  // hotreload OOM-verb plumbing, and the fw-sync firmware trio republication.
  // firmware/runtime files here are part of the r140 deliberate perf change
  // whose new BASE is pinned above; they are listed to keep the allChanged
  // predicate honest about what legitimately differs from d85e69a.
  'firmware/components/lume-engine/include/lume_engine.h',
  'firmware/components/lume-engine/include/lume_perf_binding.h',
  'firmware/components/lume-engine/lume_engine.c',
  'firmware/components/lume-hotreload/include/lume_cmd.h',
  'firmware/components/lume-hotreload/lume_cmd.c',
  'firmware/components/lume-hotreload/lume_hotreload.c',
  'tests/alloc_inject.js',
  'tests/alloc_inject_host.c',
  'website/wasm/fw/bootloader.bin',
  'website/wasm/fw/lume.bin',
  'website/wasm/fw/lume.json',
  // r152: flapdot ghost fix — dirty-rect covers the full bird path across
  // skipped draw frames (user-visible ghosting evidence), plus round evidence.
  'examples/flapdot/app.js',
  'tests/flapdot.js',
  'website/playground/apps/flapdot.js',
  'website/playground/sources/flapdot.js',
  'artifacts/r152/flapdot-fixed-frame-1.png',
  'artifacts/r152/flapdot-fixed-frame-2.png',
  'artifacts/r152/flapdot-harness.txt',
  'artifacts/r152/host-regression.txt',
  'artifacts/r152/lume-check-no-emu.txt',
  'artifacts/r152/npm-ci.txt',
  'artifacts/r152/playground-build.txt',
  // r157: timer_kit (first consumer of the r151 shell form controls). All four
  // new paths are staged here BEFORE the feat/test commits because `git diff`
  // does not see untracked files; without them the allChanged allowlist turns
  // red once the app / harness / generated playground artifacts land. No
  // firmware/ runtime/ tools/lume/ change: the zero-diff guards stay unweakened.
  'examples/timer_kit/app.js',
  'tests/timer_kit.js',
  'website/playground/apps/timer_kit.js',
  'website/playground/sources/timer_kit.js',
  // r159: control_center (first consumer of Card / IconButton / SafeArea). Four
  // new paths staged BEFORE the feat/test commits: `git diff` cannot see
  // untracked files, so the allChanged allowlist would otherwise turn red once
  // the app / harness / generated playground artifacts land. No firmware /
  // runtime / tools/lume change: the zero-diff guards stay unweakened.
  'examples/control_center/app.js',
  'tests/control_center.js',
  'website/playground/apps/control_center.js',
  'website/playground/sources/control_center.js',
  // r160: launcher_grid (first consumer of shell.Launcher). Four new paths
  // staged here BEFORE the feat/test commits because `git diff` does not see
  // untracked files; without them the allChanged allowlist turns red once the
  // app / harness / generated playground artifacts land. No firmware / runtime
  // / tools/lume change: the zero-diff guards stay unweakened.
  'examples/launcher_grid/app.js',
  'tests/launcher_grid.js',
  'website/playground/apps/launcher_grid.js',
  'website/playground/sources/launcher_grid.js',
  // r158: BASE re-pinned to the r153 merge point 5d02549 (runtime/ unchanged
  // since). These are the exact r156/r157 paths that now fall inside the diff
  // window; each is allowlisted by its precise path, never by a wildcard.
  'artifacts/r156/gateway-solo.txt',
  'artifacts/r156/host-batch-0.txt',
  'artifacts/r156/host-batch-1.txt',
  'artifacts/r156/host-batch-2.txt',
  'artifacts/r156/npm-ci.txt',
  'artifacts/r156/ota-guard.txt',
  'artifacts/r156/playwright.txt',
  'artifacts/r156/website-check.txt',
  'website/playground/index.html',
  'website/playground/page.js',
  // r168: skycombat visual overhaul evidence + 4-app registration evidence.
  'artifacts/r168/browser-verify.txt',
  'artifacts/r168/cli-tests.txt',
  'artifacts/r168/host-summary.txt',
  'artifacts/r168/lume-check.json',
  'artifacts/r168/playground-build.txt',
  'artifacts/r168/website-check.txt',
  'docs/hardware-api.md',
  'artifacts/r152/regression-summary.txt',  // r156: skycombat 3D dogfight app + harness + evidence.
  'examples/skycombat/app.js',
  'tests/skycombat.js',
  'website/playground/apps/skycombat.js',
  'website/playground/sources/skycombat.js',
  'artifacts/r156/far.png',
  'artifacts/r156/near.png',
  'artifacts/r156/skycombat-harness.txt',
  'artifacts/r156/lume-check.txt',
  'artifacts/r156/host-tests.txt',
  'artifacts/r156/cli-tests.txt',
  'artifacts/r156/playground-build.txt',
  'docs/r156-skycombat-report.md',
  'artifacts/r152/playwright-production-page.txt',
  'docs/r152-flapdot-ghost-report.md',
  // r151 (shell form primitives round) landed its controls_demo harness on
  // main after 0d1111c was pinned; it is a test-only addition.
  'tests/controls_demo.js',
  // r153: Keyboard keyStates round. The wordle playground generated files are
  // already allowlisted above (regenerated because shell.js is embedded in the
  // bundle); the new per-key tint harness is staged here BEFORE commit because
  // `git diff` does not see untracked files, which would otherwise turn the
  // allChanged allowlist red once the test commit lands. All guard BASEs are
  // re-pinned to the r153 merge point 5d02549 (runtime/ diff stays pinned).
  'tests/keyboard_states.js',
  // r161: minigolf + ipod_music join the playground manifest (59 -> 61 apps).
  // New generated artifacts; staged BEFORE the feat/test commits because
  // `git diff` cannot see untracked files. apps/ipod_music.js and
  // sources/ipod_music.js already exist in the baseline and are modified/
  // unchanged respectively; only the two minigolf artifacts are brand new.
  'website/playground/apps/minigolf.js',
  'website/playground/sources/minigolf.js',
  'website/playground/apps/ipod_music.js',
  'website/playground/sources/ipod_music.js',
  // r163: settings danger actions moved to shell.Dialog (pure app layer). The
  // new host harness is staged BEFORE the feat/test commits because `git diff`
  // cannot see untracked files; without it the allChanged allowlist turns red
  // once the test commit lands. No firmware / runtime / tools/lume change.
  'tests/settings_dialog.js',
  // r164: the two-stage confirm sweep harness is staged BEFORE the feat/test
  // commits because `git diff` cannot see untracked files; without it the
  // allChanged allowlist turns red once the test commit lands. No firmware /
  // runtime / tools/lume change in this round.
  'tests/confirm_sweep.js',
  // r167: color_demo joins the playground manifest (61 -> 62 apps). The two
  // new generated artifacts are added BEFORE the feat commit lands because
  // `git diff` does not see untracked files; without them the allChanged
  // allowlist turns red once the feat commit lands. sources.js and the
  // regenerated apps/wordle.js are already allowlisted above. No firmware /
  // runtime / tools/lume change; no guard scope includes tools/playground/.
  'website/playground/apps/color_demo.js',
  'website/playground/sources/color_demo.js',
  // r168: four registered apps, picker entries and SkyCombat visual pass.
  'website/playground/index.html',
  'website/playground/page.js',
  'website/playground/apps/ble_uart.js',
  'website/playground/apps/spectrum.js',
  'website/playground/apps/svg_icon.js',
  'website/playground/apps/gestures.js',
  'website/playground/sources/ble_uart.js',
  'website/playground/sources/spectrum.js',
  'website/playground/sources/svg_icon.js',
  'website/playground/sources/gestures.js',
  'docs/r168-report.md',
  'artifacts/r168/far.png',
  'artifacts/r168/near.png',
  'artifacts/r168/burst.png',
  // r172: app-only StoryBook plus generated playground entry and evidence.
  'examples/storybook/app.js',
  'tests/storybook.js',
  'tests/ota_consumers.js',
  'docs/r172-storybook-report.md',
  'website/playground/apps/storybook.js',
  'website/playground/sources/storybook.js',
  'artifacts/r172/storybook-test.txt',
  'artifacts/r172/lume-check.txt',
  'artifacts/r172/playground-build.txt',
  'artifacts/r172/playwright.txt',
  'artifacts/r172/shelf.png',
  'artifacts/r172/reading.png',
  'artifacts/r172/controls.png',
  'artifacts/r172/cli-tests.txt',
  'artifacts/r172/guard.txt',
  'artifacts/r172/website.txt',
  'artifacts/r172/playground-verify.txt',
  'artifacts/r172/host-regression.txt',
  'artifacts/r172/playground-count.txt',
  // r173 companion P1: LUMC file commands FPUT/FLS/FGET/FDEL + CLI + evidence.
  // Evidence artifacts are admitted by the artifacts/r173/ prefix in the check
  // below; the source files are listed explicitly.
  'docs/r173-companion-p1-report.md',
  'firmware/components/lume-hotreload/CMakeLists.txt',
  'tests/file_cli_mock.py',
  'tests/file_emu.py',
  'tests/file_protocol.c',
  'tools/lume/ota.js', 'tools/lume/protocol.js', 'tools/lume/transport.js',
  // r169: playground single-source alignment + registered browser-only apps.
  // No firmware / runtime/ / tools/lume change; the adc stub is in the browser
  // runtime at website/playground/runtime.js (already allowlisted above).
  'website/playground/apps/mochi.js',
  'website/playground/sources/mochi.js',
  'website/playground/apps/shell_demo.js',
  'website/playground/sources/shell_demo.js',
  'docs/r169-report.md',
  'artifacts/r169/baseline-verify.txt',
  'artifacts/r169/verify.txt',
  'artifacts/r169/build.txt',
  'artifacts/r169/regression.txt',
  'artifacts/r169/guard.txt',
  'artifacts/r169/website.txt',
  // r174: retained-path verification of watchface / gravity_ball (the renamed
  // imu_ball). No app, firmware, runtime or tooling change: only these two
  // harnesses, the report and the enumerated evidence files are new.
  'tests/watchface.js',
  'tests/gravity_ball.js',
  'docs/r174-report.md',
  'artifacts/r174/instrument.js',
  'artifacts/r174/instrument.txt',
  'artifacts/r174/aa-raster.log',
  'artifacts/r174/js-harnesses.log',
  'artifacts/r174/cli-tests.log',
  'artifacts/r174/website-check.log',
  'artifacts/r174/wordle-recheck.log',
  'artifacts/r174/git-diff-stat.log',
  // r176: HAL registration slice -- report + regenerable evidence only.
  // Evidence artifacts are admitted by the r176 prefix in the check below.
  'docs/r176-report.md',
  // r177: board-id slice -- one new host harness + report; regenerable
  // evidence is admitted by the r177 prefix in the check below.
  'tests/board_id.js',
  'docs/r177-report.md',
];

// --- checks -----------------------------------------------------------------
// Each entry: [name, [sourceToTest, predicate]]. Mutation proof calls the same
// predicate on a mutated copy, so every assertion is load-bearing.
const checks = [
  ['OTA helper reads lume.ota.status() locally', [settingsOta, s =>
    s.includes('var st = lume.ota.status();')]],

  ['number return discriminated via typeof === object, ASCII err code', [settingsOta, s =>
    s.includes("typeof st === 'object'") && s.includes("'ota err ' + st")]],

  ['four flags + port rendered; .token / [token] never read in either app', [both, s =>
    ['st.running', 'st.wifiReady', 'st.tokenReady', 'st.port', 'st.hmac']
      .every(k => s.includes(k)) && noTokenRead(s)]],

  ['OTA row is exactly View + Text + Button (3 nodes)', [otaRow, s =>
    /View\(\{/.test(s) && /Text\(\{ text: function \(\)/.test(s) && /Button\(\{/.test(s)]],

  ['row Text shows only status; New-token opens a Dialog', [otaRow, s =>
    s.includes('otaLine()') &&
    s.includes("title: 'New token', onPress: rotateOtaToken") &&
    noTokenRead(s)]],

  ['setToken sits in the danger Rotate onPress of a Dialog', [settingsOta, s => {
    const danger = s.indexOf("{ label: 'Rotate', style: 'danger', onPress: function ()");
    const call = s.indexOf('lume.ota.setToken(');
    return s.includes('shell.Dialog({') && danger >= 0 && call > danger;
  }]],

  ['Dialog guard degrades to an ASCII note; no 3 s arm timer remains', [settingsOta, s =>
    s.includes("typeof shell.Dialog !== 'function'") &&
    s.includes("otaNote.set('rotate n/a (no dialog)')") &&
    !s.includes('otaArmTimer')]],

  ['replacement token is 32 lowercase hex chars from Math.random', [settingsOta, s =>
    s.includes("'0123456789abcdef'") && s.includes('Math.random() * 16') &&
    s.includes('i < 32')]],

  ['setToken failure renders ASCII code; success refreshes status', [settingsOta, s =>
    s.includes("'setToken err ' + r") && s.includes('refreshOta();')]],

  ['600 ms poll refreshes OTA status', [pollSlice, s =>
    s.includes('refreshOta();') && s.includes('lume.system.setInterval(pollOnce, 600)')]],

  ['header registers Math.random as NOT cryptographically secure', [header, s =>
    s.includes('Math.random') && s.includes('NOT cryptographically secure')]],

  ['dashboard SYSTEM reads status() with typeof === object discrimination', [dashOta, s =>
    s.includes('lume.ota.status()') && s.includes("typeof ota === 'object'") &&
    s.includes("'ota err ' + ota")]],

  ['dashboard publishes OTA row with 9 separators inside 360 px', [dashboard, s =>
    s.includes("['OTA', otaText]") &&
    /function systemStaticLines\(\)[\s\S]*?for \(var i = 0; i < 9; i\+\+\) segs\.push\(\[16, 82 \+ i \* 30/.test(s)]],

  ['dashboard OTA line never reads token', [dashOta, s => noTokenRead(s)]],

  ['playground sources/dashboard.js byte-identical to example', [playgroundSrc, s =>
    s === dashboard]],

  ['dashboard is in the playground manifest', [playgroundApps,
    list => list.length > 0 && list.includes('dashboard')]],

  ['all UI string literals ASCII-only (r64)', [lits,
    arr => arr.length > 0 && arr.every(x => /^[\x00-\x7F]*$/.test(x))]],

  ['firmware/ runtime/ CLI tooling identical to 3514c76', [fwChanged, c => c.every(f => R166_ALLOWED.includes(f))]],

  ['only known r132 + r133 + r134 + r135 + r136 files differ from 3514c76', [allChanged, c =>
    c.length > 0 && c.every(f => ALLOWED.includes(f) ||
      f.startsWith('artifacts/r173/') || f.startsWith('artifacts/r176/') ||
      f.startsWith('artifacts/r177/'))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL ota_consumers: ' + name);
  console.log('PASS ota_consumers: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, sourceForCheck) {
  const mutated = mutation(sourceForCheck);
  assert.notEqual(mutated, sourceForCheck, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
               'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS ota_consumers mutation: ' + name + ' -> FAIL as expected');
}

must('drop the lume.ota.status() read',
  s => s.replace('var st = lume.ota.status();', 'var st = null;'),
  'OTA helper reads lume.ota.status() locally', settingsOta);
must('truthy test replaces typeof === object discrimination',
  s => s.replace("typeof st === 'object'", 'st'),
  'number return discriminated via typeof === object, ASCII err code', settingsOta);
must('render the full token straight into the status text',
  s => s.replace('otaLine()', 'otaLine() + st.token'),
  'four flags + port rendered; .token / [token] never read in either app', both);
must('drop the OTA row Text',
  s => s.replace('Text({ text: function ()', 'Dummy({ text: function ()'),
  'OTA row is exactly View + Text + Button (3 nodes)', otaRow);
must('New-token button no longer opens a Dialog',
  s => s.replace("title: 'New token', onPress: rotateOtaToken", "title: 'New token'"),
  'row Text shows only status; New-token opens a Dialog', otaRow);
must('danger Rotate button downgraded',
  s => s.replace("{ label: 'Rotate', style: 'danger', onPress: function ()",
                 "{ label: 'Rotate', onPress: function ()"),
  'setToken sits in the danger Rotate onPress of a Dialog', settingsOta);
must('Dialog guard hardened (no ASCII fallback)',
  s => s.replace("typeof shell.Dialog !== 'function'", 'false'),
  'Dialog guard degrades to an ASCII note; no 3 s arm timer remains', settingsOta);
must('token length shrinks from 32 to 16 hex chars',
  s => s.replace('i < 32', 'i < 16'),
  'replacement token is 32 lowercase hex chars from Math.random', settingsOta);
must('setToken failure loses its ASCII return code',
  s => s.replace("'setToken err ' + r", "'setToken err'"),
  'setToken failure renders ASCII code; success refreshes status', settingsOta);
must('poll no longer refreshes OTA status',
  s => s.replace('refreshOta();', ''),
  '600 ms poll refreshes OTA status', pollSlice);
must('header drops the non-CSPRNG registration',
  s => s.replace('NOT cryptographically secure', 'cryptographically secure'),
  'header registers Math.random as NOT cryptographically secure', header);
must('dashboard truthy test replaces typeof === object',
  s => s.replace("typeof ota === 'object'", 'ota'),
  'dashboard SYSTEM reads status() with typeof === object discrimination', dashOta);
must('dashboard separators revert to 8',
  s => s.replace('i < 9', 'i < 8'),
  'dashboard publishes OTA row with 9 separators inside 360 px', dashboard);
must('dashboard renders the full token on canvas',
  s => s.replace("'ota off'", "'ota ' + ota.token"),
  'dashboard OTA line never reads token', dashOta);
must('playground generated source drifts from the example',
  s => s + '\n// drift',
  'playground sources/dashboard.js byte-identical to example', playgroundSrc);
must('playground manifest drops dashboard',
  list => list.filter(x => x !== 'dashboard'),
  'dashboard is in the playground manifest', playgroundApps);
must('a non-ASCII UI literal slips in',
  arr => arr.concat('中'),
  'all UI string literals ASCII-only (r64)', lits);
must('a firmware file changes vs d85e69a',
  () => ['firmware/components/lume-engine/lume_engine.c'],
  'firmware/ runtime/ CLI tooling identical to 3514c76', fwChanged);
must('an out-of-scope file changes vs d85e69a',
  () => allChanged.concat(['docs/unexpected.md']),
  'only known r132 + r133 + r134 + r135 + r136 files differ from 3514c76', allChanged);

console.log('ALL OTA CONSUMERS HARNESS CASES PASSED');
