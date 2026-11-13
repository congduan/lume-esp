# lume-imu: QMI8658 accel + gyro hardware layer for the lume.imu JS bindings
# (M2 / r9), POLLED-ONLY. Component names verified in the IDF 5.5 install:
#   driver     -> driver/i2c_master.h (the same umbrella component lume-board
#                 and lume-pmic use for the shared bus).
#   lume-board -> lume_board_get_i2c_bus() (include/lume_board.h).
idf_component_register(
    SRCS "lume_imu_hw.c"
    INCLUDE_DIRS "include"
    REQUIRES driver lume-board
)
