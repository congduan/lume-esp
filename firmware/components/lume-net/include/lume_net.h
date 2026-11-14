/**
 * lume-net: WiFi station + basic HTTP client behind the lume.net /
 * lume.net.http JS bindings (M2 / r11).
 *
 * Pure C, no QuickJS dependency: the lume_engine.c natives marshal JS args
 * and turn these int statuses / structs into JS values.
 *
 * THREAD DISCIPLINE (verified against ESP-IDF v5.5.5 source, not assumed):
 *  - Public entry points (init/deinit/connect/disconnect/status/http_get) run
 *    ONLY on the QuickJS engine task ("lume-js", pinned core 1,
 *    lume_engine.c:1327-1329). Same task as every other lume.* binding.
 *  - WIFI_EVENT / IP_EVENT handlers do NOT run on the engine task:
 *    esp_event_loop_create_default() spawns a DEDICATED task named "sys_evt",
 *    pinned to core 0 (default_event_loop.c:98-104 -> esp_event.c:576-579
 *    xTaskCreatePinnedToCore(esp_event_loop_run_task, ...)), which is where
 *    handler_execute() dispatches callbacks (esp_event.c:676/686/696). So the
 *    event handler (writer, core 0) and status() (reader, core 1) are on
 *    DIFFERENT tasks/cores. The shared connection state is therefore guarded
 *    by a portMUX_TYPE spinlock critical section (the same lightweight pattern
 *    as lume_engine.c's s_rm_mux); the handler only ever does integer/flag
 *    assignments inside the critical section (no libc, no logging), and the
 *    IP string is formatted on the reader side OUTSIDE the lock.
 *  - All on-engine-task state (s_ready / init latch / netif handles) needs no
 *    lock; only the event-updated connection state does.
 *
 * Status contract (returned to JS as a NUMBER), mirrors lume_kv.h / r10:
 *   0   LUME_NET_OK           success
 *  -1   LUME_NET_ERR_ARG      invalid SSID/password/url/options (length, NUL)
 *  -2   LUME_NET_ERR_DRIVER   an ESP-IDF wifi/netif/event/http_client call failed
 *  -3   LUME_NET_ERR_STATE    WiFi not initialized / not connected with an IP
 *                            (uniform degradation), or NVS unavailable on init
 *
 * DEGRADATION: init() failure is NON-FATAL (WARN only, no abort) and does NOT
 * latch, so the next register_bindings() pass (hot-reload runtime reset)
 * retries; a SUCCESSFUL init latches for the process lifetime (r8/r9/r10
 * policy). require_ready() funnels EVERY other entry point to -3 when WiFi is
 * down, so a missing NVS partition / failed driver init can never crash the
 * JS runtime. http_get() additionally requires state GOT_IP (a usable IP),
 * else -3.
 *
 * CREDENTIALS: the SSID/password are validated and copied into a local
 * wifi_config_t, used for esp_wifi_set_config(), then memset to 0. They are
 * NEVER passed to ESP_LOG*. The event handler logs only state transitions and
 * the assigned IP, never the SSID/password. (The official station example
 * logs "SSID:%s password:%s" at the end -- deliberately NOT copied here.)
 * The HTTP url is likewise never logged: a query string may carry tokens.
 *
 * ESP-IDF v5.5.5 API facts verified in /opt/esp/esp-idf before coding:
 *  - nvs_flash.h:78            nvs_flash_init(void) -> esp_err_t; idempotent
 *                              (nvs_partition_manager.cpp:41-44 returns ESP_OK
 *                              when the partition is already registered)
 *  - esp_netif.h:30            esp_netif_init(void) -> esp_err_t; guarded by
 *                              LWIP_CORE_IS_TCPIP_INITIALIZED (esp_netif_lwip.c:536)
 *  - default_event_loop.c:92   esp_event_loop_create_default(); returns
 *                              ESP_ERR_INVALID_STATE if it already exists (:94-95)
 *  - esp_err.h:27              ESP_ERR_INVALID_STATE = 0x103
 *  - esp_wifi_default.h:95    esp_netif_create_default_wifi_sta(void) -> esp_netif_t*
 *  - esp_netif.h:59           esp_netif_destroy(esp_netif_t *)
 *  - esp_wifi.h:316           WIFI_INIT_CONFIG_DEFAULT() macro
 *  - esp_wifi.h:364/376/392/421/434/471/482/1028
 *                              esp_wifi_init/deinit/set_mode/start/stop/
 *                              connect/disconnect/set_config
 *  - esp_wifi_types_generic.h:559-560  wifi_sta_config_t.ssid[32], .password[64]
 *  - esp_wifi_types_generic.h:1196-1197  MAX_SSID_LEN 32, MAX_PASSPHRASE_LEN 64
 *  - esp_wifi_types_generic.h:90        WIFI_AUTH_WPA2_PSK
 *  - esp_wifi_types_generic.h:370-376  wifi_scan_threshold_t.authmode
 *  - esp_wifi_types_generic.h:1067-1072 WIFI_EVENT_STA_{START,STOP,CONNECTED,DISCONNECTED}
 *  - esp_event.h:139/247/274/343       esp_event_handler_register /
 *                              instance_register / unregister / ESP_EVENT_ANY_ID
 *  - esp_netif_types.h:99/111/132-136  IP_EVENT_STA_GOT_IP, ip_event_got_ip_t
 *  - esp_netif_ip_addr.h:109-113       struct esp_ip4_addr { uint32_t addr; }
 *  - esp_netif.h:879          esp_ip4addr_ntoa(const esp_ip4_addr_t*, char*, int)
 *                              (lwip impl esp_netif_lwip.c:454 -> ip4addr_ntoa_r)
 *  - esp_http_client.h:160-239 esp_http_client_config_t (.url/.method/.timeout_ms/
 *                              .event_handler/.user_data/.buffer_size)
 *  - esp_http_client.h:113    HTTP_METHOD_GET = 0
 *  - esp_http_client.h:35-46  HTTP_EVENT_{ERROR,ON_DATA,ON_FINISH,...}
 *  - esp_http_client.h:51-59  esp_http_client_event_t (.data/.data_len/.user_data)
 *  - esp_http_client.h:296/327/688/700/738
 *                              init / perform / get_status_code /
 *                              get_content_length / cleanup
 *  - esp_wifi/Kconfig:274-299 ESP_WIFI_IRAM_OPT / RX_IRAM_OPT save >10K/>17K
 *                              IRAM when disabled (see sdkconfig r11 note)
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUME_NET_OK           0
#define LUME_NET_ERR_ARG     (-1)
#define LUME_NET_ERR_DRIVER  (-2)
#define LUME_NET_ERR_STATE   (-3)

/* True whenever the WiFi driver has been started, including association and
 * disconnected states. Engine-task-only, like the other public net calls. */
