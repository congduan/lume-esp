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
