/** TF/microSD card over SPI (r125). All calls run on the QuickJS engine
 * task. Error convention mirrors lume_fs.h: 0 ok, -1 bad argument, -2
 * card/IO failure, -3 not mounted (no card, no slot, or failed mount),
 * -4 board profile has no CD pin (detect only). */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUME_SD_OK 0
#define LUME_SD_ERR_ARG (-1)
#define LUME_SD_ERR_DRIVER (-2)
#define LUME_SD_ERR_STATE (-3)
#define LUME_SD_ERR_NO_CD (-4)
#define LUME_SD_PATH_MAX 240
#define LUME_SD_READ_MAX (64 * 1024)

/** Lazy one-shot mount over SDSPI (SPI3, board profile pins). Returns
 * LUME_SD_ERR_STATE when the board has no TF slot pins or the card
 * fails to mount; never formats the card. Idempotent. */
int lume_sd_init(void);
bool lume_sd_mounted(void);
/** Board has a card-detect pin (always false on 2.16: no CD pin). */
bool lume_sd_has_cd(void);
/** CD pin level; LUME_SD_ERR_NO_CD when the board has no CD pin. */
int lume_sd_detect(void);
int lume_sd_write(const char *path, const uint8_t *data, size_t len, bool append);
int lume_sd_read(const char *path, uint8_t **data, size_t *len);
int lume_sd_remove(const char *path);
int lume_sd_mkdir(const char *path);
int lume_sd_rmdir(const char *path);
int lume_sd_exists(const char *path, bool *exists);
typedef void (*lume_sd_entry_fn)(void *arg, const char *name);
int lume_sd_list(const char *path, lume_sd_entry_fn emit, void *arg);
/** Card capacity and free bytes; -1/-2 on failure. */
int lume_sd_statvfs(uint64_t *total_bytes, uint64_t *free_bytes);