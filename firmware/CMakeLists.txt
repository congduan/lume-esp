# Lume firmware top-level CMake
cmake_minimum_required(VERSION 3.16)

# Board selection (r27). ESP-IDF v5.5.5 accepts SDKCONFIG_DEFAULTS as a LIST of
# defaults files (tools/cmake/project.cmake:680-686): the common settings first,
# then the selected board's defconfig. A plain `idf.py build` therefore selects
# Waveshare. To build another board:
#   idf.py -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;boards/<name>/sdkconfig.defaults" build
# The board defconfig also selects the Kconfig `choice LUME_BOARD`, whose
# LUME_BOARD_DIR string drives lume-board/CMakeLists.txt's include path.
# See firmware/boards/README.md.
if(NOT SDKCONFIG_DEFAULTS)
    set(SDKCONFIG_DEFAULTS
        "sdkconfig.defaults"
        "boards/waveshare_esp32_s3_touch_amoled_2_16/sdkconfig.defaults")
endif()

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(lume)
