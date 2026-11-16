/**
 * Lume engine: resident QuickJS-NG runtime on a dedicated task (M1).
 *
 * Thread discipline:
 *  - JS lives ONLY on the engine task (pinned to core 1). The runtime, context,
 *    eval and every JS callback execute here and nowhere else.
 *  - Native JS bindings (global `lume` object) never call lv_*. They build a
 *    fixed-size lume_ui_msg_t and post it to the ui-bridge Queue A (text and
 *    image payloads may be separately owned by the queued record).
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
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "lume_engine.h"
#include "lume_ui_bridge.h"
#include "lume_scripts.h"
#include "lume_gpio.h"
#include "lume_adc.h"
#include "lume_pmic_hw.h"
#include "lume_imu_hw.h"
#include "lume_kv.h"
#include "lume_fs.h"
#include "lume_apps.h"
#include "lume_net.h"
#include "lume_ble.h"
#include "lume_audio.h"
#include "mp3_decoder.h"
#include "lume_power.h"
#include "lume_image.h"
#include "lume_pins.h"       /* r27: display geometry from the board profile */
#include "quickjs.h"
#include "lume_perf.h"
#include "lume_bytecode.h"    /* r43b: app bytecode payload header + errors */

static const char *TAG = "lume-engine";
#define LUME_JS_HEAP_LIMIT (8u * 1024u * 1024u)
#define ENGINE_TASK_STACK 24576
#define EVT_QUEUE_LEN 16
#define EVT_DROP_LOG_EVERY 16   /* one warning per N dropped press events */

static QueueHandle_t s_evt_queue;   /* Queue B: LVGL -> engine */
static JSRuntime *s_rt;
static JSContext *s_ctx;
static bool s_node_live[LUME_MAX_NODES]; /* cleared only after LVGL remove acknowledgement */
static bool s_node_dead[LUME_MAX_NODES]; /* failed ids stay reserved until runtime reset */
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

/* r30 multi-app: which app the CURRENT runtime belongs to ("" = home/demo).
 * Exactly one app is live at any time; switching tears the runtime down. */
static char s_running_app[LUME_APP_ID_MAX];

/* Pending launch request (JS native -> engine loop). Guarded by s_stage_mutex;
 * an empty id means "go home". The source is read from LittleFS by the engine
 * loop, never on the caller's stack. */
static char s_launch_req[LUME_APP_ID_MAX];
static bool s_launch_pending;
static bool s_launch_reply;   /* the queued request expects a reload-reply */

/* Registered by lume-hotreload; reports the final reload outcome over USB TX. */
static lume_engine_reload_result_fn s_result_cb;

/* r26: registered by the WiFi-OTA channel; js_net_ota_status() reads it.
 * Declared here (before the native at ~1244) to avoid a use-before-declare. */
static lume_ota_status_provider_fn s_ota_status_provider;

/* ------------------------------------------------------------------ */
/* PSRAM-backed allocator for QuickJS-NG (JSMallocFunctions)            */
/* ------------------------------------------------------------------ */
#if CONFIG_LUME_PERF_PROFILE
/* All JSMallocFunctions calls originate from the sole engine task: the
 * runtime, eval, callbacks, GC and teardown never run on the LVGL task. */
static size_t s_alloc_net_bytes;
static size_t s_alloc_live;
#endif

void lume_engine_alloc_stats(size_t *net_bytes, size_t *live)
{
#if CONFIG_LUME_PERF_PROFILE
    if (net_bytes) *net_bytes = s_alloc_net_bytes;
    if (live) *live = s_alloc_live;
#else
    if (net_bytes) *net_bytes = 0;
    if (live) *live = 0;
#endif
}

static void *js_calloc_psram(void *opaque, size_t count, size_t size)
{
    (void)opaque;
    void *ptr = heap_caps_calloc(count, size, MALLOC_CAP_SPIRAM);
#if CONFIG_LUME_PERF_PROFILE
    if (ptr) { s_alloc_live++; s_alloc_net_bytes += heap_caps_get_allocated_size(ptr); }
#endif
    return ptr;
}
static void *js_malloc_psram(void *opaque, size_t size)
{
    (void)opaque;
    void *ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
#if CONFIG_LUME_PERF_PROFILE
    if (ptr) { s_alloc_live++; s_alloc_net_bytes += heap_caps_get_allocated_size(ptr); }
#endif
    return ptr;
}
static void js_free_psram(void *opaque, void *ptr)
{
    (void)opaque;
#if CONFIG_LUME_PERF_PROFILE
    if (ptr) { s_alloc_live--; s_alloc_net_bytes -= heap_caps_get_allocated_size(ptr); }
#endif
    heap_caps_free(ptr);
}
static void *js_realloc_psram(void *opaque, void *ptr, size_t size)
{
    (void)opaque;
#if CONFIG_LUME_PERF_PROFILE
    size_t before = ptr ? heap_caps_get_allocated_size(ptr) : 0;
#endif
    void *next = heap_caps_realloc(ptr, size, MALLOC_CAP_SPIRAM);
#if CONFIG_LUME_PERF_PROFILE
    if (next) {
        size_t after = heap_caps_get_allocated_size(next);
        if (!ptr) s_alloc_live++;
        if (after >= before) s_alloc_net_bytes += after - before;
        else s_alloc_net_bytes -= before - after;
    } else if (ptr && !size) {
        s_alloc_live--;
        s_alloc_net_bytes -= before;
    }
#endif
    return next;
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

/* r43b: reason for the last bytecode eval failure, surfaced as the
 * "RELOAD ERR <reason>" token instead of the generic "eval-failed". */
static const char *s_bc_fail_reason;

/* Load a little-endian u32 without an unaligned dereference. */
static uint32_t bc_load_le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Validate the r43b payload header and eval the raw qjsc blob. Returns 0 on
 * success or a negative LUME_BC_ERR_* code; NEVER crashes on a bad blob.
 * A QJS/BC version mismatch is rejected BEFORE JS_ReadObject() is called. */
static int eval_bytecode_buf(JSContext *ctx, const uint8_t *buf, size_t len)
{
    if (len < LUME_BC_HDR_LEN ||
        memcmp(buf, LUME_BC_MAGIC, LUME_BC_MAGIC_LEN) != 0) {
        ESP_LOGE(TAG, "bytecode: bad LQBC header (len=%u)", (unsigned)len);
        s_bc_fail_reason = LUME_BC_REASON_HEADER;
        return LUME_BC_ERR_HEADER;
    }
    uint8_t major = buf[LUME_BC_OFF_MAJOR];
    uint8_t minor = buf[LUME_BC_OFF_MINOR];
    uint8_t patch = buf[LUME_BC_OFF_PATCH];
    uint8_t bcver = buf[LUME_BC_OFF_BCVER];
    if (buf[8] || buf[9] || buf[10] || buf[11]) {
        ESP_LOGE(TAG, "bytecode: reserved header bytes must be zero");
        s_bc_fail_reason = LUME_BC_REASON_HEADER;
        return LUME_BC_ERR_HEADER;
    }
    uint32_t body_len = bc_load_le32(buf + LUME_BC_OFF_BODYLEN);
    if (body_len == 0 || body_len != len - LUME_BC_HDR_LEN) {
        ESP_LOGE(TAG, "bytecode: body_len=%u inconsistent with frame len=%u",
                 (unsigned)body_len, (unsigned)(len - LUME_BC_HDR_LEN));
        s_bc_fail_reason = LUME_BC_REASON_LENGTH;
        return LUME_BC_ERR_LENGTH;
    }
    if (major != QJS_VERSION_MAJOR || minor != QJS_VERSION_MINOR ||
        patch != QJS_VERSION_PATCH) {
        ESP_LOGE(TAG, "bytecode: engine version mismatch: bundle %u.%u.%u, firmware %d.%d.%d -- rejecting",
                 (unsigned)major, (unsigned)minor, (unsigned)patch,
                 QJS_VERSION_MAJOR, QJS_VERSION_MINOR, QJS_VERSION_PATCH);
        s_bc_fail_reason = LUME_BC_REASON_QJS_VERSION;
        return LUME_BC_ERR_QJS_VERSION;
    }
    /* Byte 0 of a JS_WriteObject blob IS BC_VERSION (quickjs.c
     * JS_WriteObjectAtoms). Cross-check it so a stale compiler is rejected
     * here; JS_ReadObject() independently rejects a mismatch with a
     * SyntaxError, so this is defence in depth, not the only gate. */
    const uint8_t *body = buf + LUME_BC_HDR_LEN;
    if (bcver != body[0]) {
        ESP_LOGE(TAG, "bytecode: BC_VERSION mismatch: header=%u blob=%u -- rejecting",
                 (unsigned)bcver, (unsigned)body[0]);
        s_bc_fail_reason = LUME_BC_REASON_BC_VERSION;
        return LUME_BC_ERR_BC_VERSION;
    }
    JSValue obj = JS_ReadObject(ctx, body, body_len, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(obj)) {
        dump_js_exception(ctx, "<bytecode-read>");
        ESP_LOGE(TAG, "bytecode: JS_ReadObject rejected payload (version/checksum/format)");
        s_bc_fail_reason = LUME_BC_REASON_READ;
        return LUME_BC_ERR_READ;
    }
    /* JS_EvalFunction consumes obj (frees it), including on error. */
    JSValue ret = JS_EvalFunction(ctx, obj);
    if (JS_IsException(ret)) {
        dump_js_exception(ctx, "<bytecode-eval>");
        s_bc_fail_reason = LUME_BC_REASON_EVAL;
        JS_FreeValue(ctx, ret);
        return LUME_BC_ERR_EVAL;
    }
    JS_FreeValue(ctx, ret);
    return 0;
}

/* A payload is bytecode iff it carries the LQBC header magic. Plain JS source
 * starting with those 4 bytes is not a valid JS program, so dispatching on the
 * magic cannot misroute a real source bundle. */
static bool buf_is_bytecode(const char *src, size_t len)
{
    return len >= LUME_BC_HDR_LEN &&
           memcmp(src, LUME_BC_MAGIC, LUME_BC_MAGIC_LEN) == 0;
}

/* Evaluate a source OR bytecode buffer with an EXPLICIT length. Staged app
 * payloads are delivered as (ptr, len) and may not be strlen()-able, so every
 * eval funnels through here. The source path is unchanged. */
static int eval_buf(JSContext *ctx, const char *src, size_t len,
                    const char *name)
{
#if CONFIG_LUME_PERF_PROFILE
    int64_t eval_start = lume_perf_now();
#endif
    const bool is_bc = buf_is_bytecode(src, len);
    int ok = 1;
    if (is_bc) {
        ok = eval_bytecode_buf(ctx, (const uint8_t *)src, len) == 0;
    } else {
        JSValue v = JS_Eval(ctx, src, len, name, JS_EVAL_TYPE_GLOBAL);
        if (JS_IsException(v)) {
            dump_js_exception(ctx, name);
            ok = 0;
        }
        JS_FreeValue(ctx, v);
    }
#if CONFIG_LUME_PERF_PROFILE
    int64_t elapsed = lume_perf_now() - eval_start;
    lume_perf_add(LUME_PERF_EVAL, elapsed);
    ESP_LOGI(TAG, "eval '%s' %u us (%s)", name, (unsigned)elapsed,
             is_bc ? "bytecode" : "source");
    JSMemoryUsage usage;
    JS_ComputeMemoryUsage(JS_GetRuntime(ctx), &usage);
    lume_perf_js_heap((uint32_t)usage.memory_used_size);
#endif
    return ok;
}

/* Convenience wrapper for the embedded NUL-terminated bundles. */
static int eval_script(JSContext *ctx, const char *src, const char *name)
{
    return eval_buf(ctx, src, strlen(src), name);
}

/* ------------------------------------------------------------------ */
/* r46 Task B: one-time bytecode compile cache for embedded scripts.     */
/* lume_prelude_js (~57 KB) was re-parsed from source on EVERY app       */
/* switch. Compile it once (JS_Eval COMPILE_ONLY), serialize the function */
/* bytecode with JS_WriteObject into a PSRAM-resident blob, and on later  */
/* switches load it with JS_ReadObject + JS_EvalFunction, skipping the    */
/* parse. Same pattern for lume_home_js / lume_demo_js. The blob is       */
/* self-contained (atoms serialized inline) so it survives the runtime    */
/* teardown between iterations. A magic + packed QJS version + source     */
/* content hash guard against ever reading a stale/foreign blob; on any    */
/* mismatch or load error we discard the cache and fall back to source     */
/* eval. Source C-string form in lume_scripts.c is untouched.            */
/* ------------------------------------------------------------------ */
#define LUME_SCRIPT_CACHE_MAGIC 0x43424d4cu   /* "LMBC" */
#define SCRIPT_QJS_VERSION (((uint32_t)QJS_VERSION_MAJOR << 16) | \
                            ((uint32_t)QJS_VERSION_MINOR << 8) |  \
                            (uint32_t)QJS_VERSION_PATCH)

typedef enum {
    LUME_CACHE_PRELUDE = 0,
    LUME_CACHE_HOME,
    LUME_CACHE_DEMO,
    LUME_CACHE_COUNT
} lume_cache_slot_t;

typedef struct {
    uint32_t magic;
    uint32_t qjs_version;   /* packed QJS_VERSION_MAJOR.MINOR.PATCH */
    uint32_t src_hash;      /* FNV-1a over the embedded source bytes */
    uint32_t body_len;      /* JS_WriteObject blob length */
    uint8_t  body[];        /* JS_WriteObject blob (starts with BC_VERSION) */
} lume_script_cache_t;

/* Engine-task-only, PSRAM-resident, alive for the whole boot (never freed:
 * small, fixed set, reused on every switch). */
static lume_script_cache_t *s_script_cache[LUME_CACHE_COUNT];

static uint32_t script_src_hash(const char *src, size_t len)
{
    uint32_t h = 2166136261u;   /* FNV-1a 32 */
    for (size_t i = 0; i < len; i++) {
        h ^= (uint8_t)src[i];
        h *= 16777619u;
    }
    return h;
}

/* Compile `src` to bytecode and store it. Returns true when the cache holds a
 * valid blob (which the caller then loads+runs). `ctx` is a live runtime. */
static bool script_cache_compile(JSContext *ctx, lume_cache_slot_t slot,
                                 const char *src, const char *name)
{
    size_t len = strlen(src);
    JSValue fn = JS_Eval(ctx, src, len, name,
                         JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fn)) {
        dump_js_exception(ctx, name);
        return false;
    }
    size_t body_len = 0;
    uint8_t *body = JS_WriteObject(ctx, &body_len, fn, JS_WRITE_OBJ_BYTECODE);
    JS_FreeValue(ctx, fn);
    if (body == NULL || body_len == 0) {
        if (body) js_free(ctx, body);
        return false;
    }
    size_t total = sizeof(lume_script_cache_t) + body_len;
    lume_script_cache_t *c = heap_caps_malloc(total, MALLOC_CAP_SPIRAM);
    if (c == NULL) {
        js_free(ctx, body);
        ESP_LOGW(TAG, "script cache '%s': PSRAM alloc %u bytes failed",
                 name, (unsigned)total);
        return false;
    }
    c->magic = LUME_SCRIPT_CACHE_MAGIC;
    c->qjs_version = SCRIPT_QJS_VERSION;
    c->src_hash = script_src_hash(src, len);
    c->body_len = (uint32_t)body_len;
    memcpy(c->body, body, body_len);
    js_free(ctx, body);
    s_script_cache[slot] = c;
    ESP_LOGI(TAG, "script cache '%s': compiled %u bytes total (%u body), "
             "qjs %d.%d.%d, src hash 0x%08x",
             name, (unsigned)total, (unsigned)body_len,
             QJS_VERSION_MAJOR, QJS_VERSION_MINOR, QJS_VERSION_PATCH,
             (unsigned)c->src_hash);
    return true;
}

/* Load + run a cached blob. JS_EvalFunction consumes obj. Returns 0 on ok. */
static int script_cache_load(JSContext *ctx, const lume_script_cache_t *c,
                             const char *name)
{
    JSValue obj = JS_ReadObject(ctx, c->body, c->body_len, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(obj)) {
        dump_js_exception(ctx, "<bytecode-read>");
        return -1;
    }
    JSValue ret = JS_EvalFunction(ctx, obj);
    if (JS_IsException(ret)) {
        dump_js_exception(ctx, "<bytecode-eval>");
        JS_FreeValue(ctx, ret);
        return -1;
    }
    JS_FreeValue(ctx, ret);
    return 0;
}

/* Evaluate an embedded script, using the resident bytecode cache when valid.
 * On first use it compiles AND runs via bytecode; later uses skip the parse.
 * Any cache problem discards it and falls back to source eval (never a
 * cross-version misread). */
static int eval_cached_script(JSContext *ctx, const char *src,
                              const char *name, lume_cache_slot_t slot)
{
    lume_script_cache_t *c = s_script_cache[slot];
    if (c != NULL &&
        (c->magic != LUME_SCRIPT_CACHE_MAGIC ||
         c->qjs_version != SCRIPT_QJS_VERSION ||
         c->body_len == 0 ||
         c->src_hash != script_src_hash(src, strlen(src)))) {
        ESP_LOGW(TAG, "script cache '%s': version/hash mismatch, discarding", name);
        heap_caps_free(c);
        s_script_cache[slot] = NULL;
        c = NULL;
    }
    if (c == NULL) {
        if (!script_cache_compile(ctx, slot, src, name)) {
            ESP_LOGW(TAG, "script cache '%s': compile failed, source eval", name);
            return eval_script(ctx, src, name);
        }
        c = s_script_cache[slot];
    }
    if (script_cache_load(ctx, c, name) != 0) {
        ESP_LOGW(TAG, "script cache '%s': load failed, discard + source eval", name);
        heap_caps_free(c);
        s_script_cache[slot] = NULL;
        return eval_script(ctx, src, name);
    }
    /* Match eval_buf/eval_script's convention: 1 = ok, 0 = failed. */
    return 1;
}

