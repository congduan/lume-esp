#pragma once
/* ------------------------------------------------------------------------
 * lume_apps (r30): on-device multi-app store.
 *
 * Layout on the LittleFS "storage" partition (see lume-storage/lume_fs.c):
 *
 *   /apps/<id>/app.js      bundled app source (JS_Eval, iife+es2020 text)
 *   /apps/<id>/meta.json   single-line JSON: {"label","icon","color","fw",...}
 *   /apps/.current         last successfully started app ("" = home)
 *   /apps/.boot            optional pinned boot target
 *
 * r106: the CLI writes an integer "fw" field into meta.json at deploy time
 * (queried from the device via the FWTAG command). The firmware reads it back
 * with the portable helpers in lume_fwtag.h; no sidecar file is used and no
 * JSON parser is needed. An app with no fw field is a pre-r106 install.
 *
 * Only the STORE side of multi-app lives here. The engine still runs EXACTLY
 * ONE app at a time: launching another app tears the whole QuickJS runtime
 * down and evals the new source in a fresh context (the r17 hot-replacement
 * chain). There is no shared runtime, no background app, no app-to-app IPC.
 *
 * All calls run on the engine task (LittleFS VFS is not reentrant here).
 * Return codes: 0 = OK, negative = error (lume_fs.h codes plus
 * LUME_APPS_ERR_NOTFOUND / LUME_APPS_ERR_ID).
 * ------------------------------------------------------------------------ */
#include <stdbool.h>
#include <stddef.h>
#include "lume_app_id.h"

#define LUME_APPS_OK             0
#define LUME_APPS_ERR_NOTFOUND   (-4)
#define LUME_APPS_ERR_ID         (-5)
#define LUME_APPS_ERR_BUSY       (-6)   /* that app is the one running now */
#define LUME_APPS_ERR_FWTAG      (-7)   /* r106: app built for another firmware API tag */

/* r106: compile-time API compatibility tag. Bump LUME_API_TAG whenever a
 * firmware change breaks the app-visible contract (lume.d.ts surface, bridge
 * ATTR/OP ids, prelude globals) so apps deployed against the old firmware can
 * be refused at launch instead of failing obscurely at eval time. The CLI
 * stamps this value into each app's meta.json "fw" field at deploy time;
 * lume_apps_tag_check() compares it here at launch. A missing fw field
 * (pre-r106 app) is "unknown compatibility": launch is allowed with a WARN. */
extern const unsigned long LUME_API_TAG;

/* Mount LittleFS (idempotent) and create /apps if missing. Returns 0 when the
 * store is usable, negative when the filesystem is unavailable. */
int lume_apps_init(void);

/* Emit every installed app id (a directory with an app.js) in ascending id
 * order. `emit` may be NULL (count-only). Returns the app count, or a negative
 * error when the filesystem is unavailable. */
typedef void (*lume_apps_emit_fn)(void *arg, const char *id);
int lume_apps_list(lume_apps_emit_fn emit, void *arg);

/* Load /apps/<id>/app.js into a PSRAM buffer (NOT capped by Fs.read's 64 KiB).
 * Caller owns *out and must heap_caps_free() it. */
int lume_apps_read(const char *id, char **out, size_t *len);

/* Read /apps/<id>/meta.json into a heap buffer (NUL terminated, not included
 * in *len). Missing meta is LUME_APPS_ERR_NOTFOUND. Caller frees *out. */
int lume_apps_meta_read(const char *id, char **out, size_t *len);

/* Write meta.json (when meta_len > 0) and app.js. Existing files are replaced.
 * The id must already be valid (lume_app_id_valid). */
int lume_apps_store(const char *id, const char *meta, size_t meta_len,
                    const char *src, size_t src_len);

/* Delete app.js, meta.json and the directory. Clears .current when it pointed
 * at `id`. Returns LUME_APPS_ERR_NOTFOUND when the app is not installed. */
int lume_apps_remove(const char *id);

/* "Last started app" marker. current() copies "" (and clears nothing) when no
 * app was started yet. set_current("") removes the marker. */
int lume_apps_current(char *out, size_t cap);
int lume_apps_set_current(const char *id);

/* Independent boot pin. Empty id removes .boot; missing/corrupt reads as "". */
int lume_apps_boot_pin(char *out, size_t cap);
int lume_apps_set_boot(const char *id);

/* Boot selection: valid installed .boot target, then installed .current,
 * then the built-in home screen. */
bool lume_apps_boot_id(char *out, size_t cap);

/* r106 API-tag compatibility: decide launch permission from the app's
 * meta.json "fw" field. Returns LUME_APPS_OK when the tag matches LUME_API_TAG
 * (or is absent = pre-r106 app, allowed with a WARN), LUME_APPS_ERR_FWTAG on a
 * mismatch (both tag values are logged), or another negative fs/id error.
 * Called from both boot recovery and the runtime LAUNCH path. */
int lume_apps_tag_check(const char *id);

bool lume_apps_valid_id(const char *id);
