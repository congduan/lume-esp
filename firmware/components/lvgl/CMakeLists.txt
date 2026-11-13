# LVGL v9.3.0 as ESP-IDF component (hidden render backend)
file(GLOB_RECURSE LVGL_SOURCES ${CMAKE_CURRENT_LIST_DIR}/src/*.c)

idf_component_register(
    SRCS ${LVGL_SOURCES}
    INCLUDE_DIRS "." "${CMAKE_CURRENT_LIST_DIR}"
    PRIV_INCLUDE_DIRS "."
)

# lv_conf.h resolution: LV_CONF_PATH points at our component-root config
target_compile_definitions(${COMPONENT_LIB} PUBLIC
    LV_CONF_PATH="${CMAKE_CURRENT_LIST_DIR}/lv_conf.h"
    LV_CONF_SKIP=1
)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-unused-function -Wno-type-limits)
