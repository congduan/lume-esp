/**
 * lume-webserv (r71): transport + HTTP/1.0 protocol for the JS-defined LAN
 * web server. See include/lume_webserv.h for the full thread/lifecycle and
 * security contract. This file owns NO route table and NEVER reads files.
 *
 * ESP-IDF v5.5.5 API evidence (same calls as lume-hotreload's WiFi OTA):
 *   lwip/sockets.h : socket / setsockopt(SO_REUSEADDR,SO_SNDTIMEO) / bind /
 *                    listen / select / accept / recv(MSG_DONTWAIT) / send /
 *                    close, fd_set, struct sockaddr_in, htonl/htons
 *   lume_net.h     : lume_net_has_ip() (spinlock-guarded, any task) gates the
 *                    listener; lume_net_status() formats the IPv4 for url()
 *   esp_heap_caps.h: heap_caps_malloc(MALLOC_CAP_SPIRAM) for the ONE shared
 *                    bounded request buffer (~9 KiB), never on the stack
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lwip/sockets.h"
#include "lume_net.h"
#include "lume_webserv.h"

static const char *TAG = "lume-web";

#define WEB_BUF_CAP (LUME_WEB_HEAD_MAX + LUME_WEB_BODY_MAX)

static bool   s_running;
static int    s_port = CONFIG_LUME_WEB_PORT;
static char   s_token[LUME_WEB_TOKEN_MAX];
static char  *s_buf;                       /* one shared PSRAM request buffer */
static int    s_listen = -1;
static TickType_t s_next_bind;
static int    s_clients[LUME_WEB_MAX_CONN] = { -1, -1 };
static TickType_t s_seen[LUME_WEB_MAX_CONN]; /* first-byte time, for deadline */
static int    s_cur = -1;                  /* client currently being read */
static size_t s_cur_len;                   /* bytes accumulated in s_buf */

/* ------------------------------------------------------------------ */
/* Status line reason phrases                                          */
/* ------------------------------------------------------------------ */
static const char *reason_phrase(int code)
{
    switch (code) {
    case 200: return "OK";
    case 201: return "Created";
    case 204: return "No Content";
    case 400: return "Bad Request";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 408: return "Request Timeout";
    case 413: return "Payload Too Large";
    case 431: return "Request Header Fields Too Large";
    case 500: return "Internal Server Error";
    case 503: return "Service Unavailable";
    case 504: return "Gateway Timeout";
    default:  return "OK";
    }
}

/* Close the current client and reset its read state. */
static void close_cur(void)
{
    if (s_cur >= 0 && s_clients[s_cur] >= 0) {
        close(s_clients[s_cur]);
        s_clients[s_cur] = -1;
    }
    s_cur = -1;
    s_cur_len = 0;
}

/* Send a header-only status response; the caller owns the socket. */
static void send_status(int fd, int code)
{
    char head[160];
    int n = snprintf(head, sizeof(head),
                     "HTTP/1.0 %d %s\r\nContent-Length: 0\r\n"
                     "Connection: close\r\n\r\n",
                     code, reason_phrase(code));
    if (n > 0 && (size_t)n < sizeof(head)) {
        (void)send(fd, head, (size_t)n, 0);
    }
}

/* A single response gets one total 5 s send budget, including all chunks. */
static bool send_bounded(int fd, const uint8_t *data, size_t len, TickType_t start)
{
    size_t off = 0;
    while (off < len) {
        uint32_t ms = (uint32_t)(xTaskGetTickCount() - start) * portTICK_PERIOD_MS;
        if (ms >= LUME_WEB_IO_TIMEOUT_S * 1000u) return false;
        size_t take = len - off;
        if (take > LUME_WEB_SEND_CHUNK) take = LUME_WEB_SEND_CHUNK;
        int n = send(fd, data + off, take, MSG_DONTWAIT);
        if (n > 0) { off += (size_t)n; continue; }
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            vTaskDelay(1);
            continue;
        }
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
static bool token_printable(const char *t)
{
    for (size_t i = 0; t[i] != '\0'; i++) {
        unsigned char c = (unsigned char)t[i];
        /* URL-query-safe subset: printable, no separator/space/control. */
        if (c < 0x21 || c > 0x7e || c == '?' || c == '&' || c == '#' ||
            c == '=' || c == '"' || c == '\\') return false;
    }
    return true;
}

int lume_webserv_start(int port, const char *token)
{
    if (s_running) return LUME_WEB_ERR_BUSY;
    if (port < 1024 || port > 65535) return LUME_WEB_ERR_ARG;
    if (token == NULL || token[0] == '\0' ||
        strlen(token) >= LUME_WEB_TOKEN_MAX || !token_printable(token)) {
        return LUME_WEB_ERR_ARG;
    }
    char *buf = heap_caps_malloc(WEB_BUF_CAP, MALLOC_CAP_SPIRAM);
    if (buf == NULL) {
        ESP_LOGW(TAG, "start: request buffer alloc failed (%u B)", (unsigned)WEB_BUF_CAP);
        return LUME_WEB_ERR_MEM;
    }
    s_buf = buf;
    memset(s_buf, 0, WEB_BUF_CAP);
    snprintf(s_token, sizeof(s_token), "%s", token);
    s_port = port;
    s_cur = -1;
    s_cur_len = 0;
    s_listen = -1;
    s_next_bind = 0;
    for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) s_clients[i] = -1;
    s_running = true;                       /* publish last */
    ESP_LOGI(TAG, "web server enabled on port %d (binds only with WiFi IP; token set)",
             port);
    return LUME_WEB_OK;
}

