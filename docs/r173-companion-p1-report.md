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
