# r58b mini-SVG final report

## Integration ruling

The prior stop record remains in commit `8d952c8`. This round applies the main controller's four rulings: SVG intrinsic size uses pixel width/height with per-axis viewBox fallback; SVG bypasses the bitmap 480 size gate; `decode_ex` uses optional targets and bounds SVG rasters to 480×480; the prelude applies Image style before `_setSource(id, src, width, height)`; host stubs and assertions follow the new call order. PNG/JPEG ignore targets and retain the prior decoder path.

The freestanding `lume-svg` component tokenizes XML, flattens M/L/H/V/C/S/Q/T/A/Z paths and renders the shape subset with even-odd sampled antialiasing. On ESP-IDF its edges and RGBA buffer use PSRAM; the image layer converts to RGB565A8. `viewBox` maps with centered meet. Unsupported features and board acceptance remain in `KNOWN-SIMPLIFICATIONS.md`.

## Host verification

Full raw logs: `artifacts/r58/js-harness.log`, `artifacts/r58/npm-test.log`, `artifacts/r58/svg-test.log`, `artifacts/r58/image-header.log`.

```text
PASS rect and hex fill
PASS circle and color name
PASS ellipse and rgb
PASS polygon even odd
PASS path cubic quadratic arc
PASS smooth curves and relative arc
PASS relative path and stroke
PASS opacity and AA
PASS viewBox intrinsic size
PASS unsupported units fall back to viewBox
PASS oversized intrinsic and explicit target
PASS viewBox meet centered letterbox
PASS raster bound
PASS missing intrinsic rejected
PASS BOM whitespace px
PASS PNG IHDR 1x1
PASS JPEG SOF 3x2
PASS oversize rejected before decode
PASS bad bytes rejected
PASS SVG intrinsic over 480 accepted
PASS invalid argument error code
PASS 1x1 opaque red RGBA to exact RGB565A8 bytes
```

```text
PASS Image create/source/size message order
PASS Image participates in View flex child adoption
PASS Image preserves aspect ratio for one explicit dimension
PASS Image forwards two explicit raster dimensions
PASS Image propagates decoder error and removes failed node
PASS Image rejects invalid input and propagates header error
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
```

```text
  duration_ms: 146.352569
  type: 'test'
  ...
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 2241.664383
```

```text
JS_HARNESS_EXIT=0
PASS weather dayAt falls back for out-of-range indexes
PASS weather icons issue the expected raster commands and repaint the whole canvas
PASS 10 weather logic cases
PASS weather refresh replaces the demo data
PASS weather request failure keeps the app usable
PASS weather non-200 response is reported
PASS 13 weather cases (10 logic + 3 UI)
WebSocket host prelude: PASS
```

## Firmware and emulator verification

The full raw output is retained locally in `artifacts/r58/build.log`, `artifacts/r58/size.log`, and `artifacts/r58/check-svg.log`. The build used `/tmp/lume-r58-wt/firmware` after `idf.py fullclean`; no source or object from the main worktree was used.

```text
BUILD_EXIT=0
[100%] Built target lume.elf
[100%] Generating binary image from built executable
esptool.py v4.13.0
Creating esp32s3 image...
Merged 3 ELF sections
Successfully created esp32s3 image.
Generated /tmp/lume-r58-wt/firmware/build/lume.bin
[100%] Built target gen_project_binary
lume.bin binary size 0x2d7ab0 bytes. Smallest app partition is 0x640000 bytes. 0x368550 bytes (55%) free.
[100%] Built target app_check_size
[100%] Built target app

Project build complete. To flash, run:
 idf.py flash
or
 idf.py -p PORT flash
or
 python -m esptool --chip esp32s3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0x10000 build/lume.bin
or from the "/tmp/lume-r58-wt/firmware/build" directory
 python -m esptool --chip esp32s3 -b 460800 --before default_reset --after hard_reset write_flash "@flash_args"
```

```text
SIZE_EXIT=0
│ Flash Code        │      1999052 │          │                │               │
│ DIRAM             │       230555 │    67.46 │         111205 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 2980411 bytes (.bin may be padded larger)
```

```text
lume check examples/svg_icon

[PASS] bundle   506 bytes (19 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for svg_icon
[SKIP] perf     profile disabled

screenshot: artifacts/check/svg_icon/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

The IRAM hard line is `16384/16384` bytes, equal to the baseline and not exceeded. The emu screenshot is `artifacts/check/svg_icon/tft.png`; visual inspection shows the centered checkmark inside the blue frame. These results are host/emulator evidence only; on-device acceptance remains pending.

An earlier emulator run with a 100×100 circle and outline did not complete app evaluation in the emulator's 8-second window. The final 80×80 rect/path icon passed. Complex-path decode latency is recorded in `KNOWN-SIMPLIFICATIONS.md` for board profiling.
