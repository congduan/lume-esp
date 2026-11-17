/**
 * Declarative UI -> LVGL bridge (M1 real implementation).
 *
 * Thread discipline: every lv_* call in this file runs on the LVGL task, via
 * the drain timer created in lume_ui_bridge_init() (processed by the board's
 * lv_timer_handler loop). The only cross-thread entry points are post() and
 * the press sink, both of which are pure FreeRTOS queue operations.
 *
 * The node table (id -> lv_obj*) and the kinds[] table are written and read
 * ONLY by the LVGL task, so no mutex is needed. node_ids are allocated by the
 * engine task (a monotonic counter) and carried in each message; FIFO queue
 * ordering guarantees a CREATE is applied before any SET_ATTR for that id.
 */
#include <stdlib.h>          /* abort(): boot-stage fail-fast on OOM */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lvgl.h"
#include "lume_ui_bridge.h"
#include "lume_engine.h"     /* r4 P2: lume_engine_notify_removed() */
#include "lume_pins.h"       /* r27: display geometry from the board profile */
#include "lume_perf.h"
#include "lume_raster.h"     /* r47: anti-aliased canvas stroke rasteriser  */
#include "lume_raycast.h"
#include "esp_timer.h"

_Static_assert(sizeof(lume_ui_msg_t) <= 128, "UI queue record size budget");

static const char *TAG = "lume-ui-bridge";
/* Queue A depth. Every canvasDraw() is one record, and a Canvas gauge redraw
 * (arc polylines included) emits 30..90 records back-to-back from the JS task,
 * so 32 slots was not enough for a dashboard app: the queue filled mid-redraw,
 * post() returned -1 and JS threw "ui queue full" halfway through a refresh.
 * 384 slots x <=128 B = <=48 KB of queue memory, drained every 5 ms.
 * Long text lives in a separate PSRAM payload, keeping queue records bounded. */
#define UI_QUEUE_LEN 384
#define DRAIN_PERIOD_MS 5
#define LUME_POST_MAX_ATTEMPTS 8   /* finite retries when Queue A is full */

static QueueHandle_t s_ui_queue;                  /* Queue A */
static lv_obj_t *s_nodes[LUME_MAX_NODES];         /* id -> lv_obj* (LVGL task) */
static uint8_t s_kinds[LUME_MAX_NODES];           /* id -> kind   (LVGL task) */
static bool s_failed_nodes[LUME_MAX_NODES];       /* suppress queued ops after failed CREATE */
static uint8_t s_flow[LUME_MAX_NODES];            /* wire flow, for stretch axis */
static uint8_t s_main[LUME_MAX_NODES], s_cross[LUME_MAX_NODES];
static uint8_t s_explicit_width[LUME_MAX_NODES], s_explicit_height[LUME_MAX_NODES];
/* Align state: LVGL applies alignment last, so the base node and the offsets
 * must survive until ALIGN arrives (and both are re-applied together). */
static uint8_t s_align[LUME_MAX_NODES];            /* wire lume_align_t */
static uint8_t s_align_target[LUME_MAX_NODES];     /* 0 = parent, else node_id */
static int16_t s_align_ofs_x[LUME_MAX_NODES], s_align_ofs_y[LUME_MAX_NODES];
static uint16_t *s_canvas_pixels[LUME_MAX_NODES];   /* front: what lv_canvas displays */
static uint16_t *s_canvas_work[LUME_MAX_NODES];     /* work: raster target (== front if the 2nd alloc failed) */
static uint8_t *s_image_pixels[LUME_MAX_NODES];
static lv_image_dsc_t s_image_dsc[LUME_MAX_NODES];
static uint16_t s_canvas_w[LUME_MAX_NODES], s_canvas_h[LUME_MAX_NODES];
static uint16_t s_canvas_stride[LUME_MAX_NODES]; /* RGB565 pixels per row */
static int16_t s_arc_start[LUME_MAX_NODES], s_arc_end[LUME_MAX_NODES]; /* LUME_NODE_ARC sweep */
static size_t s_canvas_bytes;
/* Retained canvas paths (see LUME_OP_CANVAS_PATH_DEFINE): slot [id-1] holds the
 * bridge-owned segment array, so a static picture is uploaded once and replayed
 * from C on every frame instead of being rebuilt in JS. */
static lume_canvas_line_t *s_path_lines[LUME_MAX_NODES][LUME_CANVAS_PATHS];
static uint16_t s_path_count[LUME_MAX_NODES][LUME_CANVAS_PATHS];
static size_t s_path_bytes;
/* r27: canvas budget is one full framebuffer; geometry comes from the board
 * profile instead of a hardcoded frame size. Every canvas is double buffered
 * (front + work), so the budget counts two full framebuffer images. */
#define CANVAS_BUDGET ((size_t)LUME_LCD_H_RES * LUME_LCD_V_RES * (LUME_LCD_BPP / 8u) * 2u)
static void clear_subtree(lv_obj_t *obj);
static void release_dead_canvases(void);
static void release_dead_images(void)
{
    for (uint16_t id = 1; id < LUME_MAX_NODES; id++) {
        if (s_image_pixels[id] && !s_nodes[id]) {
            lv_image_cache_drop(&s_image_dsc[id]);
            heap_caps_free(s_image_pixels[id]);
            s_image_pixels[id] = NULL;
            memset(&s_image_dsc[id], 0, sizeof(s_image_dsc[id]));
        }
    }
}
static lume_anim_sink_fn s_anim_sink;
static lume_press_sink_fn s_press_sink;           /* set once by engine task */
static bool s_screen_gesture;                     /* prelude registered node 0 */
static bool s_gedge_armed;                        /* press started in the bottom edge zone */
/* A swipe only counts as "go home" when the press STARTS inside this strip at
 * the bottom edge (Brookesia-style). Anywhere else it belongs to the app: its
 * own gestures, scrolling, or nothing. */
#define G_EDGE_ZONE_PX 60
static lume_scroll_sink_fn s_scroll_sink;
static lume_gesture_sink_fn s_gesture_sink;       /* r21: set once by engine task */
/* Per-node gesture press flags (LVGL task only). bit0 = a press is active,
 * bit1 = a List scroll has already won this press (suppress gesture events). */
#define GESTURE_ACTIVE   0x01
#define GESTURE_SCROLLED 0x02
static uint8_t s_gesture_flags[LUME_MAX_NODES];
static int32_t s_scroll_last_y[LUME_MAX_NODES];
static uint32_t s_scroll_last_tick[LUME_MAX_NODES];
static uint8_t s_scroll_sent[LUME_MAX_NODES];

static void scroll_cb(lv_event_t *e)
{
    uint16_t id = (uint16_t)(uintptr_t)lv_event_get_user_data(e);
    if (!s_scroll_sink || id == 0 || id >= LUME_MAX_NODES) return;
    int32_t y = lv_obj_get_scroll_y(lv_event_get_target_obj(e));
    uint32_t now = lv_tick_get();
    int32_t delta = y - s_scroll_last_y[id];
    if (s_scroll_sent[id] && lv_event_get_code(e) != LV_EVENT_SCROLL_END &&
        (uint32_t)(now - s_scroll_last_tick[id]) < 25) return;
    if (s_scroll_sent[id] && lv_event_get_code(e) != LV_EVENT_SCROLL_END &&
        delta > -12 && delta < 12 &&
        (uint32_t)(now - s_scroll_last_tick[id]) < 40) return;
    s_scroll_last_y[id] = y;
    s_scroll_last_tick[id] = now;
    s_scroll_sent[id] = 1;
    s_scroll_sink(id, y);
}

static lv_align_t map_align(int32_t v)
{
    switch (v) {
        case LUME_ALIGN_TOP_LEFT:     return LV_ALIGN_TOP_LEFT;
        case LUME_ALIGN_TOP_MID:      return LV_ALIGN_TOP_MID;
        case LUME_ALIGN_TOP_RIGHT:    return LV_ALIGN_TOP_RIGHT;
        case LUME_ALIGN_BOTTOM_MID:   return LV_ALIGN_BOTTOM_MID;
        case LUME_ALIGN_BOTTOM_LEFT:  return LV_ALIGN_BOTTOM_LEFT;
        case LUME_ALIGN_BOTTOM_RIGHT: return LV_ALIGN_BOTTOM_RIGHT;
        case LUME_ALIGN_LEFT_MID:     return LV_ALIGN_LEFT_MID;
        case LUME_ALIGN_RIGHT_MID:    return LV_ALIGN_RIGHT_MID;
        case LUME_ALIGN_CENTER:
        default:                      return LV_ALIGN_CENTER;
    }
}

static lv_align_t map_align_out(int32_t v)
{
    switch (v) {
        case LUME_ALIGN_OUT_TOP_LEFT:      return LV_ALIGN_OUT_TOP_LEFT;
        case LUME_ALIGN_OUT_TOP_MID:       return LV_ALIGN_OUT_TOP_MID;
        case LUME_ALIGN_OUT_TOP_RIGHT:     return LV_ALIGN_OUT_TOP_RIGHT;
        case LUME_ALIGN_OUT_BOTTOM_LEFT:   return LV_ALIGN_OUT_BOTTOM_LEFT;
        case LUME_ALIGN_OUT_BOTTOM_MID:    return LV_ALIGN_OUT_BOTTOM_MID;
        case LUME_ALIGN_OUT_BOTTOM_RIGHT:  return LV_ALIGN_OUT_BOTTOM_RIGHT;
        case LUME_ALIGN_OUT_LEFT_TOP:      return LV_ALIGN_OUT_LEFT_TOP;
        case LUME_ALIGN_OUT_LEFT_MID:      return LV_ALIGN_OUT_LEFT_MID;
        case LUME_ALIGN_OUT_LEFT_BOTTOM:   return LV_ALIGN_OUT_LEFT_BOTTOM;
        case LUME_ALIGN_OUT_RIGHT_TOP:     return LV_ALIGN_OUT_RIGHT_TOP;
        case LUME_ALIGN_OUT_RIGHT_MID:     return LV_ALIGN_OUT_RIGHT_MID;
        case LUME_ALIGN_OUT_RIGHT_BOTTOM:  return LV_ALIGN_OUT_RIGHT_BOTTOM;
        default:                           return LV_ALIGN_OUT_BOTTOM_MID;
    }
}

static lv_obj_t *get_node(uint16_t id)
{
    if (id == 0 || id >= LUME_MAX_NODES) {
        return NULL;
    }
    return s_nodes[id];
}

static lv_text_align_t map_text_align(int32_t v)
{
    switch (v) {
        case LUME_TEXT_ALIGN_CENTER: return LV_TEXT_ALIGN_CENTER;
        case LUME_TEXT_ALIGN_RIGHT:  return LV_TEXT_ALIGN_RIGHT;
        case LUME_TEXT_ALIGN_AUTO:   return LV_TEXT_ALIGN_AUTO;
        default:                     return LV_TEXT_ALIGN_LEFT;
    }
}

static lv_label_long_mode_t map_long_mode(int32_t v)
{
    switch (v) {
        case LUME_TEXT_LONG_DOTS:            return LV_LABEL_LONG_MODE_DOTS;
        case LUME_TEXT_LONG_SCROLL:          return LV_LABEL_LONG_MODE_SCROLL;
        case LUME_TEXT_LONG_SCROLL_CIRCULAR: return LV_LABEL_LONG_MODE_SCROLL_CIRCULAR;
        case LUME_TEXT_LONG_CLIP:            return LV_LABEL_LONG_MODE_CLIP;
        default:                             return LV_LABEL_LONG_MODE_WRAP;
    }
}

