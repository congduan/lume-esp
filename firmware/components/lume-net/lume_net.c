/**
 * lume-net: WiFi station + basic HTTP client (M2 / r11).
 *
 * Pure C (no QuickJS); see include/lume_net.h for the status contract, the
 * ESP-IDF v5.5.5 API evidence table and the thread/task discipline. The
 * lume_engine.c natives marshal JS args into these calls.
 *
 * WHY a spinlock: the WIFI_EVENT / IP_EVENT handlers run on the "sys_evt"
 * task (core 0), NOT on the engine task ("lume-js", core 1). Connection state
 * written by the handler and read by status()/http_get() is therefore guarded
 * by s_state_mux (portMUX_TYPE). The handler only does integer/flag writes
 * inside the critical section and formats/logs the IP OUTSIDE it. All other
 * state (init latch, netif handles) is engine-task-only and needs no lock.
 *
 * NVS timing (verified, not assumed): lume_net_init() is called from
 * lume_engine.c register_bindings(), which runs at the start of EVERY fresh
 * runtime on the engine task (lume_engine.c:1202). lume_kv_init() (which calls
 * nvs_flash_init()) runs a few lines earlier in the SAME function
 * (lume_engine.c:933), so NVS is already up when WiFi inits. We still call the
 * idempotent nvs_flash_init() here so lume-net is self-contained even if the
 * KV init failed: WiFi needs NVS (CONFIG_ESP_WIFI_NVS_ENABLED=y) for PHY cal
 * data / credentials. Never erase the partition on failure (r10 policy).
 *
 * CREDENTIALS: never logged, copied into a stack wifi_config_t, wiped with
 * memset right after esp_wifi_set_config(). The url is never logged either
 * (query strings may carry tokens).
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_ip_addr.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "lume_net.h"

static const char *TAG = "lume-net";

/* ---- Connection state: written by sys_evt task, read by engine task ---- */
static portMUX_TYPE s_state_mux = portMUX_INITIALIZER_UNLOCKED;
static lume_net_state_t s_state = LUME_NET_DISCONNECTED;
static uint32_t s_ip4;              /* network-order addr, 0 = none */

/* ---- Engine-task-only lifecycle state (no lock needed) ---- */
static bool s_ready;                /* station fully up */
static bool s_init_ok;              /* successful init latched for process life */
static bool s_netif_inited;         /* esp_netif_init() done */
static bool s_loop_ready;           /* default event loop exists */
static bool s_wifi_inited;          /* esp_wifi_init() done */
static bool s_handlers_on;          /* both event handlers registered */
static bool s_started;              /* esp_wifi_start() done */
static esp_netif_t *s_sta_netif;
static esp_event_handler_instance_t s_wifi_hdl;
static esp_event_handler_instance_t s_ip_hdl;

/* Single funnel for the WiFi-not-available degradation path: EVERY public
 * entry point (except init) calls this first, so a failed/absent init yields a
 * uniform -3 and never a crash. Mirrors lume_kv.c require_ready(). */
static int require_ready(void)
{
    if (!s_ready) {
        ESP_LOGW(TAG, "WiFi not initialized (init failed / not called)");
        return LUME_NET_ERR_STATE;
    }
    return LUME_NET_OK;
}

static int map_err(esp_err_t err, const char *what)
{
    if (err == ESP_OK) {
        return LUME_NET_OK;
    }
    /* Never log credentials / url here: `what` is only an API name. */
    ESP_LOGW(TAG, "%s failed: %s", what, esp_err_to_name(err));
    return LUME_NET_ERR_DRIVER;
}

/* Guarded read of "do we have a usable IP" (http_get gate). */
static bool wifi_has_ip(void)
{
    bool ok;
    portENTER_CRITICAL(&s_state_mux);
    ok = (s_state == LUME_NET_GOT_IP);
    portEXIT_CRITICAL(&s_state_mux);
    return ok;
}

