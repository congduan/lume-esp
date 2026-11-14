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
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lvgl.h"
#include "lume_ui_bridge.h"
#include "lume_engine.h"     /* r4 P2: lume_engine_notify_removed() */

_Static_assert(sizeof(lume_ui_msg_t) <= 112, "UI queue record size budget");

static const char *TAG = "lume-ui-bridge";
#define UI_QUEUE_LEN 32
#define DRAIN_PERIOD_MS 5
#define LUME_POST_MAX_ATTEMPTS 8   /* finite retries when Queue A is full */

static QueueHandle_t s_ui_queue;                  /* Queue A */
static lv_obj_t *s_nodes[LUME_MAX_NODES];         /* id -> lv_obj* (LVGL task) */
static uint8_t s_kinds[LUME_MAX_NODES];           /* id -> kind   (LVGL task) */
static uint8_t s_flow[LUME_MAX_NODES];            /* wire flow, for stretch axis */
static uint8_t s_main[LUME_MAX_NODES], s_cross[LUME_MAX_NODES];
static uint8_t s_explicit_width[LUME_MAX_NODES], s_explicit_height[LUME_MAX_NODES];
static uint16_t *s_canvas_pixels[LUME_MAX_NODES];
static uint8_t *s_image_pixels[LUME_MAX_NODES];
static lv_image_dsc_t s_image_dsc[LUME_MAX_NODES];
static uint16_t s_canvas_w[LUME_MAX_NODES], s_canvas_h[LUME_MAX_NODES];
static uint16_t s_canvas_stride[LUME_MAX_NODES]; /* RGB565 pixels per row */
static size_t s_canvas_bytes;
#define CANVAS_BUDGET (480u * 480u * 2u)
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

static lv_obj_t *get_node(uint16_t id)
{
    if (id == 0 || id >= LUME_MAX_NODES) {
        return NULL;
    }
    return s_nodes[id];
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
    lv_obj_set_flex_align(obj, map_flex_align(s_main[id]),
                          s_cross[id] == LUME_FLEX_CROSS_STRETCH ? LV_FLEX_ALIGN_START :
                          map_flex_align(s_cross[id]), LV_FLEX_ALIGN_START);
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
    ESP_LOGI(TAG, "app UI reset complete");
}

