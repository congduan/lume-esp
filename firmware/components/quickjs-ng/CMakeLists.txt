# QuickJS-NG as ESP-IDF component.
# Upstream sources vendored in this dir (see VENDOR.md). We compile the core
# engine sources directly; HOST tools (qjsc etc.) are NOT built on target.
idf_component_register(
    SRCS
        "cutils.c"
        "dtoa.c"
        "libregexp.c"
        "libunicode.c"
        "quickjs.c"
        "xsum.c"
    INCLUDE_DIRS "."
    PRIV_INCLUDE_DIRS "."
)
# Build options tuned for ESP32-S3 + PSRAM
target_compile_definitions(${COMPONENT_LIB} PRIVATE
    _GNU_SOURCE
    CONFIG_VERSION="0.10.1-lume"
    QUICKJS_NG=1
)
target_compile_options(${COMPONENT_LIB} PRIVATE
    -Wno-array-bounds -Wno-implicit-const-int-float-conversion
    -Wno-override-init -Wno-unused-function -Wno-unused-variable
    -Wno-implicit-fallthrough -Wno-sign-compare
)
