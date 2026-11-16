/* WebSocket transport. Only the component task touches receive buffers; the
 * engine task owns clients and destroys them after stop joins that task. */
#include <stdlib.h>
#include <string.h>
#include "esp_websocket_client.h"
#include "esp_crt_bundle.h"
#include "lume_net.h"
#include "lume_ws_frame.h"

#define WS_SLOTS 2
#define WS_MAX_MESSAGE (64u * 1024u)

typedef struct {
    esp_websocket_client_handle_t client;
    uint32_t id;
    lume_ws_frame_t rx;
} ws_slot_t;
static ws_slot_t s_ws[WS_SLOTS];
static uint32_t s_next_id;
static lume_net_ws_sink_t s_sink;

void lume_net_ws_set_sink(lume_net_ws_sink_t sink) { s_sink = sink; }

static void emit(ws_slot_t *slot, int event, uint8_t *data, size_t len, int binary)
{
    if (s_sink) s_sink(slot->id, event, data, len, binary);
    else free(data);
}

static void ws_event(void *arg, esp_event_base_t base, int32_t event, void *payload)
{
    (void)base;
    ws_slot_t *slot = arg;
    esp_websocket_event_data_t *e = payload;
    if (event == WEBSOCKET_EVENT_CONNECTED) {
        emit(slot, LUME_WS_OPEN, NULL, 0, 0);
    } else if (event == WEBSOCKET_EVENT_ERROR) {
        emit(slot, LUME_WS_ERROR, NULL, 0, 0);
    } else if (event == WEBSOCKET_EVENT_DISCONNECTED || event == WEBSOCKET_EVENT_CLOSED) {
        lume_ws_frame_reset(&slot->rx);
        emit(slot, LUME_WS_CLOSE, NULL, 0, 0);
    } else if (event == WEBSOCKET_EVENT_DATA && e && e->data_len >= 0 &&
               (e->op_code == 1 || e->op_code == 2 || e->op_code == 0)) {
        uint8_t *owned = NULL;
        size_t owned_len = 0;
        bool binary = false;
        int result = lume_ws_frame_push(&slot->rx, e->op_code, e->fin,
            (size_t)e->payload_len, (size_t)e->payload_offset,
            (const uint8_t *)e->data_ptr, (size_t)e->data_len,
            &owned, &owned_len, &binary);
        if (result < 0) emit(slot, LUME_WS_ERROR, NULL, 0, 0);
        else if (result > 0) emit(slot, LUME_WS_MESSAGE, owned, owned_len, binary);
    }
}

static ws_slot_t *find_slot(uint32_t id)
{
    for (int i = 0; i < WS_SLOTS; ++i)
        if (s_ws[i].client && s_ws[i].id == id) return &s_ws[i];
    return NULL;
}

int lume_net_ws_connect(const char *url, const char *headers, uint32_t *id)
{
    if (!url || !id || (strncmp(url, "ws://", 5) && strncmp(url, "wss://", 6)) ||
        strlen(url) > 2048) return -1;
    if (!lume_net_has_ip()) return -3;
    ws_slot_t *slot = NULL;
    for (int i = 0; i < WS_SLOTS; ++i)
        if (!s_ws[i].client) { slot = &s_ws[i]; break; }
    if (!slot) return -4;
    esp_websocket_client_config_t cfg = {
        .uri = url, .headers = headers, .disable_auto_reconnect = true,
        .crt_bundle_attach = esp_crt_bundle_attach, .buffer_size = 4096,
        .user_context = slot,
    };
    slot->id = ++s_next_id;
    if (!slot->id) slot->id = ++s_next_id;
    slot->client = esp_websocket_client_init(&cfg);
    if (!slot->client) return -2;
    if (esp_websocket_register_events(slot->client, WEBSOCKET_EVENT_ANY,
                                      ws_event, slot) != ESP_OK ||
        esp_websocket_client_start(slot->client) != ESP_OK) {
        esp_websocket_client_destroy(slot->client);
        slot->client = NULL;
        return -2;
    }
    *id = slot->id;
    return 0;
}

int lume_net_ws_send(uint32_t id, const uint8_t *data, size_t len, bool binary)
{
    ws_slot_t *slot = find_slot(id);
    if (!slot || !data || len > WS_MAX_MESSAGE) return -1;
    int n = binary ? esp_websocket_client_send_bin(slot->client, (const char *)data,
                    (int)len, pdMS_TO_TICKS(1000)) :
                    esp_websocket_client_send_text(slot->client, (const char *)data,
                    (int)len, pdMS_TO_TICKS(1000));
    return n == (int)len ? 0 : -2;
}

int lume_net_ws_close(uint32_t id)
{
    ws_slot_t *slot = find_slot(id);
    if (!slot) return -1;
    /* Attempt the close handshake, then join before reusing slot storage. */
    (void)esp_websocket_client_close(slot->client, pdMS_TO_TICKS(1000));
    esp_websocket_client_stop(slot->client);
    esp_websocket_client_destroy(slot->client);
    slot->client = NULL;
    lume_ws_frame_reset(&slot->rx);
    return 0;
}

void lume_net_ws_close_all(void)
{
    for (int i = 0; i < WS_SLOTS; ++i)
        if (s_ws[i].client) lume_net_ws_close(s_ws[i].id);
}
