# r173 Companion P1 device file transfer

Base `210229a`; branch `r173-companion-p1`. Device code is implemented, but
board acceptance remains deferred to Android P2 integration.

## Evidence before editing

- `lume_frame.c` and `protocol.js` use one 12-byte frame header: 4-byte magic,
  u32 little-endian payload length, u32 little-endian CRC-32. The 256 KiB
  payload cap and CRC apply to USB and HMAC-authenticated TCP alike.
- `lume_cmd.c` parses text LUMC verbs. `STORE` already has a binary-safe body,
  but no file transfer/list/delete command exists. `LUME` evaluates source;
  `LUMB` evaluates bytecode; neither is a file payload.
- `lume.storage.Fs` and `Sd` expose `write` and `append`, but their JS read
  methods cap at 64 KiB. `Sd` exposes capacity; `Fs` does not expose free space.
- r96 OTA sends `CHALLENGE <32hex>`, receives `AUTH <64hex>` HMAC-SHA256, then
  sends the same frames as USB. r119/r132 did not change the app push payload.

## Wire extension

Existing `LUME`, `LUMC`, `LUMB`, and `LUMR` magic, frame header, CRC, app
commands and their replies are unchanged. `type=app` stays implicit for the
old app paths. `FPUT` adds an explicit `file` payload type field in LUMC:

| New command payload | Reply | Bounds |
|---|---|---|
| `FPUT\tfile\t<path>\t<offset>\t<total>\n<raw chunk>` | `CMD OK fput <current-size>` | 1..8 MiB total, each chunk within 256 KiB frame, offset must match existing size |
| `FLS\t<path>` | `FLS\t<JSON fragment>` lines, `CMD OK fls <count>` | Fragments concatenate to a JSON array; max 16 KiB |
| `FGET\t<path>\t<offset>\t<length>` | `F64<base64>`, `CMD OK fget <bytes>` | 1..768 bytes per read |
| `FDEL\t<path>` | `CMD OK fdel` | regular file only |

`path` starts `sd:/` or `fs:/`. The portable parser rejects traversal (`.`
and `..`), empty segments, controls, backslashes and overlong paths. `FPUT`
checks existing size before append, so duplicate or out-of-order blocks fail
with `CMD ERR offset`; offset zero creates/truncates. The final ACK equals
`total` only after the last block. LittleFS checks `esp_littlefs_info()`
before each write and reserves 16 KiB. `FDEL` rejects directories, including
nonempty ones. `FLS` reports byte size and `dir` for immediate children.

The OTA listener's token handshake and app push path are unchanged. It feeds
LUMC to the same command handler as USB, so authenticated OTA clients can send
typed file chunks without adding another listener. The r173 CLI currently
uses serial only: `lume fput local.bin sd:/media/local.bin`,
`lume fls sd:/media`, `lume fdel sd:/media/local.bin`; `--port` selects USB.
`fput` reads back in 768-byte chunks and checks SHA-256 before reporting
success.

## Verification

- `cc ... tests/file_protocol.c ... lume_cmd.c && artifacts/r173/file_protocol`:
  `file protocol parser: 13 PASS` (valid binary, missing fields, invalid
  offsets and bounds, traversal, FLS/FDEL/FGET, existing LIST).
- `python3 tests/file_cli_mock.py`:
  `file CLI PTY mock: FPUT 100 KiB / FLS / FGET SHA-256 / FDEL PASS`.
- `npm test --prefix tools/lume`: `1..51`, `pass 50`, `fail 0`, `skipped 1`
  (raw output in `artifacts/r173/npm-test.log`).
- `python3 scripts/gen_api_docs.py --check`:
  `api.html is up to date with lume.d.ts (161 entries)`.
- Baseline default-board `idf.py size` at `210229a`: Flash Code `2,041,288 B`,
  IRAM `16,384 B` (0 remain), raw output in
  `artifacts/r173/baseline-size.log`. r173 build: Flash Code `2,044,328 B`
  (+3,040 B vs baseline, budget <=16 KB), IRAM `16,384 B` (0 remain); raw logs
  in `artifacts/r173/build.log` and `artifacts/r173/final-size.log`.
  The cold worktree build spent several minutes swapping while assembling
  unchanged vendored QuickJS. Its source and normalized compile command were
  byte-identical to the same-commit baseline, so that one object was copied
  from the baseline build cache before rerunning `idf.py build`; r173 C sources
  are compiled in the worktree build.
