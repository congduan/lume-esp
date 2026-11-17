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
 * Both queues are single-direction and carry fixed-size copied records. Queue
 * A may also own a separate PSRAM text or image payload referenced by a record.
 * All lv_* calls live on the LVGL task; the bridge post()/sink() helpers only
 * touch FreeRTOS queues and are safe to call from the engine / event context.
 * ------------------------------------------------------------------------ */

#define LUME_TEXT_MAX 64      /* inline text capacity, includes trailing NUL */
#define LUME_TEXT_LIMIT 256   /* maximum UTF-8 text bytes, excluding NUL */
#define LUME_MAX_NODES 128    /* node table slots; node_id 0 == active screen */

/* Declarative UI node kinds (M1: VIEW, TEXT, BUTTON). */
typedef enum {
    LUME_NODE_VIEW = 0,
    LUME_NODE_TEXT,
    LUME_NODE_BUTTON,
    LUME_NODE_CANVAS,
    LUME_NODE_IMAGE,
    LUME_NODE_ARC,       /* LVGL arc: anti-aliased ring gauge */
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
    LUME_ATTR_SCROLL_DIR, LUME_ATTR_SCROLLBAR_MODE,
    LUME_ATTR_SCROLL_Y,       /* programmatic offset, non-animated */
    LUME_ATTR_IGNORE_LAYOUT,  /* absolute-positioned virtual rows */
    /* LUME_NODE_ARC only (all msg.value): */
    LUME_ATTR_ARC_VALUE,      /* 0..100 percent of the start->end sweep */
    LUME_ATTR_ARC_START,      /* start angle in degrees (LVGL 0..360, cw) */
    LUME_ATTR_ARC_END,        /* end angle in degrees */
    LUME_ATTR_ARC_THICKNESS,  /* ring stroke width in px */
    LUME_ATTR_ARC_TRACK,      /* track (background ring) colour 0xRRGGBB */
    LUME_ATTR_ARC_COLOR,      /* value ring colour 0xRRGGBB (never touches bg) */
    /* Layout extensions (all msg.value):
     * per-side padding/margin, LVGL flex grow, and align-relative-to-node.
     * PADDING/MARGIN set all four sides; the per-side ids override one edge
     * and are always sent after the box shorthand. */
    LUME_ATTR_PAD_TOP, LUME_ATTR_PAD_RIGHT, LUME_ATTR_PAD_BOTTOM, LUME_ATTR_PAD_LEFT,
    LUME_ATTR_MARGIN,
    LUME_ATTR_MARGIN_TOP, LUME_ATTR_MARGIN_RIGHT, LUME_ATTR_MARGIN_BOTTOM, LUME_ATTR_MARGIN_LEFT,
    LUME_ATTR_FLEX_GROW,      /* 0..255 grow factor, LVGL lv_obj_set_flex_grow */
    LUME_ATTR_ALIGN_TARGET,   /* base node_id for ALIGN; 0 = parent (default) */
    LUME_ATTR_ALIGN_OFS_X,    /* signed px offset applied by the next ALIGN */
    LUME_ATTR_ALIGN_OFS_Y,
    /* Content sizing, out-of-flow placement, translate and text layout. */
    LUME_ATTR_WIDTH_AUTO,     /* width = LV_SIZE_CONTENT (value unused) */
    LUME_ATTR_HEIGHT_AUTO,    /* height = LV_SIZE_CONTENT */
    LUME_ATTR_MIN_WIDTH, LUME_ATTR_MAX_WIDTH,
    LUME_ATTR_MIN_HEIGHT, LUME_ATTR_MAX_HEIGHT,
    LUME_ATTR_TRANSLATE_X, LUME_ATTR_TRANSLATE_X_PCT,
    LUME_ATTR_TRANSLATE_Y, LUME_ATTR_TRANSLATE_Y_PCT,
    LUME_ATTR_TEXT_ALIGN,     /* msg.value (lume_text_align_t) */
    LUME_ATTR_TEXT_LONG_MODE, /* msg.value (lume_text_long_t) */
    /* r35 typography (all msg.value). TEXT_FONT carries a px size; the bridge
     * snaps it to the nearest bundled montserrat face (14/20/32). CJK glyphs
     * fall through each face's .fallback to lume_font_sc_16. */
    LUME_ATTR_TEXT_FONT,      /* msg.value: px size, snapped to nearest face */
    LUME_ATTR_LETTER_SPACE,   /* msg.value: px, may be negative */
    LUME_ATTR_LINE_SPACE,     /* msg.value: px, may be negative */
} lume_attr_t;

