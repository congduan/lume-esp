idf_component_register(
    SRCS "lume_main.c"
    INCLUDE_DIRS "include"
    REQUIRES lume-engine lume-board lume-ui-bridge lume-hotreload lume-imu lume-storage
)
