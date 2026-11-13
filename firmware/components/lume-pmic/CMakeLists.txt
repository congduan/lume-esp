# lume-pmic: AXP2101 battery telemetry + power-off hardware layer for the
# lume.pmic JS bindings (M2).
# Driver component names verified in the IDF 5.5 install:
#   driver          -> driver/i2c_master.h (driver/CMakeLists.txt:110 REQUIRES
#                      esp_driver_i2c; the header lives in
#                      esp_driver_i2c/include/driver/). Same umbrella
#                      component lume-board uses for the shared bus.
#   lume-board      -> lume_board_get_i2c_bus() (include/lume_board.h).
idf_component_register(
    SRCS "lume_pmic_hw.c"
    INCLUDE_DIRS "include"
    REQUIRES driver lume-board
)
