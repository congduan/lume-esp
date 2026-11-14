/**
 * lume-ble: NimBLE GATT peripheral (r25). See include/lume_ble.h for the
 * status contract, thread discipline and the explicit scope limits.
 *
 * WHY a spinlock: GAP/GATT callbacks run on the NimBLE host task, while every
 * lume.ble native is invoked on the engine task (core 1). Connection state,
 * flags and the bounded RX FIFO are shared, so each access is wrapped in a
 * portMUX critical section. No ESP_LOG and no BLE payload logging inside a
 * critical section; RX copies at most 20 bytes there.
 *
 * WHY no JS callbacks: this round deliberately mirrors lume.imu.read() --
 * apps poll status()/read() from a lume.system.setInterval() timer, so the
 * host task never has to enter QuickJS (which is engine-task-only). An
 * event-driven onData(cb) would need a reverse queue + a dispatch point in
 * the engine loop; that is a later round (docs/KNOWN-SIMPLIFICATIONS.md r25).
 *
 * API shape follows ESP-IDF v5.5's NimBLE bleprph example:
 *   nimble_port_init() -> ble_hs_cfg.{reset,sync}_cb -> ble_svc_gap_device_
 *   name_set() -> ble_gatts_count_cfg()/add_svcs() -> nimble_port_freertos_
 *   init(host_task); host_task calls nimble_port_run() until stop. GAP calls
 *   made from the engine task are serialized by the host's own lock; the
 *   resulting events are delivered on the host task. This cross-task call
 *   pattern is used by the IDF examples too, but the exact timing still needs
 *   on-board acceptance (no board available on this host).
 *
 * DISCIPLINE (same as lume-net): failures are WARN + a negative status, never
 * abort() and never a JS exception. Device names and BLE payloads never enter
 * the log. A successful init latches; a partial init is resumable.
 */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"

#include "lume_ble.h"

static const char *TAG = "lume-ble";

/* BLE_HS_CONN_HANDLE_NONE == 0xffff; kept local so the header stays IDF-free. */
#define NO_CONN_HANDLE       ((uint16_t)0xffff)
#define ADV_ITVL_MIN_MS      100
#define ADV_ITVL_MAX_MS      200
#define DEFAULT_ATT_MTU      23

static int gap_event(struct ble_gap_event *event, void *arg);
static int rx_access(uint16_t conn_handle, uint16_t attr_handle,
                     struct ble_gatt_access_ctxt *ctxt, void *arg);
static int tx_access(uint16_t conn_handle, uint16_t attr_handle,
                     struct ble_gatt_access_ctxt *ctxt, void *arg);

/* Nordic UART Service UUIDs, 128-bit little-endian form:
 *   6e400001-b5a3-f393-e0a9-e50e24dcca9e  service
 *   6e400002-...                          RX  (central -> peripheral)
 *   6e400003-...                          TX  (peripheral -> central, notify)
 * Using the de-facto NUS UUIDs lets any phone BLE console connect without a
 * custom Lume app. */
/* Explicit initializers instead of BLE_UUID128_DECLARE(): a braced
 * initializer is valid for a file-scope const on every NimBLE version,
 * whereas the macro's expansion (compound literal in some releases) is not a
 * constant expression. ble_uuid128_t = { ble_uuid_t u; uint8_t value[16]; }. */
static const ble_uuid128_t s_svc_uuid = {
    .u.type = BLE_UUID_TYPE_128,
    .value = { 0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0,
               0x93, 0xf3, 0xa3, 0xb5, 0x01, 0x00, 0x40, 0x6e },
};
static const ble_uuid128_t s_rx_uuid = {
    .u.type = BLE_UUID_TYPE_128,
    .value = { 0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0,
               0x93, 0xf3, 0xa3, 0xb5, 0x02, 0x00, 0x40, 0x6e },
};
static const ble_uuid128_t s_tx_uuid = {
    .u.type = BLE_UUID_TYPE_128,
    .value = { 0x9e, 0xca, 0xdc, 0x24, 0x0e, 0xe5, 0xa9, 0xe0,
               0x93, 0xf3, 0xa3, 0xb5, 0x03, 0x00, 0x40, 0x6e },
};

/* Filled in by ble_gatts_add_svcs()/service registration on the host task.
 * Read by the engine task; registration completes before host sync. */
