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
