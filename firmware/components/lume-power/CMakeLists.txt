idf_component_register(
    SRCS "lume_power.c"
    INCLUDE_DIRS "include"
    REQUIRES lume-board lume-net esp_hw_support driver
)