static volatile uint16_t s_tx_val_handle;

static const struct ble_gatt_chr_def s_chrs[] = {
    {
        .uuid = &s_rx_uuid.u,
        .access_cb = rx_access,
        .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
    },
    {
        .uuid = &s_tx_uuid.u,
        .access_cb = tx_access,
        .flags = BLE_GATT_CHR_F_NOTIFY,
        .val_handle = (uint16_t *)&s_tx_val_handle,
    },
    { 0 },
};

static const struct ble_gatt_svc_def s_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_svc_uuid.u,
        .characteristics = s_chrs,
    },
    { 0 },
};

/* ---- State shared by the host task and the engine task (guarded) ---- */
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static lume_ble_state_t s_state = LUME_BLE_IDLE;
static uint16_t s_conn_handle = NO_CONN_HANDLE;
static uint16_t s_mtu = DEFAULT_ATT_MTU;
static uint8_t  s_own_addr_type;          /* 0 = public, filled by on_sync */
static bool     s_synced;
static bool     s_want_adv;
static bool     s_subscribed;
static uint8_t  s_rx_head, s_rx_tail, s_rx_count;
static uint8_t  s_rx[LUME_BLE_RX_SLOTS][LUME_BLE_PAYLOAD_MAX];
static uint8_t  s_rx_len[LUME_BLE_RX_SLOTS];

/* ---- Engine-task-only lifecycle state (no lock needed) ---- */
static bool s_ready;                     /* stack up and usable             */
static bool s_init_ok;                   /* successful init latched         */
static bool s_port_inited;               /* nimble_port_init() done         */
static bool s_svcs_added;                /* GATT services registered once   */
static bool s_host_started;              /* host task created               */
static char s_name[LUME_BLE_NAME_MAX + 1] = "Lume";

/* Single funnel: a failed/absent init makes every entry point return -3. */
static int require_ready(void)
{
    if (!s_ready) {
        ESP_LOGW(TAG, "BLE stack not initialized (init/start failed or not called)");
        return LUME_BLE_ERR_STATE;
    }
    return LUME_BLE_OK;
}

static int map_ble_err(int rc, const char *what)
{
    if (rc == 0) {
        return LUME_BLE_OK;
    }
    /* `what` is only an API name: never a device name or a BLE payload. */
    ESP_LOGW(TAG, "%s failed: NimBLE rc=%d", what, rc);
    return LUME_BLE_ERR_DRIVER;
}

/* Push one inbound packet. Drops the OLDEST packet when the FIFO is full so
 * a stalled JS task still sees the most recent data. Called on the host task. */
static void rx_push(const uint8_t *data, uint16_t len)
{
    bool dropped = false;
    portENTER_CRITICAL(&s_mux);
    if (s_rx_count == LUME_BLE_RX_SLOTS) {
        s_rx_tail = (uint8_t)((s_rx_tail + 1) % LUME_BLE_RX_SLOTS);
        s_rx_count--;
        dropped = true;
    }
    uint8_t slot = s_rx_head;
    memcpy(s_rx[slot], data, len);
    s_rx_len[slot] = (uint8_t)len;
    s_rx_head = (uint8_t)((slot + 1) % LUME_BLE_RX_SLOTS);
    s_rx_count++;
    portEXIT_CRITICAL(&s_mux);
    if (dropped) {
        ESP_LOGW(TAG, "rx queue full: dropped oldest packet");
    }
}