/* ------------------------------------------------------------------ */
/* Native JS bindings: global `lume` object (engine task only)         */
/* Each binding posts a fixed-size message; no lv_* anywhere here.     */
/* ------------------------------------------------------------------ */
static void msg_init(lume_ui_msg_t *m)
{
    memset(m, 0, sizeof(*m));
}

/* On successful post Queue A owns text_heap; on failure the sender frees it. */
static int msg_set_text(JSContext *ctx, lume_ui_msg_t *m, JSValueConst value)
{
    size_t len = 0;
    const char *s = JS_ToCStringLen(ctx, &len, value);
    if (!s) return -1;
    if (len > LUME_TEXT_LIMIT) {
        JS_FreeCString(ctx, s);
        JS_ThrowRangeError(ctx, "lume: text exceeds %d bytes", LUME_TEXT_LIMIT);
        return -1;
    }
    m->text_len = (uint16_t)len;
    if (len < LUME_TEXT_MAX) {
        memcpy(m->text, s, len + 1);
    } else {
        m->text_heap = heap_caps_malloc(len + 1, MALLOC_CAP_SPIRAM);
        if (!m->text_heap) {
            JS_FreeCString(ctx, s);
            JS_ThrowInternalError(ctx, "lume: text allocation failed");
            return -1;
        }
        memcpy(m->text_heap, s, len + 1);
    }
    JS_FreeCString(ctx, s);
    return 0;
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

static JSValue js_warn(JSContext *ctx, JSValueConst this_val,
                       int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) return JS_UNDEFINED;
    const char *s = JS_ToCString(ctx, argv[0]);
    if (!s) return JS_EXCEPTION;
    ESP_LOGW(TAG, "js: %s", s);
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}

static JSValue js_now_ms(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewFloat64(ctx, (double)esp_timer_get_time() / 1000.0);
}

static JSValue js_power_sleep_now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_power_sleep_now());
}

static JSValue js_power_wake(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_power_wake());
}

/* Board screen geometry as a JS global (__lumeScreen) for the prelude: canvas
 * clamps and the PSRAM budget read it instead of hard-coded 480 literals.
 * r31 left these as the one registered exception in the board profile sweep;
 * C preprocessor macros cannot be interpolated into the lume_scripts.c string
 * (the host extractor matches one quoted string per line), so the values cross
 * as runtime properties, written before the prelude is evaluated. */
static void inject_screen_globals(JSContext *ctx)
{
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue screen = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, screen, "w", JS_NewInt32(ctx, LUME_LCD_H_RES));
    JS_SetPropertyStr(ctx, screen, "h", JS_NewInt32(ctx, LUME_LCD_V_RES));
    JS_SetPropertyStr(ctx, global, "__lumeScreen", screen);
    JS_FreeValue(ctx, global);
}

static void call_app_hook(const char *name)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, name);
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 0, NULL);
        if (JS_IsException(ret)) dump_js_exception(s_ctx, name);
        JS_FreeValue(s_ctx, ret);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
}

static bool call_back_hook(void)
{
    bool handled = false;
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_back");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 0, NULL);
        if (JS_IsException(ret)) dump_js_exception(s_ctx, "__lume_back");
        else handled = JS_ToBool(s_ctx, ret) == 1;
        JS_FreeValue(s_ctx, ret);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
    return handled;
}

static JSValue js_create_node(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t kind, parent, canvas_w = 0, canvas_h = 0;
    if (argc < 2 || JS_ToInt32(ctx, &kind, argv[0]) < 0 ||
        JS_ToInt32(ctx, &parent, argv[1]) < 0) {
        return JS_EXCEPTION;
    }
    if (kind == LUME_NODE_CANVAS) {
        if (argc < 4) return JS_ThrowTypeError(ctx, "lume: canvas width and height required");
        if (JS_ToInt32(ctx, &canvas_w, argv[2]) < 0 ||
            JS_ToInt32(ctx, &canvas_h, argv[3]) < 0) return JS_EXCEPTION;
        if (canvas_w < 1 || canvas_h < 1 ||
            canvas_w > LUME_LCD_H_RES || canvas_h > LUME_LCD_V_RES ||
            (size_t)canvas_w * canvas_h * (LUME_LCD_BPP / 8u) >
                (size_t)LUME_LCD_H_RES * LUME_LCD_V_RES * (LUME_LCD_BPP / 8u))
            return JS_ThrowRangeError(ctx, "lume: canvas dimensions exceed display budget");
    }
    uint16_t id = 0;
    for (uint16_t i = 1; i < LUME_MAX_NODES; i++)
        if (!s_node_live[i]) { id = i; break; }
    if (!id) return JS_ThrowRangeError(ctx, "lume: node table full");
    s_node_live[id] = true;

    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_CREATE;
    m.kind = (uint8_t)kind;
    m.node_id = id;
    m.parent_id = (uint16_t)parent;
    m.from = canvas_w;
    m.to = canvas_h;
    if (lume_ui_bridge_post(&m) != 0) {
        s_node_live[id] = false;
        ESP_LOGE(TAG, "createNode: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)id);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_NewInt32(ctx, id);
}

static JSValue js_image_size_of(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    size_t len = 0;
    uint8_t *bytes = argc > 0 ? JS_GetArrayBuffer(ctx, &len, argv[0]) : NULL;
    uint16_t w = 0, h = 0;
    int r = lume_image_size_of(bytes, len, &w, &h);
    if (r) return JS_NewInt32(ctx, r);
    JSValue result = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, result, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, result, "height", JS_NewInt32(ctx, h));
    return result;
}

static JSValue js_image_set_source(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    int32_t id = 0;
    if (argc < 2 || JS_ToInt32(ctx, &id, argv[0]) < 0 ||
        id < 1 || id >= LUME_MAX_NODES || !s_node_live[id])
        return JS_NewInt32(ctx, -1);
    if (s_node_dead[id]) return JS_NewInt32(ctx, 0);
    size_t len = 0;
    uint8_t *bytes = JS_GetArrayBuffer(ctx, &len, argv[1]);
    if (!bytes) return JS_NewInt32(ctx, -1);
    uint8_t *pixels = NULL, alpha = 0;
    uint16_t w = 0, h = 0;
    int r = lume_image_decode(bytes, len, &pixels, &w, &h, &alpha);
    if (r) return JS_NewInt32(ctx, r);
    lume_ui_msg_t m; msg_init(&m);
    m.op = LUME_OP_IMAGE_SOURCE;
    m.node_id = id; m.image_pixels = pixels;
    m.image_w = w; m.image_h = h; m.image_alpha = alpha;
    if (lume_ui_bridge_post(&m) != 0) { heap_caps_free(pixels); return JS_NewInt32(ctx, -3); }
    return JS_NewInt32(ctx, 0);
}

static JSValue js_canvas_draw(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id, op, x, y, a, b, color, width;
    if (argc < 8) return JS_ThrowTypeError(ctx, "lume: canvasDraw needs 8 arguments");
    if (JS_ToInt32(ctx,&id,argv[0]) < 0 || JS_ToInt32(ctx,&op,argv[1]) < 0 ||
        JS_ToInt32(ctx,&x,argv[2]) < 0 || JS_ToInt32(ctx,&y,argv[3]) < 0 ||
        JS_ToInt32(ctx,&a,argv[4]) < 0 || JS_ToInt32(ctx,&b,argv[5]) < 0 ||
        JS_ToInt32(ctx,&color,argv[6]) < 0 || JS_ToInt32(ctx,&width,argv[7]) < 0) return JS_EXCEPTION;
    if (id < 1 || id >= LUME_MAX_NODES || op < LUME_DRAW_CLEAR || op > LUME_DRAW_ARC ||
        width < 1 || width > 16 ||
        x < -LUME_LCD_H_RES || x > LUME_LCD_H_RES ||
        y < -LUME_LCD_V_RES || y > LUME_LCD_V_RES ||
        a < -LUME_LCD_H_RES || a > LUME_LCD_H_RES ||
        b < -LUME_LCD_V_RES || b > LUME_LCD_V_RES)
        return JS_ThrowRangeError(ctx, "lume: canvas draw argument out of range");
    if (s_node_dead[id]) return JS_UNDEFINED;
    lume_ui_msg_t m; msg_init(&m);
    m.op = LUME_OP_CANVAS_DRAW; m.node_id = id; m.attr = op;
    m.from = x; m.to = y;
    m.value = color; m.draw_width = width;
    if (op == LUME_DRAW_ARC) {
        /* r48 ARC reuses spare fields of the fixed 128 B message (no new
         * fields, no renumbered ids): a = radius (additionally >= 0 here),
         * b unused, image_w = radius, duration_ms/token = the two signed
         * integer-degree angles. argv[8]/argv[9] carry from/to; the raster
         * normalises/wraps them. QuickJS passes the real argc (10) through. */
        int32_t ang_from, ang_to;
        if (argc < 10 ||
            JS_ToInt32(ctx, &ang_from, argv[8]) < 0 ||
            JS_ToInt32(ctx, &ang_to, argv[9]) < 0)
            return JS_ThrowTypeError(ctx, "lume: arc needs from/to angles");
        if (a < 0 || ang_from < -4096 || ang_from > 4096 ||
            ang_to < -4096 || ang_to > 4096)
            return JS_ThrowRangeError(ctx, "lume: arc argument out of range");
        m.image_w = (uint16_t)a;                 /* radius                    */
        m.duration_ms = (uint32_t)ang_from;      /* from deg (signed to u32)  */
        m.token = (uint32_t)ang_to;              /* to deg (signed to u32)    */
    } else {
        m.duration_ms = (uint32_t)a; m.token = (uint32_t)b;
        if (op == LUME_DRAW_TEXT) {
            if (argc < 9) return JS_ThrowTypeError(ctx, "lume: canvas text required");
            if (msg_set_text(ctx, &m, argv[8]) != 0) return JS_EXCEPTION;
        }
    }
    if (lume_ui_bridge_post(&m) != 0) {
        heap_caps_free(m.text_heap);
        return JS_ThrowInternalError(ctx,"lume: ui queue full");
    }
    return JS_UNDEFINED;
}
/* Flat [x1,y1,x2,y2,color,width, ...] -> PSRAM segment array. Shared by the
 * streaming batch path and the retained path define, so both validate the same
 * way; returns NULL with an exception set on failure. */
static lume_canvas_line_t *canvas_lines_from_array(JSContext *ctx, JSValueConst arr,
                                                   uint32_t max_segs, const char *what,
                                                   uint16_t *out_count)
{
    JSValue length = JS_GetPropertyStr(ctx, arr, "length");
    uint32_t n;
    if (JS_ToUint32(ctx, &n, length) < 0) { JS_FreeValue(ctx, length); return NULL; }
    JS_FreeValue(ctx, length);
    if (!n || n % 6 || n > max_segs * 6) {
        JS_ThrowRangeError(ctx, "lume: canvas %s must contain 1..%u lines", what,
                           (unsigned)max_segs);
        return NULL;
    }
    lume_canvas_line_t *lines = heap_caps_calloc(n / 6, sizeof(*lines), MALLOC_CAP_SPIRAM);
    if (!lines) { JS_ThrowOutOfMemory(ctx); return NULL; }
    for (uint32_t i = 0; i < n; i++) {
        JSValue v = JS_GetPropertyUint32(ctx, arr, i);
        int32_t x;
        int bad = JS_ToInt32(ctx, &x, v);
        JS_FreeValue(ctx, v);
        if (bad < 0) { heap_caps_free(lines); return NULL; }
        if ((i % 6 < 4 && (x < -480 || x > 480)) ||
            (i % 6 == 4 && (x < 0 || x > 0xffffff)) ||
            (i % 6 == 5 && (x < 1 || x > 16))) {
            heap_caps_free(lines);
            JS_ThrowRangeError(ctx, "lume: invalid canvas %s segment", what);
            return NULL;
        }
        lume_canvas_line_t *line = &lines[i / 6];
        switch (i % 6) {
            case 0: line->x1 = x; break; case 1: line->y1 = x; break;
            case 2: line->x2 = x; break; case 3: line->y2 = x; break;
            case 4: line->color = x; break; case 5: line->width = x; break;
        }
    }
    *out_count = (uint16_t)(n / 6);
    return lines;
}
static JSValue js_canvas_batch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id;
    if (argc != 2 || !JS_IsArray(argv[1]))
        return JS_ThrowTypeError(ctx, "lume: canvasBatch needs id and flat segments");
    if (JS_ToInt32(ctx, &id, argv[0]) < 0) return JS_EXCEPTION;
    if (id < 1 || id >= LUME_MAX_NODES) return JS_ThrowRangeError(ctx, "lume: invalid canvas id");
    uint16_t count = 0;
    lume_canvas_line_t *lines = canvas_lines_from_array(ctx, argv[1], LUME_CANVAS_BATCH_MAX,
                                                       "batch", &count);
    if (!lines) return JS_EXCEPTION;
    if (s_node_dead[id]) { heap_caps_free(lines); return JS_UNDEFINED; }
    lume_ui_msg_t m; msg_init(&m); m.op = LUME_OP_CANVAS_BATCH; m.node_id = id;
    m.image_pixels = lines; m.image_w = count;
    if (lume_ui_bridge_post(&m) != 0) {
        heap_caps_free(lines);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}
/* Retained path: uploaded once, replayed per frame from the LVGL task. */
static JSValue js_canvas_path_define(JSContext *ctx, JSValueConst this_val,
                                     int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id, path;
    if (argc != 3 || !JS_IsArray(argv[2]))
        return JS_ThrowTypeError(ctx, "lume: canvasPathDefine needs id, path and flat segments");
    if (JS_ToInt32(ctx, &id, argv[0]) < 0 || JS_ToInt32(ctx, &path, argv[1]) < 0)
        return JS_EXCEPTION;
    if (id < 1 || id >= LUME_MAX_NODES) return JS_ThrowRangeError(ctx, "lume: invalid canvas id");
    if (path < 1 || path > LUME_CANVAS_PATHS)
        return JS_ThrowRangeError(ctx, "lume: path id must be 1..%d", LUME_CANVAS_PATHS);
    uint16_t count = 0;
    lume_canvas_line_t *lines = canvas_lines_from_array(ctx, argv[2], LUME_CANVAS_PATH_SEG_MAX,
                                                       "path", &count);
    if (!lines) return JS_EXCEPTION;
    if (s_node_dead[id]) { heap_caps_free(lines); return JS_UNDEFINED; }
    lume_ui_msg_t m; msg_init(&m); m.op = LUME_OP_CANVAS_PATH_DEFINE; m.node_id = id;
    m.attr = (uint8_t)(path - 1); m.image_pixels = lines; m.image_w = count;
    if (lume_ui_bridge_post(&m) != 0) {
        heap_caps_free(lines);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}
static JSValue js_canvas_path_draw(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id, path, dx = 0, dy = 0;
    if (argc < 2) return JS_ThrowTypeError(ctx, "lume: canvasPathDraw needs id and path");
    if (JS_ToInt32(ctx, &id, argv[0]) < 0 || JS_ToInt32(ctx, &path, argv[1]) < 0)
        return JS_EXCEPTION;
    if (argc > 2 && JS_ToInt32(ctx, &dx, argv[2]) < 0) return JS_EXCEPTION;
    if (argc > 3 && JS_ToInt32(ctx, &dy, argv[3]) < 0) return JS_EXCEPTION;
    if (id < 1 || id >= LUME_MAX_NODES) return JS_ThrowRangeError(ctx, "lume: invalid canvas id");
    if (path < 1 || path > LUME_CANVAS_PATHS)
        return JS_ThrowRangeError(ctx, "lume: path id must be 1..%d", LUME_CANVAS_PATHS);
    if (s_node_dead[id]) return JS_UNDEFINED;
    lume_ui_msg_t m; msg_init(&m); m.op = LUME_OP_CANVAS_PATH_DRAW; m.node_id = id;
    m.attr = (uint8_t)(path - 1); m.from = dx; m.to = dy;
    if (lume_ui_bridge_post(&m) != 0) return JS_ThrowInternalError(ctx, "lume: ui queue full");
    return JS_UNDEFINED;
}
static JSValue js_canvas_invalidate(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume: canvasInvalidate needs id");
    if (JS_ToInt32(ctx,&id,argv[0]) < 0) return JS_EXCEPTION;
    if (id < 1 || id >= LUME_MAX_NODES) return JS_ThrowRangeError(ctx,"lume: invalid canvas id");
    if (s_node_dead[id]) return JS_UNDEFINED;
    lume_ui_msg_t m; msg_init(&m); m.op = LUME_OP_CANVAS_INVALIDATE; m.node_id = id;
    if (argc != 1) {
        int32_t x, y, w, h;
        if (argc != 5 || JS_ToInt32(ctx, &x, argv[1]) < 0 ||
            JS_ToInt32(ctx, &y, argv[2]) < 0 || JS_ToInt32(ctx, &w, argv[3]) < 0 ||
            JS_ToInt32(ctx, &h, argv[4]) < 0) return JS_ThrowTypeError(ctx, "lume: invalidate needs x,y,w,h");
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x > 480 || y > 480 ||
            w > 480 || h > 480) return JS_ThrowRangeError(ctx, "lume: invalid canvas rectangle");
        m.kind = 1; m.from = x; m.to = y; m.duration_ms = w; m.token = h;
    }
    if (lume_ui_bridge_post(&m) != 0) return JS_ThrowInternalError(ctx,"lume: ui queue full");
    return JS_UNDEFINED;
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
    if (node_id > 0 && node_id < LUME_MAX_NODES && s_node_dead[node_id])
        return JS_UNDEFINED;

    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_SET_ATTR;
    m.node_id = (uint16_t)node_id;
    m.attr = (uint8_t)attr;

    if (JS_IsString(argv[2])) {
        if (msg_set_text(ctx, &m, argv[2]) != 0) return JS_EXCEPTION;
    } else {
        if (JS_ToInt32(ctx, &m.value, argv[2]) < 0) {
            return JS_EXCEPTION;
        }
    }

    if (lume_ui_bridge_post(&m) != 0) {
        heap_caps_free(m.text_heap);
        ESP_LOGE(TAG, "setAttr: ui queue full after retries (id=%u); "
                      "JS/UI state may diverge", (unsigned)node_id);
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    }
    return JS_UNDEFINED;
}

static uint32_t s_next_anim_token;
static JSValue js_animate(JSContext *ctx, JSValueConst this_val,
                          int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id, attr, to, duration, easing, from = 0;
    if (argc < 6 || JS_ToInt32(ctx, &id, argv[0]) < 0 ||
        JS_ToInt32(ctx, &attr, argv[1]) < 0 ||
        JS_ToInt32(ctx, &to, argv[3]) < 0 ||
        JS_ToInt32(ctx, &duration, argv[4]) < 0 ||
        JS_ToInt32(ctx, &easing, argv[5]) < 0) return JS_EXCEPTION;
    bool has_from = !JS_IsNull(argv[2]) && !JS_IsUndefined(argv[2]);
    if (has_from && JS_ToInt32(ctx, &from, argv[2]) < 0) return JS_EXCEPTION;
    if (id <= 0 || id >= LUME_MAX_NODES ||
        (attr != LUME_ATTR_X && attr != LUME_ATTR_Y &&
         attr != LUME_ATTR_WIDTH && attr != LUME_ATTR_HEIGHT &&
         attr != LUME_ATTR_OPACITY) || duration <= 0 || duration > 60000 ||
        easing < LUME_EASE_LINEAR || easing > LUME_EASE_IN_OUT ||
        ((attr == LUME_ATTR_OPACITY) &&
         (to < 0 || to > 255 || (has_from && (from < 0 || from > 255)))))
        return JS_ThrowRangeError(ctx, "lume: invalid animation arguments");
    if (s_node_dead[id]) return JS_NewUint32(ctx, 0);
    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_ANIMATE; m.node_id = (uint16_t)id; m.attr = (uint8_t)attr;
    m.from = from; m.has_from = has_from; m.to = to;
    m.duration_ms = (uint32_t)duration; m.easing = (uint8_t)easing;
    m.token = ++s_next_anim_token;
    if (m.token == 0) m.token = ++s_next_anim_token;
    if (lume_ui_bridge_post(&m) != 0)
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
    return JS_NewUint32(ctx, m.token);
}
static JSValue js_animate_cancel(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t id, attr;
    if (argc < 2 || JS_ToInt32(ctx, &id, argv[0]) < 0 ||
        JS_ToInt32(ctx, &attr, argv[1]) < 0) return JS_EXCEPTION;
    if (id <= 0 || id >= LUME_MAX_NODES ||
        (attr != LUME_ATTR_X && attr != LUME_ATTR_Y &&
         attr != LUME_ATTR_WIDTH && attr != LUME_ATTR_HEIGHT &&
         attr != LUME_ATTR_OPACITY))
        return JS_ThrowRangeError(ctx, "lume: invalid animation cancel");
    if (s_node_dead[id]) return JS_UNDEFINED;
    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_ANIMATE_CANCEL; m.node_id = (uint16_t)id; m.attr = (uint8_t)attr;
    if (lume_ui_bridge_post(&m) != 0)
        return JS_ThrowInternalError(ctx, "lume: ui queue full");
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
    if (node_id > 0 && node_id < LUME_MAX_NODES && s_node_dead[node_id])
        return JS_UNDEFINED;
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

/* r21: JS lume.setGestureEvent(node_id) -> LUME_OP_SET_GESTURE (Queue A).
 * The prelude calls this once per node from lume.gesture.on(). */
static JSValue js_set_gesture_event(JSContext *ctx, JSValueConst this_val,
                                    int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t node_id;
    if (argc < 1 || JS_ToInt32(ctx, &node_id, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    if (node_id > 0 && node_id < LUME_MAX_NODES && s_node_dead[node_id])
        return JS_UNDEFINED;
    lume_ui_msg_t m;
    msg_init(&m);
    m.op = LUME_OP_SET_GESTURE;
    m.node_id = (uint16_t)node_id;
    if (lume_ui_bridge_post(&m) != 0) {
        ESP_LOGE(TAG, "setGestureEvent: ui queue full after retries (id=%u); "
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
    if (node_id > 0 && node_id < LUME_MAX_NODES && s_node_dead[node_id])
        return JS_UNDEFINED;
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

/* ------------------------------------------------------------------ */
/* lume.adc natives (M2): ADC1 oneshot, hardware in lume-adc          */
/* ------------------------------------------------------------------ */
/* Same discipline as lume.gpio above: all four run ONLY on the engine task,
 * arity errors throw a TypeError, semantic range / driver / state checks live
 * in lume-adc which returns an int status (0 = OK, negative = error code, see
 * lume_adc.h). That status is returned to JS as a NUMBER, so semantic
 * failures never abort or throw. readRaw()/readMv() return a non-negative
 * measurement on success; negatives are errors. */

static JSValue js_adc_config(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin, atten;
    if (argc < 2) {
        return JS_ThrowTypeError(ctx,
            "lume.adc.config: expected 2 arguments (pin, atten)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0 ||
        JS_ToInt32(ctx, &atten, argv[1]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_adc_config(pin, atten));
}

static JSValue js_adc_read_raw(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.adc.readRaw: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_adc_read_raw(pin));
}

static JSValue js_adc_read_mv(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.adc.readMv: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_adc_read_mv(pin));
}

static JSValue js_adc_free(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val;
    int32_t pin;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.adc.free: expected 1 argument (pin)");
    }
    if (JS_ToInt32(ctx, &pin, argv[0]) < 0) {
        return JS_EXCEPTION;
    }
    return JS_NewInt32(ctx, lume_adc_free(pin));
}

/* ------------------------------------------------------------------ */
/* lume.pmic natives (M2): AXP2101 telemetry + power-off, hw in lume-pmic */
/* ------------------------------------------------------------------ */
/* Same discipline as lume.gpio / lume.adc above: all seven run ONLY on the
 * engine task, semantic / driver / state checks live in lume-pmic which
 * returns an int status (0 = OK, negative = error code, see lume_pmic_hw.h).
 * That status is returned to JS as a NUMBER, so failures never abort or
 * throw. The six telemetry/status reads return a non-negative measurement on
 * success; negatives are errors. Unlike gpio/adc these functions take NO
 * arguments, so there is nothing to marshal and the "too few arguments ->
 * TypeError" path never triggers. powerOff() is the one (high-risk) write.
 * lume_pmic_hw_init() runs from register_bindings() on every fresh runtime; a
 * successful init is latched (idempotent across hot-reload runtime resets) and
 * a failed one retries on the next pass (Codex r8 review). A no-board /
 * undetected PMIC makes every call return -3. */

static JSValue js_pmic_batt_voltage_mv(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_batt_voltage_mv());
}

static JSValue js_pmic_batt_percent(JSContext *ctx, JSValueConst this_val,
                                    int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_batt_percent());
}

static JSValue js_pmic_vbus_voltage_mv(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_vbus_voltage_mv());
}

static JSValue js_pmic_usb_connected(JSContext *ctx, JSValueConst this_val,
                                     int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_usb_connected());
}

static JSValue js_pmic_charging_status(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_charging_status());
}

static JSValue js_pmic_die_temp_raw(JSContext *ctx, JSValueConst this_val,
                                    int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_die_temp_raw());
}

