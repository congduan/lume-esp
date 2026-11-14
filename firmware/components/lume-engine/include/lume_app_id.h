#pragma once
/* ------------------------------------------------------------------------
 * lume_app_id: the ONE definition of a valid multi-app id.
 *
 * Portable (no ESP-IDF / FreeRTOS includes) so the engine, the command parser
 * in lume-hotreload, the CLI-side checks and the host harnesses all agree:
 *   - 1..LUME_APP_ID_MAX-1 bytes
 *   - [A-Za-z0-9._-] only
 *   - must NOT start with '.' (".current" and "."/".." are reserved)
 *
 * Ids are used as LittleFS directory names under /apps, so '/' , ".." and
 * anything needing escaping are rejected by construction.
 * ------------------------------------------------------------------------ */
#include <stdbool.h>
#include <stddef.h>

#define LUME_APP_ID_MAX 32   /* id + NUL */

static inline bool lume_app_id_valid(const char *id, size_t len)
{
    if (id == NULL || len == 0 || len >= LUME_APP_ID_MAX) {
        return false;
    }
    if (id[0] == '.') {
        return false;
    }
    for (size_t i = 0; i < len; i++) {
        char c = id[i];
        bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                  (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (!ok) {
            return false;
        }
    }
    return true;
}
