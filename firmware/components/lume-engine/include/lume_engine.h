#pragma once
#include <stddef.h>
#include <stdint.h>

void lume_engine_start(void);

/* Engine event queue record (LVGL task -> engine task). Fixed size, copied.
 * node_id 0 is reserved (active screen); press events carry the clicked node. */
#define LUME_EVT_PRESS 1
typedef struct {
    uint8_t  type;        /* LUME_EVT_* */
    uint16_t node_id;
} lume_engine_evt_t;

/* Reverse-channel sink: called by the ui-bridge press callback (LVGL task)
 * to enqueue a CLICKED event into s_evt_queue. Pure queue op, no lv_* call. */
void lume_engine_post_press(uint16_t node_id);

/* r4 P2: called by the ui-bridge remove path (LVGL task) after a subtree was
 * deleted. Latches node_id into a lock-protected pending-removal bitmap; the
 * engine task polls and clears it, so a removal notice is NEVER lost (no
 * queue capacity to exhaust) and any node count is covered. Pure latch op,
 * no lv_* call. */
void lume_engine_mark_removed(uint16_t node_id);
