/**
 * lume-storage: NVS-backed persistent key-value store behind the
 * lume.storage.kv JS bindings (M2 / r10).
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal JS args
 * and turn these int statuses / value structs into JS values. Every entry
 * point runs on the QuickJS engine task only (same thread as the other
 * lume.* bindings). NVS itself is internally locked (nvs_api.cpp:300,314
 * `Lock lock;` in every nvs_* wrapper), so this layer takes no lock of its
 * own. All state here is engine-task-only and, like the natives, survives a
 * hot-reload runtime reset.
 *
 * Status contract (returned to JS as a number):
 *   0   LUME_KV_OK           success
 *  -1   LUME_KV_ERR_ARG      empty/over-length key, over-length/unsupported value
 *  -2   LUME_KV_ERR_DRIVER   an ESP-IDF nvs_* call failed (logged via ESP_LOGW)
 *  -3   LUME_KV_ERR_STATE    NVS not available: nvs_flash_init()/nvs_open()
 *                            failed (e.g. partition table has no NVS partition)
 *
 * DEGRADATION: nvs_flash_init() failure is NON-FATAL (WARN only, no abort,
 * no erase). require_ready() funnels EVERY entry point to -3 when NVS is not
 * up, so a missing/broken NVS partition can never crash the JS runtime. This
 * mirrors lume.pmic / lume.imu's -3 state contract. A failed init does NOT
 * latch; the next register_bindings() pass (hot-reload runtime reset) retries
 * from scratch. A SUCCESSFUL init latches for the process lifetime (r8/r9
 * policy), so nvs_open() is never called twice against a live handle.
 *
 * Type mapping (one distinct NVS type per JS type -- verified against
 * ESP-IDF v5.5.5 headers before coding):
 *   JS string        -> nvs_set_str  -> NVS_TYPE_STR  (0x21) -> nvs_get_str
 *   JS number (int)  -> nvs_set_i32  -> NVS_TYPE_I32  (0x14) -> nvs_get_i32
 *   JS boolean       -> nvs_set_u8   -> NVS_TYPE_U8   (0x01) -> nvs_get_u8
 *   JS ArrayBuffer   -> nvs_set_blob -> NVS_TYPE_BLOB (0x42) -> nvs_get_blob
 * get() recovers the JS type with nvs_find_key() (nvs.h:521): blobs are
 * reported as NVS_TYPE_BLOB because NVSHandleSimple::find_key maps the
 * internal BLOB_IDX/BLOB to BLOB_DATA (nvs_handle_simple.cpp:77-80, and
 * ItemType::BLOB_DATA == NVS_TYPE_BLOB in nvs_handle.hpp:38). Overwriting a
 * key with a different JS type is safe: Storage::writeItem finds the old key
 * with ItemType::ANY, writes the new type and erases the old entry
 * (nvs_storage.cpp:445-461, 534-589) -- no manual erase is needed here.
 *
 * API facts verified in /opt/esp/esp-idf (v5.5.5):
 *   - nvs.h:58              NVS_DEFAULT_PART_NAME "nvs"
 *   - nvs.h:61              NVS_KEY_NAME_MAX_SIZE 16 (INCLUDING the NUL) ->
 *                           max key content = 15 chars
 *   - nvs.h:62              NVS_NS_NAME_MAX_SIZE == NVS_KEY_NAME_MAX_SIZE ->
 *                           namespace also <= 15 chars
 *   - nvs.h:102-114         nvs_type_t values cited above
 *   - nvs.h:294-296         nvs_set_str max 4000 bytes incl. NUL (one free page)
 *   - nvs.h:327-329         nvs_set_blob max 508000 or (97.6% part - 4000) B;
 *                           for our 24 KB partition that theoretical bound is
 *                           ~19 KB, far above what a single page can hold, so
 *                           we impose a conservative 4000-byte native cap
 *   - nvs_flash.h:78        nvs_flash_init(void) -> esp_err_t
 *   - nvs_flash is idempotent: nvs_partition_manager.cpp:41-44 returns ESP_OK
 *     when the partition is already registered, so calling it here is safe
 *     even if another IDF component initialized NVS first
 *   - nvs.h:757,775,789,799 nvs_entry_find_in_handle / next / info / release
 *     iterator for keys()
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUME_KV_OK           0
#define LUME_KV_ERR_ARG     (-1)
#define LUME_KV_ERR_DRIVER  (-2)
#define LUME_KV_ERR_STATE   (-3)

/* Fixed default namespace. NVS namespace names are <= 15 chars
 * (nvs.h:62); a single fixed namespace keeps keys()/clear() unambiguous and
 * avoids a second length-validated JS parameter. See docs/KNOWN-SIMPLIFICATIONS.md
 * (r10) for the tradeoff vs a JS-specifiable namespace. */
