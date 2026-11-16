/**
 * lume-webserv (r71): tiny LAN HTTP SERVER, JS-defined routes.
 *
 * The device is a micro web-app server: C owns ONLY the transport and the
 * minimal HTTP/1.0 protocol; every route and the whole page body are written
 * by the running JS app (`lume.net.web.on`) and hot-distributed with it.
 *
 * THREAD DISCIPLINE: every public entry point runs on the engine task
 * ("lume-js", core 1). There is NO background web task and NO cross-task
 * queue/semaphore bridge: the engine's ~20 ms event loop calls
 * lume_webserv_poll() directly, which does a non-blocking select/recv and
 * hands one complete request to the engine; the engine calls the JS handler
 * synchronously and immediately calls lume_webserv_respond(). This avoids the
 * deadlock risk of a second task waiting on a single-threaded JS runtime.
 * (Rationale recorded in docs/r71-webserv-report.md.)
 *
 * LIFECYCLE (mirrors the WiFi-OTA channel in lume-hotreload.c exactly):
 *  - start() records the token and latches "enabled"; the listener is bound
 *    ONLY while lume_net_has_ip() is true, and is closed when WiFi drops.
 *  - The engine calls lume_webserv_stop() on EVERY fresh runtime, so an app
 *    switch / close / failed eval can never leave a zombie port behind.
 *  - start() is EXPLICIT and requires a token; there is no default-open port.
 *
 * SECURITY: token mandatory (constant-time compared from the `key` query
 * param, no/mismatched token -> 403 BEFORE any JS dispatch); paths are NEVER
 * interpreted as filesystem paths (no file-read surface); body capped at
 * 8 KiB; at most 2 concurrent TCP connections; one shared bounded request
 * buffer in PSRAM (~9 KiB). HTTP/1.0 short connections only, Connection:
 * close on every response. No keep-alive / chunked / TLS (out of scope).
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef CONFIG_LUME_WEB_PORT
#define CONFIG_LUME_WEB_PORT 8080
#endif

#define LUME_WEB_OK           0
#define LUME_WEB_ERR_ARG     (-1)
#define LUME_WEB_ERR_STATE   (-2)  /* no WiFi IP / not started */
#define LUME_WEB_ERR_BUSY    (-3)  /* already running */
#define LUME_WEB_ERR_MEM     (-4)

#define LUME_WEB_BODY_MAX     (8u * 1024u)
#define LUME_WEB_HEAD_MAX     1024u
#define LUME_WEB_METHOD_MAX   8u
#define LUME_WEB_PATH_MAX     192u
#define LUME_WEB_QUERY_MAX    320u
#define LUME_WEB_TOKEN_MAX    64u
#define LUME_WEB_URL_MAX      160u
#define LUME_WEB_HEADER_MAX   8u
#define LUME_WEB_SEND_CHUNK   512u
#define LUME_WEB_MAX_CONN     2u
#define LUME_WEB_IO_TIMEOUT_S 5u
#define LUME_WEB_BACKLOG      2

/* ---- Pure parser types (defined in lume_webserv_parse.c, host-testable) -- */
typedef struct {
    char    method[LUME_WEB_METHOD_MAX];
    char    path[LUME_WEB_PATH_MAX];    /* raw path (no '?' part, no decoding) */
    char    query[LUME_WEB_QUERY_MAX];  /* raw query after '?', may be "" */
    size_t  body_offset;                /* offset of body in the raw request buffer */
    size_t  body_len;                   /* Content-Length */
    bool    connection_close;           /* explicit Connection: close (we close regardless) */
} lume_web_parsed_t;

/* Parse one COMPLETE HTTP request in buf[0..len). `cap` is the buffer size
 * (used to bound Content-Length). Returns 0 on success, negative on malformed:
 *  -1 bad/missing request line, -2 missing header terminator, -3 bad
 *  Content-Length, -4 body > LUME_WEB_BODY_MAX, -5 path/query too long,
 *  -6 embedded NUL in the head. Pure: no lwip/FreeRTOS/QuickJS dependency. */
int lume_webserv_parse(const char *buf, size_t len, size_t cap,
                       lume_web_parsed_t *out);

/* ---- Engine-facing request / response ---------------------------------- */
/* `body` points into webserv's bounded buffer and stays valid until the
 * matching lume_webserv_respond() call. */
typedef struct {
    char         method[LUME_WEB_METHOD_MAX];
    char         path[LUME_WEB_PATH_MAX];
    char         query[LUME_WEB_QUERY_MAX];
    const char  *body;
    size_t       body_len;
} lume_web_request_t;

typedef struct {
    const char *name;
    const char *value;
} lume_web_header_t;

typedef struct {
    int                     status;        /* HTTP status code (200/404/...) */
    const lume_web_header_t *headers;      /* extra headers, may be NULL */
    size_t                  header_count;  /* <= LUME_WEB_HEADER_MAX */
    const uint8_t          *body;          /* borrowed; sent in chunks */
    size_t                  body_len;
} lume_web_response_t;

/* All engine-task-only. See the thread-discipline note above. */
int  lume_webserv_start(int port, const char *token);
int  lume_webserv_stop(void);
/* Fill `out` with "http://<ip>:<port>/?key=<token>". Returns LUME_WEB_OK,
 * or LUME_WEB_ERR_STATE when not listening / no WiFi IP yet. */
int  lume_webserv_url(char *out, size_t cap);
/* Non-blocking. Returns 1 with a complete request in `req` (call respond()
 * exactly once afterwards), 0 when nothing is ready, negative on C error
 * (already handled/logged internally; engine should just skip this tick). */
int  lume_webserv_poll(lume_web_request_t *req);
/* Write the response to the client from the last successful poll and close
 * that connection. Must be called once per returned request. */
int  lume_webserv_respond(const lume_web_response_t *resp);
/* Constant-time-ish comparison of the `key=<token>` query parameter. */
bool lume_webserv_token_ok(const char *query, const char *token);
