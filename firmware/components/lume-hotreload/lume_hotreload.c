/**
 * lume-hotreload (r26): JS app PUSH CHANNELS.
 *
 *   (1) USB Serial/JTAG (USB CDC) — M1. Same physical port as the ESP console
 *       (CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y); the CLI filters "RELOAD " lines.
 *   (2) WiFi TCP OTA — r26. Authenticated TCP server on port 8765 (Kconfig
 *       CONFIG_LUME_OTA_PORT), bound ONLY while the WiFi station has an IPv4.
 *
 * Both channels feed their byte stream into a PRIVATE instance of the SAME
 * portable frame codec (lume_frame.c) and both push through the SAME engine
 * hot-replacement chain (lume_engine_request_reload + the single result cb).
 * See include/lume_frame.h for the exact wire format (magic/len/crc/payload +
 * BACK/PAUS/RESM). This file owns ONLY transport, auth, reply routing.
 *
 * Reply routing (why a FIFO): the engine has exactly ONE reload-result
 * callback but two channels. Each accepted DATA frame pushes its reply sink
 * onto a small FIFO BEFORE calling lume_engine_request_reload(); the result cb
 * pops the head. The engine's staging slot is single/last-wins, so a frame
 * that is superseded emits its "superseded" ERR synchronously (inside
 * request_reload) — the FIFO pop order still matches that frame's sink. A
 * recursive mutex is held across request_reload() so the synchronous cb can
 * re-enter it and concurrent pushes cannot interleave with a tail-drop.
 *
 * Token: 16 bytes from esp_fill_random(), hex-encoded, persisted in NVS
 * ("lume_ota"/"token"), logged at boot. NEVER hard-coded. If NVS is
 * unavailable the channel still works with an ephemeral per-boot token.
 *
 * ESP-IDF v5.5.5 API evidence (verified before coding, not assumed):
 *   - driver/usb_serial_jtag.h + _vfs.h : install/read/write/is_driver_installed
 *     / vfs_use_driver (unchanged M1 path).
 *   - esp_heap_caps.h           : heap_caps_malloc(MALLOC_CAP_SPIRAM)/free
 *   - esp_random.h              : esp_fill_random(void*, size_t) (:43)
 *   - nvs_flash.h / nvs.h       : nvs_flash_init (idempotent + Lock-guarded,
 *     nvs_api.cpp:124-135), nvs_open/get_str/set_str/commit/close
 *   - lwip/sockets.h            : socket/bind/listen/select/accept/recv/send/
 *     setsockopt(SO_RCVTIMEO/SO_SNDTIMEO)/close, fd_set, struct sockaddr_in
 *   - lume_net.h                : lume_net_has_ip() (spinlock-guarded, callable
 *     from any task) gates the listener.
 *   - lume_engine.h             : request_reload, set_reload_result_cb,
 *     post_back/post_lifecycle, set_ota_status_provider.
 */
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>          /* malloc/free for CMD reply lines */
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "lwip/sockets.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "mbedtls/base64.h"
#include "mbedtls/md.h"
#include "lume_engine.h"
#include "lume_net.h"
#include "lume_hotreload.h"
#include "lume_frame.h"
#include "lume_cmd.h"
#include "lume_apps.h"
#include "lume_board.h"
#include "lume_fs.h"
#include "lume_sd.h"
#include "esp_littlefs.h"

static const char *TAG     = "lume-hotreload";
static const char *OTA_TAG = "lume-ota";

#ifndef CONFIG_LUME_OTA_PORT
#define CONFIG_LUME_OTA_PORT 8765
#endif
#define OTA_PORT           CONFIG_LUME_OTA_PORT
/* Both RX tasks run the command parser (STORE/LIST/...) and LittleFS calls,
 * not just memcpy, so they need more than the frame-copy footprint. */
#define OTA_TASK_STACK     8192
#define OTA_IO_TIMEOUT_S   5
#define OTA_RECV_CHUNK     512
#define OTA_BACKLOG        1
#define USB_RX_STACK            8192
#define USB_RX_PRIO             6     /* > lume-lvgl/lume-js (5) to drain USJ RX ring */
#define USB_RX_CHUNK            256
#define USB_RX_READ_MS          20
#define USB_RX_FRAME_TIMEOUT_MS 1000  /* abort stalled mid-frame RX and free staging */
#define USJ_RX_BUFFER           4096  /* driver requires > 64; 4 KiB absorbs USB bursts */
#define USJ_TX_BUFFER           2048  /* r223: holds ~6 x 325 B S64 lines; avoids TX stalls */

#define PENDING_MAX        16     /* bounded outstanding reloads */

/* ================================================================== */
/* Reply sinks + the single engine result callback                     */
/* ================================================================== */
typedef enum { REPLY_USB, REPLY_TCP } reply_kind_t;
typedef struct {
    reply_kind_t kind;
    int          sock;      /* REPLY_TCP only */
} reply_sink_t;

static reply_sink_t        s_usb_sink = { REPLY_USB, -1 };
static SemaphoreHandle_t   s_tx_mutex;       /* serializes ALL reply writes */
static SemaphoreHandle_t   s_pending_mutex;  /* RECURSIVE: guards the FIFO */

/* Pending-result FIFO (ring). Head = oldest sink = next result to report. */
static reply_sink_t s_pending[PENDING_MAX];
static int          s_pending_head;
static int          s_pending_count;

static bool pending_push(reply_sink_t s)   /* caller holds s_pending_mutex */
{
    if (s_pending_count >= PENDING_MAX) return false;
    s_pending[(s_pending_head + s_pending_count) % PENDING_MAX] = s;
    s_pending_count++;
    return true;
}
static bool pending_pop(reply_sink_t *out) /* caller holds s_pending_mutex */
{
    if (s_pending_count == 0) return false;
    *out = s_pending[s_pending_head];
    s_pending_head = (s_pending_head + 1) % PENDING_MAX;
    s_pending_count--;
    return true;
}
static void pending_drop_tail(void)        /* caller holds s_pending_mutex */
{
    if (s_pending_count > 0) s_pending_count--;
}

static int usb_tx_write_op(const uint8_t *buf, size_t len, void *user)
{
    (void)user;
    return usb_serial_jtag_write_bytes(buf, len, pdMS_TO_TICKS(LUME_TX_USB_WRITE_MS));
}

static bool usb_tx_drain_op(void *user)
{
    (void)user;
    return usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(LUME_TX_USB_DRAIN_MS)) == ESP_OK;
}

static void usb_tx_delay_op(void *user)
{
    (void)user;
    vTaskDelay(pdMS_TO_TICKS(LUME_TX_USB_RETRY_DELAY_MS));
}