/* Text attributes live on the label: a TEXT node is its own label, a BUTTON
 * keeps its caption in child 0. */
static lv_obj_t *text_target(uint16_t id, lv_obj_t *obj)
{
    if (s_kinds[id] == LUME_NODE_BUTTON) {
        lv_obj_t *label = lv_obj_get_child(obj, 0);
        if (label != NULL) {
            return label;
        }
    }
    return obj;
}

/* lv_obj_align() positions inside the parent; lv_obj_align_to() positions
 * against a sibling/other node. target 0 (or a node that no longer exists)
 * falls back to the parent, which keeps a removed base node from parking the
 * child at a stale position. Outside alignments (LUME_ALIGN_OUT_*) can only be
 * expressed with align_to, so they fall back to the real parent pointer. */
static void apply_align(lv_obj_t *obj, uint16_t id)
{
    int32_t wire = s_align[id];
    int32_t x = s_align_ofs_x[id], y = s_align_ofs_y[id];
    if (wire >= LUME_ALIGN_OUT_FIRST) {
        lv_obj_t *base = get_node(s_align_target[id]);
        if (base == NULL || base == obj) {
            base = lv_obj_get_parent(obj);
        }
        if (base == NULL) {
            lv_obj_align(obj, LV_ALIGN_CENTER, x, y);
            return;
        }
        lv_obj_align_to(obj, base, map_align_out(wire), x, y);
        return;
    }
    lv_align_t align = map_align(wire);
    lv_obj_t *base = get_node(s_align_target[id]);
    if (base == NULL || base == obj) {
        lv_obj_align(obj, align, x, y);
        return;
    }
    lv_obj_align_to(obj, base, align, x, y);
}

static lv_flex_flow_t map_flow(int32_t v)
{
    switch (v) {
        case LUME_FLEX_COLUMN: return LV_FLEX_FLOW_COLUMN;
        case LUME_FLEX_ROW_WRAP: return LV_FLEX_FLOW_ROW_WRAP;
        case LUME_FLEX_COLUMN_WRAP: return LV_FLEX_FLOW_COLUMN_WRAP;
        default: return LV_FLEX_FLOW_ROW;
    }
}

static lv_flex_align_t map_flex_align(int32_t v)
{
    switch (v) {
        case LUME_FLEX_END: return LV_FLEX_ALIGN_END;
        case LUME_FLEX_CENTER: return LV_FLEX_ALIGN_CENTER;
        case LUME_FLEX_SPACE_BETWEEN: return LV_FLEX_ALIGN_SPACE_BETWEEN;
        case LUME_FLEX_SPACE_AROUND: return LV_FLEX_ALIGN_SPACE_AROUND;
        case LUME_FLEX_SPACE_EVENLY: return LV_FLEX_ALIGN_SPACE_EVENLY;
        default: return LV_FLEX_ALIGN_START;
    }
}

/* LVGL has no cross-axis STRETCH enum. Size children on the cross axis,
 * preserving a child's explicit width/height. */
static void apply_stretch_child(lv_obj_t *child, uint16_t parent_id)
{
    if (s_cross[parent_id] != LUME_FLEX_CROSS_STRETCH) return;
    uint16_t id = (uint16_t)(uintptr_t)lv_obj_get_user_data(child);
    if (id == 0 || id >= LUME_MAX_NODES) return;
    bool column = s_flow[parent_id] == LUME_FLEX_COLUMN ||
                  s_flow[parent_id] == LUME_FLEX_COLUMN_WRAP;
    if (column && !s_explicit_width[id]) lv_obj_set_width(child, lv_pct(100));
    if (!column && !s_explicit_height[id]) lv_obj_set_height(child, lv_pct(100));
}

static void apply_flex_align(lv_obj_t *obj, uint16_t id)
{
    /* track_place must follow the cross alignment, not stay START: a single
     * flex track (e.g. one text line inside a 56x56 icon tile) is placed at
     * the container top otherwise, so a cross-centred child still renders in
     * the upper third -- the "letter not vertically centred" symptom. */
    lv_flex_align_t cross = s_cross[id] == LUME_FLEX_CROSS_STRETCH ? LV_FLEX_ALIGN_START :
                            map_flex_align(s_cross[id]);
    lv_obj_set_flex_align(obj, map_flex_align(s_main[id]), cross, cross);
    uint32_t n = lv_obj_get_child_count(obj);
    for (uint32_t i = 0; i < n; i++) apply_stretch_child(lv_obj_get_child(obj, i), id);
}

/* One stable slot per node/attribute gives lv_anim a unique var identity.
 * Slots are touched only by the LVGL task; no per-frame engine work. */
#define ANIM_ATTRS 5
static uint8_t s_anim_slots[LUME_MAX_NODES][ANIM_ATTRS];
static uint32_t s_anim_tokens[LUME_MAX_NODES][ANIM_ATTRS];
static int anim_index(uint8_t attr)
{
    switch (attr) {
        case LUME_ATTR_X: return 0;
        case LUME_ATTR_Y: return 1;
        case LUME_ATTR_WIDTH: return 2;
        case LUME_ATTR_HEIGHT: return 3;
        case LUME_ATTR_OPACITY: return 4;
        default: return -1;
    }
}
static void anim_exec(void *var, int32_t value)
{
    uint8_t *slot = var;
    size_t index = (size_t)(slot - &s_anim_slots[0][0]);
    uint16_t id = index / ANIM_ATTRS;
    lv_obj_t *obj = s_nodes[id];
    if (!obj) return;
    switch (index % ANIM_ATTRS) {
        case 0: lv_obj_set_x(obj, value); break;
        case 1: lv_obj_set_y(obj, value); break;
        case 2: lv_obj_set_width(obj, value); break;
        case 3: lv_obj_set_height(obj, value); break;
        case 4: lv_obj_set_style_opa(obj, (lv_opa_t)value, 0); break;
    }
}
static void anim_completed(lv_anim_t *a)
{
    uint8_t *slot = lv_anim_get_user_data(a);
    size_t index = (size_t)(slot - &s_anim_slots[0][0]);
    uint32_t token = s_anim_tokens[index / ANIM_ATTRS][index % ANIM_ATTRS];
    s_anim_tokens[index / ANIM_ATTRS][index % ANIM_ATTRS] = 0;
    if (token && s_anim_sink) s_anim_sink(token);
}
static void cancel_anim(uint16_t id, uint8_t attr)
{
    int i = anim_index(attr);
    if (i < 0 || id == 0 || id >= LUME_MAX_NODES) return;
    s_anim_tokens[id][i] = 0;
    lv_anim_delete(&s_anim_slots[id][i], anim_exec);
}
static void apply_animate(const lume_ui_msg_t *m)
{
    int i = anim_index(m->attr);
    lv_obj_t *obj = get_node(m->node_id);
    if (i < 0 || !obj || m->duration_ms == 0 || m->easing > LUME_EASE_IN_OUT) return;
    /* Delete first, then sample current LVGL value: replacements start at the
     * visible in-flight value when from is omitted. */
    cancel_anim(m->node_id, m->attr);
    int32_t from = m->from;
    if (!m->has_from) {
        switch (m->attr) {
            case LUME_ATTR_X: from = lv_obj_get_x(obj); break;
            case LUME_ATTR_Y: from = lv_obj_get_y(obj); break;
            case LUME_ATTR_WIDTH: from = lv_obj_get_width(obj); break;
            case LUME_ATTR_HEIGHT: from = lv_obj_get_height(obj); break;
            case LUME_ATTR_OPACITY: from = lv_obj_get_style_opa(obj, 0); break;
        }
    }
    if (m->attr == LUME_ATTR_WIDTH) s_explicit_width[m->node_id] = 1;
    if (m->attr == LUME_ATTR_HEIGHT) s_explicit_height[m->node_id] = 1;
    uint8_t *slot = &s_anim_slots[m->node_id][i];
    s_anim_tokens[m->node_id][i] = m->token;
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, slot);
    lv_anim_set_exec_cb(&a, anim_exec);
    lv_anim_set_values(&a, from, m->to);
    lv_anim_set_duration(&a, m->duration_ms);
    lv_anim_set_user_data(&a, slot);
    lv_anim_set_completed_cb(&a, anim_completed);
    switch (m->easing) {
        case LUME_EASE_IN: lv_anim_set_path_cb(&a, lv_anim_path_ease_in); break;
        case LUME_EASE_OUT: lv_anim_set_path_cb(&a, lv_anim_path_ease_out); break;
        case LUME_EASE_IN_OUT: lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out); break;
        default: lv_anim_set_path_cb(&a, lv_anim_path_linear); break;
    }
    lv_anim_start(&a);
}

/* ------------------------------------------------------------------ */
/* Queue A apply functions — LVGL task context only                    */
/* ------------------------------------------------------------------ */

static void apply_reset(void)
{
    lv_obj_t *screen = lv_screen_active();
    clear_subtree(screen);
    lv_obj_clean(screen);
    release_dead_canvases();
    release_dead_images();
    memset(s_failed_nodes, 0, sizeof(s_failed_nodes));
    ESP_LOGI(TAG, "app UI reset complete");
}

static void fail_create(uint16_t id)
{
    s_failed_nodes[id] = true;
    lume_engine_mark_create_failed(id);
}

