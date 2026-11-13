# lume-gpio: GPIO + LEDC PWM hardware layer for the lume.gpio JS bindings.
# Driver component names verified in the IDF 5.5 install:
#   esp_driver_gpio -> driver/gpio.h, esp_driver_ledc -> driver/ledc.h
# (esp_driver_ledc already REQUIRES esp_driver_gpio; listed here too for clarity.)
idf_component_register(
    SRCS "lume_gpio.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_driver_gpio esp_driver_ledc
)