static int tcp_tx_write_op(const uint8_t *buf, size_t len, void *user)
{
    int sock = *(const int *)user;
    int w = send(sock, buf, len, 0);
    if (w > 0) return w;
    if (w < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) {
        return 0;   /* retryable */
    }
    return -1;      /* fatal socket error or peer closed */
}

static bool reply_write(reply_sink_t sink, const char *line, size_t n)
{
    if (n == 0) return true;
    xSemaphoreTake(s_tx_mutex, portMAX_DELAY);
    bool ok;
    if (sink.kind == REPLY_USB) {
        lume_tx_ops_t ops = {
            .write = usb_tx_write_op,
            .drain = usb_tx_drain_op,
            .delay = usb_tx_delay_op,
            .user  = NULL,
        };
        ok = lume_tx_write_retry((const uint8_t *)line, n,
                                 LUME_TX_USB_MAX_RETRIES, &ops);
        if (!ok) {
            ESP_LOGE(TAG, "USB reply TX failed after retries (%u bytes)", (unsigned)n);
        }
    } else {
        int sock = sink.sock;
        lume_tx_ops_t ops = {
            .write = tcp_tx_write_op,
            .drain = NULL,
            .delay = usb_tx_delay_op,
            .user  = &sock,
        };
        ok = lume_tx_write_retry((const uint8_t *)line, n,
                                 LUME_TX_TCP_MAX_RETRIES, &ops);
        if (!ok) {
            ESP_LOGE(OTA_TAG, "TCP reply TX failed (%u bytes, errno %d)",
                     (unsigned)n, errno);
        }
    }
    xSemaphoreGive(s_tx_mutex);
    return ok;
}

/* Shared by BOTH channels: the exact "RELOAD OK/ERR" line of the M1 protocol. */
static void reply_line(reply_sink_t sink, bool ok, size_t len,
                       const char *reason)
{
    char line[LUME_OTA_REPLY_MAX];
    int n = lume_ota_reply(line, sizeof(line), ok, len, reason);
    if (n > 0) reply_write(sink, line, (size_t)n);
}

/* The engine's ONE reload-result callback (also called synchronously for a
 * "superseded" frame from inside request_reload, on the pushing task). */
static void on_engine_result(bool ok, size_t len, const char *reason)
{
    reply_sink_t sink;
    xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
    bool have = pending_pop(&sink);
    xSemaphoreGiveRecursive(s_pending_mutex);
    if (!have) {
        ESP_LOGW(TAG, "reload result with no pending sink (dropped)");
        return;
    }
    reply_line(sink, ok, len, reason);
}

/* ================================================================== */
/* REPL reply routing (r115)                                           */
/* ================================================================== */
/* In-flight REPL requests are keyed by an opaque token so the engine-task
 * result callback can find the original channel/socket. One socket at a time
 * on TCP and a serialized CLI keep the working set tiny; the table is bounded
 * so a stuck reply can never grow memory without limit. Guarded by the same
 * recursive mutex as the reload FIFO. */
#define REPL_SLOTS 8
typedef struct { reply_sink_t sink; uint32_t token; bool used; } repl_slot_t;
static repl_slot_t s_repl_slots[REPL_SLOTS];
static uint32_t    s_repl_token_next = 1;   /* 0 is reserved: "no token" */

/* caller holds s_pending_mutex */
static uint32_t repl_slot_alloc(reply_sink_t sink, bool *ok)
{
    for (int i = 0; i < REPL_SLOTS; i++) {
        if (!s_repl_slots[i].used) {
            s_repl_slots[i].used = true;
            s_repl_slots[i].sink = sink;
            uint32_t tok = s_repl_token_next++;
            if (tok == 0) tok = s_repl_token_next++;   /* skip reserved 0 */
            s_repl_slots[i].token = tok;
            *ok = true;
            return tok;
        }
    }
    *ok = false;
    return 0;
}
static bool repl_slot_take(uint32_t token, reply_sink_t *out) /* caller holds mutex */
{
    for (int i = 0; i < REPL_SLOTS; i++) {
        if (s_repl_slots[i].used && s_repl_slots[i].token == token) {
            if (out != NULL) *out = s_repl_slots[i].sink;
            s_repl_slots[i].used = false;
            s_repl_slots[i].token = 0;
            return true;
        }
    }
    return false;
}

/* REPL reply grammar (single logical reply, several reply_write() calls):
 *   "REPL <OK|ERR> <rawlen> <trunc>\n"   header (rawlen = bytes after clamp)
 *   "R64<base64, 320 chars per 240 raw bytes>\n"   data lines (0..N)
 *   "REPL END\n"                          footer
 * Base64 keeps arbitrary JS strings (newlines / NULs) single-line-safe, and
 * the 240-byte chunk mirrors the proven SHOT reply path. Output is bounded by
 * lume_repl_clamp(); trunc=1 tells the CLI to print a truncation marker.
 * Device log lines may interleave BETWEEN our lines; the CLI skips them. */
#define REPL_B64_CHUNK 240
static void repl_reply(reply_sink_t sink, bool ok, const char *text, size_t len)
{
    char out[LUME_REPL_OUT_CAP + 1];
    bool truncated = false;
    size_t n = lume_repl_clamp(text, len, out, LUME_REPL_OUT_CAP, &truncated);

    char hdr[48];
    int hn = snprintf(hdr, sizeof(hdr), "REPL %s %u %u\n",
                      ok ? "OK" : "ERR", (unsigned)n, truncated ? 1u : 0u);
    if (hn <= 0 || (size_t)hn >= sizeof(hdr)) return;
    reply_write(sink, hdr, (size_t)hn);

    unsigned char b64[REPL_B64_CHUNK / 3 * 4 + 4];
    for (size_t off = 0; off < n; off += REPL_B64_CHUNK) {
        size_t chunk = n - off < REPL_B64_CHUNK ? n - off : REPL_B64_CHUNK;
        size_t olen = 0;
        if (mbedtls_base64_encode(b64, sizeof(b64), &olen,
                                  (const unsigned char *)out + off, chunk) != 0) {
            ESP_LOGE(TAG, "REPL reply base64 encode failed");
            return;
        }
        memmove(b64 + 3, b64, olen);   /* prepend "R64" sentinel */
        b64[0] = 'R'; b64[1] = '6'; b64[2] = '4';
        b64[olen + 3] = '\n';
        reply_write(sink, (const char *)b64, olen + 4);
    }
    reply_write(sink, "REPL END\n", 9);
}

/* Called ON the engine task (see lume_engine.h). Must stay quick: it resolves
 * the sink and writes preformatted text, no engine work. */
