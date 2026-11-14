#pragma once
/* ------------------------------------------------------------------------
 * lume-hotreload (r26): JS app push channels, started once from app_main().
 *
 *   - USB Serial/JTAG (USB CDC) (M1): the same port as the ESP console; the
 *     CLI filters lines beginning with "RELOAD ".
 *   - WiFi TCP OTA (r26): authenticated server on CONFIG_LUME_OTA_PORT
 *     (default 8765), bound only while the WiFi station has an IPv4 address.
 *
 * Both channels feed their byte stream into a private instance of the SAME
 * portable frame codec (see include/lume_frame.h for the exact wire format:
 * LUME magic / u32le payload length / u32le crc32 / payload, plus the aligned
 * BACK/PAUS/RESM controls) and both push through the engine's hot-replacement
 * chain (lume_engine_request_reload -> lifecycle release -> eval new bundle).
 *
 * Replies: exactly one "RELOAD OK <len>\n" / "RELOAD ERR <reason>\n" line per
 * data frame, written back on the SAME channel that pushed it. Reason tokens:
 * bad-magic, empty, too-large, oom, bad-crc, stage-oom, eval-failed,
 * superseded. The engine emits the final line after eval, so a frame that
 * validates but fails to eval still gets an ERR (never a premature OK).
 *
 * OTA token: 16 random bytes hex-encoded, generated on first boot, persisted
 * in NVS, and logged at every boot (never hard-coded). Security boundary and
 * deferred items: docs/KNOWN-SIMPLIFICATIONS.md (r26).
 * ------------------------------------------------------------------------ */
void lume_hotreload_start(void);
