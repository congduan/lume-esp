#pragma once
/* ------------------------------------------------------------------------
 * lume_fwtag (r106): deploy-manifest firmware API tag helpers.
 *
 * The CLI stamps `"fw": <integer>` into each app's meta.json at deploy time,
 * using the value it reads from the device (LUMC FWTAG command). At launch the
 * firmware reads that field back with these helpers and refuses an app built
 * for a different API tag. No JSON parser is involved: the meta document is a
 * single line and we only look for the quoted "fw" key followed by ':' and a
 * decimal integer.
 *
 * These are static inline in the header so the SAME code runs in the firmware
 * (lume_apps.c) and in the host harness (tests/fwtag_protocol.c) with no
 * RTOS / ESP-IDF dependency.
 * ------------------------------------------------------------------------ */
#include <stddef.h>

#define LUME_FWTAG_ABSENT   0   /* meta carries no readable fw field */
#define LUME_FWTAG_OK       1   /* fw field parsed into `out` */
#define LUME_FWTAG_ERR     (-1) /* bad arguments */

#define LUME_FWTAG_DECIDE_OK         0     /* launch allowed (tag matches) */
#define LUME_FWTAG_DECIDE_UNKNOWN    1     /* no/old app: unknown compatibility */
#define LUME_FWTAG_DECIDE_MISMATCH  (-7)   /* refuse launch (== LUME_APPS_ERR_FWTAG) */

/* Extract the decimal text of the "fw" key from a one-line JSON document.
 * Writes a NUL-terminated value into `out` (cap >= 2). Returns LUME_FWTAG_OK,
 * LUME_FWTAG_ABSENT (no fw key, or a non-integer value), or LUME_FWTAG_ERR.
 * A missing/oddly-typed fw is deliberately treated as ABSENT so a pre-r106
 * app still launches (with a WARN) instead of being bricked. */
static inline int lume_fwtag_extract(const char *meta, size_t len,
                                     char *out, size_t cap)
{
    if (meta == NULL || out == NULL || cap < 2) {
        return LUME_FWTAG_ERR;
    }
    out[0] = '\0';
    for (size_t i = 0; i + 3 < len; i++) {
        if (meta[i] != '"' || meta[i + 1] != 'f' ||
            meta[i + 2] != 'w' || meta[i + 3] != '"') {
            continue;
        }
        size_t j = i + 4;
        while (j < len && (meta[j] == ' ' || meta[j] == '\t')) j++;
        if (j >= len || meta[j] != ':') continue;   /* not a "fw": pair */
        j++;
        while (j < len && (meta[j] == ' ' || meta[j] == '\t')) j++;
        size_t n = 0;
        while (j < len && meta[j] >= '0' && meta[j] <= '9' && n + 1 < cap) {
            out[n++] = meta[j++];
        }
        if (n == 0) continue;                       /* not an integer */
        out[n] = '\0';
        return LUME_FWTAG_OK;
    }
    return LUME_FWTAG_ABSENT;
}

/* Compare an extracted fw text against the running firmware's tag. `fw` is
 * the buffer filled by lume_fwtag_extract(). Returns one of the
 * LUME_FWTAG_DECIDE_* codes. Pure (no logging): the caller logs the WARN or
 * the mismatch reason so it can include the app id and both tag values. */
static inline int lume_fwtag_decide(const char *fw, unsigned long current)
{
    if (fw == NULL || fw[0] == '\0') {
        return LUME_FWTAG_DECIDE_UNKNOWN;
    }
    unsigned long v = 0;
    for (const char *p = fw; *p != '\0'; p++) {
        if (*p < '0' || *p > '9') {
            return LUME_FWTAG_DECIDE_UNKNOWN;
        }
        v = v * 10ul + (unsigned long)(*p - '0');
    }
    return (v == current) ? LUME_FWTAG_DECIDE_OK : LUME_FWTAG_DECIDE_MISMATCH;
}
