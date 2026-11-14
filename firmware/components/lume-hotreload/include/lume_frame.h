#pragma once
/* ------------------------------------------------------------------------
 * lume_frame (r26): the shared push-channel WIRE PROTOCOL.
 *
 * Portable C (C99, no FreeRTOS / ESP-IDF / driver includes) so it can be
 * compiled on the host for the r26 harness (tests/ota_protocol.c) AND linked
 * into the firmware for BOTH push channels:
 *   - USB Serial/JTAG hot-reload (M1, lume_hotreload.c)
 *   - WiFi TCP OTA (r26, also lume_hotreload.c)
 *
 * §1 Data / control frames — EXACTLY the M1 USB wire format. Field-by-field:
 *   offset 0..3   magic = 'L' 'U' 'M' 'E'
 *   offset 4..7   total_len (u32 LE) = PAYLOAD byte count (header excluded)
 *                 0 rejected, > 256 KiB rejected (drop + resync)
 *   offset 8..11  crc32 (u32 LE) = standard CRC-32 over payload only
 *                 (zlib.crc32 / esp_crc32_le(0, payload, len))
 *   offset 12..   payload = JS app SOURCE text (JS_Eval, not bytecode)
 *   At an aligned boundary the four-byte controls "BACK" / "PAUS" / "RESM"
 *   are also accepted (no header, no payload, no response).
 *
 * §1b Command frames (multi-app management) — same 12-byte header layout with
 *   magic = 'L' 'U' 'M' 'C'. The payload is UTF-8 TEXT (not JS source) and is
 *   handed to the portable parser in lume_cmd.h. A command frame is NEVER
 *   evaluated as an app; it is answered with "CMD OK ..." / "CMD ERR ..."
 *   lines instead of "RELOAD ..." lines. Old firmware treats "LUMC" as a bad
 *   magic and re-syncs, so the two frame kinds can share one byte stream.
 *   Streaming parser aligns on "LUME"; on bad magic / empty / too-large / OOM /
 *   bad CRC it emits an ERR event and re-syncs on the next "LUME". There is NO
 *   frame timeout. Both channels feed byte streams into their OWN reentrant
 *   parser instance, so the exact same parse logic decides both links.
 *
 * §2 WiFi-OTA channel helpers (auth handshake, reply lines, listener gate) —
 *   also portable so the harness can assert token auth (right/wrong token) and
 *   "WiFi not connected -> refuse to start" without a board.
 *
 * The engine hot-replacement chain (lume_engine_request_reload + the single
 * result callback) is owned by lume_hotreload.c, NOT here.
 * ------------------------------------------------------------------------ */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* ---- §1 data / control frames ---- */
#define LUME_FRAME_MAGIC          "LUME"
#define LUME_FRAME_MAGIC_LEN      4
#define LUME_FRAME_LEN_LEN        4
#define LUME_FRAME_CRC_LEN        4
#define LUME_FRAME_HDR_LEN        (LUME_FRAME_MAGIC_LEN + LUME_FRAME_LEN_LEN + LUME_FRAME_CRC_LEN) /* 12 */
#define LUME_FRAME_MAX_PAYLOAD    (256u * 1024u)
#define LUME_FRAME_CTRL_BACK      "BACK"
#define LUME_FRAME_CTRL_PAUSE     "PAUS"
#define LUME_FRAME_CTRL_RESUME    "RESM"

/* ---- §1b command frames (multi-app management) ---- */
#define LUME_FRAME_CMD_MAGIC      "LUMC"

/* Standard CRC-32 (reflected poly 0xEDB88320), identical to zlib.crc32 and
 * esp_crc32_le(0, ...). Verified by the "123456789" -> 0xcbf43926 vector. */
uint32_t lume_frame_crc32(const uint8_t *data, size_t len);

/* Build a frame. Returns total byte count (>= 12), or 0 on invalid args /
 * insufficient capacity. Used by the harness; the device only decodes. */
size_t lume_frame_encode(uint8_t *out, size_t out_cap,
                         const uint8_t *payload, size_t len);

