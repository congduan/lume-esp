# r142 — esp-emu network acceptance infrastructure

## Scope and split

| Tool | Acceptance surface | Evidence |
|---|---|---|
| `tools/emu` (esp32sim) | CO5300 frame rendering and visual/layout checks | TFT PNG and visual harness |
| `tools/emu-net` (Espressif esp-emu) | Real firmware boot, virtual WiFi station, DHCP, HTTP, optional SDSPI probe | Serial log and `[NETCHECK]` lines |

The runner copies a merged flash image, installs the JS app into the existing
LittleFS storage partition (`0x750000`, 1 MiB), and selects it through
`apps/.current`. This follows the production app boot path without changing
firmware or injecting a binary LUME frame. `--inject` only supports printable
text and does not decode `\x` byte escapes. The runner uses the emulated
gateway `192.168.4.1` as the host loopback HTTP target and pins the user-mode
subnet with `--net user,net=192.168.4.0/24` to suppress the default-subnet
warning.

## Verification

`lume check examples/net_check --no-emu` passed. Full output is in
`artifacts/r142/lume_check_no_emu.txt`:

```text
lume check examples/net_check

[PASS] bundle   1549 bytes (96 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

The `tests/*.js` loop reached a pre-existing static allowlist failure in
`tests/ota_consumers.js`. Its base is `4e00954`, and current r142 base
`1cf85d1` already contains files absent from that allowlist. The test uses
`git diff` and cannot see the new untracked r142 directories; the failure is
present before this change. The loop before that test and the continuation
through the remaining harnesses are retained verbatim in
`artifacts/r142/tests_all_js.txt` and `tests_remaining_js.txt` (the latter
completed with zero further harness failures). This means the requested
all-green JS regression was **not** obtained.

The merged image produced by esptool was 3,101,680 bytes. The prepared flash
copy including the populated storage partition was 8,716,288 bytes. Raw
`wc -c` output is in `artifacts/r142/merged_flash_size.txt`.

## WiFi and HTTP outcome

The existing image built from the main checkout at `/home/ubuntu/lume` booted the
preloaded app (`boot app 'net_check'`), and `net.init()` and `net.connect()`
returned zero. WPA2 association did not finish: serial showed
`wifi:state: assoc -> init (0x400)` and `sta disconnected`; retries likewise
ended in `ip FAIL timeout state=0 ip=null`. No `got ip` or `ALL PASS` line was
observed in these runs. A local build from this worktree was attempted but
stopped at 97% after sustained memory swapping during LVGL assembly on this
2 GiB host; its raw output is in `artifacts/r142/firmware_build_attempt.txt`.
The final run therefore used the existing main-checkout build via
`EMU_NET_BUILD_DIR`. The app's HTTP step is gated on
`GOT_IP=3`, so HTTP reachability is unverified when association fails.

The default esp-emu v1.2.0 AP transition mode and explicit
`--wifi-auth wpa2-psk` were both tried. The runner pins WPA2-PSK to match
`lume.net.connect`'s WPA2 threshold. esp-emu v1.2.0 also returned code zero
on a timeout in direct runs; the runner checks the expected serial assertion
and returns nonzero when it is absent.

The final full-chain runner returned **1**. Its raw stdout/stderr is in
`artifacts/r142/run_output.txt`, and the complete serial log is
`artifacts/r142/serial.log`:

```text
esptool.py v4.13.0
SHA digest in image updated
Wrote 0x2f53f0 bytes to file merged_flash.bin, ready to flash to offset 0x0
prepared /tmp/lume-r142-wt/artifacts/r142/flash.bin: 8716288 bytes; app 2837 bytes
I (1880) lume-engine: js: [NETCHECK] init PASS ret=0
I (1887) lume-engine: js: [NETCHECK] connect PASS ret=0
I (31895) lume-engine: js: [NETCHECK] ip FAIL timeout state=0 ip=null
serial: /tmp/lume-r142-wt/artifacts/r142/serial.log
exit-on string absent (esp-emu timeout): [NETCHECK] ALL PASS
```

## TF card applicability

A 64 MiB FAT32 image was created with `dd` and `mkfs.vfat -F 32` and passed as
`--sd <image>,cs=41`, matching the board profile's SDSPI CS pin. esp-emu does
support SDSPI with `cs=PIN`, so SDMMC-only incompatibility is not the reason
for this result. The firmware reached card initialization but failed at CID:

```text
I (1925) sdspi_transaction: cmd=5, R1 response: command not supported
E (1925) sdmmc_common: sdmmc_init_cid: send_cid returned 0x101
E (1926) vfs_fat_sdmmc: sdmmc_card_init failed (0x101).
W (1926) lume-sd: SD mount failed: ESP_ERR_NO_MEM
I (1926) lume-engine: js: [NETCHECK] sd_mount FAIL mounted=false
```

This combination cannot currently accept `lume.storage.Sd`; do not infer a
board-level TF failure from the emulator result. The raw trace is
`artifacts/r142/sd/serial.log`.

## Limits and next acceptance

- The touch model is absent, so `touch bus down after 10 read errors` repeats.
  AXP2101 and IMU warnings are expected in this emulator. The runner retains
  the unfiltered serial log so other errors are visible.
- The main runner has no board display model; visual checks stay in
  `tools/emu`.
- `tools/lume/check.js` was left alone under this round's redline. A `--net`
  mode would need another emulator runner, result schema, and timeout contract;
  `tools/emu-net/run.sh` is the independent entry for now.
- On-device radio, HTTP, TF, display, and touch acceptance remain deferred.
