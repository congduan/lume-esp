idf_component_register(
    SRCS "lume_board.c" "lume_pmic.c" "lume_display.c" "lume_touch.c"
    INCLUDE_DIRS "include" "${CMAKE_SOURCE_DIR}/boards/waveshare_esp32_s3_touch_amoled_2_16"
    PRIV_REQUIRES driver esp_lcd esp_timer lvgl lume-ui-bridge
)
