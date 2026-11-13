/**
 * lume-storage: NVS-backed persistent KV store (M2 / r10).
 *
 * ESP-IDF v5.5.5 API facts were verified against the installed headers/source
 * BEFORE coding; see the file-top evidence table in include/lume_kv.h. This
 * file is pure C (no QuickJS): the lume_engine.c natives marshal JS args.
 *
 * Thread discipline: every entry point is called ONLY from the QuickJS engine
 * task. NVS has its own internal lock (nvs_api.cpp `Lock lock;` in each
 * nvs_* wrapper), so this layer adds no lock. No board dependency: NVS lives
 * in the ESP32-S3's main flash and needs no external peripheral, so unlike
 * lume-pmic / lume-imu there is no "no board" path -- the only failure mode
 * is a missing/uninitialisable NVS partition, degraded to -3 (WARN, no crash).
 *
 * Init policy (r8/r9-reviewed): a SUCCESSFUL init latches for the process
 * lifetime (idempotent across hot-reload runtime resets); a FAILED init does
 * NOT latch and returns -3, so the next register_bindings() pass retries.
 * nvs_flash_init() is deliberately NOT followed by an auto-erase+retry (the
 * stock ESP-IDF NO_FREE_PAGES / NEW_VERSION_FOUND recipe): silently erasing a
 * user's persisted KV data would be a data-loss footgun. A truncated or
 * version-mismatched partition is reported via WARN and left for the main
 * controller to erase explicitly.
 */
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "esp_err.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "lume_kv.h"

static const char *TAG = "lume-kv";

/* Valid iff s_ready. nvs_handle_t is uint32_t and could be 0, so readiness
 * is tracked by an explicit bool rather than by a sentinel handle value. */
static nvs_handle_t s_handle;
static bool s_ready   = false;   /* nvs_flash_init + nvs_open both succeeded */
static bool s_init_ok = false;   /* successful init latched for process lifetime */

/* NVS key names are at most NVS_KEY_NAME_MAX_SIZE-1 = 15 chars (nvs.h:61,
 * the size includes the NUL). Empty keys are rejected by nvs_* too, but we
 * check here so the error is a clean -1 instead of a driver error. */
static int check_key(const char *key)
{
    if (key == NULL || key[0] == '\0') {
        return LUME_KV_ERR_ARG;
    }
    if (strlen(key) > LUME_KV_KEY_MAX) {
        ESP_LOGW(TAG, "key too long (%u > %d chars)",
                 (unsigned)strlen(key), LUME_KV_KEY_MAX);
        return LUME_KV_ERR_ARG;
    }
    return LUME_KV_OK;
}

/* Single funnel for the NVS-not-available degradation path: EVERY public
 * entry point calls this first, so a missing/broken NVS partition yields a
 * uniform -3 and never a crash. */
static int require_ready(void)
{
    if (!s_ready) {
        ESP_LOGW(TAG, "NVS KV unavailable (nvs_flash_init failed / no NVS partition)");
        return LUME_KV_ERR_STATE;
    }
    return LUME_KV_OK;
}

/* Map any non-OK esp_err_t from a nvs_* call to -2 with a WARN line. */
static int map_err(esp_err_t err, const char *what)
{
    ESP_LOGW(TAG, "%s failed: %s", what, esp_err_to_name(err));
    return LUME_KV_ERR_DRIVER;
}

int lume_kv_init(void)
{
    if (s_init_ok) {
        return s_ready ? LUME_KV_OK : LUME_KV_ERR_STATE;
    }

    /* Idempotent (nvs_partition_manager.cpp:41-44): safe even if another IDF
     * component already initialized the default "nvs" partition. */
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "nvs_flash_init failed: %s (NVS partition missing / "
                      "truncated / version mismatch?); KV bindings disabled",
                 esp_err_to_name(err));
        return LUME_KV_ERR_STATE;   /* do NOT latch: retry next runtime */
    }

    err = nvs_open(LUME_KV_NAMESPACE, NVS_READWRITE, &s_handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "nvs_open('%s') failed: %s; KV bindings disabled",
                 LUME_KV_NAMESPACE, esp_err_to_name(err));
        return LUME_KV_ERR_STATE;   /* do NOT latch */
    }

    s_ready   = true;
    s_init_ok = true;   /* publish + latch only after full success */
    ESP_LOGI(TAG, "NVS KV ready (partition 'nvs', namespace '%s', "
                  "key<=%d chars, value<%d B)",
             LUME_KV_NAMESPACE, LUME_KV_KEY_MAX, LUME_KV_VALUE_MAX);
    return LUME_KV_OK;
}

