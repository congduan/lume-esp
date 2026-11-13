/**
 * Lume engine: resident QuickJS-NG runtime on a dedicated task (M1).
 *
 * Thread discipline:
 *  - JS lives ONLY on the engine task (pinned to core 1). The runtime, context,
 *    eval and every JS callback execute here and nowhere else.
 *  - Native JS bindings (global `lume` object) never call lv_*. They build a
 *    fixed-size lume_ui_msg_t and post it to the ui-bridge Queue A.
 *  - Press events arrive on Queue B (s_evt_queue) from the LVGL task; the
 *    engine loop dispatches them to the global JS function
 *    __lume_dispatchPress(nodeId) defined by the prelude.
 *
 * Heap: JS allocations are routed to PSRAM via JS_NewRuntime2()'s
 * JSMallocFunctions (QuickJS-NG has no JS_SetMemoryFunctions). The JS heap is
 * capped at ~8MB with JS_SetMemoryLimit(); usage accounting relies on
 * js_malloc_usable_size -> heap_caps_get_allocated_size().
 */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lume_engine.h"
#include "lume_ui_bridge.h"
#include "lume_scripts.h"
#include "quickjs.h"

static const char *TAG = "lume-engine";
#define LUME_JS_HEAP_LIMIT (8u * 1024u * 1024u)
#define ENGINE_TASK_STACK 24576
#define EVT_QUEUE_LEN 16

static QueueHandle_t s_evt_queue;   /* Queue B: LVGL -> engine */
static JSRuntime *s_rt;
static JSContext *s_ctx;
static uint16_t s_next_node_id;     /* engine-task-only id allocator */

/* ------------------------------------------------------------------ */
/* PSRAM-backed allocator for QuickJS-NG (JSMallocFunctions)            */
/* ------------------------------------------------------------------ */
static void *js_calloc_psram(void *opaque, size_t count, size_t size)
{
    (void)opaque;
    return heap_caps_calloc(count, size, MALLOC_CAP_SPIRAM);
}
static void *js_malloc_psram(void *opaque, size_t size)
{
    (void)opaque;
    return heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
}
static void js_free_psram(void *opaque, void *ptr)
{
    (void)opaque;
    heap_caps_free(ptr);
}
static void *js_realloc_psram(void *opaque, void *ptr, size_t size)
{
    (void)opaque;
    return heap_caps_realloc(ptr, size, MALLOC_CAP_SPIRAM);
}
static size_t js_usable_size_psram(const void *ptr)
{
    /* Feeds JS_SetMemoryLimit() accounting; returns 0 for a NULL/unknown ptr. */
    if (ptr == NULL) {
        return 0;
    }
    return heap_caps_get_allocated_size((void *)ptr);
}
static const JSMallocFunctions s_psram_mf = {
    js_calloc_psram,
    js_malloc_psram,
    js_free_psram,
    js_realloc_psram,
    js_usable_size_psram,
};

/* ------------------------------------------------------------------ */
/* Exception reporting (never silently swallowed)                      */
/* ------------------------------------------------------------------ */
static void dump_js_exception(JSContext *ctx, const char *where)
{
    JSValue exc = JS_GetException(ctx);
    const char *msg = JS_ToCString(ctx, exc);
    ESP_LOGE(TAG, "JS exception [%s]: %s", where, msg ? msg : "(unknown)");
    if (msg) {
        JS_FreeCString(ctx, msg);
    }
    /* Only Error-like objects carry a stack; guard so a primitive throw or a
     * failed lookup cannot leave a second pending exception behind. */
    if (JS_IsObject(exc)) {
        JSValue stack = JS_GetPropertyStr(ctx, exc, "stack");
        if (JS_IsString(stack)) {
            const char *s = JS_ToCString(ctx, stack);
            if (s) {
                ESP_LOGE(TAG, "JS stack [%s]: %s", where, s);
                JS_FreeCString(ctx, s);
            }
        }
        JS_FreeValue(ctx, stack);
    }
    JS_FreeValue(ctx, exc);
}

