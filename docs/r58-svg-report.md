# r58 mini-SVG: integration gate

Status: stopped before implementation under the task brief's fixed-scope / size-mapping stop clause. Baseline `809ecdc7e3d75c2c6668f43764fc32e718d10628` on `r58-svg`.

## Code evidence

- `lume_image_decode()` (`firmware/components/lume-engine/lume_image.c:35-71`) first calls `lume_image_size_of()`, then chooses PNG when byte 0 is `0x89`; every other accepted input goes to JPEG. PNG uses `lodepng_decode32()` and `lume_image_rgba_to_rgb565a8()`. Output is PSRAM-owned RGB565/RGB565A8.
- `lume_image_size_of()` (`lume_image_header.c:9-41`) recognizes only PNG IHDR and JPEG SOF. An SVG returns `-2` before decode. The decoded source dimensions must be at most the 480×480 board dimensions; oversize returns `-1`.
- The prelude `Image()` (`lume_scripts.c:834-848`) calls `image.sizeOf(src)` before creating the node. It computes `style.width` / `style.height`, then calls `_setSource(id, src)` **before** applying style attributes. The C `_setSource` wrapper (`lume_engine.c:666-686`) accepts only ID and bytes, and `lume_image_decode()` receives no target canvas dimensions.

This conflicts with the requested rule “SVG canvas dimensions = Image node declared dimensions.” At decode time, those dimensions are unavailable. Merely adding an SVG magic branch to `lume_image.c` cannot implement the rule; SVG also cannot pass the existing `sizeOf` gate. A source SVG with `viewBox` but no width/height leaves the current intrinsic-size calculation undefined. A style dimension larger than 480 may currently be used for LVGL display scaling, while decoded pixel dimensions remain capped at 480; the intended SVG raster budget needs a decision.

Possible interface change for main-controller review: extend SVG size probing to derive an intrinsic size, pass the resolved style width/height from `Image()` into `_setSource`, and render at a validated target size. Please decide the fallback size for viewBox-only SVGs and whether style dimensions above 480 are rejected or capped. These choices affect existing `Image` semantics and tests.

## Verification and delivery

No source, vendored component, or test was changed. No host test, firmware build/size, emu run, or screenshot was produced after this stop condition. The pre-existing untracked `tools/lume/node_modules` was left untouched. No hardware acceptance is claimed.