int lume_webserv_stop(void)
{
    if (!s_running) return LUME_WEB_OK;     /* idempotent */
    s_running = false;                       /* publish first */
    if (s_listen >= 0) { close(s_listen); s_listen = -1; }
    for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) {
        if (s_clients[i] >= 0) { close(s_clients[i]); s_clients[i] = -1; }
    }
    s_cur = -1;
    s_cur_len = 0;
    if (s_buf != NULL) { heap_caps_free(s_buf); s_buf = NULL; }
    s_token[0] = '\0';
    ESP_LOGI(TAG, "web server stopped (listener + clients closed)");
    return LUME_WEB_OK;
}

int lume_webserv_url(char *out, size_t cap)
{
    if (!s_running || s_buf == NULL || s_listen < 0 || out == NULL || cap == 0) {
        return LUME_WEB_ERR_STATE;
    }
    lume_net_status_t st;
    if (lume_net_status(&st) != LUME_NET_OK || st.ip[0] == '\0') {
        return LUME_WEB_ERR_STATE;          /* no usable IPv4 yet */
    }
    int n = snprintf(out, cap, "http://%s:%d/?key=%s", st.ip, s_port, s_token);
    return (n > 0 && (size_t)n < cap) ? LUME_WEB_OK : LUME_WEB_ERR_ARG;
}

/* ------------------------------------------------------------------ */
/* Listener + non-blocking request pump                                */
/* (lume_webserv_token_ok() is pure and lives in lume_webserv_parse.c)  */
/* ------------------------------------------------------------------ */
static int bind_listener(void)
{
    int s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s < 0) {
        ESP_LOGW(TAG, "socket failed: errno %d", errno);
        return -1;
    }
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons((uint16_t)s_port);
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        ESP_LOGW(TAG, "bind(:%d) failed: errno %d", s_port, errno);
        close(s);
        return -1;
    }
    if (listen(s, LUME_WEB_BACKLOG) < 0) {
        ESP_LOGW(TAG, "listen failed: errno %d", errno);
        close(s);
        return -1;
    }
    return s;
}

static int free_slot(void)
{
    for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++)
        if (s_clients[i] < 0) return (int)i;
    return -1;
}

static bool timed_out(size_t slot)
{
    uint32_t ms = (uint32_t)(xTaskGetTickCount() - s_seen[slot]) * portTICK_PERIOD_MS;
    return ms > LUME_WEB_IO_TIMEOUT_S * 1000u;
}

static size_t find_head(const char *buf, size_t len);   /* below */

/* Read whatever is available from s_cur into s_buf (MSG_DONTWAIT: never
 * stalls the engine). Returns 1 = one complete request parsed, 0 = need more
 * bytes, -1 = error (an HTTP error status was sent and the socket closed).
 * `parsed` is filled only on 1. */
