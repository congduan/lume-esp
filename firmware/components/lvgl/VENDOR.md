# LVGL v9.3.0 vendored for Lume (ESP-IDF component)

Upstream: https://github.com/lvgl/lvgl tag v9.3.0
Not vendored: demos/, examples/, docs/, env_support/, scripts/ — trimmed.

Lume-specific: `lv_conf.h` at component root (16bpp RGB565, PSRAM-friendly
malloc routing, esp_timer tick). LVGL is a hidden render backend — app code
never includes lvgl headers; it talks to the declarative UI bridge only.

## ESP-IDF build fix (2026-11-13)

- Restored the missing root-level `lvgl_private.h` (verbatim from upstream
  tag v9.3.0). The vendored `src/` tree already had the Arduino-compat shim
  `src/lvgl_private.h`, which does `#include "../lvgl_private.h"`; without
  the root umbrella ~15 `src/drivers/**` / `src/others/**` sources failed
  with `fatal error: ../lvgl_private.h: No such file or directory`. All 90
  private headers it includes are present in the vendored tree.

## r35 CJK fallback font (2026-11-14)

- Added `src/font/lume_font_sc_16.c`: generated 16 px / 2 bpp lvgl-format font
  (ASCII 0x20–0x7E + ~2500 common simplified-Chinese glyphs + CJK punctuation,
  DroidSansFallbackFull source, `--no-kerning --no-compress`). Glyph data sits
  in flash `.rodata` (LV_ATTRIBUTE_LARGE_CONST).
- `lv_conf.h`: `LV_FONT_CUSTOM_DECLARE` now declares `lume_font_sc_16`.
  Existing montserrat enable set unchanged; `LV_FONT_DEFAULT` unchanged.
- `lv_font_montserrat_{14,20,32}.c`: one-line `.fallback = &lume_font_sc_16`
  on each face, so any glyph the Latin faces lack falls through to the SC
  face (mixed Latin/CJK strings render from a single font pointer).
