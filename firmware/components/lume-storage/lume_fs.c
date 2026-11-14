#include <errno.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_partition.h"
#include "esp_littlefs.h"
#include "lume_fs.h"

#define FS_BASE "/lume_fs"
#define FS_PART "storage"
static const char *TAG = "lume-fs";
static bool s_ready;

static int require_ready(void) { return s_ready ? LUME_FS_OK : LUME_FS_ERR_STATE; }
static int io_error(const char *op)
{
    ESP_LOGW(TAG, "%s failed: errno=%d", op, errno);
    return LUME_FS_ERR_DRIVER;
}

/* Reject traversal before joining the VFS prefix. Paths are root-relative;
 * both '/a/b' and 'a/b' address the same file. */
static int full_path(const char *path, char *out, bool allow_root)
{
    if (!path) return LUME_FS_ERR_ARG;
    size_t n = strlen(path);
    if (n == 0 || n > LUME_FS_PATH_MAX) return LUME_FS_ERR_ARG;
    const char *p = path;
    if (*p == '/') p++;
    if (!*p && !allow_root) return LUME_FS_ERR_ARG;
    while (*p) {
        const char *end = strchr(p, '/');
        size_t seg = end ? (size_t)(end - p) : strlen(p);
        if (seg == 0 || (seg == 2 && p[0] == '.' && p[1] == '.') ||
            (seg == 1 && p[0] == '.')) return LUME_FS_ERR_ARG;
        if (!end) break;
        p = end + 1;
        /* A trailing '/' is a directory convention -- apps classify entries
         * with exists(path + '/'). Normalize it instead of rejecting: "x/"
         * means the same node as "x". Interior empty segments stay invalid. */
    }
    char clean[LUME_FS_PATH_MAX + 1];
    size_t plen = strlen(path);
    if (plen == 0 || plen >= sizeof(clean)) return LUME_FS_ERR_ARG;
    memcpy(clean, path, plen + 1);
    while (plen > 1 && clean[plen - 1] == '/') clean[--plen] = '\0';
    if (snprintf(out, sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1, "%s%s%s",
                 FS_BASE, clean[0] == '/' ? "" : "/", clean) < 0)
        return LUME_FS_ERR_ARG;
    return LUME_FS_OK;
}

int lume_fs_init(void)
{
    if (s_ready) return LUME_FS_OK;
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_LITTLEFS, FS_PART);
    if (!part) {
        ESP_LOGW(TAG, "storage partition missing");
        return LUME_FS_ERR_STATE;
    }
    esp_vfs_littlefs_conf_t conf = {
        .base_path = FS_BASE, .partition_label = FS_PART,
        .format_if_mount_failed = true,
    };
    esp_err_t err = esp_vfs_littlefs_register(&conf);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "LittleFS mount failed: %s", esp_err_to_name(err));
        return LUME_FS_ERR_STATE;
    }
    s_ready = true;
    ESP_LOGI(TAG, "LittleFS mounted at %s", FS_BASE);
    return LUME_FS_OK;
}

bool lume_fs_mounted(void) { return s_ready && esp_littlefs_mounted(FS_PART); }

int lume_fs_write(const char *path, const uint8_t *data, size_t len, bool append)
{
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    if (!data && len) return LUME_FS_ERR_ARG;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    FILE *f = fopen(full, append ? "ab" : "wb");
    if (!f) return io_error("open write");
    bool ok = !len || fwrite(data, 1, len, f) == len;
    if (fclose(f) != 0) ok = false;
    return ok ? LUME_FS_OK : io_error("write/close");
}

int lume_fs_read(const char *path, uint8_t **data, size_t *len)
{
    if (!data || !len) return LUME_FS_ERR_ARG;
    *data = NULL; *len = 0;
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    FILE *f = fopen(full, "rb");
    if (!f) return io_error("open read");
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return io_error("seek"); }
    long size = ftell(f);
    if (size < 0 || size > LUME_FS_READ_MAX || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f); return LUME_FS_ERR_DRIVER;
    }
    uint8_t *buf = malloc(size ? (size_t)size : 1);
    if (!buf) { fclose(f); return LUME_FS_ERR_DRIVER; }
    bool ok = fread(buf, 1, (size_t)size, f) == (size_t)size;
    if (fclose(f) != 0) ok = false;
    if (!ok) { free(buf); return io_error("read/close"); }
    *data = buf; *len = (size_t)size;
    return LUME_FS_OK;
}