static void apply_create(const lume_ui_msg_t *m)
{
    if (m->node_id == 0 || m->node_id >= LUME_MAX_NODES) {
        ESP_LOGE(TAG, "create: invalid node_id %u", (unsigned)m->node_id);
        return;
    }
    s_failed_nodes[m->node_id] = false;
    if (s_nodes[m->node_id]) {
        lv_obj_t *old = s_nodes[m->node_id];
        clear_subtree(old);
        lv_obj_delete(old);
        release_dead_canvases();
        release_dead_images();
    }
    lv_obj_t *parent = (m->parent_id == 0)
                           ? lv_screen_active()
                           : get_node(m->parent_id);
    if (parent == NULL) {
        if (m->parent_id < LUME_MAX_NODES && s_failed_nodes[m->parent_id]) {
            fail_create(m->node_id);
            return;
        }
        parent = lv_screen_active();
    }

    lv_obj_t *obj = NULL;
    switch (m->kind) {
        case LUME_NODE_VIEW:
            obj = lv_obj_create(parent);
            if (!obj) { fail_create(m->node_id); return; }
            /* LVGL's lv_obj default style is an opaque white rounded box. Apps
             * expect a transparent node unless they set `background`, so start
             * transparent; ATTR_BG_COLOR restores bg_opa COVER when a colour
             * is actually set. */
            lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, 0);
            lv_obj_set_style_border_width(obj, 0, 0);
            lv_obj_set_style_radius(obj, 0, 0);
            /* Lume default: containers do not scroll. LVGL marks every lv_obj
             * SCROLLABLE with an AUTO scrollbar, so overflowing flex children
             * would grow a scrollbar and swallow drags before the gesture
             * recognizer sees them; style.scroll re-adds the flag
             * (ATTR_SCROLL_DIR != 0 in apply_set_attr). */
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
            /* The default theme wraps every bare lv_obj in its `card` style,
             * which on this panel (DISP_MEDIUM) adds 20px padding on all four
             * sides plus 12px flex row/column gaps even when the app sets
             * neither style.padding nor style.gap. Zero them like the
             * background/border/radius defaults above: unset means 0, and
             * local styles from PADDING/GAP override these anyway. */
            lv_obj_set_style_pad_all(obj, 0, 0);
            lv_obj_set_style_pad_row(obj, 0, 0);
            lv_obj_set_style_pad_column(obj, 0, 0);
            /* Plain Views are also non-clickable: a decorative child (icon
             * tile, label...) must not swallow the tap meant for the parent
             * card that owns the onPress. apply_set_press/apply_set_gesture
             * re-add the flag for nodes that actually handle input. */
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE);
            break;
        case LUME_NODE_TEXT:
            obj = lv_label_create(parent);
            if (!obj) { fail_create(m->node_id); return; }
            /* Centered text uses LVGL's default font. Typography (big font)
             * is intentionally deferred: M1 real-device visuals are out of
             * scope, and referencing Montserrat-32 pulls ~45KB of glyph data. */
            lv_obj_set_style_text_color(obj, lv_color_white(), 0);
            break;
        case LUME_NODE_BUTTON: {
            obj = lv_button_create(parent);
            if (!obj) { fail_create(m->node_id); return; }
            lv_obj_t *label = lv_label_create(obj);
            if (!label) { lv_obj_delete(obj); fail_create(m->node_id); return; }
            lv_label_set_text(label, "");
            lv_obj_set_style_text_color(label, lv_color_white(), 0);
            lv_obj_center(label);
            break;
        }
        case LUME_NODE_CANVAS: {
            int32_t w = m->from, h = m->to;
            size_t bytes = (size_t)lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) * h;
            if (w < 1 || h < 1 || w > LUME_LCD_H_RES || h > LUME_LCD_V_RES ||
                bytes > (CANVAS_BUDGET - s_canvas_bytes) / 2u) {
                ESP_LOGE(TAG, "canvas id=%u invalid dimensions/budget %ldx%ld", m->node_id, (long)w, (long)h);
                fail_create(m->node_id);
                return;
            }
            uint16_t *pixels = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
            if (!pixels) { ESP_LOGE(TAG, "canvas PSRAM allocation failed (%u)", (unsigned)bytes); fail_create(m->node_id); return; }
            memset(pixels, 0, bytes);
            /* Second image: raster commands land here and are published on the
             * closing invalidate, so a refresh never samples a half-drawn dial.
             * Without it (PSRAM exhausted) the canvas degrades to the old
             * single-buffer behaviour instead of failing to create. */
            uint16_t *work = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
            if (work) memset(work, 0, bytes);
            else ESP_LOGW(TAG, "canvas id=%u single buffered (no PSRAM for the 2nd image, %u bytes)",
                          (unsigned)m->node_id, (unsigned)bytes);
            obj = lv_canvas_create(parent);
            if (!obj) { heap_caps_free(work); heap_caps_free(pixels); fail_create(m->node_id); return; }
            lv_canvas_set_buffer(obj, pixels, w, h, LV_COLOR_FORMAT_RGB565);
            lv_obj_set_size(obj, w, h);
            s_canvas_pixels[m->node_id] = pixels;
            s_canvas_work[m->node_id] = work ? work : pixels;
            s_canvas_w[m->node_id] = w;
            s_canvas_h[m->node_id] = h;
            s_canvas_stride[m->node_id] = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) / 2u;
            s_canvas_bytes += bytes * (work ? 2u : 1u);
            break;
        }
        case LUME_NODE_ARC:
            /* Native LVGL arc: lv_draw_sw_arc renders with coverage, so the ring
             * is anti-aliased -- unlike Canvas, which writes raw pixels. */
            obj = lv_arc_create(parent);
            if (!obj) { fail_create(m->node_id); return; }
            lv_obj_remove_style(obj, NULL, LV_PART_KNOB);
            lv_obj_set_style_arc_width(obj, 8, LV_PART_MAIN);
            lv_obj_set_style_arc_width(obj, 8, LV_PART_INDICATOR);
            lv_obj_set_style_arc_color(obj, lv_color_hex(0x1B3145), LV_PART_MAIN);
            lv_obj_set_style_arc_color(obj, lv_color_hex(0x34D399), LV_PART_INDICATOR);
            lv_obj_set_style_arc_rounded(obj, true, LV_PART_INDICATOR);
            /* The plain lv_obj default style paints an opaque rounded box; an
             * arc must be a pure ring, so kill every box style on PART_MAIN. */
            lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, LV_PART_MAIN);
            lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, LV_PART_INDICATOR);
            lv_obj_set_style_border_width(obj, 0, LV_PART_MAIN);
            lv_obj_set_style_outline_width(obj, 0, LV_PART_MAIN);
            lv_obj_set_style_shadow_width(obj, 0, LV_PART_MAIN);
            lv_obj_set_style_radius(obj, 0, LV_PART_MAIN);
            lv_obj_set_style_pad_all(obj, 0, LV_PART_MAIN);
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE);
            ESP_LOGI(TAG, "arc id=%u bg_opa=%d bg=%06x radius=%d border=%d outline=%d shadow=%d pad=%d",
                     (unsigned)m->node_id,
                     (int)lv_obj_get_style_bg_opa(obj, LV_PART_MAIN),
                     (unsigned)(lv_color_to_u32(lv_obj_get_style_bg_color(obj, LV_PART_MAIN)) & 0xFFFFFFu),
                     (int)lv_obj_get_style_radius(obj, LV_PART_MAIN),
                     (int)lv_obj_get_style_border_width(obj, LV_PART_MAIN),
                     (int)lv_obj_get_style_outline_width(obj, LV_PART_MAIN),
                     (int)lv_obj_get_style_shadow_width(obj, LV_PART_MAIN),
                     (int)lv_obj_get_style_pad_top(obj, LV_PART_MAIN));
            lv_arc_set_bg_angles(obj, 135, 45);
            lv_arc_set_angles(obj, 135, 135);
            s_arc_start[m->node_id] = 135;
            s_arc_end[m->node_id] = 45;
            break;
        case LUME_NODE_IMAGE:
            obj = lv_image_create(parent);
            if (!obj) { fail_create(m->node_id); return; }
            lv_image_set_inner_align(obj, LV_IMAGE_ALIGN_CONTAIN);
            break;
        default:
            ESP_LOGE(TAG, "create: unknown kind %u", (unsigned)m->kind);
            fail_create(m->node_id);
            return;
    }

    /* Bubble every event up to the screen so the global gesture listener
     * (prelude, node 0) sees drags that start anywhere, including on objects
     * that subscribe to no gestures of their own. Handlers on the original
     * target still fire first, so per-app gestures are unaffected. */
    lv_obj_add_flag(obj, LV_OBJ_FLAG_EVENT_BUBBLE);
    s_nodes[m->node_id] = obj;
    for (int i = 0; i < ANIM_ATTRS; i++) cancel_anim(m->node_id, (uint8_t)(i == 0 ? LUME_ATTR_X : i == 1 ? LUME_ATTR_Y : i == 2 ? LUME_ATTR_WIDTH : i == 3 ? LUME_ATTR_HEIGHT : LUME_ATTR_OPACITY));
    s_kinds[m->node_id] = m->kind;
    s_flow[m->node_id] = LUME_FLEX_ROW;
    s_main[m->node_id] = LUME_FLEX_START;
    s_cross[m->node_id] = LUME_FLEX_START;
    s_explicit_width[m->node_id] = 0;
    s_explicit_height[m->node_id] = 0;
    s_align[m->node_id] = LUME_ALIGN_CENTER;
    s_align_target[m->node_id] = LUME_ALIGN_TARGET_PARENT;
    s_align_ofs_x[m->node_id] = 0;
    s_align_ofs_y[m->node_id] = 0;
    s_scroll_sent[m->node_id] = 0;
    s_gesture_flags[m->node_id] = 0;   /* r21: fresh node -> clear press/scroll latch */
    if (m->kind == LUME_NODE_CANVAS) {
        s_explicit_width[m->node_id] = 1;
        s_explicit_height[m->node_id] = 1;
    }
    lv_obj_set_user_data(obj, (void *)(uintptr_t)m->node_id);
    if (m->parent_id > 0 && m->parent_id < LUME_MAX_NODES &&
        s_nodes[m->parent_id] == parent) apply_stretch_child(obj, m->parent_id);
    ESP_LOGI(TAG, "create id=%u kind=%u parent=%u",
             (unsigned)m->node_id, (unsigned)m->kind, (unsigned)m->parent_id);
}

