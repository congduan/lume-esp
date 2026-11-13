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
#include <stdlib.h>          /* abort(): boot-stage fail-fast on OOM */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lume_engine.h"
#include "lume_ui_bridge.h"
#include "lume_scripts.h"
#include "lume_gpio.h"
#include "quickjs.h"

static const char *TAG = "lume-engine";
#define LUME_JS_HEAP_LIMIT (8u * 1024u * 1024u)
#define ENGINE_TASK_STACK 24576
#define EVT_QUEUE_LEN 16
#define EVT_DROP_LOG_EVERY 16   /* one warning per N dropped press events */

static QueueHandle_t s_evt_queue;   /* Queue B: LVGL -> engine */
static JSRuntime *s_rt;
static JSContext *s_ctx;
static uint16_t s_next_node_id;     /* engine-task-only id allocator */
static uint32_t s_evt_dropped;      /* LVGL-task-only reverse-drop counter */

/* ---- Hot-reload staging (shared: USB CDC RX task writes, engine consumes) ----
 * The RX task and the engine task never dereference each other's buffers:
 * request_reload() copies into a fresh PSRAM buffer, and the engine moves the
 * pointer out under the mutex before it is used. Only the pointer/len/pending
 * fields are protected (the big memcpy happens outside the lock). */
static SemaphoreHandle_t s_stage_mutex;
static char   *s_staged_src;        /* PSRAM, NULL when the slot is empty */
static size_t  s_staged_len;
static bool    s_reload_pending;    /* a RELOAD event is queued, not consumed */

/* Engine-task-only: last app that evaled OK (fallback source on a failed
 * reload). NULL means "use the embedded demo". Owned exclusively by the engine
 * task, so no mutex. Transferred (not copied) from a successful reload. */
static char   *s_good_app;
static size_t  s_good_app_len;

/* Registered by lume-hotreload; reports the final reload outcome over USB TX. */
static lume_engine_reload_result_fn s_result_cb;

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

/* Evaluate a JS source buffer with an EXPLICIT length. Staged app source is
 * delivered as (ptr, len) and may not be strlen()-able, so every eval funnels
 * through here. */
static int eval_buf(JSContext *ctx, const char *src, size_t len,
                    const char *name)
{
    JSValue v = JS_Eval(ctx, src, len, name, JS_EVAL_TYPE_GLOBAL);
    int ok = 1;
    if (JS_IsException(v)) {
        dump_js_exception(ctx, name);
        ok = 0;
    }
    JS_FreeValue(ctx, v);
    return ok;
}

/* Convenience wrapper for the embedded NUL-terminated bundles. */
static int eval_script(JSContext *ctx, const char *src, const char *name)
{
    return eval_buf(ctx, src, strlen(src), name);
}

/* ------------------------------------------------------------------ */
/* Native JS bindings: global `lume` object (engine task only)         */
/* Each binding posts a fixed-size message; no lv_* anywhere here.     */
/* ------------------------------------------------------------------ */
static void msg_init(lume_ui_msg_t *m)
{
    memset(m, 0, sizeof(*m));
}

/* JS-visible logger (QuickJS-NG's console lives in quickjs-libc, which is not
 * linked into the firmware). Used by the prelude's drain guard and by M1
 * self-tests so those events are visible via ESP_LOGI. */
