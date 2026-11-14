# lume-hotreload: JS app push channels (USB Serial/JTAG M1 + WiFi TCP OTA r26).
# lume_frame.c is portable C (no RTOS/ESP deps); both transports feed it.
# Dependency direction (one-way, no cycle):
#   lume-hotreload -> lume-engine (reload chain), lume-net (WiFi gate),
#                     esp_driver_usb_serial_jtag (USB), nvs_flash (token),
#                     lwip (TCP sockets), esp_hw_support (esp_fill_random).
# The engine reaches otaStatus via a registered function pointer, NOT a link
# dependency, so lume-engine does NOT need lume-hotreload in REQUIRES.
idf_component_register(
    SRCS "lume_hotreload.c" "lume_frame.c"
    INCLUDE_DIRS "include"
    REQUIRES lume-engine lume-net esp_driver_usb_serial_jtag nvs_flash lwip esp_hw_support
)
