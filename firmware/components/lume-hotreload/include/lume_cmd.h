#pragma once
/* ------------------------------------------------------------------------
 * lume_cmd (r30): portable text parser for "LUMC" command frames.
 *
 * The frame header/CRC is owned by lume_frame.h. This module only turns the
 * validated payload into a command record, so the SAME parse rules run in the
 * firmware (lume_hotreload.c) and in the host harness (tests/apps_protocol.c)
 * with no ESP-IDF / FreeRTOS dependency.
 *
 * Grammar (UTF-8, '\n' separates fields, '\t' separates a verb from its id):
 *
 *   STORE\t<id>\n<meta.json>\n<js source bytes ...>
 *   LAUNCH\t<id>
 *   REMOVE\t<id>
 *   META\t<id>
 *   LIST
 *   HOME
 *
 * Rules:
 *   - The first '\n' ends the first line. Verbs are case-sensitive.
 *   - STORE's second line is the app meta document, passed to the JS side
 *     verbatim (single-line JSON; the firmware never parses it). Everything
 *     after the SECOND '\n' is the app source and may contain any byte.
 *   - STORE with an empty meta line is valid ("STORE\tid\n\n<source>").
 *   - id rules live in lume-engine/include/lume_app_id.h.
 *
 * Multi-app model: a command frame only MANAGES the installed app set. At run
 * time the engine still owns exactly one QuickJS runtime / one live app.
 * ------------------------------------------------------------------------ */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "lume_app_id.h"

#define LUME_CMD_ID_MAX      LUME_APP_ID_MAX
#define LUME_CMD_META_MAX    1024   /* defensive cap on the meta line */

typedef enum {
    LUME_CMD_STORE = 1,
    LUME_CMD_LAUNCH,
    LUME_CMD_REMOVE,
    LUME_CMD_META,
    LUME_CMD_LIST,
    LUME_CMD_HOME,
} lume_cmd_kind_t;

#define LUME_CMD_OK          0
#define LUME_CMD_ERR_ARG     (-1)   /* NULL / zero-length payload */
#define LUME_CMD_ERR_VERB    (-2)   /* unknown verb */
#define LUME_CMD_ERR_ID      (-3)   /* malformed id */
#define LUME_CMD_ERR_FORMAT  (-4)   /* missing meta/source separator, overlong */
#define LUME_CMD_ERR_EMPTY   (-5)   /* STORE without source bytes */

typedef struct {
    lume_cmd_kind_t kind;
    char        id[LUME_CMD_ID_MAX];   /* "" for LIST/HOME */
    const char *meta;                  /* points into the payload (STORE only) */
    size_t      meta_len;
    const char *src;                   /* points into the payload (STORE only) */
    size_t      src_len;
} lume_cmd_t;

/* Parse one command payload. Returns LUME_CMD_OK or a LUME_CMD_ERR_* code.
 * `out` is fully zeroed on failure. The returned meta/src pointers alias the
 * caller's payload and must not outlive it. */
int lume_cmd_parse(const uint8_t *payload, size_t len, lume_cmd_t *out);

/* Stable token for the CMD ERR reply line ("arg"/"verb"/"id"/"format"/"empty"). */
const char *lume_cmd_reason(int code);
