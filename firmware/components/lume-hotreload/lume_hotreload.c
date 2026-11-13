/**
 * Hot reload over USB Serial/JTAG (USB CDC), M1 implementation.
 *
 * See lume_hotreload.h for the full wire protocol and ownership notes.
 * Verified against ESP-IDF v5.5 installed headers:
 *   - component esp_driver_usb_serial_jtag, header driver/usb_serial_jtag.h
 *     (NOT the old usb_serial_jtag_driver.h name), APIs
 *     usb_serial_jtag_driver_install / _read_bytes / _write_bytes /
 *     _is_driver_installed, USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT.
 *   - crc32 via esp_crc.h (component esp_hw_support), esp_crc32_le() which is
 *     a thin inline wrapper over esp_rom_crc32_le(crc, buf, len). With crc=0
 *     this is standard CRC-32 (zlib.crc32) over the buffer.
 */
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_crc.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "lume_engine.h"
#include "lume_hotreload.h"

static const char *TAG = "lume-hotreload";

#define LUME_MAGIC            "LUME"
#define LUME_MAGIC_LEN        4
#define LUME_LEN_FIELD_LEN    4    /* total_len u32 (payload byte count) */
#define LUME_CRC_FIELD_LEN    4    /* crc32 u32 */
#define LUME_HDR_FIELDS_LEN   (LUME_LEN_FIELD_LEN + LUME_CRC_FIELD_LEN)
#define LUME_MAX_PAYLOAD      (256u * 1024u)   /* 256 KiB hard cap */
#define LUME_RX_CHUNK         128
#define LUME_RX_STACK         4096
#define LUME_USJ_RX_BUFFER    1024  /* driver requires > 64 */
#define LUME_USJ_TX_BUFFER    512
#define LUME_TX_LINE_MAX      64

/* Serializes all TX writes: validation failures originate on the RX task,
 * the final OK/ERR-after-eval originates on the engine task via the callback. */
static SemaphoreHandle_t s_tx_mutex;

/* ------------------------------------------------------------------ */
/* TX reply (also the engine's reload-result callback)                  */
/* ------------------------------------------------------------------ */
static void respond(bool ok, size_t len, const char *reason)
{
    char line[LUME_TX_LINE_MAX];
    int n;
    if (ok) {
        n = snprintf(line, sizeof(line), "RELOAD OK %u\n", (unsigned)len);
    } else {
        n = snprintf(line, sizeof(line), "RELOAD ERR %s\n",
                     reason != NULL ? reason : "unknown");
    }
    if (n <= 0) {
        return;
    }
    if ((size_t)n >= sizeof(line)) {
        n = (int)sizeof(line) - 1;   /* snprintf truncation: reasons are short */
    }
    if (s_tx_mutex != NULL) {
        xSemaphoreTake(s_tx_mutex, portMAX_DELAY);
    }
    /* write_bytes can legitimately return 0 (TX mutex/ring-buffer timeout);
     * a silently dropped reply would leave the host waiting forever. */
    int written = usb_serial_jtag_write_bytes(line, (size_t)n, pdMS_TO_TICKS(50));
    if (written != (int)n) {
        ESP_LOGE(TAG, "reply TX short/failed (%d/%d)", written, n);
    }
    if (s_tx_mutex != NULL) {
        xSemaphoreGive(s_tx_mutex);
    }
}

/* ------------------------------------------------------------------ */
/* Streaming frame parser (RX-task-only state, no locking needed)       */
/* ------------------------------------------------------------------ */
typedef enum {
    ST_MAGIC,    /* aligned: read exactly 4 bytes, validate magic */
    ST_HDR,      /* read 8 bytes (total_len + crc32) */
    ST_BODY,     /* read total_len payload bytes into PSRAM */
    ST_RESYNC,   /* silent rolling 4-byte scan for "LUME" after an error */
} parse_state_t;

static parse_state_t s_state = ST_MAGIC;
static uint8_t s_magic[LUME_MAGIC_LEN];   /* aligned magic read (ST_MAGIC) */
static int     s_magic_n;
static uint8_t s_hdr[LUME_HDR_FIELDS_LEN];
static int     s_hdr_n;
static uint8_t s_sync[LUME_MAGIC_LEN];    /* rolling window, kept in ALL states
                                          * so resync never loses overlap */
static int     s_sync_n;
static uint8_t *s_payload;                /* PSRAM frame/staging buffer */
static size_t  s_payload_len;
static size_t  s_payload_n;
static uint32_t s_want_crc;

static void sync_push(uint8_t b)
{
    s_sync[0] = s_sync[1];
    s_sync[1] = s_sync[2];
    s_sync[2] = s_sync[3];
    s_sync[3] = b;
    if (s_sync_n < LUME_MAGIC_LEN) {
        s_sync_n++;
    }
}

static bool sync_is_magic(void)
{
    return s_sync_n == LUME_MAGIC_LEN &&
           memcmp(s_sync, LUME_MAGIC, LUME_MAGIC_LEN) == 0;
}

static uint32_t le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void enter_magic(void)
{
    s_state = ST_MAGIC;         /* next frame starts on an aligned boundary */
    s_magic_n = 0;
}

static void enter_resync(void)
{
    /* The rolling window s_sync already holds the trailing bytes; a magic
     * ending exactly at the error boundary must not be lost, so test it
     * BEFORE the first new byte arrives. No errors are emitted while
     * re-syncing on noise. */
    if (sync_is_magic()) {
        s_state = ST_HDR;
        s_hdr_n = 0;
        return;
    }
    s_state = ST_RESYNC;
}

static void reject(const char *reason, size_t len)
{
    ESP_LOGE(TAG, "frame rejected: %s (len=%u)", reason, (unsigned)len);
    respond(false, len, reason);
}