static void on_repl_result(bool ok, const char *text, size_t len, uint32_t token)
{
    reply_sink_t sink;
    xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
    bool have = repl_slot_take(token, &sink);
    xSemaphoreGiveRecursive(s_pending_mutex);
    if (!have) {
        ESP_LOGW(TAG, "REPL result with no slot (token %u dropped)",
                 (unsigned)token);
        return;
    }
    repl_reply(sink, ok, text, len);
}

/* ================================================================== */
/* Command channel (r30 multi-app)                                     */
/* ================================================================== */
/* Reply lines (one per command, always on the pushing channel):
 *   "CMD OK store <id> <len>\n"     app installed / replaced
 *   "CMD OK remove <id>\n"
 *   "CMD OK list <count>\n"         preceded by one block per app:
 *   "APP\t<id>\nMETA\t<id>\t<json>\n"
 *   "CMD ERR <reason>\n"            reason: arg/verb/id/format/empty/
 *                                   store/notfound/busy/fs/stage-oom
 * LAUNCH / HOME are answered with the engine's own "RELOAD OK/ERR" line,
 * because the outcome is only known after the new app has been evaluated. */
static void cmd_reply(reply_sink_t sink, bool ok, const char *verb,
                      const char *id, size_t len, const char *reason)
{
    char line[LUME_OTA_REPLY_MAX];
    int n;
    if (!ok) {
        n = snprintf(line, sizeof(line), "CMD ERR %s\n",
                     reason != NULL ? reason : "cmd");
    } else if (verb != NULL && id != NULL && len > 0) {
        n = snprintf(line, sizeof(line), "CMD OK %s %s %u\n", verb, id,
                     (unsigned)len);
    } else if (verb != NULL && id != NULL) {
        n = snprintf(line, sizeof(line), "CMD OK %s %s\n", verb, id);
    } else if (verb != NULL) {
        n = snprintf(line, sizeof(line), "CMD OK %s\n", verb);
    } else {
        n = snprintf(line, sizeof(line), "CMD OK\n");
    }
    if (n > 0 && (size_t)n < sizeof(line)) {
        reply_write(sink, line, (size_t)n);
    }
}

typedef struct {
    reply_sink_t sink;
    int          count;
} list_reply_t;

/* ---- Screen capture reply (SHOT command, r35) ----
 * Debug screenshot: captures one full-frame RGB565 snapshot (lume_board.h)
 * and streams it back as TEXT lines on the pushing channel, so the same
 * reply path works for USB (log lines may interleave BETWEEN our lines) and
 * TCP. Grammar, one line per reply_write():
 *   SHOT <w> <h> <bytes> <crc32-8hex>\n   header (always first)
 *   S64<base64, 320 chars per 240 raw bytes>\n   data lines
 *   SHOT OK\n                             footer
 * or a single "CMD ERR <reason>\n" line with reason shot-busy / shot-oom /
 * shot-timeout / shot-failed / shot-encode. The payload is little-endian
 * row-major RGB565 (pre-swap flush copy), w*h*2 bytes, no stride padding.
 * The CLI collects S64 lines between the header and the footer and verifies
 * the CRC — interleaved device log lines are simply skipped. */
#define SHOT_TIMEOUT_MS   5000

/* r223: lock-free vprintf sink installed only while streaming a USB SHOT reply.
 * Suppressing ESP_LOG* during the ~622 KiB burst eliminates both VFS per-char
 * tx_mux contention and partial log prefixes sticking to S64 / SHOT lines. */
static int shot_quiet_vprintf(const char *fmt, va_list args)
{
    (void)fmt;
    (void)args;
    return 0;
}

static bool shot_write_line_op(const char *line, size_t len, void *user)
{
    reply_sink_t sink = *(const reply_sink_t *)user;
    return reply_write(sink, line, len);
}

static void handle_shot(reply_sink_t sink)
{
    SemaphoreHandle_t done = xSemaphoreCreateBinary();
    if (done == NULL) {
        cmd_reply(sink, false, NULL, NULL, 0, "shot-oom");
        return;
    }
    uint16_t w = 0, h = 0;
    esp_err_t r = lume_display_capture(done, &w, &h);
    if (r != ESP_OK) {
        vSemaphoreDelete(done);
        cmd_reply(sink, false, NULL, NULL, 0,
                  r == ESP_ERR_NO_MEM ? "shot-oom" : "shot-busy");
        return;
    }
    /* A paused display finishes the capture only after wake; a bounded wait
     * + cancel keeps the rx task responsive. */
    if (xSemaphoreTake(done, pdMS_TO_TICKS(SHOT_TIMEOUT_MS)) != pdTRUE) {
        lume_display_capture_cancel();
        vSemaphoreDelete(done);
        cmd_reply(sink, false, NULL, NULL, 0, "shot-timeout");
        return;
    }
    vSemaphoreDelete(done);

    uint16_t bw = 0, bh = 0;
    const uint8_t *frame = lume_display_capture_buf(&bw, &bh);
    const size_t total = (size_t)bw * bh * 2;
    if (frame == NULL || total == 0) {
        cmd_reply(sink, false, NULL, NULL, 0, "shot-failed");
        return;
    }

    vprintf_like_t prev_vprintf = NULL;
    if (sink.kind == REPLY_USB) {
        prev_vprintf = esp_log_set_vprintf(shot_quiet_vprintf);
        /* Let any already-in-flight VFS log line finish draining first. */
        (void)usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(LUME_TX_USB_DRAIN_MS));
    }

    lume_shot_ops_t ops = {
        .write_line = shot_write_line_op,
        .crc32      = lume_frame_crc32,
        .b64_encode = mbedtls_base64_encode,
        .user       = &sink,
    };
    size_t failed_off = 0;
    lume_shot_status_t st = lume_shot_stream(frame, bw, bh, &ops, &failed_off);

    if (sink.kind == REPLY_USB && prev_vprintf != NULL) {
        esp_log_set_vprintf(prev_vprintf);
    }

    if (st != LUME_SHOT_OK) {
        ESP_LOGE(TAG, "SHOT stream aborted (status=%d at %u/%u bytes)",
                 (int)st, (unsigned)failed_off, (unsigned)total);
    }
}

static void list_emit(void *arg, const char *id)
{
    list_reply_t *l = (list_reply_t *)arg;
    char *meta = NULL;
    size_t meta_len = 0;
    if (lume_apps_meta_read(id, &meta, &meta_len) == 0) {
        for (size_t i = 0; i < meta_len; i++) {
            if (meta[i] == '\n' || meta[i] == '\r' || meta[i] == '\t') {
                meta[i] = ' ';
            }
        }
    }
    const size_t need = strlen(id) * 2 + meta_len + 32;
    char *out = malloc(need);
    if (out != NULL) {
        int n = snprintf(out, need, "APP\t%s\nMETA\t%s\t%s\n", id, id,
                         meta != NULL ? meta : "");
        /* meta_len is not NUL-terminated when the file has no trailing NUL;
         * lume_apps_meta_read always NUL-terminates via the PSRAM reader. */
        if (n > 0 && (size_t)n < need) {
            reply_write(l->sink, out, (size_t)n);
        }
        free(out);
    }
    if (meta != NULL) {
        heap_caps_free(meta);
    }
    l->count++;
}

