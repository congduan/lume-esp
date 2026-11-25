# ESP-IDF includes component CMakeLists in script mode for requirement
# gathering; add_custom_command is not scriptable, so only add the
# generation rule in real build mode.
if(NOT CMAKE_SCRIPT_MODE_FILE)
set(LUME_PRELUDE_DIR "${CMAKE_CURRENT_LIST_DIR}/prelude")
set(LUME_SCRIPTS_INC "${CMAKE_CURRENT_BINARY_DIR}/lume_scripts.inc")
add_custom_command(
    OUTPUT "${LUME_SCRIPTS_INC}"
    COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/gen_lume_scripts.py"
            "${LUME_SCRIPTS_INC}" "${LUME_PRELUDE_DIR}"
    DEPENDS "${CMAKE_CURRENT_LIST_DIR}/gen_lume_scripts.py"
            "${LUME_PRELUDE_DIR}/prelude.js"
            "${LUME_PRELUDE_DIR}/demo.js"
            "${LUME_PRELUDE_DIR}/home.js"
    VERBATIM
)
set_source_files_properties(lume_scripts.c PROPERTIES OBJECT_DEPENDS "${LUME_SCRIPTS_INC}")
endif()

idf_component_register(
    SRCS "lume_engine.c" "lume_math.c" "lume_fft.c" "lume_imgscale.c" "lume_image.c" "lume_svg_cache.c" "lume_image_header.c" "lume_image_pixels.c" "lume_image_decode.c" "lume_apps.c" "lume_scripts.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_timer esp_netif quickjs-ng lvgl lume-ui-bridge lume-raycast lume-gpio lume-adc lume-pmic lume-imu lume-storage lume-net lume-ble lume-audio mp3_decoder lume-power lume-perf lume-svg lume-crypto lume-compress lume-board-hal
)
target_include_directories(${COMPONENT_LIB} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