/* ------------------------------------------------------------------ */
/* GATT                                                               */
/* ------------------------------------------------------------------ */
static int rx_access(uint16_t conn_handle, uint16_t attr_handle,
                     struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle; (void)attr_handle; (void)arg;
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    uint8_t buf[LUME_BLE_PAYLOAD_MAX];
    uint16_t len = 0;
    int rc = ble_hs_mbuf_to_flat(ctxt->om, buf, sizeof buf, &len);
    if (rc != 0) {
        /* Oversized write (> 20 bytes) or malformed mbuf: reject, do not
         * truncate silently. No payload content is logged. */
        ESP_LOGW(TAG, "rx write rejected (oversized/malformed, rc=%d)", rc);
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (len > 0) {
        rx_push(buf, len);
    }
    return 0;
}

static int tx_access(uint16_t conn_handle, uint16_t attr_handle,
                     struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    /* TX is notify-only. The callback exists because NimBLE requires one for
     * a registered characteristic; reads are never permitted. */
    (void)conn_handle; (void)attr_handle; (void)ctxt; (void)arg;
    return BLE_ATT_ERR_UNLIKELY;
}

/* ------------------------------------------------------------------ */
/* GAP / host lifecycle                                               */
/* ------------------------------------------------------------------ */
static int adv_start(uint8_t own_addr_type)
{
    if (ble_gap_adv_active()) {
        return LUME_BLE_OK;
    }
    struct ble_hs_adv_fields fields;
    memset(&fields, 0, sizeof fields);
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        return map_ble_err(rc, "ble_gap_adv_set_fields");
    }
    /* Name goes into the scan response (31-byte AD limit). No 128-bit service
     * UUID in the advertisement this round: centrals discover the service
     * through GATT after connecting. */
    memset(&fields, 0, sizeof fields);
    fields.name = (uint8_t *)ble_svc_gap_device_name();
    fields.name_len = (uint8_t)strlen((const char *)fields.name);
    fields.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&fields);
    if (rc != 0) {
        return map_ble_err(rc, "ble_gap_adv_rsp_set_fields");
    }

    struct ble_gap_adv_params params;
    memset(&params, 0, sizeof params);
    params.conn_mode = BLE_GAP_CONN_MODE_UND;
    params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    params.itvl_min = BLE_GAP_ADV_ITVL_MS(ADV_ITVL_MIN_MS);
    params.itvl_max = BLE_GAP_ADV_ITVL_MS(ADV_ITVL_MAX_MS);
    rc = ble_gap_adv_start(own_addr_type, NULL, BLE_HS_FOREVER,
                           &params, gap_event, NULL);
    if (rc != 0) {
        return map_ble_err(rc, "ble_gap_adv_start");
    }
    portENTER_CRITICAL(&s_mux);
    s_state = LUME_BLE_ADVERTISING;
    portEXIT_CRITICAL(&s_mux);
    ESP_LOGI(TAG, "advertising started (undirected, general discoverable)");
    return LUME_BLE_OK;
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT: {
        if (event->connect.status == 0) {
            portENTER_CRITICAL(&s_mux);
            s_conn_handle = event->connect.conn_handle;
            s_state = LUME_BLE_CONNECTED;
            portEXIT_CRITICAL(&s_mux);
            ESP_LOGI(TAG, "central connected (handle=%u)",
                     (unsigned)event->connect.conn_handle);
        } else {
            ESP_LOGW(TAG, "connect failed (status=%d)", event->connect.status);
            portENTER_CRITICAL(&s_mux);
            s_conn_handle = NO_CONN_HANDLE;
            s_state = LUME_BLE_IDLE;
            bool restart = s_want_adv;
            uint8_t addr_type = s_own_addr_type;
            portEXIT_CRITICAL(&s_mux);
            if (restart) {
                adv_start(addr_type);
            }
        }
        break;
    }
    case BLE_GAP_EVENT_DISCONNECT: {
        ESP_LOGI(TAG, "central disconnected (reason=%d)",
                 event->disconnect.reason);
        portENTER_CRITICAL(&s_mux);
        s_conn_handle = NO_CONN_HANDLE;
        s_subscribed = false;
        s_state = LUME_BLE_IDLE;
        bool restart = s_want_adv;
        uint8_t addr_type = s_own_addr_type;
        portEXIT_CRITICAL(&s_mux);
        if (restart) {
            adv_start(addr_type);   /* re-advertise for the next central */
        }
        break;
    }
    case BLE_GAP_EVENT_ADV_COMPLETE:
        /* BLE_HS_FOREVER: only a stack reset should end advertising. */
        ESP_LOGW(TAG, "advertising completed unexpectedly (reason=%d)",
                 event->adv_complete.reason);
        break;
    case BLE_GAP_EVENT_MTU:
        portENTER_CRITICAL(&s_mux);
        s_mtu = event->mtu.value;
        portEXIT_CRITICAL(&s_mux);
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        portENTER_CRITICAL(&s_mux);
        s_subscribed = (event->subscribe.cur_notify != 0);
        portEXIT_CRITICAL(&s_mux);
        break;
    default:
        break;
    }
    return 0;
}

