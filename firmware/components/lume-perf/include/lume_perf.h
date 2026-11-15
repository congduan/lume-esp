#pragma once
#include <stdint.h>
#include "sdkconfig.h"

typedef enum {
    LUME_PERF_RENDER, LUME_PERF_FLUSH, LUME_PERF_DRAIN,
    LUME_PERF_EVAL, LUME_PERF_GC, LUME_PERF_COUNT
} lume_perf_stage_t;

#if CONFIG_LUME_PERF_PROFILE
int64_t lume_perf_now(void);
void lume_perf_add(lume_perf_stage_t stage, int64_t elapsed_us);
void lume_perf_flush_count(unsigned transactions);
void lume_perf_frame(void);
void lume_perf_js_heap(uint32_t bytes);
void lume_perf_engine_stack(uint32_t words);
void lume_perf_log_second(void);
#else
static inline int64_t lume_perf_now(void) { return 0; }
static inline void lume_perf_add(lume_perf_stage_t stage, int64_t us) { (void)stage; (void)us; }
static inline void lume_perf_flush_count(unsigned n) { (void)n; }
static inline void lume_perf_frame(void) {}
static inline void lume_perf_js_heap(uint32_t n) { (void)n; }
static inline void lume_perf_engine_stack(uint32_t n) { (void)n; }
static inline void lume_perf_log_second(void) {}
#endif

/* r46 Task A: opt-in app-switch phase profiler. Independent opt-in so the
 * per-second rendering summary need not be enabled to measure a switch. All
 * marks are taken with esp_timer_get_time() (emulated microseconds under
 * esp32sim -- a deterministic instruction/cycle-based cost, NOT wall-clock),
 * reusing the r36b timing basis. Checkpoints span one teardown + one rebuild
 * across the engine outer-loop `continue`, so the state is engine-task-owned.
 * The mark enum is always defined; only the implementation is gated. */
typedef enum {
    LUME_SW_BEGIN = 0,        /* launch/reload accepted (inner loop breaks) */
    LUME_SW_PRE_FREE,         /* before JS_FreeContext (housekeeping done) */
    LUME_SW_POST_FREECTX,     /* after JS_FreeContext */
    LUME_SW_POST_FREERT,      /* after JS_FreeRuntime (teardown done) */
    LUME_SW_RB_START,         /* top of next outer loop (rebuild begins) */
    LUME_SW_POST_NEWRT,       /* after JS_NewRuntime2 */
    LUME_SW_POST_NEWCTX,      /* after JS_NewContext */
    LUME_SW_POST_BINDINGS,    /* after register_bindings + sinks + state */
    LUME_SW_POST_PRELUDE,     /* after prelude eval / cached load */
    LUME_SW_POST_APP,         /* after app eval */
    LUME_SW_MARKS
} lume_sw_mark_t;
#if CONFIG_LUME_SWITCH_PROFILE
void lume_perf_switch_begin(void);                 /* reset + mark BEGIN */
void lume_perf_switch_mark(lume_sw_mark_t m);      /* record + emit SWMARK */
void lume_perf_switch_report(void);                /* log phase deltas, clear */
/* LVGL-task side: log first-frame drain latency. `app_done_us` is the engine's
 * esp_timer value at app-eval-done, carried in the FIRSTFRAME op. */
void lume_perf_switch_firstframe(int64_t app_done_us);
#else
static inline void lume_perf_switch_begin(void) {}
static inline void lume_perf_switch_mark(lume_sw_mark_t m) { (void)m; }
static inline void lume_perf_switch_report(void) {}
static inline void lume_perf_switch_firstframe(int64_t t) { (void)t; }
#endif
