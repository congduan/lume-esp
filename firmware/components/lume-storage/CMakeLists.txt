# lume-storage: NVS-backed persistent KV store for the lume.storage.kv JS
# bindings (M2 / r10). Component name verified in the IDF 5.5 install:
#   nvs_flash -> components/nvs_flash/include/nvs.h and nvs_flash.h (both
#                exported via its INCLUDE_DIRS); provides nvs_flash_init /
#                nvs_open / nvs_set_* / nvs_get_* / nvs_entry_* iterator.
# No driver/lume-board dependency: NVS lives in main flash and needs no
# external peripheral.
idf_component_register(
    SRCS "lume_kv.c" "lume_fs.c"
    INCLUDE_DIRS "include"
    REQUIRES nvs_flash joltwallet__littlefs esp_partition
)
