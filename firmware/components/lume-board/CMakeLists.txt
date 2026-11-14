# The selected board's directory (Kconfig choice LUME_BOARD -> LUME_BOARD_DIR)
# supplies lume_board_profile.h on the public include path. All board values
# are compile-time constants there; no runtime board-switching code is linked.
idf_component_register(
    SRCS "lume_board.c" "lume_pmic.c" "lume_display.c" "lume_touch.c"
    INCLUDE_DIRS "include" "${CMAKE_SOURCE_DIR}/boards/${CONFIG_LUME_BOARD_DIR}"
    PRIV_REQUIRES driver esp_lcd esp_timer lvgl lume-ui-bridge
)
