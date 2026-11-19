# lume-storage: NVS-backed persistent KV store for the lume.storage.kv JS
# bindings (M2 / r10), LittleFS app store (r12/r30), and the TF-card SPI
# layer lume.storage.Sd (r125). Component names verified in the IDF 5.5
# install:
#   nvs_flash -> components/nvs_flash/include/nvs.h and nvs_flash.h (both
#                exported via its INCLUDE_DIRS); provides nvs_flash_init /
#                nvs_open / nvs_set_* / nvs_get_* / nvs_entry_* iterator.
#   fatfs/sdmmc/esp_driver_sdspi/esp_driver_spi/esp_driver_gpio ->
#                esp_vfs_fat_sdspi_mount + sdspi host/device + gpio (CD).
#   lume-board -> lume_pins.h board-profile shim (LUME_PIN_SD_* pins).
idf_component_register(
    SRCS "lume_kv.c" "lume_fs.c" "lume_sd.c"
    INCLUDE_DIRS "include"
    REQUIRES nvs_flash joltwallet__littlefs esp_partition fatfs sdmmc
             esp_driver_spi esp_driver_sdspi esp_driver_gpio lume-board
)
