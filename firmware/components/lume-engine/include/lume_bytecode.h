#pragma once
/* ------------------------------------------------------------------------
 * lume_bytecode (r43b): app BYTECODE PAYLOAD header.
 *
 * Portable C (C99, no ESP-IDF / FreeRTOS / quickjs.h includes) so it can be
 * included by the firmware (lume_engine.c) and by host ABI harnesses
 * (tests/bridge_protocol.c) without pulling in target headers.
 *
 * A bytecode push uses a "LUMB" frame (see lume_frame.h). Its payload is NOT
 * raw qjsc output -- it is this fixed 16-byte header followed by the raw
 * JS_WriteObject(..., JS_WRITE_OBJ_BYTECODE) blob produced by `qjsc -b -C`:
 *
 *   offset 0..3    magic = 'L' 'Q' 'B' 'C' ("LQBC")
 *   offset 4       QJS_VERSION_MAJOR of the QuickJS that compiled the bundle
 *   offset 5       QJS_VERSION_MINOR
 *   offset 6       QJS_VERSION_PATCH
 *   offset 7       BC_VERSION -- must equal byte 0 of the raw qjsc blob
 *   offset 8..11   reserved, all zero
 *   offset 12..15  body_len (u32 LE) = byte count of the raw qjsc blob
 *   offset 16..    raw qjsc bytecode (starts with BC_VERSION)
 *
 * The firmware checks the QJS version and the BC_VERSION byte BEFORE calling
 * JS_ReadObject(); JS_ReadObject() itself also rejects a BC_VERSION mismatch
 * with a SyntaxError (quickjs.c JS_ReadObjectAtoms). Neither path crashes.
 * Source-path ("LUME") frames are unaffected: eval_buf() dispatches on this
 * header's magic, so both payload kinds coexist on the same staging slot.
 *
 * Header fields are deliberately byte offsets, not a packed struct: the wire
 * format must not depend on C struct padding/endianness.
 * ------------------------------------------------------------------------ */
#include <stdint.h>

#define LUME_BC_MAGIC        "LQBC"
#define LUME_BC_MAGIC_LEN    4u
#define LUME_BC_HDR_LEN      16u

#define LUME_BC_OFF_MAJOR    4u
#define LUME_BC_OFF_MINOR    5u
#define LUME_BC_OFF_PATCH    6u
#define LUME_BC_OFF_BCVER    7u
#define LUME_BC_OFF_RESERVED 8u   /* 4 bytes, all zero */
#define LUME_BC_OFF_BODYLEN  12u  /* u32 LE */

/* Negative error codes returned by eval_bytecode_buf() (0 = success).
 * Mapped to stable "RELOAD ERR <reason>" tokens for the pushing channel. */
#define LUME_BC_ERR_HEADER      (-1)
#define LUME_BC_ERR_QJS_VERSION (-2)
#define LUME_BC_ERR_BC_VERSION  (-3)
#define LUME_BC_ERR_LENGTH      (-4)
#define LUME_BC_ERR_READ        (-5)
#define LUME_BC_ERR_EVAL        (-6)

#define LUME_BC_REASON_HEADER      "bc-header"
#define LUME_BC_REASON_QJS_VERSION "bc-version"
#define LUME_BC_REASON_BC_VERSION  "bc-version"
#define LUME_BC_REASON_LENGTH      "bc-length"
#define LUME_BC_REASON_READ        "bc-read"
#define LUME_BC_REASON_EVAL        "bc-eval"