static void apply_set_attr(const lume_ui_msg_t *m)
{
    lv_obj_t *obj = get_node(m->node_id);
    if (obj == NULL) {
        if (m->node_id >= LUME_MAX_NODES || !s_failed_nodes[m->node_id])
            ESP_LOGW(TAG, "set-attr: unknown node_id %u", (unsigned)m->node_id);
        return;
    }
    cancel_anim(m->node_id, m->attr);
    switch (m->attr) {
        case LUME_ATTR_X: lv_obj_set_x(obj, m->value); break;
        case LUME_ATTR_Y: lv_obj_set_y(obj, m->value); break;
        case LUME_ATTR_SCROLL_DIR:
            if (m->value == 0) lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
            else {
                lv_obj_add_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
                lv_obj_set_scroll_dir(obj, m->value == 1 ? LV_DIR_VER : LV_DIR_HOR);
                lv_obj_add_event_cb(obj, scroll_cb, LV_EVENT_SCROLL,
                                    (void *)(uintptr_t)m->node_id);
                lv_obj_add_event_cb(obj, scroll_cb, LV_EVENT_SCROLL_END,
                                    (void *)(uintptr_t)m->node_id);
            }
            break;
        case LUME_ATTR_SCROLLBAR_MODE:
            lv_obj_set_scrollbar_mode(obj, m->value == 0 ? LV_SCROLLBAR_MODE_OFF :
                                      m->value == 2 ? LV_SCROLLBAR_MODE_ON : LV_SCROLLBAR_MODE_AUTO);
            break;
        case LUME_ATTR_SCROLL_Y: lv_obj_scroll_to_y(obj, m->value, LV_ANIM_OFF); break;
        case LUME_ATTR_IGNORE_LAYOUT:
            if (m->value) lv_obj_add_flag(obj, LV_OBJ_FLAG_IGNORE_LAYOUT);
            else lv_obj_remove_flag(obj, LV_OBJ_FLAG_IGNORE_LAYOUT);
            break;
        case LUME_ATTR_TEXT:
            lv_label_set_text(text_target(m->node_id, obj),
                              m->text_heap ? m->text_heap : m->text);
            break;
        case LUME_ATTR_BG_COLOR:
            if (s_kinds[m->node_id] == LUME_NODE_ARC) {
                /* An arc has no box background. Setting bg_color would also force
                 * bg_opa back to COVER (below), producing a filled rounded box --
                 * so stray background colours are redirected to the value ring. */
                lv_obj_set_style_arc_color(obj, lv_color_hex((uint32_t)m->value), LV_PART_INDICATOR);
            } else {
                lv_obj_set_style_bg_color(obj, lv_color_hex((uint32_t)m->value), 0);
                lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
            }
            break;
        case LUME_ATTR_WIDTH:
            s_explicit_width[m->node_id] = 1;
            lv_obj_set_width(obj, m->value);
            break;
        case LUME_ATTR_HEIGHT:
            s_explicit_height[m->node_id] = 1;
            lv_obj_set_height(obj, m->value);
            break;
        case LUME_ATTR_WIDTH_PCT:
            s_explicit_width[m->node_id] = 1;
            lv_obj_set_width(obj, lv_pct(m->value));
            break;
        case LUME_ATTR_HEIGHT_PCT:
            s_explicit_height[m->node_id] = 1;
            lv_obj_set_height(obj, lv_pct(m->value));
            break;
        /* A content-sized axis counts as explicit: a stretch parent must not
         * overwrite it with lv_pct(100). */
        case LUME_ATTR_WIDTH_AUTO:
            s_explicit_width[m->node_id] = 1;
            lv_obj_set_width(obj, LV_SIZE_CONTENT);
            break;
        case LUME_ATTR_HEIGHT_AUTO:
            s_explicit_height[m->node_id] = 1;
            lv_obj_set_height(obj, LV_SIZE_CONTENT);
            break;
        case LUME_ATTR_MIN_WIDTH: lv_obj_set_style_min_width(obj, m->value, 0); break;
        case LUME_ATTR_MAX_WIDTH: lv_obj_set_style_max_width(obj, m->value, 0); break;
        case LUME_ATTR_MIN_HEIGHT: lv_obj_set_style_min_height(obj, m->value, 0); break;
        case LUME_ATTR_MAX_HEIGHT: lv_obj_set_style_max_height(obj, m->value, 0); break;
        case LUME_ATTR_TRANSLATE_X: lv_obj_set_style_translate_x(obj, m->value, 0); break;
        case LUME_ATTR_TRANSLATE_X_PCT: lv_obj_set_style_translate_x(obj, lv_pct(m->value), 0); break;
        case LUME_ATTR_TRANSLATE_Y: lv_obj_set_style_translate_y(obj, m->value, 0); break;
        case LUME_ATTR_TRANSLATE_Y_PCT: lv_obj_set_style_translate_y(obj, lv_pct(m->value), 0); break;
        case LUME_ATTR_TEXT_ALIGN:
            lv_obj_set_style_text_align(text_target(m->node_id, obj),
                                        map_text_align(m->value), 0);
            break;
        case LUME_ATTR_TEXT_LONG_MODE: {
            lv_obj_t *label = text_target(m->node_id, obj);
            /* Only real labels carry a long mode; a View would be a no-op. */
            if (s_kinds[m->node_id] == LUME_NODE_TEXT ||
                s_kinds[m->node_id] == LUME_NODE_BUTTON) {
                lv_label_set_long_mode(label, map_long_mode(m->value));
            }
            break;
        }
        case LUME_ATTR_TEXT_FONT: {
            /* Snap an arbitrary px size to the nearest bundled face (14/20/32);
             * CJK glyphs fall through the face's .fallback to lume_font_sc_16. */
            static const int16_t faces[] = {14, 20, 32};
            const lv_font_t *font = &lv_font_montserrat_14;
            int16_t best = faces[0];
            for (size_t i = 1; i < sizeof(faces) / sizeof(faces[0]); i++) {
                if (labs((long)m->value - faces[i]) < labs((long)m->value - best)) {
                    font = (i == 1) ? &lv_font_montserrat_20 : &lv_font_montserrat_32;
                    best = faces[i];
                }
            }
            lv_obj_set_style_text_font(text_target(m->node_id, obj), font, 0);
            break;
        }
        case LUME_ATTR_LETTER_SPACE:
            lv_obj_set_style_text_letter_space(text_target(m->node_id, obj), (int16_t)m->value, 0);
            break;
        case LUME_ATTR_LINE_SPACE:
            lv_obj_set_style_text_line_space(text_target(m->node_id, obj), (int16_t)m->value, 0);
            break;
        case LUME_ATTR_FLEX_FLOW:
            s_flow[m->node_id] = (uint8_t)m->value;
            lv_obj_set_flex_flow(obj, map_flow(m->value));
            apply_flex_align(obj, m->node_id);
            break;
        case LUME_ATTR_FLEX_MAIN_ALIGN:
            s_main[m->node_id] = (uint8_t)m->value;
            apply_flex_align(obj, m->node_id);
            break;
        case LUME_ATTR_FLEX_CROSS_ALIGN:
            s_cross[m->node_id] = (uint8_t)m->value;
            apply_flex_align(obj, m->node_id);
            break;
        case LUME_ATTR_PADDING:
            lv_obj_set_style_pad_all(obj, m->value, 0);
            break;
        case LUME_ATTR_PAD_TOP: lv_obj_set_style_pad_top(obj, m->value, 0); break;
        case LUME_ATTR_PAD_RIGHT: lv_obj_set_style_pad_right(obj, m->value, 0); break;
        case LUME_ATTR_PAD_BOTTOM: lv_obj_set_style_pad_bottom(obj, m->value, 0); break;
        case LUME_ATTR_PAD_LEFT: lv_obj_set_style_pad_left(obj, m->value, 0); break;
        case LUME_ATTR_MARGIN:
            lv_obj_set_style_margin_top(obj, m->value, 0);
            lv_obj_set_style_margin_right(obj, m->value, 0);
            lv_obj_set_style_margin_bottom(obj, m->value, 0);
            lv_obj_set_style_margin_left(obj, m->value, 0);
            break;
        case LUME_ATTR_MARGIN_TOP: lv_obj_set_style_margin_top(obj, m->value, 0); break;
        case LUME_ATTR_MARGIN_RIGHT: lv_obj_set_style_margin_right(obj, m->value, 0); break;
        case LUME_ATTR_MARGIN_BOTTOM: lv_obj_set_style_margin_bottom(obj, m->value, 0); break;
        case LUME_ATTR_MARGIN_LEFT: lv_obj_set_style_margin_left(obj, m->value, 0); break;
        case LUME_ATTR_FLEX_GROW:
            /* lv_obj_set_flex_grow takes uint8_t; grow only applies inside a
             * flex parent that still has free space on the main axis. */
            lv_obj_set_flex_grow(obj, (uint8_t)(m->value < 0 ? 0 :
                                               (m->value > 255 ? 255 : m->value)));
            break;
        case LUME_ATTR_GAP:
            lv_obj_set_style_pad_row(obj, m->value, 0);
            lv_obj_set_style_pad_column(obj, m->value, 0);
            break;
        case LUME_ATTR_RADIUS:
            lv_obj_set_style_radius(obj, m->value, 0);
            break;
        case LUME_ATTR_BORDER_WIDTH:
            lv_obj_set_style_border_width(obj, m->value, 0);
            break;
        case LUME_ATTR_BORDER_COLOR:
            lv_obj_set_style_border_color(obj, lv_color_hex((uint32_t)m->value), 0);
            break;
        case LUME_ATTR_OPACITY:
            lv_obj_set_style_opa(obj, (lv_opa_t)m->value, 0);
            break;
        case LUME_ATTR_ALIGN:
            /* Out-of-range wire values degrade to CENTER instead of indexing
             * off the end of the align maps. */
            s_align[m->node_id] = (uint8_t)(m->value < 0 ||
                                            m->value > LUME_ALIGN_OUT_RIGHT_BOTTOM
                                                ? LUME_ALIGN_CENTER : m->value);
            apply_align(obj, m->node_id);
            break;
        case LUME_ATTR_ALIGN_TARGET:
            /* Stored only: the align-relative-to message is applied by ALIGN,
             * which always arrives last from the prelude. */
            s_align_target[m->node_id] =
                (m->value <= LUME_ALIGN_TARGET_PARENT || m->value >= LUME_MAX_NODES)
                    ? (uint8_t)LUME_ALIGN_TARGET_PARENT : (uint8_t)m->value;
            break;
        case LUME_ATTR_ALIGN_OFS_X:
            s_align_ofs_x[m->node_id] = (int16_t)(m->value < -32768 ? -32768 :
                                                  (m->value > 32767 ? 32767 : m->value));
            break;
        case LUME_ATTR_ALIGN_OFS_Y:
            s_align_ofs_y[m->node_id] = (int16_t)(m->value < -32768 ? -32768 :
                                                  (m->value > 32767 ? 32767 : m->value));
            break;
        case LUME_ATTR_VISIBLE:
            if (m->value) {
                lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
            } else {
                lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
            }
            break;
        case LUME_ATTR_PARENT: {
            lv_obj_t *p = get_node((uint16_t)m->value);
            if (p != NULL) {
                lv_obj_set_parent(obj, p);   /* append child into parent */
                apply_stretch_child(obj, (uint16_t)m->value);
            }
            break;
        }
        case LUME_ATTR_ARC_START:
            s_arc_start[m->node_id] = (int16_t)m->value;
            lv_arc_set_bg_angles(obj, s_arc_start[m->node_id], s_arc_end[m->node_id]);
            lv_arc_set_angles(obj, s_arc_start[m->node_id], s_arc_start[m->node_id]);
            break;
        case LUME_ATTR_ARC_END:
            s_arc_end[m->node_id] = (int16_t)m->value;
            lv_arc_set_bg_angles(obj, s_arc_start[m->node_id], s_arc_end[m->node_id]);
            lv_arc_set_angles(obj, s_arc_start[m->node_id], s_arc_start[m->node_id]);
            break;
        case LUME_ATTR_ARC_THICKNESS:
            lv_obj_set_style_arc_width(obj, m->value, LV_PART_MAIN);
            lv_obj_set_style_arc_width(obj, m->value, LV_PART_INDICATOR);
            break;
        case LUME_ATTR_ARC_TRACK:
            lv_obj_set_style_arc_color(obj, lv_color_hex((uint32_t)m->value), LV_PART_MAIN);
            break;
        case LUME_ATTR_ARC_COLOR:
            lv_obj_set_style_arc_color(obj, lv_color_hex((uint32_t)m->value), LV_PART_INDICATOR);
            break;
        case LUME_ATTR_ARC_VALUE: {
            /* percent of the configured start->end sweep, clockwise */
            int32_t start = s_arc_start[m->node_id], end = s_arc_end[m->node_id];
            int32_t span = ((end - start) % 360 + 360) % 360;
            if (span == 0) span = 360;
            int32_t v = m->value < 0 ? 0 : (m->value > 100 ? 100 : m->value);
            lv_arc_set_angles(obj, start, (start + span * v / 100) % 360);
            break;
        }
        default:
            ESP_LOGW(TAG, "set-attr: unknown attr %u", (unsigned)m->attr);
            break;
    }
}

/* lv_obj_delete() recursively frees the whole LVGL subtree, but the node
 * table is separate: clearing only the parent's entry would leave child ids
 * pointing at freed lv_obj_t (dangling pointers for later setAttr/removeChild).
 * Walk the subtree BEFORE deletion and purge every table entry whose lv_obj
 * carries a node_id (stamped into lv_obj user_data at creation). LVGL-internal
 * children (e.g. a button's label) carry user_data 0 and are simply skipped. */
