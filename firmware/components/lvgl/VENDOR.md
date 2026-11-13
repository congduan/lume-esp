# LVGL v9.3.0 vendored for Lume (ESP-IDF component)

Upstream: https://github.com/lvgl/lvgl tag v9.3.0
Not vendored: demos/, examples/, docs/, env_support/, scripts/ — trimmed.

Lume-specific: `lv_conf.h` at component root (16bpp RGB565, PSRAM-friendly
malloc routing, esp_timer tick). LVGL is a hidden render backend — app code
never includes lvgl headers; it talks to the declarative UI bridge only.
