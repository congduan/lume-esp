#pragma once
/*
 * lume-board-hal -- runtime board interface stub (r147, M5 board abstraction).
 *
 * DIVISION OF LABOUR (read before changing anything here):
 *   The compile-time board profile (firmware/boards/<board>/lume_board_profile.h,
 *   selected by Kconfig `choice LUME_BOARD`) REMAINS the single source of
 *   truth for pins, geometry, panel init tables and touch mapping. This
 *   component is ONLY a runtime dispatch stub: a stable vtable-shaped
 *   singleton that a future second board or runtime board detection can
 *   populate. It does NOT replace the profiles and has NO consumer today.
 *
 * WHY A SEPARATE COMPONENT:
 *   `firmware/components/lume-board/` already owns the working board drivers
 *   (lume_board.c/.h, lume_display.c, lume_touch.c, lume_pmic.c). Those files
 *   are left untouched by this round; the HAL stub lives beside them so the
 *   addition stays purely incremental.
 *
 * The four ops mirror the call shapes of the existing drivers:
 *   panel_init  <- lume_display_init(lv_display_t **out_disp)
 *   touch_init  <- lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)
 *   touch_read  <- a point read (x, y, pressed)
 *   power_init  <- lume_pmic_display_power_on(i2c_master_bus_handle_t bus)
 * ESP-IDF / LVGL types are erased to `void *` so this header stays freestanding
 * and can be compiled by the host C ABI harness (tests/board_abi.c).
 *
 * Error convention matches the firmware `lume.*` hardware API: 0 = success,
 * negative = failure (the stub returns LUME_BOARD_ERR_NOT_SUPPORTED).
 */
#include <stdint.h>

#define LUME_BOARD_ERR_NOT_SUPPORTED (-1)

typedef int (*lume_board_panel_init_t)(void **out_panel);
typedef int (*lume_board_touch_init_t)(void *bus, void *panel);
typedef int (*lume_board_touch_read_t)(int *out_x, int *out_y, int *out_pressed);
typedef int (*lume_board_power_init_t)(void *bus);

typedef struct lume_board {
    lume_board_panel_init_t panel_init;
    lume_board_touch_init_t touch_init;
    lume_board_touch_read_t touch_read;
    lume_board_power_init_t power_init;
    const char *board_id;
} lume_board_t;

/* Process-wide default board. Never NULL. Today it is the "generic" stub:
 * all four ops return LUME_BOARD_ERR_NOT_SUPPORTED and board_id == "generic". */
const lume_board_t *lume_board_get(void);