static void clear_subtree(lv_obj_t *obj)
{
    if (obj == NULL) {
        return;
    }
    uint32_t n = lv_obj_get_child_count(obj);
    for (uint32_t i = 0; i < n; i++) {
        clear_subtree(lv_obj_get_child(obj, (int32_t)i));
    }
    uint16_t id = (uint16_t)(uintptr_t)lv_obj_get_user_data(obj);
    if (id > 0 && id < LUME_MAX_NODES) {
        for (int i = 0; i < ANIM_ATTRS; i++) {
            s_anim_tokens[id][i] = 0;
            lv_anim_delete(&s_anim_slots[id][i], anim_exec);
        }
        s_nodes[id] = NULL;
        s_kinds[id] = 0;
        s_explicit_width[id] = s_explicit_height[id] = 0;
        s_align[id] = LUME_ALIGN_CENTER;
        s_align_target[id] = LUME_ALIGN_TARGET_PARENT;
        s_align_ofs_x[id] = s_align_ofs_y[id] = 0;
    }
}
/* Drop every retained path of one canvas (its node is gone). */
static void canvas_release_paths(uint16_t id)
{
    for (uint8_t slot = 0; slot < LUME_CANVAS_PATHS; slot++) {
        if (s_path_lines[id][slot] != NULL) {
            s_path_bytes -= (size_t)s_path_count[id][slot] * sizeof(lume_canvas_line_t);
            heap_caps_free(s_path_lines[id][slot]);
            s_path_lines[id][slot] = NULL;
            s_path_count[id][slot] = 0;
        }
    }
}
static void release_dead_canvases(void)
{
    for (uint16_t id = 1; id < LUME_MAX_NODES; id++) {
        if (s_canvas_pixels[id] && !s_nodes[id]) {
            size_t bytes = (size_t)s_canvas_stride[id] * 2u * s_canvas_h[id];
            bool split = s_canvas_work[id] != NULL && s_canvas_work[id] != s_canvas_pixels[id];
            s_canvas_bytes -= bytes * (split ? 2u : 1u);
            if (split) heap_caps_free(s_canvas_work[id]);
            heap_caps_free(s_canvas_pixels[id]);
            s_canvas_work[id] = NULL;
            s_canvas_pixels[id] = NULL;
            canvas_release_paths(id);
        }
    }
}

static void apply_image_source(const lume_ui_msg_t *m)
{
    uint16_t id = m->node_id;
    if (!m->image_pixels) return;
    if (!id || id >= LUME_MAX_NODES || !s_nodes[id] || s_kinds[id] != LUME_NODE_IMAGE) {
        heap_caps_free(m->image_pixels);
        return;
    }
    /* LVGL sees only the native RGB565 descriptor, never JS-owned encoded bytes. */
    lv_image_dsc_t *d = &s_image_dsc[id];
    uint8_t *old = s_image_pixels[id];
    if (old) lv_image_cache_drop(d);
    memset(d, 0, sizeof(*d));
    d->header.magic = LV_IMAGE_HEADER_MAGIC;
    d->header.cf = m->image_alpha ? LV_COLOR_FORMAT_RGB565A8 : LV_COLOR_FORMAT_RGB565;
    d->header.w = m->image_w; d->header.h = m->image_h;
    d->header.stride = m->image_w * 2;
    d->data_size = (uint32_t)m->image_w * m->image_h * (m->image_alpha ? 3 : 2);
    d->data = m->image_pixels;
    s_image_pixels[id] = m->image_pixels;
    lv_image_set_src(s_nodes[id], d);
    if (!s_explicit_width[id]) lv_obj_set_width(s_nodes[id], m->image_w);
    if (!s_explicit_height[id]) lv_obj_set_height(s_nodes[id], m->image_h);
    if (old) heap_caps_free(old);
}

/* ---- canvas frame atomicity (double buffered) ----
 * Raster commands for one onDraw frame arrive as a burst of Queue A records
 * closed by LUME_OP_CANVAS_INVALIDATE. The burst is applied in place and can
 * take tens of milliseconds (the engine task builds every segment in JS), so a
 * display refresh that samples the single canvas buffer mid-burst blits a
 * half-drawn canvas: on a gauge that shows as a flickering arc and a needle
 * that comes and goes. Each canvas therefore owns two RGB565 buffers:
 *   front = the buffer lv_canvas displays (always a finished frame)
 *   work  = the buffer raster commands are written to
 * The closing invalidate publishes work (swap on a full redraw, memcpy of the
 * dirty rect on a partial one). Cost: two canvas-sized PSRAM buffers per node
 * (CANVAS_BUDGET covers both). */
static void canvas_publish(uint16_t id, const lume_ui_msg_t *m);

/* Raster commands are applied only by the LVGL timer. The buffer belongs to
 * the canvas and is never shared with the engine; one final invalidate per
 * onDraw run avoids lv_canvas_set_px's per-pixel invalidation.
 *
 * Everything rasterises as row spans: the canvas lives in PSRAM, so a
 * sequential run of stores per row (32-bit pairs when the run is aligned) costs
 * far less than the previous per-pixel helper with its four bounds comparisons,
 * and it keeps whole cache lines busy instead of re-touching them. */
static inline void canvas_span(uint16_t id, int32_t y, int32_t x0, int32_t x1, uint16_t c)
{
    if (y < 0 || y >= (int32_t)s_canvas_h[id]) return;
    if (x0 < 0) x0 = 0;
    if (x1 >= (int32_t)s_canvas_w[id]) x1 = (int32_t)s_canvas_w[id] - 1;
    if (x0 > x1) return;
    uint16_t *dst = s_canvas_work[id] + (size_t)y * s_canvas_stride[id] + x0;
    int32_t n = x1 - x0 + 1;
    if (((uintptr_t)dst) & 2u) { *dst++ = c; n--; }   /* realign to 32 bits */
    uint32_t pair = ((uint32_t)c << 16) | c;
    uint32_t *dst32 = (uint32_t *)dst;
    while (n >= 2) { *dst32++ = pair; n -= 2; }
    if (n) *(uint16_t *)dst32 = c;
}
/* Anti-aliased stroked segment (r47). The old version stamped an
 * axis-aligned square brush along a Bresenham centreline, so stroke edges
 * were hard 1 px staircases (roadmap rendering-backlog item 1). Coverage now
 * comes from the exact point-to-segment distance with a 1 px feather, in
 * lume_raster.h; the opaque core stays bit-identical so opaque repaints
 * erase cleanly. */
static void canvas_line(const lume_raster_surf_t *surf, int32_t x, int32_t y,
                        int32_t x2, int32_t y2, uint8_t width)
{
    lume_raster_line(surf, x, y, x2, y2, width);
}
static void apply_canvas_draw(const lume_ui_msg_t *m)
{
    uint16_t id = m->node_id;
    if (id == 0 || id >= LUME_MAX_NODES || !s_canvas_pixels[id]) return;
    uint16_t c = lv_color_to_u16(lv_color_hex((uint32_t)m->value));
    int32_t x = m->from, y = m->to, a = (int32_t)m->duration_ms, b = (int32_t)m->token;
    /* r47: one AA surface descriptor per draw op; only the LVGL task runs
     * this function, so the single static is safe (same discipline as the
     * rest of the drain path). */
    static lume_raster_surf_t surf;
    surf.px = s_canvas_work[id];
    surf.w = s_canvas_w[id];
    surf.h = s_canvas_h[id];
    surf.stride = s_canvas_stride[id];
    lume_raster_set_color(&surf, c);
    switch (m->attr) {
        case LUME_DRAW_CLEAR:
            for (int32_t yy = 0; yy < (int32_t)s_canvas_h[id]; yy++)
                canvas_span(id, yy, 0, (int32_t)s_canvas_w[id] - 1, c);
            break;
        case LUME_DRAW_RECT:
            for (int32_t yy = y; yy < y + b; yy++)
                canvas_span(id, yy, x, x + a - 1, c);
            break;
        case LUME_DRAW_LINE:
            canvas_line(&surf, x, y, a, b, m->draw_width);
            break;
        case LUME_DRAW_CIRCLE:
            /* r47: one continuous anti-aliased annulus replaces the old
             * eight-stamp circle (each stamp was a mini solid disc; the
             * diagonal stamp sites double-covered and left seam bumps). */
            lume_raster_ring(&surf, x, y, a, m->draw_width);
            break;
        case LUME_DRAW_ARC:
            /* r48: native AA annulus arc. The fixed 128 B message has no
             * spare int32 pair, so ARC carries radius in image_w and the two
             * signed degree angles in duration_ms/token (a/b here); the
             * raster normalises/wraps them. x/y are the centre. */
            lume_raster_arc(&surf, x, y, (int32_t)m->image_w, a, b,
                            m->draw_width);
            break;
        case LUME_DRAW_TEXT: {
            /* Text is rasterised through LVGL's draw layer, which targets the
             * canvas's current buffer (front). Point it at work for the
             * duration, with invalidation suppressed: lv_canvas_finish_layer()
             * invalidates the canvas itself, and this frame must stay invisible
             * until its closing invalidate publishes it. */
            lv_obj_t *obj = s_nodes[id];
            lv_display_t *disp = lv_obj_get_display(obj);
            uint16_t *front = s_canvas_pixels[id], *work = s_canvas_work[id];
            lv_display_enable_invalidation(disp, false);
            if (work != front) lv_canvas_set_buffer(obj, work, s_canvas_w[id], s_canvas_h[id], LV_COLOR_FORMAT_RGB565);
            lv_layer_t layer;
            lv_canvas_init_layer(obj, &layer);
            lv_draw_label_dsc_t dsc;
            lv_draw_label_dsc_init(&dsc);
            dsc.text = m->text_heap ? m->text_heap : m->text;
            dsc.color = lv_color_hex((uint32_t)m->value);
            lv_area_t area = {x, y, s_canvas_w[id]-1, s_canvas_h[id]-1};
            lv_draw_label(&layer, &dsc, &area);
            lv_canvas_finish_layer(obj, &layer);
            if (work != front) lv_canvas_set_buffer(obj, front, s_canvas_w[id], s_canvas_h[id], LV_COLOR_FORMAT_RGB565);
            lv_display_enable_invalidation(disp, true);
            break;
        }
    }
}

/* Retained paths: DEFINE takes ownership of the segment array and stores it in
 * slot [id-1]; DRAW replays it with an optional offset. A define for an
 * occupied slot replaces (and frees) the previous array, which is how an app
 * rebuilds a picture without leaking. */
static void apply_canvas_path_define(const lume_ui_msg_t *m)
{
    uint16_t id = m->node_id;
    lume_canvas_line_t *lines = (lume_canvas_line_t *)m->image_pixels;
    uint16_t count = m->image_w;
    uint8_t slot = m->attr;
    if (id == 0 || id >= LUME_MAX_NODES || !s_canvas_pixels[id] ||
        count == 0 || count > LUME_CANVAS_PATH_SEG_MAX || slot >= LUME_CANVAS_PATHS) {
        ESP_LOGE(TAG, "path define id=%u slot=%u count=%u rejected",
                 (unsigned)id, (unsigned)slot, (unsigned)count);
        heap_caps_free(lines);
        return;
    }
    size_t bytes = (size_t)count * sizeof(lume_canvas_line_t);
    if (s_path_lines[id][slot] != NULL) {
        s_path_bytes -= (size_t)s_path_count[id][slot] * sizeof(lume_canvas_line_t);
        heap_caps_free(s_path_lines[id][slot]);
        s_path_lines[id][slot] = NULL;
        s_path_count[id][slot] = 0;
    }
    if (bytes > LUME_CANVAS_PATH_BUDGET - s_path_bytes) {
        ESP_LOGE(TAG, "path budget exceeded (%u + %u > %u), path dropped",
                 (unsigned)s_path_bytes, (unsigned)bytes, (unsigned)LUME_CANVAS_PATH_BUDGET);
        heap_caps_free(lines);
        return;
    }
    s_path_lines[id][slot] = lines;
    s_path_count[id][slot] = count;
    s_path_bytes += bytes;
}
static void apply_canvas_path_draw(const lume_ui_msg_t *m)
{
    uint16_t id = m->node_id;
    if (id == 0 || id >= LUME_MAX_NODES || !s_canvas_pixels[id]) return;
    uint8_t slot = m->attr;
    if (slot >= LUME_CANVAS_PATHS || s_path_lines[id][slot] == NULL) return;
    int32_t dx = m->from, dy = m->to;
    const lume_canvas_line_t *line = s_path_lines[id][slot];
    static lume_raster_surf_t surf;     /* single reader: the LVGL task */
    surf.px = s_canvas_work[id];
    surf.w = s_canvas_w[id];
    surf.h = s_canvas_h[id];
    surf.stride = s_canvas_stride[id];
    for (uint16_t i = 0; i < s_path_count[id][slot]; i++, line++) {
        lume_raster_set_color(&surf, lv_color_to_u16(lv_color_hex(line->color)));
        canvas_line(&surf, line->x1 + dx, line->y1 + dy, line->x2 + dx, line->y2 + dy,
                    line->width);
    }
}