/* ------------------------------------------------------------------ */
/* Event handler -- runs on the "sys_evt" task (core 0), NOT engine.   */
/* Only integer/flag writes inside the critical section.               */
/* ------------------------------------------------------------------ */
static void wifi_evt_handler(void *arg, esp_event_base_t base,
                             int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT) {
        switch (id) {
        case WIFI_EVENT_STA_START:
        case WIFI_EVENT_STA_STOP:
        case WIFI_EVENT_STA_DISCONNECTED:
            portENTER_CRITICAL(&s_state_mux);
            s_state = LUME_NET_DISCONNECTED;
            s_ip4 = 0;
            portEXIT_CRITICAL(&s_state_mux);
            if (id == WIFI_EVENT_STA_DISCONNECTED) {
                ESP_LOGW(TAG, "sta disconnected");   /* no credentials */
            }
            break;
        case WIFI_EVENT_STA_CONNECTED:              /* associated, DHCP pending */
            portENTER_CRITICAL(&s_state_mux);
            s_state = LUME_NET_CONNECTED;
            s_ip4 = 0;
            portEXIT_CRITICAL(&s_state_mux);
            break;
        default:
            break;
        }
    } else if (base == IP_EVENT) {
        if (id == IP_EVENT_STA_GOT_IP) {
            ip_event_got_ip_t *ev = (ip_event_got_ip_t *)data;
            uint32_t addr = ev->ip_info.ip.addr;   /* struct esp_ip4_addr.addr */
            portENTER_CRITICAL(&s_state_mux);
            s_state = LUME_NET_GOT_IP;
            s_ip4 = addr;
            portEXIT_CRITICAL(&s_state_mux);
            char ipbuf[LUME_NET_IP_STR_MAX];
            esp_ip4_addr_t a = { .addr = addr };
            esp_ip4addr_ntoa(&a, ipbuf, sizeof(ipbuf));
            ESP_LOGI(TAG, "got ip %s", ipbuf);       /* no credentials */
        } else if (id == IP_EVENT_STA_LOST_IP) {
            portENTER_CRITICAL(&s_state_mux);
            s_state = LUME_NET_CONNECTED;           /* still associated */
            s_ip4 = 0;
            portEXIT_CRITICAL(&s_state_mux);
        }
    }
}

/* ------------------------------------------------------------------ */
/* WiFi station lifecycle                                            */
/* ------------------------------------------------------------------ */
int lume_net_init(void)
{
    if (s_init_ok) {
        return s_ready ? LUME_NET_OK : LUME_NET_ERR_STATE;
    }

    esp_err_t err;

    /* 1. NVS. WiFi (CONFIG_ESP_WIFI_NVS_ENABLED=y) shares the default "nvs"
     *    partition with lume.storage.kv. Idempotent; a missing/broken
     *    partition yields -3 and does NOT latch (r10 degradation policy). */
    err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "nvs_flash_init failed: %s; WiFi bindings disabled",
                 esp_err_to_name(err));
        return LUME_NET_ERR_STATE;
    }

    /* Each subsequent step is guarded so a failed init is RESUMABLE: the next
     * register_bindings() (hot-reload runtime reset) skips completed steps and
     * retries only the missing ones. No double-create, no leak, no abort. */
    if (!s_netif_inited) {
        err = esp_netif_init();       /* guarded/idempotent in esp_netif_lwip.c:536 */
        if (err != ESP_OK) {
            return map_err(err, "esp_netif_init");
        }
        s_netif_inited = true;
    }
    if (!s_loop_ready) {
        err = esp_event_loop_create_default();
        if (err == ESP_OK || err == ESP_ERR_INVALID_STATE) {
            /* INVALID_STATE = loop already exists (owned elsewhere). We never
             * delete the default loop (see deinit / docs r11). */
            s_loop_ready = true;
        } else {
            return map_err(err, "esp_event_loop_create_default");
        }
    }
    if (s_sta_netif == NULL) {
        s_sta_netif = esp_netif_create_default_wifi_sta();
        if (s_sta_netif == NULL) {
            ESP_LOGW(TAG, "esp_netif_create_default_wifi_sta returned NULL");
            return LUME_NET_ERR_DRIVER;
        }
    }
    if (!s_wifi_inited) {
        wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
        err = esp_wifi_init(&cfg);
        if (err != ESP_OK) {
            return map_err(err, "esp_wifi_init");
        }
        s_wifi_inited = true;
    }
    if (!s_handlers_on) {
        err = esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                  wifi_evt_handler, NULL, &s_wifi_hdl);
        if (err != ESP_OK) {
            return map_err(err, "register WIFI_EVENT handler");
        }
        err = esp_event_handler_instance_register(IP_EVENT, ESP_EVENT_ANY_ID,
                                                  wifi_evt_handler, NULL, &s_ip_hdl);
        if (err != ESP_OK) {
            esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                  s_wifi_hdl);
            return map_err(err, "register IP_EVENT handler");
        }
        s_handlers_on = true;
    }
    if (!s_started) {
        err = esp_wifi_set_mode(WIFI_MODE_STA);
        if (err != ESP_OK) {
            return map_err(err, "esp_wifi_set_mode");
        }
        err = esp_wifi_start();
        if (err != ESP_OK) {
            return map_err(err, "esp_wifi_start");
        }
        s_started = true;
    }

    portENTER_CRITICAL(&s_state_mux);
    s_state = LUME_NET_DISCONNECTED;
    s_ip4 = 0;
    portEXIT_CRITICAL(&s_state_mux);

    s_ready = true;
    s_init_ok = true;   /* publish + latch only after full success */
    ESP_LOGI(TAG, "WiFi station up (WPA2-PSK only; handlers on sys_evt/core0, "
                  "engine task core1; WiFi IRAM opts disabled)");
    return LUME_NET_OK;
}

