/** LittleFS VFS layer. All calls run on the QuickJS engine task. */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUME_FS_OK 0
#define LUME_FS_ERR_ARG (-1)
#define LUME_FS_ERR_DRIVER (-2)
#define LUME_FS_ERR_STATE (-3)
#define LUME_FS_PATH_MAX 240
#define LUME_FS_READ_MAX (64 * 1024)

int lume_fs_init(void);
bool lume_fs_mounted(void);
int lume_fs_write(const char *path, const uint8_t *data, size_t len, bool append);
int lume_fs_read(const char *path, uint8_t **data, size_t *len);
int lume_fs_remove(const char *path);
int lume_fs_mkdir(const char *path);
int lume_fs_exists(const char *path, bool *exists);
typedef void (*lume_fs_entry_fn)(void *arg, const char *name);
int lume_fs_list(const char *path, lume_fs_entry_fn emit, void *arg);
