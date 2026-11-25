# r191 - CI C host harness coverage 8 -> 24

Baseline: `origin/main da0774e` (2026-11-26, post-r190). Worktree:
`/tmp/lume-r191-wt`, branch `r191-ci-c-harnesses`.

## Scope and premise check

The brief listed 17 of 25 `tests/*.c` files as outside the C harness CI step.
Re-verified before editing: all 17 exist, and the 8 CI-listed files are exactly
`ota_protocol, apps_protocol, bridge_protocol, image_header, canvas_aa, id3v2,
mp3_decoder, record_buffer`. No list drift.

16 of the 17 were brought into the gate after local compile+run evidence.
`perf_r78.c` was skipped (reasons below). The step is now
`C host assertion harnesses (24)`; every entry keeps the existing
`===== [n/total] name (provenance) =====` + `set -euo pipefail` format and there
is no `|| true`.

## Added entries and provenance

Entries [9/24]..[24/24], in CI order. "Header" = the harness's own build
comment; "derived" = command reconstructed from the matching `tests/*.js`
driver and confirmed compile-green locally. Same provenance is recorded in
each harness header comment.

| # | Harness | Provenance | Local result |
|---|---------|-----------|--------------|
| 9 | `board_175c_profile.c` | header gcc command | 7 PASS lines |
| 10 | `board_abi.c` | header command corrected (r176 drift): links `lume_board_hal.c`, per `tests/board_abi.js` | 10 PASS lines |
| 11 | `canvas_blit.c` | header gcc command | 6 PASS lines |
| 12 | `canvas_prims.c` | derived: same `lume_raster.h` include as `canvas_blit.c` | 5 PASS lines + all cases PASS |
| 13 | `fwtag_protocol.c` | header gcc command | 14 checks, 0 failures |
| 14 | `webserv_parse.c` | header gcc command | 51 checks PASS |
| 15 | `ws_frame.c` | derived: `lume_ws_frame.h` -> `lume-net/lume_ws_frame.c` | PASS |
| 16 | `file_protocol.c` | derived: `lume_cmd.h` -> `lume-hotreload/lume_cmd.c`, cf `apps_protocol` | 13 PASS |
| 17 | `lume_svg_test.c` | derived: `lume_svg.h` -> `lume-svg/lume_svg.c`, needs `-lm` | 17 PASS lines |
| 18 | `svg_cache_test.c` | derived from `tests/svg_cache.js` | ALL CHECKS PASSED, allocs=36 frees=36 live=0 |
| 19 | `alloc_inject_host.c` | derived from `tests/alloc_inject.js`; vendored QuickJS closure | RESULT: PASS |
| 20 | `fft_host.c` | derived from `tests/fft.js` + `sdkconfig.h` stub | 5 PASS lines |
| 21 | `imgscale_host.c` | derived from `tests/imgscale.js` | 7 PASS lines |
| 22 | `decode_host.c` | derived from `tests/decode.js` + `-lz` | 5 PASS lines |
| 23 | `crypto_host.c` | derived from `tests/crypto.js`; `LUME_MBEDTLS_ROOT` | 6 PASS lines + ALL OK |
| 24 | `compress_host.c` | derived from `tests/compress.js`; inline Node-zlib fixtures | 6 PASS lines + ALL OK |

Entry 23 sits after the existing `Provision pinned mbedTLS (crypto harness
closure)` step and uses `LUME_MBEDTLS_ROOT`, like `tests/crypto.js` and
`tests/ota_auth.js`. Entry 24 emits the `var __FIXTURES = ...` preamble that
`tests/compress.js` normally injects, then concatenates
`tests/lib/compress_cases.js`; this keeps the C runner self-contained in the C
step without adding a new file to the repo.

### Two latent link defects in the pre-existing entries fixed

The local preplay exposed two entries in the original 8 that no longer
compile at HEAD (their hardcoded `echo "... EXIT=0"` masks the failure):

- `[1/8] ota_protocol.c`: `tests/ota_protocol.c` includes `mbedtls/md.h` and
  calls `mbedtls_md_hmac`. Added `-DMBEDTLS_CONFIG_FILE=...`, `-I tests/lib`,
  `-I "$LUME_MBEDTLS_ROOT/include"` and the four minimal mbedTLS library
  sources (`sha256.c md.c platform_util.c constant_time.c`), exactly as
  `tests/ota_auth.js` does.
- `[4/8] image_header.c`: `lume_image_header.c` now includes `lume_svg.h` and
  calls `lume_svg_detect/size`. Added `-I firmware/components/lume-svg/include`,
  linked `lume_svg.c`, and appended `-lm`.

Both now print their PASS/ok lines in the preplay. No C source logic changed.

