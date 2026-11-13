idf_component_register(
    SRCS "lume_engine.c" "lume_scripts.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_timer quickjs-ng lume-ui-bridge
)
