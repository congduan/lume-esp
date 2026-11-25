# r74 — Real firmware in the browser (esp32sim WASM × playground Firmware tab)

Date: 2026-11-16 (night round). Engine status: CodeBuddy rate-limited until
2026-11-17 18:17 (+08) and the Codex workspace was out of credits, so this round
was finished by the controlling agent under the no-model-switch discipline
(lume-cadence). Commit `2b5f9e4` (fw-sync CI + seeded trio, "step 1") was
produced before the engines ran dry; everything below continued that work.

## Goal

The unmodified Lume firmware — the same `.bin` flashed to the board — running in
a browser tab via the esp32sim WebAssembly emulator, reachable from the docs
site, alongside the existing prelude-simulation playground modes.

## What shipped

1. **fw-sync CI (commit 2b5f9e4)**: `.github/workflows/fw-sync.yml` copies the
   firmware trio (`lume.bin` / `bootloader.bin` / `partition-table.bin`) from
   the latest successful `firmware.yml` build into `website/wasm/fw/` and
   regenerates the esp32sim manifest `lume.json` (board
   `waveshare-amoled18-v2`, `expect: "app eval ok"`, `_note` carrying commit
   SHA + build date). The Apache-2.0 mask ROM ELF
   (`esp32s3_rev0_rom.elf`, espressif esp-rom-elfs) is self-hosted for
   same-origin loading. The trio is seeded locally from Build firmware run 41
   so the first Pages deployment works before the first sync run.
2. **Self-hosted esp32sim runner**: official run.html + wasm modules
   (`esp32sim.wasm`, `worker.js`, `jit.mjs`, `experiments.mjs`, `pacing.mjs`),
   xterm vendor files, and the Atech board skin assets, vendored into
   `website/` (see KNOWN-SIMPLIFICATIONS for the vendoring caveat).
3. **Playground Firmware tab**: third tab (Examples / Editor / Firmware) with a
   launch button to `run.html?wasm&fw=lume` on the same origin, the current
   firmware version line pulled from the manifest `_note`, and honest
   fidelity/hot-reload caveats. Examples and Editor behaviour unchanged.
4. **Docs**: README "Real firmware in your browser", roadmap M4 distribution
   note, KNOWN-SIMPLIFICATIONS entries, this report.

## Evidence (local, pre-push — Pages deployment not yet verified)

- Resource-completeness test: loading
  `http://127.0.0.1:8095/run.html?wasm&fw=lume` initially 404'd on
  `wasm/pacing.mjs`, `wasm/fw/demos.json`, and seven `assets/atech/*.webp`
  files; all were fetched from the official origin, after which a Playwright
  sweep reports **zero requests ≥ 400**.
- Boot test (Playwright, headless Chromium, ~50 s simulated time):
  machine configuration shows SOC ESP32-S3 rev 0, board Waveshare AMOLED-1.8
  V2, 16 MB flash / 8 MB PSRAM, boot chain mask ROM → 2nd stage → application,
  manifest `lume.json`; telemetry runs at ~4.4 Minsn/s (real time); the
  **panel renders the Lume launcher home screen** — status bar clock `00:00`
  plus `no apps installed / lume deploy <app>` — through the real firmware's
  CO5300 QSPI pipeline. Screenshot: `/tmp/esp32sim-lume-clean.png`
  (round-local evidence; not committed).
- Serial: firmware boots and logs; the only recurring lines are
  `W (...) lume-touch: touch bus down after 10 read errors, resetting` — the
  emulated touch IC does not satisfy the CST9220 driver. No `eval failed`,
  no panic.
- Playground tab (Playwright): three tabs present; Firmware tab shows the
  panel, version line ("Current firmware: Lume real firmware. Populated by
  CI …"), and launch link `../run.html?wasm&fw=lume`; switching back to
  Examples restores the Counter app (device has children, title restored);
  zero page errors.

## Honest fidelity statement

This is **pipeline-level fidelity, not hardware acceptance**: the emulator
models a 368x448 CO5300 QSPI panel and a CST820-class touch IC, while the real
board is 480x480 with CST9220. Rendering, boot, and serial behaviour exercise
the real firmware code paths; touch interaction in the emulator is not yet
usable (touch-bus reset warnings), panel geometry differs, and nothing here
validates touch feel, brightness, or sleep current on the device. The manifest
`expect` string (`app eval ok`) has not yet been asserted against the deployed
Pages URL — that is the first follow-up once CI runs green.

## Follow-ups

1. Push, wait for firmware.yml → fw-sync.yml → Pages, then verify the deployed
   `wasm/fw/lume.json` + trio URLs and boot the deployed run.html URL.
2. Investigate the emulated touch mismatch (CST820 model vs CST9220 driver):
   either an upstream board-profile request or a compile-time touch-driver
   shim for the simulator build.
3. Consider automating a CI assertion that the deployed firmware boots
   (serial contains `app eval ok`) using the Playwright sweep from this round.