int lume_kv_set_str(const char *key, const char *str, size_t len)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }
    /* value cap: len + 1 (NUL) must stay <= LUME_KV_VALUE_MAX, i.e. the
     * nvs_set_str 4000-byte single-page limit (nvs.h:294-296). */
    if (str == NULL || len >= LUME_KV_VALUE_MAX) {
        ESP_LOGW(TAG, "set_str: value too long (%u B, limit < %d)",
                 (unsigned)len, LUME_KV_VALUE_MAX);
        return LUME_KV_ERR_ARG;
    }
    /* nvs_set_str writes a C string; an embedded NUL would silently truncate
     * on read. Reject it rather than corrupt the value. */
    if (memchr(str, '\0', len) != NULL) {
        ESP_LOGW(TAG, "set_str: value contains an embedded NUL");
        return LUME_KV_ERR_ARG;
    }
    esp_err_t err = nvs_set_str(s_handle, key, str);
    if (err != ESP_OK) {
        return map_err(err, "nvs_set_str");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_set_int(const char *key, int32_t value)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }
    esp_err_t err = nvs_set_i32(s_handle, key, value);
    if (err != ESP_OK) {
        return map_err(err, "nvs_set_i32");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_set_bool(const char *key, bool value)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }
    /* Stored as U8 (0/1) so nvs_find_key() reports NVS_TYPE_U8, distinct
     * from the I32 used for numbers -- get() can reconstruct a JS boolean. */
    esp_err_t err = nvs_set_u8(s_handle, key, value ? 1 : 0);
    if (err != ESP_OK) {
        return map_err(err, "nvs_set_u8");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_set_blob(const char *key, const uint8_t *data, size_t len)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }
    /* Native-side blob-size defence. nvs_set_blob's own theoretical limit for
     * our 24 KB partition is ~19 KB (nvs.h:327-329); we cap far below that so
     * one entry cannot exhaust the partition and to bound scratch mallocs.
     * Zero-length blobs are rejected (detached/empty ArrayBuffers). */
    if (data == NULL || len == 0 || len >= LUME_KV_VALUE_MAX) {
        ESP_LOGW(TAG, "set_blob: invalid/over-length blob (%u B, limit 1..%d)",
                 (unsigned)len, LUME_KV_VALUE_MAX - 1);
        return LUME_KV_ERR_ARG;
    }
    esp_err_t err = nvs_set_blob(s_handle, key, data, len);
    if (err != ESP_OK) {
        return map_err(err, "nvs_set_blob");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_get(const char *key, lume_kv_value_t *out)
{
    memset(out, 0, sizeof(*out));   /* type = LUME_KV_T_NONE, buf = NULL */
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }

    /* Recover the JS type from the NVS entry type (see the type map in
     * lume_kv.h). nvs_find_key maps blobs to NVS_TYPE_BLOB. */
    nvs_type_t t;
    esp_err_t err = nvs_find_key(s_handle, key, &t);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return LUME_KV_OK;         /* type stays NONE -> JS null */
    }
    if (err != ESP_OK) {
        return map_err(err, "nvs_find_key");
    }

    switch (t) {
    case NVS_TYPE_I32: {
        int32_t v = 0;
        err = nvs_get_i32(s_handle, key, &v);
        if (err != ESP_OK) {
            return map_err(err, "nvs_get_i32");
        }
        out->type = LUME_KV_T_INT;
        out->i = v;
        return LUME_KV_OK;
    }
    case NVS_TYPE_U8: {
        uint8_t v = 0;
        err = nvs_get_u8(s_handle, key, &v);
        if (err != ESP_OK) {
            return map_err(err, "nvs_get_u8");
        }
        out->type = LUME_KV_T_BOOL;
        out->i = v ? 1 : 0;
        return LUME_KV_OK;
    }
    case NVS_TYPE_STR:
    case NVS_TYPE_BLOB: {
        /* WinAPI-style two-pass length query (nvs.h:450-472). STR length
         * includes the NUL terminator; BLOB length is the payload bytes. */
        size_t need = 0;
        err = (t == NVS_TYPE_STR)
                  ? nvs_get_str(s_handle, key, NULL, &need)
                  : nvs_get_blob(s_handle, key, NULL, &need);
        if (err != ESP_OK) {
            return map_err(err, "nvs_get_str/blob(size)");
        }
        /* Defend the read side too: a blob written by other firmware could
         * exceed our cap; never malloc an unbounded scratch buffer. */
        if (need == 0 || need >= LUME_KV_VALUE_MAX) {
            ESP_LOGW(TAG, "get: stored value size %u B out of range",
                     (unsigned)need);
            return LUME_KV_ERR_DRIVER;
        }
        uint8_t *buf = malloc(need);
        if (buf == NULL) {
            ESP_LOGW(TAG, "get: scratch alloc failed (%u B)", (unsigned)need);
            return LUME_KV_ERR_DRIVER;
        }
        size_t got = need;
        err = (t == NVS_TYPE_STR)
                  ? nvs_get_str(s_handle, key, (char *)buf, &got)
                  : nvs_get_blob(s_handle, key, buf, &got);
        if (err != ESP_OK) {
            free(buf);
            return map_err(err, "nvs_get_str/blob");
        }
        out->buf = buf;
        if (t == NVS_TYPE_STR) {
            out->type = LUME_KV_T_STR;
            out->len = strlen((const char *)buf);   /* excludes NUL */
        } else {
            out->type = LUME_KV_T_BLOB;
            out->len = got;
        }
        return LUME_KV_OK;
    }
    default:
        /* An NVS type we never produce (I8/U16/U64/...), e.g. written by
         * other firmware. Never guess at the JS type. */
        ESP_LOGW(TAG, "get: key '%s' has unsupported NVS type 0x%02x",
                 key, (unsigned)t);
        return LUME_KV_ERR_DRIVER;
    }
}

