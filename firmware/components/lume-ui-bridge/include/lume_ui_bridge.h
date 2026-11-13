#pragma once
#include <stdint.h>
#include <stddef.h>

/* ------------------------------------------------------------------------
 * lume-ui-bridge message protocol (M1).
 *
 * Cross-thread model (no mutex, copy semantics, LV_USE_OS == LV_OS_NONE):
 *
 *   engine task (JS)                 LVGL task (lv_timer_handler loop)
 *   -----------------                 ----------------------------------
 *   lume.* native binding
 *        | post(lume_ui_msg_t)
 *        v
 *   [ Queue A: engine -> LVGL ]  -->  drain timer -> apply() -> lv_obj
 *
 *   press_cb (LV_EVENT_CLICKED)
 *        | lume_press_sink_fn(node_id)
 *        v
 *   [ Queue B: LVGL -> engine ]  -->  engine task -> JS onPress callback
 *
 * Both queues are single-direction and carry fixed-size, fully-copied records.
 * All lv_* calls live on the LVGL task; the bridge post()/sink() helpers only
 * touch FreeRTOS queues and are safe to call from the engine / event context.
 * ------------------------------------------------------------------------ */

#define LUME_TEXT_MAX 64      /* inline text capacity, includes trailing NUL */
#define LUME_MAX_NODES 128    /* node table slots; node_id 0 == active screen */

/* Declarative UI node kinds (M1: VIEW, TEXT, BUTTON). */
typedef enum {
    LUME_NODE_VIEW = 0,
    LUME_NODE_TEXT,
    LUME_NODE_BUTTON,
} lume_node_kind_t;

/* set-attr attribute ids. PARENT is the "append child" primitive: View()
 * adopts eagerly-created children by setting their parent node id. */
typedef enum {
    LUME_ATTR_TEXT = 0,      /* msg.text  (string) */
    LUME_ATTR_BG_COLOR,      /* msg.value (0xRRGGBB) */
    LUME_ATTR_WIDTH,         /* msg.value */
    LUME_ATTR_HEIGHT,        /* msg.value */
    LUME_ATTR_ALIGN,         /* msg.value (lume_align_t) */
    LUME_ATTR_VISIBLE,       /* msg.value (0/1) */
    LUME_ATTR_PARENT,        /* msg.value (parent node_id) */
} lume_attr_t;

typedef enum {
    LUME_ALIGN_CENTER = 0,
    LUME_ALIGN_TOP_LEFT,
    LUME_ALIGN_TOP_MID,
    LUME_ALIGN_TOP_RIGHT,
    LUME_ALIGN_BOTTOM_MID,
    LUME_ALIGN_BOTTOM_LEFT,
    LUME_ALIGN_BOTTOM_RIGHT,
    LUME_ALIGN_LEFT_MID,
    LUME_ALIGN_RIGHT_MID,
} lume_align_t;

/* Queue A operation codes. */
typedef enum {
    LUME_OP_CREATE = 0,      /* kind + parent_id -> node at node_id (pre-allocated by engine) */
    LUME_OP_SET_ATTR,        /* attr + value / text on node_id */
    LUME_OP_REMOVE,          /* delete node_id (and its LVGL subtree) */
    LUME_OP_SET_PRESS,       /* register CLICKED callback on node_id */
} lume_op_t;

/* Fixed-size UI message. Text is inlined (char[64]); the native binding
 * rejects strings >= LUME_TEXT_MAX so this buffer is always NUL-terminated.
 * The receiver additionally hard-terminates text[63] as a defensive truncate. */
typedef struct {
    uint8_t  op;                       /* lume_op_t */
    uint8_t  kind;                     /* lume_node_kind_t (CREATE) */
    uint16_t node_id;                  /* target / new node id */
    uint16_t parent_id;                /* CREATE parent (0 = active screen) */
    uint8_t  attr;                     /* lume_attr_t (SET_ATTR) */
    int32_t  value;                    /* numeric attr value */
    char     text[LUME_TEXT_MAX];      /* inline, NUL-terminated string */
} lume_ui_msg_t;

/* How the bridge hands a CLICKED event back to the engine task. Registered by
 * the engine at startup; keeps lume-ui-bridge free of any lume-engine link. */
typedef void (*lume_press_sink_fn)(uint16_t node_id);
void lume_ui_bridge_set_press_sink(lume_press_sink_fn fn);

/* Init: creates Queue A + the LVGL drain timer. Must be called once from board
 * init (main task) BEFORE the LVGL task starts, so lv_timer_create() has no
 * concurrent lv_timer_handler() to race with (LV_USE_OS == LV_OS_NONE).
 * Aborts (fail-fast) if the queue or timer cannot be allocated at boot. */
void lume_ui_bridge_init(void);

/* Engine-task side: enqueue one UI op. Never calls lv_*. Returns 0 on success.
 * On a full Queue A it retries a bounded number of times (briefly blocking so
 * the LVGL drain timer can free a slot); if all attempts fail it logs ESP_LOGE
 * (JS/UI state may diverge) and returns -1. M1 has no rollback/resync. */
int lume_ui_bridge_post(const lume_ui_msg_t *msg);

/* LVGL-task side: drain Queue A and apply each message to lv_obj. Invoked by
 * the bridge's lv_timer, i.e. from inside the lv_timer_handler() loop. */
void lume_ui_bridge_drain(void);