static int eval_script(JSContext *ctx, const char *src, const char *name)
{
    JSValue v = JS_Eval(ctx, src, strlen(src), name, JS_EVAL_TYPE_GLOBAL);
    int ok = 1;
    if (JS_IsException(v)) {
        dump_js_exception(ctx, name);
        ok = 0;
    }
    JS_FreeValue(ctx, v);
    return ok;
}

/* ------------------------------------------------------------------ */
/* Native JS bindings: global `lume` object (engine task only)         */
/* Each binding posts a fixed-size message; no lv_* anywhere here.     */
/* ------------------------------------------------------------------ */
static void msg_init(lume_ui_msg_t *m)
{
    memset(m, 0, sizeof(*m));
}

static JSValue js_create_node(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t kind, parent;
    if (argc < 2 || JS_ToInt32(ctx, &kind, argv[0]) < 0 ||
        JS_ToInt32(ctx, &parent, argv[1]) < 0) {
        return JS_EXCEPTION;
    }
    if (s_next_node_id + 1 >= LUME_MAX_NODES) {
        return JS_ThrowRangeError(ctx, "lume: node table full");
    }
    uint16_t id = ++s_next_node_id;   /* 1..LUME_MAX_NODES-1; 0 is the screen */

    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_CREATE;
    m.kind = (uint8_t)kind;
    m.node_id = id;
    m.parent_id = (uint16_t)parent;
    if (lume_ui_bridge_post(&m) != 0) {
        ESP_LOGE(TAG, "createNode: ui queue full (id=%u)", (unsigned)id);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_NewInt32(ctx, id);
}

static JSValue js_set_attr(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t node_id, attr;
    if (argc < 3 || JS_ToInt32(ctx, &node_id, argv[0]) < 0 ||
        JS_ToInt32(ctx, &attr, argv[1]) < 0) {
        return JS_EXCEPTION;
    }

    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_SET_ATTR;
    m.node_id = (uint16_t)node_id;
    m.attr = (uint8_t)attr;

    if (JS_IsString(argv[2])) {
        size_t len = 0;
        const char *s = JS_ToCStringLen(ctx, &len, argv[2]);
        if (s == NULL) {
            return JS_EXCEPTION;
        }
        if (len >= LUME_TEXT_MAX) {
            /* JS-visible over-length error; the inline char[64] never overflows. */
            JS_FreeCString(ctx, s);
            return JS_ThrowRangeError(ctx,
                                      "lume: text exceeds %d bytes",
                                      LUME_TEXT_MAX - 1);
        }
        memcpy(m.text, s, len);
        m.text[len] = '\0';
        JS_FreeCString(ctx, s);
    } else {
        if (JS_ToInt32(ctx, &m.value, argv[2]) < 0) {
            return JS_EXCEPTION;
        }
    }

    if (lume_ui_bridge_post(&m) != 0) {
        ESP_LOGE(TAG, "setAttr: ui queue full (id=%u)", (unsigned)node_id);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}

static JSValue js_set_press_event(JSContext *ctx, JSValueConst this_val,
                                  int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t node_id;
    if (argc < 1 || JS_ToInt32(ctx, &node_id, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_SET_PRESS;
    m.node_id = (uint16_t)node_id;
    if (lume_ui_bridge_post(&m) != 0) {
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}

static JSValue js_remove_child(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t node_id;
    if (argc < 1 || JS_ToInt32(ctx, &node_id, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_REMOVE;
    m.node_id = (uint16_t)node_id;
    if (lume_ui_bridge_post(&m) != 0) {
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}

static void register_bindings(JSContext *ctx)
{
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue lume = JS_NewObject(ctx);
    /* JS_SetPropertyStr consumes the passed value (no JS_FreeValue needed). */
    JS_SetPropertyStr(ctx, lume, "createNode",
                      JS_NewCFunction(ctx, js_create_node, "createNode", 2));
    JS_SetPropertyStr(ctx, lume, "setAttr",
                      JS_NewCFunction(ctx, js_set_attr, "setAttr", 3));
    JS_SetPropertyStr(ctx, lume, "setPressEvent",
                      JS_NewCFunction(ctx, js_set_press_event, "setPressEvent", 1));
    JS_SetPropertyStr(ctx, lume, "removeChild",
                      JS_NewCFunction(ctx, js_remove_child, "removeChild", 1));
    JS_SetPropertyStr(ctx, global, "lume", lume);
    JS_FreeValue(ctx, global);
}

/* ------------------------------------------------------------------ */
/* Reverse channel: press event -> JS callback                         */
/* ------------------------------------------------------------------ */
void lume_engine_post_press(uint16_t node_id)
{
    lume_engine_evt_t evt = { .type = LUME_EVT_PRESS, .node_id = node_id };
    if (s_evt_queue != NULL) {
        xQueueSend(s_evt_queue, &evt, 0);
    }
}

static void dispatch_press(uint16_t node_id)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchPress");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue arg = JS_NewInt32(s_ctx, node_id);
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) {
            dump_js_exception(s_ctx, "__lume_dispatchPress");
        }
        JS_FreeValue(s_ctx, ret);
        JS_FreeValue(s_ctx, arg);   /* JS_Call borrows argv */
    } else {
        ESP_LOGW(TAG, "press id=%u: no __lume_dispatchPress handler",
                 (unsigned)node_id);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
}

/* ------------------------------------------------------------------ */
/* Engine task                                                         */
/* ------------------------------------------------------------------ */
static void engine_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "engine task up (pinned core 1), PSRAM free=%u bytes",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));

    s_rt = JS_NewRuntime2(&s_psram_mf, NULL);
    if (s_rt == NULL) {
        ESP_LOGE(TAG, "JS_NewRuntime2 (PSRAM allocator) failed");
        vTaskDelete(NULL);
        return;
    }
    JS_SetMemoryLimit(s_rt, LUME_JS_HEAP_LIMIT);
    ESP_LOGI(TAG, "QuickJS heap: PSRAM (MALLOC_CAP_SPIRAM), limit=%u bytes",
             (unsigned)LUME_JS_HEAP_LIMIT);

    s_ctx = JS_NewContext(s_rt);
    if (s_ctx == NULL) {
        ESP_LOGE(TAG, "JS_NewContext failed");
        JS_FreeRuntime(s_rt);
        vTaskDelete(NULL);
        return;
    }
    register_bindings(s_ctx);
    lume_ui_bridge_set_press_sink(lume_engine_post_press);
    ESP_LOGI(TAG, "native lume.* bindings registered; press sink wired");

    /* Prelude first (signals + ui components), then the app/demo. Both are
     * global evals on this context, so prelude globals persist for the demo. */
    if (eval_script(s_ctx, lume_prelude_js, "<lume-prelude>")) {
        ESP_LOGI(TAG, "prelude eval ok");
        if (eval_script(s_ctx, lume_demo_js, "<lume-demo>")) {
            ESP_LOGI(TAG, "demo eval ok");
        } else {
            ESP_LOGE(TAG, "demo eval failed");
        }
    } else {
        ESP_LOGE(TAG, "prelude eval failed; demo skipped");
    }

    for (;;) {
        lume_engine_evt_t evt;
        if (xQueueReceive(s_evt_queue, &evt, portMAX_DELAY) == pdTRUE) {
            ESP_LOGI(TAG, "engine recv evt type=%u id=%u",
                     (unsigned)evt.type, (unsigned)evt.node_id);
            if (evt.type == LUME_EVT_PRESS) {
                dispatch_press(evt.node_id);
            }
        }
    }
}

void lume_engine_start(void)
{
    s_evt_queue = xQueueCreate(EVT_QUEUE_LEN, sizeof(lume_engine_evt_t));
    xTaskCreatePinnedToCore(engine_task, "lume-js", ENGINE_TASK_STACK,
                            NULL, 5, NULL, 1);
}