/* ALIGN_TARGET value meaning "align inside the parent" (lv_obj_align). Any
 * other value is a node id aligned against (lv_obj_align_to). */
#define LUME_ALIGN_TARGET_PARENT 0

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
    /* Outside alignments (>= LUME_ALIGN_OUT_FIRST) place the node NEXT TO the
     * base instead of inside it, so they need lv_obj_align_to() with a base
     * object and are never valid for a plain parent alignment. */
    LUME_ALIGN_OUT_TOP_LEFT,
    LUME_ALIGN_OUT_TOP_MID,
    LUME_ALIGN_OUT_TOP_RIGHT,
    LUME_ALIGN_OUT_BOTTOM_LEFT,
    LUME_ALIGN_OUT_BOTTOM_MID,
    LUME_ALIGN_OUT_BOTTOM_RIGHT,
    LUME_ALIGN_OUT_LEFT_TOP,
    LUME_ALIGN_OUT_LEFT_MID,
    LUME_ALIGN_OUT_LEFT_BOTTOM,
    LUME_ALIGN_OUT_RIGHT_TOP,
    LUME_ALIGN_OUT_RIGHT_MID,
    LUME_ALIGN_OUT_RIGHT_BOTTOM,
} lume_align_t;

#define LUME_ALIGN_OUT_FIRST LUME_ALIGN_OUT_TOP_LEFT

/* TEXT_ALIGN / TEXT_LONG_MODE wire values (independent of LVGL's ordering). */
typedef enum { LUME_TEXT_ALIGN_LEFT = 0, LUME_TEXT_ALIGN_CENTER,
               LUME_TEXT_ALIGN_RIGHT, LUME_TEXT_ALIGN_AUTO } lume_text_align_t;
typedef enum { LUME_TEXT_LONG_WRAP = 0, LUME_TEXT_LONG_DOTS,
               LUME_TEXT_LONG_SCROLL, LUME_TEXT_LONG_SCROLL_CIRCULAR,
               LUME_TEXT_LONG_CLIP } lume_text_long_t;

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
    LUME_OP_SET_GESTURE,       /* r21: register LVGL pointer-event callbacks on node_id */
    LUME_OP_IMAGE_SOURCE,      /* owned PSRAM RGB565/RGB565A8 payload */
    LUME_OP_CANVAS_BATCH,      /* owned bounded array of line segments */
    LUME_OP_CANVAS_PATH_DEFINE,/* retained segment array (attr = path id) */
    LUME_OP_CANVAS_PATH_DRAW,  /* replay a retained path (attr = id, from/to = dx/dy) */
    /* r46 Task A/C: engine posts this AFTER an app's initial UI messages.
     * FIFO Queue A ordering guarantees it is drained only once the whole
     * first frame has been applied. token = engine esp_timer us at app-eval
     * -done (first-frame latency measurement); also the transition reveal
     * trigger (Task C). Appended at the tail: existing IDs are unchanged. */
    LUME_OP_FIRSTFRAME,
    /* r46 Task C: engine posts this when a switch is accepted. The LVGL task
     * creates a top-layer black overlay and fades it in (lv_anim); when the
     * fade completes it posts a COVERED event back through the existing
     * reverse sink/queue, and the engine then starts teardown/RESET. */
    LUME_OP_TRANSITION_COVER,
    LUME_OP_RAYCAST_RENDER, /* image_pixels: owned frame descriptor; map borrowed */
    LUME_OP_RAYCAST_BARRIER, /* image_pixels: engine-owned semaphore, signal after queued renders */
    /* r81 canvas sprites: DEFINE owns a PSRAM RGB565 payload (attr = slot,
     * image_w/h = dims); DRAW replays it (attr = slot, from/to = dx/dy,
     * token = flip flag). Appended at the tail so existing IDs are unchanged. */
    LUME_OP_CANVAS_SPRITE_DEFINE,
    LUME_OP_CANVAS_SPRITE_DRAW,
} lume_op_t;

#define LUME_CANVAS_BATCH_MAX 32
typedef struct { int16_t x1, y1, x2, y2; uint32_t color; uint8_t width; uint8_t reserved[3]; } lume_canvas_line_t;

/* Retained canvas paths (r45): one define per static picture, replayed per
 * frame from C, so a full-canvas app stops rebuilding geometry in JS. A path
 * id is canvas-local and chosen by the JS side (1..LUME_CANVAS_PATHS-1). */
#define LUME_CANVAS_PATHS 8             /* retained paths per canvas */
#define LUME_CANVAS_PATH_SEG_MAX 240    /* segments in one path (= polyline cap - 1) */
#define LUME_CANVAS_PATH_BUDGET (32u * 1024u)   /* PSRAM cap for all retained paths */