Caveat carried over from the existing step: each entry is `gcc ... && binary`
followed by a hardcoded `echo "... EXIT=0"`. Under `set -e`, a failed left side
of `&&` does not abort the block, and the echo is cosmetic, so a future compile
regression would still need the PASS lines in the log to be noticed. The local
preplay is therefore checked against the actual compiler/link output and PASS
markers, not just the step exit code. Changing that pattern across all 24
entries was left out of this round's minimal diff.

## Skipped harness (1)

- `tests/perf_r78.c` -- its only driver is `tests/perf_r78.sh`, which (1) runs
  `tools/lume/fetch-qjsc.sh` to build the gitignored host `qjsc` compiler from
  the vendored QuickJS-NG sources, (2) generates a ~3 MB classic script and
  compiles it to bytecode with `qjsc -b -C`, then (3) does a second full
  vendored QuickJS build for the harness itself. That is a multi-minute compile
  in the hot CI path for a harness whose numeric/functional assertions overlap
  `tests/vec_demo.js` and whose timings are host-only samples, not a
  correctness gate. Left out deliberately rather than adding a slow step;
  `docs/archive/r78-perf-report.md` records its original local evidence.

## paths trigger check

`on.paths` already had `tests/**`, so the harness sources themselves trigger
the workflow. Seven sources live elsewhere and were added to both `push` and
`pull_request` paths (only the directories the expanded step actually links):

`firmware/components/lume-board-hal/**`, `lume-compress/**`, `lume-crypto/**`,
`lume-net/**`, `lume-svg/**`, `quickjs-ng/**`, and `firmware/boards/**`.
`firmware/components/lume-engine/**` was already present.

## Verification (raw output in `artifacts/r191/`)

- Each new harness compile+run evidence: `c-harness-09-*.log` ..
  `c-harness-24-*.log` (16 files, split from the preplay run).
- Full local CI-equivalent serial run of all 24 entries, in tests.yml order:
  `c-step-preplay.log`. `ALL_C_HARNESSES_DONE`, exit 0, no `error:` /
  `undefined reference` / `fatal error` anywhere in the log.
- `yamllint .github/workflows/tests.yml` -> exit 0 (`yamllint.log`). All
  overlong lines in this file were wrapped; the two remaining diagnostics are
  pre-existing warnings (`document-start`, `truthy` on `on:`), not errors.
  Baseline HEAD had 16 line-length errors; the file now has none.
- `python3 scripts/check_website.py` -> exit 0, missing/invented/duplicates all
  none (`check-website.log`).
- JS regression: `for t in tests/*.js; do node "$t" || echo "FAIL $t"; done`
  -> 1 known FAIL, `tests/ota_consumers.js` (`js-all.log`). See below.
- No `idf.py build` / `idf.py size` was run (all host gcc; disk constraint and
  red line). No on-device claim is made.

### Known, out-of-scope JS regression

`tests/ota_consumers.js` has a static `ALLOWED` allowlist of every tracked file
changed since its pinned BASE `94f5d4e`. New r191 files are not in it. Of the
13 tracked files this round changes, it already allows
`tests/alloc_inject_host.c`, `board_abi.c`, `file_protocol.c`,
`lume_svg_test.c`, `svg_cache_test.c`, but not:

```
.github/workflows/tests.yml
tests/canvas_prims.c
tests/compress_host.c
tests/crypto_host.c
tests/decode_host.c
tests/fft_host.c
tests/imgscale_host.c
tests/ws_frame.c
```

The guard therefore reports `FAIL ota_consumers: only known r132 + ... + r136
files differ from 674684a`. Adding those 8 paths to the `ALLOWED` array in
`tests/ota_consumers.js` is the standard follow-up for every new round, but
that file is outside this round's red-line change surface, so it was left
untouched for the dispatcher to decide. With gitignored `tools/lume/node_modules`
and `tools/lume/bin/qjsc` soft-linked from the main repo (the usual worktree
environment fact), all other `tests/*.js` harnesses pass.

## Environment facts

- Fresh worktree lacked gitignored `tools/lume/node_modules` and
  `tools/lume/bin/qjsc`; both were soft-linked read-only from `/home/ubuntu/lume`
  so `tests/*.js` could run. The symlinks are not part of the change.
- Pinned mbedTLS v3.6.2 was downloaded to `/tmp/mbedtls` with the same sha256
  check as the CI Provision step; `LUME_MBEDTLS_ROOT=/tmp/mbedtls` for the
  preplay. No mbedTLS file was added to the repo.
- Every compiler output went to `/tmp`; only source-comment provenance,
  `.github/workflows/tests.yml`, this report and `artifacts/r191/` are in the
  worktree. No vendored source, firmware component, prelude JS, or C assertion
  logic was touched. No push.
