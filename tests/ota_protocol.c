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
 *   2b. r96 HMAC-SHA256 challenge-response: vectors (RFC 4231 + the CLI's
 *      otaMac() vector), hex helpers, replay rejection, AUTH-line parsing;
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
#include "mbedtls/md.h"

/* Real mbedTLS HMAC provider — the same primitive lume_hotreload.c injects.
 * Compiled into this harness with the minimal r91 config (SHA-256 + md). */
static int host_hmac(const uint8_t *key, size_t klen, const uint8_t *msg,
                     size_t mlen, uint8_t out[32])
{
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (info == NULL) return -1;
    return mbedtls_md_hmac(info, key, klen, msg, mlen, out);
}

static int g_fail;
static int g_checks;

#define CHECK(cond, msg) do {                                   \
    g_checks++;                                                 \
    if (!(cond)) { printf("  FAIL: %s\n", (msg)); g_fail++; }  \
    else         { printf("  ok  : %s\n", (msg)); }            \
} while (0)

/* ---------------- event recorder (one parser instance) ---------------- */
typedef struct {
    int      data, back, pause, resume, err, cmd, bytecode, repl;
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
    /* r30 command frames are covered by tests/apps_protocol.c; this harness
     * only asserts the app-frame path, so a command frame is counted apart. */
    case LUME_FRAME_EV_CMD:    r->cmd++;    break;
    case LUME_FRAME_EV_BYTECODE:
        r->bytecode++;
        r->len = len;
        r->payload_len = len < sizeof(r->payload) ? len : sizeof(r->payload);
        if (payload != NULL && r->payload_len) {
            memcpy(r->payload, payload, r->payload_len);
        }
        break;
    case LUME_FRAME_EV_ERR:
        r->err++;
        r->len = len;
        snprintf(r->reason, sizeof(r->reason), "%s", reason ? reason : "?");
        break;
    /* r115 REPL frames share this codec; byte-level assertions live in
     * tests/repl_protocol.js, so this harness only needs to count them. */
    case LUME_FRAME_EV_REPL: r->repl++; break;
    }
}
static void rec_reset(rec_t *r) { memset(r, 0, sizeof(*r)); }
static size_t g_alloc_count;
static size_t g_free_count;
static void *host_alloc(size_t n) { g_alloc_count++; return malloc(n); }
static void  host_free(void *p)  { if (p != NULL) { g_free_count++; free(p); } }

/* ---- section 8: r222 byte-drop / insertion / bit-flip fuzz helpers ---- */
static uint32_t fuzz_next(uint32_t *state)
{
    uint32_t x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    return x;
}

typedef struct {
    const uint8_t *known_payloads[4];
    size_t         known_lens[4];
    lume_frame_ev_t known_evs[4];
    int            known_count;
    int            valid_delivered;
    int            bad_delivered;
    int            sentinel_hits;
    int            err_count;
    const uint8_t *sentinel_payload;
    size_t         sentinel_len;
    lume_frame_ev_t sentinel_ev;
} fuzz_rec_t;

static void fuzz_event(lume_frame_ev_t ev, const uint8_t *payload, size_t len,
                       const char *reason, void *user)
{
    (void)reason;
    fuzz_rec_t *fr = (fuzz_rec_t *)user;
    if (ev == LUME_FRAME_EV_ERR) {
        fr->err_count++;
        return;
    }
    if (ev == LUME_FRAME_EV_BACK || ev == LUME_FRAME_EV_PAUSE ||
        ev == LUME_FRAME_EV_RESUME) {
        return;
    }
    /* Every delivered data/cmd/bytecode/repl frame MUST match a known valid
     * frame byte-for-byte; CRC-32 must never pass a corrupted payload. */
    bool matched = false;
    for (int i = 0; i < fr->known_count; i++) {
        if (ev == fr->known_evs[i] && len == fr->known_lens[i] &&
            payload != NULL && memcmp(payload, fr->known_payloads[i], len) == 0) {
            matched = true;
            break;
        }
    }
    if (matched) {
        fr->valid_delivered++;
        if (ev == fr->sentinel_ev && len == fr->sentinel_len &&
            payload != NULL && memcmp(payload, fr->sentinel_payload, len) == 0) {
            fr->sentinel_hits++;
        }
    } else {
        fr->bad_delivered++;
    }
}

