/*
 * r26 host harness: WiFi-OTA push channel protocol.
 *
 * Build (from repo root):
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-hotreload/include \
 *     tests/ota_protocol.c firmware/components/lume-hotreload/lume_frame.c \
 *     -o /tmp/lume_ota_protocol && /tmp/lume_ota_protocol
 *
 * It compiles the SAME portable codec the firmware links (lume_frame.c) — no
 * ESP-IDF / FreeRTOS stubs — and asserts:
 *   1. frame protocol REUSE: the OTA/USB C decoder consumes the EXACT bytes
 *      the CLI/USB encoder emits (hard-coded from tools/lume/protocol.js),
 *      field-by-field, plus control frames / CRC / resync / streaming splits;
 *   2. token auth: correct AND wrong token paths, constant-time compare;
 *   3. "WiFi not connected -> refuse to start" gate;
 *   4. reply-line formatting shared by both channels.
 *
 * Real-device WiFi push is NOT tested here (deferred to the board round).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "lume_frame.h"

static int g_fail;
static int g_checks;

#define CHECK(cond, msg) do {                                   \
    g_checks++;                                                 \
    if (!(cond)) { printf("  FAIL: %s\n", (msg)); g_fail++; }  \
    else         { printf("  ok  : %s\n", (msg)); }            \
} while (0)

/* ---------------- event recorder (one parser instance) ---------------- */
typedef struct {
    int      data, back, pause, resume, err;
    size_t   len;
    char     reason[32];
    uint8_t  payload[2048];
    size_t   payload_len;
} rec_t;

static void rec_event(lume_frame_ev_t ev, const uint8_t *payload, size_t len,
                      const char *reason, void *user)
{
    rec_t *r = (rec_t *)user;
    switch (ev) {
    case LUME_FRAME_EV_DATA:
        r->data++;
        r->len = len;
        r->payload_len = len < sizeof(r->payload) ? len : sizeof(r->payload);
        if (payload != NULL && r->payload_len) {
            memcpy(r->payload, payload, r->payload_len);
        }
        break;
    case LUME_FRAME_EV_BACK:   r->back++;   break;
    case LUME_FRAME_EV_PAUSE:  r->pause++;  break;
    case LUME_FRAME_EV_RESUME: r->resume++; break;
    case LUME_FRAME_EV_ERR:
        r->err++;
        r->len = len;
        snprintf(r->reason, sizeof(r->reason), "%s", reason ? reason : "?");
        break;
    }
}
static void rec_reset(rec_t *r) { memset(r, 0, sizeof(*r)); }
static void *host_alloc(size_t n) { return malloc(n); }
static void  host_free(void *p)  { free(p); }

static void parser_init(lume_frame_parser_t *p, rec_t *r)
{
    lume_frame_parser_init(p, host_alloc, host_free, rec_event, r);
}
static void feed_all(lume_frame_parser_t *p, const uint8_t *b, size_t n)
{
    for (size_t i = 0; i < n; i++) lume_frame_parser_feed(p, b[i]);
}
static size_t from_hex(const char *hex, uint8_t *out, size_t cap)
{
    size_t n = strlen(hex) / 2;
    if (n > cap) n = cap;
    for (size_t i = 0; i < n; i++) {
        unsigned v;
        sscanf(hex + 2 * i, "%2x", &v);
        out[i] = (uint8_t)v;
    }
    return n;
}

/* The CLI's frame('123456789') from tools/lume/lume.test.js:12-16. */
static const char *CLI_FRAME_HEX =
    "4c554d45090000002639f4cb313233343536373839";