static JSValue js_pmic_power_off(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_pmic_hw_power_off());
}

/* ------------------------------------------------------------------ */
/* lume.imu natives (M2 / r9): QMI8658 accel+gyro, hw in lume-imu     */
/* ------------------------------------------------------------------ */
/* Same thread discipline as lume.pmic above: both run ONLY on the engine
 * task, no lv_*, no new locks, no large buffers. Unlike the int-status
 * lume.gpio/adc/pmic APIs, read()'s contract is an OBJECT
 * {ax,ay,az,gx,gy,gz}; the native hardware layer does the raw->physical
 * conversion (m/s^2, deg/s) and returns an int status. A NON-OK status is
 * mapped to JS null here (lume-imu already logged an ESP_LOGW) so semantic
 * failures never abort or throw, consistent with the rest of the lume.*
 * family. JS_SetPropertyStr consumes each JS_NewFloat64 value.
 * onMotion() is the exception: it keeps the int-status contract and always
 * returns -4 (LUME_IMU_ERR_NO_INT) because the board-level INT pin is not
 * defined this round -- see docs/KNOWN-SIMPLIFICATIONS.md (r9 section). */

static JSValue js_imu_read(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    lume_imu_sample_t s = { 0 };
    int r = lume_imu_hw_read(&s);
    if (r != LUME_IMU_OK) {
        return JS_NULL;
    }
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "ax", JS_NewFloat64(ctx, (double)s.ax));
    JS_SetPropertyStr(ctx, obj, "ay", JS_NewFloat64(ctx, (double)s.ay));
    JS_SetPropertyStr(ctx, obj, "az", JS_NewFloat64(ctx, (double)s.az));
    JS_SetPropertyStr(ctx, obj, "gx", JS_NewFloat64(ctx, (double)s.gx));
    JS_SetPropertyStr(ctx, obj, "gy", JS_NewFloat64(ctx, (double)s.gy));
    JS_SetPropertyStr(ctx, obj, "gz", JS_NewFloat64(ctx, (double)s.gz));
    return obj;
}

static JSValue js_imu_on_motion(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_imu_hw_on_motion());
}

/* ------------------------------------------------------------------ */
/* lume.storage.kv natives (M2 / r10): NVS KV store, hw in lume-storage */
/* ------------------------------------------------------------------ */
/* Same discipline as the lume.* natives above: all five run ONLY on the
 * engine task, no lv_*, no new locks (NVS has its own internal lock). The
 * lume-storage layer is QuickJS-free and returns an int status (0 = OK,
 * negative = error code, see lume_kv.h); the natives marshal JS args/values.
 *
 * Arity errors throw a TypeError (a bare JS_EXCEPTION with no pending
 * exception is a QuickJS contract violation). Semantic failures (bad key,
 * over-length value, NVS driver error, NVS unavailable) are returned as a
 * NEGATIVE NUMBER, never thrown, so the rest of the engine is never aborted
 * -- consistent with lume.gpio/adc/pmic. When NVS is unavailable every one
 * of these returns -3 (LUME_KV_ERR_STATE), the lume.pmic-style degradation.
 *
 * set(key, value): value string -> nvs_set_str, number -> nvs_set_i32,
 * boolean -> nvs_set_u8, ArrayBuffer -> nvs_set_blob. JS_IsBool is checked
 * before JS_IsNumber (booleans are a distinct QuickJS tag). Numbers are
 * converted with JS_ToInt32 (truncation/wrap, matching the other natives).
 * get(key): a value (string/number/bool/ArrayBuffer), JS_NULL when the key
 * is absent, or a negative error code as a NUMBER on failure. keys() returns
 * a string[] (empty array when the namespace is empty) or a negative error
 * code as a NUMBER. The value/error-code NUMBER overlap in get() is a known
 * tradeoff: a stored number can legally be -1/-2/-3, so a negative get()
 * result is ambiguous when NVS is available (documented in lume.d.ts and
 * docs/KNOWN-SIMPLIFICATIONS.md r10 -- do NOT treat `r < 0` as an error
 * discriminator for get()).
 *
 * lume_kv_init() runs from register_bindings() on every fresh runtime; a
 * successful init is latched (idempotent across hot-reload runtime resets)
 * and a failed one retries on the next pass. No board is needed: NVS is in
 * main flash, so unlike lume.pmic/lume.imu there is no "no board" path --
 * only a missing/broken NVS partition, which degrades to -3. */

/* Convert a JS key argument to a validated C string. Uses JS_ToCStringLen
 * (not JS_ToCString) so the real byte length is known, and rejects keys with
 * an embedded NUL: NVS keys are C strings, so "a\0b" would silently shorten
 * to "a" and read/erase the wrong entry (r10 review finding). Returns NULL
 * with a pending exception on failure; caller frees with JS_FreeCString.
 * On success sets *ok: true = usable key, false = invalid key (embedded
 * NUL) which callers map to the contracted LUME_KV_ERR_ARG (-1) return
 * rather than an exception, matching the empty/over-length key contract. */
static const char *kv_key_from_js(JSContext *ctx, JSValueConst v, bool *ok)
{
    size_t klen = 0;
    *ok = false;
    const char *key = JS_ToCStringLen(ctx, &klen, v);
    if (key == NULL) {
        return NULL;    /* conversion failed: pending exception */
    }
    if (memchr(key, '\0', klen) != NULL) {
        JS_FreeCString(ctx, key);
        ESP_LOGW(TAG, "kv: key contains an embedded NUL");
        return NULL;    /* *ok == false: map to LUME_KV_ERR_ARG */
    }
    *ok = true;
    return key;
}

static JSValue js_kv_set(JSContext *ctx, JSValueConst this_val,
                         int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 2) {
        return JS_ThrowTypeError(ctx,
            "lume.storage.kv.set: expected 2 arguments (key, value)");
    }
    bool key_ok = false;
    const char *key = kv_key_from_js(ctx, argv[0], &key_ok);
    if (key == NULL && !key_ok) {
        return JS_NewInt32(ctx, LUME_KV_ERR_ARG);
    }
    if (key == NULL) {
        return JS_EXCEPTION;
    }

    int r;
    if (JS_IsString(argv[1])) {
        size_t len = 0;
        const char *s = JS_ToCStringLen(ctx, &len, argv[1]);
        if (s == NULL) {
            JS_FreeCString(ctx, key);
            return JS_EXCEPTION;
        }
        r = lume_kv_set_str(key, s, len);
        JS_FreeCString(ctx, s);
    } else if (JS_IsBool(argv[1])) {
        int b = JS_ToBool(ctx, argv[1]);
        r = (b < 0) ? LUME_KV_ERR_ARG
                    : lume_kv_set_bool(key, b != 0);
    } else if (JS_IsNumber(argv[1])) {
        int32_t n = 0;
        if (JS_ToInt32(ctx, &n, argv[1]) < 0) {
            JS_FreeCString(ctx, key);
            return JS_EXCEPTION;
        }
        r = lume_kv_set_int(key, n);
    } else if (JS_IsArrayBuffer(argv[1])) {
        size_t len = 0;
        uint8_t *data = JS_GetArrayBuffer(ctx, &len, argv[1]);
        r = lume_kv_set_blob(key, data, len);
    } else {
        r = LUME_KV_ERR_ARG;    /* unsupported value type (null/object/...) */
    }
    JS_FreeCString(ctx, key);
    return JS_NewInt32(ctx, r);
}

static JSValue js_kv_get(JSContext *ctx, JSValueConst this_val,
                         int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.storage.kv.get: expected 1 argument (key)");
    }
    bool key_ok = false;
    const char *key = kv_key_from_js(ctx, argv[0], &key_ok);
    if (key == NULL && !key_ok) {
        return JS_NewInt32(ctx, LUME_KV_ERR_ARG);
    }
    if (key == NULL) {
        return JS_EXCEPTION;
    }

    lume_kv_value_t v;
    int r = lume_kv_get(key, &v);
    JS_FreeCString(ctx, key);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }

    JSValue ret;
    switch (v.type) {
    case LUME_KV_T_NONE: ret = JS_NULL; break;
    case LUME_KV_T_INT:  ret = JS_NewInt32(ctx, v.i); break;
    case LUME_KV_T_BOOL: ret = JS_NewBool(ctx, v.i != 0); break;
    case LUME_KV_T_STR:  ret = JS_NewStringLen(ctx, (const char *)v.buf, v.len); break;
    case LUME_KV_T_BLOB: ret = JS_NewArrayBufferCopy(ctx, v.buf, v.len); break;
    default:             ret = JS_NewInt32(ctx, LUME_KV_ERR_DRIVER); break;
    }
    /* STR/BLOB buffers are heap-owned by the native; JS_NewStringLen /
     * JS_NewArrayBufferCopy copy the bytes, so it is safe to free now. */
    lume_kv_value_free(&v);
    return ret;
}

