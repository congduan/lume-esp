/*
 * r106 host harness: deploy-manifest firmware API tag (meta.json "fw").
 *
 * Build (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-engine/include \
 *     tests/fwtag_protocol.c -o /tmp/lume_fwtag_protocol && /tmp/lume_fwtag_protocol
 *
 * It compiles the SAME portable helpers the firmware links (lume_fwtag.h is
 * static inline, no ESP-IDF dependency) and asserts the three launch-decision
 * paths required by the brief:
 *   1. meta carries an fw field matching the running tag -> allowed;
 *   2. meta carries an fw field for a different tag     -> refused (mismatch);
 *   3. meta has no fw field (pre-r106 app)               -> unknown, WARN+allow.
 * Plus a few malformed-meta edges that must degrade to "unknown" (never brick).
 *
 * Firmware launch wiring (boot/recovery and lume.apps.launch) is NOT tested
 * here; on-device acceptance is deferred to board bring-up.
 */
#include <stdio.h>
#include <string.h>
#include "lume_fwtag.h"

static int g_fail;
static int g_checks;

#define CHECK(cond, msg) do {                                   \
    g_checks++;                                                 \
    if (!(cond)) { printf("  FAIL: %s\n", (msg)); g_fail++; }  \
    else         { printf("  ok  : %s\n", (msg)); }            \
} while (0)

/* One meta document -> extract + decide against `current`. */
static void case_meta(const char *meta, unsigned long current,
                      int want_got, int want_decision, const char *label)
{
    char fw[24];
    int got = lume_fwtag_extract(meta, strlen(meta), fw, sizeof(fw));
    CHECK(got == want_got, label);
    int decision = lume_fwtag_decide(got == LUME_FWTAG_OK ? fw : "", current);
    CHECK(decision == want_decision, label);
    if (got == LUME_FWTAG_OK) {
        printf("        fw='%s' current=%lu\n", fw, current);
    }
}

int main(void)
{
    printf("r106 fwtag host harness\n");

    /* Path 1: matching tag -> launch allowed. */
    case_meta("{\"label\":\"Clock\",\"fw\":1}", 1,
              LUME_FWTAG_OK, LUME_FWTAG_DECIDE_OK,
              "path1: fw matches current -> allow");
    case_meta("{\"fw\": 7 ,\"color\":\"red\"}", 7,
              LUME_FWTAG_OK, LUME_FWTAG_DECIDE_OK,
              "path1: fw with surrounding whitespace -> allow");

    /* Path 2: different tag -> refuse (log carries both values). */
    case_meta("{\"label\":\"Clock\",\"fw\":1}", 2,
              LUME_FWTAG_OK, LUME_FWTAG_DECIDE_MISMATCH,
              "path2: fw differs from current -> refuse");

    /* Path 3: old app, no fw field -> unknown compatibility (WARN + allow). */
    case_meta("{\"label\":\"Clock\",\"icon\":\"x\"}", 1,
              LUME_FWTAG_ABSENT, LUME_FWTAG_DECIDE_UNKNOWN,
              "path3: no fw field -> unknown (WARN + allow)");
    case_meta("{\"label\":\"Clock\",\"fw\":\"v1\"}", 1,
              LUME_FWTAG_ABSENT, LUME_FWTAG_DECIDE_UNKNOWN,
              "path3: non-integer fw -> unknown (WARN + allow)");

    /* Argument guards and a key-name lookalike must not match. */
    char fw[24];
    CHECK(lume_fwtag_extract(NULL, 0, fw, sizeof(fw)) == LUME_FWTAG_ERR,
          "NULL meta rejected");
    CHECK(lume_fwtag_extract("{}", 2, NULL, sizeof(fw)) == LUME_FWTAG_ERR,
          "NULL out rejected");
    case_meta("{\"isfw\":9,\"fwx\":8}", 1,
              LUME_FWTAG_ABSENT, LUME_FWTAG_DECIDE_UNKNOWN,
              "lookalike keys do not match fw");

    printf("%d checks, %d failures\n", g_checks, g_fail);
    return g_fail ? 1 : 0;
}