static JSValue js_log(JSContext *ctx, JSValueConst this_val,
                      int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) {
        return JS_UNDEFINED;
    }
    const char *s = JS_ToCString(ctx, argv[0]);
    if (s == NULL) {
        return JS_EXCEPTION;
    }
    ESP_LOGI(TAG, "js: %s", s);
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
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
        ESP_LOGE(TAG, "createNode: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)id);
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
        ESP_LOGE(TAG, "setAttr: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)node_id);
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
        ESP_LOGE(TAG, "setPressEvent: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)node_id);
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
        ESP_LOGE(TAG, "removeChild: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)node_id);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}

/* ------------------------------------------------------------------ */
/* lume.gpio natives (M2): GPIO + LEDC PWM, hardware in lume-gpio      */
/* ------------------------------------------------------------------ */
/* All seven run ONLY on the engine task, exactly like the lume.* UI setters
 * above: no lv_*, no new locks, no large buffers. Arity errors throw a
 * TypeError (a bare JS_EXCEPTION with no pending exception is a contract
 * violation inside QuickJS); non-numeric args surface the JS_ToInt32 error
 * as usual. Semantic range checks, the LEDC channel/pin conflict policy,
 * ESP-IDF driver calls and ESP_LOGW logging live in lume-gpio, which returns
 * an int status (0 = OK, negative = error code, see lume_gpio.h). That status
 * is returned to JS as a NUMBER, so semantic failures never abort or throw.
 * read() returns the 0/1 level on success; negatives are errors. */

static JSValue js_gpio_set_pin(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin, mode, pull;
    if (argc < 3) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.setPin: expected 3 arguments (pin, mode, pull)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0 ||
        JS_ToInt32(ctx, &mode, argv[1]) < 0 ||
        JS_ToInt32(ctx, &pull, argv[2]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_set_pin(pin, mode, pull));
}

static JSValue js_gpio_write(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin, level;
    if (argc < 2) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.write: expected 2 arguments (pin, level)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0 ||
        JS_ToInt32(ctx, &level, argv[1]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_write(pin, level));
}

static JSValue js_gpio_read(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.read: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_read(pin));
}

static JSValue js_gpio_toggle(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.toggle: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_toggle(pin));
}

static JSValue js_gpio_pwm_attach(JSContext *ctx, JSValueConst this_val,
                                  int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin, freq_hz, duty_pct, channel;
    if (argc < 4) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.pwmAttach: expected 4 arguments "
            "(pin, freqHz, dutyPct, channel)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0 ||
        JS_ToInt32(ctx, &freq_hz, argv[1]) < 0 ||
        JS_ToInt32(ctx, &duty_pct, argv[2]) < 0 ||
        JS_ToInt32(ctx, &channel, argv[3]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx,
                       lume_gpio_pwm_attach(pin, freq_hz, duty_pct, channel));
}

static JSValue js_gpio_pwm_duty(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin, duty_pct;
    if (argc < 2) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.pwmDuty: expected 2 arguments (pin, dutyPct)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0 ||
        JS_ToInt32(ctx, &duty_pct, argv[1]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_pwm_duty(pin, duty_pct));
}

static JSValue js_gpio_pwm_free(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.gpio.pwmFree: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_gpio_pwm_free(pin));
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
    JS_SetPropertyStr(ctx, lume, "log",
                      JS_NewCFunction(ctx, js_log, "log", 1));
    /* lume.gpio: built inline on the `lume` object, mirroring how log /
     * createNode / setAttr are attached directly (natives self-register, so
     * the prelude needs no change). JS_SetPropertyStr consumes `gpio`. */
    JSValue gpio = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, gpio, "setPin",
                      JS_NewCFunction(ctx, js_gpio_set_pin, "setPin", 3));
    JS_SetPropertyStr(ctx, gpio, "write",
                      JS_NewCFunction(ctx, js_gpio_write, "write", 2));
    JS_SetPropertyStr(ctx, gpio, "read",
                      JS_NewCFunction(ctx, js_gpio_read, "read", 1));
    JS_SetPropertyStr(ctx, gpio, "toggle",
                      JS_NewCFunction(ctx, js_gpio_toggle, "toggle", 1));
    JS_SetPropertyStr(ctx, gpio, "pwmAttach",
                      JS_NewCFunction(ctx, js_gpio_pwm_attach, "pwmAttach", 4));
    JS_SetPropertyStr(ctx, gpio, "pwmDuty",
                      JS_NewCFunction(ctx, js_gpio_pwm_duty, "pwmDuty", 2));
    JS_SetPropertyStr(ctx, gpio, "pwmFree",
                      JS_NewCFunction(ctx, js_gpio_pwm_free, "pwmFree", 1));
    JS_SetPropertyStr(ctx, lume, "gpio", gpio);
    JS_SetPropertyStr(ctx, global, "lume", lume);
    JS_FreeValue(ctx, global);
}

/* ------------------------------------------------------------------ */
/* Reverse channel: press event -> JS callback                         */
/* ------------------------------------------------------------------ */
void lume_engine_post_press(uint16_t node_id)
{
    lume_engine_evt_t evt = { .type = LUME_EVT_PRESS, .node_id = node_id };
    BaseType_t ok = (s_evt_queue != NULL)
                        ? xQueueSend(s_evt_queue, &evt, 0)
                        : pdFALSE;
    if (ok != pdTRUE) {
        /* Never silently lose a click: count the drop and surface it in the
         * log periodically so a saturated Queue B is visible on device. */
        s_evt_dropped++;
        if (s_evt_dropped == 1 ||
            (s_evt_dropped % EVT_DROP_LOG_EVERY) == 0) {
            ESP_LOGW(TAG, "press id=%u dropped: evt queue full (%u total drops)",
                     (unsigned)node_id, (unsigned)s_evt_dropped);
        }
    }
}