static JSValue js_kv_remove(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.storage.kv.remove: expected 1 argument (key)");
    }
    bool key_ok = false;
    const char *key = kv_key_from_js(ctx, argv[0], &key_ok);
    if (key == NULL && !key_ok) {
        return JS_NewInt32(ctx, LUME_KV_ERR_ARG);
    }
    if (key == NULL) {
        return JS_EXCEPTION;
    }
    int r = lume_kv_remove(key);
    JS_FreeCString(ctx, key);
    return JS_NewInt32(ctx, r);
}

/* keys() builds a JS array via a callback: lume_kv_keys() owns the NVS
 * iterator and calls this once per key (engine-task-only, so no reentrancy). */
typedef struct {
    JSContext *ctx;
    JSValue    arr;
    uint32_t   idx;
    bool       failed;   /* an append failed; exception is pending in ctx */
} kv_keys_ctx_t;

static void kv_keys_emit(void *arg, const char *key)
{
    kv_keys_ctx_t *c = (kv_keys_ctx_t *)arg;
    if (c->failed) {
        return;                 /* a previous append failed: stop appending */
    }
    JSValue s = JS_NewString(c->ctx, key);
    if (JS_IsException(s)) {
        c->failed = true;       /* propagates via the pending exception */
        return;
    }
    if (JS_SetPropertyUint32(c->ctx, c->arr, c->idx++, s) < 0) {
        c->failed = true;       /* property store failed (s is consumed) */
    }
}

static JSValue js_kv_keys(JSContext *ctx, JSValueConst this_val,
                          int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    kv_keys_ctx_t c = { ctx, JS_NewArray(ctx), 0, false };
    /* JS_NewArray failure leaves a pending exception; bail out before the
     * native iterator runs (r10 review finding). */
    if (JS_IsException(c.arr)) {
        return JS_EXCEPTION;
    }
    int r = lume_kv_keys(kv_keys_emit, &c);
    if (r < 0 || c.failed) {
        JS_FreeValue(ctx, c.arr);
        if (c.failed) {
            return JS_EXCEPTION;   /* propagate the append error */
        }
        return JS_NewInt32(ctx, r);
    }
    return c.arr;
}

static JSValue js_kv_clear(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt32(ctx, lume_kv_clear());
}

/* LittleFS natives: semantic errors use Kv's negative status convention.
 * read() is text, readBinary() preserves exact bytes. */
static const char *fs_path_arg(JSContext *ctx, JSValueConst v, bool *valid)
{
    size_t n = 0;
    *valid = true;
    const char *p = JS_ToCStringLen(ctx, &n, v);
    if (!p) return NULL;
    if (memchr(p, '\0', n)) { *valid = false; JS_FreeCString(ctx, p); return NULL; }
    return p;
}

static JSValue js_fs_write_common(JSContext *ctx, int argc,
                                  JSValueConst *argv, bool append)
{
    if (argc < 2) return JS_ThrowTypeError(ctx, "Fs.write/append: expected path and data");
    bool valid;
    const char *path = fs_path_arg(ctx, argv[0], &valid);
    if (!path) return valid ? JS_EXCEPTION : JS_NewInt32(ctx, LUME_FS_ERR_ARG);
    const uint8_t *data = NULL;
    const char *str = NULL;
    size_t len = 0;
    if (JS_IsString(argv[1])) {
        str = JS_ToCStringLen(ctx, &len, argv[1]);
        if (!str) { JS_FreeCString(ctx, path); return JS_EXCEPTION; }
        data = (const uint8_t *)str;
    } else if (JS_IsArrayBuffer(argv[1])) {
        data = JS_GetArrayBuffer(ctx, &len, argv[1]);
    } else {
        JS_FreeCString(ctx, path);
        return JS_NewInt32(ctx, LUME_FS_ERR_ARG);
    }
    int r = data ? lume_fs_write(path, data, len, append) : LUME_FS_ERR_ARG;
    if (str) JS_FreeCString(ctx, str);
    JS_FreeCString(ctx, path);
    return JS_NewInt32(ctx, r);
}

static JSValue js_fs_write(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{ (void)this_val; return js_fs_write_common(ctx, argc, argv, false); }
static JSValue js_fs_append(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{ (void)this_val; return js_fs_write_common(ctx, argc, argv, true); }

static JSValue js_fs_read_common(JSContext *ctx, int argc, JSValueConst *argv, bool binary)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "Fs.read: expected path");
    bool valid;
    const char *path = fs_path_arg(ctx, argv[0], &valid);
    if (!path) return valid ? JS_EXCEPTION : JS_NewInt32(ctx, LUME_FS_ERR_ARG);
    uint8_t *data = NULL;
    size_t len = 0;
    int r = lume_fs_read(path, &data, &len);
    JS_FreeCString(ctx, path);
    if (r < 0) return JS_NewInt32(ctx, r);
    JSValue result = binary ? JS_NewArrayBufferCopy(ctx, data, len)
                            : JS_NewStringLen(ctx, (const char *)data, len);
    free(data);
    return result;
}
static JSValue js_fs_read(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{ (void)this_val; return js_fs_read_common(ctx, argc, argv, false); }
static JSValue js_fs_read_binary(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{ (void)this_val; return js_fs_read_common(ctx, argc, argv, true); }

static JSValue js_fs_path_action(JSContext *ctx, int argc, JSValueConst *argv, int op)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "Fs: expected path");
    bool valid;
    const char *path = fs_path_arg(ctx, argv[0], &valid);
    if (!path) return valid ? JS_EXCEPTION : JS_NewInt32(ctx, LUME_FS_ERR_ARG);
    bool exists = false;
    int r = op == 0 ? lume_fs_remove(path) :
            op == 1 ? lume_fs_mkdir(path) : lume_fs_exists(path, &exists);
    JS_FreeCString(ctx, path);
    if (r < 0 || op != 2) return JS_NewInt32(ctx, r);
    return JS_NewBool(ctx, exists);
}
static JSValue js_fs_remove(JSContext *ctx, JSValueConst v, int n, JSValueConst *a)
{ (void)v; return js_fs_path_action(ctx, n, a, 0); }
static JSValue js_fs_mkdir(JSContext *ctx, JSValueConst v, int n, JSValueConst *a)
{ (void)v; return js_fs_path_action(ctx, n, a, 1); }
static JSValue js_fs_exists(JSContext *ctx, JSValueConst v, int n, JSValueConst *a)
{ (void)v; return js_fs_path_action(ctx, n, a, 2); }

static void fs_list_emit(void *arg, const char *name)
{ kv_keys_emit(arg, name); }
static JSValue js_fs_list(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "Fs.list: expected directory path");
    bool valid;
    const char *path = fs_path_arg(ctx, argv[0], &valid);
    if (!path) return valid ? JS_EXCEPTION : JS_NewInt32(ctx, LUME_FS_ERR_ARG);
    kv_keys_ctx_t c = { ctx, JS_NewArray(ctx), 0, false };
    if (JS_IsException(c.arr)) { JS_FreeCString(ctx, path); return JS_EXCEPTION; }
    int r = lume_fs_list(path, fs_list_emit, &c);
    JS_FreeCString(ctx, path);
    if (r < 0 || c.failed) {
        JS_FreeValue(ctx, c.arr);
        return c.failed ? JS_EXCEPTION : JS_NewInt32(ctx, r);
    }
    return c.arr;
}
static JSValue js_fs_mounted(JSContext *ctx, JSValueConst v, int n, JSValueConst *a)
{ (void)v; (void)n; (void)a; return JS_NewBool(ctx, lume_fs_mounted()); }

/* ---- r30 multi-app natives (lume.apps.*) ----
 * The store and the "which app is live" decision both run on the engine task.
 * launch()/home() only POST a switch request: the CURRENT runtime must keep
 * running until the JS call returns, and the engine loop recycles it right
 * after (single-live-app rule, see lume_apps.h). */
typedef struct {
    JSContext *ctx;
    JSValue    arr;
    int        count;
    bool       failed;
} apps_list_ctx_t;

static void apps_list_emit(void *arg, const char *id)
{
    apps_list_ctx_t *c = (apps_list_ctx_t *)arg;
    if (c->failed) {
        return;
    }
    if (JS_SetPropertyUint32(c->ctx, c->arr, (uint32_t)c->count,
                             JS_NewString(c->ctx, id)) < 0) {
        c->failed = true;
        return;
    }
    c->count++;
}

static JSValue js_apps_list(JSContext *ctx, JSValueConst self, int argc,
                            JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    apps_list_ctx_t c = { ctx, JS_NewArray(ctx), 0, false };
    if (JS_IsException(c.arr)) {
        return JS_EXCEPTION;
    }
    int r = lume_apps_list(apps_list_emit, &c);
    if (r < 0 || c.failed) {
        JS_FreeValue(ctx, c.arr);
        return c.failed ? JS_EXCEPTION : JS_NewInt32(ctx, r);
    }
    return c.arr;
}

static JSValue js_apps_meta(JSContext *ctx, JSValueConst self, int argc,
                            JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.apps.meta: expected app id");
    size_t n = 0;
    const char *id = JS_ToCStringLen(ctx, &n, argv[0]);
    if (id == NULL) return JS_EXCEPTION;
    if (memchr(id, '\0', n) != NULL) {
        JS_FreeCString(ctx, id);
        return JS_NewInt32(ctx, LUME_APPS_ERR_ID);
    }
    char *meta = NULL;
    size_t meta_len = 0;
    int r = lume_apps_meta_read(id, &meta, &meta_len);
    JS_FreeCString(ctx, id);
    if (r < 0) return JS_NewInt32(ctx, r);
    JSValue out = JS_NewStringLen(ctx, meta, meta_len);
    heap_caps_free(meta);
    return out;
}

static JSValue js_apps_current(JSContext *ctx, JSValueConst self, int argc,
                               JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    char id[LUME_APP_ID_MAX];
    int r = lume_apps_current(id, sizeof(id));
    if (r < 0) return JS_NewInt32(ctx, r);
    return JS_NewString(ctx, id);
}

static JSValue js_apps_launch(JSContext *ctx, JSValueConst self, int argc,
                              JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.apps.launch: expected app id");
    size_t n = 0;
    const char *id = JS_ToCStringLen(ctx, &n, argv[0]);
    if (id == NULL) return JS_EXCEPTION;
    int r = -1;
    if (memchr(id, '\0', n) == NULL && n > 0 && n < LUME_APP_ID_MAX &&
        lume_app_id_valid(id, n)) {
        r = lume_engine_request_launch(id);
    }
    JS_FreeCString(ctx, id);
    return JS_NewInt32(ctx, r < 0 ? -1 : 0);
}

static JSValue js_apps_home(JSContext *ctx, JSValueConst self, int argc,
                            JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_engine_request_launch("") < 0 ? LUME_FS_ERR_STATE : 0);
}

static JSValue js_apps_set_boot(JSContext *ctx, JSValueConst self, int argc,
                                JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.apps.setBoot: expected app id");
    size_t n = 0;
    const char *id = JS_ToCStringLen(ctx, &n, argv[0]);
    if (id == NULL) return JS_EXCEPTION;
    int r = LUME_APPS_ERR_ID;
    if (memchr(id, '\0', n) == NULL && n < LUME_APP_ID_MAX &&
        (n == 0 || lume_app_id_valid(id, n))) {
        r = lume_apps_set_boot(id);
    }
    JS_FreeCString(ctx, id);
    return JS_NewInt32(ctx, r);
}

static JSValue js_apps_remove(JSContext *ctx, JSValueConst self, int argc,
                              JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.apps.remove: expected app id");
    size_t n = 0;
    const char *id = JS_ToCStringLen(ctx, &n, argv[0]);
    if (id == NULL) return JS_EXCEPTION;
    if (memchr(id, '\0', n) != NULL) {
        JS_FreeCString(ctx, id);
        return JS_NewInt32(ctx, LUME_APPS_ERR_ID);
    }
    /* A live app cannot delete itself: the runtime is about to be the one
     * running its own (now missing) source on the next boot. */
    int r = LUME_APPS_ERR_ID;
    if (strcmp(id, s_running_app) == 0) {
        r = LUME_APPS_ERR_BUSY;
    } else {
        r = lume_apps_remove(id);
    }
    JS_FreeCString(ctx, id);
    return JS_NewInt32(ctx, r);
}

static JSValue js_apps_mounted(JSContext *ctx, JSValueConst self, int argc,
                               JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewBool(ctx, lume_fs_mounted());
}

/* lume.net / lume.net.http natives (M2 / r11): WiFi station + HTTP client,
 * hardware/net layer in lume-net. Same thread discipline as the lume.* natives
 * above: all run ONLY on the engine task; lume-net is QuickJS-free and returns
 * an int status (0 = OK, negative = error code, see lume_net.h); the natives
 * marshal JS args/values. lume_net_init() runs from register_bindings() on
 * every fresh runtime; a successful init latches, a failed init is non-fatal
 * and makes every net API return -3 (lume.pmic/lume.storage.kv-style
 * degradation). No board is needed for the compile-level path (WiFi lives in
 * the ESP32-S3 radio); real association is verified by the on-board round.
 *
 * status()/httpGet() return OBJECTS on success and a NEGATIVE NUMBER (the
 * error code) on failure. connect()/disconnect()/init()/deinit() return the
 * int status directly. Credentials (password) and the http url are NEVER
 * logged by the native or the lume-net layer. */
static JSValue js_net_init(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_net_init());
}

static JSValue js_net_deinit(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_net_deinit());
}

static JSValue js_net_connect(JSContext *ctx, JSValueConst this_val,
                              int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 2) {
        return JS_ThrowTypeError(ctx,
            "lume.net.connect: expected 2 arguments (ssid, password)");
    }
    /* Real byte lengths (JS strings may contain an embedded NUL, which the
     * lume-net layer rejects as -1). Both C strings are freed immediately. */
    size_t slen = 0, plen = 0;
    const char *ssid = JS_ToCStringLen(ctx, &slen, argv[0]);
    if (ssid == NULL) {
        return JS_EXCEPTION;
    }
    const char *pass = JS_ToCStringLen(ctx, &plen, argv[1]);
    if (pass == NULL) {
        JS_FreeCString(ctx, ssid);
        return JS_EXCEPTION;
    }
    int r = lume_net_connect(ssid, slen, pass, plen);
    JS_FreeCString(ctx, ssid);
    JS_FreeCString(ctx, pass);
    return JS_NewInt32(ctx, r);
}

static JSValue js_net_disconnect(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_net_disconnect());
}

static JSValue js_net_status(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    lume_net_status_t st;
    int r = lume_net_status(&st);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "state", JS_NewInt32(ctx, (int32_t)st.state));
    JS_SetPropertyStr(ctx, obj, "ip",
        st.ip[0] ? JS_NewStringLen(ctx, st.ip, strlen(st.ip)) : JS_NULL);
    return obj;
}

/* lume.net.scan(): synchronous AP scan. Returns an ARRAY of
 * { ssid, rssi, auth } sorted by RSSI descending on success (possibly
 * empty), or a NEGATIVE NUMBER (the error code) on failure -- the same
 * shape as status(). BLOCKS the engine task for the scan duration
 * (~1.5-3 s), mirroring the synchronous-httpGet tradeoff (docs r11).
 * The item array lives on the engine-task stack: 20 x ~36 B is well
 * within its budget; the C layer heap-buffers the larger driver
 * records itself. Hidden APs carry ssid "" (rendered by JS). */
static JSValue js_net_scan(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    lume_net_scan_item_t items[LUME_NET_SCAN_MAX];
    int count = 0;
    int r = lume_net_scan(items, LUME_NET_SCAN_MAX, &count);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < count; i++) {
        JSValue obj = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, obj, "ssid",
            items[i].ssid[0]
                ? JS_NewStringLen(ctx, items[i].ssid, strlen(items[i].ssid))
                : JS_NewString(ctx, ""));
        JS_SetPropertyStr(ctx, obj, "rssi", JS_NewInt32(ctx, items[i].rssi));
        JS_SetPropertyStr(ctx, obj, "auth", JS_NewInt32(ctx, items[i].auth));
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, obj);
    }
    return arr;
}

/* r26: lume.net.otaStatus() -> { running, wifiReady, tokenReady, port, token }.
 * The status is supplied by the WiFi-OTA channel's registered provider (see
 * lume_engine.h); no provider -> an all-false/zero status object. */
static JSValue js_net_ota_status(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    lume_ota_status_t st;
    memset(&st, 0, sizeof(st));
    if (s_ota_status_provider != NULL) {
        s_ota_status_provider(&st);
    }
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "running",    JS_NewBool(ctx, st.running));
    JS_SetPropertyStr(ctx, obj, "wifiReady",  JS_NewBool(ctx, st.wifi_ready));
    JS_SetPropertyStr(ctx, obj, "tokenReady", JS_NewBool(ctx, st.token_ready));
    JS_SetPropertyStr(ctx, obj, "port",       JS_NewInt32(ctx, st.port));
    JS_SetPropertyStr(ctx, obj, "token",      JS_NewString(ctx, st.token));
    return obj;
}

/* lume.net.httpGet(url, options?) / lume.net.http.get(url, options?).
 * options: { timeoutMs?: number, responseType?: 'text'|'arraybuffer' }.
 * Returns { status, body, contentLength, truncated } on a completed transfer,
 * or a negative error code (number). body is a JS string by default, or an
 * ArrayBuffer when responseType === 'arraybuffer'. */