#define LUME_KV_NAMESPACE   "lume"

/* Max key content length = NVS_KEY_NAME_MAX_SIZE(16) - 1 NUL = 15. */
#define LUME_KV_KEY_MAX     15

/* Conservative per-value cap (string payload bytes OR blob bytes). A value
 * may not reach LUME_KV_VALUE_MAX: a string of 3999 bytes + NUL = 4000, the
 * nvs_set_str single-page limit; a 4000-byte blob is ~one NVS page, well under
 * the 24 KB partition. Rejecting anything >= this keeps a single KV entry from
 * exhausting the small partition and bounds the native scratch malloc.
 * Documented in docs/KNOWN-SIMPLIFICATIONS.md (r10 section). */
#define LUME_KV_VALUE_MAX   4000

/* Result type tag for lume_kv_get(). LUME_KV_T_NONE means "key not found"
 * (get() still returns LUME_KV_OK; the native maps NONE to JS null). */
typedef enum {
    LUME_KV_T_NONE = 0,
    LUME_KV_T_STR,
    LUME_KV_T_INT,
    LUME_KV_T_BOOL,
    LUME_KV_T_BLOB,
} lume_kv_type_t;

/* One value in/out of lume_kv_get(). For STR/BLOB, `buf` is a heap buffer
 * owned by the caller, which MUST release it with lume_kv_value_free().
 *   STR:  buf is NUL-terminated, len = content bytes (excludes the NUL)
 *   BLOB: len = payload bytes
 *   INT:  i holds the int32 value
 *   BOOL: i is 0/1
 * For T_NONE / INT / BOOL, buf == NULL and free is a no-op. */
typedef struct {
    lume_kv_type_t type;
    int32_t  i;
    uint8_t *buf;
    size_t   len;
} lume_kv_value_t;

/* One-time NVS setup: nvs_flash_init() + nvs_open("lume", NVS_READWRITE).
 * Idempotent (a SUCCESSFUL init latches for the process lifetime); a FAILED
 * init does NOT latch and returns LUME_KV_ERR_STATE so the next pass retries.
 * Non-fatal: never aborts, never erases the partition. Call from
 * register_bindings() on every fresh runtime (r8/r9 policy). */
int lume_kv_init(void);

/* Read a key. Returns LUME_KV_OK with out->type == LUME_KV_T_NONE when the
 * key is absent (native maps that to JS null), LUME_KV_OK with a populated
 * value when found, or a negative error code. On a STR/BLOB result the caller
 * owns out->buf and must call lume_kv_value_free(). */
int lume_kv_get(const char *key, lume_kv_value_t *out);

/* Release a STR/BLOB buffer returned by lume_kv_get() (no-op otherwise). */
void lume_kv_value_free(lume_kv_value_t *out);

/* Typed setters. `key` is validated (non-empty, <= LUME_KV_KEY_MAX chars).
 * set_str / set_blob reject values >= LUME_KV_VALUE_MAX bytes. Each setter
 * commits to flash (nvs_commit) so the value survives a power cycle. Returns
 * LUME_KV_OK or a negative error code. */
int lume_kv_set_str(const char *key, const char *str, size_t len);
int lume_kv_set_int(const char *key, int32_t value);
int lume_kv_set_bool(const char *key, bool value);
int lume_kv_set_blob(const char *key, const uint8_t *data, size_t len);

/* Remove one key (idempotent: a missing key is LUME_KV_OK) and erase ALL
 * keys in the namespace respectively. Both commit. Return LUME_KV_OK or a
 * negative error code. */
int lume_kv_remove(const char *key);
int lume_kv_clear(void);

/* Enumerate every key in the namespace. `emit` is called once per key with
 * a NUL-terminated key string. Returns LUME_KV_OK (empty namespace -> emit is
 * never called) or a negative error code. Implemented with the NVS handle
 * iterator (nvs_entry_find_in_handle / nvs_entry_next / nvs_entry_info), which
 * is released on every path. */
typedef void (*lume_kv_key_fn)(void *arg, const char *key);
int lume_kv_keys(lume_kv_key_fn emit, void *arg);
