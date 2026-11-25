# r184 report: revival of stranded r179-wifi-ps-coex

## Baseline and scope

- Worktree: `/tmp/lume-r184-wt`, branch `r184-r179-revival`.
- Measured base at fire time: `origin/main` = `09dd892c2f22f72ed351beb9ecdf2cb3a5d53d0c`
  (two `chore(fw-sync)` commits past the brief's `66855af`: `670020e`, `09dd892`).
- Worktree was clean at start; no rebase was needed (it was created from the measured base).
- r180 was not merged or cherry-picked (per brief).

## Preflight evidence (before any cherry-pick)

`git show --stat` was run on all five r179 commits. Each matched the brief:

| old sha | files / subject |
|---|---|
| `750f3be` | `lume_net.c`, `sdkconfig`, `sdkconfig.defaults`; feat(net) PS + coexist knife |
| `e3fba64` | 22 `tests/*.js` guard re-pins; test(r179) |
| `74fe253` | `tests/board_abi.js` zero-diff guard; test(r179) |
| `b18540f` | `lume_net.c` comment dedup (5 deletions); fix(net) |
| `de58191` | 44 `artifacts/r179/*` files + `docs/r179-report.md`; docs(r179) |

Two discrepancies with the brief were found and are recorded here:

1. The brief said main-side r181/r183 also touched sdkconfig. Empirically
   `git log b749837..09dd892 -- firmware/sdkconfig firmware/sdkconfig.defaults`
   is empty. Main had no sdkconfig changes, so the cherry-picked sdkconfig diff
   is byte-identical to `750f3be`. The semantic check was still performed.
2. The brief's `CONFIG_ESP_WIFI_PS_DISABLE` / `CONFIG_ESP_COEXIST_DISABLE`
   names do not occur in r179. Per the brief's "use the 750f3be diff as
   authority" rule, the actual mechanism was checked: `esp_wifi_set_ps(WIFI_PS_NONE)`
   in `lume_net.c` plus disabling `CONFIG_ESP_COEX_SW_COEXIST_ENABLE` and the
   three legacy SW_COEXIST aliases.

Also noted during preflight: `750f3be` inserts the PS placement comment twice;
`b18540f` removes the duplicate. This is why the chain has five commits.

## Cherry-pick mapping

| old sha | new sha | subject |
|---|---|---|
| `750f3be` | `6519436` | feat(net): disable WiFi PS and BT/WiFi SW coexistence (r179) |
| `e3fba64` | `d360f8f` | test(r179): re-pin 22 guards for lume-net PS/coexist slice |
| `74fe253` | `9e2dd75` | test(r179): admit r179 firmware paths in board_abi zero-diff guard |
| `b18540f` | `105ba20` | fix(net): deduplicate r179 PS placement comment |
| `de58191` | `abf28d3` | docs(r179): record PS+coexist knife, emu failure evidence and host verification |

Original commit messages were kept (no `-e`, no amend). Raw mapping:
`artifacts/r184/cherry-pick-map.txt`.

## Conflict resolutions

Four conflict sites in four files; all resolved as a union of allowlist
entries, with no change to any assertion predicate structure. Resolved files
were `node --check`ed before `git cherry-pick --continue`.

| commit | file | decision |
|---|---|---|
| `e3fba64` -> `d360f8f` | `tests/controls_demo.js` | kept r181 `lume_ui_bridge.c` and added all three r179 entries (`lume_net.c`, `sdkconfig`, `sdkconfig.defaults`) in one array |
| `e3fba64` -> `d360f8f` | `tests/ota_consumers.js` (site 1) | kept r181 `scan.js` + `lume_ui_bridge.c` and added the three r179 entries in one array |
| `e3fba64` -> `d360f8f` | `tests/ota_consumers.js` (site 2) | allChanged predicate: kept r181/r182/r183 artifact prefixes and added `artifacts/r179/` |
| `e3fba64` -> `d360f8f` | `tests/sntp_consumers.js` | same union as `controls_demo.js` |
| `74fe253` -> `9e2dd75` | `tests/board_abi.js` | kept r181 `lume-ui-bridge` + r183 `lume-engine` exclusions and added the three r179 exclusions |

The remaining 19 guard files auto-merged (both sides only appended named
entries). Raw resolution diffs: `artifacts/r184/conflict-resolution.diff`.

## Extra fix commit (separate from the five cherry-picks)

`dd53362 test(r184): re-pin ota guard for post-r183 fw-sync and r184 evidence`

Reason: the first full harness run showed `tests/ota_consumers.js` red on
`website/wasm/fw/partition-table.bin`. This was verified to be pre-existing at
the untouched baseline: evaluating the `09dd892` copy of the guard against
`git diff 674684a 09dd892` yields the same single unallowed path (the two
post-r183 fw-sync commits republished that binary after the guard was pinned to
`674684a`). The fix only adds allowlist entries:
`website/wasm/fw/partition-table.bin`, `docs/r184-report.md`, and the
`artifacts/r184/` prefix. No predicate structure was changed. The other seven
harness failures in that first run were all `Cannot find module ...esbuild`
in the fresh worktree; `npm ci --prefix tools/lume` fixed them (30 packages).

## sdkconfig semantic switch check

Full before/after table with conclusions: `artifacts/r184/sdkconfig-switch-check.txt`.
All r179-intended switch lines survived the cherry-pick unchanged:

- `CONFIG_ESP_COEX_SW_COEXIST_ENABLE`: `=y` before -> `# ... is not set` in
  `sdkconfig`; new `CONFIG_ESP_COEX_SW_COEXIST_ENABLE=n` in `sdkconfig.defaults`.
- `CONFIG_SW_COEXIST_ENABLE`, `CONFIG_ESP32_WIFI_SW_COEXIST_ENABLE`,
  `CONFIG_ESP_WIFI_SW_COEXIST_ENABLE`: `=y` before -> `# ... is not set` after.
- `CONFIG_ESP_COEX_ENABLED=y` unchanged.
- `CONFIG_ESP_COEX_POWER_MANAGEMENT` and both
  `*_COEX_PHY_CODED_TX_RX_TLIM_DIS=y` lines were regenerated away, exactly as
  in r179's own diff.
- `lume_net.c`: single `esp_wifi_set_ps(WIFI_PS_NONE)` call.

## Verification (host)

All raw output in `artifacts/r184/`.

- Full host harness (`for t in tests/*.js; do node $t || echo "FAIL $t"; done`,
  103 files): `FAIL_LINES=0`, `PASS_LINES=1554`.
  Tail of `host-harness.log`: `ALL tests/wordring.js PASSED` / `WebSocket host prelude: PASS`.
- `npm test --prefix tools/lume`: `NPM_EXIT=0`,
  `# tests 52 / # pass 51 / # fail 0 / # skipped 1`.
- `python3 scripts/check_website.py`: `WEBSITE_EXIT=0`,
  `API missing: none`, `API invented: none`, `API duplicates: none`;
  no website files changed by the r179 commits.

## Verification (firmware build)

Exact command from the brief was run. Monitor result: `BUILD_FINISHED exit=0`.
Raw combined `idf.py build` + `idf.py size` output:
`artifacts/r184/idf-build-size.log` (551+ lines). ASCII summary:
`artifacts/r184/build-summary.txt`.

Build tail (raw, ASCII):

```
[100%] Linking CXX executable lume.elf
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r184-wt/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2e5a10 bytes. Smallest app partition is 0x640000 bytes. 0x35a5f0 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app

Project build complete. To flash, run:
 idf.py flash
```

`idf.py size` key rows (ASCII transcription; the exact table with box glyphs is
in the raw log; box glyphs are avoided here for the ASCII discipline):

```
DIRAM               | 247159 | 72.32 | 94601 | 341760
IRAM                |  16384 | 100.0 |     0 |  16384
IRAM .text          |  15356 | 93.73 |       |
IRAM .vectors       |   1028 |  6.27 |       |
RTC FAST            |     72 |  0.88 |  8120 |   8192
RTC SLOW            |     32 |  0.39 |  8160 |   8192
Total image size: 3037587 bytes (.bin may be padded larger)
Built target size
```

IRAM hard line: 16384 / 16384 used, Remain = 0 (>= 0). Held on the new base.
No new IRAM consumption from the r179 PS/coexist slice.

## Handoff notes

- Nothing pushed. Work remains on local branch `r184-r179-revival`.
- Board-level acceptance (association through esp-emu, real coexistence,
  touch, sleep current, radio) stays deferred, as in r179.
- Green host verification is not hardware verification.