int lume_net_deinit(void)
{
    int r = require_ready();
    if (r != LUME_NET_OK) {
        return r;
    }
    esp_wifi_disconnect();
    esp_wifi_stop();
    if (s_handlers_on) {
        esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, s_wifi_hdl);
        esp_event_handler_instance_unregister(IP_EVENT, ESP_EVENT_ANY_ID, s_ip_hdl);
        s_handlers_on = false;
    }
    if (s_wifi_inited) {
        esp_wifi_deinit();
        s_wifi_inited = false;
    }
    if (s_sta_netif != NULL) {
        esp_netif_destroy(s_sta_netif);
        s_sta_netif = NULL;
    }
    /* s_netif_inited / s_loop_ready intentionally RETAINED: the netif layer
     * and the default event loop stay alive for the process lifetime; init()
     * tolerates an already-existing loop. See docs r11. */
    s_started = false;
    portENTER_CRITICAL(&s_state_mux);
    s_state = LUME_NET_DISCONNECTED;
    s_ip4 = 0;
    portEXIT_CRITICAL(&s_state_mux);
    s_ready = false;
    s_init_ok = false;   /* allow re-init; retained flags make it resumable */
    return LUME_NET_OK;
}

int lume_net_connect(const char *ssid, size_t ssid_len,
                     const char *password, size_t pass_len)
{
    int r = require_ready();
    if (r != LUME_NET_OK) {
        return r;
    }
    /* WPA2-PSK length defence. *_len are the REAL byte lengths from
     * JS_ToCStringLen; reject embedded NUL (would truncate in the driver's
     * ssid[32]/password[64] byte arrays). Never log the values. */
    if (ssid == NULL || password == NULL ||
        ssid_len == 0 || ssid_len > LUME_NET_SSID_MAX ||
        pass_len < LUME_NET_PASS_MIN || pass_len > LUME_NET_PASS_MAX ||
        memchr(ssid, '\0', ssid_len) != NULL ||
        memchr(password, '\0', pass_len) != NULL) {
        ESP_LOGW(TAG, "connect: invalid ssid/password length or embedded NUL");
        return LUME_NET_ERR_ARG;
    }

    wifi_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));      /* zero-init => NUL after short values */
    memcpy(cfg.sta.ssid, ssid, ssid_len);          /* ssid[32], <= 32 bytes */
    memcpy(cfg.sta.password, password, pass_len);  /* password[64], <= 63 + NUL */
    cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;  /* WPA2-PSK only */

    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
    memset(&cfg, 0, sizeof(cfg));      /* wipe credentials from the stack now */
    if (err != ESP_OK) {
        return map_err(err, "esp_wifi_set_config");
    }

    portENTER_CRITICAL(&s_state_mux);
    s_state = LUME_NET_CONNECTING;
    s_ip4 = 0;
    portEXIT_CRITICAL(&s_state_mux);

    /* Non-blocking: esp_wifi_connect() kicks off association; the sys_evt
     * handler advances state CONNECTING -> CONNECTED -> GOT_IP. init() already
     * called esp_wifi_start() at runtime boot (long before app JS can call
     * connect), so this is valid; a rare "not started" returns -2 (no crash). */
    err = esp_wifi_connect();
    if (err != ESP_OK) {
        portENTER_CRITICAL(&s_state_mux);
        s_state = LUME_NET_DISCONNECTED;
        portEXIT_CRITICAL(&s_state_mux);
        return map_err(err, "esp_wifi_connect");
    }
    ESP_LOGI(TAG, "connect started (WPA2-PSK); poll status() for state/ip");
    return LUME_NET_OK;
}

int lume_net_disconnect(void)
{
    int r = require_ready();
    if (r != LUME_NET_OK) {
        return r;
    }
    esp_err_t err = esp_wifi_disconnect();
    if (err != ESP_OK) {
        return map_err(err, "esp_wifi_disconnect");
    }
    portENTER_CRITICAL(&s_state_mux);
    s_state = LUME_NET_DISCONNECTED;
    s_ip4 = 0;
    portEXIT_CRITICAL(&s_state_mux);
    return LUME_NET_OK;
}

int lume_net_status(lume_net_status_t *out)
{
    memset(out, 0, sizeof(*out));   /* state = DISCONNECTED, ip = "" */
    int r = require_ready();
    if (r != LUME_NET_OK) {
        return r;
    }
    lume_net_state_t st;
    uint32_t ip4;
    portENTER_CRITICAL(&s_state_mux);
    st = s_state;
    ip4 = s_ip4;
    portEXIT_CRITICAL(&s_state_mux);

    out->state = st;
    if (ip4 != 0) {
        esp_ip4_addr_t a = { .addr = ip4 };
        esp_ip4addr_ntoa(&a, out->ip, sizeof(out->ip));
    }
    return LUME_NET_OK;
}

