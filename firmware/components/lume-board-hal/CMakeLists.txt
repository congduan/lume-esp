# lume-board-hal (r147, registry since r176): runtime board-interface component.
#
# Discovered automatically from firmware/components/ by ESP-IDF v5.5.5. It has
# no REQUIRES entry in firmware/main/CMakeLists.txt; IDF processes all
# discovered components when COMPONENTS is unset. Its only consumer is
# lume-board (one-way: lume-board REQUIRES lume-board-hal). The compile-time
# profile selected by Kconfig LUME_BOARD remains the source of truth -- see
# include/lume_board_hal.h.
idf_component_register(
    SRCS "lume_board_hal.c"
    INCLUDE_DIRS "include"
)
