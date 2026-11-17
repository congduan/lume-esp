idf_component_register(
    SRCS "lume_engine.c" "lume_math.c" "lume_fft.c" "lume_imgscale.c" "lume_image.c" "lume_image_header.c" "lume_image_pixels.c" "lume_image_decode.c" "lume_apps.c" "lume_scripts.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_timer quickjs-ng lvgl lume-ui-bridge lume-raycast lume-gpio lume-adc lume-pmic lume-imu lume-storage lume-net lume-ble lume-audio mp3_decoder lume-power lume-perf lume-svg
)
