idf_component_register(
    SRCS "lume_hotreload.c"
    INCLUDE_DIRS "include"
    REQUIRES lume-engine esp_driver_usb_serial_jtag
)
