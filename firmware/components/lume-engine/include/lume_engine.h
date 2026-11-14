#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void lume_engine_start(void);

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
} lume_engine_evt_t;

/* Reverse-channel sink: called by the ui-bridge press callback (LVGL task)
 * to enqueue a CLICKED event into s_evt_queue. Pure queue op, no lv_* call. */
void lume_engine_post_press(uint16_t node_id);
/* Protocol task -> engine task; returns -1 when event queue is full. */
int lume_engine_post_back(void);
int lume_engine_post_lifecycle(uint8_t type);
void lume_engine_post_anim_complete(uint32_t token);
void lume_engine_post_scroll(uint16_t node_id, int32_t y);
/* r21: LVGL-task sink; enqueues one LUME_EVT_GESTURE (pure queue op). */
void lume_engine_post_gesture(uint16_t node_id, uint8_t kind, int16_t x, int16_t y,
                              uint32_t t, uint8_t dir, uint8_t cancelled);

/* r4 P2: called by the ui-bridge remove path (LVGL task) after a subtree was
 * deleted. Latches node_id into a lock-protected pending-removal bitmap; the
 * engine task polls and clears it, so a removal notice is NEVER lost (no
 * queue capacity to exhaust) and any node count is covered. Pure latch op,
 * no lv_* call. */
void lume_engine_mark_removed(uint16_t node_id);

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
    int  port;          /* configured TCP port */
    char token[33];     /* 32 lowercase hex chars + NUL */
} lume_ota_status_t;
typedef void (*lume_ota_status_provider_fn)(lume_ota_status_t *out);
void lume_engine_set_ota_status_provider(lume_ota_status_provider_fn fn);