/* __lume_dispatchPress: press event -> JS handler.
 * __lume_dispatchRemove (r4 P2): after lv_obj_delete() purges the node table,
 * notify JS to dispose the press handler and any signal-bound effects owned
 * by that node, so a removed subtree stops posting updates / retaining
 * closures. Failures are logged, never fatal (removal must not wedge JS). */
static void dispatch_remove(uint16_t node_id)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchRemove");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue arg = JS_NewInt32(s_ctx, node_id);
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) {
            dump_js_exception(s_ctx, "__lume_dispatchRemove");
        }
        JS_FreeValue(s_ctx, ret);
        JS_FreeValue(s_ctx, arg);
    } else {
        ESP_LOGW(TAG, "remove id=%u: no __lume_dispatchRemove hook",
                 (unsigned)node_id);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
}

/* r4 P2: LVGL task -> engine task removal latch. Bit latched under a
 * spinlock; the engine task polls + clears it every loop pass (20ms tick),
 * so a notice cannot be lost to queue capacity and any subtree size is
 * covered. Multiple sets of the same id before the poll collapse into one
 * dispatch — safe, __dispose is idempotent. */
#define LUME_RM_WORDS ((LUME_MAX_NODES + 31u) / 32u)
static portMUX_TYPE s_rm_mux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_rm_pending[LUME_RM_WORDS];   /* bits: node ids to dispose */

void lume_engine_mark_removed(uint16_t node_id)
{
    if (node_id == 0 || node_id >= LUME_MAX_NODES) {
        return;
    }
    portENTER_CRITICAL(&s_rm_mux);
    s_rm_pending[node_id / 32u] |= 1u << (node_id % 32u);
    portEXIT_CRITICAL(&s_rm_mux);
}

/* Engine-task side: snapshot + clear the latch in one critical section,
 * then run __lume_dispatchRemove for each latched id. */
