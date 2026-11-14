# lume-ble: NimBLE GATT peripheral behind the lume.ble JS bindings (r25).
# `bt` supplies the ESP-IDF controller + NimBLE host (selected in
# sdkconfig.defaults: CONFIG_BT_ENABLED=y / CONFIG_BT_NIMBLE_ENABLED=y /
# CONFIG_BT_BLUEDROID_ENABLED=n). nvs_flash is initialized idempotently for
# the NimBLE store; it is already shared with lume-storage and lume-net.
# No idf_component.yml: everything comes from ESP-IDF itself.
idf_component_register(
    SRCS "lume_ble.c"
    INCLUDE_DIRS "include"
    REQUIRES bt nvs_flash
)