static void feed(uint8_t b)
{
    sync_push(b);               /* always maintain the rolling window */

    switch (s_state) {
    case ST_MAGIC:
        s_magic[s_magic_n++] = b;
        if (s_magic_n == LUME_MAGIC_LEN) {
            s_magic_n = 0;
            if (memcmp(s_magic, LUME_MAGIC, LUME_MAGIC_LEN) == 0) {
                s_state = ST_HDR;
                s_hdr_n = 0;
            } else {
                /* ---- bad magic ---- */
                ESP_LOGE(TAG, "bad magic: %02x %02x %02x %02x",
                         s_magic[0], s_magic[1], s_magic[2], s_magic[3]);
                reject("bad-magic", 0);
                enter_resync();
            }
        }
        break;

    case ST_RESYNC:
        if (sync_is_magic()) {
            s_state = ST_HDR;   /* the 4 magic bytes were just consumed */
            s_hdr_n = 0;
        }
        break;

    case ST_HDR:
        s_hdr[s_hdr_n++] = b;
        if (s_hdr_n == LUME_HDR_FIELDS_LEN) {
            s_hdr_n = 0;
            uint32_t total_len = le32(s_hdr);          /* payload byte count */
            s_want_crc = le32(s_hdr + LUME_LEN_FIELD_LEN); /* crc32 over payload */

            if (total_len == 0) {
                /* ---- zero length ---- */
                reject("empty", 0);
                enter_resync();
            } else if (total_len > LUME_MAX_PAYLOAD) {
                /* ---- oversize: drop + resync, no allocation ---- */
                ESP_LOGE(TAG, "payload too large: %u > %u (drop + resync)",
                         (unsigned)total_len, (unsigned)LUME_MAX_PAYLOAD);
                reject("too-large", total_len);
                enter_resync();
            } else {
                s_payload = heap_caps_malloc(total_len, MALLOC_CAP_SPIRAM);
                s_payload_len = total_len;
                s_payload_n = 0;
                if (s_payload == NULL) {
                    /* oom: still consume exactly total_len bytes to keep the
                     * boundary aligned; NULL payload == discard mode. */
                    reject("oom", total_len);
                }
                s_state = ST_BODY;
            }
        }
        break;

    case ST_BODY:
        if (s_payload != NULL) {
            s_payload[s_payload_n] = b;
        }
        s_payload_n++;
        if (s_payload_n == s_payload_len) {
            if (s_payload == NULL) {
                /* oom discard path: error already reported; boundary aligned */
                enter_magic();
                break;
            }
            uint32_t got = esp_crc32_le(0, s_payload, (uint32_t)s_payload_len);
            if (got != s_want_crc) {
                /* ---- bad crc ---- */
                ESP_LOGE(TAG, "bad crc: got %08x want %08x (len=%u)",
                         (unsigned)got, (unsigned)s_want_crc,
                         (unsigned)s_payload_len);
                reject("bad-crc", s_payload_len);
                heap_caps_free(s_payload);
                s_payload = NULL;
                enter_resync();
            } else {
                /* ---- valid frame: stage + request engine reload ----
                 * On success the engine emits the final RELOAD OK/ERR after
                 * eval via the registered callback. */
                if (lume_engine_request_reload((const char *)s_payload,
                                               s_payload_len) != 0) {
                    reject("stage-oom", s_payload_len);
                }
                heap_caps_free(s_payload);
                s_payload = NULL;
                enter_magic();
            }
        }
        break;
    }
}

static void rx_task(void *arg)
{
    (void)arg;
    uint8_t chunk[LUME_RX_CHUNK];
    for (;;) {
        int n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk),
                                           pdMS_TO_TICKS(20));
        for (int i = 0; i < n; i++) {
            feed(chunk[i]);
        }
    }
}

void lume_hotreload_start(void)
{
    s_tx_mutex = xSemaphoreCreateMutex();
    if (s_tx_mutex == NULL) {
        ESP_LOGE(TAG, "tx mutex create failed (OOM)");
        return;
    }

    if (!usb_serial_jtag_is_driver_installed()) {
        usb_serial_jtag_driver_config_t cfg = {
            .rx_buffer_size = LUME_USJ_RX_BUFFER,
            .tx_buffer_size = LUME_USJ_TX_BUFFER,
        };
        esp_err_t err = usb_serial_jtag_driver_install(&cfg);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "usb_serial_jtag_driver_install failed: %s",
                     esp_err_to_name(err));
            return;
        }
        ESP_LOGI(TAG, "USJ driver installed (rx=%u tx=%u)",
                 (unsigned)LUME_USJ_RX_BUFFER, (unsigned)LUME_USJ_TX_BUFFER);
    } else {
        ESP_LOGI(TAG, "USJ driver already installed; reusing it for RX");
    }
    /* Switch the console VFS from direct-FIFO (nonblocking LL) writes to the
     * driver. Otherwise ESP_LOG goes straight at the USJ FIFO while our
     * replies go through the driver, and concurrent TX can interleave or
     * clobber a RELOAD line. Idempotent; applies to both install paths. */
    usb_serial_jtag_vfs_use_driver();

    /* Final reload outcome (app eval OK / failed) is reported back to TX. */
    lume_engine_set_reload_result_cb(respond);

    BaseType_t ok = xTaskCreate(rx_task, "lume-hotreload-rx",
                                LUME_RX_STACK, NULL, 4, NULL);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "rx task create failed (%d)", (int)ok);
        return;
    }
    ESP_LOGI(TAG, "hot-reload up on USB Serial/JTAG; "
                  "frame LUME|len:u32le|crc32:u32le|payload, max=%u bytes",
             (unsigned)LUME_MAX_PAYLOAD);
}
