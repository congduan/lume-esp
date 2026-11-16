#include <stdlib.h>
#include <string.h>
#include "lume_ws_frame.h"
#define WS_MAX_MESSAGE (64u * 1024u)

void lume_ws_frame_reset(lume_ws_frame_t *frame)
{
    free(frame->data);
    frame->data = NULL;
    frame->len = frame->frame_base = 0;
}

int lume_ws_frame_push(lume_ws_frame_t *frame, uint8_t opcode, bool fin,
                       size_t total, size_t offset, const uint8_t *chunk,
                       size_t count, uint8_t **out, size_t *out_len,
                       bool *out_binary)
{
    *out = NULL; *out_len = 0;
    if (total > WS_MAX_MESSAGE || offset > total || count > total - offset ||
        (count && !chunk) || (opcode != 0 && opcode != 1 && opcode != 2)) goto fail;
    if (offset == 0) {
        if (opcode == 1 || opcode == 2) {
            lume_ws_frame_reset(frame);
            frame->binary = opcode == 2;
        } else if (!frame->data) goto fail;
        frame->frame_base = frame->len;
        if (total > WS_MAX_MESSAGE - frame->frame_base) goto fail;
        size_t size = frame->frame_base + total;
        uint8_t *next = realloc(frame->data, size ? size : 1);
        if (!next) goto fail;
        frame->data = next; frame->len = size;
    }
    if (!frame->data || frame->len != frame->frame_base + total) goto fail;
    if (count) memcpy(frame->data + frame->frame_base + offset, chunk, count);
    if (fin && offset + count == total) {
        *out = frame->data; *out_len = frame->len; *out_binary = frame->binary;
        frame->data = NULL; frame->len = frame->frame_base = 0;
        return 1;
    }
    return 0;
fail:
    lume_ws_frame_reset(frame);
    return -1;
}
