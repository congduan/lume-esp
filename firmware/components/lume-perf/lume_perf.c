#include "lume_perf.h"
#if CONFIG_LUME_PERF_PROFILE
#include <stdatomic.h>
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* Atomic accumulators allow ISR flush completion and the engine task to report
 * without taking a lock in the display path. One second snapshot is approximate
 * at the boundary; every event belongs to one of the adjacent windows. */
typedef struct { atomic_uint count, total_us, max_us; } stat_t;
static stat_t s_stats[LUME_PERF_COUNT];
static atomic_uint s_flushes, s_transactions, s_frames, s_js_heap, s_js_heap_hwm, s_engine_stack;
static const char *s_names[] = {"render", "flush", "drain", "eval", "gc"};
int64_t lume_perf_now(void) { return esp_timer_get_time(); }
void lume_perf_add(lume_perf_stage_t stage, int64_t elapsed_us)
{
    if (elapsed_us < 0) return;
    if (elapsed_us > UINT32_MAX) elapsed_us = UINT32_MAX;
    stat_t *s = &s_stats[stage];
    unsigned us = (unsigned)elapsed_us;
    atomic_fetch_add(&s->count, 1);
    atomic_fetch_add(&s->total_us, us);
    unsigned old = atomic_load(&s->max_us);
    while (old < us && !atomic_compare_exchange_weak(&s->max_us, &old, us)) {}
}
void lume_perf_flush_count(unsigned transactions)
{
    atomic_fetch_add(&s_flushes, 1);
    atomic_fetch_add(&s_transactions, transactions);
}
void lume_perf_frame(void) { atomic_fetch_add(&s_frames, 1); }
void lume_perf_js_heap(uint32_t bytes)
{
    atomic_store(&s_js_heap, bytes);
    unsigned old = atomic_load(&s_js_heap_hwm);
    while (old < bytes && !atomic_compare_exchange_weak(&s_js_heap_hwm, &old, bytes)) {}
}
void lume_perf_engine_stack(uint32_t words) { atomic_store(&s_engine_stack, words); }
void lume_perf_log_second(void)
{
    static int64_t last;
    int64_t now = esp_timer_get_time();
    if (last && now - last < 1000000) return;
    last = now;
    ESP_LOGI("lume-perf", "fps=%u flush=%u tx=%u psram_largest=%u psram_free=%u psram_min_free=%u dma_largest=%u dma_min_free=%u lvgl_stack_words=%u engine_stack_words=%u js_heap=%u js_heap_hwm=%u",
             atomic_exchange(&s_frames, 0), atomic_exchange(&s_flushes, 0),
             atomic_exchange(&s_transactions, 0),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA),
             (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA),
             (unsigned)uxTaskGetStackHighWaterMark(NULL), atomic_load(&s_engine_stack),
             atomic_load(&s_js_heap), atomic_exchange(&s_js_heap_hwm, 0));
    for (unsigned i = 0; i < LUME_PERF_COUNT; i++) {
        unsigned n = atomic_exchange(&s_stats[i].count, 0);
        unsigned total = atomic_exchange(&s_stats[i].total_us, 0);
        unsigned max = atomic_exchange(&s_stats[i].max_us, 0);
        ESP_LOGI("lume-perf", "%s n=%u avg_us=%u max_us=%u", s_names[i], n, n ? total / n : 0, max);
    }
}
#endif

/* ------------------------------------------------------------------ */
/* r46 Task A: app-switch phase profiler (independent opt-in).          */
/* Marks are emulated microseconds from esp_timer_get_time(). Under     */
/* esp32sim these are deterministic (the emulated clock advances with    */
/* executed cycles), which is the "instruction-count / relative-time"    */
/* metric requested for the switch-phase table, NOT wall-clock.         */
/* One SWMARK line per checkpoint also lets the harness stop the sim at  */
/* that exact emulated time and read cumulative instruction counts.      */
/* ------------------------------------------------------------------ */
#if CONFIG_LUME_SWITCH_PROFILE
#include <stdbool.h>
#include "esp_timer.h"
#include "esp_log.h"
static const char *s_sw_names[LUME_SW_MARKS] = {
    "BEGIN", "PRE_FREE", "POST_FREECTX", "POST_FREERT", "RB_START",
    "POST_NEWRT", "POST_NEWCTX", "POST_BINDINGS", "POST_PRELUDE", "POST_APP"
};
static int64_t s_sw_marks[LUME_SW_MARKS];
static bool s_sw_active;

static int64_t sw_now(void) { return esp_timer_get_time(); }

void lume_perf_switch_begin(void)
{
    for (int i = 0; i < LUME_SW_MARKS; i++) s_sw_marks[i] = 0;
    s_sw_active = true;
    s_sw_marks[LUME_SW_BEGIN] = sw_now();
    ESP_LOGI("lume-perf", "SWMARK 0 BEGIN %lld", (long long)s_sw_marks[LUME_SW_BEGIN]);
}

void lume_perf_switch_mark(lume_sw_mark_t m)
{
    if (!s_sw_active || m < 0 || m >= LUME_SW_MARKS) return;
    s_sw_marks[m] = sw_now();
    ESP_LOGI("lume-perf", "SWMARK %d %s %lld",
             (int)m, s_sw_names[m], (long long)s_sw_marks[m]);
}

static long long sw_delta(int a, int b)
{
    if (!s_sw_marks[a] || !s_sw_marks[b]) return -1;
    return (long long)(s_sw_marks[b] - s_sw_marks[a]);
}

void lume_perf_switch_report(void)
{
    if (!s_sw_active) return;
    ESP_LOGI("lume-perf",
             "switch: teardown=%lldus (housekeeping=%lld freectx=%lld freeRT=%lld) "
             "runtime=%lldus (newRT=%lld newCtx=%lld bindings=%lld) "
             "prelude=%lldus app=%lldus",
             sw_delta(LUME_SW_BEGIN, LUME_SW_POST_FREERT),
             sw_delta(LUME_SW_BEGIN, LUME_SW_PRE_FREE),
             sw_delta(LUME_SW_PRE_FREE, LUME_SW_POST_FREECTX),
             sw_delta(LUME_SW_POST_FREECTX, LUME_SW_POST_FREERT),
             sw_delta(LUME_SW_RB_START, LUME_SW_POST_BINDINGS),
             sw_delta(LUME_SW_RB_START, LUME_SW_POST_NEWRT),
             sw_delta(LUME_SW_POST_NEWRT, LUME_SW_POST_NEWCTX),
             sw_delta(LUME_SW_POST_NEWCTX, LUME_SW_POST_BINDINGS),
             sw_delta(LUME_SW_POST_BINDINGS, LUME_SW_POST_PRELUDE),
             sw_delta(LUME_SW_POST_PRELUDE, LUME_SW_POST_APP));
    s_sw_active = false;
}

void lume_perf_switch_firstframe(int64_t app_done_us)
{
    if (!app_done_us) return;
    int64_t now = sw_now();
    long long d = (long long)(now - app_done_us);
    /* esp_timer wraps a uint32 after ~71 min; reject nonsense when it does. */
    if (d < 0 || d > 10000000LL) {
        ESP_LOGI("lume-perf", "switch-firstframe: n/a (clock wrap / out of range)");
        return;
    }
    ESP_LOGI("lume-perf", "SWMARK %d FIRSTFRAME %lld",
             (int)LUME_SW_MARKS, (long long)now);
    ESP_LOGI("lume-perf", "switch-firstframe=%lldus", d);
}
#endif