- `python3 tests/file_emu.py` (completed by the takeover round): `esp32sim
  LittleFS: FPUT chunks / FLS size / FGET bytes / FDEL PASS`. One engine-side
  assertion expected `FLS []` after delete; LittleFS ships a preset `apps`
  directory, so the takeover corrected the assertion to expect
  `[{apps,dir}]` (firmware behavior was already correct). Raw log
  `artifacts/r173/emu-file/serial.log`.

No UI bridge ATTR/OP ID or queue record changed, so
`tests/bridge_protocol.c` static assertions need no update.

## Deferred acceptance

- Real TF card mount, write/readback, capacity behavior, removal and
  persistence across reboot. esp32sim does not model TF media.
- Real USB throughput/reconnect behavior and WiFi HMAC-authenticated file
  transfer, including interrupted transfer recovery and concurrent app work.
- Android Companion P2 integration and user-facing file management.

## Takeover closure

### statvfs: empirical finding on the reported interruption

The controller's initial diagnosis was a missing `statvfs` mock in the host
esp32sim/stub layer. The takeover re-checked it against the current tree and
could **not reproduce** it. No mock was added, no firmware path was `#if`-gated,
no real feature was deleted, and `-Werror` was not relaxed:

- Repo-wide search over `firmware/components/`, `tests/`, `tools/`: `statvfs`
  appears only in a comment at `lume_sd.c:280` ("FATFS has no POSIX statvfs on
  ESP-IDF; f_getfree is the documented capacity query"). There is no
  `statvfs()` call site. On device, capacity goes through FATFS `f_getfree`
  (`lume_sd.c:284`); host harnesses do not compile `lume_sd.c` at all.
- The full host harness sweep (`for t in tests/*.js`) reports `TOTAL_FAIL=0`
  with no statvfs diagnostic. `tests/file_protocol.c` plus `lume_cmd.c` compile
  cleanly on the host with `-Wall -Wextra -Werror` and print
  `file protocol parser: 13 PASS`.
- `idf.py build` returns `BUILD_EXIT=0` with no statvfs-related diagnostic.
- Historical `statvfs` strings in `artifacts/r126`, `r150`, `r152`, `r154` and
  `r155` are JS-app harness copy about `Sd.statvfs()` error-code handling, not
  compiler output.

The actual interruption was an incomplete scope-guard allowlist merge after the
rebase onto `origin/main` (`5e51789`), described next.

### What was actually fixed

Twenty-three `tests/*.js` guard harnesses carried half-merged worktree edits:

- `tests/controls_demo.js`: the trunk check was renamed to
  "firmware/ identical to the r150 trunk baseline except r173 companion P1",
  but the mutation proof's `TRUNK` constant still referenced the old name, so
  `must()` aborted with `unknown check`. The constant now matches the check.
- `tests/ota_consumers.js`: `R166_ALLOWED` already admitted the r173 firmware
  files, but the `allChanged` guard reads a separate `ALLOWED` array, so the
  "only known ... files differ" check failed. The r173 source files are now in
  `ALLOWED`, and evidence under `artifacts/r173/` is admitted by prefix. Both
  mutation proofs still fire on an injected out-of-scope file.

### Takeover verification (evidence in `artifacts/r173/`)

- `for t in tests/*.js`: `TOTAL_FAIL=0` (`host-harness-final.log`).
- `npm test --prefix tools/lume`: pass 51, fail 0, skipped 1 (`npm-test-final.log`).
- Host C compile with `-Wall -Wextra -Werror`: `file protocol parser: 13 PASS`
  (`parser-final.log`).
- `python3 tests/file_cli_mock.py`: `FPUT 100 KiB / FLS / FGET SHA-256 / FDEL
  PASS` (`cli-mock-final.log`).
- `python3 tests/file_emu.py`: `esp32sim LittleFS ... PASS` (`emu-file-final.log`).
- `python3 scripts/gen_api_docs.py --check`: `api.html is up to date ... (161
  entries)` (`api-check-final.log`).
- `idf.py build`: `BUILD_EXIT=0` (`idf-build-takeover.log`). `idf.py size`:
  Flash Code `2,044,328 B` vs baseline `2,041,288 B` (`baseline-size.log`),
  delta `+3,040 B` within the <=16 KB budget; IRAM `16,384 B` (0 remain).
  Full table in `size-takeover.log`.
- No UI bridge ATTR/OP ID or queue record changed, so
  `tests/bridge_protocol.c` static assertions are unaffected.

Continuation complete; the interruption point is fixed.

续刀完成，中断点已修复。
