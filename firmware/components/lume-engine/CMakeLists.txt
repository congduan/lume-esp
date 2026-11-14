idf_component_register(
    SRCS "lume_engine.c" "lume_scripts.c" "lume_image.c" "lume_image_header.c" "lume_image_pixels.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_timer quickjs-ng lvgl lume-ui-bridge lume-gpio lume-adc lume-pmic lume-imu lume-storage lume-net lume-audio lume-power
)
