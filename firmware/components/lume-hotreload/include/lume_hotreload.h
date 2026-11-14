#pragma once

/* ------------------------------------------------------------------------
 * lume-hotreload (M1): JS app push over the USB Serial/JTAG (USB CDC) port.
 *
 * Physical port: the ESP32-S3 USB Serial/JTAG peripheral, exposed to the host
 * as a CDC-ACM serial port. It is the SAME port the ESP console uses for
 * ESP_LOG output (CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y), so `RELOAD ...`
 * replies are interleaved with the normal boot/runtime logs on that port. The
 * future CLI filters for lines starting with "RELOAD ".
 *
 * Wire frame (all u32 fields LITTLE-ENDIAN):
 *
 *   offset 0..3   : magic = 'L' 'U' 'M' 'E'
 *   offset 4..7   : total_len (u32) = number of PAYLOAD bytes that follow the
 *                   12-byte header. The header is NOT included in total_len.
 *                   0 is rejected; > 256 KiB is rejected (drop + resync).
 *   offset 8..11  : crc32 (u32) = standard CRC-32 over the payload only,
 *                   i.e. esp_crc32_le(0, payload, total_len) on the device,
 *                   which equals zlib.crc32(payload) & 0xffffffff on the host.
 *   offset 12..   : payload = JS app SOURCE text (M1 uses JS_Eval source, not
 *                   bytecode). Bytes are copied verbatim; no embedded NUL is
 *                   expected but explicit lengths are used throughout.
 *
 * At an aligned frame boundary, four-byte control frames are also accepted:
 * "BACK" dispatches onBack (true = handled, false/unregistered = close the
 * current app and open the embedded demo); "PAUS" / "RESM" dispatch pause /
 * resume. They carry no payload or response. Callbacks always run on the
 * engine task, never on the USB RX task.
 *
 * Streaming parse / resync: the RX task reads the driver's byte stream into a
 * small state machine. It aligns on 4-byte "LUME" magic at frame boundaries;
 * on a bad magic, an over-limit/zero length, or a bad CRC it emits an
 * ESP_LOGE + one `RELOAD ERR <reason>` line and re-syncs on the next "LUME".
 * There is NO frame timeout (see docs/KNOWN-SIMPLIFICATIONS.md).
 *
 * Validation pass: payload is copied into a PSRAM staging buffer and handed to
 * lume_engine_request_reload(), which makes its own engine-side copy under a
 * mutex (the RX task and engine task never share a live pointer) and posts a
 * LUME_EVT_RELOAD. The engine then tears down only its QuickJS runtime and
 * boots the new app; LVGL / touch / board drivers are NOT restarted.
 *
 * TX reply: exactly ONE line per frame, reflecting the FINAL outcome.
 *   success            -> "RELOAD OK <len>\n"   (len = payload byte count)
 *   validation failure -> "RELOAD ERR <reason>\n"
 *   app eval failure   -> "RELOAD ERR eval-failed\n"  (engine falls back to
 *                         the previous good app / embedded demo)
 *   reason tokens: bad-magic, empty, too-large, oom, bad-crc, stage-oom,
 *                  eval-failed.
 * The OK/ERR-after-eval line is emitted by the engine through the result
 * callback registered here, so a frame that validates but fails to eval gets
 * an ERR (not a premature OK). The callback runs on the engine task; all TX
 * writes are serialized by a mutex.
 *
 * Driver ownership: usb_serial_jtag_driver_install() is called only if the
 * driver is not already installed (usb_serial_jtag_is_driver_installed()). A
 * plain USJ console does NOT install the driver at boot (it uses the no-driver
 * LL path), so this normally installs it; a REPL/other consumer that already
 * installed it is reused. This matches the official usb_serial_jtag_echo
 * example's install/read/write API usage.
 * ------------------------------------------------------------------------ */
void lume_hotreload_start(void);
