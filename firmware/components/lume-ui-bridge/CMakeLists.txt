idf_component_register(
    SRCS "lume_ui_bridge.c"
    INCLUDE_DIRS "include"
    REQUIRES lvgl lume-perf lume-raycast esp_timer
    PRIV_REQUIRES lume-engine   # r4 P2: lume_engine_notify_removed() on remove
)
