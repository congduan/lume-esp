/**
 * lume_apps (r30): on-device multi-app store, backed by LittleFS.
 * See include/lume_apps.h for the on-disk layout and the single-live-app rule.
 *
 * Threading: the store is called from the engine task (JS natives) AND from
 * the push channels' RX tasks (STORE/LIST/REMOVE commands). Every public entry
 * point takes one recursive mutex, so a command cannot interleave with a
 * launch read. LittleFS itself is thread-safe per operation; the lock makes
 * multi-file operations (mkdir + meta + bundle) atomic as seen by us.
 *
 * The store is deliberately dumb: it copies bytes to/from /apps and never
 * parses an app. meta.json stays opaque text for the JS side
 * (lume.apps.entries()), so the firmware needs no JSON parser and app metadata
 * can grow without a firmware change.
 */
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lume_apps.h"
#include "lume_fwtag.h"
#include "lume_fs.h"

static const char *TAG = "lume-apps";

#define APPS_DIR          "apps"
#define CURRENT_PATH      "apps/.current"
#define BOOT_PATH         "apps/.boot"
#define LIST_MAX          64
#define APP_BUNDLE_MAX    (256u * 1024u)   /* matches LUME_FRAME_MAX_PAYLOAD */
#define FWTAG_TEXT_MAX    24               /* decimal fw value + NUL */

/* r106: bump when an app-visible contract changes (lume.d.ts surface, bridge
 * ATTR/OP ids, prelude globals). History: 1 = initial tag (r106 baseline). */
const unsigned long LUME_API_TAG = 1;

static bool s_ready;
static SemaphoreHandle_t s_lock;   /* recursive: public calls nest (remove) */

static int path_for(char *out, size_t cap, const char *id, const char *leaf)
{
    int n = snprintf(out, cap, "%s/%s/%s", APPS_DIR, id, leaf);
    return (n > 0 && (size_t)n < cap) ? LUME_APPS_OK : LUME_FS_ERR_ARG;
}

bool lume_apps_valid_id(const char *id)
{
    return id != NULL && lume_app_id_valid(id, strlen(id));
}