static JSValue js_net_http_get(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx,
            "lume.net.httpGet: expected at least 1 argument (url)");
    }
    size_t ulen = 0;
    const char *url = JS_ToCStringLen(ctx, &ulen, argv[0]);
    if (url == NULL) {
        return JS_EXCEPTION;
    }
    if (memchr(url, '\0', ulen) != NULL) {
        JS_FreeCString(ctx, url);
        return JS_NewInt32(ctx, LUME_NET_ERR_ARG);
    }

    int timeout_ms = LUME_HTTP_TIMEOUT_DEFAULT_MS;
    bool as_arraybuffer = false;
    if (argc >= 2 && JS_IsObject(argv[1])) {
        JSValue t = JS_GetPropertyStr(ctx, argv[1], "timeoutMs");
        if (!JS_IsUndefined(t) && !JS_IsNull(t)) {
            int32_t v = 0;
            if (JS_ToInt32(ctx, &v, t) < 0) {
                JS_FreeValue(ctx, t);
                JS_FreeCString(ctx, url);
                return JS_EXCEPTION;
            }
            timeout_ms = v;                 /* lume-net clamps to a safe range */
        }
        JS_FreeValue(ctx, t);

        JSValue rt = JS_GetPropertyStr(ctx, argv[1], "responseType");
        if (JS_IsException(rt)) {
            /* property getter threw — propagate instead of leaking (r11 review #3) */
            JS_FreeCString(ctx, url);
            return JS_EXCEPTION;
        }
        if (JS_IsString(rt)) {
            const char *s = JS_ToCString(ctx, rt);
            if (s != NULL) {
                as_arraybuffer = (strcmp(s, "arraybuffer") == 0);
                JS_FreeCString(ctx, s);
            } else {
                /* JS_ToCString failed: exception pending — propagate */
                JS_FreeValue(ctx, rt);
                JS_FreeCString(ctx, url);
                return JS_EXCEPTION;
            }
        }
        JS_FreeValue(ctx, rt);
    }

    lume_net_http_response_t resp;
    int r = lume_net_http_get(url, timeout_ms, &resp);
    JS_FreeCString(ctx, url);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }

    /* JS_NewStringLen / JS_NewArrayBufferCopy COPY the bytes, so the native
     * heap body can be freed right after building the JS value. A zero-length
     * body still needs a non-NULL source pointer. */
    const uint8_t *body = resp.body != NULL ? resp.body : (const uint8_t *)"";
    JSValue body_val = as_arraybuffer
        ? JS_NewArrayBufferCopy(ctx, body, resp.body_len)
        : JS_NewStringLen(ctx, (const char *)body, resp.body_len);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "status", JS_NewInt32(ctx, resp.status));
    JS_SetPropertyStr(ctx, obj, "body", body_val);
    JS_SetPropertyStr(ctx, obj, "contentLength",
                      JS_NewInt64(ctx, resp.content_length));
    JS_SetPropertyStr(ctx, obj, "truncated", JS_NewBool(ctx, resp.truncated));
    lume_net_http_free(&resp);
    return obj;
}

/* Synchronous bounded HTTP request. All borrowed JS strings stay live until perform returns. */
static JSValue js_net_http_request(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc != 1 || !JS_IsObject(argv[0])) return JS_NewInt32(ctx, LUME_NET_ERR_ARG);
    JSValue urlv = JS_GetPropertyStr(ctx, argv[0], "url");
    JSValue methodv = JS_GetPropertyStr(ctx, argv[0], "method");
    JSValue headersv = JS_GetPropertyStr(ctx, argv[0], "headers");
    JSValue bodyv = JS_GetPropertyStr(ctx, argv[0], "body");
    JSValue timeoutv = JS_GetPropertyStr(ctx, argv[0], "timeoutMs");
    JSValue cav = JS_GetPropertyStr(ctx, argv[0], "caPem");
    JSValue insecurev = JS_GetPropertyStr(ctx, argv[0], "httpsInsecure");
    const char *url = NULL, *method = "GET", *ca = NULL;
    const char *names[LUME_HTTP_HEADER_MAX] = {0};
    const char *values[LUME_HTTP_HEADER_MAX] = {0};
    lume_net_http_header_t headers[LUME_HTTP_HEADER_MAX] = {0};
    JSPropertyEnum *props = NULL;
    uint32_t count = 0;
    size_t body_len = 0, len = 0;
    const uint8_t *body = NULL;
    const char *body_string = NULL;
    int32_t timeout = 30000;
    int result = LUME_NET_ERR_ARG;
    bool insecure = false;
    JSValue ret = JS_UNDEFINED;
    if (!JS_IsString(urlv)) goto done;
    url = JS_ToCStringLen(ctx, &len, urlv);
    if (!url || memchr(url, 0, len)) goto done;
    if (!JS_IsUndefined(methodv)) {
        if (!JS_IsString(methodv)) goto done;
        method = JS_ToCString(ctx, methodv);
        if (!method) goto done;
    }
    if (!JS_IsUndefined(timeoutv) && JS_ToInt32(ctx, &timeout, timeoutv) < 0) goto done;
    if (!JS_IsUndefined(cav) && !JS_IsNull(cav)) {
        if (!JS_IsString(cav)) goto done;
        ca = JS_ToCString(ctx, cav);
        if (!ca || !strstr(ca, "-----BEGIN CERTIFICATE-----")) goto done;
    }
    if (!JS_IsUndefined(insecurev)) insecure = JS_ToBool(ctx, insecurev) == 1;
    if (!JS_IsUndefined(bodyv) && !JS_IsNull(bodyv)) {
        if (JS_IsString(bodyv)) {
            body_string = JS_ToCStringLen(ctx, &body_len, bodyv);
            body = (const uint8_t *)body_string;
        } else body = JS_GetArrayBuffer(ctx, &body_len, bodyv);
        if (!body || body_len > LUME_HTTP_REQUEST_MAX) goto done;
    }
    if (!JS_IsUndefined(headersv) && !JS_IsNull(headersv)) {
        if (!JS_IsObject(headersv) || JS_GetOwnPropertyNames(ctx, &props, &count,
                headersv, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0 ||
            count > LUME_HTTP_HEADER_MAX) goto done;
        for (uint32_t i = 0; i < count; i++) {
            JSValue hv = JS_GetProperty(ctx, headersv, props[i].atom);
            names[i] = JS_AtomToCString(ctx, props[i].atom);
            if (JS_IsString(hv)) values[i] = JS_ToCString(ctx, hv);
            JS_FreeValue(ctx, hv);
            if (!names[i] || !values[i] || strchr(names[i], '\r') ||
                strchr(names[i], '\n') || strchr(names[i], ':') ||
                strchr(values[i], '\r') || strchr(values[i], '\n')) goto done;
            headers[i] = (lume_net_http_header_t){ names[i], values[i] };
        }
    }
    lume_net_http_response_t resp;
    result = lume_net_http_request(url, method, headers, count, body, body_len,
                                   timeout, ca, insecure, &resp);
    if (result == 0) {
        JSValue obj = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, obj, "status", JS_NewInt32(ctx, resp.status));
        JS_SetPropertyStr(ctx, obj, "body", JS_NewStringLen(ctx,
                (const char *)resp.body, resp.body_len));
        JS_SetPropertyStr(ctx, obj, "contentLength", JS_NewInt64(ctx, resp.content_length));
        JS_SetPropertyStr(ctx, obj, "truncated", JS_NewBool(ctx, resp.truncated));
        lume_net_http_free(&resp);
        ret = obj;
    }
done:
    for (uint32_t i = 0; i < count; i++) {
        if (i < LUME_HTTP_HEADER_MAX && names[i]) JS_FreeCString(ctx, names[i]);
        if (i < LUME_HTTP_HEADER_MAX && values[i]) JS_FreeCString(ctx, values[i]);
        if (props) JS_FreeAtom(ctx, props[i].atom);
    }
    if (props) js_free(ctx, props);
    if (url) JS_FreeCString(ctx, url);
    if (!JS_IsUndefined(methodv) && method) JS_FreeCString(ctx, method);
    if (ca) JS_FreeCString(ctx, ca);
    if (body_string) JS_FreeCString(ctx, body_string);
    JS_FreeValue(ctx, urlv); JS_FreeValue(ctx, methodv);
    JS_FreeValue(ctx, headersv); JS_FreeValue(ctx, bodyv);
    JS_FreeValue(ctx, timeoutv); JS_FreeValue(ctx, cav); JS_FreeValue(ctx, insecurev);
    return JS_IsUndefined(ret) ? JS_NewInt32(ctx, result) : ret;
}

/* lume.ble natives (r25): NimBLE GATT peripheral, hardware in lume-ble.
 * Same thread discipline as lume.net: natives run ONLY on the engine task,
 * lume-ble is QuickJS-free and returns an int status (0 = OK, negative =
 * error code, see lume_ble.h). The radio is started LAZILY by start()/init()
 * (like lume.audio), so register_bindings() does not switch on Bluetooth for
 * apps that never use it. A failed init is non-fatal and degrades every
 * entry point to -3. No device name / BLE payload is ever logged.
 *
 * status() returns an OBJECT on success and a negative NUMBER on failure;
 * read() returns a STRING, null for an empty rx queue, or a negative NUMBER.
 * init/start/stop/write return the int status directly. */
static JSValue js_ble_init(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_ble_init());
}

static JSValue js_ble_start(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv)
{
    (void)this_val;
    /* name is optional; NULL keeps the current/default name ("Lume"). */
    if (argc < 1 || JS_IsUndefined(argv[0]) || JS_IsNull(argv[0])) {
        return JS_NewInt32(ctx, lume_ble_start(NULL, 0));
    }
    size_t len = 0;
    const char *name = JS_ToCStringLen(ctx, &len, argv[0]);
    if (name == NULL) {
        return JS_EXCEPTION;
    }
    int r = lume_ble_start(name, len);
    JS_FreeCString(ctx, name);
    return JS_NewInt32(ctx, r);
}

static JSValue js_ble_stop(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_ble_stop());
}

static JSValue js_ble_status(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    lume_ble_status_t st;
    int r = lume_ble_status(&st);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "state", JS_NewInt32(ctx, (int32_t)st.state));
    JS_SetPropertyStr(ctx, obj, "connected", JS_NewBool(ctx, st.connected));
    JS_SetPropertyStr(ctx, obj, "subscribed", JS_NewBool(ctx, st.subscribed));
    JS_SetPropertyStr(ctx, obj, "mtu", JS_NewInt32(ctx, st.mtu));
    JS_SetPropertyStr(ctx, obj, "pending", JS_NewInt32(ctx, st.pending));
    return obj;
}

static JSValue js_ble_write(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv)
{
    (void)this_val;
    if (argc < 1) {
        return JS_ThrowTypeError(ctx, "lume.ble.write: expected 1 argument (data)");
    }
    /* Real UTF-8 byte length; lume-ble caps it at LUME_BLE_PAYLOAD_MAX (20)
     * and rejects an embedded NUL, same policy as lume.net.connect(). */
    size_t len = 0;
    const char *data = JS_ToCStringLen(ctx, &len, argv[0]);
    if (data == NULL) {
        return JS_EXCEPTION;
    }
    if (memchr(data, '\0', len) != NULL) {
        JS_FreeCString(ctx, data);
        return JS_NewInt32(ctx, LUME_BLE_ERR_ARG);
    }
    int r = lume_ble_write((const uint8_t *)data, len);
    JS_FreeCString(ctx, data);
    return JS_NewInt32(ctx, r);
}

static JSValue js_ble_read(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    (void)this_val; (void)argc; (void)argv;
    uint8_t buf[LUME_BLE_PAYLOAD_MAX];
    size_t len = 0;
    int r = lume_ble_read(buf, sizeof buf, &len);
    if (r < 0) {
        return JS_NewInt32(ctx, r);
    }
    if (r == 0) {
        return JS_NULL;
    }
    return JS_NewStringLen(ctx, (const char *)buf, len);
}

static JSValue js_audio_play(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.audio.play: expected ArrayBuffer");
    size_t len = 0;
    uint8_t *data = JS_GetArrayBuffer(ctx, &len, argv[0]);
    if (!data) return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG);
    if (argc > 1 && JS_IsObject(argv[1])) {
        const char *names[] = {"sampleRate", "channels", "bits"};
        const int expected[] = {16000, 2, 16};
        for (int i = 0; i < 3; ++i) {
            JSValue v = JS_GetPropertyStr(ctx, argv[1], names[i]);
            if (JS_IsException(v)) return JS_EXCEPTION;
            if (!JS_IsUndefined(v)) {
                int32_t n;
                if (JS_ToInt32(ctx, &n, v) < 0) { JS_FreeValue(ctx, v); return JS_EXCEPTION; }
                if (n != expected[i]) { JS_FreeValue(ctx, v); return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG); }
            }
            JS_FreeValue(ctx, v);
        }
    }
    return JS_NewInt32(ctx, lume_audio_play(data, len));
}

/* QuickJS-NG calls realloc_func(ptr, 0) on finalization and detach.
 * This buffer is fixed-size; nonzero resize requests are refused. */
static void *record_pcm_realloc(JSRuntime *rt, void *opaque, void *ptr, size_t size)
{
    (void)rt; (void)opaque;
    if (size == 0) heap_caps_free(ptr);
    return NULL;
}

static JSValue js_audio_record(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.audio.record: expected seconds");
    double seconds;
    if (JS_ToFloat64(ctx, &seconds, argv[0]) < 0) return JS_EXCEPTION;
    if (!(seconds > 0 && seconds <= 10)) return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG);
    if (argc > 1 && JS_IsObject(argv[1])) {
        const char *names[] = {"sampleRate", "channels", "bits"};
        const int expected[] = {16000, 2, 16};
        for (int i = 0; i < 3; ++i) {
            JSValue v = JS_GetPropertyStr(ctx, argv[1], names[i]);
            if (JS_IsException(v)) return JS_EXCEPTION;
            if (!JS_IsUndefined(v)) {
                int32_t n;
                if (JS_ToInt32(ctx, &n, v) < 0) { JS_FreeValue(ctx, v); return JS_EXCEPTION; }
                if (n != expected[i]) { JS_FreeValue(ctx, v); return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG); }
            }
            JS_FreeValue(ctx, v);
        }
    }
    size_t frames = (size_t)(seconds * 16000);
    if (!frames) return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG);
    size_t bytes = frames * 4;
    uint8_t *pcm = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
    if (!pcm) return JS_NewInt32(ctx, LUME_AUDIO_ERR_MEMORY);
    int r = lume_audio_record(pcm, bytes);
    if (r < 0) { heap_caps_free(pcm); return JS_NewInt32(ctx, r); }
    JSValue result = JS_NewArrayBuffer(ctx, pcm, bytes, 0,
                                       record_pcm_realloc, NULL, false);
    /* Constructor failure happens before ownership transfer. */
    if (JS_IsException(result)) heap_caps_free(pcm);
    return result;
}

static JSValue js_audio_volume(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 1) return JS_ThrowTypeError(ctx, "lume.audio.setVolume: expected percent");
    int32_t n;
    if (JS_ToInt32(ctx, &n, argv[0]) < 0) return JS_EXCEPTION;
    if (n < 0 || n > 100) return JS_NewInt32(ctx, LUME_AUDIO_ERR_ARG);
    int r = lume_audio_init();
    return JS_NewInt32(ctx, r < 0 ? r : lume_audio_set_volume(n));
}

static JSValue js_audio_stop(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    return JS_NewInt32(ctx, lume_audio_stop());
}

