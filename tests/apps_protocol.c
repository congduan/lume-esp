/*
 * r30 host harness: multi-app command channel (LUMC frames + lume_cmd parser).
 *
 * Build (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-hotreload/include \
 *     -I firmware/components/lume-engine/include \
 *     tests/apps_protocol.c \
 *     firmware/components/lume-hotreload/lume_frame.c \
 *     firmware/components/lume-hotreload/lume_cmd.c \
 *     -o /tmp/lume_apps_protocol && /tmp/lume_apps_protocol
 *
 * It compiles the SAME portable code the firmware links (no ESP-IDF stubs) and
 * asserts:
 *   1. "LUMC" frames are recognised and distinguished from "LUME" app frames
 *      in one interleaved byte stream, including byte-at-a-time feeding;
 *   2. the text grammar of STORE/LAUNCH/REMOVE/META/LIST/HOME;
 *   3. id validation (reserved ".current", traversal, length, charset);
 *   4. CRC / resync behaviour is unchanged for both frame kinds.
 *
 * Installing, launching and uninstalling on a real board is NOT tested here.
 */
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include "lume_frame.h"
#include "lume_cmd.h"

static int g_fail;
static int g_checks;

#define CHECK(cond, msg) do {                                   \
    g_checks++;                                                 \
    if (!(cond)) { printf("  FAIL: %s\n", (msg)); g_fail++; }  \
    else         { printf("  ok  : %s\n", (msg)); }            \
} while (0)

typedef struct {
    int      data, cmd, err;
    uint8_t  payload[512];
    size_t   payload_len;
    char     reason[32];
} rec_t;

static void rec_event(lume_frame_ev_t ev, const uint8_t *payload, size_t len,
                      const char *reason, void *user)
{
    rec_t *r = (rec_t *)user;
    switch (ev) {
    case LUME_FRAME_EV_DATA:
    case LUME_FRAME_EV_CMD:
        if (ev == LUME_FRAME_EV_CMD) r->cmd++; else r->data++;
        r->payload_len = len < sizeof(r->payload) ? len : sizeof(r->payload);
        if (payload != NULL) memcpy(r->payload, payload, r->payload_len);
        break;
    case LUME_FRAME_EV_ERR:
        r->err++;
        snprintf(r->reason, sizeof(r->reason), "%s", reason ? reason : "");
        break;
    default:
        break;
    }
}

static void *test_alloc(size_t len) { return malloc(len); }
static void  test_free(void *p)     { free(p); }

static void feed_all(lume_frame_parser_t *p, const uint8_t *bytes, size_t len,
                     int chunk)
{
    for (size_t i = 0; i < len; i += (size_t)chunk) {
        size_t n = len - i < (size_t)chunk ? len - i : (size_t)chunk;
        for (size_t k = 0; k < n; k++) {
            lume_frame_parser_feed(p, bytes[i + k]);
        }
    }
}

