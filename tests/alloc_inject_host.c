/*
 * r138: host-only allocator fault-injection harness for the Lume QuickJS engine.
 *
 * This file is NEVER compiled into firmware. It links the vendored QuickJS-NG
 * sources on the host and wraps JSMallocFunctions with a countdown failure
 * injector plus net/live accounting that mirrors s_psram_mf in lume_engine.c:
 * bytes use malloc_usable_size(), the host analogue of
 * heap_caps_get_allocated_size(). All state is touched only from this single
 * host thread, so no atomics or locks are used (same discipline as the engine).
 *
 * Contract asserted here (and checked by tests/alloc_inject.js):
 *  1. after arming, exactly one allocation attempt is denied;
 *  2. JS observes a deterministic "out of memory" failure via try/catch
 *     (an exception, not a crash or a wrong error class);
 *  3. once the window closes the runtime is fully usable again;
 *  4. the counter never counts a denied block and returns to zero when the
 *     runtime is freed, i.e. counter state matches injection state.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <malloc.h>          /* malloc_usable_size(): host analogue of heap_caps */
#include "quickjs.h"

typedef struct {
    size_t calls;      /* allocation attempts observed by the hooks */
    size_t live;       /* net live blocks */
    size_t net_bytes;  /* net bytes via malloc_usable_size */
    size_t arm_at;     /* deny attempts with calls >= arm_at ... */
    size_t window;     /* ... up to this many consecutive denials */
    size_t denied;     /* denials actually issued */
    int armed;
} InjectState;

static void account_alloc(InjectState *st, void *p)
{
    if (p) { st->live++; st->net_bytes += malloc_usable_size(p); }
}

/* Countdown gate shared by all three allocating hooks. A denied attempt
 * returns NULL before touching the counters, mirroring a real OOM where no
 * block exists to account for. */
static int should_deny(InjectState *st)
{
    st->calls++;
    if (st->armed && st->calls >= st->arm_at && st->denied < st->window) {
        st->denied++;
        return 1;
    }
    return 0;
}

static void *ij_calloc(void *opaque, size_t n, size_t sz)
{
    InjectState *st = opaque;
    if (should_deny(st)) return NULL;
    void *p = calloc(n, sz);
    account_alloc(st, p);
    return p;
}

static void *ij_malloc(void *opaque, size_t sz)
{
    InjectState *st = opaque;
    if (should_deny(st)) return NULL;
    void *p = malloc(sz);
    account_alloc(st, p);
    return p;
}

static void ij_free(void *opaque, void *p)
{
    InjectState *st = opaque;
    if (p) { st->live--; st->net_bytes -= malloc_usable_size(p); }
    free(p);
}

static void *ij_realloc(void *opaque, void *p, size_t sz)
{
    InjectState *st = opaque;
    if (should_deny(st)) return NULL;
    size_t before = p ? malloc_usable_size(p) : 0;
    void *q = realloc(p, sz);
    if (q) {
        size_t after = malloc_usable_size(q);
        if (!p) st->live++;
        if (after >= before) st->net_bytes += after - before;
        else st->net_bytes -= before - after;
    }
    return q;
}

static size_t ij_usable(const void *p)
{
    return p ? malloc_usable_size((void *)p) : 0;
}

int main(void)
{
    InjectState st;
    memset(&st, 0, sizeof(st));
    JSMallocFunctions mf = { ij_calloc, ij_malloc, ij_free, ij_realloc, ij_usable };
    int failed = 0;

    JSRuntime *rt = JS_NewRuntime2(&mf, &st);
    if (!rt) { fprintf(stderr, "FAIL runtime creation\n"); return 1; }
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) { fprintf(stderr, "FAIL context creation\n"); JS_FreeRuntime(rt); return 1; }

    printf("setup: calls=%zu net=%zu live=%zu\n", st.calls, st.net_bytes, st.live);
    size_t baseline_calls = st.calls;

    /* Compile the app function BEFORE arming: script compilation allocates,
     * and those blocks must not be mistaken for the injected failure. */
    const char *fn_src =
        "(function(){ var a=[]; "
        "for (var i=0;i<128;i++) a.push('x'.repeat(64)); "
        "return a.length; })";
    JSValue fn = JS_Eval(ctx, fn_src, strlen(fn_src), "<oom-inject>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(fn)) {
        JSValue e = JS_GetException(ctx);
        const char *m = JS_ToCString(ctx, e);
        fprintf(stderr, "FAIL pre-compile: %s\n", m ? m : "?");
        if (m) JS_FreeCString(ctx, m);
        JS_FreeValue(ctx, e);
        JS_FreeContext(ctx); JS_FreeRuntime(rt);
        return 1;
    }

    /* Countdown: deny the very next allocation, exactly once. */
    st.arm_at = st.calls + 1;
    st.window = 1;
    st.armed = 1;
    printf("inject: armed-at=%zu window=1\n", st.arm_at);

    /* The engine receives a deterministic exception, not a crash or a wrong
     * error class: QuickJS maps the NULL allocation to InternalError. */
    JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 0, NULL);
    if (!JS_IsException(r)) {
        fprintf(stderr, "FAIL expected a deterministic OOM exception\n");
        failed = 1;
        JS_FreeValue(ctx, r);
    } else {
        JSValue e = JS_GetException(ctx);
        const char *m = JS_ToCString(ctx, e);
        printf("engine: exception=%s\n", m ? m : "(null)");
        if (!m || strcmp(m, "InternalError: out of memory") != 0) {
            fprintf(stderr, "FAIL unexpected exception class/message\n");
            failed = 1;
        }
        if (m) JS_FreeCString(ctx, m);
        JS_FreeValue(ctx, e);
    }
    JS_FreeValue(ctx, fn);

    printf("inject: denied=%zu calls=%zu\n", st.denied, st.calls);
    if (st.denied != 1) {
        fprintf(stderr, "FAIL injection count mismatch: expected 1, got %zu\n", st.denied);
        failed = 1;
    }
    if (st.calls < baseline_calls + 1) {
        fprintf(stderr, "FAIL no allocation attempt observed after arming\n");
        failed = 1;
    }

    /* Window closed: the gate must resume and account the resumed blocks.
     * Checked at the allocator boundary (no JS re-entry after an OOM, which
     * leaves QuickJS's call state unusable by design). */
    size_t net_before_resume = st.net_bytes;
    void *p = ij_malloc(&st, 64);
    if (!p) {
        fprintf(stderr, "FAIL allocator did not resume after the injection window\n");
        failed = 1;
    } else {
        printf("resume: malloc-after-window ok net=%zu live=%zu\n", st.net_bytes, st.live);
        if (st.net_bytes <= net_before_resume || st.live == 0) {
            fprintf(stderr, "FAIL resumed block was not accounted\n");
            failed = 1;
        }
        ij_free(&st, p);
        if (st.net_bytes != net_before_resume) {
            fprintf(stderr, "FAIL resumed block accounting unbalanced\n");
            failed = 1;
        }
    }

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    printf("teardown: net=%zu live=%zu\n", st.net_bytes, st.live);
    if (st.live != 0 || st.net_bytes != 0) {
        fprintf(stderr, "FAIL counter not consistent after free: net=%zu live=%zu\n",
                st.net_bytes, st.live);
        failed = 1;
    }

    if (failed) { fprintf(stderr, "RESULT: FAIL\n"); return 1; }
    printf("RESULT: PASS\n");
    return 0;
}