static JSValue js_audio_play_stream(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 2) return JS_ThrowTypeError(ctx, "playStream: expected PCM and options");
    size_t len;
    uint8_t *data=JS_GetArrayBuffer(ctx,&len,argv[0]);
    if (!data || !JS_IsObject(argv[1])) return JS_NewInt32(ctx,LUME_AUDIO_ERR_ARG);
    const char *names[]={"sampleRate","channels","bits"};
    int32_t values[3];
    for (int i=0;i<3;i++) {
        JSValue v=JS_GetPropertyStr(ctx,argv[1],names[i]);
        if (JS_IsException(v)) return JS_EXCEPTION;
        if (JS_ToInt32(ctx,&values[i],v)<0) { JS_FreeValue(ctx,v); return JS_EXCEPTION; }
        JS_FreeValue(ctx,v);
    }
    return JS_NewInt32(ctx,lume_audio_play_stream(data,len,values[0],values[1],values[2]));
}
static JSValue js_audio_stream_finished(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{ (void)self; (void)argc; (void)argv; return JS_NewBool(ctx,lume_audio_stream_finished()); }
static JSValue js_audio_stream_pause(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{ (void)self; if (argc<1) return JS_ThrowTypeError(ctx,"streamPause: expected bool"); return JS_NewInt32(ctx,lume_audio_stream_pause(JS_ToBool(ctx,argv[0]))); }
static JSValue js_audio_stream_reset(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{ (void)self; (void)argc; (void)argv; return JS_NewInt32(ctx,lume_audio_stream_reset()); }

static mp3_decoder_t *s_mp3;
static JSValue js_mp3_open(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc<1) return JS_ThrowTypeError(ctx,"mp3.open: expected path");
    const char *path=JS_ToCString(ctx,argv[0]);
    if (!path) return JS_EXCEPTION;
    mp3_decoder_close(s_mp3); s_mp3=NULL;
    int r=mp3_decoder_open(path,&s_mp3);
    JS_FreeCString(ctx,path);
    return JS_NewInt32(ctx,r);
}
static JSValue js_mp3_decode(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    if (!s_mp3) return JS_NewInt32(ctx,-3);
    int16_t pcm[2304]; /* minimp3 maximum: 1152 stereo samples */
    mp3_frame_info_t info;
    int r=mp3_decoder_decode(s_mp3,pcm,&info);
    if (r<=0) return r<0 ? JS_NewInt32(ctx,r) : JS_NULL;
    JSValue obj=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,obj,"pcm",JS_NewArrayBufferCopy(ctx,(uint8_t *)pcm,
                        (size_t)info.samples*info.channels*2));
    JS_SetPropertyStr(ctx,obj,"sampleRate",JS_NewInt32(ctx,info.sample_rate));
    JS_SetPropertyStr(ctx,obj,"channels",JS_NewInt32(ctx,info.channels));
    JS_SetPropertyStr(ctx,obj,"bitrateKbps",JS_NewInt32(ctx,info.bitrate_kbps));
    JS_SetPropertyStr(ctx,obj,"byteOffset",JS_NewInt64(ctx,info.byte_offset));
    JS_SetPropertyStr(ctx,obj,"fileBytes",JS_NewInt64(ctx,info.file_bytes));
    JS_SetPropertyStr(ctx,obj,"samples",JS_NewInt32(ctx,info.samples));
    return obj;
}
static JSValue js_mp3_close(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{ (void)self; (void)argc; (void)argv; mp3_decoder_close(s_mp3); s_mp3=NULL; return JS_NewInt32(ctx,0); }
typedef struct { JSContext *ctx; JSValue array; uint32_t count; } mp3_list_ctx_t;
static void mp3_list_emit(void *arg,const char *name)
{ mp3_list_ctx_t *c=arg; JS_SetPropertyUint32(c->ctx,c->array,c->count++,JS_NewString(c->ctx,name)); }
static JSValue js_mp3_list(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc<1) return JS_ThrowTypeError(ctx,"mp3.list: expected directory");
    const char *path=JS_ToCString(ctx,argv[0]);
    if (!path) return JS_EXCEPTION;
    mp3_list_ctx_t c={ctx,JS_NewArray(ctx),0};
    int r=mp3_decoder_list(path,mp3_list_emit,&c);
    JS_FreeCString(ctx,path);
    if (r<0) { JS_FreeValue(ctx,c.array); return JS_NewInt32(ctx,r); }
    return c.array;
}
static JSValue js_mp3_read_text(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc<1) return JS_ThrowTypeError(ctx,"mp3.readText: expected path");
    const char *path=JS_ToCString(ctx,argv[0]);
    if (!path) return JS_EXCEPTION;
    char *buf=malloc(32768);
    if (!buf) { JS_FreeCString(ctx,path); return JS_NewInt32(ctx,-4); }
    int r=mp3_decoder_read_text(path,buf,32768);
    JS_FreeCString(ctx,path);
    JSValue ret=r<0 ? JS_NewInt32(ctx,r) : JS_NewStringLen(ctx,buf,r);
    free(buf);
    return ret;
}
static JSValue js_mp3_id3v1(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc<1) return JS_ThrowTypeError(ctx,"mp3.id3v1: expected path");
    const char *path=JS_ToCString(ctx,argv[0]);
    if (!path) return JS_EXCEPTION;
    char title[61],artist[61];
    int r=mp3_decoder_id3v1(path,title,artist);
    JS_FreeCString(ctx,path);
    if (r<0) return JS_NewInt32(ctx,r);
    if (!r) return JS_NULL;
    JSValue obj=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,obj,"title",JS_NewString(ctx,title));
    JS_SetPropertyStr(ctx,obj,"artist",JS_NewString(ctx,artist));
    return obj;
}

static JSValue js_mp3_id3v2(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc<1) return JS_ThrowTypeError(ctx,"mp3.id3v2: expected path");
    const char *path=JS_ToCString(ctx,argv[0]);
    if (!path) return JS_EXCEPTION;
    char title[128],artist[128],album[128];
    int r=mp3_decoder_id3v2(path,title,artist,album);
    JS_FreeCString(ctx,path);
    if (r<0) return JS_NewInt32(ctx,r);
    if (!r) return JS_NULL;
    JSValue obj=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,obj,"title",JS_NewString(ctx,title));
    JS_SetPropertyStr(ctx,obj,"artist",JS_NewString(ctx,artist));
    JS_SetPropertyStr(ctx,obj,"album",JS_NewString(ctx,album));
    return obj;
}

static void register_bindings(JSContext *ctx)
{
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue lume = JS_NewObject(ctx);
    /* JS_SetPropertyStr consumes the passed value (no JS_FreeValue needed). */
    JS_SetPropertyStr(ctx, lume, "createNode",
                      JS_NewCFunction(ctx, js_create_node, "createNode", 2));
    JS_SetPropertyStr(ctx, lume, "canvasDraw", JS_NewCFunction(ctx, js_canvas_draw, "canvasDraw", 9));
    JS_SetPropertyStr(ctx, lume, "canvasBatch", JS_NewCFunction(ctx, js_canvas_batch, "canvasBatch", 2));
    JS_SetPropertyStr(ctx, lume, "canvasPathDefine",
                      JS_NewCFunction(ctx, js_canvas_path_define, "canvasPathDefine", 3));
    JS_SetPropertyStr(ctx, lume, "canvasPathDraw",
                      JS_NewCFunction(ctx, js_canvas_path_draw, "canvasPathDraw", 4));
    JS_SetPropertyStr(ctx, lume, "canvasInvalidate", JS_NewCFunction(ctx, js_canvas_invalidate, "canvasInvalidate", 1));
    JSValue image = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, image, "sizeOf", JS_NewCFunction(ctx, js_image_size_of, "sizeOf", 1));
    JS_SetPropertyStr(ctx, image, "_setSource", JS_NewCFunction(ctx, js_image_set_source, "_setSource", 2));
    JS_SetPropertyStr(ctx, lume, "image", image);
    JS_SetPropertyStr(ctx, lume, "setAttr",
                      JS_NewCFunction(ctx, js_set_attr, "setAttr", 3));
    JS_SetPropertyStr(ctx, lume, "nativeAnimate",
                      JS_NewCFunction(ctx, js_animate, "nativeAnimate", 6));
    JS_SetPropertyStr(ctx, lume, "nativeAnimateCancel",
                      JS_NewCFunction(ctx, js_animate_cancel, "nativeAnimateCancel", 2));
    JS_SetPropertyStr(ctx, lume, "setPressEvent",
                      JS_NewCFunction(ctx, js_set_press_event, "setPressEvent", 1));
    JS_SetPropertyStr(ctx, lume, "setGestureEvent",
                      JS_NewCFunction(ctx, js_set_gesture_event, "setGestureEvent", 1));
    JS_SetPropertyStr(ctx, lume, "removeChild",
                      JS_NewCFunction(ctx, js_remove_child, "removeChild", 1));
    JS_SetPropertyStr(ctx, lume, "_nowMs", JS_NewCFunction(ctx, js_now_ms, "_nowMs", 0));
    JSValue power = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, power, "_sleepNow", JS_NewCFunction(ctx, js_power_sleep_now, "_sleepNow", 0));
    JS_SetPropertyStr(ctx, power, "_wake", JS_NewCFunction(ctx, js_power_wake, "_wake", 0));
    JS_SetPropertyStr(ctx, lume, "power", power);
    JS_SetPropertyStr(ctx, lume, "log",
                      JS_NewCFunction(ctx, js_log, "log", 1));
    JS_SetPropertyStr(ctx, lume, "warn",
                      JS_NewCFunction(ctx, js_warn, "warn", 1));
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
    /* lume.adc: built inline on the `lume` object, mirroring lume.gpio above
     * (natives self-register, so the prelude needs no change).
     * JS_SetPropertyStr consumes `adc`. */
    JSValue adc = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, adc, "config",
                      JS_NewCFunction(ctx, js_adc_config, "config", 2));
    JS_SetPropertyStr(ctx, adc, "readRaw",
                      JS_NewCFunction(ctx, js_adc_read_raw, "readRaw", 1));
    JS_SetPropertyStr(ctx, adc, "readMv",
                      JS_NewCFunction(ctx, js_adc_read_mv, "readMv", 1));
    JS_SetPropertyStr(ctx, adc, "free",
                      JS_NewCFunction(ctx, js_adc_free, "free", 1));
    JS_SetPropertyStr(ctx, lume, "adc", adc);
    /* lume.pmic: built inline on the `lume` object, mirroring lume.gpio /
     * lume.adc above (natives self-register, so the prelude needs no change).
     * One-time AXP2101 init is idempotent across hot-reload runtime resets
     * and non-fatal (no board -> every binding returns -3).
     * JS_SetPropertyStr consumes `pmic`. */
    lume_pmic_hw_init();
    JSValue pmic = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, pmic, "battVoltageMv",
                      JS_NewCFunction(ctx, js_pmic_batt_voltage_mv, "battVoltageMv", 0));
    JS_SetPropertyStr(ctx, pmic, "battPercent",
                      JS_NewCFunction(ctx, js_pmic_batt_percent, "battPercent", 0));
    JS_SetPropertyStr(ctx, pmic, "vbusVoltageMv",
                      JS_NewCFunction(ctx, js_pmic_vbus_voltage_mv, "vbusVoltageMv", 0));
    JS_SetPropertyStr(ctx, pmic, "usbConnected",
                      JS_NewCFunction(ctx, js_pmic_usb_connected, "usbConnected", 0));
    JS_SetPropertyStr(ctx, pmic, "chargingStatus",
                      JS_NewCFunction(ctx, js_pmic_charging_status, "chargingStatus", 0));
    JS_SetPropertyStr(ctx, pmic, "dieTempRaw",
                      JS_NewCFunction(ctx, js_pmic_die_temp_raw, "dieTempRaw", 0));
    JS_SetPropertyStr(ctx, pmic, "powerOff",
                      JS_NewCFunction(ctx, js_pmic_power_off, "powerOff", 0));
    JS_SetPropertyStr(ctx, lume, "pmic", pmic);
    /* lume.imu: built inline on the `lume` object, mirroring lume.pmic above
     * (natives self-register, so the prelude needs no change). One-time
     * QMI8658 init is idempotent across hot-reload runtime resets and
     * non-fatal: with no board / undetected IMU, read() returns null and
     * onMotion() returns -4. JS_SetPropertyStr consumes `imu`. */
    lume_imu_hw_init();
    JSValue imu = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, imu, "read",
                      JS_NewCFunction(ctx, js_imu_read, "read", 0));
    JS_SetPropertyStr(ctx, imu, "onMotion",
                      JS_NewCFunction(ctx, js_imu_on_motion, "onMotion", 1));
    JS_SetPropertyStr(ctx, lume, "imu", imu);
    /* lume.storage.kv (M2 / r10): NVS-backed persistent KV store, hw in
     * lume-storage. Nested one level deeper than gpio/adc/pmic/imu: the
     * module layout reserves lume.storage for Kv (this round) and Fs
     * (LittleFS, a LATER round). Natives self-register, so the prelude needs
     * no change. One-time nvs_flash_init + nvs_open is idempotent across
     * hot-reload runtime resets and non-fatal: with no NVS partition (or a
     * failed init) every kv call returns -3. JS_SetPropertyStr consumes both
     * `kv` and `storage`. */
    lume_kv_init();
    JSValue storage = JS_NewObject(ctx);
    JSValue kv = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, kv, "set",
                      JS_NewCFunction(ctx, js_kv_set, "set", 2));
    JS_SetPropertyStr(ctx, kv, "get",
                      JS_NewCFunction(ctx, js_kv_get, "get", 1));
    JS_SetPropertyStr(ctx, kv, "remove",
                      JS_NewCFunction(ctx, js_kv_remove, "remove", 1));
    JS_SetPropertyStr(ctx, kv, "keys",
                      JS_NewCFunction(ctx, js_kv_keys, "keys", 0));
    JS_SetPropertyStr(ctx, kv, "clear",
                      JS_NewCFunction(ctx, js_kv_clear, "clear", 0));
    JS_SetPropertyStr(ctx, storage, "kv", kv);
    lume_fs_init();
    JSValue fs = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, fs, "write", JS_NewCFunction(ctx, js_fs_write, "write", 2));
    JS_SetPropertyStr(ctx, fs, "append", JS_NewCFunction(ctx, js_fs_append, "append", 2));
    JS_SetPropertyStr(ctx, fs, "read", JS_NewCFunction(ctx, js_fs_read, "read", 1));
    JS_SetPropertyStr(ctx, fs, "readBinary", JS_NewCFunction(ctx, js_fs_read_binary, "readBinary", 1));
    JS_SetPropertyStr(ctx, fs, "remove", JS_NewCFunction(ctx, js_fs_remove, "remove", 1));
    JS_SetPropertyStr(ctx, fs, "mkdir", JS_NewCFunction(ctx, js_fs_mkdir, "mkdir", 1));
    JS_SetPropertyStr(ctx, fs, "exists", JS_NewCFunction(ctx, js_fs_exists, "exists", 1));
    JS_SetPropertyStr(ctx, fs, "list", JS_NewCFunction(ctx, js_fs_list, "list", 1));
    JS_SetPropertyStr(ctx, fs, "mounted", JS_NewCFunction(ctx, js_fs_mounted, "mounted", 0));
    JS_SetPropertyStr(ctx, storage, "Fs", fs);
    JS_SetPropertyStr(ctx, lume, "storage", storage);
    /* lume.apps (r30): multi-app store + launch. Mounts LittleFS through
     * lume_apps_init(); an unmounted store makes list() return -3 and keeps
     * the single embedded demo running exactly as before. */
    lume_apps_init();
    JSValue apps = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, apps, "list",
                      JS_NewCFunction(ctx, js_apps_list, "list", 0));
    JS_SetPropertyStr(ctx, apps, "meta",
                      JS_NewCFunction(ctx, js_apps_meta, "meta", 1));
    JS_SetPropertyStr(ctx, apps, "current",
                      JS_NewCFunction(ctx, js_apps_current, "current", 0));
    JS_SetPropertyStr(ctx, apps, "launch",
                      JS_NewCFunction(ctx, js_apps_launch, "launch", 1));
    JS_SetPropertyStr(ctx, apps, "home",
                      JS_NewCFunction(ctx, js_apps_home, "home", 0));
    JS_SetPropertyStr(ctx, apps, "setBoot",
                      JS_NewCFunction(ctx, js_apps_set_boot, "setBoot", 1));
    JS_SetPropertyStr(ctx, apps, "remove",
                      JS_NewCFunction(ctx, js_apps_remove, "remove", 1));
    JS_SetPropertyStr(ctx, apps, "mounted",
                      JS_NewCFunction(ctx, js_apps_mounted, "mounted", 0));
    JS_SetPropertyStr(ctx, lume, "apps", apps);
    /* lume.net + lume.net.http (M2 / r11): WiFi station + HTTP client, hw in
     * lume-net. Natives self-register, so the prelude needs no change.
     * One-time lume_net_init() is idempotent across hot-reload runtime resets
     * (a successful init latches; a failed init is non-fatal and makes every
     * net API return -3, like lume.storage.kv). `httpGet` on lume.net is the
     * primary shape from the brief; lume.net.http.get is the SAME native under
     * the reserved `http` sub-namespace (brief task 3). JS_SetPropertyStr
     * consumes `net` and `http`. */
    lume_net_init();
    JSValue net = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, net, "init",
                      JS_NewCFunction(ctx, js_net_init, "init", 0));
    JS_SetPropertyStr(ctx, net, "deinit",
                      JS_NewCFunction(ctx, js_net_deinit, "deinit", 0));
    JS_SetPropertyStr(ctx, net, "connect",
                      JS_NewCFunction(ctx, js_net_connect, "connect", 2));
    JS_SetPropertyStr(ctx, net, "disconnect",
                      JS_NewCFunction(ctx, js_net_disconnect, "disconnect", 0));
    JS_SetPropertyStr(ctx, net, "status",
                      JS_NewCFunction(ctx, js_net_status, "status", 0));
    JS_SetPropertyStr(ctx, net, "otaStatus",
                      JS_NewCFunction(ctx, js_net_ota_status, "otaStatus", 0));
    JS_SetPropertyStr(ctx, net, "scan",
                      JS_NewCFunction(ctx, js_net_scan, "scan", 0));
    JS_SetPropertyStr(ctx, net, "httpRequest",
                      JS_NewCFunction(ctx, js_net_http_request, "httpRequest", 1));
    JS_SetPropertyStr(ctx, net, "httpGet",
                      JS_NewCFunction(ctx, js_net_http_get, "httpGet", 1));
    /* The status() state enum, exposed as named numeric constants (mirrors
     * lume_net.h lume_net_state_t) so JS never hard-codes 0..3. */
    JS_SetPropertyStr(ctx, net, "DISCONNECTED",
                      JS_NewInt32(ctx, LUME_NET_DISCONNECTED));
    JS_SetPropertyStr(ctx, net, "CONNECTING",
                      JS_NewInt32(ctx, LUME_NET_CONNECTING));
    JS_SetPropertyStr(ctx, net, "CONNECTED",
                      JS_NewInt32(ctx, LUME_NET_CONNECTED));
    JS_SetPropertyStr(ctx, net, "GOT_IP",
                      JS_NewInt32(ctx, LUME_NET_GOT_IP));
    JSValue http = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, http, "get",
                      JS_NewCFunction(ctx, js_net_http_get, "get", 1));
    JS_SetPropertyStr(ctx, net, "http", http);
    JS_SetPropertyStr(ctx, lume, "net", net);
    JSValue audio = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, audio, "play", JS_NewCFunction(ctx, js_audio_play, "play", 2));
    JS_SetPropertyStr(ctx, audio, "record", JS_NewCFunction(ctx, js_audio_record, "record", 2));
    JS_SetPropertyStr(ctx, audio, "setVolume", JS_NewCFunction(ctx, js_audio_volume, "setVolume", 1));
    JS_SetPropertyStr(ctx, audio, "stop", JS_NewCFunction(ctx, js_audio_stop, "stop", 0));
    JS_SetPropertyStr(ctx, audio, "playStream", JS_NewCFunction(ctx, js_audio_play_stream, "playStream", 2));
    JS_SetPropertyStr(ctx, audio, "streamFinished", JS_NewCFunction(ctx, js_audio_stream_finished, "streamFinished", 0));
    JS_SetPropertyStr(ctx, audio, "streamPause", JS_NewCFunction(ctx, js_audio_stream_pause, "streamPause", 1));
    JS_SetPropertyStr(ctx, audio, "streamReset", JS_NewCFunction(ctx, js_audio_stream_reset, "streamReset", 0));
    JSValue mp3 = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, mp3, "open", JS_NewCFunction(ctx, js_mp3_open, "open", 1));
    JS_SetPropertyStr(ctx, mp3, "decode", JS_NewCFunction(ctx, js_mp3_decode, "decode", 0));
    JS_SetPropertyStr(ctx, mp3, "close", JS_NewCFunction(ctx, js_mp3_close, "close", 0));
    JS_SetPropertyStr(ctx, mp3, "list", JS_NewCFunction(ctx, js_mp3_list, "list", 1));
    JS_SetPropertyStr(ctx, mp3, "readText", JS_NewCFunction(ctx, js_mp3_read_text, "readText", 1));
    JS_SetPropertyStr(ctx, mp3, "id3v1", JS_NewCFunction(ctx, js_mp3_id3v1, "id3v1", 1));
    JS_SetPropertyStr(ctx, mp3, "id3v2", JS_NewCFunction(ctx, js_mp3_id3v2, "id3v2", 1));
    JS_SetPropertyStr(ctx, audio, "mp3", mp3);
    JS_SetPropertyStr(ctx, lume, "audio", audio);
    /* lume.ble (r25): NimBLE GATT peripheral (NUS-shaped RX/TX service),
     * hardware in lume-ble. Natives self-register, so the prelude needs no
     * change. Deliberately NO lume_ble_init() here: the stack is started
     * lazily by the app's first start()/init() call, so an app that never
     * uses BLE never switches on the radio. The C stack survives hot reloads
     * (drivers are not restarted); only these JS function objects are new.
     * JS_SetPropertyStr consumes `ble`. */
    JSValue ble = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, ble, "init",
                      JS_NewCFunction(ctx, js_ble_init, "init", 0));
    JS_SetPropertyStr(ctx, ble, "start",
                      JS_NewCFunction(ctx, js_ble_start, "start", 1));
    JS_SetPropertyStr(ctx, ble, "stop",
                      JS_NewCFunction(ctx, js_ble_stop, "stop", 0));
    JS_SetPropertyStr(ctx, ble, "status",
                      JS_NewCFunction(ctx, js_ble_status, "status", 0));
    JS_SetPropertyStr(ctx, ble, "write",
                      JS_NewCFunction(ctx, js_ble_write, "write", 1));
    JS_SetPropertyStr(ctx, ble, "read",
                      JS_NewCFunction(ctx, js_ble_read, "read", 0));
    JS_SetPropertyStr(ctx, ble, "IDLE", JS_NewInt32(ctx, LUME_BLE_IDLE));
    JS_SetPropertyStr(ctx, ble, "ADVERTISING",
                      JS_NewInt32(ctx, LUME_BLE_ADVERTISING));
    JS_SetPropertyStr(ctx, ble, "CONNECTED",
                      JS_NewInt32(ctx, LUME_BLE_CONNECTED));
    JS_SetPropertyStr(ctx, ble, "MAX_PAYLOAD",
                      JS_NewInt32(ctx, LUME_BLE_PAYLOAD_MAX));
    JS_SetPropertyStr(ctx, lume, "ble", ble);
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