static void drain_removals(void)
{
    uint32_t snap[LUME_RM_WORDS];
    portENTER_CRITICAL(&s_rm_mux);
    for (unsigned i = 0; i < LUME_RM_WORDS; i++) {
        snap[i] = s_rm_pending[i];
        s_rm_pending[i] = 0;
    }
    portEXIT_CRITICAL(&s_rm_mux);
    for (unsigned w = 0; w < LUME_RM_WORDS; w++) {
        uint32_t bits = snap[w];
        while (bits) {
            unsigned bit = __builtin_ctz(bits);
            bits &= bits - 1;
            dispatch_remove((uint16_t)(w * 32u + bit));
        }
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
/* Hot reload: staging, result reporting, safe runtime recycling        */
/* ------------------------------------------------------------------ */
static void report_result(bool ok, size_t len, const char *reason)
{
    if (s_result_cb != NULL) {
        s_result_cb(ok, len, reason);
    }
}

void lume_engine_set_reload_result_cb(lume_engine_reload_result_fn cb)
{
    s_result_cb = cb;   /* set once, before any frame can arrive */
}

/* Move the staged source out of the shared slot into the engine task's sole
 * ownership, and clear the "event pending" flag. Returns NULL if the slot is
 * empty (e.g. coalesced duplicate events). */
static char *take_staged(size_t *len)
{
    char *p;
    xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
    p = s_staged_src;
    *len = s_staged_len;
    s_staged_src = NULL;
    s_staged_len = 0;
    s_reload_pending = false;
    xSemaphoreGive(s_stage_mutex);
    return p;
}

int lume_engine_request_reload(const char *src, size_t len)
{
    if (src == NULL || len == 0 || s_stage_mutex == NULL ||
        s_evt_queue == NULL) {
        return -1;
    }
    /* Copy OUTSIDE the lock: src belongs to the CDC RX task and must not be
     * shared with the engine. +1 for a defensive NUL terminator. */
    char *copy = heap_caps_malloc(len + 1, MALLOC_CAP_SPIRAM);
    if (copy == NULL) {
        ESP_LOGE(TAG, "request_reload: PSRAM staging alloc failed (%u bytes)",
                 (unsigned)len);
        return -1;
    }
    memcpy(copy, src, len);
    copy[len] = '\0';

    bool need_post;
    xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
    if (s_staged_src != NULL) {
        /* Single staging slot, last-frame-wins: a newer frame supersedes one
         * the engine has not picked up yet. The protocol promises one reply
         * per frame, so tell the host the superseded frame will not be
         * evaluated (the RX task owns frame replies; this callback path is
         * the engine-task reply lane). */
        heap_caps_free(s_staged_src);
        s_result_cb(false, s_staged_len, "superseded");
    }
    s_staged_src = copy;
    s_staged_len = len;
    need_post = !s_reload_pending;   /* coalesce: at most one queued reload */
    s_reload_pending = true;
    xSemaphoreGive(s_stage_mutex);

    if (need_post) {
        lume_engine_evt_t evt = { .type = LUME_EVT_RELOAD, .node_id = 0 };
        if (xQueueSend(s_evt_queue, &evt, pdMS_TO_TICKS(100)) != pdTRUE) {
            /* No event in the queue yet (need_post implies pending was false),
             * so the engine cannot have taken `copy`: safe to roll back. */
            ESP_LOGE(TAG, "request_reload: evt queue full, dropping frame");
            xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
            if (s_staged_src == copy) {
                s_staged_src = NULL;
                s_staged_len = 0;
            }
            s_reload_pending = false;
            xSemaphoreGive(s_stage_mutex);
            heap_caps_free(copy);
            return -1;
        }
    }
    return 0;
}

/* Drop any removal latch left over from the previous app before a fresh
 * context starts; stale ids must not be dispatched into the new JS context. */
static void clear_removals(void)
{
    portENTER_CRITICAL(&s_rm_mux);
    for (unsigned i = 0; i < LUME_RM_WORDS; i++) {
        s_rm_pending[i] = 0;
    }
    portEXIT_CRITICAL(&s_rm_mux);
}

/* ------------------------------------------------------------------ */
/* Engine task                                                         */
/* ------------------------------------------------------------------ */
static void engine_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "engine task up (pinned core 1), PSRAM free=%u bytes",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));

    /* Candidate app source for the NEXT runtime iteration. Owned exclusively
     * by the engine task. cand_is_reload drives TX reporting + commit-on-OK. */
    char *cand_src = NULL;
    size_t cand_len = 0;
    bool cand_is_reload = false;

    /* OUTER LOOP: one iteration == one QuickJS runtime lifetime. A reload
     * tears the runtime down at the bottom and continues here. Drivers
     * (LVGL / touch / board) are NOT restarted across iterations. */
    for (;;) {
        const char *app_src;
        size_t app_len;
        bool from_reload = cand_is_reload;
        if (cand_src != NULL) {
            app_src = cand_src;                 /* staged frame */
            app_len = cand_len;
        } else if (s_good_app != NULL) {
            app_src = s_good_app;               /* last-known-good app */
            app_len = s_good_app_len;
        } else {
            app_src = lume_demo_js;             /* embedded demo (boot) */
            app_len = strlen(lume_demo_js);
        }

        /* ---- fresh runtime, bindings, sink, per-app state ---- */
        JSRuntime *rt = JS_NewRuntime2(&s_psram_mf, NULL);
        if (rt == NULL) {
            ESP_LOGE(TAG, "JS_NewRuntime2 (PSRAM allocator) failed");
            abort();             /* fail-fast: boot abort beats a dead engine */
        }
        JS_SetMemoryLimit(rt, LUME_JS_HEAP_LIMIT);
        JSContext *ctx = JS_NewContext(rt);
        if (ctx == NULL) {
            ESP_LOGE(TAG, "JS_NewContext failed");
            JS_FreeRuntime(rt);
            abort();
        }
        s_rt = rt;
        s_ctx = ctx;
        register_bindings(ctx);                              /* native lume.* */
        lume_ui_bridge_set_press_sink(lume_engine_post_press); /* re-wire sink */
        /* Fresh JS-side id allocator. NOTE: the LVGL s_nodes[] table is NOT
         * cleared (drivers don't restart), so ids are reused across reloads;
         * see docs/KNOWN-SIMPLIFICATIONS.md. */
        s_next_node_id = 0;
        clear_removals();                       /* drop stale removal latch */
        ESP_LOGI(TAG, "runtime up; eval %s app (%u bytes)",
                 from_reload ? "staged" : "embedded/last-good",
                 (unsigned)app_len);

        /* ---- eval prelude (signals/ui), then the app ---- */
        bool ok = eval_script(ctx, lume_prelude_js, "<lume-prelude>");
        if (ok) {
            ok = eval_buf(ctx, app_src, app_len, "<lume-app>");
        } else {
            ESP_LOGE(TAG, "prelude eval failed; app skipped");
        }

        if (!ok) {
            /* eval_buf already dumped the JS exception. A failed reload must
             * NOT kill the engine: report ERR, then fall back to the previous
             * good app (or the embedded demo) on the next iteration. */
            if (from_reload) {
                report_result(false, app_len, "eval-failed");
                ESP_LOGW(TAG, "reload eval failed; falling back to last-good app");
            } else {
                ESP_LOGE(TAG, "embedded/last-good app eval failed (unexpected)");
            }
            s_rt = NULL;
            s_ctx = NULL;
            JS_FreeContext(ctx);
            JS_FreeRuntime(rt);
            if (cand_src != NULL) {            /* discard the bad candidate */
                heap_caps_free(cand_src);
                cand_src = NULL;
            }
            cand_len = 0;
            cand_is_reload = false;            /* next iter uses s_good_app */
            vTaskDelay(pdMS_TO_TICKS(50));     /* avoid a tight respin */
            continue;
        }

        /* ---- success: commit candidate + report OK ---- */
        if (from_reload) {
            /* Transfer cand_src into the engine-owned last-good buffer (no
             * copy). JS_Eval already consumed the source, so the runtime does
             * not retain this buffer. s_good_app is the fallback for a future
             * failed reload. */
            if (s_good_app != NULL) {
                heap_caps_free(s_good_app);
            }
            s_good_app = cand_src;
            s_good_app_len = cand_len;
            cand_src = NULL;                   /* ownership transferred */
            report_result(true, app_len, NULL);
        }
        if (cand_src != NULL) {
            heap_caps_free(cand_src);
            cand_src = NULL;
        }
        cand_len = 0;
        cand_is_reload = false;
        ESP_LOGI(TAG, "app eval ok; entering event loop");

        /* ---- inner event loop (one runtime lifetime) ---- */
        bool reload = false;
        for (;;) {
            lume_engine_evt_t evt;
            /* Bounded wait instead of portMAX_DELAY (r4 P2): the timeout is
             * the poll tick for latched removal notifications. */
            if (xQueueReceive(s_evt_queue, &evt, pdMS_TO_TICKS(20)) == pdTRUE) {
                if (evt.type == LUME_EVT_RELOAD) {
                    ESP_LOGI(TAG, "engine recv RELOAD -> recycle runtime");
                    reload = true;
                    break;                     /* leave the event loop */
                } else if (evt.type == LUME_EVT_PRESS) {
                    ESP_LOGI(TAG, "engine recv PRESS id=%u",
                             (unsigned)evt.node_id);
                    dispatch_press(evt.node_id);
                }
            }
            drain_removals();
        }

        /* ---- teardown ----
         * Only the engine task ever dereferences s_ctx (bindings, dispatch_*).
         * The reverse channel (press sink) and the reload request path only
         * post to FreeRTOS queues and never touch s_ctx, so no other task can
         * be using this context here. Free context first, then runtime. */
        s_rt = NULL;
        s_ctx = NULL;
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);

        /* ---- pick up the staged source for the next iteration ---- */
        if (reload) {
            size_t n = 0;
            char *newsrc = take_staged(&n);
            if (newsrc != NULL) {
                cand_src = newsrc;
                cand_len = n;
                cand_is_reload = true;
            } else {
                ESP_LOGW(TAG, "reload event but staging empty; restarting last-good");
                cand_is_reload = false;
            }
        }
    }
}

void lume_engine_start(void)
{
    s_stage_mutex = xSemaphoreCreateMutex();
    if (s_stage_mutex == NULL) {
        ESP_LOGE(TAG, "engine_start: stage mutex create failed (OOM)");
        abort();
    }
    s_evt_queue = xQueueCreate(EVT_QUEUE_LEN, sizeof(lume_engine_evt_t));
    if (s_evt_queue == NULL) {
        /* Without this queue the engine task would call xQueueReceive(NULL).
         * Abort at boot rather than run a silently broken engine. */
        ESP_LOGE(TAG, "engine_start: evt queue create failed (OOM)");
        abort();
    }
    BaseType_t ok = xTaskCreatePinnedToCore(engine_task, "lume-js",
                                            ENGINE_TASK_STACK, NULL, 5,
                                            NULL, 1);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "engine_start: engine task create failed (%d)", (int)ok);
        abort();
    }
    ESP_LOGI(TAG, "engine_start: evt queue=%u, stage mutex up, task lume-js up",
             EVT_QUEUE_LEN);
}
