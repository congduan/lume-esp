#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void lume_engine_start(void);

/* Engine-task-only QuickJS PSRAM allocator snapshot; zero with profile off. */
void lume_engine_alloc_stats(size_t *net_bytes, size_t *live);

#if CONFIG_LUME_PERF_PROFILE
/* r139: arm a one-second window, starting `delay_ms` from now, in which the
 * QuickJS PSRAM allocator returns NULL. Called from an LUMC RX task; the
 * engine task observes the failure window inside its allocator hooks. Only
 * compiled into profile firmware (CONFIG_LUME_PERF_PROFILE=y). */
int lume_engine_oom_inject(uint32_t delay_ms);
#endif

/* Engine event queue record (LVGL task -> engine task). Fixed size, copied.
 * node_id 0 is reserved (active screen); press events carry the clicked node. */
#define LUME_EVT_PRESS 1
/* Hot-reload request (USB CDC RX task -> engine task). node_id unused (0).
 * On receipt the engine tears down its current QuickJS runtime and starts a
 * fresh iteration with the staged app source (see lume_engine_request_reload). */
#define LUME_EVT_RELOAD 2
#define LUME_EVT_ANIM_COMPLETE 3
#define LUME_EVT_BACK 4
#define LUME_EVT_PAUSE 5
#define LUME_EVT_RESUME 6
#define LUME_EVT_SCROLL 7
/* r21 gesture pointer stream (LVGL task -> engine task). node_id = target. */
#define LUME_EVT_GESTURE 8
/* r30 multi-app: switch to another installed app ("" = built-in home screen).
 * The id was copied into the engine's launch slot before the event is posted;
 * the target source is read from LittleFS when the event is consumed. */
#define LUME_EVT_LAUNCH 9
/* r46 Task C: LVGL task -> engine task, the black overlay has finished fading
 * in (screen is covered); the engine may now RESET/teardown. node_id unused. */
#define LUME_EVT_TRANSITION_COVERED 10
#define LUME_EVT_WS 11
/* r115: REPL eval request (USB/TCP RX task -> engine task). The expression was
 * copied into the engine's REPL staging slot before the event is posted; the
 * engine evals it synchronously on the current app ctx in the inner loop and
 * answers through the registered REPL result callback. */
#define LUME_EVT_REPL 12
typedef struct {
    uint8_t  type;        /* LUME_EVT_* */
    uint16_t node_id;
    uint32_t token;
    int32_t scroll_y;
    /* r21: normalized LVGL pointer stream (unused fields stay zero-initialised). */
    uint8_t  g_kind;      /* 0 DOWN, 1 MOVE, 2 UP, 3 SWIPEDIR */
    uint8_t  g_dir;       /* LVGL lv_dir bitmask (SWIPEDIR only) */
    uint8_t  g_cancelled; /* 1 when a List scroll stole the press */
    int16_t  g_x, g_y;    /* absolute point, lv_indev_get_point */
    uint32_t g_t;         /* lv_tick_get ms */
    uint32_t ws_id;
    uint8_t ws_event, ws_binary;
    uint8_t *ws_data;     /* owned by queued record; engine frees after dispatch */
    size_t ws_len;
} lume_engine_evt_t;

/* Reverse-channel sink: called by the ui-bridge press callback (LVGL task)
 * to enqueue a CLICKED event into s_evt_queue. Pure queue op, no lv_* call. */
void lume_engine_post_press(uint16_t node_id);
/* Protocol task -> engine task; returns -1 when event queue is full. */
int lume_engine_post_back(void);
int lume_engine_post_lifecycle(uint8_t type);
void lume_engine_post_anim_complete(uint32_t token);
void lume_engine_post_scroll(uint16_t node_id, int32_t y);
/* r46 Task C: LVGL-task sink (called by the ui-bridge fade-in completion) to
 * enqueue one LUME_EVT_TRANSITION_COVERED. Pure Queue B op. */
void lume_engine_post_transition_covered(void);
/* r21: LVGL-task sink; enqueues one LUME_EVT_GESTURE (pure queue op). */
void lume_engine_post_gesture(uint16_t node_id, uint8_t kind, int16_t x, int16_t y,
                              uint32_t t, uint8_t dir, uint8_t cancelled);

/* r4 P2: called by the ui-bridge remove path (LVGL task) after a subtree was
 * deleted. Latches node_id into a lock-protected pending-removal bitmap; the
 * engine task polls and clears it, so a removal notice is NEVER lost (no
 * queue capacity to exhaust) and any node count is covered. Pure latch op,
 * no lv_* call. */
void lume_engine_mark_removed(uint16_t node_id);
/* LVGL create failed: latch id for engine-side dead-node disposal and warning. */
void lume_engine_mark_create_failed(uint16_t node_id);