void lume_engine_post_scroll(uint16_t node_id, int32_t y)
{
    lume_engine_evt_t evt = { .type = LUME_EVT_SCROLL, .node_id = node_id, .scroll_y = y };
    if (s_evt_queue == NULL || xQueueSend(s_evt_queue, &evt, 0) != pdTRUE) {
        s_evt_dropped++;
        if (s_evt_dropped == 1 || (s_evt_dropped % EVT_DROP_LOG_EVERY) == 0)
            ESP_LOGW(TAG, "scroll id=%u dropped: evt queue full (%u total drops)",
                     (unsigned)node_id, (unsigned)s_evt_dropped);
    }
}

/* r21 review fix (P2): gesture MOVE events are lossy-by-design (the pure JS
 * state machine tolerates dropped MOVEs -- thresholds re-evaluate on the next
 * sample), but UP (panend/tap/swipe), DOWN and PRESS are not. When the shared
 * Queue B is full, a MOVE is dropped FIRST instead of evicting the head;
 * non-MOVE events (UP/DOWN/PRESS/ANIM_COMPLETE/...) still post at the head so
 * a stalled engine cannot lose releases because of PRESSING traffic. */
void lume_engine_post_gesture(uint16_t node_id, uint8_t kind, int16_t x, int16_t y,
                              uint32_t t, uint8_t dir, uint8_t cancelled)
{
    lume_engine_evt_t evt = {
        .type = LUME_EVT_GESTURE,
        .node_id = node_id,
        .g_kind = kind,
        .g_x = x, .g_y = y,
        .g_t = t,
        .g_dir = dir,
        .g_cancelled = cancelled,
    };
    if (s_evt_queue == NULL) {
        s_evt_dropped++;
        return;
    }
    if (kind == 1 && uxQueueSpacesAvailable(s_evt_queue) <= 4) {
        /* Keep four slots for DOWN/UP and other critical events. MOVE is
         * lossy; critical events must preserve FIFO and be delivered. */
        s_evt_dropped++;
        if (s_evt_dropped == 1 || (s_evt_dropped % EVT_DROP_LOG_EVERY) == 0)
            ESP_LOGW(TAG, "gesture-MOVE id=%u dropped: evt queue full (%u total drops)",
                     (unsigned)node_id, (unsigned)s_evt_dropped);
        return;
    }
    if (kind == 1) {
        /* Normal MOVE: to the tail. */
        if (xQueueSend(s_evt_queue, &evt, 0) != pdTRUE) {
            s_evt_dropped++;
            if (s_evt_dropped == 1 || (s_evt_dropped % EVT_DROP_LOG_EVERY) == 0)
                ESP_LOGW(TAG, "gesture id=%u dropped: evt queue full (%u total drops)",
                         (unsigned)node_id, (unsigned)s_evt_dropped);
        }
        return;
    }
    /* A release must never disappear: wait for the engine to drain if the
     * reserved capacity is exhausted. Queue B's consumer does not need the
     * LVGL lock, so it can keep making progress while this task waits. */
    xQueueSend(s_evt_queue, &evt, portMAX_DELAY);
}

static void dispatch_scroll(uint16_t node_id, int32_t y)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchScroll");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue args[2] = {JS_NewInt32(s_ctx, node_id), JS_NewInt32(s_ctx, y)};
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 2, args);
        if (JS_IsException(ret)) dump_js_exception(s_ctx, "__lume_dispatchScroll");
        JS_FreeValue(s_ctx, ret);
        JS_FreeValue(s_ctx, args[0]); JS_FreeValue(s_ctx, args[1]);
    }
    JS_FreeValue(s_ctx, fn); JS_FreeValue(s_ctx, global);
}

/* r21: Queue B gesture input -> __lume_dispatchGesture (JS state machine). */
static void dispatch_gesture(const lume_engine_evt_t *e)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchGesture");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue args[7] = {
            JS_NewInt32(s_ctx, e->node_id),
            JS_NewInt32(s_ctx, e->g_kind),
            JS_NewInt32(s_ctx, e->g_x),
            JS_NewInt32(s_ctx, e->g_y),
            JS_NewUint32(s_ctx, e->g_t),
            JS_NewInt32(s_ctx, e->g_dir),
            JS_NewInt32(s_ctx, e->g_cancelled),
        };
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 7, args);
        if (JS_IsException(ret)) {
            dump_js_exception(s_ctx, "__lume_dispatchGesture");
        }
        JS_FreeValue(s_ctx, ret);
        for (int i = 0; i < 7; i++) JS_FreeValue(s_ctx, args[i]);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
}

int lume_engine_post_lifecycle(uint8_t type)
{
    lume_engine_evt_t evt = { .type = type };
    return s_evt_queue != NULL && xQueueSend(s_evt_queue, &evt, 0) == pdTRUE ? 0 : -1;
}

int lume_engine_post_back(void)
{
    return lume_engine_post_lifecycle(LUME_EVT_BACK);
}

void lume_engine_post_anim_complete(uint32_t token)
{
    lume_engine_evt_t evt = { .type = LUME_EVT_ANIM_COMPLETE, .token = token };
    if (s_evt_queue == NULL || xQueueSend(s_evt_queue, &evt, 0) != pdTRUE)
        ESP_LOGW(TAG, "animation complete token=%lu dropped: evt queue full",
                 (unsigned long)token);
}

void lume_engine_post_transition_covered(void)
{
    /* r46 Task C: the engine is actively draining Queue B while it waits for
     * this signal, so a bounded timeout is plenty and never blocks the LVGL
     * task for long. */
    lume_engine_evt_t evt = { .type = LUME_EVT_TRANSITION_COVERED };
    if (s_evt_queue == NULL ||
        xQueueSend(s_evt_queue, &evt, pdMS_TO_TICKS(50)) != pdTRUE) {
        ESP_LOGW(TAG, "transition COVERED event dropped: evt queue full");
    }
}
static void dispatch_anim_complete(uint32_t token)
{
    JSValue global = JS_GetGlobalObject(s_ctx);
    JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchAnimComplete");
    if (JS_IsFunction(s_ctx, fn)) {
        JSValue arg = JS_NewUint32(s_ctx, token);
        JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) dump_js_exception(s_ctx, "__lume_dispatchAnimComplete");
        JS_FreeValue(s_ctx, ret);
        JS_FreeValue(s_ctx, arg);
    }
    JS_FreeValue(s_ctx, fn);
    JS_FreeValue(s_ctx, global);
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
static uint32_t s_failed_pending[LUME_RM_WORDS]; /* create failures */

void lume_engine_mark_removed(uint16_t node_id)
{
    if (node_id == 0 || node_id >= LUME_MAX_NODES) {
        return;
    }
    portENTER_CRITICAL(&s_rm_mux);
    s_rm_pending[node_id / 32u] |= 1u << (node_id % 32u);
    portEXIT_CRITICAL(&s_rm_mux);
}

void lume_engine_mark_create_failed(uint16_t node_id)
{
    if (node_id == 0 || node_id >= LUME_MAX_NODES) return;
    portENTER_CRITICAL(&s_rm_mux);
    s_failed_pending[node_id / 32u] |= 1u << (node_id % 32u);
    portEXIT_CRITICAL(&s_rm_mux);
}

/* Engine-task side: snapshot + clear the latch in one critical section,
 * then run __lume_dispatchRemove for each latched id. */
