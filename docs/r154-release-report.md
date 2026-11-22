# r154 — v0.3.2 release

Tag `v0.3.2` points to `1a5ffa7fd4acd695492eed79205a6b2e5d776870` (`origin/main` at publication). Git author/committer identity: `congduan`. Only the tag was pushed; main was not pushed by this release round. Release notes: `/tmp/release-notes-v032.md` (copy: `artifacts/r154/release-notes.md`). Release: https://github.com/congduan/lume-esp/releases/tag/v0.3.2

## Build and assets

- ESP-IDF v5.5.5, default Waveshare 2.16 board. `idf.py fullclean && idf.py build` succeeded at `ba5156e`; after main fast-forwarded to r155, `idf.py build` succeeded again at the tagged commit. The `firmware/` Git tree is identical at both commits (`ad05dc664ff14433dda7a7fbdebf5fb3bf06ed82`). Raw build tail: `artifacts/r154/build-tail.log`; post-fast-forward build output: `artifacts/r154/build-after-ff.log`.
- `idf.py size`: Flash Code 2,041,288 bytes; IRAM 16,384/16,384 bytes, 0 remain. Raw output: `artifacts/r154/size.txt`.
- esptool v4.13 merged the final build into `firmware/build/merged_flash.bin` (0x2f5540 bytes). Raw output: `artifacts/r154/merge.txt`.
- Release assets: `bootloader.bin`, `partition-table.bin`, `lume.bin`, `flash_args`, `README-flash.txt`. The uploaded `flash_args` uses flat basenames. MD5s: `artifacts/r154/assets-local.md5`.

## Verification

- `tests/*.js` at the tag: **89 harnesses, 0 FAIL**, raw output `artifacts/r154/js-regression.txt`. Before `npm ci --prefix tools/lume`, one of 87 harnesses failed because esbuild was absent; that attempt is retained in `artifacts/r154/js-regression-before-npm-ci.txt`. The 87-harness retry at `ba5156e` passed; its output is `artifacts/r154/js-regression-ba5156e.txt`.
- `npm test --prefix tools/lume`: 49 passed, 1 skipped, 0 failed; raw output `artifacts/r154/cli-tests.txt`.
- Tag CI run `45014093250`: all three board build jobs succeeded. After its default-board Release step, the five local assets were uploaded again with `gh release upload --clobber` and the release notes were restored.
- Final download gate: all five release URLs returned HTTP 200 and all five downloaded MD5s matched their local files; `lume.bin` was `1e946e5aedfa6ecd9250ef719cd1e965`. Raw output: `artifacts/r154/download-verify.txt`.

## Known issues and limits

- `tools/emu-net` provides an acceptance runner, but the r142/r144 virtual WiFi association remains unresolved upstream; no successful virtual DHCP/HTTP chain or board radio acceptance is claimed.
- Firmware build and host tests do not establish on-device display, touch, WiFi OTA, sleep current, or other hardware acceptance.
- r155 added a checked-in ClickWheel demo, giving the Playground 56 editable sources. Its hard-coded `tools/playground/build.mjs` list still has 55 entries; rerunning only that builder drops `ipod_music` until the r155 extra build is repeated. See `docs/r155-clickwheel-report.md`.
- r153 Keyboard per-key state coloring was not merged before the tag and is absent from release notes.
