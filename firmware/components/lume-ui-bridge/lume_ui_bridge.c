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
#include "lvgl.h"
#include "lume_ui_bridge.h"
#include "lume_engine.h"     /* r4 P2: lume_engine_notify_removed() */

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
static lume_press_sink_fn s_press_sink;           /* set once by engine task */

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

/* ------------------------------------------------------------------ */
/* Queue A apply functions — LVGL task context only                    */
/* ------------------------------------------------------------------ */

static void apply_create(const lume_ui_msg_t *m)
{
    if (m->node_id == 0 || m->node_id >= LUME_MAX_NODES) {
        ESP_LOGE(TAG, "create: invalid node_id %u", (unsigned)m->node_id);
        return;
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
        default:
            ESP_LOGE(TAG, "create: unknown kind %u", (unsigned)m->kind);
            return;
    }

    s_nodes[m->node_id] = obj;
    s_kinds[m->node_id] = m->kind;
    s_flow[m->node_id] = LUME_FLEX_ROW;
    s_main[m->node_id] = LUME_FLEX_START;
    s_cross[m->node_id] = LUME_FLEX_START;
    s_explicit_width[m->node_id] = 0;
    s_explicit_height[m->node_id] = 0;
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
    switch (m->attr) {
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
        s_nodes[id] = NULL;
        s_kinds[id] = 0;
        s_explicit_width[id] = s_explicit_height[id] = 0;
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

void lume_ui_bridge_drain(void)
{
    lume_ui_msg_t m;
    while (s_ui_queue != NULL &&
           xQueueReceive(s_ui_queue, &m, 0) == pdTRUE) {
        /* Defensive hard truncate: text is always a bounded 64-byte field. */
        m.text[LUME_TEXT_MAX - 1] = '\0';
        switch (m.op) {
            case LUME_OP_CREATE:    apply_create(&m);    break;
            case LUME_OP_SET_ATTR:  apply_set_attr(&m);  break;
            case LUME_OP_REMOVE:    apply_remove(&m);    break;
            case LUME_OP_SET_PRESS: apply_set_press(&m); break;
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

void lume_ui_bridge_set_press_sink(lume_press_sink_fn fn)
{
    s_press_sink = fn;
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
