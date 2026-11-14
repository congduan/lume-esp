/**
 * lume_cmd (r30): portable "LUMC" command payload parser.
 * See include/lume_cmd.h for the grammar. NO RTOS / ESP includes: this file is
 * compiled verbatim on the host by tests/apps_protocol.c.
 */
#include "lume_cmd.h"
#include <string.h>

/* Return the index of the first '\n' at/after `from`, or `len` if absent. */
static size_t find_nl(const char *p, size_t from, size_t len)
{
    for (size_t i = from; i < len; i++) {
        if (p[i] == '\n') {
            return i;
        }
    }
    return len;
}

int lume_cmd_parse(const uint8_t *payload, size_t len, lume_cmd_t *out)
{
    if (out == NULL) {
        return LUME_CMD_ERR_ARG;
    }
    memset(out, 0, sizeof(*out));
    if (payload == NULL || len == 0) {
        return LUME_CMD_ERR_ARG;
    }
    const char *p = (const char *)payload;
    const size_t line1_end = find_nl(p, 0, len);

    /* Split the first line into verb and optional '\t'-separated id. */
    size_t verb_end = 0;
    while (verb_end < line1_end && p[verb_end] != '\t') {
        verb_end++;
    }
    const bool has_id = verb_end < line1_end;
    const char *id = has_id ? p + verb_end + 1 : NULL;
    const size_t id_len = has_id ? line1_end - verb_end - 1 : 0;

    if (verb_end == 0) {
        return LUME_CMD_ERR_FORMAT;
    }

    if (verb_end == 4 && memcmp(p, "HOME", 4) == 0) {
        out->kind = LUME_CMD_HOME;
        return LUME_CMD_OK;
    }
    if (verb_end == 4 && memcmp(p, "LIST", 4) == 0) {
        out->kind = LUME_CMD_LIST;
        return LUME_CMD_OK;
    }

    lume_cmd_kind_t kind;
    if (verb_end == 6 && memcmp(p, "LAUNCH", 6) == 0) {
        kind = LUME_CMD_LAUNCH;
    } else if (verb_end == 6 && memcmp(p, "REMOVE", 6) == 0) {
        kind = LUME_CMD_REMOVE;
    } else if (verb_end == 4 && memcmp(p, "META", 4) == 0) {
        kind = LUME_CMD_META;
    } else if (verb_end == 5 && memcmp(p, "STORE", 5) == 0) {
        kind = LUME_CMD_STORE;
    } else {
        return LUME_CMD_ERR_VERB;
    }

    if (!has_id || !lume_app_id_valid(id, id_len)) {
        return LUME_CMD_ERR_ID;
    }
    memcpy(out->id, id, id_len);
    out->id[id_len] = '\0';
    out->kind = kind;

    if (kind != LUME_CMD_STORE) {
        return LUME_CMD_OK;
    }

    /* STORE: line 2 is the meta document, the rest is the app source. */
    if (line1_end == len) {
        return LUME_CMD_ERR_FORMAT;      /* no meta line terminator */
    }
    const size_t meta_start = line1_end + 1;
    const size_t meta_end = find_nl(p, meta_start, len);
    if (meta_end == len) {
        return LUME_CMD_ERR_FORMAT;      /* no source separator */
    }
    const size_t meta_len = meta_end - meta_start;
    if (meta_len >= LUME_CMD_META_MAX) {
        memset(out, 0, sizeof(*out));
        return LUME_CMD_ERR_FORMAT;
    }
    const size_t src_start = meta_end + 1;
    if (src_start >= len) {
        memset(out, 0, sizeof(*out));
        return LUME_CMD_ERR_EMPTY;
    }
    out->meta = p + meta_start;
    out->meta_len = meta_len;
    out->src = p + src_start;
    out->src_len = len - src_start;
    return LUME_CMD_OK;
}

const char *lume_cmd_reason(int code)
{
    switch (code) {
    case LUME_CMD_ERR_ARG:    return "arg";
    case LUME_CMD_ERR_VERB:   return "verb";
    case LUME_CMD_ERR_ID:     return "id";
    case LUME_CMD_ERR_FORMAT: return "format";
    case LUME_CMD_ERR_EMPTY:  return "empty";
    default:                  return "cmd";
    }
}
