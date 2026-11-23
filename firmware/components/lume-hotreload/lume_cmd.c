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

static bool decimal(const char *p, size_t n, uint32_t *out)
{
    if (!n || n > 10) return false;
    uint32_t v = 0;
    for (size_t i = 0; i < n; i++) {
        if (p[i] < '0' || p[i] > '9' || v > (UINT32_MAX - (uint32_t)(p[i] - '0')) / 10u)
            return false;
        v = v * 10u + (uint32_t)(p[i] - '0');
    }
    *out = v;
    return true;
}

static bool file_path_valid(const char *p, size_t n, bool directory)
{
    if (n < 4 || n > LUME_CMD_FILE_PATH_MAX ||
        !((memcmp(p, "sd:", 3) == 0) || (memcmp(p, "fs:", 3) == 0))) return false;
    p += 3; n -= 3;
    if (n > 240 || !n || (!directory && n == 1 && p[0] == '/')) return false;
    if (p[0] == '/') { p++; n--; }
    if (!n) return directory;
    size_t start = 0;
    for (size_t i = 0; i <= n; i++) {
        if (i == n || p[i] == '/') {
            size_t seg = i - start;
            if (directory && i == n && seg == 0) return true;
            if (!seg || (seg == 1 && p[start] == '.') ||
                (seg == 2 && p[start] == '.' && p[start + 1] == '.')) return false;
            start = i + 1;
        } else if ((unsigned char)p[i] < 32 || p[i] == '\\' || p[i] == ':') return false;
    }
    return true;
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

    if ((verb_end == 4 && memcmp(p, "FPUT", 4) == 0) ||
        (verb_end == 3 && memcmp(p, "FLS", 3) == 0) ||
        (verb_end == 4 && memcmp(p, "FDEL", 4) == 0) ||
        (verb_end == 4 && memcmp(p, "FGET", 4) == 0)) {
        bool put = verb_end == 4 && p[1] == 'P';
        bool get = verb_end == 4 && p[1] == 'G';
        bool dir = verb_end == 3;
        /* Optional explicit payload type for OTA file pushes. Existing LUME,
         * LUMB and STORE frames keep their implicit app type unchanged. */
        const char *path = id;
        size_t fields_len = id_len;
        if (put && fields_len >= 5 && memcmp(path, "file\t", 5) == 0) {
            path += 5; fields_len -= 5;
        }
        const char *end = path ? memchr(path, '\t', fields_len) : NULL;
        size_t path_len = end ? (size_t)(end - path) : fields_len;
        if (!has_id || !file_path_valid(path, path_len, dir)) return LUME_CMD_ERR_ARG;
        memcpy(out->file_path, path, path_len);
        out->file_path[path_len] = 0;
        if (put || get) {
            if (!end) return LUME_CMD_ERR_FORMAT;
            const char *second = memchr(end + 1, '\t', path + fields_len - end - 1);
            if (!second || !decimal(end + 1, (size_t)(second - end - 1), &out->offset) ||
                !decimal(second + 1, (size_t)(path + fields_len - second - 1), &out->total))
                return LUME_CMD_ERR_FORMAT;
            if (put) {
                if (line1_end == len) return LUME_CMD_ERR_FORMAT;
                out->data = payload + line1_end + 1;
                out->data_len = len - line1_end - 1;
                if (!out->data_len || out->total > LUME_CMD_FILE_MAX ||
                    out->offset > out->total || out->data_len > out->total - out->offset)
                    return LUME_CMD_ERR_ARG;
            } else if (out->total == 0 || out->total > 768 || line1_end != len) {
                return LUME_CMD_ERR_ARG;
            }
        } else if (end || line1_end != len) return LUME_CMD_ERR_FORMAT;
        out->kind = put ? LUME_CMD_FPUT : get ? LUME_CMD_FGET :
                    dir ? LUME_CMD_FLS : LUME_CMD_FDEL;
        return LUME_CMD_OK;
    }

    if (verb_end == 4 && memcmp(p, "HOME", 4) == 0) {
        out->kind = LUME_CMD_HOME;
        return LUME_CMD_OK;
    }
    if (verb_end == 4 && memcmp(p, "LIST", 4) == 0) {
        out->kind = LUME_CMD_LIST;
        return LUME_CMD_OK;
    }
    if (verb_end == 4 && memcmp(p, "SHOT", 4) == 0) {
        out->kind = LUME_CMD_SHOT;
        return LUME_CMD_OK;
    }
    /* r43b VER / r106 FWTAG carry no id and need no meta/source separator. */
    if (verb_end == 3 && memcmp(p, "VER", 3) == 0) {
        out->kind = LUME_CMD_VER;
        return LUME_CMD_OK;
    }
    if (verb_end == 5 && memcmp(p, "FWTAG", 5) == 0) {
        out->kind = LUME_CMD_FWTAG;
        return LUME_CMD_OK;
    }
    /* r139: OOM <ms> — profile-only allocator fault injection. Gated out of
     * the verb table for default firmware: the same bytes then fall through
     * to LUME_CMD_ERR_VERB ("CMD ERR verb"), keeping default size unchanged. */
#if CONFIG_LUME_PERF_PROFILE
    if (verb_end == 3 && memcmp(p, "OOM", 3) == 0) {
        /* <ms> is a positive decimal arm delay; cap digits to avoid u32 wrap. */
        if (!has_id || id_len == 0 || id_len > 9) {
            return LUME_CMD_ERR_ARG;
        }
        uint32_t ms = 0;
        for (size_t i = 0; i < id_len; i++) {
            if (id[i] < '0' || id[i] > '9') {
                return LUME_CMD_ERR_ARG;
            }
            ms = ms * 10u + (uint32_t)(id[i] - '0');
        }
        if (ms == 0) {
            return LUME_CMD_ERR_ARG;
        }
        out->kind = LUME_CMD_OOM;
        out->oom_ms = ms;
        return LUME_CMD_OK;
    }
#endif
    /* r96: TOKEN <32hex> — validate here so a bad token never reaches NVS. */
    if (verb_end == 5 && memcmp(p, "TOKEN", 5) == 0) {
        if (!has_id || id_len != LUME_CMD_TOKEN_HEX_LEN) {
            return LUME_CMD_ERR_ARG;
        }
        for (size_t i = 0; i < id_len; i++) {
            char c = id[i];
            bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                       (c >= 'A' && c <= 'F');
            if (!hex) return LUME_CMD_ERR_ARG;
        }
        memcpy(out->token, id, id_len);
        out->token[id_len] = '\0';
        out->kind = LUME_CMD_TOKEN;
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