/* Publish a finished canvas frame: point lv_canvas at work and make that
 * buffer the display source. A full redraw swaps the two buffers (the app
 * repaints every pixel, so the old front is free to become the next work); a
 * dirty-rect invalidate copies just that rect onto the front image, keeping
 * everything outside the rect intact. */
static void canvas_publish(uint16_t id, const lume_ui_msg_t *m)
{
    lv_obj_t *obj = s_nodes[id];
    uint16_t *front = s_canvas_pixels[id], *work = s_canvas_work[id];
    int32_t w = s_canvas_w[id], h = s_canvas_h[id];
    if (!m->kind) {
        if (work != front) {
            lv_canvas_set_buffer(obj, work, w, h, LV_COLOR_FORMAT_RGB565);
            s_canvas_pixels[id] = work;
            s_canvas_work[id] = front;
        }
        lv_obj_invalidate(obj);
        return;
    }
    /* Dirty rect (canvas-local). */
    int32_t x = m->from, y = m->to;
    int32_t rw = (int32_t)m->duration_ms, rh = (int32_t)m->token;
    if (x < 0) { rw += x; x = 0; }
    if (y < 0) { rh += y; y = 0; }
    if (x + rw > w) rw = w - x;
    if (y + rh > h) rh = h - y;
    if (rw <= 0 || rh <= 0) return;
    if (work != front) {
        size_t stride = s_canvas_stride[id];           /* RGB565 pixels per row */
        for (int32_t row = 0; row < rh; row++) {
            memcpy(front + (size_t)(y + row) * stride + x,
                   work + (size_t)(y + row) * stride + x,
                   (size_t)rw * sizeof(uint16_t));
        }
    }
    lv_area_t bounds, area;
    lv_obj_update_layout(obj);
    lv_obj_get_coords(obj, &bounds);
    area.x1 = bounds.x1 + x; area.y1 = bounds.y1 + y;
    area.x2 = area.x1 + rw - 1; area.y2 = area.y1 + rh - 1;
    if (area.x1 < bounds.x1) area.x1 = bounds.x1;
    if (area.y1 < bounds.y1) area.y1 = bounds.y1;
    if (area.x2 > bounds.x2) area.x2 = bounds.x2;
    if (area.y2 > bounds.y2) area.y2 = bounds.y2;
    if (area.x1 <= area.x2 && area.y1 <= area.y2) lv_obj_invalidate_area(obj, &area);
}

/* r4 P2: same subtree walk as clear_subtree(), but recording the node ids
 * (caller must invoke BEFORE lv_obj_delete() frees the objects). Bounded by
 * the caller's table; deeper nodes beyond the cap are skipped (M1 UI trees
 * are tiny; a hard cap keeps the LVGL-task stack flat). */
static void collect_subtree_ids(lv_obj_t *obj, uint16_t *out, int *count,
                                int cap)
{
    if (obj == NULL || *count >= cap) {
        return;
    }
    uint32_t n = lv_obj_get_child_count(obj);
    for (uint32_t i = 0; i < n; i++) {
        collect_subtree_ids(lv_obj_get_child(obj, (int32_t)i), out, count, cap);
    }
    uint16_t id = (uint16_t)(uintptr_t)lv_obj_get_user_data(obj);
    if (id > 0 && id < LUME_MAX_NODES && *count < cap) {
        out[(*count)++] = id;
    }
}

static void apply_remove(const lume_ui_msg_t *m)
{
    lv_obj_t *obj = get_node(m->node_id);
    if (obj == NULL) {
        return;
    }
    /* r4 P2: collect the purged subtree's node ids BEFORE deletion (after
     * lv_obj_delete() the objects are freed and unreadable), then latch each
     * id into the engine's pending-removal bitmap. The latch covers ALL node
     * ids (full LUME_MAX_NODES) and can never drop a notice (no queue), so
     * every removed node gets its JS-side dispose. No JS runs here. */
    uint16_t purged[LUME_MAX_NODES];
    int n_purged = 0;
    collect_subtree_ids(obj, purged, &n_purged, LUME_MAX_NODES);

    clear_subtree(obj);   /* purge this node AND every descendant table entry */
    lv_obj_delete(obj);   /* deletes the whole LVGL subtree */
    release_dead_canvases();
    release_dead_images();
    ESP_LOGI(TAG, "remove id=%u (subtree purged, %d js owners)",
             (unsigned)m->node_id, n_purged);
    for (int i = 0; i < n_purged; i++) {
        lume_engine_mark_removed(purged[i]);
    }
}

/* LV_EVENT_CLICKED callback — runs on the LVGL task. Reverse channel: post
 * the node id back to the engine event queue through the registered sink. */
static void press_cb(lv_event_t *e)
{
    if (lv_event_get_code(e) != LV_EVENT_CLICKED) {
        return;
    }
    /* Nodes carry LV_OBJ_FLAG_EVENT_BUBBLE (for the screen-level gesture), so
     * a CLICKED on a child also arrives here when the parent has its own
     * onPress. onPress must mean "this exact node was tapped": ignore bubbled
     * copies, where the original target differs from the node handling it. */
    if (lv_event_get_target_obj(e) != lv_event_get_current_target_obj(e)) {
        return;
    }
    uint16_t node_id = (uint16_t)(uintptr_t)lv_event_get_user_data(e);
    ESP_LOGI(TAG, "LVGL CLICKED id=%u -> post to engine queue", (unsigned)node_id);
    if (s_press_sink != NULL) {
        s_press_sink(node_id);
    } else {
        ESP_LOGW(TAG, "press id=%u dropped: no engine sink", (unsigned)node_id);
    }
}

static void apply_set_press(const lume_ui_msg_t *m)
{
    lv_obj_t *obj = get_node(m->node_id);
    if (obj == NULL) {
        ESP_LOGW(TAG, "set-press: unknown node_id %u", (unsigned)m->node_id);
        return;
    }
    /* One-shot tap: CLICKED fires once per press/release. (PRESSING would
     * repeat continuously and would inflate a counter on every frame.) */
    lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(obj, press_cb, LV_EVENT_CLICKED,
                        (void *)(uintptr_t)m->node_id);
    ESP_LOGI(TAG, "press registered id=%u", (unsigned)m->node_id);
}

/* r21 gesture pointer stream. Reuse LVGL's object events for per-target
 * hit-testing (LV_EVENT_PRESSED/PRESSING/RELEASED are sent to the pressed
 * object; non-clickable children such as labels are skipped by hit-testing so
 * a card View receives them directly) and lv_indev_get_gesture_dir() for the
 * swipe direction. We forward a normalized DOWN/MOVE/UP/SWIPEDIR stream over
 * the same reverse queue (Queue B) the press path uses; all recognition lives
 * in the pure JS state machine (lume_scripts.c), NOT here.
 *
 * Scroll arbitration (M3 r19 List coexistence): LVGL sets
 * indev->pointer.scroll_obj once a drag is committed to scrolling and, on its
 * own, suppresses LV_EVENT_GESTURE/LONG_PRESSED/CLICKED while it is set
 * (lv_indev.c:1702 / 1352 / 1453). We extend the SAME rule to the PRESSING
 * stream. Two gates stop MOVE before a scroll can steal the drag:
 *   (a) scroll_obj already committed, and
 *   (b) PRE-COMMIT latch (r21 review fix): PRESSING is sent BEFORE
 *       lv_indev_scroll_handler within the same indev read
 *       (lv_indev.c:1332 vs 1339), so on the commit frame scroll_obj is still
 *       NULL and a naive check would leak exactly the MOVE that crosses the
 *       scroll limit (>12px cumulative displacement can start a pan).
 *       Therefore at DOWN we scan the ancestor chain for an ancestor that can
 *       actually scroll on some axis (scrollable + direction enabled + content
 *       beyond an edge, mirroring lv_indev_find_scroll_obj,
 *       lv_indev_scroll.c:267-...), and latch when the cumulative drag on such
 *       an axis exceeds LV_INDEV_DEF_SCROLL_LIMIT (10px, lv_indev.c:32) -- the
 *       same accumulation LVGL itself uses (scroll_sum += vect,
 *       lv_indev_scroll.c:285-286). Pan needs >12px, so a scrollable target
 *       can never start a pan before the scroll wins; a drag on an axis with
 *       no scroll candidate still pans freely (e.g. horizontal pan over a
 *       vertical List). */
#define GESTURE_ACTIVE        0x01
#define GESTURE_SCROLLED      0x02
#define GESTURE_VER_CAND      0x04  /* an ancestor can still scroll vertically */
#define GESTURE_HOR_CAND      0x08  /* an ancestor can still scroll horizontally */
#define GESTURE_SCROLL_LATCH_PX 10  /* LV_INDEV_DEF_SCROLL_LIMIT lv_indev.c:32 */
static uint8_t s_gesture_flags[LUME_MAX_NODES];
static lv_point_t s_gescroll_sum;     /* cumulative drag since DOWN, per press */

/* Scan the pressed object and its ancestors for live scroll candidates.
 * Mirrors lv_indev_find_scroll_obj's notion of "scrollable into a direction":
 * the SCROLLABLE flag, an enabled scroll direction, and content beyond an
 * edge (lv_obj_get_scroll_* offsets). Non-scrollable objs stay in the walk:
 * scroll chain flags default on, so the chain continues through them. */
static uint8_t gesture_scan_scroll_chain(lv_obj_t *obj)
{
    uint8_t cand = 0;
    for (lv_obj_t *o = obj; o != NULL; o = lv_obj_get_parent(o)) {
        if (!(cand & GESTURE_VER_CAND) &&
            lv_obj_has_flag(o, LV_OBJ_FLAG_SCROLLABLE) &&
            (lv_obj_get_scroll_dir(o) & (LV_DIR_TOP | LV_DIR_BOTTOM)) &&
            (lv_obj_get_scroll_top(o) > 0 || lv_obj_get_scroll_bottom(o) > 0))
            cand |= GESTURE_VER_CAND;
        if (!(cand & GESTURE_HOR_CAND) &&
            lv_obj_has_flag(o, LV_OBJ_FLAG_SCROLLABLE) &&
            (lv_obj_get_scroll_dir(o) & (LV_DIR_LEFT | LV_DIR_RIGHT)) &&
            (lv_obj_get_scroll_left(o) > 0 || lv_obj_get_scroll_right(o) > 0))
            cand |= GESTURE_HOR_CAND;
        if ((cand & (GESTURE_VER_CAND | GESTURE_HOR_CAND)) ==
            (GESTURE_VER_CAND | GESTURE_HOR_CAND)) break;
    }
    return cand;
}

