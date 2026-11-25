/* r191 provenance (derived): no build comment in the original header. The
 * include "lume_ws_frame.h" resolves to lume-net/include, and the frame
 * assembler is lume-net/lume_ws_frame.c. Verified compile-green locally:
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-net/include \
 *     tests/ws_frame.c firmware/components/lume-net/lume_ws_frame.c \
 *     -o /tmp/lume_ws_frame && /tmp/lume_ws_frame
 */
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "lume_ws_frame.h"

int main(void)
{
    lume_ws_frame_t f = {0};
    uint8_t *out = NULL;
    size_t len = 0;
    bool binary = false;
    uint8_t temporary[] = {1, 2, 3};
    assert(lume_ws_frame_push(&f, 2, true, 3, 0, temporary, 2,
                             &out, &len, &binary) == 0);
    temporary[0] = 99; temporary[1] = 99;
    assert(lume_ws_frame_push(&f, 2, true, 3, 2, temporary + 2, 1,
                             &out, &len, &binary) == 1);
    assert(len == 3 && binary && out[0] == 1 && out[1] == 2 && out[2] == 3);
    free(out);
    assert(lume_ws_frame_push(&f, 1, false, 2, 0, (uint8_t *)"ab", 2,
                             &out, &len, &binary) == 0);
    assert(lume_ws_frame_push(&f, 0, true, 2, 0, (uint8_t *)"cd", 2,
                             &out, &len, &binary) == 1);
    assert(len == 4 && !binary && memcmp(out, "abcd", 4) == 0);
    free(out);
    assert(lume_ws_frame_push(&f, 2, true, 65537, 0, temporary, 1,
                             &out, &len, &binary) == -1);
    lume_ws_frame_reset(&f);
    puts("WebSocket owned-copy frame C test: PASS");
    return 0;
}