static void apply_create(const lume_ui_msg_t *m)
{
    if (m->node_id == 0 || m->node_id >= LUME_MAX_NODES) {
        ESP_LOGE(TAG, "create: invalid node_id %u", (unsigned)m->node_id);
        return;
    }
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
        parent = lv_screen_active();
    }

    lv_obj_t *obj = NULL;
    switch (m->kind) {
        case LUME_NODE_VIEW:
            obj = lv_obj_create(parent);
            break;
        case LUME_NODE_TEXT:
            obj = lv_label_create(parent);
            /* Centered text uses LVGL's default font. Typography (big font)
             * is intentionally deferred: M1 real-device visuals are out of
             * scope, and referencing Montserrat-32 pulls ~45KB of glyph data. */
            lv_obj_set_style_text_color(obj, lv_color_white(), 0);
            break;
        case LUME_NODE_BUTTON: {
            obj = lv_button_create(parent);
            lv_obj_t *label = lv_label_create(obj);
            lv_label_set_text(label, "");
            lv_obj_set_style_text_color(label, lv_color_white(), 0);
            lv_obj_center(label);
            break;
        }
        case LUME_NODE_CANVAS: {
            int32_t w = m->from, h = m->to;
            if (w < 1 || h < 1 || w > 480 || h > 480 ||
                (size_t)w * h * 2u > CANVAS_BUDGET - s_canvas_bytes) {
                ESP_LOGE(TAG, "canvas id=%u invalid dimensions/budget %ldx%ld", m->node_id, (long)w, (long)h);
                return;
            }
            size_t bytes = (size_t)lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) * h;
            if (bytes > CANVAS_BUDGET - s_canvas_bytes) return;
            uint16_t *pixels = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
            if (!pixels) { ESP_LOGE(TAG, "canvas PSRAM allocation failed (%u)", (unsigned)bytes); return; }
            memset(pixels, 0, bytes);
            obj = lv_canvas_create(parent);
            lv_canvas_set_buffer(obj, pixels, w, h, LV_COLOR_FORMAT_RGB565);
            lv_obj_set_size(obj, w, h);
            s_canvas_pixels[m->node_id] = pixels;
            s_canvas_w[m->node_id] = w;
            s_canvas_h[m->node_id] = h;
            s_canvas_stride[m->node_id] = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) / 2u;
            s_canvas_bytes += bytes;
            break;
        }
        case LUME_NODE_IMAGE:
            obj = lv_image_create(parent);
            lv_image_set_inner_align(obj, LV_IMAGE_ALIGN_CONTAIN);
            break;
        default:
            ESP_LOGE(TAG, "create: unknown kind %u", (unsigned)m->kind);
            return;
    }

    s_nodes[m->node_id] = obj;
    for (int i = 0; i < ANIM_ATTRS; i++) cancel_anim(m->node_id, (uint8_t)(i == 0 ? LUME_ATTR_X : i == 1 ? LUME_ATTR_Y : i == 2 ? LUME_ATTR_WIDTH : i == 3 ? LUME_ATTR_HEIGHT : LUME_ATTR_OPACITY));
    s_kinds[m->node_id] = m->kind;
    s_flow[m->node_id] = LUME_FLEX_ROW;
    s_main[m->node_id] = LUME_FLEX_START;
    s_cross[m->node_id] = LUME_FLEX_START;
    s_explicit_width[m->node_id] = 0;
    s_explicit_height[m->node_id] = 0;
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
        case LUME_ATTR_TEXT: {
            /* A BUTTON renders its text in a child label; TEXT is the label. */
            lv_obj_t *target = obj;
            if (s_kinds[m->node_id] == LUME_NODE_BUTTON) {
                lv_obj_t *label = lv_obj_get_child(obj, 0);
                if (label != NULL) {
                    target = label;
                }
            }
            lv_label_set_text(target, m->text);
            break;
        }
        case LUME_ATTR_BG_COLOR:
            lv_obj_set_style_bg_color(obj, lv_color_hex((uint32_t)m->value), 0);
            lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
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
            lv_obj_align(obj, map_align(m->value), 0, 0);
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
    }
}
static void release_dead_canvases(void)
{
    for (uint16_t id = 1; id < LUME_MAX_NODES; id++) {
        if (s_canvas_pixels[id] && !s_nodes[id]) {
            s_canvas_bytes -= (size_t)s_canvas_stride[id] * 2u * s_canvas_h[id];
            heap_caps_free(s_canvas_pixels[id]);
            s_canvas_pixels[id] = NULL;
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

/* Raster commands are applied only by the LVGL timer. The buffer belongs to
 * the canvas and is never shared with the engine; one final invalidate per
 * onDraw run avoids lv_canvas_set_px's per-pixel invalidation. */
static void canvas_px(uint16_t id, int32_t x, int32_t y, uint16_t color)
{
    if (x >= 0 && y >= 0 && x < s_canvas_w[id] && y < s_canvas_h[id])
        s_canvas_pixels[id][(size_t)y * s_canvas_stride[id] + x] = color;
}
static void canvas_disc(uint16_t id, int32_t x, int32_t y, int r, uint16_t c)
{
    for (int dy = -r; dy <= r; dy++) for (int dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r) canvas_px(id, x + dx, y + dy, c);
}
static void canvas_brush(uint16_t id, int32_t x, int32_t y, int width, uint16_t c)
{
    for (int dy = -(width - 1) / 2; dy <= width / 2; dy++)
        for (int dx = -(width - 1) / 2; dx <= width / 2; dx++)
            canvas_px(id, x + dx, y + dy, c);
}
static void apply_canvas_draw(const lume_ui_msg_t *m)
{
    uint16_t id = m->node_id;
    if (id == 0 || id >= LUME_MAX_NODES || !s_canvas_pixels[id]) return;
    uint16_t c = lv_color_to_u16(lv_color_hex((uint32_t)m->value));
    int32_t x = m->from, y = m->to, a = (int32_t)m->duration_ms, b = (int32_t)m->token;
    switch (m->attr) {
        case LUME_DRAW_CLEAR:
            for (int32_t yy = 0; yy < s_canvas_h[id]; yy++)
                for (int32_t xx = 0; xx < s_canvas_w[id]; xx++) canvas_px(id, xx, yy, c);
            break;
        case LUME_DRAW_RECT:
            for (int32_t yy = y < 0 ? 0 : y; yy < y + b && yy < s_canvas_h[id]; yy++)
                for (int32_t xx = x < 0 ? 0 : x; xx < x + a && xx < s_canvas_w[id]; xx++) canvas_px(id, xx, yy, c);
            break;
        case LUME_DRAW_LINE: {
            int32_t dx = abs(a - x), sx = x < a ? 1 : -1;
            int32_t dy = -abs(b - y), sy = y < b ? 1 : -1, err = dx + dy;
            for (;;) {
                canvas_brush(id, x, y, m->draw_width, c);
                if (x == a && y == b) break;
                int32_t e = 2 * err;
                if (e >= dy) { err += dy; x += sx; }
                if (e <= dx) { err += dx; y += sy; }
            }
            break;
        }
        case LUME_DRAW_CIRCLE: {
            int r = a;
            int32_t xx = r, yy = 0, err = 1 - r;
            while (xx >= yy) {
                canvas_disc(id,x+xx,y+yy,(m->draw_width-1)/2,c); canvas_disc(id,x+yy,y+xx,(m->draw_width-1)/2,c);
                canvas_disc(id,x-yy,y+xx,(m->draw_width-1)/2,c); canvas_disc(id,x-xx,y+yy,(m->draw_width-1)/2,c);
                canvas_disc(id,x-xx,y-yy,(m->draw_width-1)/2,c); canvas_disc(id,x-yy,y-xx,(m->draw_width-1)/2,c);
                canvas_disc(id,x+yy,y-xx,(m->draw_width-1)/2,c); canvas_disc(id,x+xx,y-yy,(m->draw_width-1)/2,c);
                yy++; if (err < 0) err += 2*yy+1; else { xx--; err += 2*(yy-xx)+1; }
            }
            break;
        }
        case LUME_DRAW_TEXT: {
            lv_layer_t layer;
            lv_canvas_init_layer(s_nodes[id], &layer);
            lv_draw_label_dsc_t dsc;
            lv_draw_label_dsc_init(&dsc);
            dsc.text = m->text;
            dsc.color = lv_color_hex((uint32_t)m->value);
            lv_area_t area = {x, y, s_canvas_w[id]-1, s_canvas_h[id]-1};
            lv_draw_label(&layer, &dsc, &area);
            lv_canvas_finish_layer(s_nodes[id], &layer);
            break;
        }
    }
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
    if (!s_gesture_sink || id == 0 || id >= LUME_MAX_NODES) return;
    lv_indev_t *indev = lv_indev_active();
    lv_point_t p = {0, 0};
    if (indev) lv_indev_get_point(indev, &p);
    uint32_t t = lv_tick_get();
    switch (lv_event_get_code(e)) {
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
    lv_obj_t *obj = get_node(m->node_id);
    if (obj == NULL) {
        ESP_LOGW(TAG, "set-gesture: unknown node_id %u", (unsigned)m->node_id);
        return;
    }
    void *ud = (void *)(uintptr_t)m->node_id;
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_PRESSED, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_PRESSING, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_RELEASED, ud);
    lv_obj_add_event_cb(obj, gesture_obj_cb, LV_EVENT_GESTURE, ud);
    s_gesture_flags[m->node_id] = 0;
    ESP_LOGI(TAG, "gesture registered id=%u", (unsigned)m->node_id);
}

void lume_ui_bridge_drain(void)
{
    lume_ui_msg_t m;
    while (s_ui_queue != NULL &&
           xQueueReceive(s_ui_queue, &m, 0) == pdTRUE) {
        /* Defensive hard truncate: text is always a bounded 64-byte field. */
        m.text[LUME_TEXT_MAX - 1] = '\0';
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
            case LUME_OP_IMAGE_SOURCE: apply_image_source(&m); break;
            case LUME_OP_CANVAS_INVALIDATE:
                if (m.node_id < LUME_MAX_NODES && s_canvas_pixels[m.node_id]) lv_obj_invalidate(s_nodes[m.node_id]);
                break;
            default:
                ESP_LOGW(TAG, "drain: unknown op %u", (unsigned)m.op);
                break;
        }
    }
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
