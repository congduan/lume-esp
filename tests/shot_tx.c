/*
 * r223 host harness: firmware reply_write() bounded retry & handle_shot()
 * TX failure abort path (CMD ERR shot-tx, never false SHOT OK).
 *
 * Build (from repo root):
 *   cc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-hotreload/include \
 *     -I firmware/components/lume-engine/include \
 *     tests/shot_tx.c \
 *     firmware/components/lume-hotreload/lume_cmd.c \
 *     firmware/components/lume-hotreload/lume_frame.c \
 *     -o /tmp/lume_shot_tx && /tmp/lume_shot_tx
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "lume_cmd.h"
#include "lume_frame.h"

static int g_fail;
static int g_checks;

#define CHECK(cond, msg) do {                                   \
    g_checks++;                                                 \
    if (!(cond)) { printf("  FAIL: %s\n", (msg)); g_fail++; }  \
    else         { printf("  ok  : %s\n", (msg)); }            \
} while (0)

/* Minimal RFC 4648 base64 encoder with mbedtls_base64_encode() signature. */
static int host_b64_encode(unsigned char *dst, size_t dlen, size_t *olen,
                           const unsigned char *src, size_t slen)
{
    static const char T[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t need = ((slen + 2u) / 3u) * 4u;
    if (need + 1u > dlen) return -1;
    size_t o = 0;
    for (size_t i = 0; i < slen; i += 3u) {
        uint32_t v = ((uint32_t)src[i]) << 16;
        if (i + 1u < slen) v |= ((uint32_t)src[i + 1u]) << 8;
        if (i + 2u < slen) v |= (uint32_t)src[i + 2u];
        dst[o++] = (unsigned char)T[(v >> 18) & 0x3fu];
        dst[o++] = (unsigned char)T[(v >> 12) & 0x3fu];
        dst[o++] = (i + 1u < slen) ? (unsigned char)T[(v >> 6) & 0x3fu] : '=';
        dst[o++] = (i + 2u < slen) ? (unsigned char)T[v & 0x3fu] : '=';
    }
    dst[o] = '\0';
    *olen = o;
    return 0;
}

static int g_b64_fail_call = -1;
static int g_b64_calls = 0;
static int host_b64_faulty(unsigned char *dst, size_t dlen, size_t *olen,
                           const unsigned char *src, size_t slen)
{
    int idx = g_b64_calls++;
    if (idx == g_b64_fail_call) return -1;
    return host_b64_encode(dst, dlen, olen, src, slen);
}

/* ---------------- Mock TX backend for lume_tx_write_retry ---------------- */
typedef struct {
    int  write_calls;
    int  drain_calls;
    int  delay_calls;
    int  stalls_before_ok;  /* <0 means always stall */
    int  fatal_on_call;     /* >=0 returns -1 on this write call */
    int  max_chunk;         /* >0 simulates partial TCP write */
    bool drain_seq[8];
    uint8_t out[4096];
    size_t  out_len;
} mock_tx_t;

static int mock_write(const uint8_t *buf, size_t len, void *user)
{
    mock_tx_t *m = (mock_tx_t *)user;
    int call = m->write_calls++;
    if (m->fatal_on_call >= 0 && call == m->fatal_on_call) {
        return -1;
    }
    if (m->stalls_before_ok < 0 || call < m->stalls_before_ok) {
        return 0;
    }
    size_t n = len;
    if (m->max_chunk > 0 && n > (size_t)m->max_chunk) {
        n = (size_t)m->max_chunk;
    }
    if (m->out_len + n <= sizeof(m->out)) {
        memcpy(m->out + m->out_len, buf, n);
        m->out_len += n;
    }
    return (int)n;
}

static bool mock_drain(void *user)
{
    mock_tx_t *m = (mock_tx_t *)user;
    int idx = m->drain_calls++;
    return idx < 8 ? m->drain_seq[idx] : false;
}

static void mock_delay(void *user)
{
    mock_tx_t *m = (mock_tx_t *)user;
    m->delay_calls++;
}

static void test_tx_retry(void)
{
    printf("[tx-retry]\n");
    const uint8_t msg[] = "S64AAAA\n";

    /* 1. Fast path: immediate success -> 0 drains, 0 delays. */
    mock_tx_t m1;
    memset(&m1, 0, sizeof(m1));
    m1.fatal_on_call = -1;
    lume_tx_ops_t ops1 = { mock_write, mock_drain, mock_delay, &m1 };
    CHECK(lume_tx_write_retry(msg, sizeof(msg) - 1u, LUME_TX_USB_MAX_RETRIES, &ops1),
          "immediate write succeeds");
    CHECK(m1.write_calls == 1 && m1.drain_calls == 0 && m1.delay_calls == 0,
          "fast path performs 0 drains and 0 backoff delays");

    /* 2. Transient stall recovery: stall 2x, drain true then false -> 1 delay. */
    mock_tx_t m2;
    memset(&m2, 0, sizeof(m2));
    m2.fatal_on_call = -1;
    m2.stalls_before_ok = 2;
    m2.drain_seq[0] = true;
    m2.drain_seq[1] = false;
    lume_tx_ops_t ops2 = { mock_write, mock_drain, mock_delay, &m2 };
    CHECK(lume_tx_write_retry(msg, sizeof(msg) - 1u, LUME_TX_USB_MAX_RETRIES, &ops2),
          "transient TX ring stall recovers within retry budget");
    CHECK(m2.write_calls == 3 && m2.drain_calls == 2 && m2.delay_calls == 1,
          "drain=true skips backoff delay; drain=false triggers backoff delay");
    CHECK(m2.out_len == sizeof(msg) - 1u && memcmp(m2.out, msg, m2.out_len) == 0,
          "recovered bytes match input verbatim");

    /* 3. Bounded retry exhaustion: always stalls -> 1 + MAX_RETRIES attempts. */
    mock_tx_t m3;
    memset(&m3, 0, sizeof(m3));
    m3.fatal_on_call = -1;
    m3.stalls_before_ok = -1;
    lume_tx_ops_t ops3 = { mock_write, mock_drain, mock_delay, &m3 };
    CHECK(!lume_tx_write_retry(msg, sizeof(msg) - 1u, LUME_TX_USB_MAX_RETRIES, &ops3),
          "persistent stall fails after bounded retries");
    CHECK(m3.write_calls == 1 + LUME_TX_USB_MAX_RETRIES,
          "write attempts strictly bounded to 1 + LUME_TX_USB_MAX_RETRIES");
    CHECK(m3.drain_calls == LUME_TX_USB_MAX_RETRIES &&
          m3.delay_calls == LUME_TX_USB_MAX_RETRIES,
          "each retry checks drain and backs off when still full");

    /* 4. TCP partial write + fatal error fast-fail (0 retries). */
    mock_tx_t m4;
    memset(&m4, 0, sizeof(m4));
    m4.fatal_on_call = -1;
    m4.max_chunk = 3;
    lume_tx_ops_t ops4 = { mock_write, NULL, mock_delay, &m4 };
    CHECK(lume_tx_write_retry(msg, sizeof(msg) - 1u, LUME_TX_TCP_MAX_RETRIES, &ops4),
          "partial TCP writes advance to full message");
    CHECK(m4.out_len == sizeof(msg) - 1u && memcmp(m4.out, msg, m4.out_len) == 0,
          "reassembled partial TCP bytes match verbatim");

    mock_tx_t m5;
    memset(&m5, 0, sizeof(m5));
    m5.fatal_on_call = 0;
    lume_tx_ops_t ops5 = { mock_write, mock_drain, mock_delay, &m5 };
    CHECK(!lume_tx_write_retry(msg, sizeof(msg) - 1u, LUME_TX_TCP_MAX_RETRIES, &ops5),
          "fatal write error (<0) fails immediately");
    CHECK(m5.write_calls == 1 && m5.delay_calls == 0,
          "fatal error performs 0 retries");
}

/* ---------------- Mock line sink for lume_shot_stream ---------------- */
typedef struct {
    char   buf[16384];
    size_t len;
    int    line_calls;
    int    fail_on_line;     /* >=0: fail write_line on this call index */
    int    stall_on_line;    /* >=0: inject transient stall via lume_tx_write_retry */
    int    stalls_left;
    int    s64_lines;
    int    ok_lines;
    int    err_tx_lines;
    int    err_enc_lines;
} shot_sink_t;

static int sink_raw_write(const uint8_t *buf, size_t len, void *user)
{
    shot_sink_t *s = (shot_sink_t *)user;
    if (s->stalls_left > 0) {
        s->stalls_left--;
        return 0;
    }
    if (s->len + len < sizeof(s->buf)) {
        memcpy(s->buf + s->len, buf, len);
        s->len += len;
        s->buf[s->len] = '\0';
    }
    return (int)len;
}

static bool sink_write_line(const char *line, size_t len, void *user)
{
    shot_sink_t *s = (shot_sink_t *)user;
    int idx = s->line_calls++;
    if (s->fail_on_line >= 0 && idx == s->fail_on_line) {
        return false;
    }
    if (s->stall_on_line >= 0 && idx == s->stall_on_line) {
        lume_tx_ops_t ops = { sink_raw_write, NULL, NULL, s };
        if (!lume_tx_write_retry((const uint8_t *)line, len,
                                 LUME_TX_USB_MAX_RETRIES, &ops)) {
            return false;
        }
    } else if (s->len + len < sizeof(s->buf)) {
        memcpy(s->buf + s->len, line, len);
        s->len += len;
        s->buf[s->len] = '\0';
    }
    if (strstr(line, "S64") != NULL) s->s64_lines++;
    if (strstr(line, "SHOT OK") != NULL) s->ok_lines++;
    if (strstr(line, "CMD ERR shot-tx") != NULL) s->err_tx_lines++;
    if (strstr(line, "CMD ERR shot-encode") != NULL) s->err_enc_lines++;
    return true;
}

static void test_shot_stream(void)
{
    printf("[shot-stream]\n");
    /* 16x16 RGB565 = 512 bytes -> 3 S64 lines (240 + 240 + 32). */
    uint8_t frame[512];
    for (size_t i = 0; i < sizeof(frame); i++) {
        frame[i] = (uint8_t)((i * 37u + 13u) & 0xffu);
    }

    /* 1. Happy path: header + 3 S64 lines + SHOT OK, leading '\n' framing. */
    shot_sink_t s1;
    memset(&s1, 0, sizeof(s1));
    s1.fail_on_line = -1;
    s1.stall_on_line = -1;
    lume_shot_ops_t ops1 = { sink_write_line, lume_frame_crc32, host_b64_encode, &s1 };
    size_t failed_off = 999;
    lume_shot_status_t r1 = lume_shot_stream(frame, 16, 16, &ops1, &failed_off);
    CHECK(r1 == LUME_SHOT_OK, "happy path returns LUME_SHOT_OK");
    CHECK(s1.s64_lines == 3 && s1.ok_lines == 1 && s1.err_tx_lines == 0,
          "happy path emits 3 S64 lines, 1 SHOT OK, 0 CMD ERR");
    CHECK(strstr(s1.buf, "\nSHOT 16 16 512 ") != NULL &&
          strstr(s1.buf, "\nS64") != NULL &&
          strstr(s1.buf, "\nSHOT OK\n") != NULL,
          "SHOT, S64 and SHOT OK lines use leading newline boundary");

    /* 2. Mid-stream S64 TX failure (line 2 = chunk 2 at offset 240):
     *    must abort immediately, emit CMD ERR shot-tx, NEVER emit SHOT OK. */
    shot_sink_t s2;
    memset(&s2, 0, sizeof(s2));
    s2.fail_on_line = 2;    /* 0=header, 1=chunk0, 2=chunk1 (FAIL) */
    s2.stall_on_line = -1;
    lume_shot_ops_t ops2 = { sink_write_line, lume_frame_crc32, host_b64_encode, &s2 };
    failed_off = 0;
    lume_shot_status_t r2 = lume_shot_stream(frame, 16, 16, &ops2, &failed_off);
    CHECK(r2 == LUME_SHOT_ERR_TX, "mid-stream TX failure returns LUME_SHOT_ERR_TX");
    CHECK(failed_off == LUME_SHOT_CHUNK, "failed_offset points at failed chunk (240)");
    CHECK(s2.s64_lines == 1, "streaming stops immediately after failed chunk (no chunk 3)");
    CHECK(s2.err_tx_lines == 1 && strstr(s2.buf, "\nCMD ERR shot-tx\n") != NULL,
          "TX failure emits CMD ERR shot-tx");
    CHECK(s2.ok_lines == 0 && strstr(s2.buf, "SHOT OK") == NULL,
          "TX failure NEVER emits false SHOT OK");

    /* 3. Header TX failure (line 0): emits CMD ERR shot-tx, 0 S64, no SHOT OK. */
    shot_sink_t s3;
    memset(&s3, 0, sizeof(s3));
    s3.fail_on_line = 0;
    s3.stall_on_line = -1;
    lume_shot_ops_t ops3 = { sink_write_line, lume_frame_crc32, host_b64_encode, &s3 };
    lume_shot_status_t r3 = lume_shot_stream(frame, 16, 16, &ops3, &failed_off);
    CHECK(r3 == LUME_SHOT_ERR_TX, "header TX failure returns LUME_SHOT_ERR_TX");
    CHECK(s3.s64_lines == 0 && s3.err_tx_lines == 1 && s3.ok_lines == 0,
          "header TX failure emits CMD ERR shot-tx with 0 S64 and no SHOT OK");

    /* 4. Transient TX stall on chunk 2 (2 stalls < MAX_RETRIES=4): recovers -> SHOT OK. */
    shot_sink_t s4;
    memset(&s4, 0, sizeof(s4));
    s4.fail_on_line = -1;
    s4.stall_on_line = 2;
    s4.stalls_left = 2;
    lume_shot_ops_t ops4 = { sink_write_line, lume_frame_crc32, host_b64_encode, &s4 };
    lume_shot_status_t r4 = lume_shot_stream(frame, 16, 16, &ops4, &failed_off);
    CHECK(r4 == LUME_SHOT_OK && s4.s64_lines == 3 && s4.ok_lines == 1 && s4.err_tx_lines == 0,
          "transient TX stall recovers via bounded retry and emits SHOT OK");

    /* 5. Exhausted TX stall on chunk 2 (stalls > MAX_RETRIES): aborts with shot-tx, no SHOT OK. */
    shot_sink_t s5;
    memset(&s5, 0, sizeof(s5));
    s5.fail_on_line = -1;
    s5.stall_on_line = 2;
    s5.stalls_left = LUME_TX_USB_MAX_RETRIES + 2;
    lume_shot_ops_t ops5 = { sink_write_line, lume_frame_crc32, host_b64_encode, &s5 };
    lume_shot_status_t r5 = lume_shot_stream(frame, 16, 16, &ops5, &failed_off);
    CHECK(r5 == LUME_SHOT_ERR_TX && s5.err_tx_lines == 1 && s5.ok_lines == 0,
          "exhausted TX retry aborts with CMD ERR shot-tx and no SHOT OK");

    /* 6. Base64 encode failure on chunk 2: emits CMD ERR shot-encode, no SHOT OK. */
    shot_sink_t s6;
    memset(&s6, 0, sizeof(s6));
    s6.fail_on_line = -1;
    s6.stall_on_line = -1;
    g_b64_calls = 0;
    g_b64_fail_call = 1;
    lume_shot_ops_t ops6 = { sink_write_line, lume_frame_crc32, host_b64_faulty, &s6 };
    lume_shot_status_t r6 = lume_shot_stream(frame, 16, 16, &ops6, &failed_off);
    CHECK(r6 == LUME_SHOT_ERR_ENCODE && s6.err_enc_lines == 1 && s6.ok_lines == 0,
          "encode failure aborts with CMD ERR shot-encode and no SHOT OK");
}

int main(void)
{
    test_tx_retry();
    test_shot_stream();
    printf("\nSUMMARY: %d checks, %d failures\n", g_checks, g_fail);
    return g_fail ? 1 : 0;
}
