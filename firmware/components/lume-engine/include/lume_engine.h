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
typedef struct {
    uint8_t  type;        /* LUME_EVT_* */
    uint16_t node_id;
    uint32_t token;
} lume_engine_evt_t;

/* Reverse-channel sink: called by the ui-bridge press callback (LVGL task)
 * to enqueue a CLICKED event into s_evt_queue. Pure queue op, no lv_* call. */
void lume_engine_post_press(uint16_t node_id);
void lume_engine_post_anim_complete(uint32_t token);

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