bool lume_net_wifi_started(void);

/* r26: spinlock-guarded "does the station have a usable IPv4 (GOT_IP)" query.
 * UNLIKE the other public entry points (engine-task-only), this reads ONLY the
 * s_state_mux-protected state and is safe to call from ANY task. Used by the
 * WiFi-OTA push channel (lume-hotreload) to gate its TCP listener: it binds
 * only after connect/GOT_IP and stops when WiFi drops. */
bool lume_net_has_ip(void);

/* WPA2-PSK station only (r11 simplification). SSID <= MAX_SSID_LEN(32) bytes;
 * password is 8..63 bytes (WPA2 passphrase; .password[64] leaves room for the
 * NUL). Verified: esp_wifi_types_generic.h:559-560, 1196-1197. */
#define LUME_NET_SSID_MAX    32
#define LUME_NET_PASS_MIN    8
#define LUME_NET_PASS_MAX    63

/* "255.255.255.255" = 15 chars + NUL. */
#define LUME_NET_IP_STR_MAX  16

/* Bounded response body (malloc'd once, truncated beyond this) and timeout. */
#define LUME_HTTP_BODY_MAX          (32 * 1024)
#define LUME_HTTP_URL_MAX           512
#define LUME_HTTP_TIMEOUT_DEFAULT_MS 5000
#define LUME_HTTP_TIMEOUT_MAX_MS     30000