/* ------------------------------------------------------------------ */
/* Synchronous oneshot HTTP GET (esp_http_client)                     */
/* NOTE: esp_http_client_perform() BLOCKS the engine task for up to     */
/* timeout_ms -- hot-reload/touch events are stalled meanwhile.        */
/* An async/callback version is a LATER round (docs r11).             */
/* ------------------------------------------------------------------ */
typedef struct {
    uint8_t *buf;
    size_t   len;
    bool     truncated;
} http_sink_t;

static esp_err_t http_evt_handler(esp_http_client_event_t *evt)
{
    http_sink_t *sink = (http_sink_t *)evt->user_data;
    if (evt->event_id == HTTP_EVENT_ON_DATA && evt->data_len > 0 && sink != NULL) {
        size_t room = LUME_HTTP_BODY_MAX - sink->len;
        size_t take = (size_t)evt->data_len;
        if (take > room) {
            take = room;
            sink->truncated = true;      /* cap reached: truncate, don't overrun */
        }
        if (take > 0) {
            memcpy(sink->buf + sink->len, evt->data, take);
            sink->len += take;
        }
    }
    return ESP_OK;
}

int lume_net_http_get(const char *url, int timeout_ms,
                      lume_net_http_response_t *out)
{
    memset(out, 0, sizeof(*out));
    /* Uniform degradation: WiFi must be up AND have an IP. */
    int r = require_ready();
    if (r != LUME_NET_OK) {
        return r;
    }
    if (!wifi_has_ip()) {
        ESP_LOGW(TAG, "httpGet: WiFi has no IP yet (state != GOT_IP)");
        return LUME_NET_ERR_STATE;
    }

    /* URL defence. The url is never logged (query may carry secrets). Embedded
     * NULs are rejected by the native via JS_ToCStringLen; strlen() here is
     * then authoritative. Only the http(s) scheme is accepted this round. */
    if (url == NULL || url[0] == '\0') {
        return LUME_NET_ERR_ARG;
    }
    size_t ulen = strlen(url);
    if (ulen == 0 || ulen > LUME_HTTP_URL_MAX) {
        ESP_LOGW(TAG, "httpGet: url length %u out of range (1..%d)",
                 (unsigned)ulen, LUME_HTTP_URL_MAX);
        return LUME_NET_ERR_ARG;
    }
    if (strncmp(url, "http://", 7) != 0 &&
        strncmp(url, "https://", 8) != 0) {
        ESP_LOGW(TAG, "httpGet: only http(s):// URLs are supported");
        return LUME_NET_ERR_ARG;
    }
    if (timeout_ms <= 0) {
        timeout_ms = LUME_HTTP_TIMEOUT_DEFAULT_MS;
    }
    if (timeout_ms > LUME_HTTP_TIMEOUT_MAX_MS) {
        timeout_ms = LUME_HTTP_TIMEOUT_MAX_MS;
    }

    uint8_t *body = malloc(LUME_HTTP_BODY_MAX);
    if (body == NULL) {
        ESP_LOGW(TAG, "httpGet: body alloc failed (%d B)", LUME_HTTP_BODY_MAX);
        return LUME_NET_ERR_DRIVER;
    }
    http_sink_t sink = { .buf = body, .len = 0, .truncated = false };

    esp_http_client_config_t cfg = {
        .url = url,                    /* http:// this round; https has no CA bundle */
        .method = HTTP_METHOD_GET,
        .timeout_ms = timeout_ms,
        .event_handler = http_evt_handler,
        .user_data = &sink,
        .buffer_size = 2048,
        /* No crt_bundle_attach / cert_pem: TLS server verification is NOT set
         * up this round -> https:// will typically fail the handshake. See
         * docs/KNOWN-SIMPLIFICATIONS.md (r11). */
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (client == NULL) {
        ESP_LOGW(TAG, "httpGet: esp_http_client_init failed");
        free(body);
        return LUME_NET_ERR_DRIVER;
    }
    esp_err_t err = esp_http_client_perform(client);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "httpGet: perform failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        free(body);
        return LUME_NET_ERR_DRIVER;
    }
    /* HTTP-level codes (404/500/...) are SUCCESS results, not C errors. */
    out->status = esp_http_client_get_status_code(client);
    out->content_length = esp_http_client_get_content_length(client);
    out->body = body;
    out->body_len = sink.len;
    out->truncated = sink.truncated;
    esp_http_client_cleanup(client);
    return LUME_NET_OK;
}

void lume_net_http_free(lume_net_http_response_t *out)
{
    if (out == NULL) {
        return;
    }
    if (out->body != NULL) {
        free(out->body);
        out->body = NULL;
    }
    out->body_len = 0;
}