static void gesture_obj_cb(lv_event_t *e)
{
    uint16_t id = (uint16_t)(uintptr_t)lv_event_get_user_data(e);
    if (!s_gesture_sink || id >= LUME_MAX_NODES) return;   /* id 0 = screen is valid */
    lv_indev_t *indev = lv_indev_active();
    lv_point_t p = {0, 0};
    if (indev) lv_indev_get_point(indev, &p);
    uint32_t t = lv_tick_get();
    uint32_t code = lv_event_get_code(e);
    if (id == 0 && s_screen_gesture) {
        /* Global swipe-up recognizer (prelude's "back to launcher"), evaluated
         * here on the raw press/release pair: the engine receives exactly ONE
         * event per completed gesture. Mirroring the raw DOWN/MOVE/UP stream
         * instead flooded the engine's gesture queue -- with events bubbling
         * to the screen, PRESSING fires every frame and the queue overflowed
         * (gesture drops), so no swipe ever reached the app. */
        if (code == LV_EVENT_PRESSED) {
            s_gedge_armed = p.y >= 480 - G_EDGE_ZONE_PX;
            if (s_gedge_armed)
                s_gesture_sink(0, 0, (int16_t)p.x, (int16_t)p.y, t, 0, 0);   /* DOWN */
        } else if (code == LV_EVENT_RELEASED) {
            /* Two records per gesture total. The prelude state machine judges
             * distance/velocity itself and reports the direction; its handler
             * filters for 'up'. A kind=3 (SWIPEDIR) record would NOT work:
             * __gestureStep treats it as a direction hint and returns an empty
             * event list, so no handler ever fired. */
            if (s_gedge_armed)
                s_gesture_sink(0, 2, (int16_t)p.x, (int16_t)p.y, t, 0, 0);   /* UP */
            s_gedge_armed = false;
        }
        return;   /* the screen does not feed the per-node state machine */
    }
    switch (code) {
        case LV_EVENT_PRESSED:
            s_gesture_flags[id] = GESTURE_ACTIVE |
                                  gesture_scan_scroll_chain(lv_event_get_target_obj(e));
            s_gescroll_sum.x = 0;
            s_gescroll_sum.y = 0;
            s_gesture_sink(id, 0, (int16_t)p.x, (int16_t)p.y, t, 0, 0);   /* DOWN */
            break;
        case LV_EVENT_PRESSING: {
            if (!(s_gesture_flags[id] & GESTURE_ACTIVE)) break;
            if ((s_gesture_flags[id] & GESTURE_SCROLLED) ||
                (indev && lv_indev_get_scroll_obj(indev) != NULL)) {
                s_gesture_flags[id] |= GESTURE_SCROLLED;   /* scroll wins: no MOVE */
                break;
            }
            /* Pre-commit latch (r21 review fix): on the frame the drag crosses
             * the scroll limit PRESSING has already run (lv_indev.c:1332)
             * before lv_indev_scroll_handler (:1339) sets scroll_obj, so that
             * MOVE would leak and could start a pan on a scrollable target.
             * Latch early using LVGL's own accumulation semantics: cumulative
             * drag (scroll_sum += vect, lv_indev_scroll.c:285-286) past
             * scroll_limit (10px) on an axis with a live scroll candidate.
             * Note scroll_sum is consumed by scroll_handler each read, so we
             * track our own accumulation from the per-read vect. */
            if (indev) {
                lv_point_t v;
                lv_indev_get_vect(indev, &v);
                s_gescroll_sum.x += v.x;
                s_gescroll_sum.y += v.y;
                uint8_t cand = s_gesture_flags[id];
                if (((cand & GESTURE_VER_CAND) &&
                     LV_ABS(s_gescroll_sum.y) > GESTURE_SCROLL_LATCH_PX) ||
                    ((cand & GESTURE_HOR_CAND) &&
                     LV_ABS(s_gescroll_sum.x) > GESTURE_SCROLL_LATCH_PX)) {
                    s_gesture_flags[id] |= GESTURE_SCROLLED;
                    break;
                }
            }
            s_gesture_sink(id, 1, (int16_t)p.x, (int16_t)p.y, t, 0, 0);   /* MOVE */
            break;
        }
        case LV_EVENT_GESTURE: {
            /* indev_gesture() only fires this when no scroll_obj is active
             * (lv_indev.c:1702), and only once per press (gesture_sent). */
            if (!(s_gesture_flags[id] & GESTURE_ACTIVE) ||
                (s_gesture_flags[id] & GESTURE_SCROLLED)) break;
            uint8_t dir = indev ? (uint8_t)lv_indev_get_gesture_dir(indev) : 0;
            s_gesture_sink(id, 3, (int16_t)p.x, (int16_t)p.y, t, dir, 0); /* SWIPEDIR */
            break;
        }
        case LV_EVENT_RELEASED: {
            uint8_t cancelled = (s_gesture_flags[id] & GESTURE_SCROLLED) ||
                                (indev && lv_indev_get_scroll_obj(indev) != NULL);
            s_gesture_sink(id, 2, (int16_t)p.x, (int16_t)p.y, t, 0, cancelled); /* UP */
            s_gesture_flags[id] = 0;
            break;
        }
        default:
            break;
    }
}

static void apply_set_gesture(const lume_ui_msg_t *m)
{
    /* node_id 0 is the active screen: the prelude registers one global
     * swipe-up listener there so every app gets "swipe up = home" for free. */
    lv_obj_t *obj = (m->node_id == 0) ? lv_screen_active() : get_node(m->node_id);
    if (obj == NULL) {
        ESP_LOGW(TAG, "set-gesture: unknown node_id %u", (unsigned)m->node_id);
        return;
    }
    lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    void *ud = (void *)(uintptr_t)m->node_id;
    if (m->node_id == 0) {
        /* The prelude re-registers on every runtime rebuild (each app start).
         * Drop the previous callbacks first: they point into a JS context that
         * no longer exists. */
        lv_obj_remove_event_cb(obj, gesture_obj_cb);
        /* A scrollable root would make every drag a scroll and cancel the
         * gesture before it reaches the recognizer. */
        lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
        s_screen_gesture = true;
        ESP_LOGI(TAG, "global gesture registered on the screen (node 0)");
    }
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_PRESSED, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_PRESSING, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_RELEASED, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_GESTURE, ud);
    s_gesture_flags[m->node_id] = 0;
    ESP_LOGI(TAG, "gesture registered id=%u", (unsigned)m->node_id);
}

/* ------------------------------------------------------------------ */
/* r46 Task C: crossfade-through-black app-switch transition (C1).      */
/* All of this runs on the LVGL task (drain timer / lv_anim / lv_timer). */
/* The engine task only posts COVER then FIRSTFRAME into Queue A and    */
/* waits for the COVERED reverse event on Queue B -- no new lock.        */
/*   COVER      -> build a top-layer black overlay, fade opacity 0->255  */
/*   fade done  -> COVERED event + start a 500 ms reveal fallback timer  */
/*   FIRSTFRAME -> reveal (fade 255->0, then delete the overlay)         */
/*   fallback   -> reveal anyway if FIRSTFRAME never arrived             */
/* The overlay is a clickable full-screen object on lv_layer_top(), so   */
/* touch during the whole transition is its hit target and never reaches */
/* the app UI underneath (which is being torn down). It is NOT a child of */
/* the active screen, so apply_reset()/RESET does not delete it.         */
/* When LUME_APP_TRANSITION_DISABLE=y none of this is compiled and the    */
/* switch behaves exactly like pre-r46 (bare synchronous RESET).         */
/* ------------------------------------------------------------------ */
#if !CONFIG_LUME_APP_TRANSITION_DISABLE

static lv_obj_t   *s_trans_overlay;      /* top-layer black cover, NULL = idle */
static lv_timer_t *s_trans_fallback;     /* 500 ms reveal fallback (one-shot) */
static lume_transition_sink_fn s_transition_sink;

static void trans_fallback_cb(lv_timer_t *t);
static void transition_reveal(void);

/* No-op input consumer: the clickable overlay is the LVGL hit target, so
 * presses/clicks never dispatch to the engine for the UI being torn down. */
static void trans_input_cb(lv_event_t *e)
{
    (void)e;
}

static void trans_opa_exec(void *var, int32_t v)
{
    lv_obj_set_style_opa((lv_obj_t *)var, (lv_opa_t)v, 0);
}

static void transition_on_covered(void)
{
    if (s_transition_sink) {
        s_transition_sink();          /* -> LUME_EVT_TRANSITION_COVERED */
    }
    if (s_trans_fallback) {
        lv_timer_delete(s_trans_fallback);
    }
    s_trans_fallback = lv_timer_create(trans_fallback_cb, 500, NULL);
    lv_timer_set_repeat_count(s_trans_fallback, 1);
    ESP_LOGI(TAG, "transition: covered (fade-in done)");
}

static void trans_cover_completed(lv_anim_t *a)
{
    (void)a;
    transition_on_covered();
}

static void trans_reveal_completed(lv_anim_t *a)
{
    lv_obj_t *o = (lv_obj_t *)lv_anim_get_user_data(a);
    if (o != NULL) {
        lv_obj_delete(o);
    }
    if (s_trans_overlay == o) {
        s_trans_overlay = NULL;
    }
    ESP_LOGI(TAG, "transition: revealed (overlay removed)");
}

static void transition_reveal(void)
{
    if (s_trans_fallback) {
        lv_timer_delete(s_trans_fallback);
        s_trans_fallback = NULL;
    }
    lv_obj_t *o = s_trans_overlay;
    if (o == NULL) {
        return;                       /* idempotent: no active overlay */
    }
    /* Cancel any in-flight fade so a back-to-back COVER can re-cover the
     * same overlay without a flash. */
    lv_anim_delete(o, trans_opa_exec);
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, o);
    lv_anim_set_exec_cb(&a, trans_opa_exec);
    lv_anim_set_values(&a, (int32_t)lv_obj_get_style_opa(o, 0), LV_OPA_TRANSP);
    lv_anim_set_duration(&a, CONFIG_LUME_APP_TRANSITION_MS);
    lv_anim_set_user_data(&a, o);
    lv_anim_set_completed_cb(&a, trans_reveal_completed);
    lv_anim_start(&a);
    /* s_trans_overlay stays set until the fade-out completes so a new COVER
     * can cancel and re-cover the same object. */
}

static void trans_fallback_cb(lv_timer_t *t)
{
    (void)t;
    /* One-shot timer (repeat_count 1) is auto-deleted by LVGL. */
    s_trans_fallback = NULL;
    if (s_trans_overlay != NULL) {
        ESP_LOGW(TAG, "transition: 500ms first-frame fallback -> reveal");
        transition_reveal();
    }
}