/* status() state enum (returned to JS as a number). CONNECTED = associated but
 * DHCP not done yet; GOT_IP = has an IPv4 address and is usable for httpGet. */
typedef enum {
    LUME_NET_DISCONNECTED = 0,
    LUME_NET_CONNECTING   = 1,
    LUME_NET_CONNECTED    = 2,
    LUME_NET_GOT_IP       = 3,
} lume_net_state_t;

typedef struct {
    lume_net_state_t state;
    char ip[LUME_NET_IP_STR_MAX];   /* "" when no IP (native maps to JS null) */
} lume_net_status_t;

typedef struct {
    int      status;          /* HTTP status code (e.g. 200/404); NOT an error code */
    uint8_t *body;            /* heap buffer, caller owns -> lume_net_http_free */
    size_t   body_len;
    int64_t  content_length;  /* esp_http_client_get_content_length (may be -1) */
    bool     truncated;       /* response exceeded LUME_HTTP_BODY_MAX */
} lume_net_http_response_t;

/* One-time WiFi station setup: nvs_flash_init + netif + default event loop +
 * esp_netif_create_default_wifi_sta + esp_wifi_init + event handlers +
 * set_mode(STA) + start. Idempotent (success latches for the process lifetime,
 * like lume_kv_init); a FAILED init does NOT latch and returns -3 (NVS) /
 * -2 (driver). Non-fatal: never aborts. Call from register_bindings() on every
 * fresh runtime (r8/r9/r10 policy). */
int lume_net_init(void);

/* Tear the station down (stop/deinit wifi, unregister handlers, destroy the
 * sta netif) and clear the latch so a later init() can run again. The default
 * event loop is intentionally NOT deleted (left for the process lifetime;
 * init() tolerates an already-existing loop) -- see docs/KNOWN-SIMPLIFICATIONS.md
 * (r11). Returns 0 or -3 when WiFi is not up. */
int lume_net_deinit(void);

/* Non-blocking connection start. Validates lengths (SSID 1..32, password
 * 8..63, no embedded NUL), sets WPA2-PSK threshold, stores the config, and
 * fires esp_wifi_connect(); returns immediately while the event handler later
 * moves DISCONNECTED -> CONNECTING -> CONNECTED -> GOT_IP. Returns 0 or a
 * negative error code. `ssid`/`password` are NUL-terminated C strings; the
 * *_len arguments are their real byte lengths (from JS_ToCStringLen). */
int lume_net_connect(const char *ssid, size_t ssid_len,
                     const char *password, size_t pass_len);

/* Disconnect from the AP (non-blocking; the DISCONNECTED event clears the
 * state/IP). Returns 0 or a negative error code. */
int lume_net_disconnect(void);

/* Snapshot the connection state (guarded read) and format the IPv4 string.
 * Returns 0 with a populated out, or a negative error code. */
int lume_net_status(lume_net_status_t *out);

/* Synchronous oneshot GET. `url` is a NUL-terminated "http://..." string
 * (https:// is accepted by the URL parser but has NO CA bundle configured this
 * round -- see docs r11; prefer http://). `timeout_ms` is clamped to
 * [1, LUME_HTTP_TIMEOUT_MAX_MS] (<=0 -> default). Returns 0 with a populated
 * out (status/body/content_length/truncated) on a completed transfer; an
 * HTTP-level code such as 404 is a SUCCESS with out.status == 404. Returns -3
 * when WiFi is not up / no IP, -1 on a bad url/timeout, -2 on an
 * esp_http_client failure. On success the caller OWNS out->body and MUST call
 * lume_net_http_free(). */
int lume_net_http_get(const char *url, int timeout_ms,
                      lume_net_http_response_t *out);

/* Release the heap body returned by lume_net_http_get() (no-op otherwise). */
void lume_net_http_free(lume_net_http_response_t *out);
