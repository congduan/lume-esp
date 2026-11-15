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
