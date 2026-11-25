# r150 — README and documentation site refresh

Baseline: `ca4ba359f4799be6e80e2be16de164d273559f29` (`origin/main`). Branch: `r150-docs-refresh`. This round changes documentation only; no firmware, runtime, tools, tests, examples, or generated `website/api.html` were edited.

## Count audit

I ran `ls -1 examples/ | wc -l` and obtained **71** immediate entries (70 directories containing `app.js`). I separately evaluated `website/playground/sources.js` as JavaScript and counted `Object.keys(window.LUME_SOURCES)`: **53**. The Playground count is therefore **53**, not the 71 example entries. This differs from the brief's implied agreement between `ls examples/` and Playground sources. Raw counts are in `artifacts/r150/count_audit.txt`.

The stale English README claim of 43 screen apps is now 53. The Chinese README now states the same Playground count. A scan for `31 screen|43 screen|31 个` in `website/` and both READMEs returns no matches (`artifacts/r150/old_count_scan.txt`).

## Changes

| File | Change |
|---|---|
| `README.md` | Corrected Playground count; added SNTP, TF storage, crypto/compress/FFT, SafeArea, event-driven LVGL loop, HMAC OTA and virtual-network runner to feature/status copy. |
| `README.zh-CN.md` | Added the missing Playground/Firmware browser sections and matching count/features/status in Chinese. |
| `website/index.html` | Added bilingual What's new copy for SNTP, WiFi OTA/network test path, and 53 Playground apps; updated stale M4 wording. |
| `website/guide.html` | Added bilingual SafeArea and esp-emu sections with a minimal code sample, command and `[NETCHECK]` protocol; updated stale deployment boundary. |
| `website/faq.html` | Updated outdated OTA/simulator answer; added bilingual reboot-time and boardless-WiFi questions. |

The existing docs had called esp-emu network acceptance complete. The empirical `docs/r142-emu-net-report.md` and `docs/r144-emu-wifi-report.md` record `ip FAIL` after association failure, and the optional TF probe failed at card initialization. Updated copy distinguishes an available runner from a passing virtual-network result and from board acceptance. SNTP app integration was checked in `examples/{clock,clock_round,watchface,weather}/app.js`; SafeArea behavior against `runtime/shell.js`, `tests/safearea.js`, and `docs/r104-safearea-report.md`.

## Verification

- `python3 scripts/check_website.py`: exit 0; raw output: `artifacts/r150/check_website.txt` (154 API catalog entries, none missing or invented).
- `for t in tests/*.js; do node "$t"; done`: 85 harnesses executed, 84 exit 0 and one exit 1; raw per-harness output and exit status: `artifacts/r150/tests_all_js.txt`. The failing `tests/ota_consumers.js` contains a fixed allowed-file list for r132–r136 and rejects this round's README/site changes. Its unchanged code passes on a clean `ca4ba35` worktree (`artifacts/r150/ota_consumers_baseline.txt`), while the changed paths are listed in `artifacts/r150/doc_changed_paths.txt`. The test was left unchanged under the docs-only redline.
- Local `python3 -m http.server` preview with Playwright Chromium: screenshots at `artifacts/r150/index-whats-new.png`, `artifacts/r150/guide-safearea.png`, and `artifacts/r150/faq-new-entries.png`. These are local previews, not a deployed production-site check. English and Chinese copy were both rendered through the language toggle (`artifacts/r150/playwright_local.txt`, three passes).
- Stale-count scan: `artifacts/r150/old_count_scan.txt` (empty). Bilingual keyword and `data-en`/`data-zh` attribute count audit: `artifacts/r150/bilingual_audit.txt`.
- The initial loop found `tests/files_dialog.js` missing `tools/lume/node_modules/esbuild`. `npm ci --prefix tools/lume` installed the declared dependencies (`artifacts/r150/npm_ci.txt`), and the direct retry passed (`artifacts/r150/files_dialog_retry.txt`). The final full loop was restarted after this setup.
- `git diff --check`: exit 0.

Device behavior, radio association, sleep current, and round-screen touch/visual acceptance remain unverified by this documentation round.