int lume_apps_init(void)
{
    if (s_lock == NULL) {
        s_lock = xSemaphoreCreateRecursiveMutex();
        if (s_lock == NULL) {
            ESP_LOGE(TAG, "store mutex create failed (OOM)");
            return LUME_FS_ERR_STATE;
        }
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    int r = LUME_APPS_OK;
    if (s_ready) {
        goto done;
    }
    r = lume_fs_init();
    if (r < 0) {
        ESP_LOGW(TAG, "filesystem unavailable (%d); multi-app store disabled", r);
        goto done;
    }
    r = lume_fs_mkdir(APPS_DIR);
    if (r < 0) {
        ESP_LOGW(TAG, "mkdir %s failed (%d)", APPS_DIR, r);
        goto done;
    }
    s_ready = true;
    r = LUME_APPS_OK;
done:
    xSemaphoreGiveRecursive(s_lock);
    return r;
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */
typedef struct {
    char ids[LIST_MAX][LUME_APP_ID_MAX];
    int  count;
} id_list_t;

static void collect(void *arg, const char *name)
{
    id_list_t *l = (id_list_t *)arg;
    if (l->count >= LIST_MAX) {
        return;
    }
    size_t n = strlen(name);
    if (!lume_app_id_valid(name, n)) {
        return;
    }
    char probe[LUME_FS_PATH_MAX];
    if (path_for(probe, sizeof(probe), name, "app.js") < 0) {
        return;
    }
    bool exists = false;
    if (lume_fs_exists(probe, &exists) < 0 || !exists) {
        return;                    /* not an app directory */
    }
    memcpy(l->ids[l->count], name, n + 1);
    l->count++;
}

int lume_apps_list(lume_apps_emit_fn emit, void *arg)
{
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    /* 2 KiB of ids: keep it off the caller's stack. LIST runs on the push
     * channel's RX task (4 KiB stack) and a stack copy overflows it, which
     * looked like "the device never answers LIST". */
    id_list_t *list = heap_caps_malloc(sizeof(id_list_t), MALLOC_CAP_SPIRAM);
    if (list == NULL) {
        xSemaphoreGiveRecursive(s_lock);
        return LUME_FS_ERR_STATE;
    }
    memset(list, 0, sizeof(*list));
    int r = lume_fs_list(APPS_DIR, collect, list);
    if (r < 0) {
        heap_caps_free(list);
        xSemaphoreGiveRecursive(s_lock);
        return r;
    }
    /* Stable order for the CLI / launcher grid: insertion sort by id. */
    for (int i = 1; i < list->count; i++) {
        char key[LUME_APP_ID_MAX];
        memcpy(key, list->ids[i], sizeof(key));
        int j = i - 1;
        while (j >= 0 && strcmp(list->ids[j], key) > 0) {
            memcpy(list->ids[j + 1], list->ids[j], sizeof(key));
            j--;
        }
        memcpy(list->ids[j + 1], key, sizeof(key));
    }
    const int count = list->count;
    for (int i = 0; i < count; i++) {
        if (emit != NULL) {
            emit(arg, list->ids[i]);
        }
    }
    heap_caps_free(list);
    xSemaphoreGiveRecursive(s_lock);
    return count;
}

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */
int lume_apps_read(const char *id, char **out, size_t *len)
{
    if (out == NULL || len == NULL || !lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    *out = NULL;
    *len = 0;
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    char path[LUME_FS_PATH_MAX];
    int r = path_for(path, sizeof(path), id, "app.js");
    if (r < 0) {
        return r;
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    uint8_t *data = NULL;
    size_t n = 0;
    r = lume_fs_read_psram(path, APP_BUNDLE_MAX, &data, &n);
    xSemaphoreGiveRecursive(s_lock);
    if (r < 0) {
        return r;
    }
    *out = (char *)data;
    *len = n;
    return LUME_APPS_OK;
}

int lume_apps_meta_read(const char *id, char **out, size_t *len)
{
    if (out == NULL || len == NULL || !lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    *out = NULL;
    *len = 0;
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    char path[LUME_FS_PATH_MAX];
    int r = path_for(path, sizeof(path), id, "meta.json");
    if (r < 0) {
        return r;
    }
    bool exists = false;
    if (lume_fs_exists(path, &exists) < 0 || !exists) {
        return LUME_APPS_ERR_NOTFOUND;
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    uint8_t *data = NULL;
    size_t n = 0;
    r = lume_fs_read_psram(path, 4 * 1024, &data, &n);
    xSemaphoreGiveRecursive(s_lock);
    if (r < 0) {
        return r;
    }
    *out = (char *)data;
    *len = n;
    return LUME_APPS_OK;
}

int lume_apps_store(const char *id, const char *meta, size_t meta_len,
                    const char *src, size_t src_len)
{
    if (!lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    if (src == NULL || src_len == 0 || src_len > APP_BUNDLE_MAX) {
        return LUME_FS_ERR_ARG;
    }
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    char dir[LUME_FS_PATH_MAX];
    int n = snprintf(dir, sizeof(dir), "%s/%s", APPS_DIR, id);
    if (n <= 0 || (size_t)n >= sizeof(dir)) {
        return LUME_FS_ERR_ARG;
    }
    char meta_path[LUME_FS_PATH_MAX];
    char src_path[LUME_FS_PATH_MAX];
    int r = path_for(meta_path, sizeof(meta_path), id, "meta.json");
    if (r < 0) {
        return r;
    }
    r = path_for(src_path, sizeof(src_path), id, "app.js");
    if (r < 0) {
        return r;
    }

    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    r = lume_fs_mkdir(dir);
    if (r < 0) {
        xSemaphoreGiveRecursive(s_lock);
        return r;
    }

    /* meta first: a torn write leaves the old/new bundle with stale metadata,
     * which is harmless, while a bundle without metadata would hide the app. */
    if (meta != NULL && meta_len > 0) {
        /* The format is one JSON line; never let a '\n' split the file. */
        size_t line = 0;
        while (line < meta_len && meta[line] != '\n' && meta[line] != '\r') {
            line++;
        }
        r = lume_fs_write(meta_path, (const uint8_t *)meta, line, false);
    } else {
        r = lume_fs_remove(meta_path);   /* missing meta is not an error */
    }
    if (r >= 0) {
        r = lume_fs_write(src_path, (const uint8_t *)src, src_len, false);
    }
    /* r106: the fw tag lives in meta.json and is written by the CLI (which
     * queries the device via FWTAG before STORE). The firmware stores the meta
     * verbatim here; no sidecar, no JSON parsing on the write path. */
    xSemaphoreGiveRecursive(s_lock);
    if (r == 0) {
        ESP_LOGI(TAG, "stored app '%s' (%u bytes)", id, (unsigned)src_len);
    }
    return r;
}

int lume_apps_remove(const char *id)
{
    if (!lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    char path[LUME_FS_PATH_MAX];
    char dir[LUME_FS_PATH_MAX];
    bool exists = false;
    if (path_for(path, sizeof(path), id, "app.js") < 0 ||
        lume_fs_exists(path, &exists) < 0 || !exists) {
        return LUME_APPS_ERR_NOTFOUND;
    }
    int n = snprintf(dir, sizeof(dir), "%s/%s", APPS_DIR, id);
    if (n <= 0 || (size_t)n >= sizeof(dir)) {
        return LUME_FS_ERR_ARG;
    }

    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    int r = lume_fs_remove(path);
    if (r == 0 && path_for(path, sizeof(path), id, "meta.json") == 0) {
        (void)lume_fs_remove(path);
    }
    if (r == 0) {
        (void)lume_fs_rmdir(dir);
    }
    /* Clearing the marker nests into set_current(), hence the recursive lock. */
    char cur[LUME_APP_ID_MAX];
    if (r == 0 && lume_apps_current(cur, sizeof(cur)) == 0 &&
        strcmp(cur, id) == 0) {
        (void)lume_apps_set_current("");
    }
    xSemaphoreGiveRecursive(s_lock);
    if (r == 0) {
        ESP_LOGI(TAG, "removed app '%s'", id);
    }
    return r;
}

/* ------------------------------------------------------------------ */
/* Last-started marker                                                 */
/* ------------------------------------------------------------------ */
static int marker_read(const char *path, char *out, size_t cap)
{
    if (out == NULL || cap < 2) {
        return LUME_FS_ERR_ARG;
    }
    out[0] = '\0';
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    bool exists = false;
    if (lume_fs_exists(path, &exists) < 0 || !exists) {
        return LUME_APPS_OK;
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    uint8_t *data = NULL;
    size_t len = 0;
    int r = lume_fs_read_psram(path, LUME_APP_ID_MAX, &data, &len);
    xSemaphoreGiveRecursive(s_lock);
    if (r < 0) {
        return r;
    }
    while (len > 0 && (data[len - 1] == '\n' || data[len - 1] == '\r' ||
                       data[len - 1] == ' ')) {
        len--;
    }
    if (len == 0 || len >= cap || !lume_app_id_valid((const char *)data, len)) {
        heap_caps_free(data);
        return LUME_APPS_OK;       /* corrupt marker = no app */
    }
    memcpy(out, data, len);
    out[len] = '\0';
    heap_caps_free(data);
    return LUME_APPS_OK;
}

static int marker_write(const char *path, const char *id)
{
    if (lume_apps_init() < 0) {
        return LUME_FS_ERR_STATE;
    }
    if (id != NULL && id[0] != '\0' && !lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    int r = (id == NULL || id[0] == '\0')
                ? lume_fs_remove(path)
                : lume_fs_write(path, (const uint8_t *)id,
                                strlen(id), false);
    xSemaphoreGiveRecursive(s_lock);
    /* Removing a marker that never existed is success. */
    return (r < 0) ? LUME_FS_ERR_STATE : LUME_APPS_OK;
}

int lume_apps_current(char *out, size_t cap)
{
    return marker_read(CURRENT_PATH, out, cap);
}

int lume_apps_set_current(const char *id)
{
    return marker_write(CURRENT_PATH, id);
}

int lume_apps_boot_pin(char *out, size_t cap)
{
    return marker_read(BOOT_PATH, out, cap);
}

int lume_apps_set_boot(const char *id)
{
    return marker_write(BOOT_PATH, id);
}

static bool installed_boot_app(const char *id)
{
    char path[LUME_FS_PATH_MAX];
    bool exists = false;
    return path_for(path, sizeof(path), id, "app.js") == 0 &&
           lume_fs_exists(path, &exists) == 0 && exists;
}

bool lume_apps_boot_id(char *out, size_t cap)
{
    if (out == NULL || cap == 0) {
        return false;
    }
    out[0] = '\0';
    if (lume_apps_boot_pin(out, cap) == 0 && out[0] != '\0') {
        if (installed_boot_app(out)) {
            return true;
        }
        ESP_LOGW(TAG, "boot pin '%s' missing; trying current app", out);
    }
    out[0] = '\0';
    if (lume_apps_current(out, cap) != 0 || out[0] == '\0') {
        return false;
    }
    /* The marker may outlive its app (removed on the host, or a partial
     * install): only boot it when app.js is really there. */
    if (!installed_boot_app(out)) {
        ESP_LOGW(TAG, "boot app '%s' missing; starting home", out);
        out[0] = '\0';
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* r106: deploy-manifest firmware API tag (compatibility safety net)   */
/* ------------------------------------------------------------------ */
int lume_apps_tag_check(const char *id)
{
    if (!lume_apps_valid_id(id)) {
        return LUME_APPS_ERR_ID;
    }
    char *meta = NULL;
    size_t meta_len = 0;
    int r = lume_apps_meta_read(id, &meta, &meta_len);
    if (r < 0) {
        /* No meta.json => no deploy manifest => unknown compatibility, same
         * policy as an old app: allow with a WARN rather than brick it. */
        ESP_LOGW(TAG, "app '%s' has no meta.json (pre-r106 install); "
                      "compatibility with API tag %lu unverified",
                      id, LUME_API_TAG);
        return LUME_APPS_OK;
    }
    char fw[FWTAG_TEXT_MAX];
    int got = lume_fwtag_extract(meta, meta_len, fw, sizeof(fw));
    heap_caps_free(meta);
    if (got != LUME_FWTAG_OK) {
        /* Pre-r106 app: no fw field. Allowed with a WARN so an existing
         * install survives a firmware update; a truly broken app still fails
         * loudly at eval (RELOAD ERR), just less specifically. */
        ESP_LOGW(TAG, "app '%s' has no fw tag in meta (pre-r106 install); "
                      "compatibility with API tag %lu unverified",
                      id, LUME_API_TAG);
        return LUME_APPS_OK;
    }
    int decision = lume_fwtag_decide(fw, LUME_API_TAG);
    if (decision == LUME_FWTAG_DECIDE_MISMATCH) {
        ESP_LOGW(TAG, "app '%s' built for API tag %s, firmware is %lu; "
                      "refusing launch", id, fw, LUME_API_TAG);
        return LUME_APPS_ERR_FWTAG;
    }
    return LUME_APPS_OK;   /* match, or an unreadable value = unknown (allow) */
}