int main(void)
{
    lume_frame_parser_t p;
    rec_t r;
    uint8_t buf[70000];
    uint8_t hexbuf[128];

    /* ---- 1. CRC-32 known vector (zlib / esp_crc32_le equivalence) ---- */
    printf("[1] CRC-32 + encoder field-by-field vs CLI\n");
    CHECK(lume_frame_crc32((const uint8_t *)"123456789", 9) == 0xcbf43926u,
          "crc32(\"123456789\") == 0xcbf43926");
    size_t enc = lume_frame_encode(buf, sizeof(buf),
                                   (const uint8_t *)"123456789", 9);
    CHECK(enc == 21, "encode length == 12 + 9");
    size_t hn = from_hex(CLI_FRAME_HEX, hexbuf, sizeof(hexbuf));
    CHECK(hn == 21 && memcmp(buf, hexbuf, 21) == 0,
          "C encoder emits byte-for-byte the CLI/USB frame (LUME|len|crc|payload)");
    CHECK(buf[0] == 'L' && buf[1] == 'U' && buf[2] == 'M' && buf[3] == 'E',
          "offset 0..3 magic LUME");
    uint32_t le_len = (uint32_t)buf[4] | ((uint32_t)buf[5] << 8) |
                      ((uint32_t)buf[6] << 16) | ((uint32_t)buf[7] << 24);
    uint32_t le_crc = (uint32_t)buf[8] | ((uint32_t)buf[9] << 8) |
                      ((uint32_t)buf[10] << 16) | ((uint32_t)buf[11] << 24);
    CHECK(le_len == 9, "offset 4..7 total_len u32 LE == payload bytes (9)");
    CHECK(le_crc == 0xcbf43926u, "offset 8..11 crc32 u32 LE == crc(payload)");
    CHECK(memcmp(buf + 12, "123456789", 9) == 0, "offset 12.. payload verbatim");

    /* ---- 2. frame protocol REUSE: feed the CLI/USB bytes to the OTA parser ---- */
    printf("[2] frame protocol reuse (OTA decoder == USB/CLI wire format)\n");
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, hexbuf, hn);   /* the exact frame produced by protocol.js */
    CHECK(r.data == 1 && r.err == 0, "CLI frame -> exactly one DATA event, no ERR");
    CHECK(r.len == 9, "DATA len == 9");
    CHECK(r.payload_len == 9 && memcmp(r.payload, "123456789", 9) == 0,
          "DATA payload matches source");

    /* streaming: one byte at a time + odd chunk splits */
    rec_reset(&r);
    parser_init(&p, &r);
    for (size_t i = 0; i < hn; i++) lume_frame_parser_feed(&p, hexbuf[i]);
    CHECK(r.data == 1 && r.payload_len == 9, "single-byte streaming parse OK");

    /* C encoder -> C decoder round trip (both channels share the codec) */
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, buf, enc);
    CHECK(r.data == 1 && r.payload_len == 9, "encode->decode round trip OK");

    /* ---- 3. control frames (BACK / PAUS / RESM) ---- */
    printf("[3] aligned 4-byte control frames\n");
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, (const uint8_t *)"BACK", 4);
    feed_all(&p, (const uint8_t *)"PAUS", 4);
    feed_all(&p, (const uint8_t *)"RESM", 4);
    CHECK(r.back == 1, "BACK event");
    CHECK(r.pause == 1, "PAUS event");
    CHECK(r.resume == 1, "RESM event");
    CHECK(r.data == 0 && r.err == 0, "controls emit no DATA/ERR");

    /* ---- 4. reject reasons + resync ---- */
    printf("[4] reject reasons, lengths and LUME resync\n");
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, (const uint8_t *)"XXXX", 4);       /* bad magic */
    CHECK(r.err == 1 && strcmp(r.reason, "bad-magic") == 0,
          "bad magic -> ERR bad-magic");
    feed_all(&p, hexbuf, hn);                        /* resync on next LUME */
    CHECK(r.data == 1, "resync: valid frame after noise still parses");

    rec_reset(&r);
    parser_init(&p, &r);
    uint8_t empty[12] = { 'L','U','M','E', 0,0,0,0, 0,0,0,0 };
    feed_all(&p, empty, 12);
    CHECK(r.err == 1 && strcmp(r.reason, "empty") == 0,
          "total_len 0 -> ERR empty");

    rec_reset(&r);
    parser_init(&p, &r);
    uint8_t huge[12] = { 'L','U','M','E', 0x01,0x00,0x04,0x00, 0,0,0,0 }; /* 256K+1 */
    feed_all(&p, huge, 12);
    CHECK(r.err == 1 && strcmp(r.reason, "too-large") == 0 &&
          r.len == 262145, "total_len > 256KiB -> ERR too-large (drop+resync)");

    rec_reset(&r);
    parser_init(&p, &r);
    uint8_t bad[21];
    memcpy(bad, hexbuf, 21);
    bad[12] ^= 0xff;                                /* corrupt payload byte */
    feed_all(&p, bad, 21);
    CHECK(r.err == 1 && strcmp(r.reason, "bad-crc") == 0 && r.len == 9,
          "corrupted payload -> ERR bad-crc (len=9)");

    /* a larger (still valid) payload round-trips through the same codec */
    static uint8_t mid[1024];
    memset(mid, 'z', sizeof(mid));
    size_t midn = lume_frame_encode(buf, sizeof(buf), mid, sizeof(mid));
    CHECK(midn == LUME_FRAME_HDR_LEN + sizeof(mid),
          "encoder accepts a 1 KiB payload");
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, buf, midn);
    CHECK(r.data == 1 && r.len == sizeof(mid) &&
          r.payload_len == sizeof(mid) && memcmp(r.payload, mid, sizeof(mid)) == 0,
          "1 KiB frame decode OK");

    /* ---- 5. token auth: correct AND wrong token paths ---- */
    printf("[5] token auth (correct / wrong token)\n");
    const char *token = "0123456789abcdef0123456789abcdef";
    char provided[LUME_OTA_TOKEN_STR_MAX];
    size_t alen = strlen("AUTH ") + strlen(token) + 1;
    char line[128];
    snprintf(line, sizeof(line), "AUTH %s\n", token);
    CHECK(lume_ota_auth_parse(line, alen, provided, sizeof(provided)) &&
          strcmp(provided, token) == 0,
          "auth_parse(\"AUTH <token>\\n\") extracts token");
    CHECK(lume_ota_token_equal(provided, token),
          "RIGHT token: token_equal == true (auth OK path)");
    CHECK(!lume_ota_token_equal(provided, "1123456789abcdef0123456789abcdef"),
          "WRONG token (1 char off): token_equal == false (auth ERR path)");
    CHECK(!lume_ota_token_equal(provided, ""),
          "empty token rejected");
    CHECK(!lume_ota_token_equal(provided, "0123456789abcdef0123456789abcde"),
          "31-char token rejected (length)");
    CHECK(!lume_ota_auth_parse("NOPE x\n", 7, provided, sizeof(provided)),
          "wrong prefix -> auth_parse false");
    CHECK(!lume_ota_auth_parse("AUTH \n", 6, provided, sizeof(provided)),
          "empty token line -> auth_parse false");
    CHECK(!lume_ota_auth_parse("AUTH abc def\n", 13, provided, sizeof(provided)),
          "space in token -> auth_parse false");

    /* ---- 6. reply lines (shared by USB + TCP) ---- */
    printf("[6] RELOAD reply lines\n");
    char rep[LUME_OTA_REPLY_MAX];
    int n = lume_ota_reply(rep, sizeof(rep), true, 9, NULL);
    CHECK(n > 0 && strcmp(rep, "RELOAD OK 9\n") == 0,
          "OK line == \"RELOAD OK 9\\n\"");
    n = lume_ota_reply(rep, sizeof(rep), false, 9, "bad-crc");
    CHECK(n > 0 && strcmp(rep, "RELOAD ERR bad-crc\n") == 0,
          "ERR line == \"RELOAD ERR bad-crc\\n\"");

    /* ---- 7. WiFi gate: not connected => refuse to start ---- */
    printf("[7] listener gate (WiFi not connected -> no OTA server)\n");
    CHECK(lume_ota_can_serve(false, true) == false,
          "WiFi DOWN + token ready -> can_serve FALSE (refuse to start)");
    CHECK(lume_ota_can_serve(false, false) == false,
          "WiFi DOWN + no token -> FALSE");
    CHECK(lume_ota_can_serve(true, false) == false,
          "WiFi UP + no token -> FALSE");
    CHECK(lume_ota_can_serve(true, true) == true,
          "WiFi UP (GOT_IP) + token ready -> TRUE (auto-start)");

    printf("\n%d checks, %d failures -> %s\n", g_checks, g_fail,
           g_fail ? "FAIL" : "PASS");
    return g_fail ? 1 : 0;
}