static void transition_start_cover(void)
{
    if (s_trans_fallback) {
        lv_timer_delete(s_trans_fallback);
        s_trans_fallback = NULL;
    }
    if (s_trans_overlay != NULL) {
        /* Back-to-back switch: cancel the previous fade (in or out) and
         * re-cover the same overlay from its current opacity. */
        lv_anim_delete(s_trans_overlay, trans_opa_exec);
    } else {
        lv_obj_t *o = lv_obj_create(lv_layer_top());
        if (o == NULL) {
            ESP_LOGE(TAG, "transition: overlay create failed");
            return;                   /* degrade to the bare (blank) switch */
        }
        lv_obj_remove_style_all(o);
        lv_obj_set_size(o, LUME_LCD_H_RES, LUME_LCD_V_RES);
        lv_obj_set_pos(o, 0, 0);
        lv_obj_set_style_bg_color(o, lv_color_black(), 0);
        lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(o, 0, 0);
        lv_obj_set_style_border_width(o, 0, 0);
        lv_obj_add_flag(o, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(o, trans_input_cb, LV_EVENT_PRESSED, NULL);
        lv_obj_add_event_cb(o, trans_input_cb, LV_EVENT_RELEASED, NULL);
        lv_obj_add_event_cb(o, trans_input_cb, LV_EVENT_CLICKED, NULL);
        lv_obj_set_style_opa(o, LV_OPA_TRANSP, 0);
        s_trans_overlay = o;
        ESP_LOGI(TAG, "transition: overlay created (%dx%d)",
                 LUME_LCD_H_RES, LUME_LCD_V_RES);
    }
    int32_t from = (int32_t)lv_obj_get_style_opa(s_trans_overlay, 0);
    if (from >= LV_OPA_COVER) {
        /* Already opaque (a reveal was in progress): signal immediately. */
        transition_on_covered();
        return;
    }
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, s_trans_overlay);
    lv_anim_set_exec_cb(&a, trans_opa_exec);
    lv_anim_set_values(&a, from, (int32_t)LV_OPA_COVER);
    lv_anim_set_duration(&a, CONFIG_LUME_APP_TRANSITION_MS);
    lv_anim_set_completed_cb(&a, trans_cover_completed);
    lv_anim_start(&a);
}

void lume_ui_bridge_set_transition_sink(lume_transition_sink_fn fn)
{
    s_transition_sink = fn;
}
#else
/* Transition disabled: keep the symbol linkable, do nothing. */
void lume_ui_bridge_set_transition_sink(lume_transition_sink_fn fn)
{
    (void)fn;
}
#endif

void lume_ui_bridge_drain(void)
{
#if CONFIG_LUME_PERF_PROFILE
    int64_t drain_start = lume_perf_now();
#endif
    lume_ui_msg_t m;
    while (s_ui_queue != NULL &&
           xQueueReceive(s_ui_queue, &m, 0) == pdTRUE) {
        /* Use the explicit UTF-8 byte count to terminate either payload.
         * The sender allocated text_len+1 bytes and Queue A owns the copy. */
        if (m.text_len > LUME_TEXT_LIMIT ||
            (m.text_heap == NULL && m.text_len >= LUME_TEXT_MAX)) {
            ESP_LOGE(TAG, "drain: invalid text length %u", (unsigned)m.text_len);
            heap_caps_free(m.text_heap);
            if (m.op == LUME_OP_CANVAS_BATCH) heap_caps_free(m.image_pixels);
            continue;
        }
        if (m.text_heap) m.text_heap[m.text_len] = '\0';
        else m.text[m.text_len] = '\0';
        switch (m.op) {
            case LUME_OP_RESET:     apply_reset();       break;
            case LUME_OP_CREATE:    apply_create(&m);    break;
            case LUME_OP_SET_ATTR:  apply_set_attr(&m);  break;
            case LUME_OP_REMOVE:    apply_remove(&m);    break;
            case LUME_OP_SET_PRESS: apply_set_press(&m); break;
            case LUME_OP_SET_GESTURE: apply_set_gesture(&m); break;
            case LUME_OP_ANIMATE: apply_animate(&m); break;
            case LUME_OP_ANIMATE_CANCEL: cancel_anim(m.node_id, m.attr); break;
            case LUME_OP_CANVAS_DRAW: apply_canvas_draw(&m); break;
            case LUME_OP_RAYCAST_RENDER: {
                lume_raycast_frame_t *frame = (lume_raycast_frame_t *)m.image_pixels;
                if (frame && m.node_id > 0 && m.node_id < LUME_MAX_NODES &&
                    s_canvas_work[m.node_id] && s_nodes[m.node_id]) {
                    uint16_t id = m.node_id;
                    frame->pixels = s_canvas_work[id];
                    frame->width = s_canvas_w[id];
                    frame->height = s_canvas_h[id];
                    frame->stride = s_canvas_stride[id];
                    /* r80 480x460 profile: q=4 is the first measured tier
                     * with margin under the 20 ms core budget. */
                    static int maze_quality = 4;
                    frame->quality = maze_quality;
                    int64_t start = esp_timer_get_time();
                    lume_raycast_render(frame);
                    int64_t elapsed = esp_timer_get_time() - start;
                    if (elapsed > 20000 && maze_quality < 4) maze_quality *= 2;
                    static int64_t last_maze_log;
                    if (esp_timer_get_time() - last_maze_log >= 1000000) {
                        last_maze_log = esp_timer_get_time();
                        float ms = (float)elapsed / 1000.0f;
                        ESP_LOGI(TAG, "MAZE FRAME %.2fms %.1ffps hp=%d q=%d", (double)ms,
                                 (double)(ms > 0 ? 1000.0f / ms : 0), frame->hp, frame->quality);
                    }
                }
                free(frame);
                break;
            }
            case LUME_OP_RAYCAST_BARRIER:
                if (m.image_pixels) xSemaphoreGive((SemaphoreHandle_t)m.image_pixels);
                break;
            case LUME_OP_CANVAS_BATCH:
                if (m.image_pixels && m.image_w <= LUME_CANVAS_BATCH_MAX &&
                    m.node_id > 0 && m.node_id < LUME_MAX_NODES && s_canvas_pixels[m.node_id]) {
                    const lume_canvas_line_t *line = (const lume_canvas_line_t *)m.image_pixels;
                    static lume_raster_surf_t surf; /* single reader: LVGL task */
                    surf.px = s_canvas_work[m.node_id];
                    surf.w = s_canvas_w[m.node_id];
                    surf.h = s_canvas_h[m.node_id];
                    surf.stride = s_canvas_stride[m.node_id];
                    for (uint8_t i = 0; i < m.image_w; i++, line++) {
                        lume_raster_set_color(&surf, lv_color_to_u16(lv_color_hex(line->color)));
                        canvas_line(&surf, line->x1, line->y1, line->x2, line->y2,
                                    line->width);
                    }
                }
                break;
            case LUME_OP_CANVAS_PATH_DEFINE: apply_canvas_path_define(&m); break;
            case LUME_OP_CANVAS_PATH_DRAW: apply_canvas_path_draw(&m); break;
            case LUME_OP_IMAGE_SOURCE: apply_image_source(&m); break;
            case LUME_OP_CANVAS_INVALIDATE:
                /* Frame complete: publish the finished image. */
                if (m.node_id < LUME_MAX_NODES && s_canvas_pixels[m.node_id] &&
                    s_nodes[m.node_id] != NULL) {
                    canvas_publish(m.node_id, &m);
                }
                break;
            case LUME_OP_FIRSTFRAME:
                /* r46 Task A: the engine posts this AFTER all initial UI
                 * messages, so by now the new app's first frame is applied.
                 * token carries the app-eval-done emulated timestamp; report
                 * the LVGL-side first-frame drain latency. */
                lume_perf_switch_firstframe((int64_t)m.token);
#if !CONFIG_LUME_APP_TRANSITION_DISABLE
                /* r46 Task C: first frame is up -> fade the black overlay out
                 * and reveal the new app (no-op when no overlay is active). */
                transition_reveal();
#endif
                break;
#if !CONFIG_LUME_APP_TRANSITION_DISABLE
            case LUME_OP_TRANSITION_COVER:
                transition_start_cover();
                break;
#endif
            default:
                ESP_LOGW(TAG, "drain: unknown op %u", (unsigned)m.op);
                break;
        }
        heap_caps_free(m.text_heap);
        if (m.op == LUME_OP_CANVAS_BATCH) heap_caps_free(m.image_pixels);
    }
#if CONFIG_LUME_PERF_PROFILE
    lume_perf_add(LUME_PERF_DRAIN, lume_perf_now() - drain_start);
#endif
}

static void drain_timer_cb(lv_timer_t *timer)
{
    (void)timer;
    /* Runs from lv_timer_handler() on the LVGL task. */
    lume_ui_bridge_drain();
}

/* ------------------------------------------------------------------ */
/* Cross-thread entry points                                          */
/* ------------------------------------------------------------------ */

void lume_ui_bridge_set_anim_sink(lume_anim_sink_fn fn)
{
    s_anim_sink = fn;
}

void lume_ui_bridge_set_press_sink(lume_press_sink_fn fn)
{
    s_press_sink = fn;
}

void lume_ui_bridge_set_scroll_sink(lume_scroll_sink_fn fn)
{
    s_scroll_sink = fn;
}

void lume_ui_bridge_set_gesture_sink(lume_gesture_sink_fn fn)
{
    s_gesture_sink = fn;
}

int lume_ui_bridge_post(const lume_ui_msg_t *msg)
{
    if (s_ui_queue == NULL) {
        return -1;
    }
    /* Queue A is drained by the LVGL task's timer. On a transient full queue,
     * retry a bounded number of times; each attempt blocks briefly so the
     * consumer can free a slot. Dropping the message after retries lets JS
     * state diverge from the screen, so log it loudly. M1 accepts the log-only
     * policy (no rollback/resync); full JS<->UI recovery is the M3 cut. */
    for (int attempt = 0; attempt < LUME_POST_MAX_ATTEMPTS; attempt++) {
        if (xQueueSend(s_ui_queue, msg, pdMS_TO_TICKS(2)) == pdTRUE) {
            return 0;
        }
    }
    ESP_LOGE(TAG,
             "post: ui queue full after %d attempts (op=%u id=%u); "
             "JS/UI state may diverge (M1 log-only, resync in M3)",
             LUME_POST_MAX_ATTEMPTS, (unsigned)msg->op, (unsigned)msg->node_id);
    return -1;
}

void lume_ui_bridge_init(void)
{
    if (s_ui_queue != NULL) {
        return;   /* idempotent */
    }
    s_ui_queue = xQueueCreate(UI_QUEUE_LEN, sizeof(lume_ui_msg_t));
    if (s_ui_queue == NULL) {
        ESP_LOGE(TAG, "init: ui queue create failed (OOM)");
        abort();
    }
    memset(s_nodes, 0, sizeof(s_nodes));
    memset(s_kinds, 0, sizeof(s_kinds));

    /* Called from board init (main task) before the LVGL task is created:
     * lv_timer_create() has no concurrent lv_timer_handler() to race with.
     * The timer callback is the drain point inside the lv_timer_handler loop. */
    lv_timer_t *timer = lv_timer_create(drain_timer_cb, DRAIN_PERIOD_MS, NULL);
    if (timer == NULL) {
        ESP_LOGE(TAG, "init: drain timer create failed (OOM)");
        abort();
    }
    ESP_LOGI(TAG, "init: queue=%u msgs, drain timer=%ums",
             UI_QUEUE_LEN, DRAIN_PERIOD_MS);
}