/* ------------------------------------------------------------------------
 * Hot reload (M1): engine-side staging + result reporting.
 *
 * lume_engine_request_reload() is called from the USB CDC RX task. It copies
 * `len` bytes of JS source into an engine-owned PSRAM staging slot (guarded by
 * a mutex -- the caller must NOT pass a shared/pending pointer) and posts one
 * LUME_EVT_RELOAD. Returns 0 on success, -1 on OOM / queue full / not started.
 * A single staging slot with last-frame-wins coalescing is used (see
 * docs/KNOWN-SIMPLIFICATIONS.md).
 *
 * The final outcome of a reload (app eval OK / failed) is only known on the
 * engine task, so the engine reports it through a callback registered by the
 * hot-reload channel. This keeps the dependency direction one-way
 * (lume-hotreload -> lume-engine) and gives each frame exactly one TX reply.
 * ok=true  -> "RELOAD OK <len>"; ok=false -> "RELOAD ERR <reason>".
 * The callback runs ON THE ENGINE TASK: it must be quick and must not call back
 * into engine work. It may be NULL (replies then silently dropped).
 * ------------------------------------------------------------------------ */
typedef void (*lume_engine_reload_result_fn)(bool ok, size_t len,
                                             const char *reason);
void lume_engine_set_reload_result_cb(lume_engine_reload_result_fn cb);
int lume_engine_request_reload(const char *src, size_t len);

/* ------------------------------------------------------------------------
 * r30 multi-app launch (any task -> engine task).
 *
 * Ask the engine to run the installed app `id` (empty / NULL = the built-in
 * home screen). Only the id is copied here; the bundle is read from LittleFS
 * by the engine loop, which then recycles the CURRENT runtime and evals the
 * new source in a fresh context. Exactly one app is alive at any time.
 *
 * Returns 0 when the request was queued, -1 on a bad id / OOM / queue full.
 * The eventual eval outcome is reported through the SAME reload-result
 * callback as a hot reload (so a command channel still gets exactly one
 * reply per request).
 * ------------------------------------------------------------------------ */
int lume_engine_request_launch(const char *id);

/* Same as lume_engine_request_launch, but the eventual eval outcome is also
 * reported through the reload-result callback ("RELOAD OK <len>" /
 * "RELOAD ERR <reason>"). Used by the command channel so one request always
 * gets exactly one reply; JS-initiated launches use the silent variant. */
int lume_engine_request_launch_reply(const char *id);

/* ------------------------------------------------------------------------
 * r26: lume.net.otaStatus() provider.
 *
 * The WiFi-OTA channel lives in lume-hotreload, which already REQUIRES
 * lume-engine. To let the engine expose its status WITHOUT creating a
 * component dependency CYCLE (lume-engine -> lume-hotreload), the OTA channel
 * registers a status-provider callback here at boot; the engine native calls
 * it through the function pointer. The struct is defined in this header so
 * both sides agree on it. No provider registered -> all flags false.
 * ------------------------------------------------------------------------ */
typedef struct {
    bool running;       /* TCP listener currently bound */
    bool wifi_ready;    /* WiFi station has a usable IPv4 */
    bool token_ready;   /* a token is available (persisted or ephemeral) */
    bool hmac;          /* r96: HMAC-SHA256 challenge-response auth active */
    int  port;          /* configured TCP port */
    char token[33];     /* 32 lowercase hex chars + NUL */
} lume_ota_status_t;
typedef void (*lume_ota_status_provider_fn)(lume_ota_status_t *out);
void lume_engine_set_ota_status_provider(lume_ota_status_provider_fn fn);
/* r96: token setter registered by lume-hotreload; lets lume.ota.setToken()
 * change the HMAC token without creating an engine -> hotreload link cycle. */
typedef int (*lume_ota_set_token_fn)(const char *hex, size_t len);
void lume_engine_set_ota_token_setter(lume_ota_set_token_fn fn);

/* r43b: fill `out` with the QuickJS engine version ("MAJOR.MINOR.PATCH").
 * Used by the hot-reload channel to answer the CLI's VER query before a
 * bytecode push. No quickjs.h needed by the caller. */
void lume_engine_version(char *out, size_t cap);

/* ------------------------------------------------------------------------
 * r115: device REPL (serial/TCP line eval) on the CURRENT app context.
 *
 * lume_engine_request_repl() is called from an RX task. It copies `len` bytes
 * of JS expression into an engine-owned PSRAM slot (mutex-guarded; caller must
 * NOT pass a shared/pending pointer) and posts one LUME_EVT_REPL. Returns 0
 * when queued, -1 on bad args / OOM / queue full / not started. Unlike a
 * reload the runtime is NOT recycled: the expression sees the app's globals
 * and signals. Only one REPL slot exists (last request wins); a superseded
 * request is reported through the callback with ok=false and text "superseded".
 *
 * The eval outcome is delivered through a callback registered by the
 * hot-reload channel (dependency stays one-way: engine never links hotreload).
 * `ok` = eval produced a value; `text`/`len` = the JS_ToString() result on
 * success, or the error text on failure. The string is borrowed and valid only
 * DURING the callback; the channel applies its own output bound (lume_frame.h
 * LUME_REPL_OUT_CAP + lume_repl_clamp). `token` is the opaque request id
 * supplied by the caller and echoed back so the channel can route the reply
 * to the right sink. The callback runs ON THE ENGINE TASK: it must be quick and
 * must not call back into engine work. It may be NULL (replies silently dropped).
 * ------------------------------------------------------------------------ */
typedef void (*lume_engine_repl_fn)(bool ok, const char *text, size_t len,
                                    uint32_t token);
void lume_engine_set_repl_cb(lume_engine_repl_fn cb);
int lume_engine_request_repl(const char *expr, size_t len, uint32_t token);
