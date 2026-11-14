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
#include <stdlib.h>          /* malloc/free for CMD reply lines */
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
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
#include "lume_engine.h"
#include "lume_net.h"
#include "lume_hotreload.h"
#include "lume_frame.h"
#include "lume_cmd.h"
#include "lume_apps.h"

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
#define USB_RX_STACK       8192
#define USB_RX_CHUNK       128
#define USJ_RX_BUFFER      1024   /* driver requires > 64 */
#define USJ_TX_BUFFER      512

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

static void reply_write(reply_sink_t sink, const char *line, size_t n)
{
    if (n == 0) return;
    xSemaphoreTake(s_tx_mutex, portMAX_DELAY);
    if (sink.kind == REPLY_USB) {
        int w = usb_serial_jtag_write_bytes(line, n, pdMS_TO_TICKS(50));
        if (w != (int)n) {
            ESP_LOGE(TAG, "USB reply TX short/failed (%d/%u)", w, (unsigned)n);
        }
    } else {
        int w = send(sink.sock, line, n, 0);
        if (w != (int)n) {
            ESP_LOGE(OTA_TAG, "TCP reply TX short/failed (%d/%u, errno %d)",
                     w, (unsigned)n, errno);
        }
    }
    xSemaphoreGive(s_tx_mutex);
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

static void handle_cmd(reply_sink_t sink, const uint8_t *payload, size_t len)
{
    lume_cmd_t cmd;
    int r = lume_cmd_parse(payload, len, &cmd);
    if (r != LUME_CMD_OK) {
        cmd_reply(sink, false, NULL, NULL, 0, lume_cmd_reason(r));
        return;
    }
    switch (cmd.kind) {
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
            reply_line(sink, false, 0, "stage-oom");
        }
        break;
    }
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

static void usb_rx_task(void *arg)
{
    (void)arg;
    uint8_t chunk[USB_RX_CHUNK];
    for (;;) {
        int n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk),
                                           pdMS_TO_TICKS(20));
        for (int i = 0; i < n; i++) {
            lume_frame_parser_feed(&s_usb_parser, chunk[i]);
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
                                USB_RX_STACK, NULL, 4, NULL);
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
static volatile bool s_token_ready;
static volatile bool s_wifi_ready;
static volatile bool s_ota_running;
static int      s_listen_sock = -1;

static void hex_encode(const uint8_t *in, size_t n, char *out)
{
    static const char hx[] = "0123456789abcdef";
    for (size_t i = 0; i < n; i++) {
        out[2 * i]     = hx[in[i] >> 4];
        out[2 * i + 1] = hx[in[i] & 0x0f];
    }
    out[2 * n] = '\0';
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
    hex_encode(raw, sizeof(raw), token);   /* ephemeral default */

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
    s_token_ready = true;   /* publish last, after the token is final */
}

/* Status provider registered into the engine -> lume.net.otaStatus(). */
static void ota_status_provider(lume_ota_status_t *out)
{
    memset(out, 0, sizeof(*out));
    out->running     = s_ota_running;
    out->wifi_ready  = s_wifi_ready;
    out->token_ready = s_token_ready;
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
 * the WiFi gate is re-checked even if a client stalls. After "AUTH OK" the
 * byte stream is fed into a private frame parser (sink = this socket). */
static void ota_handle_client(int sock)
{
    reply_sink_t sink = { REPLY_TCP, sock };
    lume_frame_parser_t parser;
    lume_frame_parser_init(&parser, psram_alloc, psram_free,
                           on_frame_event, &sink);

    struct timeval tv = { .tv_sec = OTA_IO_TIMEOUT_S, .tv_usec = 0 };
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

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
                    char provided[LUME_OTA_TOKEN_STR_MAX];
                    bool valid = lume_ota_auth_parse(auth, auth_n,
                                                     provided, sizeof(provided)) &&
                                 s_token_ready &&
                                 lume_ota_token_equal(provided, s_token);
                    if (valid) {
                        reply_write(sink, ok_line, strlen(ok_line));
                        authed = true;
                        ESP_LOGI(OTA_TAG, "client authenticated");
                    } else {
                        reply_write(sink, err_line, strlen(err_line));
                        ESP_LOGW(OTA_TAG, "client rejected: bad token");
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
     * Plaintext LAN trust model — see docs/KNOWN-SIMPLIFICATIONS.md (r26). */
    ESP_LOGI(OTA_TAG, "WiFi OTA token: %s  (use: lume deploy --ota <ip> --token %s)",
             s_token, s_token);
    lume_engine_set_ota_status_provider(ota_status_provider);
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

    usb_start();
    ota_start();
}