static void drain_removals(void)
{
    uint32_t snap[LUME_RM_WORDS], failed[LUME_RM_WORDS];
    portENTER_CRITICAL(&s_rm_mux);
    for (unsigned i = 0; i < LUME_RM_WORDS; i++) {
        snap[i] = s_rm_pending[i];
        s_rm_pending[i] = 0;
        failed[i] = s_failed_pending[i];
        s_failed_pending[i] = 0;
    }
    portEXIT_CRITICAL(&s_rm_mux);
    for (unsigned w = 0; w < LUME_RM_WORDS; w++) {
        uint32_t bits = snap[w];
        while (bits) {
            unsigned bit = __builtin_ctz(bits);
            bits &= bits - 1;
            dispatch_remove((uint16_t)(w * 32u + bit));
            s_node_live[w * 32u + bit] = false;
        }
        bits = failed[w] & ~snap[w];
        while (bits) {
            unsigned bit = __builtin_ctz(bits);
            bits &= bits - 1;
            uint16_t id = (uint16_t)(w * 32u + bit);
            s_node_dead[id] = true;
            JSValue global = JS_GetGlobalObject(s_ctx);
            JSValue fn = JS_GetPropertyStr(s_ctx, global, "__lume_dispatchCreateFailed");
            if (JS_IsFunction(s_ctx, fn)) {
                JSValue arg = JS_NewInt32(s_ctx, id);
                JSValue ret = JS_Call(s_ctx, fn, JS_UNDEFINED, 1, &arg);
                if (JS_IsException(ret)) dump_js_exception(s_ctx, "__lume_dispatchCreateFailed");
                JS_FreeValue(s_ctx, ret);
                JS_FreeValue(s_ctx, arg);
            }
            JS_FreeValue(s_ctx, fn);
            JS_FreeValue(s_ctx, global);
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

/* r26: WiFi-OTA status provider, registered by lume-hotreload at boot. The
 * engine has NO link dependency on lume-hotreload (avoids a component cycle);
 * js_net_ota_status() calls through this function pointer only. */
void lume_engine_set_ota_status_provider(lume_ota_status_provider_fn fn)
{
    s_ota_status_provider = fn;
}

/* r43b: engine version for the CLI's pre-push compatibility check (VER
 * command). Kept here because quickjs.h is private to the engine component. */
void lume_engine_version(char *out, size_t cap)
{
    if (out == NULL || cap == 0) {
        return;
    }
    snprintf(out, cap, "%d.%d.%d", QJS_VERSION_MAJOR, QJS_VERSION_MINOR,
             QJS_VERSION_PATCH);
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
    if (!s_reload_pending) {
        lume_engine_evt_t evt = { .type = LUME_EVT_RELOAD, .node_id = 0 };
        if (xQueueSend(s_evt_queue, &evt, pdMS_TO_TICKS(100)) != pdTRUE) {
            /* Staging ownership and the post decision remain under one lock.
             * No later request can replace/free copy during this rollback. */
            ESP_LOGE(TAG, "request_reload: evt queue full, dropping frame");
            s_staged_src = NULL;
            s_staged_len = 0;
            heap_caps_free(copy);
            xSemaphoreGive(s_stage_mutex);
            return -1;
        }
        s_reload_pending = true;
    }
    xSemaphoreGive(s_stage_mutex);
    return 0;
}

static int request_launch_common(const char *id, bool want_reply)
{
    if (s_stage_mutex == NULL || s_evt_queue == NULL) {
        return -1;
    }
    if (id == NULL) {
        id = "";
    }
    size_t n = strlen(id);
    if (n >= LUME_APP_ID_MAX) {
        return -1;
    }
    if (n > 0 && !lume_app_id_valid(id, n)) {
        return -1;
    }

    xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
    memcpy(s_launch_req, id, n + 1);
    /* Coalesce like the reload slot: at most one LAUNCH event is queued and
     * the engine reads the LATEST id, so rapid taps cannot build a backlog.
     * A coalesced request keeps the caller's reply flag (the queued event
     * reports for whichever request owns it). */
    bool need_post = !s_launch_pending;
    s_launch_pending = true;
    if (need_post) {
        s_launch_reply = want_reply;
    }
    xSemaphoreGive(s_stage_mutex);

    if (!need_post) {
        return 0;
    }
    lume_engine_evt_t evt = { .type = LUME_EVT_LAUNCH, .node_id = 0 };
    if (xQueueSend(s_evt_queue, &evt, pdMS_TO_TICKS(100)) != pdTRUE) {
        xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
        s_launch_pending = false;
        s_launch_reply = false;
        xSemaphoreGive(s_stage_mutex);
        ESP_LOGE(TAG, "request_launch('%s'): evt queue full", id);
        return -1;
    }
    return 0;
}

int lume_engine_request_launch(const char *id)
{
    return request_launch_common(id, false);
}

int lume_engine_request_launch_reply(const char *id)
{
    return request_launch_common(id, true);
}

/* Engine-task side of request_launch: copy + clear the pending id. */
static bool take_launch(char *out, size_t cap, bool *want_reply)
{
    bool have = false;
    xSemaphoreTake(s_stage_mutex, portMAX_DELAY);
    if (s_launch_pending) {
        snprintf(out, cap, "%s", s_launch_req);
        s_launch_req[0] = '\0';
        s_launch_pending = false;
        *want_reply = s_launch_reply;
        s_launch_reply = false;
        have = true;
    }
    xSemaphoreGive(s_stage_mutex);
    return have;
}

/* Drop any removal latch left over from the previous app before a fresh
 * context starts; stale ids must not be dispatched into the new JS context. */
static void clear_removals(void)
{
    portENTER_CRITICAL(&s_rm_mux);
    for (unsigned i = 0; i < LUME_RM_WORDS; i++) {
        s_rm_pending[i] = 0;
        s_failed_pending[i] = 0;
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

    /* Candidate source for the NEXT runtime iteration. Owned exclusively by
     * the engine task. cand_is_reload drives TX reporting + commit-on-OK. */
    char *cand_src = NULL;
    size_t cand_len = 0;
    bool cand_is_reload = false;   /* pushed/launched bundle: commit on OK */
    bool cand_want_reply = false;  /* report the eval outcome to the requester */
    char cand_app[LUME_APP_ID_MAX];/* app identity, "" = home / demo */
    bool cand_is_home = false;     /* run the built-in home screen */
    bool home_failed = false;      /* home itself broke: fall back to demo */

    /* Boot: prefer a valid pin, then the last started app, then home. */
    lume_apps_init();
    {
        char boot[LUME_APP_ID_MAX];
        cand_app[0] = '\0';
        if (lume_apps_boot_id(boot, sizeof(boot))) {
            char *src = NULL;
            size_t len = 0;
            if (lume_apps_read(boot, &src, &len) == 0) {
                cand_src = src;
                cand_len = len;
                snprintf(cand_app, sizeof(cand_app), "%s", boot);
                ESP_LOGI(TAG, "boot app '%s' (%u bytes)", boot, (unsigned)len);
            } else {
                ESP_LOGW(TAG, "boot app '%s' unreadable; starting home", boot);
                (void)lume_apps_set_current("");
            }
        }
        cand_is_home = (cand_src == NULL);
    }

    /* OUTER LOOP: one iteration == one QuickJS runtime lifetime. A reload or
     * an app launch tears the runtime down at the bottom and continues here.
     * Drivers (LVGL / touch / board) are NOT restarted across iterations.
     * EXACTLY ONE app (or the home screen) is live at any moment. */
    for (;;) {
        lume_perf_switch_mark(LUME_SW_RB_START);   /* r46 Task A: rebuild begin */
        s_bc_fail_reason = NULL;   /* r43b: one reload outcome per iteration */
        const char *app_src;
        size_t app_len;
        const bool from_reload = cand_is_reload;
        const bool want_reply = cand_want_reply;
        if (cand_src != NULL) {
            app_src = cand_src;                 /* staged frame / launched app */
            app_len = cand_len;
        } else if (cand_is_home) {
            app_src = lume_home_js;             /* built-in home grid */
            app_len = strlen(lume_home_js);
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
        lume_perf_switch_mark(LUME_SW_POST_NEWRT);
        JS_SetMemoryLimit(rt, LUME_JS_HEAP_LIMIT);
        JSContext *ctx = JS_NewContext(rt);
        if (ctx == NULL) {
            ESP_LOGE(TAG, "JS_NewContext failed");
            JS_FreeRuntime(rt);
            abort();
        }
        lume_perf_switch_mark(LUME_SW_POST_NEWCTX);
        s_rt = rt;
        s_ctx = ctx;
        register_bindings(ctx);                              /* native lume.* */
        inject_screen_globals(ctx);   /* __lumeScreen for the prelude (r32) */
        lume_ui_bridge_set_anim_sink(lume_engine_post_anim_complete);
        lume_ui_bridge_set_press_sink(lume_engine_post_press); /* re-wire sink */
        lume_ui_bridge_set_scroll_sink(lume_engine_post_scroll);
        lume_ui_bridge_set_gesture_sink(lume_engine_post_gesture);
        /* Fresh JS-side id allocator. NOTE: the LVGL s_nodes[] table is NOT
         * cleared (drivers don't restart), so ids are reused across reloads;
         * see docs/KNOWN-SIMPLIFICATIONS.md. */
        memset(s_node_live, 0, sizeof(s_node_live));
        memset(s_node_dead, 0, sizeof(s_node_dead));
        clear_removals();                       /* drop stale removal latch */
        lume_perf_switch_mark(LUME_SW_POST_BINDINGS);
        ESP_LOGI(TAG, "runtime up; eval app '%s' (%u bytes)",
                 cand_app[0] ? cand_app
                             : (cand_is_home ? "<home>" : "<embedded-demo>"),
                 (unsigned)app_len);

        /* ---- eval prelude (signals/ui), then the app ----
         * r46 Task B: prelude + the built-in home/demo scripts go through the
         * resident bytecode cache (parsed once, loaded on later switches).
         * Pushed/installed app bundles keep the generic eval_buf path (which
         * also handles LUMB bytecode frames). */
        bool ok = eval_cached_script(ctx, lume_prelude_js, "<lume-prelude>",
                                     LUME_CACHE_PRELUDE);
        lume_perf_switch_mark(LUME_SW_POST_PRELUDE);
        if (ok) {
            if (app_src == lume_home_js) {
                ok = eval_cached_script(ctx, lume_home_js, "<lume-home>",
                                        LUME_CACHE_HOME);
            } else if (app_src == lume_demo_js) {
                ok = eval_cached_script(ctx, lume_demo_js, "<lume-demo>",
                                        LUME_CACHE_DEMO);
            } else {
                ok = eval_buf(ctx, app_src, app_len, "<lume-app>");
            }
        } else {
            ESP_LOGE(TAG, "prelude eval failed; app skipped");
        }
        lume_perf_switch_mark(LUME_SW_POST_APP);
        lume_perf_switch_report();   /* r46 Task A: log phase deltas (no-op when off) */

        if (!ok) {
            /* eval_buf already dumped the JS exception. A failed reload or a
             * broken installed app must NOT kill the engine. */
            if (want_reply) {
                /* r43b: surface the precise bytecode rejection token
                 * (bc-version / bc-read / ...) instead of a generic failure. */
                report_result(false, app_len,
                              s_bc_fail_reason ? s_bc_fail_reason : "eval-failed");
            }
            if (from_reload) {
                ESP_LOGW(TAG, "reload/launch eval failed for '%s'", cand_app);
            } else {
                ESP_LOGE(TAG, "embedded/last-good/home app eval failed (unexpected)");
            }
            call_app_hook("__lume_shutdown");
            mp3_decoder_close(s_mp3); s_mp3 = NULL;
            if (!lume_audio_stream_finished()) (void)lume_audio_stream_reset();
            lume_ui_msg_t failed_reset;
            msg_init(&failed_reset);
            failed_reset.op = LUME_OP_RESET;
            if (lume_ui_bridge_post(&failed_reset) != 0)
                ESP_LOGE(TAG, "UI reset after eval failure failed");
            s_rt = NULL;
            s_ctx = NULL;
            JS_FreeContext(ctx);
            JS_FreeRuntime(rt);
            const bool attempted_home = cand_is_home && cand_src == NULL;
            if (cand_src != NULL) {            /* discard the bad candidate */
                heap_caps_free(cand_src);
                cand_src = NULL;
            }
            cand_len = 0;
            cand_is_reload = false;
            cand_want_reply = false;
            /* Same-app hot update failed -> keep the last good bundle of THAT
             * app. Anything else (a newly selected app) falls back to home, so
             * a bad install can never leave the device showing the previous
             * app while .current points at the broken one. If home itself
             * broke, the embedded demo is the final fallback. */
            bool same_app = cand_app[0] != '\0' && s_good_app != NULL &&
                            strcmp(cand_app, s_running_app) == 0;
            if (!same_app) {
                if (cand_app[0] != '\0') {
                    ESP_LOGE(TAG, "app '%s' failed to eval; dropping boot marker",
                             cand_app);
                    (void)lume_apps_set_current("");
                }
                cand_app[0] = '\0';
                if (attempted_home) {
                    home_failed = true;
                }
                cand_is_home = !home_failed;
            }
            vTaskDelay(pdMS_TO_TICKS(50));     /* avoid a tight respin */
            continue;
        }

        call_app_hook("__lume_start");

/* r46 Task A/C: posted when either measurement or the crossfade transition
 * is enabled. It comes AFTER all initial UI messages and __lume_start; Queue
 * A FIFO ensures the LVGL task drains it only once the first frame is fully
 * applied. token = app-eval-done emulated timestamp (first-frame latency);
 * on the LVGL side it is also the transition reveal trigger. */
#if CONFIG_LUME_SWITCH_PROFILE || !CONFIG_LUME_APP_TRANSITION_DISABLE
        {
            lume_ui_msg_t ff;
            msg_init(&ff);
            ff.op = LUME_OP_FIRSTFRAME;
            ff.token = (uint32_t)esp_timer_get_time();
            (void)lume_ui_bridge_post(&ff);
        }
#endif

        /* ---- success: the live app identity + boot marker ---- */
        snprintf(s_running_app, sizeof(s_running_app), "%s", cand_app);
        if (cand_app[0] != '\0') {
            (void)lume_apps_set_current(cand_app);
        } else if (cand_is_home) {
            (void)lume_apps_set_current("");
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
        }
        if (want_reply) {
            report_result(true, app_len, NULL);
        }
        if (cand_src != NULL) {
            heap_caps_free(cand_src);
            cand_src = NULL;
        }
        cand_len = 0;
        cand_is_reload = false;
        cand_want_reply = false;
        ESP_LOGI(TAG, "app eval ok; entering event loop");

        /* ---- inner event loop (one runtime lifetime) ---- */
        bool reload = false;
        bool go_home = false;
        bool job_limit_warned = false;
#if CONFIG_LUME_PERF_PROFILE
        int64_t last_heap_sample = 0;
#endif
        for (;;) {
#if CONFIG_LUME_PERF_PROFILE
            int64_t heap_now = lume_perf_now();
            if (heap_now - last_heap_sample >= 1000000) {
                JSMemoryUsage usage;
                JS_ComputeMemoryUsage(rt, &usage);
                lume_perf_js_heap((uint32_t)usage.memory_used_size);
                lume_perf_engine_stack(uxTaskGetStackHighWaterMark(NULL));
                size_t alloc_net, alloc_live;
                lume_engine_alloc_stats(&alloc_net, &alloc_live);
                ESP_LOGI("lume-perf", "alloc.net=%u alloc.live=%u",
                         (unsigned)alloc_net, (unsigned)alloc_live);
                last_heap_sample = heap_now;
            }
#endif
            lume_engine_evt_t evt;
            /* Bounded wait instead of portMAX_DELAY (r4 P2): the timeout is
             * the poll tick for latched removal notifications. */
            if (xQueueReceive(s_evt_queue, &evt, pdMS_TO_TICKS(20)) == pdTRUE) {
                if (evt.type == LUME_EVT_RELOAD) {
                    ESP_LOGI(TAG, "engine recv RELOAD -> recycle runtime");
                    reload = true;
                    break;                     /* leave the event loop */
                } else if (evt.type == LUME_EVT_LAUNCH) {
                    char id[LUME_APP_ID_MAX];
                    bool reply = false;
                    if (take_launch(id, sizeof(id), &reply)) {
                        if (id[0] == '\0') {
                            ESP_LOGI(TAG, "engine recv LAUNCH home");
                            go_home = true;
                            cand_want_reply = reply;
                            reload = true;
                            break;
                        }
                        char *src = NULL;
                        size_t len = 0;
                        int r = lume_apps_read(id, &src, &len);
                        if (r < 0) {
                            ESP_LOGW(TAG, "LAUNCH '%s' failed (%d); staying", id, r);
                            if (reply) report_result(false, 0, "no-app");
                            continue;          /* keep the current app alive */
                        }
                        if (cand_src != NULL) {
                            heap_caps_free(cand_src);
                        }
                        cand_src = src;
                        cand_len = len;
                        cand_is_reload = true;
                        cand_want_reply = reply;
                        cand_is_home = false;
                        snprintf(cand_app, sizeof(cand_app), "%s", id);
                        ESP_LOGI(TAG, "engine recv LAUNCH '%s' (%u bytes)",
                                 id, (unsigned)len);
                        reload = true;
                        break;
                    }
                } else if (evt.type == LUME_EVT_PAUSE) {
                    call_app_hook("__lume_pause");
                } else if (evt.type == LUME_EVT_RESUME) {
                    call_app_hook("__lume_resume");
                } else if (evt.type == LUME_EVT_BACK) {
                    if (!call_back_hook()) {
                        /* No app handler claimed BACK: return to the built-in
                         * home screen. The app runtime is destroyed, so only
                         * the home runtime is alive after the switch. */
                        go_home = true;
                        cand_want_reply = false;
                        reload = true;
                        break;
                    }
                } else if (evt.type == LUME_EVT_PRESS) {
                    ESP_LOGI(TAG, "engine recv PRESS id=%u",
                             (unsigned)evt.node_id);
                    dispatch_press(evt.node_id);
                } else if (evt.type == LUME_EVT_ANIM_COMPLETE) {
                    dispatch_anim_complete(evt.token);
                } else if (evt.type == LUME_EVT_SCROLL) {
                    dispatch_scroll(evt.node_id, evt.scroll_y);
                } else if (evt.type == LUME_EVT_GESTURE) {
                    dispatch_gesture(&evt);
                }
            }
            drain_removals();
            call_app_hook("__lume_tick");
            /* JS callbacks and timers can enqueue Promise reactions. Run them
             * before waiting again so await continuations can update the UI.
             * Bound each turn: a self-feeding chain must not starve input or
             * the next timer deadline check in __lume_tick. */
            for (unsigned jobs = 0; jobs < 64; jobs++) {
                JSContext *job_ctx = NULL;
                int result = JS_ExecutePendingJob(rt, &job_ctx);
                if (result == 0) break;
                if (result < 0) {
                    if (job_ctx != NULL)
                        dump_js_exception(job_ctx, "<promise-job>");
                    break;
                }
                if (jobs == 63 && JS_IsJobPending(rt) && !job_limit_warned) {
                    ESP_LOGW(TAG, "Promise job limit (64) reached; deferring remaining jobs");
                    job_limit_warned = true;
                }
            }
        }

        /* r46 Task A: an app switch is starting (teardown now + rebuild on
         * the next outer-loop iteration). Start one measurement window. */
        lume_perf_switch_begin();

        /* r46 Task C: crossfade-through-black. Post COVER to the LVGL task,
         * then wait (existing Queue B handshake, no new lock) for the fade-in
         * to finish BEFORE we RESET/teardown, so the old screen is hidden
         * behind an opaque overlay instead of flashing blank. The LVGL task
         * owns the whole animation; the engine only waits for the COVERED
         * signal. The overlay absorbs touch on the LVGL side; any queued
         * input left over from before the switch is discarded here. */
#if !CONFIG_LUME_APP_TRANSITION_DISABLE
        {
            lume_ui_msg_t cover;
            msg_init(&cover);
            cover.op = LUME_OP_TRANSITION_COVER;
            (void)lume_ui_bridge_post(&cover);
            const TickType_t deadline = xTaskGetTickCount() +
                pdMS_TO_TICKS(CONFIG_LUME_APP_TRANSITION_MS + 150);
            bool covered = false;
            for (;;) {
                TickType_t now = xTaskGetTickCount();
                if (now >= deadline) break;
                lume_engine_evt_t tev;
                if (xQueueReceive(s_evt_queue, &tev, deadline - now) != pdTRUE)
                    break;
                if (tev.type == LUME_EVT_TRANSITION_COVERED) {
                    covered = true;
                    break;
                }
                /* Swallow everything else: no press dispatch into UI we are
                 * about to destroy; redundant reload/launch events coalesce. */
            }
            if (!covered) {
                ESP_LOGW(TAG, "transition: cover wait timed out, proceeding");
            }
        }
#endif

        /* ---- teardown ----
         * Only the engine task ever dereferences s_ctx (bindings, dispatch_*).
         * The reverse channel (press sink) and the reload request path only
         * post to FreeRTOS queues and never touch s_ctx, so no other task can
         * be using this context here. Free context first, then runtime. */
        call_app_hook("__lume_shutdown");
        mp3_decoder_close(s_mp3); s_mp3 = NULL;
        if (!lume_audio_stream_finished()) (void)lume_audio_stream_reset();
        lume_ui_msg_t reset_msg;
        msg_init(&reset_msg);
        reset_msg.op = LUME_OP_RESET;
        if (lume_ui_bridge_post(&reset_msg) != 0)
            ESP_LOGE(TAG, "UI reset post failed; old nodes may remain");
        s_rt = NULL;
        s_ctx = NULL;
        lume_perf_switch_mark(LUME_SW_PRE_FREE);
        JS_FreeContext(ctx);
        lume_perf_switch_mark(LUME_SW_POST_FREECTX);
        JS_FreeRuntime(rt);
        lume_perf_switch_mark(LUME_SW_POST_FREERT);

        /* ---- decide the NEXT source ---- */
        if (reload) {
            if (go_home) {
                if (cand_src != NULL) {
                    heap_caps_free(cand_src);
                    cand_src = NULL;
                }
                cand_len = 0;
                cand_is_reload = false;
                cand_app[0] = '\0';
                cand_is_home = true;
                if (s_good_app != NULL) {      /* the old app's bundle */
                    heap_caps_free(s_good_app);
                    s_good_app = NULL;
                    s_good_app_len = 0;
                }
            } else if (cand_src != NULL) {
                /* LAUNCH already filled the candidate source. */
            } else {
                size_t n = 0;
                char *newsrc = take_staged(&n);
                if (newsrc != NULL) {
                    cand_src = newsrc;
                    cand_len = n;
                    cand_is_reload = true;
                    cand_want_reply = false;   /* DATA frames reply via FIFO */
                    /* A hot update belongs to the app that is running now. */
                    snprintf(cand_app, sizeof(cand_app), "%s", s_running_app);
                    cand_is_home = false;
                } else {
                    ESP_LOGW(TAG, "reload event but staging empty; restarting last-good");
                    cand_is_reload = false;
                }
            }
        }
    }
}

void lume_engine_start(void)
{
    /* r46 Task C: registered once (never changes), before the engine task and
     * LVGL task can post a COVERED event. */
    lume_ui_bridge_set_transition_sink(lume_engine_post_transition_covered);
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
