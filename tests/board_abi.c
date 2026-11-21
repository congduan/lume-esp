/*
 * r147 host ABI harness for the lume-board-hal runtime stub.
 *
 * Build + run (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-board-hal/include \
 *     tests/board_abi.c -o /tmp/lume_board_abi && /tmp/lume_board_abi
 *
 * The header is freestanding (only <stdint.h>), so no ESP-IDF headers are
 * needed. These are compile-time layout assertions plus runtime checks of the
 * default singleton's "generic / all ops unsupported" contract. This is host
 * evidence only -- no hardware is touched and no on-device behaviour is
 * claimed.
 */
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "lume_board_hal.h"

/* --- 1. Function-pointer typedefs are host-word-sized ------------------- */
_Static_assert(sizeof(lume_board_panel_init_t) == sizeof(void *),
               "panel_init fn ptr is host-word sized");
_Static_assert(sizeof(lume_board_touch_init_t) == sizeof(void *),
               "touch_init fn ptr is host-word sized");
_Static_assert(sizeof(lume_board_touch_read_t) == sizeof(void *),
               "touch_read fn ptr is host-word sized");
_Static_assert(sizeof(lume_board_power_init_t) == sizeof(void *),
               "power_init fn ptr is host-word sized");

/* --- 2. Exactly four leading ops, then board_id, then end of struct ------ */
_Static_assert(offsetof(lume_board_t, panel_init) == 0,
               "panel_init is the first field");
_Static_assert(offsetof(lume_board_t, touch_init) ==
               offsetof(lume_board_t, panel_init) + sizeof(lume_board_panel_init_t),
               "touch_init is the second field");
_Static_assert(offsetof(lume_board_t, touch_read) ==
               offsetof(lume_board_t, touch_init) + sizeof(lume_board_touch_init_t),
               "touch_read is the third field");
_Static_assert(offsetof(lume_board_t, power_init) ==
               offsetof(lume_board_t, touch_read) + sizeof(lume_board_touch_read_t),
               "power_init is the fourth field");
_Static_assert(offsetof(lume_board_t, board_id) ==
               offsetof(lume_board_t, power_init) + sizeof(lume_board_power_init_t),
               "board_id follows the four ops");
_Static_assert(sizeof(lume_board_t) ==
               offsetof(lume_board_t, board_id) + sizeof(const char *),
               "no tail padding beyond board_id: five fields total");
_Static_assert(LUME_BOARD_ERR_NOT_SUPPORTED == -1,
               "unsupported op returns -1");

int main(void)
{
    const lume_board_t *b = lume_board_get();
    void *panel = NULL;
    int x = 0, y = 0, pressed = 0;

    if (b == NULL) {
        puts("FAIL lume_board_get returned NULL");
        return 1;
    }
    puts("PASS lume_board_get returns a non-NULL singleton");

    if (lume_board_get() != b) {
        puts("FAIL lume_board_get is not stable");
        return 1;
    }
    puts("PASS lume_board_get is a stable process-wide singleton");

    if (b->board_id == NULL || strcmp(b->board_id, "generic") != 0) {
        puts("FAIL board_id is not \"generic\"");
        return 1;
    }
    puts("PASS board_id == \"generic\"");

    if (b->panel_init == NULL || b->touch_init == NULL ||
        b->touch_read == NULL || b->power_init == NULL) {
        puts("FAIL at least one op pointer is NULL");
        return 1;
    }
    puts("PASS all four op pointers are populated");

    if (b->panel_init(&panel) != LUME_BOARD_ERR_NOT_SUPPORTED ||
        b->touch_init(NULL, NULL) != LUME_BOARD_ERR_NOT_SUPPORTED ||
        b->touch_read(&x, &y, &pressed) != LUME_BOARD_ERR_NOT_SUPPORTED ||
        b->power_init(NULL) != LUME_BOARD_ERR_NOT_SUPPORTED) {
        puts("FAIL a not_supported op did not return -1");
        return 1;
    }
    puts("PASS all four ops return -1 (not supported)");

    puts("PASS board_abi: 4-op layout + board_id + generic stub contract");
    return 0;
}