/* r173 file commands share the authenticated LUMC channel. The portable
 * parser has already rejected traversal and bounded the path and counters. */
static bool file_vfs_path(const lume_cmd_t *cmd, char *out, size_t cap,
                          bool *sd)
{
    *sd = memcmp(cmd->file_path, "sd:", 3) == 0;
    if (*sd ? lume_sd_init() != 0 : !lume_fs_mounted()) return false;
    const char *rel = cmd->file_path + 3;
    int n = snprintf(out, cap, "%s%s%s", *sd ? "/lume_sd" : "/lume_fs",
                     *rel == '/' ? "" : "/", rel);
    return n > 0 && (size_t)n < cap;
}

static void file_reply_number(reply_sink_t sink, const char *verb, size_t value)
{
    char line[48];
    int n = snprintf(line, sizeof(line), "CMD OK %s %u\n", verb,
                     (unsigned)value);
    if (n > 0 && (size_t)n < sizeof(line)) reply_write(sink, line, (size_t)n);
}

static void file_reply_bytes(reply_sink_t sink, const char *bytes, size_t len)
{
    /* USB driver TX buffer is 512 bytes; split long JSON lines at transport
     * level without inserting a newline. */
    for (size_t i = 0; i < len; i += 240) {
        size_t n = len - i < 240 ? len - i : 240;
        reply_write(sink, bytes + i, n);
    }
}

static void handle_file_cmd(reply_sink_t sink, const lume_cmd_t *cmd)
{
    char path[sizeof("/lume_fs") + LUME_CMD_FILE_PATH_MAX + 2];
    bool sd;
    if (!file_vfs_path(cmd, path, sizeof(path), &sd)) {
        cmd_reply(sink, false, NULL, NULL, 0, "mount");
        return;
    }
    if (cmd->kind == LUME_CMD_FPUT) {
        struct stat st;
        if (cmd->offset && (stat(path, &st) != 0 || !S_ISREG(st.st_mode) ||
                            st.st_size != (off_t)cmd->offset)) {
            cmd_reply(sink, false, NULL, NULL, 0, "offset"); return;
        }
        if (cmd->offset == 0 && stat(path, &st) == 0 && !S_ISREG(st.st_mode)) {
            cmd_reply(sink, false, NULL, NULL, 0, "path"); return;
        }
        if (!sd) {
            size_t total = 0, used = 0;
            if (esp_littlefs_info("storage", &total, &used) != ESP_OK ||
                total < used || total - used <= 16384u + cmd->data_len) {
                cmd_reply(sink, false, NULL, NULL, 0, "space"); return;
            }
        }
        FILE *f = fopen(path, cmd->offset ? "ab" : "wb");
        if (!f) { cmd_reply(sink, false, NULL, NULL, 0, "fs"); return; }
        bool ok = fwrite(cmd->data, 1, cmd->data_len, f) == cmd->data_len;
        if (fclose(f) != 0) ok = false;
        if (!ok || stat(path, &st) != 0 ||
            st.st_size != (off_t)(cmd->offset + cmd->data_len)) {
            cmd_reply(sink, false, NULL, NULL, 0, "fs"); return;
        }
        file_reply_number(sink, "fput", (size_t)st.st_size);
        return;
    }
    if (cmd->kind == LUME_CMD_FDEL) {
        struct stat st;
        if (stat(path, &st) != 0) {
            cmd_reply(sink, false, NULL, NULL, 0, "notfound"); return;
        }
        /* FDEL handles files only. Directory deletion remains explicit in the
         * storage APIs, so nonempty directories cannot be removed by accident. */
        if (!S_ISREG(st.st_mode) || unlink(path) != 0) {
            cmd_reply(sink, false, NULL, NULL, 0, "fs"); return;
        }
        cmd_reply(sink, true, "fdel", NULL, 0, NULL);
        return;
    }
    if (cmd->kind == LUME_CMD_FGET) {
        FILE *f = fopen(path, "rb");
        if (!f) { cmd_reply(sink, false, NULL, NULL, 0, "notfound"); return; }
        uint8_t raw[768];
        bool ok = fseek(f, (long)cmd->offset, SEEK_SET) == 0;
        size_t n = ok ? fread(raw, 1, cmd->total, f) : 0;
        if (ferror(f)) ok = false;
        if (fclose(f) != 0) ok = false;
        if (!ok) { cmd_reply(sink, false, NULL, NULL, 0, "fs"); return; }
        unsigned char b64[1028]; size_t encoded = 0;
        if (mbedtls_base64_encode(b64, sizeof(b64), &encoded, raw, n) != 0) {
            cmd_reply(sink, false, NULL, NULL, 0, "encode"); return;
        }
        file_reply_bytes(sink, "F64", 3);
        file_reply_bytes(sink, (const char *)b64, encoded);
        file_reply_bytes(sink, "\n", 1);
        file_reply_number(sink, "fget", n);
        return;
    }
    DIR *dir = opendir(path);
    if (!dir) { cmd_reply(sink, false, NULL, NULL, 0, "fs"); return; }
    /* One JSON array line. Entry names are escaped; cap output so a large
     * directory fails explicitly rather than emitting a partial listing. */
    char *json = malloc(16384);
    if (!json) { closedir(dir); cmd_reply(sink, false, NULL, NULL, 0, "oom"); return; }
    size_t pos = 0; int count = 0; bool ok = true;
    json[pos++] = '[';
    struct dirent *ent;
    while ((ent = readdir(dir))) {
        if (!strcmp(ent->d_name, ".") || !strcmp(ent->d_name, "..")) continue;
        char child[sizeof(path) + 256];
        int cn = snprintf(child, sizeof(child), "%s%s%s", path,
                          path[strlen(path) - 1] == '/' ? "" : "/", ent->d_name);
        struct stat st;
        if (cn <= 0 || (size_t)cn >= sizeof(child) || stat(child, &st) != 0) { ok = false; break; }
        int head = snprintf(json + pos, 16384 - pos, "%s{\"name\":\"", count ? "," : "");
        if (head < 0 || (size_t)head >= 16384 - pos) { ok = false; break; }
        pos += (size_t)head;
        for (const unsigned char *p = (const unsigned char *)ent->d_name; *p; p++) {
            if (pos + 8 >= 16384) { ok = false; break; }
            if (*p == '"' || *p == '\\') json[pos++] = '\\';
            if (*p < 32) { pos += (size_t)snprintf(json + pos, 16384 - pos, "\\u%04x", *p); }
            else json[pos++] = (char)*p;
        }
        if (!ok) break;
        int tail = snprintf(json + pos, 16384 - pos, "\",\"size\":%u,\"dir\":%s}",
                            (unsigned)(S_ISDIR(st.st_mode) ? 0 : st.st_size),
                            S_ISDIR(st.st_mode) ? "true" : "false");
        if (tail < 0 || (size_t)tail >= 16384 - pos) { ok = false; break; }
        pos += (size_t)tail; count++;
        if (pos + 2 >= 16384) { ok = false; break; }
    }
    closedir(dir);
    if (!ok) { free(json); cmd_reply(sink, false, NULL, NULL, 0, "listing"); return; }
    json[pos++] = ']';
    /* Each transport write is one complete, independently tagged line. Logs
     * may interleave between lines; the CLI concatenates only FLS fragments. */
    for (size_t off = 0; off < pos; off += 200) {
        size_t n = pos - off < 200 ? pos - off : 200;
        char line[205];
        memcpy(line, "FLS\t", 4);
        memcpy(line + 4, json + off, n);
        line[n + 4] = '\n';
        reply_write(sink, line, n + 5);
    }
    free(json);
    file_reply_number(sink, "fls", count);
}