static size_t encode_kind(uint8_t *out, size_t cap, int kind,
                          const uint8_t *payload, size_t len)
{
    switch (kind) {
    case 0: return lume_frame_encode(out, cap, payload, len);
    case 1: return lume_frame_encode_cmd(out, cap, payload, len);
    case 2: return lume_frame_encode_bytecode(out, cap, payload, len);
    default: return lume_frame_encode_repl(out, cap, payload, len);
    }
}

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

    /* ---- 4b. r43b "LUMB" bytecode frames: same header, distinct event ---- */
    printf("[4b] r43b bytecode frame kind\n");
    static uint8_t bc[64];
    memset(bc, 0xa5, sizeof(bc));
    size_t bcn = lume_frame_encode_bytecode(buf, sizeof(buf), bc, sizeof(bc));
    CHECK(bcn == LUME_FRAME_HDR_LEN + sizeof(bc),
          "encode_bytecode length == 12 + payload");
    CHECK(memcmp(buf, LUME_FRAME_BYTECODE_MAGIC, LUME_FRAME_MAGIC_LEN) == 0,
          "bytecode frame magic == \"LUMB\"");
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, buf, bcn);
    CHECK(r.bytecode == 1 && r.data == 0 && r.cmd == 0 && r.err == 0 &&
          r.len == sizeof(bc) && memcmp(r.payload, bc, sizeof(bc)) == 0,
          "LUMB decodes as EV_BYTECODE (not DATA/CMD) and round-trips");
    /* All three kinds share one stream: LUME / LUMC / LUMB interleaved. */
    rec_reset(&r);
    parser_init(&p, &r);
    feed_all(&p, hexbuf, hn);                                   /* LUME */
    size_t cn = lume_frame_encode_cmd(buf, sizeof(buf),
                                      (const uint8_t *)"LIST", 4);
    feed_all(&p, buf, cn);                                      /* LUMC */
    bcn = lume_frame_encode_bytecode(buf, sizeof(buf), bc, sizeof(bc));
    feed_all(&p, buf, bcn);                                     /* LUMB */
    CHECK(r.data == 1 && r.cmd == 1 && r.bytecode == 1 && r.err == 0,
          "LUME/LUMC/LUMB interleave in one parser with no resync");

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

    /* ---- 5b. r96 HMAC challenge-response auth vectors ---- */
    printf("[5b] r96 HMAC-SHA256 challenge-response auth\n");
    /* RFC 4231 test case 1 (mbedTLS primitive sanity). */
    const uint8_t rfc_key[20] = { 0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,
                                  0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b,0x0b };
    uint8_t digest[32];
    char digest_hex[LUME_OTA_MAC_STR_MAX];
    CHECK(host_hmac(rfc_key, sizeof(rfc_key), (const uint8_t *)"Hi There", 8,
                    digest) == 0, "mbedTLS SHA-256 HMAC primitive available");
    lume_ota_hex_encode(digest, sizeof(digest), digest_hex);
    CHECK(strcmp(digest_hex,
          "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7") == 0,
          "RFC 4231 case 1 HMAC vector matches");

    /* Hex helpers (portable, same file the firmware links). */
    uint8_t raw[16];
    CHECK(lume_ota_hex_valid(token, LUME_OTA_TOKEN_HEX_LEN), "hex_valid: 32 hex OK");
    CHECK(!lume_ota_hex_valid("zz3456789abcdef0123456789abcdef", 32),
          "hex_valid: non-hex rejected");
    CHECK(!lume_ota_hex_decode("abc", 3, raw), "hex_decode: odd nhex rejected");
    CHECK(lume_ota_hex_decode(token, LUME_OTA_TOKEN_HEX_LEN, raw) &&
          raw[0] == 0x01 && raw[15] == 0xef, "hex_decode: first/last byte correct");
    CHECK(lume_ota_hex_valid(digest_hex, LUME_OTA_MAC_HEX_LEN), "hex_valid: 64 hex MAC OK");
    CHECK(lume_ota_hex_equal(digest_hex, digest_hex, LUME_OTA_MAC_HEX_LEN),
          "hex_equal: identical MAC matches");
    CHECK(!lume_ota_hex_equal(digest_hex,
          "00004c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
          LUME_OTA_MAC_HEX_LEN), "hex_equal: 1-char-off MAC rejected");

    /* Challenge line format — exactly what ota.js waits for. */
    const char *challenge = "fedcba9876543210fedcba9876543210";
    char chal_line[LUME_OTA_AUTH_LINE_MAX];
    int clen = lume_ota_challenge_line(chal_line, sizeof(chal_line), challenge);
    CHECK(clen == 43 && strcmp(chal_line,
          "CHALLENGE fedcba9876543210fedcba9876543210\n") == 0,
          "challenge line format == \"CHALLENGE <32hex>\\n\"");

    /* The CLI's otaMac() vector: key = raw token bytes, msg = challenge ASCII. */
    const char *mac =
        "bbbf60336fc30177d6262b9b3b5373787f60ee67ea9bcb8f7f58118e6b983eb2";
    CHECK(lume_ota_mac_verify(host_hmac, raw, sizeof(raw), challenge, mac) == 0,
          "RIGHT MAC: mac_verify == 0 (auth OK path)");
    CHECK(lume_ota_mac_verify(host_hmac, raw, sizeof(raw), challenge,
          "0000000000000000000000000000000000000000000000000000000000000000") == -4,
          "WRONG MAC: mac_verify == -4 (auth ERR path)");
    /* Replay: the same MAC cannot authenticate a different challenge. */
    CHECK(lume_ota_mac_verify(host_hmac, raw, sizeof(raw),
          "00000000000000000000000000000000", mac) == -4,
          "replay with a different challenge -> mac_verify -4");
    CHECK(lume_ota_mac_verify(host_hmac, raw, sizeof(raw), "xyz", mac) == -2,
          "malformed challenge hex -> mac_verify -2");

    /* AUTH line carrying a 64-hex MAC is parsed by the same helper. */
    char mac_line[128];
    size_t mlen = strlen("AUTH ") + LUME_OTA_MAC_HEX_LEN + 1;
    snprintf(mac_line, sizeof(mac_line), "AUTH %s\n", mac);
    char provided_mac[LUME_OTA_MAC_STR_MAX];
    CHECK(lume_ota_auth_parse(mac_line, mlen, provided_mac,
          sizeof(provided_mac)) && strcmp(provided_mac, mac) == 0,
          "auth_parse extracts a 64-hex MAC");

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

    /* ---- 8. r222 stream fuzz: drop/insert/flip -> resync, never pass bad CRC ---- */
    printf("[8] r222 byte-drop / insert / bit-flip fuzz + resync recovery\n");
    {
        /* Four valid frames covering all four magics, including payloads that
         * contain embedded magic strings ("LUME"/"LUMC") to stress resync. */
        static const uint8_t pay_data[] =
            "var app=1;/* embedded LUME LUMC LUMB LUMR magic noise */app+1;";
        static const uint8_t pay_cmd[] = "LAUNCH\tspeedometer";
        static uint8_t pay_bc[320];
        static const uint8_t pay_repl[] = "lume.sys.heap()";
        for (size_t i = 0; i < sizeof(pay_bc); i++) {
            pay_bc[i] = (uint8_t)((i * 37u + 13u) & 0xffu);
        }
        memcpy(pay_bc + 40, "LUME", 4);
        memcpy(pay_bc + 180, "LUMC", 4);

        const uint8_t *pays[4] = { pay_data, pay_cmd, pay_bc, pay_repl };
        const size_t plens[4] = {
            sizeof(pay_data) - 1, sizeof(pay_cmd) - 1,
            sizeof(pay_bc), sizeof(pay_repl) - 1
        };
        const lume_frame_ev_t pevs[4] = {
            LUME_FRAME_EV_DATA, LUME_FRAME_EV_CMD,
            LUME_FRAME_EV_BYTECODE, LUME_FRAME_EV_REPL
        };
        uint8_t enc_frames[4][512];
        size_t  enc_lens[4];
        for (int k = 0; k < 4; k++) {
            enc_lens[k] = encode_kind(enc_frames[k], sizeof(enc_frames[k]),
                                      k, pays[k], plens[k]);
        }
        uint8_t resync_pad[12];
        memset(resync_pad, 0xff, sizeof(resync_pad));

        uint32_t rng = 0x222cafe1u;
        int total_bad_delivered = 0;
        int flip_recovered = 0, drop_recovered = 0, insert_recovered = 0;
        int stream_recovered = 0;
        const int N_FLIP = 200, N_DROP = 200, N_INS = 200, N_STREAM = 100;
        size_t alloc_before = g_alloc_count;
        size_t free_before = g_free_count;

        /* 8a. Random bit/byte flips inside header/payload -> bad frame never
         * accepted; resync recovers the following valid sentinel frame. */
        for (int t = 0; t < N_FLIP; t++) {
            int k_bad = (int)(fuzz_next(&rng) % 4u);
            int k_ok  = (int)(fuzz_next(&rng) % 4u);
            uint8_t mutated[512];
            size_t mlen = enc_lens[k_bad];
            memcpy(mutated, enc_frames[k_bad], mlen);
            /* Corrupt 1..6 bytes in payload or CRC/magic (avoid creating a huge
             * random length in bytes 4..7 that would swallow the sentinel). */
            int flips = 1 + (int)(fuzz_next(&rng) % 6u);
            for (int f = 0; f < flips; f++) {
                size_t pos = fuzz_next(&rng) % mlen;
                if (pos >= 4 && pos < 8) pos = 8 + (pos - 4);
                mutated[pos] ^= (uint8_t)(1u + (fuzz_next(&rng) % 255u));
            }
            fuzz_rec_t fr;
            memset(&fr, 0, sizeof(fr));
            for (int k = 0; k < 4; k++) {
                fr.known_payloads[k] = pays[k];
                fr.known_lens[k] = plens[k];
                fr.known_evs[k] = pevs[k];
            }
            fr.known_count = 4;
            fr.sentinel_payload = pays[k_ok];
            fr.sentinel_len = plens[k_ok];
            fr.sentinel_ev = pevs[k_ok];

            lume_frame_parser_t fp;
            lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            feed_all(&fp, mutated, mlen);
            feed_all(&fp, resync_pad, sizeof(resync_pad));
            feed_all(&fp, enc_frames[k_ok], enc_lens[k_ok]);
            if (fp.payload != NULL) host_free(fp.payload);
            total_bad_delivered += fr.bad_delivered;
            if (fr.sentinel_hits >= 1 && fr.bad_delivered == 0) flip_recovered++;
        }

        /* 8b. Burst byte drops (1..64 bytes, simulating USJ RX ring overflow)
         * followed by enough resync padding to flush ST_BODY + valid sentinel. */
        for (int t = 0; t < N_DROP; t++) {
            int k_bad = 2; /* 320 B payload so 1..64 B burst drops fit cleanly */
            int k_ok  = (int)(fuzz_next(&rng) % 4u);
            size_t flen = enc_lens[k_bad];
            size_t drop_n = 1u + (fuzz_next(&rng) % 64u);
            size_t drop_at = fuzz_next(&rng) % (flen - drop_n);
            uint8_t dropped[512];
            memcpy(dropped, enc_frames[k_bad], drop_at);
            memcpy(dropped + drop_at, enc_frames[k_bad] + drop_at + drop_n,
                   flen - drop_at - drop_n);
            size_t dlen = flen - drop_n;

            fuzz_rec_t fr;
            memset(&fr, 0, sizeof(fr));
            for (int k = 0; k < 4; k++) {
                fr.known_payloads[k] = pays[k];
                fr.known_lens[k] = plens[k];
                fr.known_evs[k] = pevs[k];
            }
            fr.known_count = 4;
            fr.sentinel_payload = pays[k_ok];
            fr.sentinel_len = plens[k_ok];
            fr.sentinel_ev = pevs[k_ok];

            lume_frame_parser_t fp;
            lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            feed_all(&fp, dropped, dlen);
            /* Flush any remaining bytes if parser entered ST_BODY with intact
             * header length (drop_at >= 12), or reset if header length itself
             * was corrupted into an arbitrary huge length (like usb_rx_task
             * idle timeout does on a stalled header). */
            if (fp.state == LUME_FRAME_ST_BODY && fp.payload_len > flen) {
                if (fp.payload != NULL) host_free(fp.payload);
                lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            } else {
                uint8_t flush[80];
                memset(flush, 0xff, sizeof(flush));
                feed_all(&fp, flush, drop_n + 12u);
            }
            feed_all(&fp, enc_frames[k_ok], enc_lens[k_ok]);
            if (fp.payload != NULL) host_free(fp.payload);
            total_bad_delivered += fr.bad_delivered;
            if (fr.sentinel_hits >= 1 && fr.bad_delivered == 0) drop_recovered++;
        }

        /* 8c. Random byte insertion (1..32 bytes) inside a frame -> bad-crc
         * or bad-magic -> resync recovers following valid sentinel frame. */
        for (int t = 0; t < N_INS; t++) {
            int k_bad = (int)(fuzz_next(&rng) % 4u);
            int k_ok  = (int)(fuzz_next(&rng) % 4u);
            size_t flen = enc_lens[k_bad];
            size_t ins_n = 1u + (fuzz_next(&rng) % 32u);
            size_t ins_at = fuzz_next(&rng) % (flen + 1u);
            uint8_t bloated[600];
            memcpy(bloated, enc_frames[k_bad], ins_at);
            for (size_t i = 0; i < ins_n; i++) {
                bloated[ins_at + i] = (uint8_t)(fuzz_next(&rng) & 0xffu);
            }
            memcpy(bloated + ins_at + ins_n, enc_frames[k_bad] + ins_at,
                   flen - ins_at);

            fuzz_rec_t fr;
            memset(&fr, 0, sizeof(fr));
            for (int k = 0; k < 4; k++) {
                fr.known_payloads[k] = pays[k];
                fr.known_lens[k] = plens[k];
                fr.known_evs[k] = pevs[k];
            }
            fr.known_count = 4;
            fr.sentinel_payload = pays[k_ok];
            fr.sentinel_len = plens[k_ok];
            fr.sentinel_ev = pevs[k_ok];

            lume_frame_parser_t fp;
            lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            feed_all(&fp, bloated, flen + ins_n);
            if (fp.state == LUME_FRAME_ST_BODY && fp.payload_len > flen) {
                if (fp.payload != NULL) host_free(fp.payload);
                lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            }
            feed_all(&fp, resync_pad, sizeof(resync_pad));
            feed_all(&fp, enc_frames[k_ok], enc_lens[k_ok]);
            if (fp.payload != NULL) host_free(fp.payload);
            total_bad_delivered += fr.bad_delivered;
            if (fr.sentinel_hits >= 1 && fr.bad_delivered == 0) insert_recovered++;
        }

        /* 8d. Multi-frame chaotic streams: interleaved valid frames, random
         * noise bursts, corrupted frames, and idle-timeout resets. */
        for (int s = 0; s < N_STREAM; s++) {
            int k_ok = s % 4;
            fuzz_rec_t fr;
            memset(&fr, 0, sizeof(fr));
            for (int k = 0; k < 4; k++) {
                fr.known_payloads[k] = pays[k];
                fr.known_lens[k] = plens[k];
                fr.known_evs[k] = pevs[k];
            }
            fr.known_count = 4;
            fr.sentinel_payload = pays[k_ok];
            fr.sentinel_len = plens[k_ok];
            fr.sentinel_ev = pevs[k_ok];

            lume_frame_parser_t fp;
            lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            for (int step = 0; step < 6; step++) {
                uint32_t mode = fuzz_next(&rng) % 3u;
                if (mode == 0) {
                    /* Random garbage bytes (1..48 B) */
                    size_t gn = 1u + (fuzz_next(&rng) % 48u);
                    for (size_t i = 0; i < gn; i++) {
                        lume_frame_parser_feed(&fp, (uint8_t)(fuzz_next(&rng) & 0xffu));
                    }
                } else if (mode == 1) {
                    /* Truncated frame (simulate lost tail) */
                    int kf = (int)(fuzz_next(&rng) % 4u);
                    size_t cut = 1u + (fuzz_next(&rng) % (enc_lens[kf] - 1u));
                    feed_all(&fp, enc_frames[kf], cut);
                } else {
                    /* Corrupted payload frame */
                    int kf = (int)(fuzz_next(&rng) % 4u);
                    uint8_t tmp[512];
                    memcpy(tmp, enc_frames[kf], enc_lens[kf]);
                    tmp[12 + (fuzz_next(&rng) % plens[kf])] ^= 0x5au;
                    feed_all(&fp, tmp, enc_lens[kf]);
                }
            }
            /* Simulate usb_rx_task idle timeout reset if mid-frame, then
             * send resync preamble + final valid sentinel frame. */
            if (fp.state == LUME_FRAME_ST_HDR || fp.state == LUME_FRAME_ST_BODY ||
                (fp.state == LUME_FRAME_ST_MAGIC && fp.magic_n > 0)) {
                if (fp.payload != NULL) host_free(fp.payload);
                lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            }
            feed_all(&fp, resync_pad, sizeof(resync_pad));
            feed_all(&fp, enc_frames[k_ok], enc_lens[k_ok]);
            if (fp.payload != NULL) host_free(fp.payload);
            total_bad_delivered += fr.bad_delivered;
            if (fr.sentinel_hits >= 1 && fr.bad_delivered == 0) stream_recovered++;
        }

        /* 8e. Explicit idle-timeout recovery test (mirrors usb_rx_task). */
        int idle_ok = 0;
        {
            fuzz_rec_t fr;
            memset(&fr, 0, sizeof(fr));
            for (int k = 0; k < 4; k++) {
                fr.known_payloads[k] = pays[k];
                fr.known_lens[k] = plens[k];
                fr.known_evs[k] = pevs[k];
            }
            fr.known_count = 4;
            fr.sentinel_payload = pays[1];
            fr.sentinel_len = plens[1];
            fr.sentinel_ev = pevs[1];

            lume_frame_parser_t fp;
            lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
            /* Feed 320 B frame minus last 64 B -> parser stalls in ST_BODY. */
            feed_all(&fp, enc_frames[2], enc_lens[2] - 64u);
            if (fp.state == LUME_FRAME_ST_BODY && fp.payload != NULL &&
                fp.payload_n == plens[2] - 64u) {
                host_free(fp.payload);
                lume_frame_parser_init(&fp, host_alloc, host_free, fuzz_event, &fr);
                feed_all(&fp, enc_frames[1], enc_lens[1]);
                if (fr.sentinel_hits == 1 && fr.bad_delivered == 0 && fr.err_count == 0) {
                    idle_ok = 1;
                }
            } else if (fp.payload != NULL) {
                host_free(fp.payload);
            }
        }

        size_t alloc_delta = g_alloc_count - alloc_before;
        size_t free_delta  = g_free_count - free_before;
        printf("  fuzz stats (seed=0x222cafe1): flip=%d/%d drop=%d/%d ins=%d/%d stream=%d/%d bad_delivered=%d allocs=%u frees=%u\n",
               flip_recovered, N_FLIP, drop_recovered, N_DROP,
               insert_recovered, N_INS, stream_recovered, N_STREAM,
               total_bad_delivered, (unsigned)alloc_delta, (unsigned)free_delta);
        CHECK(total_bad_delivered == 0,
              "fuzz: CRC layer NEVER delivers a corrupted payload across 700 trials");
        CHECK(flip_recovered == N_FLIP,
              "fuzz: 200/200 bit-flip trials resync and deliver subsequent valid frame");
        CHECK(drop_recovered == N_DROP,
              "fuzz: 200/200 1..64B burst byte-drop trials resync and deliver valid frame");
        CHECK(insert_recovered == N_INS,
              "fuzz: 200/200 1..32B byte-insertion trials resync and deliver valid frame");
        CHECK(stream_recovered == N_STREAM,
              "fuzz: 100/100 chaotic multi-frame streams recover final valid frame");
        CHECK(idle_ok == 1,
              "idle-timeout reset frees stalled ST_BODY buffer and delivers next frame");
        CHECK(alloc_delta == free_delta && alloc_delta > 0,
              "fuzz: zero payload buffer leaks (alloc_count == free_count)");
    }

    printf("\n%d checks, %d failures -> %s\n", g_checks, g_fail,
           g_fail ? "FAIL" : "PASS");
    return g_fail ? 1 : 0;
}
