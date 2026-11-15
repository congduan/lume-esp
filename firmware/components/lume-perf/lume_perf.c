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
static atomic_uint s_flushes, s_transactions, s_frames, s_js_heap, s_engine_stack;
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
void lume_perf_js_heap(uint32_t bytes) { atomic_store(&s_js_heap, bytes); }
void lume_perf_engine_stack(uint32_t words) { atomic_store(&s_engine_stack, words); }
void lume_perf_log_second(void)
{
    static int64_t last;
    int64_t now = esp_timer_get_time();
    if (last && now - last < 1000000) return;
    last = now;
    ESP_LOGI("lume-perf", "fps=%u flush=%u tx=%u psram_largest=%u psram_free=%u psram_min_free=%u dma_largest=%u dma_min_free=%u lvgl_stack_words=%u engine_stack_words=%u js_heap=%u",
             atomic_exchange(&s_frames, 0), atomic_exchange(&s_flushes, 0),
             atomic_exchange(&s_transactions, 0),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA),
             (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA),
             (unsigned)uxTaskGetStackHighWaterMark(NULL), atomic_load(&s_engine_stack),
             atomic_load(&s_js_heap));
    for (unsigned i = 0; i < LUME_PERF_COUNT; i++) {
        unsigned n = atomic_exchange(&s_stats[i].count, 0);
        unsigned total = atomic_exchange(&s_stats[i].total_us, 0);
        unsigned max = atomic_exchange(&s_stats[i].max_us, 0);
        ESP_LOGI("lume-perf", "%s n=%u avg_us=%u max_us=%u", s_names[i], n, n ? total / n : 0, max);
    }
}
#endif
