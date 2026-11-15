idf_component_register(SRCS "mp3_decoder.c" INCLUDE_DIRS "include" "vendor"
    REQUIRES lume-board PRIV_REQUIRES fatfs sdmmc esp_driver_spi)