static int read_current(lume_web_parsed_t *parsed)
{
    int fd = s_clients[s_cur];
    int n = recv(fd, s_buf + s_cur_len, WEB_BUF_CAP - s_cur_len, MSG_DONTWAIT);
    if (n > 0) {
        s_cur_len += (size_t)n;
    } else if (n == 0) {
        close_cur(); return -1;             /* client hung up */
    } else if (errno != EAGAIN && errno != EWOULDBLOCK) {
        close_cur(); return -1;
    }

    /* Head incomplete -> wait for more; an overlong head -> 431. */
    size_t head_at = find_head(s_buf, s_cur_len);
    if (head_at == SIZE_MAX) {
        if (s_cur_len >= LUME_WEB_HEAD_MAX) {
            send_status(fd, 431);
            close_cur();
            return -1;
        }
        if (timed_out((size_t)s_cur)) {     /* incl. a client that never sends */
            send_status(fd, 408);
            close_cur();
            return -1;
        }
        return 0;
    }
    if (head_at + 4 > LUME_WEB_HEAD_MAX) {
        send_status(fd, 431);
        close_cur();
        return -1;
    }
    int r = lume_webserv_parse(s_buf, s_cur_len, WEB_BUF_CAP, parsed);
    if (r == 0) return 1;                   /* complete request */
    if (r == -2) {                          /* body not fully arrived yet */
        if (s_cur_len == WEB_BUF_CAP) {
            send_status(fd, 413);
            close_cur();
            return -1;
        }
        if (timed_out((size_t)s_cur)) {
            send_status(fd, 408);
            close_cur();
            return -1;
        }
        return 0;
    }
    send_status(fd, r == -4 ? 413 : 400);
    close_cur();
    return -1;
}

/* Public non-blocking pump. Requires `find_head` below. */
static size_t find_head(const char *buf, size_t len)
{
    if (len < 4) return SIZE_MAX;
    for (size_t i = 0; i + 4 <= len; i++) {
        if (memcmp(buf + i, "\r\n\r\n", 4) == 0) return i;
    }
    return SIZE_MAX;
}

int lume_webserv_poll(lume_web_request_t *req)
{
    if (req == NULL || !s_running || s_buf == NULL) return -1;

    /* Same WiFi gate as the OTA channel: no IPv4 -> no listener at all.
     * Enabled state is retained so it auto-rebinds on the next GOT_IP. */
    if (!lume_net_has_ip()) {
        if (s_listen >= 0) { close(s_listen); s_listen = -1; }
        close_cur();
        for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) {
            if (s_clients[i] >= 0) { close(s_clients[i]); s_clients[i] = -1; }
        }
        return 0;
    }
    if (s_listen < 0) {
        TickType_t now = xTaskGetTickCount();
        if (s_next_bind != 0 && (int32_t)(now - s_next_bind) < 0) return 0;
        s_listen = bind_listener();
        if (s_listen < 0) {
            s_next_bind = now + pdMS_TO_TICKS(1000);
            return -1;
        }
        s_next_bind = 0;
        ESP_LOGI(TAG, "listening on 0.0.0.0:%d", s_port);
    }

    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(s_listen, &fds);
    int maxfd = s_listen;
    for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) {
        if (s_clients[i] >= 0) {
            FD_SET(s_clients[i], &fds);
            if (s_clients[i] > maxfd) maxfd = s_clients[i];
        }
    }
    struct timeval tv = { .tv_sec = 0, .tv_usec = 0 };
    int n = select(maxfd + 1, &fds, NULL, NULL, &tv);
    if (n < 0) return -1;

    for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) {
        if (s_clients[i] >= 0 && timed_out(i) && (int)i != s_cur) {
            send_status(s_clients[i], 408);
            close(s_clients[i]);
            s_clients[i] = -1;
        }
    }

    if (FD_ISSET(s_listen, &fds)) {
        int c = accept(s_listen, NULL, NULL);
        if (c >= 0) {
            int slot = free_slot();
            if (slot < 0) {
                close(c);                   /* connection cap -> drop */
            } else {
                s_clients[slot] = c;
                s_seen[slot] = xTaskGetTickCount();
                struct timeval snd = { .tv_sec = LUME_WEB_IO_TIMEOUT_S, .tv_usec = 0 };
                setsockopt(c, SOL_SOCKET, SO_SNDTIMEO, &snd, sizeof(snd));
            }
        }
    }

    if (s_cur < 0 && n > 0) {
        for (size_t i = 0; i < LUME_WEB_MAX_CONN; i++) {
            if (s_clients[i] >= 0 && FD_ISSET(s_clients[i], &fds)) {
                s_cur = (int)i;
                s_cur_len = 0;
                break;
            }
        }
    }
    if (s_cur < 0) return 0;

    lume_web_parsed_t parsed;
    int r = read_current(&parsed);
    if (r != 1) return 0;

    /* Auth BEFORE any JS dispatch: missing/wrong token -> 403. */
    if (!lume_webserv_token_ok(parsed.query, s_token)) {
        send_status(s_clients[s_cur], 403);
        close_cur();
        ESP_LOGW(TAG, "rejected request without valid key (path %.32s)", parsed.path);
        return 0;
    }

    memcpy(req->method, parsed.method, sizeof(req->method));
    memcpy(req->path, parsed.path, sizeof(req->path));
    memcpy(req->query, parsed.query, sizeof(req->query));
    req->body = s_buf + parsed.body_offset;
    req->body_len = parsed.body_len;
    return 1;                               /* engine MUST call respond() */
}

