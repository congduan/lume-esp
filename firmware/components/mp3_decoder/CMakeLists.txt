idf_component_register(SRCS "mp3_decoder.c" "id3v2.c" INCLUDE_DIRS "include" "vendor"
    REQUIRES lume-board PRIV_REQUIRES fatfs sdmmc esp_driver_spi)
