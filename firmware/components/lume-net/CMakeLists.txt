# lume-net: WiFi station + basic HTTP client for the lume.net / lume.net.http
# JS bindings (M2 / r11). Component/dependency names verified against the
# IDF v5.5.5 install and the official examples:
#   examples/wifi/getting_started/station/main/CMakeLists.txt   -> esp_wifi, nvs_flash
#   examples/protocols/esp_http_client/main/CMakeLists.txt      -> esp_http_client, esp_event, esp_netif
# esp_wifi's own public REQUIRES already pulls in esp_event / esp_netif / esp_phy
# (components/esp_wifi/CMakeLists.txt:62); we list them explicitly because this
# component calls esp_event_* / esp_netif_* directly.
# NVS is shared with lume-storage (KV): lume_net_init() calls the idempotent
# nvs_flash_init(). WiFi IRAM options are forced off in sdkconfig (see r11 docs)
# so the WiFi hot-path code stays in flash, not the 100%-full 16 KB IRAM.
idf_component_register(
    SRCS "lume_net.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_wifi esp_event esp_netif nvs_flash esp_http_client
)