int lume_fs_read_psram(const char *path, size_t max_len, uint8_t **data,
                       size_t *len)
{
    if (!data || !len) return LUME_FS_ERR_ARG;
    *data = NULL; *len = 0;
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    FILE *f = fopen(full, "rb");
    if (!f) return io_error("open read");
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return io_error("seek"); }
    long size = ftell(f);
    if (size < 0 || (size_t)size > max_len || fseek(f, 0, SEEK_SET) != 0) {
        ESP_LOGW(TAG, "read_psram %s: size %ld exceeds cap %u", path, size,
                 (unsigned)max_len);
        fclose(f);
        return LUME_FS_ERR_ARG;
    }
    /* +1 keeps the caller free to NUL-terminate a text file in place. */
    uint8_t *buf = heap_caps_malloc((size_t)size + 1, MALLOC_CAP_SPIRAM);
    if (!buf) { fclose(f); return LUME_FS_ERR_DRIVER; }
    bool ok = fread(buf, 1, (size_t)size, f) == (size_t)size;
    if (fclose(f) != 0) ok = false;
    if (!ok) { heap_caps_free(buf); return io_error("read/close"); }
    buf[size] = 0;
    *data = buf;
    *len = (size_t)size;
    return LUME_FS_OK;
}

int lume_fs_remove(const char *path)
{
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (remove(full) == 0 || errno == ENOENT) return LUME_FS_OK;
    /* ESP-IDF routes remove() to the VFS unlink hook, and esp_littlefs rejects
     * directories with EISDIR (errno 21) even when empty -- it has a separate
     * rmdir hook. Retry once as rmdir so empty directories can be deleted;
     * apps do recursive removeTree() over children first, then hit this. */
    if (rmdir(full) == 0) return LUME_FS_OK;
    return io_error("remove");
}

int lume_fs_mkdir(const char *path)
{
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (mkdir(full, 0777) == 0) return LUME_FS_OK;
    if (errno == EEXIST) {
        struct stat st;
        if (stat(full, &st) == 0 && S_ISDIR(st.st_mode)) return LUME_FS_OK;
    }
    return io_error("mkdir");
}

int lume_fs_rmdir(const char *path)
{
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (rmdir(full) == 0 || errno == ENOENT) return LUME_FS_OK;
    return io_error("rmdir");
}

int lume_fs_exists(const char *path, bool *exists)
{
    if (!exists) return LUME_FS_ERR_ARG;
    *exists = false;
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, true);
    if (r < 0) return r;
    struct stat st;
    if (stat(full, &st) == 0) {
        /* full_path() strips a trailing slash so the VFS call succeeds, but
         * apps use exists(path + '/') as the "is a directory" test (there is
         * no stat-mode binding). Honor the convention: a trailing slash on a
         * regular file must report false, not true. */
        size_t plen = strlen(path);
        bool wants_dir = plen > 0 && path[plen - 1] == '/';
        *exists = wants_dir ? S_ISDIR(st.st_mode) : true;
        return LUME_FS_OK;
    }
    return errno == ENOENT ? LUME_FS_OK : io_error("exists");
}

int lume_fs_list(const char *path, lume_fs_entry_fn emit, void *arg)
{
    if (require_ready() < 0) return LUME_FS_ERR_STATE;
    char full[sizeof(FS_BASE) + LUME_FS_PATH_MAX + 1];
    int r = full_path(path, full, true);
    if (r < 0) return r;
    DIR *dir = opendir(full);
    if (!dir) return io_error("opendir");
    errno = 0;
    struct dirent *ent;
    while ((ent = readdir(dir))) {
        if (strcmp(ent->d_name, ".") && strcmp(ent->d_name, "..") && emit)
            emit(arg, ent->d_name);
        errno = 0;
    }
    int saved = errno;
    closedir(dir);
    if (saved) { errno = saved; return io_error("readdir"); }
    return LUME_FS_OK;
}
