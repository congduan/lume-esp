#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint8_t *data;
    size_t len;
    size_t frame_base;
    bool binary;
} lume_ws_frame_t;

void lume_ws_frame_reset(lume_ws_frame_t *frame);
/* Returns 1 with an owned complete payload, 0 while incomplete, -1 on error. */
int lume_ws_frame_push(lume_ws_frame_t *frame, uint8_t opcode, bool fin,
                       size_t total, size_t offset, const uint8_t *chunk,
                       size_t count, uint8_t **out, size_t *out_len,
                       bool *out_binary);