static void handle_cmd(reply_sink_t sink, const uint8_t *payload, size_t len)
{
    lume_cmd_t cmd;
    int r = lume_cmd_parse(payload, len, &cmd);
    if (r != LUME_CMD_OK) {
        cmd_reply(sink, false, NULL, NULL, 0, lume_cmd_reason(r));
        return;
    }
    switch (cmd.kind) {
    case LUME_CMD_FPUT:
    case LUME_CMD_FLS:
    case LUME_CMD_FDEL:
    case LUME_CMD_FGET:
        xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
        handle_file_cmd(sink, &cmd);
        xSemaphoreGiveRecursive(s_pending_mutex);
        break;
    case LUME_CMD_STORE: {
        int s = lume_apps_store(cmd.id, cmd.meta, cmd.meta_len,
                                cmd.src, cmd.src_len);
        if (s < 0) {
            ESP_LOGW(TAG, "STORE '%s' failed (%d)", cmd.id, s);
            cmd_reply(sink, false, NULL, NULL, 0, "store");
        } else {
            cmd_reply(sink, true, "store", cmd.id, cmd.src_len, NULL);
        }
        break;
    }
    case LUME_CMD_REMOVE: {
        int s = lume_apps_remove(cmd.id);
        if (s == LUME_APPS_ERR_NOTFOUND) {
            cmd_reply(sink, false, NULL, NULL, 0, "notfound");
        } else if (s == LUME_APPS_ERR_BUSY) {
            cmd_reply(sink, false, NULL, NULL, 0, "busy");
        } else if (s < 0) {
            cmd_reply(sink, false, NULL, NULL, 0, "fs");
        } else {
            cmd_reply(sink, true, "remove", cmd.id, 0, NULL);
        }
        break;
    }
    case LUME_CMD_META: {
        char *meta = NULL;
        size_t meta_len = 0;
        int s = lume_apps_meta_read(cmd.id, &meta, &meta_len);
        if (s < 0) {
            cmd_reply(sink, false, NULL, NULL, 0,
                      s == LUME_APPS_ERR_NOTFOUND ? "notfound" : "fs");
            break;
        }
        const size_t need = strlen(cmd.id) + meta_len + 32;
        char *out = malloc(need);
        if (out != NULL) {
            int n = snprintf(out, need, "META\t%s\t%s\n", cmd.id, meta);
            if (n > 0 && (size_t)n < need) {
                reply_write(sink, out, (size_t)n);
            }
            free(out);
            cmd_reply(sink, true, "meta", cmd.id, 0, NULL);
        } else {
            cmd_reply(sink, false, NULL, NULL, 0, "oom");
        }
        heap_caps_free(meta);
        break;
    }
    case LUME_CMD_LIST: {
        list_reply_t l = { sink, 0 };
        int n = lume_apps_list(list_emit, &l);
        if (n < 0) {
            cmd_reply(sink, false, NULL, NULL, 0, "fs");
        } else {
            char line[LUME_OTA_REPLY_MAX];
            int w = snprintf(line, sizeof(line), "CMD OK list %d\n", l.count);
            if (w > 0 && (size_t)w < sizeof(line)) {
                reply_write(sink, line, (size_t)w);
            }
        }
        break;
    }
    case LUME_CMD_LAUNCH:
    case LUME_CMD_HOME: {
        /* The eval result arrives asynchronously: register this channel as
         * the reply sink, then ask the engine to switch. */
        const char *target = cmd.kind == LUME_CMD_HOME ? "" : cmd.id;
        xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
        bool pushed = pending_push(sink);
        int s = pushed ? lume_engine_request_launch_reply(target) : -1;
        if (s != 0) {
            pending_drop_tail();
        }
        xSemaphoreGiveRecursive(s_pending_mutex);
        if (s != 0) {
            reply_line(sink, false, 0,
                       s == LUME_APPS_ERR_FWTAG ? "fwt-mismatch" : "stage-oom");
        }
        break;
    }
    case LUME_CMD_FWTAG: {
        /* r106: report the running firmware's API tag so the CLI can stamp
         * meta.json with the value this firmware will accept at launch. */
        char t[24];
        int n = snprintf(t, sizeof(t), "%lu", LUME_API_TAG);
        cmd_reply(sink, true, "fwt", n > 0 ? t : "", 0, NULL);
        break;
    }
    case LUME_CMD_SHOT:
        handle_shot(sink);
        break;
    case LUME_CMD_VER: {
        /* r43b: the CLI asks for the engine version before pushing bytecode;
         * a mismatch is rejected locally so a stale qjsc blob never reaches
         * JS_ReadObject(). Source pushes never issue VER (old firmware safe). */
        char v[32];
        lume_engine_version(v, sizeof(v));
        cmd_reply(sink, true, "ver", v, 0, NULL);
        break;
    }
    case LUME_CMD_TOKEN: {
        /* r96: serial-CLI token set. Never echo the token in the reply. */
        int s = lume_ota_token_set(cmd.token, strlen(cmd.token));
        cmd_reply(sink, s == 0, s == 0 ? "token" : NULL,
                  s == 0 ? "ok" : NULL, 0,
                  s < 0 ? (s == -1 ? "token" : "nvs") : NULL);
        break;
    }
#if CONFIG_LUME_PERF_PROFILE
    case LUME_CMD_OOM: {
        /* r139: arm the allocator failure window. The enum/arm state exist
         * only in profile builds; default firmware never reaches this case.
         * Serialize concurrent USB/TCP arming so the RX side stays one writer. */
        char ms[16];   /* oom_ms is capped at 9 decimal digits by the parser */
        int n = snprintf(ms, sizeof(ms), "%u", (unsigned)cmd.oom_ms);
        xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
        int s = lume_engine_oom_inject(cmd.oom_ms);
        xSemaphoreGiveRecursive(s_pending_mutex);
        cmd_reply(sink, s == 0 && n > 0, s == 0 && n > 0 ? "oom" : NULL,
                  s == 0 && n > 0 ? ms : NULL, 0, s != 0 ? "oom" : NULL);
        break;
    }
#endif
    }
}

