idf_component_register(SRCS "lume_audio.c" INCLUDE_DIRS "include"
    REQUIRES lume-board PRIV_REQUIRES esp_driver_i2s esp_driver_i2c esp_driver_gpio)
