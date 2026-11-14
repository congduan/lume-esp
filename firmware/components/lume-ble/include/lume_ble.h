/**
 * lume-ble: NimBLE GATT peripheral (Nordic UART Service shape), r25.
 *
 * Pure C, no QuickJS dependency. lume_engine.c marshals JS arguments into
 * these calls and hangs the natives under `lume.ble`. Mirrors lume-net:
 * status contract is 0 / negative error codes, init is idempotent across
 * hot-reload runtime resets, a failed init is non-fatal and degrades every
 * other entry point to -3.
 *
 * THREAD DISCIPLINE: the NimBLE host task ("ble_host") owns GAP/GATT
 * callbacks; all public functions here are called from the engine task only.
 * State shared between the two (connection, flags, rx queue) is guarded by a
 * portMUX spinlock. Callbacks never touch QuickJS and only write flags /
 * copy <= LUME_BLE_PAYLOAD_MAX bytes inside the critical section.
 *
 * SCOPE (see docs/KNOWN-SIMPLIFICATIONS.md r25):
 *  - peripheral / GATT server only. No central, scanner, observer,
 *    multi-connection, pairing/bonding, encryption, or MITM.
 *  - one 128-bit NUS-shaped service, RX (write / write-no-rsp) + TX (notify).
 *  - fixed 20-byte payload (default ATT_MTU 23 minus 3 opcode+handle bytes).
 *    No MTU negotiation, no fragmentation. Oversized writes are rejected.
 *  - data is treated as UTF-8 text by the JS layer; binary ArrayBuffer
 *    read/write is a later round.
 *  - the controller + host stay alive for the process lifetime. There is no
 *    deinit(): stop() ends advertising and any connection. Apps must stop()
 *    before light sleep; the stack is NOT wired into lume.power.
 *  - BLE payloads and device names are NEVER logged.
 *
 * Status contract:
 *   0  LUME_BLE_OK           success
 *  -1  LUME_BLE_ERR_ARG      bad name / data length / out buffer / embedded NUL
 *  -2  LUME_BLE_ERR_DRIVER   NimBLE / ESP-IDF call failed, or allocation failed
 *  -3  LUME_BLE_ERR_STATE    stack not initialized / not synced / not connected
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUME_BLE_OK           0
#define LUME_BLE_ERR_ARG      (-1)
#define LUME_BLE_ERR_DRIVER   (-2)
#define LUME_BLE_ERR_STATE    (-3)

/** Default ATT_MTU (23) minus 3 bytes of ATT header. No fragmentation. */
#define LUME_BLE_PAYLOAD_MAX  20
/** Bounded FIFO of inbound packets; full queue drops the OLDEST entry. */
#define LUME_BLE_RX_SLOTS     8
/** Scan response name must fit a 31-byte AD structure. */
#define LUME_BLE_NAME_MAX     24

typedef enum {
    LUME_BLE_IDLE        = 0,   /* initialized, not advertising              */
    LUME_BLE_ADVERTISING = 1,   /* advertising, waiting for a central        */
    LUME_BLE_CONNECTED   = 2,   /* one central connected (advertising stops) */
} lume_ble_state_t;

typedef struct {
    lume_ble_state_t state;
    bool   connected;
    bool   subscribed;          /* central enabled notifications on TX        */
    uint16_t mtu;               /* last BLE_GAP_EVENT_MTU value (23 default) */
    uint8_t pending;            /* unread packets in the bounded FIFO         */
} lume_ble_status_t;

/**
 * One-time stack setup: NVS, nimble_port_init(), host config, GATT service
 * registration, and the dedicated host task. Idempotent; a successful init
 * latches for the process lifetime. Init is LAZY: register_bindings() only
 * publishes the JS functions, the radio starts on the first start()/init()
 * call so apps that never use BLE pay no runtime cost.
 * Returns 0 / -2 / -3.
 */
int lume_ble_init(void);

/**
 * Set the advertised device name and start undirected general-discoverable
 * advertising. `name` may be NULL to keep the current/default name ("Lume").
 * name_len is the REAL byte length; embedded NUL, empty and > NAME_MAX
 * return -1. If the host has not synced yet, advertising starts from the
 * sync callback. Returns 0 / -1 / -2 / -3.
 */
int lume_ble_start(const char *name, size_t name_len);

/** Stop advertising and terminate the current connection (best effort). */
int lume_ble_stop(void);

/** Snapshot of the shared state. Returns 0 / -1 / -3. */
int lume_ble_status(lume_ble_status_t *out);

/**
 * Notify the connected central with one TX packet. 1..PAYLOAD_MAX bytes.
 * Returns 0 / -1 / -2 / -3 (-3 when no connection / no TX handle).
 */
int lume_ble_write(const uint8_t *data, size_t len);

/**
 * Pop the oldest inbound RX packet. `out` must hold PAYLOAD_MAX bytes and
 * receives `*out_len` bytes. Returns the packet length (>0), 0 when the
 * queue is EMPTY, or a negative error code.
 */
int lume_ble_read(uint8_t *out, size_t cap, size_t *out_len);
