idf_component_register(
    SRCS "lume_board.c" "lume_pmic.c" "lume_display.c" "lume_touch.c"
    INCLUDE_DIRS "include"
    PRIV_REQUIRES driver esp_lcd esp_timer lvgl
)
