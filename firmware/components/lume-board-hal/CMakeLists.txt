# lume-board-hal (r147): runtime board-interface stub component.
#
# Discovered automatically from firmware/components/ by ESP-IDF v5.5.5. It has
# no consumer and therefore no REQUIRES entry in firmware/main/CMakeLists.txt;
# IDF processes all discovered components when COMPONENTS is unset. The
# compile-time profile selected by Kconfig LUME_BOARD remains the source of
# truth -- see include/lume_board_hal.h.
idf_component_register(
    SRCS "lume_board_hal.c"
    INCLUDE_DIRS "include"
)