static void on_reset(int reason)
{
    portENTER_CRITICAL(&s_mux);
    s_synced = false;
    s_conn_handle = NO_CONN_HANDLE;
    s_subscribed = false;
    s_state = LUME_BLE_IDLE;
    portEXIT_CRITICAL(&s_mux);
    ESP_LOGW(TAG, "NimBLE host reset (reason=%d)", reason);
}

static void on_sync(void)
{
    uint8_t addr_type = 0;
    int rc = ble_hs_id_infer_auto(0, &addr_type);
    if (rc != 0) {
        ESP_LOGW(TAG, "ble_hs_id_infer_auto failed (rc=%d); using public addr", rc);
    }
    portENTER_CRITICAL(&s_mux);
    s_own_addr_type = addr_type;
    s_synced = true;
    bool want_adv = s_want_adv;
    portEXIT_CRITICAL(&s_mux);
    if (s_tx_val_handle == 0) {
        ESP_LOGW(TAG, "TX characteristic handle missing; notify will fail (-3)");
    }
    ESP_LOGI(TAG, "NimBLE host synced");
    if (want_adv) {
        adv_start(addr_type);   /* a start() before sync is honoured here */
    }
}

static void ble_host_task(void *param)
{
    (void)param;
    nimble_port_run();              /* returns only after nimble_port_stop() */
    nimble_port_freertos_deinit();  /* IDF bleprph teardown pattern         */
}

/* ------------------------------------------------------------------ */
/* Public API (engine task only)                                      */
/* ------------------------------------------------------------------ */
int lume_ble_init(void)
{
    if (s_init_ok) {
        return s_ready ? LUME_BLE_OK : LUME_BLE_ERR_STATE;
    }

    /* NimBLE's store may use the default NVS partition (also used by
     * lume.storage.kv and lume-net). Idempotent; never erase on failure. */
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "nvs_flash_init failed: %s; BLE bindings disabled",
                 esp_err_to_name(err));
        return LUME_BLE_ERR_STATE;
    }

    if (!s_port_inited) {
        err = nimble_port_init();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "nimble_port_init failed: %s", esp_err_to_name(err));
            return LUME_BLE_ERR_DRIVER;
        }
        s_port_inited = true;
    }

    /* No pairing/bonding: ble_hs_cfg.sm_* defaults are left untouched
     * (sm_bonding=0, sm_mitm=0), which keeps this a trusted-local link. */
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;

    if (!s_svcs_added) {
        int rc = ble_gatts_count_cfg(s_svcs);
        if (rc != 0) {
            return map_ble_err(rc, "ble_gatts_count_cfg");
        }
        rc = ble_gatts_add_svcs(s_svcs);
        if (rc != 0) {
            return map_ble_err(rc, "ble_gatts_add_svcs");
        }
        s_svcs_added = true;   /* never register the same service twice */
    }

    int rc = ble_svc_gap_device_name_set(s_name);
    if (rc != 0) {
        return map_ble_err(rc, "ble_svc_gap_device_name_set");
    }

    if (!s_host_started) {
        /* IDF v5.5.5 declares `void nimble_port_freertos_init(TaskFunction_t)`
         * (nimble/porting/npl/freertos/include/nimble/nimble_port_freertos.h:46):
         * it creates the host task and reports no error. */
        nimble_port_freertos_init(ble_host_task);
        s_host_started = true;
    }

    s_ready = true;
    s_init_ok = true;   /* publish + latch only after full success */
    ESP_LOGI(TAG, "NimBLE peripheral ready (no pairing, 20-byte packets)");
    return LUME_BLE_OK;
}

int lume_ble_start(const char *name, size_t name_len)
{
    if (name != NULL) {
        if (name_len == 0 || name_len > LUME_BLE_NAME_MAX ||
            memchr(name, '\0', name_len) != NULL) {
            return LUME_BLE_ERR_ARG;
        }
    }
    int r = lume_ble_init();        /* lazy: first start() brings up the radio */
    if (r != LUME_BLE_OK) {
        return r;
    }
    if (name != NULL) {
        memcpy(s_name, name, name_len);
        s_name[name_len] = '\0';
    }
    int rc = ble_svc_gap_device_name_set(s_name);
    if (rc != 0) {
        return map_ble_err(rc, "ble_svc_gap_device_name_set");
    }

    portENTER_CRITICAL(&s_mux);
    s_want_adv = true;
    bool connected = (s_conn_handle != NO_CONN_HANDLE);
    bool synced = s_synced;
    uint8_t addr_type = s_own_addr_type;
    portEXIT_CRITICAL(&s_mux);
    if (connected) {
        return LUME_BLE_OK;         /* already linked; advertising is off */
    }
    if (!synced) {
        return LUME_BLE_OK;         /* on_sync() starts advertising */
    }
    return adv_start(addr_type);
}

