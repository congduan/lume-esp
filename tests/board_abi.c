/*
 * r147 host ABI harness for the lume-board-hal runtime stub (extended r176).
 *
 * Build + run (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-board-hal/include \
 *     tests/board_abi.c -o /tmp/lume_board_abi && /tmp/lume_board_abi
 *
 * The header is freestanding (only <stdint.h>), so no ESP-IDF headers are
 * needed. These are compile-time layout assertions plus runtime checks of the
 * default singleton's "generic / all ops unsupported" contract, then the r176
 * registration/query semantics with a host-only fake vtable (this file never
 * links firmware). Host evidence only -- no hardware, no on-device behaviour.
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

/* --- Host-only fake vtable: registration/query semantics, no firmware ----- */
static int s_fake_panel;

static int fake_panel_init(void **out_panel)
{
    if (out_panel != NULL) *out_panel = &s_fake_panel;
    return 11;
}
static int fake_touch_init(void *bus, void *panel)
{
    (void)bus;
    (void)panel;
    return 22;
}
static int fake_touch_read(int *out_x, int *out_y, int *out_pressed)
{
    if (out_x != NULL) *out_x = 111;
    if (out_y != NULL) *out_y = 222;
    if (out_pressed != NULL) *out_pressed = 1;
    return 33;
}
static int fake_power_init(void *bus)
{
    (void)bus;
    return 44;
}

int main(void)
{
    const lume_board_t *b = lume_board_get();
    void *panel = NULL;
    int x = 0, y = 0, pressed = 0;

    /* --- 1. default (not yet registered) stub contract ------------------ */
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
    puts("PASS all four ops return -1 (not supported) before registration");

    /* --- 2. invalid registrations are rejected, current board unchanged -- */
    if (lume_board_hal_register(NULL) != LUME_BOARD_ERR_INVALID_ARG) {
        puts("FAIL NULL board was not rejected");
        return 1;
    }
    {
        lume_board_t bad = {
            .panel_init = fake_panel_init, .touch_init = fake_touch_init,
            .touch_read = NULL, .power_init = fake_power_init,
            .board_id = "bad"
        };
        if (lume_board_hal_register(&bad) != LUME_BOARD_ERR_INVALID_ARG) {
            puts("FAIL board with NULL op was not rejected");
            return 1;
        }
        bad.touch_read = fake_touch_read;
        bad.board_id = "";
        if (lume_board_hal_register(&bad) != LUME_BOARD_ERR_INVALID_ARG) {
            puts("FAIL board with empty board_id was not rejected");
            return 1;
        }
    }
    if (lume_board_get() != b || strcmp(b->board_id, "generic") != 0) {
        puts("FAIL rejected registration changed the current board");
        return 1;
    }
    puts("PASS invalid registrations rejected; generic stub still current");

    /* --- 3. valid registration + query + copy semantics ---------------- */
    {
        lume_board_t fake = {
            .panel_init = fake_panel_init, .touch_init = fake_touch_init,
            .touch_read = fake_touch_read, .power_init = fake_power_init,
            .board_id = "fake"
        };
        const lume_board_t *r;
        if (lume_board_hal_register(&fake) != 0) {
            puts("FAIL valid registration did not return 0");
            return 1;
        }
        r = lume_board_get();
        if (r == NULL || r == b) {
            puts("FAIL lume_board_get did not switch to the registered board");
            return 1;
        }
        if (r->panel_init != fake_panel_init || r->touch_init != fake_touch_init ||
            r->touch_read != fake_touch_read || r->power_init != fake_power_init) {
            puts("FAIL registered vtable ops do not match");
            return 1;
        }
        if (r->board_id == NULL || strcmp(r->board_id, "fake") != 0) {
            puts("FAIL registered board_id is empty or wrong");
            return 1;
        }
        puts("PASS registered board queryable: four non-NULL ops + board_id");

        /* Mutate caller storage: the registry must own a copy. */
        fake.panel_init = NULL;
        fake.board_id = "mutated";
        if (r->panel_init != fake_panel_init ||
            strcmp(r->board_id, "fake") != 0 || lume_board_get() != r) {
            puts("FAIL registration did not copy the caller struct");
            return 1;
        }
        puts("PASS registry copies the struct and stays stable");

        panel = NULL;
        x = y = pressed = 0;
        if (r->panel_init(&panel) != 11 || panel != &s_fake_panel ||
            r->touch_init(NULL, NULL) != 22 ||
            r->touch_read(&x, &y, &pressed) != 33 ||
            x != 111 || y != 222 || pressed != 1 ||
            r->power_init(NULL) != 44) {
            puts("FAIL a registered op did not dispatch to the fake");
            return 1;
        }
        puts("PASS registered ops dispatch to the host fake with correct args");
    }

    puts("PASS board_abi: 4-op layout + stub + registration/query semantics");
    return 0;
}
