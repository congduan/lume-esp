#pragma once
/* r140: portable contract for the profile-only, read-only `lume.perf` JS
 * binding. These tokens are the single source of truth for the namespace,
 * method and result-field names:
 *   - the firmware registration in lume_engine.c uses them directly to build
 *     the JS object and its result objects;
 *   - the host harness tests/apps_protocol.c compiles them under the same
 *     -DCONFIG_LUME_PERF_PROFILE gate to assert the binding's existence and
 *     return shapes without an ESP-IDF / QuickJS build.
 *
 * The whole contract is gated OFF in default builds: no symbol, no bytes, no
 * .d.ts surface (default firmware size stays byte-identical to r139). */
#if CONFIG_LUME_PERF_PROFILE

#define LUME_PERF_NS_NAME           "perf"
#define LUME_PERF_OOM_STATE_NAME    "oomState"
#define LUME_PERF_ALLOC_STATS_NAME  "allocStats"

/* oomState() -> { active:boolean, denials:number } */
#define LUME_PERF_OOM_F_ACTIVE      "active"
#define LUME_PERF_OOM_F_DENIALS     "denials"

/* allocStats() -> { net:number, live:number } */
#define LUME_PERF_ALLOC_F_NET       "net"
#define LUME_PERF_ALLOC_F_LIVE      "live"

#define LUME_PERF_METHOD_COUNT      2

#endif /* CONFIG_LUME_PERF_PROFILE */
