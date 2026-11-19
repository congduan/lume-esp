/** TF/microSD card over SPI for lume.storage.Sd (r125).
 *
 * Follows the mp3_decoder SDSPI mount precedent (SPI3 + board profile
 * pins, format_if_mount_failed=false) and the lume_fs.c API/error
 * convention (0 / -1 arg / -2 IO / -3 unmounted). The mount is lazy and
 * one-shot: a card that fails to mount leaves every API returning -3
 * until reboot -- no auto-retry storm, and NEVER a format (the card may
 * hold user data, unlike the internal storage partition). */
#include <errno.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/unistd.h>
#include "driver/sdspi_host.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "esp_vfs_fat.h"
#include "ff.h"
#include "sdmmc_cmd.h"
#include "lume_pins.h"
#include "lume_sd.h"

#define SD_BASE "/lume_sd"

#if defined(LUME_PIN_SD_MOSI) && defined(LUME_PIN_SD_CLK) && \
    defined(LUME_PIN_SD_MISO) && defined(LUME_PIN_SD_CS)
#define LUME_SD_HAS_SLOT 1
static sdmmc_card_t *s_card;
#endif

static const char *TAG = "lume-sd";
static bool s_tried;
static bool s_ready;

/* Reject traversal before joining the VFS prefix; same rules as Fs so
 * apps can share path-handling code between the two stores. */
static int full_path(const char *path, char *out, bool allow_root)
{
    if (!path) return LUME_SD_ERR_ARG;
    size_t n = strlen(path);
    if (n == 0 || n > LUME_SD_PATH_MAX) return LUME_SD_ERR_ARG;
    const char *p = path;
    if (*p == '/') p++;
    if (!*p && !allow_root) return LUME_SD_ERR_ARG;
    while (*p) {
        const char *end = strchr(p, '/');
        size_t seg = end ? (size_t)(end - p) : strlen(p);
        if (seg == 0 || (seg == 2 && p[0] == '.' && p[1] == '.') ||
            (seg == 1 && p[0] == '.')) return LUME_SD_ERR_ARG;
        if (!end) break;
        p = end + 1;
    }
    char clean[LUME_SD_PATH_MAX + 1];
    size_t plen = strlen(path);
    if (plen == 0 || plen >= sizeof(clean)) return LUME_SD_ERR_ARG;
    memcpy(clean, path, plen + 1);
    while (plen > 1 && clean[plen - 1] == '/') clean[--plen] = '\0';
    if (snprintf(out, sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1,
                 "%s%s%s", SD_BASE, clean[0] == '/' ? "" : "/", clean) < 0)
        return LUME_SD_ERR_ARG;
    return LUME_SD_OK;
}

int lume_sd_init(void)
{
    if (s_tried) return s_ready ? LUME_SD_OK : LUME_SD_ERR_STATE;
    s_tried = true;
#ifndef LUME_SD_HAS_SLOT
    ESP_LOGW(TAG, "no TF slot pins in board profile");
    return LUME_SD_ERR_STATE;
#else
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI3_HOST;
    /* SDSPI_HOST_DEFAULT() runs 10 MHz -- the same speed class the
     * Waveshare demo uses over this slot; keep the default for the first
     * pass. max_transfer_sz 4096 matches the mp3_decoder precedent. */
    spi_bus_config_t bus = {.mosi_io_num = LUME_PIN_SD_MOSI,
                            .miso_io_num = LUME_PIN_SD_MISO,
                            .sclk_io_num = LUME_PIN_SD_CLK,
                            .quadwp_io_num = -1,
                            .quadhd_io_num = -1,
                            .max_transfer_sz = 4096};
    if (spi_bus_initialize(host.slot, &bus, SDSPI_DEFAULT_DMA) != ESP_OK)
        return LUME_SD_ERR_DRIVER;
    sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.gpio_cs = LUME_PIN_SD_CS;
    slot.host_id = host.slot;
    esp_vfs_fat_sdmmc_mount_config_t cfg = {
        .format_if_mount_failed = false,   /* never destroy card contents */
        .max_files = 4,
        .allocation_unit_size = 16 * 1024,
    };
    esp_err_t err =
        esp_vfs_fat_sdspi_mount(SD_BASE, &host, &slot, &cfg, &s_card);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "SD mount failed: %s", esp_err_to_name(err));
        spi_bus_free(host.slot);
        return LUME_SD_ERR_STATE;
    }
    s_ready = true;
    ESP_LOGI(TAG, "TF card mounted at %s", SD_BASE);
    return LUME_SD_OK;
#endif
}

bool lume_sd_mounted(void) { return s_ready; }

bool lume_sd_has_cd(void)
{
#if defined(LUME_PIN_SD_CD)
    return true;
#else
    return false;
#endif
}

int lume_sd_detect(void)
{
#if defined(LUME_PIN_SD_CD)
    /* Active-low is the common slot wiring; register the actual polarity
     * when a board profile defines a CD pin (none of the three current
     * profiles do). */
    return gpio_get_level((gpio_num_t)LUME_PIN_SD_CD) == 0;
#else
    return LUME_SD_ERR_NO_CD;
#endif
}

