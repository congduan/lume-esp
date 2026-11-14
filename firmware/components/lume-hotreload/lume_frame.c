/**
 * lume_frame (r26): portable implementation of the shared push-channel wire
 * protocol. See include/lume_frame.h for the format. NO RTOS / ESP includes:
 * this file is compiled verbatim on the host by tests/ota_protocol.c.
 *
 * The streaming state machine is a faithful reentrant port of the original
 * M1 USB parser (firmware/components/lume-hotreload/lume_hotreload.c, before
 * r26): same states, same rolling "LUME" resync window, same reject reasons
 * and lengths, same OOM-discard path. Extracting it is what guarantees the
 * USB and WiFi-OTA channels use LITERALLY the same frame protocol.
 */
#include "lume_frame.h"
#include <stdio.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* CRC-32                                                              */
/* ------------------------------------------------------------------ */
uint32_t lume_frame_crc32(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xffffffffu;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++) {
            crc = (crc >> 1) ^ ((crc & 1u) ? 0xedb88320u : 0u);
        }
    }
    return crc ^ 0xffffffffu;
}

static void store_le32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xffu);
    p[1] = (uint8_t)((v >> 8) & 0xffu);
    p[2] = (uint8_t)((v >> 16) & 0xffu);
    p[3] = (uint8_t)((v >> 24) & 0xffu);
}

static uint32_t load_le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

size_t lume_frame_encode(uint8_t *out, size_t out_cap,
                         const uint8_t *payload, size_t len)
{
    if (out == NULL || (payload == NULL && len > 0) ||
        len == 0 || len > LUME_FRAME_MAX_PAYLOAD ||
        out_cap < LUME_FRAME_HDR_LEN + len) {
        return 0;
    }
    memcpy(out, LUME_FRAME_MAGIC, LUME_FRAME_MAGIC_LEN);
    store_le32(out + LUME_FRAME_MAGIC_LEN, (uint32_t)len);
    store_le32(out + LUME_FRAME_MAGIC_LEN + LUME_FRAME_LEN_LEN,
               lume_frame_crc32(payload, len));
    if (len > 0) {
        memcpy(out + LUME_FRAME_HDR_LEN, payload, len);
    }
    return LUME_FRAME_HDR_LEN + len;
}

/* ------------------------------------------------------------------ */
/* Streaming frame parser (reentrant)                                  */
/* ------------------------------------------------------------------ */
static void sync_push(lume_frame_parser_t *p, uint8_t b)
{
    p->sync[0] = p->sync[1];
    p->sync[1] = p->sync[2];
    p->sync[2] = p->sync[3];
    p->sync[3] = b;
    if (p->sync_n < LUME_FRAME_MAGIC_LEN) {
        p->sync_n++;
    }
}

static bool sync_is_magic(const lume_frame_parser_t *p)
{
    return p->sync_n == LUME_FRAME_MAGIC_LEN &&
           memcmp(p->sync, LUME_FRAME_MAGIC, LUME_FRAME_MAGIC_LEN) == 0;
}

static void emit(lume_frame_parser_t *p, lume_frame_ev_t ev,
                 const uint8_t *payload, size_t len, const char *reason)
{
    if (p->on_event != NULL) {
        p->on_event(ev, payload, len, reason, p->user);
    }
}

static void enter_magic(lume_frame_parser_t *p)
{
    p->state = LUME_FRAME_ST_MAGIC;   /* next frame starts aligned */
    p->magic_n = 0;
}

static void enter_hdr(lume_frame_parser_t *p)
{
    p->state = LUME_FRAME_ST_HDR;
    p->hdr_n = 0;
}

static void enter_resync(lume_frame_parser_t *p)
{
    /* The rolling window already holds the trailing bytes; a magic ending
     * exactly at the error boundary must not be lost, so test it BEFORE the
     * first new byte arrives. No errors are emitted while re-syncing. */
    if (sync_is_magic(p)) {
        enter_hdr(p);
        return;
    }
    p->state = LUME_FRAME_ST_RESYNC;
}

static void release_payload(lume_frame_parser_t *p)
{
    if (p->payload != NULL && p->free_fn != NULL) {
        p->free_fn(p->payload);
    }
    p->payload = NULL;
    p->payload_len = 0;
    p->payload_n = 0;
}

static void reject(lume_frame_parser_t *p, const char *reason, size_t len)
{
    emit(p, LUME_FRAME_EV_ERR, NULL, len, reason);
}

void lume_frame_parser_init(lume_frame_parser_t *p,
                            lume_frame_alloc_fn alloc, lume_frame_free_fn free_fn,
                            lume_frame_event_fn on_event, void *user)
{
    memset(p, 0, sizeof(*p));
    p->state = LUME_FRAME_ST_MAGIC;
    p->alloc = alloc;
    p->free_fn = free_fn;
    p->on_event = on_event;
    p->user = user;
}