/* ================================================================== */
/* Frame codec glue (identical for USB and TCP)                         */
/* ================================================================== */
static void *psram_alloc(size_t len) { return heap_caps_malloc(len, MALLOC_CAP_SPIRAM); }
static void  psram_free(void *p)     { heap_caps_free(p); }

static void on_frame_event(lume_frame_ev_t ev, const uint8_t *payload,
                           size_t len, const char *reason, void *user)
{
    reply_sink_t sink = *(const reply_sink_t *)user;
    switch (ev) {
    case LUME_FRAME_EV_BYTECODE:
        /* r43b: a "LUMB" frame stages through the SAME reload slot as source;
         * the engine dispatches on the payload's "LQBC" header at eval time. */
        ESP_LOGI(TAG, "bytecode frame (%u bytes)", (unsigned)len);
        /* fall through */
    case LUME_FRAME_EV_DATA: {
        /* Push BEFORE request_reload so a synchronous "superseded" result (or
         * an early engine result) always finds a matching FIFO head. Holding
         * the recursive mutex across the call keeps the FIFO consistent with
         * concurrent pushes from the other channel. */
        bool fail = false;
        xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
        bool pushed = pending_push(sink);
        int r = pushed ? lume_engine_request_reload((const char *)payload, len)
                       : -1;
        if (r != 0) {
            /* No engine result will arrive for this frame: undo the push. */
            pending_drop_tail();
            fail = true;
        }
        xSemaphoreGiveRecursive(s_pending_mutex);
        if (fail) reply_line(sink, false, len, "stage-oom");
        break;
    }
    case LUME_FRAME_EV_BACK:
        if (lume_engine_post_back() != 0)
            ESP_LOGW(TAG, "BACK dropped: engine queue full");
        break;
    case LUME_FRAME_EV_PAUSE:
        lume_engine_post_lifecycle(LUME_EVT_PAUSE);
        break;
    case LUME_FRAME_EV_RESUME:
        lume_engine_post_lifecycle(LUME_EVT_RESUME);
        break;
    case LUME_FRAME_EV_CMD:
        handle_cmd(sink, payload, len);
        break;
    case LUME_FRAME_EV_REPL: {  /* r115: eval on the current app ctx */
        bool slot_ok = false;
        uint32_t token = 0;
        xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
        token = repl_slot_alloc(sink, &slot_ok);
        xSemaphoreGiveRecursive(s_pending_mutex);
        if (!slot_ok) {
            repl_reply(sink, false, "repl-busy", strlen("repl-busy"));
            break;
        }
        int r = lume_engine_request_repl((const char *)payload, len, token);
        if (r != 0) {
            xSemaphoreTakeRecursive(s_pending_mutex, portMAX_DELAY);
            repl_slot_take(token, NULL);   /* reclaim the unused slot */
            xSemaphoreGiveRecursive(s_pending_mutex);
            repl_reply(sink, false, "stage-oom", strlen("stage-oom"));
        }
        break;
    }
    case LUME_FRAME_EV_ERR:
        ESP_LOGE(TAG, "frame rejected: %s (len=%u)", reason, (unsigned)len);
        reply_line(sink, false, len, reason);
        break;
    }
}

/* ================================================================== */
/* (1) USB Serial/JTAG channel (M1, unchanged behaviour)               */
/* ================================================================== */
static lume_frame_parser_t s_usb_parser;

static bool usb_parser_mid_frame(const lume_frame_parser_t *p)
{
    return p->state == LUME_FRAME_ST_HDR ||
           p->state == LUME_FRAME_ST_BODY ||
           (p->state == LUME_FRAME_ST_MAGIC && p->magic_n > 0);
}

static void usb_rx_task(void *arg)
{
    (void)arg;
    uint8_t chunk[USB_RX_CHUNK];
    TickType_t last_rx = 0;
    for (;;) {
        int n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk),
                                           pdMS_TO_TICKS(USB_RX_READ_MS));
        if (n > 0) {
            last_rx = xTaskGetTickCount();
            for (int i = 0; i < n; i++) {
                lume_frame_parser_feed(&s_usb_parser, chunk[i]);
            }
        } else if (usb_parser_mid_frame(&s_usb_parser) &&
                   (TickType_t)(xTaskGetTickCount() - last_rx) >=
                       pdMS_TO_TICKS(USB_RX_FRAME_TIMEOUT_MS)) {
            /* Lost bytes mid-frame strand the length-counted parser in ST_BODY
             * or ST_HDR with no frame timeout in lume_frame.c. Release any
             * staged PSRAM buffer, reset to ST_MAGIC, and notify the host so
             * it can resync and retry instead of waiting 15 s for ACK timeout. */
            size_t stalled_len = s_usb_parser.payload_len;
            ESP_LOGW(TAG, "USB RX frame idle timeout (state=%d got=%u/%u); reset",
                     (int)s_usb_parser.state, (unsigned)s_usb_parser.payload_n,
                     (unsigned)stalled_len);
            if (s_usb_parser.payload != NULL) {
                psram_free(s_usb_parser.payload);
            }
            lume_frame_parser_init(&s_usb_parser, psram_alloc, psram_free,
                                   on_frame_event, &s_usb_sink);
            reply_line(s_usb_sink, false, stalled_len, "timeout");
        }
    }
}