int lume_sd_write(const char *path, const uint8_t *data, size_t len,
                  bool append)
{
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    if (!data && len) return LUME_SD_ERR_ARG;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    FILE *f = fopen(full, append ? "ab" : "wb");
    if (!f) {
        ESP_LOGW(TAG, "open write %s failed: errno=%d", path, errno);
        return LUME_SD_ERR_DRIVER;
    }
    bool ok = !len || fwrite(data, 1, len, f) == len;
    if (fclose(f) != 0) ok = false;
    return ok ? LUME_SD_OK : LUME_SD_ERR_DRIVER;
}

int lume_sd_read(const char *path, uint8_t **data, size_t *len)
{
    if (!data || !len) return LUME_SD_ERR_ARG;
    *data = NULL;
    *len = 0;
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    FILE *f = fopen(full, "rb");
    if (!f) {
        ESP_LOGW(TAG, "open read %s failed: errno=%d", path, errno);
        return LUME_SD_ERR_DRIVER;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return LUME_SD_ERR_DRIVER;
    }
    long size = ftell(f);
    if (size < 0 || size > LUME_SD_READ_MAX || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return LUME_SD_ERR_DRIVER;
    }
    uint8_t *buf = malloc(size ? (size_t)size : 1);
    if (!buf) {
        fclose(f);
        return LUME_SD_ERR_DRIVER;
    }
    bool ok = fread(buf, 1, (size_t)size, f) == (size_t)size;
    if (fclose(f) != 0) ok = false;
    if (!ok) {
        free(buf);
        return LUME_SD_ERR_DRIVER;
    }
    *data = buf;
    *len = (size_t)size;
    return LUME_SD_OK;
}

int lume_sd_remove(const char *path)
{
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (remove(full) == 0 || errno == ENOENT) return LUME_SD_OK;
    /* Same VFS behavior as Fs: unlink of a directory fails with EISDIR;
     * retry as rmdir so empty directories can be deleted. */
    if (rmdir(full) == 0) return LUME_SD_OK;
    ESP_LOGW(TAG, "remove %s failed: errno=%d", path, errno);
    return LUME_SD_ERR_DRIVER;
}

int lume_sd_mkdir(const char *path)
{
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (mkdir(full, 0777) == 0) return LUME_SD_OK;
    if (errno == EEXIST) {
        struct stat st;
        if (stat(full, &st) == 0 && S_ISDIR(st.st_mode)) return LUME_SD_OK;
    }
    ESP_LOGW(TAG, "mkdir %s failed: errno=%d", path, errno);
    return LUME_SD_ERR_DRIVER;
}

int lume_sd_rmdir(const char *path)
{
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, false);
    if (r < 0) return r;
    if (rmdir(full) == 0 || errno == ENOENT) return LUME_SD_OK;
    ESP_LOGW(TAG, "rmdir %s failed: errno=%d", path, errno);
    return LUME_SD_ERR_DRIVER;
}

int lume_sd_exists(const char *path, bool *exists)
{
    if (!exists) return LUME_SD_ERR_ARG;
    *exists = false;
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, true);
    if (r < 0) return r;
    struct stat st;
    if (stat(full, &st) == 0) {
        /* Same exists(path + '/') is-a-directory convention as Fs. */
        size_t plen = strlen(path);
        bool wants_dir = plen > 0 && path[plen - 1] == '/';
        *exists = wants_dir ? S_ISDIR(st.st_mode) : true;
        return LUME_SD_OK;
    }
    return errno == ENOENT ? LUME_SD_OK : LUME_SD_ERR_DRIVER;
}

int lume_sd_list(const char *path, lume_sd_entry_fn emit, void *arg)
{
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    char full[sizeof(SD_BASE) + LUME_SD_PATH_MAX + 1];
    int r = full_path(path, full, true);
    if (r < 0) return r;
    DIR *dir = opendir(full);
    if (!dir) {
        ESP_LOGW(TAG, "opendir %s failed: errno=%d", path, errno);
        return LUME_SD_ERR_DRIVER;
    }
    errno = 0;
    struct dirent *ent;
    while ((ent = readdir(dir))) {
        if (strcmp(ent->d_name, ".") && strcmp(ent->d_name, "..") && emit)
            emit(arg, ent->d_name);
        errno = 0;
    }
    int saved = errno;
    closedir(dir);
    if (saved) {
        errno = saved;
        return LUME_SD_ERR_DRIVER;
    }
    return LUME_SD_OK;
}

int lume_sd_statvfs(uint64_t *total_bytes, uint64_t *free_bytes)
{
    if (!total_bytes || !free_bytes) return LUME_SD_ERR_ARG;
    *total_bytes = 0;
    *free_bytes = 0;
    if (!lume_sd_mounted()) return LUME_SD_ERR_STATE;
    /* FATFS has no POSIX statvfs on ESP-IDF; f_getfree is the
     * documented capacity query (clusters * sector size). */
    FATFS *fs;
    DWORD free_clusters = 0;
    if (f_getfree(SD_BASE, &free_clusters, &fs) != FR_OK)
        return LUME_SD_ERR_DRIVER;
    uint64_t cluster_bytes = (uint64_t)fs->csize * (uint64_t)fs->ssize;
    *total_bytes = cluster_bytes * (uint64_t)fs->n_fatent;
    *free_bytes = cluster_bytes * (uint64_t)free_clusters;
    return LUME_SD_OK;
}
