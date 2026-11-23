/*
 * lume-board-hal -- runtime board registry + default stub singleton.
 *
 * No board profile include and no ESP-IDF dependency: lume-board registers
 * its real drivers at boot, and this component only stores/copies the vtable.
 * No existing call path dispatches through the HAL (see lume_board_hal.h).
 * The compile-time profile stays the source of truth.
 */
#include <stddef.h>
#include "lume_board_hal.h"

/* One canonical not-supported implementation. The four typed ops below are
 * its call-shape-specific faces; they all delegate here. Keeping a single
 * body avoids casting between incompatible function-pointer types. */
static int lume_board_not_supported(void)
{
    return LUME_BOARD_ERR_NOT_SUPPORTED;
}

static int lume_board_not_supported_panel_init(void **out_panel)
{
    (void)out_panel;
    return lume_board_not_supported();
}

static int lume_board_not_supported_touch_init(void *bus, void *panel)
{
    (void)bus;
    (void)panel;
    return lume_board_not_supported();
}

static int lume_board_not_supported_touch_read(int *out_x, int *out_y,
                                               int *out_pressed)
{
    (void)out_x;
    (void)out_y;
    (void)out_pressed;
    return lume_board_not_supported();
}

static int lume_board_not_supported_power_init(void *bus)
{
    (void)bus;
    return lume_board_not_supported();
}

static const lume_board_t s_lume_board_generic = {
    .panel_init = lume_board_not_supported_panel_init,
    .touch_init = lume_board_not_supported_touch_init,
    .touch_read = lume_board_not_supported_touch_read,
    .power_init = lume_board_not_supported_power_init,
    .board_id   = "generic",
};

/* Copy destination for lume_board_hal_register(). Static so the registered
 * vtable outlives a caller's stack frame and lume_board_get() stays stable. */
static lume_board_t s_lume_board_registered;
static const lume_board_t *s_lume_board_current = &s_lume_board_generic;

const lume_board_t *lume_board_get(void)
{
    return s_lume_board_current;
}

int lume_board_hal_register(const lume_board_t *board)
{
    if (board == NULL || board->panel_init == NULL || board->touch_init == NULL ||
        board->touch_read == NULL || board->power_init == NULL ||
        board->board_id == NULL || board->board_id[0] == '\0') {
        return LUME_BOARD_ERR_INVALID_ARG;
    }
    s_lume_board_registered = *board;
    s_lume_board_current = &s_lume_board_registered;
    return 0;
}