/* Same header/CRC, magic "LUMC": payload is UTF-8 command text (lume_cmd.h). */
size_t lume_frame_encode_cmd(uint8_t *out, size_t out_cap,
                             const uint8_t *payload, size_t len);

typedef enum {
    LUME_FRAME_EV_DATA = 1,   /* validated frame; payload valid DURING cb only */
    LUME_FRAME_EV_BACK,
    LUME_FRAME_EV_PAUSE,
    LUME_FRAME_EV_RESUME,
    LUME_FRAME_EV_ERR,        /* reason: bad-magic/empty/too-large/oom/bad-crc */
    LUME_FRAME_EV_CMD,        /* "LUMC" frame; payload valid DURING cb only */
} lume_frame_ev_t;

typedef void *(*lume_frame_alloc_fn)(size_t len);
typedef void  (*lume_frame_free_fn)(void *ptr);
typedef void  (*lume_frame_event_fn)(lume_frame_ev_t ev,
                                     const uint8_t *payload, size_t len,
                                     const char *reason, void *user);

typedef enum {
    LUME_FRAME_ST_MAGIC = 0,
    LUME_FRAME_ST_HDR,
    LUME_FRAME_ST_BODY,
    LUME_FRAME_ST_RESYNC,
} lume_frame_state_t;

typedef struct {
    lume_frame_state_t state;
    uint8_t  magic[LUME_FRAME_MAGIC_LEN];
    int      magic_n;
    bool     is_cmd;                       /* header came from "LUMC" */
    uint8_t  hdr[LUME_FRAME_LEN_LEN + LUME_FRAME_CRC_LEN];
    int      hdr_n;
    uint8_t  sync[LUME_FRAME_MAGIC_LEN];   /* rolling window, ALL states */
    int      sync_n;
    uint8_t *payload;                      /* alloc'd staging buffer */
    size_t   payload_len;
    size_t   payload_n;
    uint32_t want_crc;
    lume_frame_alloc_fn alloc;
    lume_frame_free_fn  free_fn;
    lume_frame_event_fn on_event;
    void    *user;                         /* per-stream reply sink */
} lume_frame_parser_t;

void lume_frame_parser_init(lume_frame_parser_t *p,
                            lume_frame_alloc_fn alloc, lume_frame_free_fn free_fn,
                            lume_frame_event_fn on_event, void *user);
/* Feed ONE byte. Emits at most one event per completed unit. */
void lume_frame_parser_feed(lume_frame_parser_t *p, uint8_t byte);

/* ---- §2 WiFi-OTA channel helpers ---- */
/* Token = 16 random bytes hex-encoded = 32 lowercase hex chars + NUL. */
#define LUME_OTA_TOKEN_HEX_LEN    32
#define LUME_OTA_TOKEN_STR_MAX    (LUME_OTA_TOKEN_HEX_LEN + 1)   /* 33 */
#define LUME_OTA_AUTH_PREFIX      "AUTH "
#define LUME_OTA_AUTH_LINE_MAX    128
#define LUME_OTA_REPLY_MAX        64

/* Parse "AUTH <token>\n" (CR/LF optional) into `out`. Returns false on a
 * malformed / overlong / non-printable token. `len` is the line byte count. */
bool lume_ota_auth_parse(const char *line, size_t len, char *out, size_t cap);

/* Constant-time comparison of two 32-hex-char tokens (length-checked). */
bool lume_ota_token_equal(const char *a, const char *b);

/* Format "RELOAD OK <len>\n" or "RELOAD ERR <reason>\n" (same line the USB
 * channel emits). Returns byte count, or -1 if the buffer is too small. */
int lume_ota_reply(char *buf, size_t cap, bool ok, size_t len,
                   const char *reason);

/* The OTA listener gate: bind ONLY when WiFi has an IP and a token is ready.
 * WiFi-not-connected => false => "refuse to start". Host-harness tested. */
bool lume_ota_can_serve(bool wifi_has_ip, bool token_ready);