int lume_ble_stop(void)
{
    int r = require_ready();
    if (r != LUME_BLE_OK) {
        return r;
    }
    portENTER_CRITICAL(&s_mux);
    s_want_adv = false;
    uint16_t conn = s_conn_handle;
    portEXIT_CRITICAL(&s_mux);

    int rc = ble_gap_adv_stop();
    if (rc != 0) {
        /* Not advertising is a normal outcome, not a failure. */
        ESP_LOGD(TAG, "ble_gap_adv_stop rc=%d (already stopped is normal)", rc);
    }
    if (conn != NO_CONN_HANDLE) {
        rc = ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
        if (rc != 0) {
            return map_ble_err(rc, "ble_gap_terminate");
        }
    }
    portENTER_CRITICAL(&s_mux);
    s_state = LUME_BLE_IDLE;
    s_conn_handle = NO_CONN_HANDLE;
    s_subscribed = false;
    portEXIT_CRITICAL(&s_mux);
    return LUME_BLE_OK;
}

int lume_ble_status(lume_ble_status_t *out)
{
    if (out == NULL) {
        return LUME_BLE_ERR_ARG;
    }
    int r = require_ready();
    if (r != LUME_BLE_OK) {
        return r;
    }
    portENTER_CRITICAL(&s_mux);
    out->state = s_state;
    out->connected = (s_conn_handle != NO_CONN_HANDLE);
    out->subscribed = s_subscribed;
    out->mtu = s_mtu;
    out->pending = s_rx_count;
    portEXIT_CRITICAL(&s_mux);
    return LUME_BLE_OK;
}

int lume_ble_write(const uint8_t *data, size_t len)
{
    if (data == NULL || len == 0 || len > LUME_BLE_PAYLOAD_MAX) {
        return LUME_BLE_ERR_ARG;
    }
    int r = require_ready();
    if (r != LUME_BLE_OK) {
        return r;
    }
    portENTER_CRITICAL(&s_mux);
    uint16_t conn = s_conn_handle;
    bool synced = s_synced;
    portEXIT_CRITICAL(&s_mux);
    uint16_t handle = s_tx_val_handle;
    if (!synced || conn == NO_CONN_HANDLE || handle == 0) {
        return LUME_BLE_ERR_STATE;
    }

    struct os_mbuf *om = ble_hs_mbuf_from_flat(data, (uint16_t)len);
    if (om == NULL) {
        ESP_LOGW(TAG, "ble_hs_mbuf_from_flat failed (out of mbufs)");
        return LUME_BLE_ERR_DRIVER;
    }
    /* Ownership of `om` passes to NimBLE (bleprph pattern): do not free it
     * here on either success or failure. */
    int rc = ble_gatts_notify_custom(conn, handle, om);
    if (rc != 0) {
        return map_ble_err(rc, "ble_gatts_notify_custom");
    }
    return LUME_BLE_OK;
}

int lume_ble_read(uint8_t *out, size_t cap, size_t *out_len)
{
    if (out == NULL || out_len == NULL || cap < LUME_BLE_PAYLOAD_MAX) {
        return LUME_BLE_ERR_ARG;
    }
    int r = require_ready();
    if (r != LUME_BLE_OK) {
        return r;
    }
    *out_len = 0;
    int ret = LUME_BLE_OK;
    portENTER_CRITICAL(&s_mux);
    if (s_rx_count > 0) {
        uint8_t slot = s_rx_tail;
        uint8_t n = s_rx_len[slot];
        memcpy(out, s_rx[slot], n);
        *out_len = n;
        s_rx_tail = (uint8_t)((slot + 1) % LUME_BLE_RX_SLOTS);
        s_rx_count--;
        ret = (int)n;
    }
    portEXIT_CRITICAL(&s_mux);
    return ret;   /* 0 = empty queue, >0 = bytes copied, <0 = error code */
}