/* r81 retained sprites: same 8-slot / bounded-budget discipline as paths.
 * Budget = one full-screen RGBA5551 copy (480*480*2 B); typical game sprites
 * are a few KB each. 0 is reserved by the JS API (slot ids are 1-based). */
#define LUME_CANVAS_SPRITES 8                       /* retained sprites per canvas */
#define LUME_CANVAS_SPRITE_BUDGET (480u * 480u * 2u) /* PSRAM cap for all sprites */

typedef enum { LUME_DRAW_CLEAR = 0, LUME_DRAW_RECT, LUME_DRAW_LINE,
               LUME_DRAW_CIRCLE, LUME_DRAW_TEXT,
               /* r48: native AA annulus arc, appended at the tail so existing
                * draw opcodes keep their wire values. ARC reuses the fixed
                * 128 B message's spare fields (image_w = radius,
                * duration_ms/token = from/to degrees); no struct change. */
               LUME_DRAW_ARC, LUME_DRAW_FILL_CIRCLE,
               LUME_DRAW_FILL_ELLIPSE, LUME_DRAW_ELLIPSE } lume_draw_t;

typedef enum { LUME_EASE_LINEAR = 0, LUME_EASE_IN, LUME_EASE_OUT,
               LUME_EASE_IN_OUT } lume_easing_t;

/* Fixed-size UI message. Short text is inline; longer text has a PSRAM
 * allocation whose ownership passes to Queue A on successful post. The LVGL
 * drain always frees text_heap after applying or dropping the record. */
typedef struct {
    uint8_t  op;                       /* lume_op_t */
    uint8_t  kind;                     /* lume_node_kind_t (CREATE) */
    uint16_t node_id;                  /* target / new node id */
    uint16_t parent_id;                /* CREATE parent (0 = active screen) */
    uint8_t  attr;                     /* lume_attr_t (SET_ATTR) */
    int32_t  value;                    /* numeric attr value */
    char     text[LUME_TEXT_MAX];      /* inline, NUL-terminated string */
    uint16_t text_len;                 /* UTF-8 byte count, <= LUME_TEXT_LIMIT */
    char    *text_heap;                /* optional owned NUL-terminated payload */
    /* Animation extension: entire sizeof(lume_ui_msg_t) is copied by Queue A;
 * this protocol was 96 bytes before the image-source pointer extension. */
    int32_t  from, to;                 /* from ignored when has_from == 0 */
    uint32_t duration_ms, token;       /* token 0 means no completion event */
    uint8_t  easing, has_from;
    /* Canvas draw: attr=opcode, value=color, from/to=x/y,
     * duration_ms/token=w/h or x2/y2, draw_width=stroke/size. */
    uint16_t draw_width;
    void *image_pixels;                  /* IMAGE_SOURCE or CANVAS_BATCH owned payload */
    uint16_t image_w, image_h;          /* BATCH: image_w is segment count */
    uint8_t image_alpha;
} lume_ui_msg_t;

/* How the bridge hands a CLICKED event back to the engine task. Registered by
 * the engine at startup; keeps lume-ui-bridge free of any lume-engine link. */
typedef void (*lume_press_sink_fn)(uint16_t node_id);
typedef void (*lume_anim_sink_fn)(uint32_t token);
typedef void (*lume_scroll_sink_fn)(uint16_t node_id, int32_t y);
/* r21: normalized LVGL pointer stream -> engine task (Queue B).
 * kind 0=DOWN 1=MOVE 2=UP 3=SWIPEDIR; x/y absolute px; t=lv_tick_get ms;
 * dir=LVGL lv_dir bitmask (SWIPEDIR only); cancelled=1 when a scroll won. */
typedef void (*lume_gesture_sink_fn)(uint16_t node_id, uint8_t kind,
                                    int16_t x, int16_t y, uint32_t t,
                                    uint8_t dir, uint8_t cancelled);
/* r46 Task C: LVGL task -> engine task "screen is covered, safe to teardown"
 * handshake. Pure queue op into Queue B, no new lock. */
typedef void (*lume_transition_sink_fn)(void);
void lume_ui_bridge_set_transition_sink(lume_transition_sink_fn fn);
void lume_ui_bridge_set_anim_sink(lume_anim_sink_fn fn);
void lume_ui_bridge_set_press_sink(lume_press_sink_fn fn);
void lume_ui_bridge_set_scroll_sink(lume_scroll_sink_fn fn);
void lume_ui_bridge_set_gesture_sink(lume_gesture_sink_fn fn);

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