/* ------------------------------------------------------------------ */
/* Response writer (header + streamed body, no extra PSRAM copy)       */
/* ------------------------------------------------------------------ */
int lume_webserv_respond(const lume_web_response_t *resp)
{
    if (s_cur < 0 || s_clients[s_cur] < 0 || resp == NULL) {
        return LUME_WEB_ERR_STATE;
    }
    int fd = s_clients[s_cur];
    if (timed_out((size_t)s_cur)) {
        send_status(fd, 504);
        close_cur();
        return LUME_WEB_ERR_STATE;
    }
    int code = (resp->status >= 100 && resp->status <= 599) ? resp->status : 500;
    size_t body_len = resp->body_len;

    char head[LUME_WEB_HEAD_MAX];
    size_t h = 0;
    int w = snprintf(head + h, sizeof(head) - h,
                     "HTTP/1.0 %d %s\r\n", code, reason_phrase(code));
    if (w <= 0 || (size_t)w >= sizeof(head) - h) { send_status(fd, 500); close_cur(); return -1; }
    h += (size_t)w;

    /* Content-Type: use the app-provided one if present, else HTML/UTF-8.
     * Skip hop-by-hop / length headers we emit ourselves. CRLF in any app
     * header value is skipped defensively (engine also rejects it). */
    bool have_ct = false;
    for (size_t i = 0; i < resp->header_count && i < LUME_WEB_HEADER_MAX; i++) {
        const char *name = resp->headers[i].name, *value = resp->headers[i].value;
        if (name == NULL || value == NULL) continue;
        if (strchr(name, '\r') || strchr(name, '\n') ||
            strchr(value, '\r') || strchr(value, '\n') ||
            strchr(name, ':')) continue;
        if (strcasecmp(name, "Content-Type") == 0) have_ct = true;
    }
    if (!have_ct) {
        w = snprintf(head + h, sizeof(head) - h, "Content-Type: text/html; charset=utf-8\r\n");
        if (w <= 0 || (size_t)w >= sizeof(head) - h) { send_status(fd, 500); close_cur(); return -1; }
        h += (size_t)w;
    }
    w = snprintf(head + h, sizeof(head) - h,
                 "Content-Length: %u\r\nConnection: close\r\n", (unsigned)body_len);
    if (w <= 0 || (size_t)w >= sizeof(head) - h) { send_status(fd, 500); close_cur(); return -1; }
    h += (size_t)w;

    for (size_t i = 0; i < resp->header_count && i < LUME_WEB_HEADER_MAX; i++) {
        const char *name = resp->headers[i].name, *value = resp->headers[i].value;
        if (name == NULL || value == NULL) continue;
        if (strchr(name, '\r') || strchr(name, '\n') ||
            strchr(value, '\r') || strchr(value, '\n') ||
            strchr(name, ':')) continue;
        if (strcasecmp(name, "Content-Length") == 0 ||
            strcasecmp(name, "Connection") == 0) continue;
        w = snprintf(head + h, sizeof(head) - h, "%s: %s\r\n", name, value);
        if (w <= 0 || (size_t)w >= sizeof(head) - h) break;  /* head full: stop adding */
        h += (size_t)w;
    }
    if (h + 2 > sizeof(head)) { send_status(fd, 500); close_cur(); return -1; }
    head[h++] = '\r';
    head[h++] = '\n';
    TickType_t send_start = s_seen[s_cur];
    if (!send_bounded(fd, (const uint8_t *)head, h, send_start)) {
        close_cur();
        return LUME_WEB_ERR_STATE;
    }
    /* Stream the body in small chunks straight from JS-owned memory. */
    const uint8_t *body = resp->body != NULL ? resp->body : (const uint8_t *)"";
    bool body_sent = send_bounded(fd, body, body_len, send_start);
    close_cur();
    return body_sent ? LUME_WEB_OK : LUME_WEB_ERR_STATE;
}
