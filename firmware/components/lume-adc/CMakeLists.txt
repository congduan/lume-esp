# lume-adc: ADC1 oneshot + curve-fitting calibration hardware layer for the
# lume.adc JS bindings (M2).
# Driver component name verified in the IDF 5.5 install:
#   esp_adc -> esp_adc/adc_oneshot.h, esp_adc/adc_cali.h,
#              esp_adc/adc_cali_scheme.h
# esp_adc privately requires esp_driver_gpio itself (see its CMakeLists) and
# this layer calls no driver/gpio.h API directly (adc_oneshot_config_channel()
# owns the pad routing), so no explicit esp_driver_gpio REQUIRES is needed.
idf_component_register(
    SRCS "lume_adc.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_adc
)