void lume_kv_value_free(lume_kv_value_t *out)
{
    if (out != NULL && out->buf != NULL) {
        free(out->buf);
        out->buf = NULL;
    }
    if (out != NULL) {
        out->len = 0;
    }
}

int lume_kv_remove(const char *key)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    r = check_key(key);
    if (r != LUME_KV_OK) {
        return r;
    }
    esp_err_t err = nvs_erase_key(s_handle, key);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return LUME_KV_OK;         /* idempotent delete of a missing key */
    }
    if (err != ESP_OK) {
        return map_err(err, "nvs_erase_key");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_clear(void)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }
    esp_err_t err = nvs_erase_all(s_handle);
    if (err != ESP_OK) {
        return map_err(err, "nvs_erase_all");
    }
    return map_err(nvs_commit(s_handle), "nvs_commit");
}

int lume_kv_keys(lume_kv_key_fn emit, void *arg)
{
    int r = require_ready();
    if (r != LUME_KV_OK) {
        return r;
    }

    nvs_iterator_t it = NULL;
    /* Scoped to the open handle's partition + namespace (nvs.h:757). */
    esp_err_t err = nvs_entry_find_in_handle(s_handle, NVS_TYPE_ANY, &it);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return LUME_KV_OK;         /* empty namespace -> emit never called */
    }
    if (err != ESP_OK) {
        return map_err(err, "nvs_entry_find_in_handle");
    }

    /* Official iteration pattern (nvs.h:682-692). nvs_entry_next frees the
     * iterator and sets it to NULL at the end (nvs_api.cpp:859-864), and
     * nvs_release_iterator(NULL) is a no-op (nvs_api.cpp:880-883). */
    for (;;) {
        nvs_entry_info_t info;
        if (nvs_entry_info(it, &info) == ESP_OK && emit != NULL) {
            emit(arg, info.key);
        }
        err = nvs_entry_next(&it);
        if (err == ESP_ERR_NVS_NOT_FOUND) {
            break;                 /* normal end of iteration */
        }
        if (err != ESP_OK) {
            nvs_release_iterator(it);
            return map_err(err, "nvs_entry_next");
        }
    }
    nvs_release_iterator(it);
    return LUME_KV_OK;
}
