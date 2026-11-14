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
    LUME_NODE_CANVAS,
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
    LUME_ATTR_FLEX_FLOW, LUME_ATTR_FLEX_MAIN_ALIGN, LUME_ATTR_FLEX_CROSS_ALIGN,
    LUME_ATTR_PADDING, LUME_ATTR_GAP, LUME_ATTR_RADIUS,
    LUME_ATTR_BORDER_WIDTH, LUME_ATTR_BORDER_COLOR, LUME_ATTR_OPACITY,
    LUME_ATTR_WIDTH_PCT, LUME_ATTR_HEIGHT_PCT,
    LUME_ATTR_X, LUME_ATTR_Y,
} lume_attr_t;

/* Wire values are independent of LVGL's enum ordering. */
typedef enum { LUME_FLEX_ROW = 0, LUME_FLEX_COLUMN,
               LUME_FLEX_ROW_WRAP, LUME_FLEX_COLUMN_WRAP } lume_flex_flow_t;
typedef enum { LUME_FLEX_START = 0, LUME_FLEX_END, LUME_FLEX_CENTER,
               LUME_FLEX_SPACE_BETWEEN, LUME_FLEX_SPACE_AROUND,
               LUME_FLEX_SPACE_EVENLY } lume_flex_align_t;
/* Cross-axis wire value 3 means stretch; main-axis value 3 means space-between. */
#define LUME_FLEX_CROSS_STRETCH 3

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
    LUME_OP_ANIMATE,        /* numeric attr, optional from, to, duration, easing, token */
    LUME_OP_ANIMATE_CANCEL, /* stop one node/attr animation */
    LUME_OP_CANVAS_DRAW,
    LUME_OP_CANVAS_INVALIDATE,
    LUME_OP_RESET,             /* release all app nodes/canvases on LVGL task */
} lume_op_t;

typedef enum { LUME_DRAW_CLEAR = 0, LUME_DRAW_RECT, LUME_DRAW_LINE,
               LUME_DRAW_CIRCLE, LUME_DRAW_TEXT } lume_draw_t;

typedef enum { LUME_EASE_LINEAR = 0, LUME_EASE_IN, LUME_EASE_OUT,
               LUME_EASE_IN_OUT } lume_easing_t;

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
    /* Animation extension: entire sizeof(lume_ui_msg_t) is copied by Queue A;
     * this protocol is 96 bytes on ESP32 (76-byte base + 20-byte extension). */
    int32_t  from, to;                 /* from ignored when has_from == 0 */
    uint32_t duration_ms, token;       /* token 0 means no completion event */
    uint8_t  easing, has_from;
    /* Canvas draw: attr=opcode, value=color, from/to=x/y,
     * duration_ms/token=w/h or x2/y2, draw_width=stroke/size. */
    uint16_t draw_width;
} lume_ui_msg_t;

/* How the bridge hands a CLICKED event back to the engine task. Registered by
 * the engine at startup; keeps lume-ui-bridge free of any lume-engine link. */
typedef void (*lume_press_sink_fn)(uint16_t node_id);
typedef void (*lume_anim_sink_fn)(uint32_t token);
void lume_ui_bridge_set_anim_sink(lume_anim_sink_fn fn);
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