static void usb_start(void)
{
    if (!usb_serial_jtag_is_driver_installed()) {
        usb_serial_jtag_driver_config_t cfg = {
            .rx_buffer_size = USJ_RX_BUFFER,
            .tx_buffer_size = USJ_TX_BUFFER,
        };
        esp_err_t err = usb_serial_jtag_driver_install(&cfg);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "usb_serial_jtag_driver_install failed: %s",
                     esp_err_to_name(err));
            return;
        }
    } else {
        ESP_LOGI(TAG, "USJ driver already installed; reusing it for RX");
    }
    /* Route ESP_LOG console TX through the driver too, so RELOAD replies and
     * logs do not interleave on the FIFO (M1 r6 fix). */
    usb_serial_jtag_vfs_use_driver();

    BaseType_t ok = xTaskCreate(usb_rx_task, "lume-hotreload-rx",
                                USB_RX_STACK, NULL, USB_RX_PRIO, NULL);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "usb rx task create failed (%d)", (int)ok);
        return;
    }
    ESP_LOGI(TAG, "USB hot-reload up; "
                  "frame LUME|len:u32le|crc32:u32le|payload, max=%u bytes",
             (unsigned)LUME_FRAME_MAX_PAYLOAD);
}

/* ================================================================== */
/* (2) WiFi TCP OTA channel (r26)                                      */
/* ================================================================== */
static char     s_token[LUME_OTA_TOKEN_STR_MAX];   /* 32 hex + NUL */
static uint8_t  s_token_key[16];                   /* raw bytes = HMAC key */
static volatile bool s_token_ready;
static volatile bool s_wifi_ready;
static volatile bool s_ota_running;
static int      s_listen_sock = -1;

/* mbedTLS-backed HMAC provider injected into the portable auth glue
 * (lume_ota_mac_verify). The CLI uses node:crypto over the same key/message. */
static int ota_hmac(const uint8_t *key, size_t key_len,
                    const uint8_t *msg, size_t msg_len, uint8_t out[32])
{
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (info == NULL) return -1;
    return mbedtls_md_hmac(info, key, key_len, msg, msg_len, out);
}

/* First boot: generate a random token and persist it in NVS. Later boots:
 * adopt the persisted token. If NVS is unavailable, keep the ephemeral token
 * (OTA still works for this boot). nvs_flash_init() is idempotent and Lock-
 * guarded (nvs_api.cpp:124-135), so calling it here alongside the engine
 * task's own init at boot is safe. */
static void token_init(void)
{
    char token[LUME_OTA_TOKEN_STR_MAX];
    uint8_t raw[16];
    esp_fill_random(raw, sizeof(raw));
    lume_ota_hex_encode(raw, sizeof(raw), token);   /* ephemeral default */

    esp_err_t err = nvs_flash_init();
    if (err == ESP_OK) {
        nvs_handle_t h;
        err = nvs_open("lume_ota", NVS_READWRITE, &h);
        if (err == ESP_OK) {
            char stored[LUME_OTA_TOKEN_STR_MAX];
            size_t len = sizeof(stored);
            esp_err_t g = nvs_get_str(h, "token", stored, &len);
            if (g == ESP_OK && len == LUME_OTA_TOKEN_HEX_LEN + 1) {
                memcpy(token, stored, sizeof(token));
            } else if (g == ESP_ERR_NVS_NOT_FOUND) {
                esp_err_t s = nvs_set_str(h, "token", token);
                if (s == ESP_OK) s = nvs_commit(h);
                if (s != ESP_OK)
                    ESP_LOGW(OTA_TAG, "token persist failed: %s (ephemeral this boot)",
                             esp_err_to_name(s));
            } else if (g != ESP_OK) {
                ESP_LOGW(OTA_TAG, "nvs_get_str failed: %s (ephemeral this boot)",
                         esp_err_to_name(g));
            }
            nvs_close(h);
        } else {
            ESP_LOGW(OTA_TAG, "nvs_open failed: %s (ephemeral this boot)",
                     esp_err_to_name(err));
        }
    } else {
        ESP_LOGW(OTA_TAG, "nvs_flash_init failed: %s (ephemeral this boot)",
                 esp_err_to_name(err));
    }
    memcpy(s_token, token, sizeof(s_token));
    lume_ota_hex_decode(s_token, LUME_OTA_TOKEN_HEX_LEN, s_token_key);
    s_token_ready = true;   /* publish last, after the token is final */
}

/* Serial-CLI token set (LUMC "TOKEN <hex>" from lume_cmd.c). Validates the
 * 32-hex token, persists it under NVS "lume_ota"/"token", and swaps the
 * runtime HMAC key only after a successful commit. Returns 0 or negative. */
int lume_ota_token_set(const char *hex, size_t len)
{
    if (hex == NULL || len != LUME_OTA_TOKEN_HEX_LEN ||
        !lume_ota_hex_valid(hex, LUME_OTA_TOKEN_HEX_LEN)) {
        return -1;
    }
    uint8_t raw[16];
    char canon[LUME_OTA_TOKEN_STR_MAX];
    if (!lume_ota_hex_decode(hex, LUME_OTA_TOKEN_HEX_LEN, raw)) return -1;
    lume_ota_hex_encode(raw, sizeof(raw), canon);   /* lowercase canonical form */

    esp_err_t err = nvs_flash_init();
    if (err == ESP_OK) {
        nvs_handle_t h;
        err = nvs_open("lume_ota", NVS_READWRITE, &h);
        if (err == ESP_OK) {
            err = nvs_set_str(h, "token", canon);
            if (err == ESP_OK) err = nvs_commit(h);
            nvs_close(h);
        }
    }
    if (err != ESP_OK) {
        ESP_LOGW(OTA_TAG, "token persist failed: %s", esp_err_to_name(err));
        return -2;
    }
    memcpy(s_token, canon, sizeof(s_token));
    memcpy(s_token_key, raw, sizeof(s_token_key));
    ESP_LOGI(OTA_TAG, "OTA token updated via serial CLI");
    return 0;
}

/* Status provider registered into the engine -> lume.net.otaStatus(). */
static void ota_status_provider(lume_ota_status_t *out)
{
    memset(out, 0, sizeof(*out));
    out->running     = s_ota_running;
    out->wifi_ready  = s_wifi_ready;
    out->token_ready = s_token_ready;
    out->hmac        = true;   /* r96: HMAC challenge-response always active */
    out->port        = OTA_PORT;
    if (s_token_ready) memcpy(out->token, s_token, sizeof(out->token));
}

static int ota_bind_listener(void)
{
    int s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s < 0) {
        ESP_LOGE(OTA_TAG, "socket() failed: errno %d", errno);
        return -1;
    }
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port        = htons(OTA_PORT);
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        ESP_LOGE(OTA_TAG, "bind(:%d) failed: errno %d", OTA_PORT, errno);
        close(s);
        return -1;
    }
    if (listen(s, OTA_BACKLOG) < 0) {
        ESP_LOGE(OTA_TAG, "listen() failed: errno %d", errno);
        close(s);
        return -1;
    }
    return s;
}