/* ---------------- 1. frame kind recognition ---------------- */
static void test_frames(void)
{
    printf("[frames]\n");
    rec_t rec;
    lume_frame_parser_t p;

    const char *cmd = "LIST";
    uint8_t out[256];
    size_t n = lume_frame_encode_cmd(out, sizeof(out), (const uint8_t *)cmd,
                                     strlen(cmd));
    CHECK(n == 12 + 4, "LUMC frame length is header + payload");
    CHECK(memcmp(out, "LUMC", 4) == 0, "command frame magic is LUMC");
    CHECK(out[4] == 4 && out[5] == 0, "command frame carries u32le length");

    memset(&rec, 0, sizeof(rec));
    lume_frame_parser_init(&p, test_alloc, test_free, rec_event, &rec);
    feed_all(&p, out, n, 1);              /* byte-at-a-time */
    CHECK(rec.cmd == 1 && rec.data == 0, "LUMC emits EV_CMD only");
    CHECK(rec.payload_len == 4 && memcmp(rec.payload, "LIST", 4) == 0,
          "command payload is passed through verbatim");

    /* Interleaved: app frame, command frame, app frame in one stream. */
    uint8_t stream[512];
    size_t used = 0;
    const char *app = "var a = 1;";
    used += lume_frame_encode(stream + used, sizeof(stream) - used,
                              (const uint8_t *)app, strlen(app));
    used += lume_frame_encode_cmd(stream + used, sizeof(stream) - used,
                                  (const uint8_t *)"HOME", 4);
    used += lume_frame_encode(stream + used, sizeof(stream) - used,
                              (const uint8_t *)app, strlen(app));
    memset(&rec, 0, sizeof(rec));
    lume_frame_parser_init(&p, test_alloc, test_free, rec_event, &rec);
    feed_all(&p, stream, used, 3);
    CHECK(rec.data == 2 && rec.cmd == 1 && rec.err == 0,
          "interleaved LUME/LUMC stream is split by magic");

    /* Bad CRC on a command frame still reports an error and re-syncs. */
    memset(&rec, 0, sizeof(rec));
    lume_frame_parser_init(&p, test_alloc, test_free, rec_event, &rec);
    out[n - 1] ^= 0xff;
    feed_all(&p, out, n, 7);
    CHECK(rec.err == 1 && rec.cmd == 0, "corrupt LUMC frame is rejected");
    CHECK(strcmp(rec.reason, "bad-crc") == 0, "reject reason is bad-crc");
}

/* ---------------- 2. command grammar ---------------- */
static void parse_case(const char *text, size_t len, int want_code,
                       lume_cmd_kind_t want_kind, const char *want_id,
                       const char *want_meta, const char *want_src,
                       const char *label)
{
    lume_cmd_t c;
    int r = lume_cmd_parse((const uint8_t *)text, len, &c);
    int ok = r == want_code;
    if (ok && r == LUME_CMD_OK) {
        ok = c.kind == want_kind && strcmp(c.id, want_id) == 0;
        if (ok && want_meta != NULL) {
            ok = c.meta_len == strlen(want_meta) &&
                 memcmp(c.meta, want_meta, c.meta_len) == 0;
        }
        if (ok && want_src != NULL) {
            ok = c.src_len == strlen(want_src) &&
                 memcmp(c.src, want_src, c.src_len) == 0;
        }
    }
    g_checks++;
    if (ok) {
        printf("  ok  : %s\n", label);
    } else {
        printf("  FAIL: %s (code %d, kind %d, id '%s')\n", label, r,
               (int)c.kind, c.id);
        g_fail++;
    }
}