void lume_frame_parser_feed(lume_frame_parser_t *p, uint8_t b)
{
    sync_push(p, b);               /* always maintain the rolling window */

    switch (p->state) {
    case LUME_FRAME_ST_MAGIC:
        p->magic[p->magic_n++] = b;
        if (p->magic_n == LUME_FRAME_MAGIC_LEN) {
            p->magic_n = 0;
            if (memcmp(p->magic, LUME_FRAME_CTRL_PAUSE, LUME_FRAME_MAGIC_LEN) == 0) {
                emit(p, LUME_FRAME_EV_PAUSE, NULL, 0, NULL);
                enter_magic(p);
            } else if (memcmp(p->magic, LUME_FRAME_CTRL_RESUME, LUME_FRAME_MAGIC_LEN) == 0) {
                emit(p, LUME_FRAME_EV_RESUME, NULL, 0, NULL);
                enter_magic(p);
            } else if (memcmp(p->magic, LUME_FRAME_CTRL_BACK, LUME_FRAME_MAGIC_LEN) == 0) {
                emit(p, LUME_FRAME_EV_BACK, NULL, 0, NULL);
                enter_magic(p);
            } else if (memcmp(p->magic, LUME_FRAME_MAGIC, LUME_FRAME_MAGIC_LEN) == 0) {
                enter_hdr(p);
            } else {
                reject(p, "bad-magic", 0);
                enter_resync(p);
            }
        }
        break;

    case LUME_FRAME_ST_RESYNC:
        if (sync_is_magic(p)) {
            enter_hdr(p);          /* the 4 magic bytes were just consumed */
        }
        break;

    case LUME_FRAME_ST_HDR:
        p->hdr[p->hdr_n++] = b;
        if (p->hdr_n == LUME_FRAME_LEN_LEN + LUME_FRAME_CRC_LEN) {
            p->hdr_n = 0;
            uint32_t total_len = load_le32(p->hdr);
            p->want_crc = load_le32(p->hdr + LUME_FRAME_LEN_LEN);

            if (total_len == 0) {
                reject(p, "empty", 0);
                enter_resync(p);
            } else if (total_len > LUME_FRAME_MAX_PAYLOAD) {
                reject(p, "too-large", total_len);
                enter_resync(p);
            } else {
                p->payload = p->alloc != NULL ? p->alloc(total_len) : NULL;
                p->payload_len = total_len;
                p->payload_n = 0;
                if (p->payload == NULL) {
                    /* oom: still consume exactly total_len bytes to stay
                     * aligned; NULL payload == discard mode. */
                    reject(p, "oom", total_len);
                }
                p->state = LUME_FRAME_ST_BODY;
            }
        }
        break;

    case LUME_FRAME_ST_BODY:
        if (p->payload != NULL) {
            p->payload[p->payload_n] = b;
        }
        p->payload_n++;
        if (p->payload_n == p->payload_len) {
            if (p->payload == NULL) {
                enter_magic(p);     /* oom discard: error already reported */
                break;
            }
            uint32_t got = lume_frame_crc32(p->payload, p->payload_len);
            if (got != p->want_crc) {
                reject(p, "bad-crc", p->payload_len);
                release_payload(p);
                enter_resync(p);
            } else {
                /* Valid frame. The sink's DATA handler copies the payload into
                 * the engine staging slot; it is valid ONLY during the call. */
                emit(p, LUME_FRAME_EV_DATA, p->payload, p->payload_len, NULL);
                release_payload(p);
                enter_magic(p);
            }
        }
        break;
    }
}

/* ------------------------------------------------------------------ */
/* §2 WiFi-OTA channel helpers                                         */
/* ------------------------------------------------------------------ */
bool lume_ota_auth_parse(const char *line, size_t len, char *out, size_t cap)
{
    const char *prefix = LUME_OTA_AUTH_PREFIX;
    const size_t plen = 5;   /* strlen("AUTH ") */
    if (line == NULL || out == NULL || cap == 0) {
        return false;
    }
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
        len--;
    }
    if (len <= plen || memcmp(line, prefix, plen) != 0) {
        return false;
    }
    size_t tlen = len - plen;
    if (tlen == 0 || tlen >= cap) {
        return false;
    }
    for (size_t i = 0; i < tlen; i++) {
        unsigned char c = (unsigned char)line[plen + i];
        if (c < 0x21 || c > 0x7e) {   /* printable, no space / control / NUL */
            return false;
        }
    }
    memcpy(out, line + plen, tlen);
    out[tlen] = '\0';
    return true;
}

/* Bounded strlen (portable: strnlen needs a feature macro under strict C11). */
static size_t bounded_strlen(const char *s, size_t max)
{
    size_t n = 0;
    while (n < max && s[n] != '\0') {
        n++;
    }
    return n;
}

bool lume_ota_token_equal(const char *a, const char *b)
{
    if (a == NULL || b == NULL) {
        return false;
    }
    /* Both must be exactly 32 chars; this leaks length only (fixed by wire). */
    if (bounded_strlen(a, LUME_OTA_TOKEN_STR_MAX) != LUME_OTA_TOKEN_HEX_LEN ||
        bounded_strlen(b, LUME_OTA_TOKEN_STR_MAX) != LUME_OTA_TOKEN_HEX_LEN) {
        return false;
    }
    unsigned diff = 0;
    for (size_t i = 0; i < LUME_OTA_TOKEN_HEX_LEN; i++) {
        diff |= (unsigned char)a[i] ^ (unsigned char)b[i];
    }
    return diff == 0;
}

int lume_ota_reply(char *buf, size_t cap, bool ok, size_t len,
                   const char *reason)
{
    if (buf == NULL || cap == 0) {
        return -1;
    }
    int n;
    if (ok) {
        n = snprintf(buf, cap, "RELOAD OK %u\n", (unsigned)len);
    } else {
        n = snprintf(buf, cap, "RELOAD ERR %s\n",
                     reason != NULL ? reason : "unknown");
    }
    if (n < 0 || (size_t)n >= cap) {
        return -1;   /* refuse to emit a truncated line */
    }
    return n;
}

bool lume_ota_can_serve(bool wifi_has_ip, bool token_ready)
{
    return wifi_has_ip && token_ready;
}
