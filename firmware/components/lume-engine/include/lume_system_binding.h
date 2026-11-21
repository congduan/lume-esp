#pragma once
/* r141: portable contract for the default-visible `lume.system.reboot()` JS
 * binding. These tokens are the single source of truth for the JS name, the
 * `_`-prefixed native name and the pre-restart ASCII log line:
 *   - lume_engine.c uses them to register the native and emit the log;
 *   - the embedded JS prelude (lume_scripts.c) exposes the native as
 *     lume.system.reboot();
 *   - the host harness tests/apps_protocol.c compiles the same header in
 *     default mode to assert the token contract without an ESP-IDF / QuickJS
 *     build.
 *
 * Unlike lume_perf_binding.h this header is NOT gated: reboot() is part of the
 * default JS API surface. */
#define LUME_SYSTEM_NS_NAME             "system"
#define LUME_SYSTEM_REBOOT_NAME         "reboot"
#define LUME_SYSTEM_REBOOT_NATIVE_NAME  "_systemReboot"
#define LUME_SYSTEM_REBOOT_LOG          "lume.system: reboot requested"