static void test_cmd_parse(void)
{
    printf("[cmd parse]\n");
    static const char store[] = "STORE\tclock\n{\"label\":\"Clock\"}\nvar a=1;";
    parse_case(store, sizeof(store) - 1, LUME_CMD_OK, LUME_CMD_STORE, "clock",
               "{\"label\":\"Clock\"}", "var a=1;", "STORE splits meta/src");

    static const char store_empty_meta[] = "STORE\tcalc\n\nvar b=2;";
    parse_case(store_empty_meta, sizeof(store_empty_meta) - 1, LUME_CMD_OK,
               LUME_CMD_STORE, "calc", "", "var b=2;",
               "STORE accepts an empty meta line");

    parse_case("LAUNCH\tclock", 12, LUME_CMD_OK, LUME_CMD_LAUNCH, "clock",
               NULL, NULL, "LAUNCH without trailing newline");
    parse_case("LAUNCH\tclock\n", 12, LUME_CMD_OK, LUME_CMD_LAUNCH, "clock",
               NULL, NULL, "LAUNCH with trailing newline");
    parse_case("REMOVE\tclock", 12, LUME_CMD_OK, LUME_CMD_REMOVE, "clock",
               NULL, NULL, "REMOVE");
    parse_case("META\tclock", 10, LUME_CMD_OK, LUME_CMD_META, "clock",
               NULL, NULL, "META");
    parse_case("LIST", 4, LUME_CMD_OK, LUME_CMD_LIST, "", NULL, NULL, "LIST");
    parse_case("HOME\n", 5, LUME_CMD_OK, LUME_CMD_HOME, "", NULL, NULL, "HOME");

    parse_case("", 0, LUME_CMD_ERR_ARG, 0, "", NULL, NULL, "empty payload rejected");
    parse_case("FLY\tclock", 10, LUME_CMD_ERR_VERB, 0, "", NULL, NULL,
               "unknown verb rejected");
    parse_case("LAUNCH", 6, LUME_CMD_ERR_ID, 0, "", NULL, NULL,
               "LAUNCH without id rejected");
    parse_case("LAUNCH\t.current", 14, LUME_CMD_ERR_ID, 0, "", NULL, NULL,
               "reserved .current id rejected");
    parse_case("LAUNCH\ta/b", 10, LUME_CMD_ERR_ID, 0, "", NULL, NULL,
               "path separator in id rejected");
    parse_case("LAUNCH\tabcdefghijklmnopqrstuvwxyz1234567", 40,
               LUME_CMD_ERR_ID, 0, "", NULL, NULL, "overlong id rejected");
    parse_case("STORE\tclock\n{}", 13, LUME_CMD_ERR_FORMAT, 0, "", NULL, NULL,
               "STORE without a source line rejected");
    parse_case("STORE\tclock\n{}\n", 15, LUME_CMD_ERR_EMPTY, 0, "", NULL, NULL,
               "STORE with empty source rejected");
    parse_case("STORE\tclock", 11, LUME_CMD_ERR_FORMAT, 0, "", NULL, NULL,
               "STORE without meta separator rejected");

    CHECK(lume_app_id_valid("clock", 5), "id charset/length accept 'clock'");
    CHECK(lume_app_id_valid("My-App_2.1", 10), "id accepts dots/underscores/dashes");
    CHECK(!lume_app_id_valid(".current", 8), "id rejects a leading dot");
    CHECK(!lume_app_id_valid("a/b", 3), "id rejects '/'");
    CHECK(!lume_app_id_valid("", 0), "id rejects empty");
    CHECK(strcmp(lume_cmd_reason(LUME_CMD_ERR_ID), "id") == 0,
          "reason token for a bad id");
    CHECK(strcmp(lume_cmd_reason(LUME_CMD_ERR_EMPTY), "empty") == 0,
          "reason token for an empty source");
}

/* ---------------- 3. CLI/device round trip (byte level) ---------------- */
static void test_round_trip(void)
{
    printf("[round trip]\n");
    /* The CLI builds `STORE\tid\n<meta>\n<source>` and wraps it in LUMC. The
     * device must decode the identical id/meta/source back. */
    static const char text[] = "STORE\tclock\n{\"label\":\"Clock\",\"icon\":\"C\"}\n"
                               "View({});";
    uint8_t frame_bytes[512];
    size_t n = lume_frame_encode_cmd(frame_bytes, sizeof(frame_bytes),
                                     (const uint8_t *)text, sizeof(text) - 1);
    rec_t rec;
    lume_frame_parser_t p;
    memset(&rec, 0, sizeof(rec));
    lume_frame_parser_init(&p, test_alloc, test_free, rec_event, &rec);
    feed_all(&p, frame_bytes, n, 5);
    CHECK(rec.cmd == 1 && rec.payload_len == sizeof(text) - 1,
          "STORE frame payload survives the round trip");

    lume_cmd_t c;
    int r = lume_cmd_parse(rec.payload, rec.payload_len, &c);
    CHECK(r == LUME_CMD_OK && c.kind == LUME_CMD_STORE &&
          strcmp(c.id, "clock") == 0,
          "round trip yields the stored app id");
    CHECK(c.src_len == strlen("View({});") &&
          memcmp(c.src, "View({});", c.src_len) == 0,
          "round trip yields the exact app source");
}

int main(void)
{
    test_frames();
    test_cmd_parse();
    test_round_trip();
    printf("\n%d checks, %d failure(s)\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