/* One client at a time. Per-socket I/O timeouts keep the loop responsive so
 * the WiFi gate is re-checked even if a client stalls. r96 auth handshake:
 *   server -> "CHALLENGE <32hex>\n"   (16 bytes from esp_random, per-connection)
 *   client -> "AUTH <64hex MAC>\n"    (HMAC-SHA256(token, challenge ASCII))
 *   server -> "AUTH OK\n" / "AUTH ERR\n"
 * No token ever crosses the wire; a replayed MAC fails against a fresh
 * challenge. After "AUTH OK" the byte stream is fed into a PRIVATE instance
 * of the same portable frame parser the USB channel uses (sink = this socket). */
static void ota_handle_client(int sock)
{
    reply_sink_t sink = { REPLY_TCP, sock };
    lume_frame_parser_t parser;
    lume_frame_parser_init(&parser, psram_alloc, psram_free,
                           on_frame_event, &sink);

    struct timeval tv = { .tv_sec = OTA_IO_TIMEOUT_S, .tv_usec = 0 };
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    /* Fresh challenge for this connection: 16 bytes from esp_random (via the
     * IDF esp_fill_random wrapper) hex-encoded to 32 lowercase chars. */
    uint8_t  challenge_raw[16];
    char     challenge_hex[LUME_OTA_CHALLENGE_STR_MAX];
    esp_fill_random(challenge_raw, sizeof(challenge_raw));
    lume_ota_hex_encode(challenge_raw, sizeof(challenge_raw), challenge_hex);
    char chal_line[LUME_OTA_AUTH_LINE_MAX];
    int chal_n = lume_ota_challenge_line(chal_line, sizeof(chal_line),
                                         challenge_hex);
    if (chal_n <= 0 || send(sock, chal_line, (size_t)chal_n, 0) != chal_n) {
        ESP_LOGW(OTA_TAG, "challenge send failed");
        goto done;
    }

    char   auth[LUME_OTA_AUTH_LINE_MAX];
    size_t auth_n = 0;
    bool   authed = false;
    uint8_t chunk[OTA_RECV_CHUNK];
    const char *ok_line  = "AUTH OK\n";
    const char *err_line = "AUTH ERR\n";

    for (;;) {
        int n = recv(sock, chunk, sizeof(chunk), 0);
        if (n <= 0) break;   /* EOF / timeout / error */
        for (int i = 0; i < n; i++) {
            uint8_t b = chunk[i];
            if (!authed) {
                if (b == '\n') {
                    char provided[LUME_OTA_MAC_STR_MAX];
                    int v = -1;
                    if (s_token_ready) {
                        v = lume_ota_auth_parse(auth, auth_n, provided,
                                                sizeof(provided))
                            ? lume_ota_mac_verify(ota_hmac, s_token_key,
                                                  sizeof(s_token_key),
                                                  challenge_hex, provided)
                            : -2;
                    }
                    if (v == 0) {
                        reply_write(sink, ok_line, strlen(ok_line));
                        authed = true;
                        ESP_LOGI(OTA_TAG, "client authenticated (HMAC-SHA256)");
                    } else {
                        reply_write(sink, err_line, strlen(err_line));
                        ESP_LOGW(OTA_TAG, "client rejected: auth failed (%d)", v);
                        goto done;
                    }
                    auth_n = 0;
                } else if (auth_n < sizeof(auth) - 1) {
                    auth[auth_n++] = (char)b;
                } else {
                    reply_write(sink, err_line, strlen(err_line));
                    ESP_LOGW(OTA_TAG, "client rejected: overlong auth line");
                    goto done;
                }
            } else {
                lume_frame_parser_feed(&parser, b);
            }
        }
    }
done:
    close(sock);
}

static void ota_task(void *arg)
{
    (void)arg;
    for (;;) {
        bool has_ip = lume_net_has_ip();
        s_wifi_ready = has_ip;

        /* Portable gate (host-tested): WiFi-not-connected -> no listener. */
        if (!lume_ota_can_serve(has_ip, (bool)s_token_ready)) {
            if (s_listen_sock >= 0) {
                close(s_listen_sock);
                s_listen_sock = -1;
                s_ota_running = false;
                ESP_LOGI(OTA_TAG, "WiFi down: OTA server stopped");
            }
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;      /* auto-start on the next GOT_IP */
        }
        if (s_listen_sock < 0) {
            s_listen_sock = ota_bind_listener();
            if (s_listen_sock < 0) {
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }
            s_ota_running = true;
            ESP_LOGI(OTA_TAG, "OTA server up on 0.0.0.0:%d (token logged at boot)",
                     OTA_PORT);
        }
        /* 1s select: re-evaluate the WiFi gate every second even when idle. */
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(s_listen_sock, &fds);
        struct timeval tv = { .tv_sec = 1, .tv_usec = 0 };
        int n = select(s_listen_sock + 1, &fds, NULL, NULL, &tv);
        if (n > 0 && FD_ISSET(s_listen_sock, &fds)) {
            int client = accept(s_listen_sock, NULL, NULL);
            if (client >= 0) ota_handle_client(client);
        }
    }
}

static void ota_start(void)
{
    token_init();
    /* Intentional: the token is printed so the user can pass it to the CLI.
     * It is NEVER sent over the WiFi channel (r96 HMAC challenge-response).
     * LAN trust model — see docs/KNOWN-SIMPLIFICATIONS.md. */
    ESP_LOGI(OTA_TAG, "WiFi OTA token: %s  (use: lume deploy --host <ip> --token %s)",
             s_token, s_token);
    lume_engine_set_ota_status_provider(ota_status_provider);
    lume_engine_set_ota_token_setter(lume_ota_token_set);
    BaseType_t ok = xTaskCreate(ota_task, "lume-ota", OTA_TASK_STACK,
                                NULL, 4, NULL);
    if (ok != pdPASS) {
        ESP_LOGE(OTA_TAG, "OTA task create failed (%d)", (int)ok);
    }
}

/* ================================================================== */
/* Public entry                                                        */
/* ================================================================== */
void lume_hotreload_start(void)
{
    s_tx_mutex      = xSemaphoreCreateMutex();
    s_pending_mutex = xSemaphoreCreateRecursiveMutex();
    if (s_tx_mutex == NULL || s_pending_mutex == NULL) {
        ESP_LOGE(TAG, "mutex create failed (OOM)");
        return;
    }

    lume_frame_parser_init(&s_usb_parser, psram_alloc, psram_free,
                           on_frame_event, &s_usb_sink);
    /* Final reload outcome (eval OK / failed) is reported back to TX for
     * whichever channel pushed the frame. */
    lume_engine_set_reload_result_cb(on_engine_result);
    /* r115: REPL eval outcome is reported through a separate callback (same
     * one-way dependency; the engine never links this component). */
    lume_engine_set_repl_cb(on_repl_result);

    usb_start();
    ota_start();
}
