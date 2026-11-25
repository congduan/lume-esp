/* r191 provenance (derived): no build comment in the original header. The
 * include "lume_cmd.h" resolves to lume-hotreload/include, and the parser
 * implementation is lume-hotreload/lume_cmd.c -- same closure as the CI
 * apps_protocol.c entry. Verified compile-green locally:
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *     -I firmware/components/lume-hotreload/include \
 *     -I firmware/components/lume-engine/include \
 *     tests/file_protocol.c firmware/components/lume-hotreload/lume_cmd.c \
 *     -o /tmp/lume_file_protocol && /tmp/lume_file_protocol
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "lume_cmd.h"

static void check(const char *s, int want, lume_cmd_kind_t kind)
{
    lume_cmd_t cmd;
    int got = lume_cmd_parse((const uint8_t *)s, strlen(s), &cmd);
    assert(got == want);
    if (got == 0) assert(cmd.kind == kind);
}

int main(void)
{
    lume_cmd_t cmd;
    const char *put = "FPUT\tfile\tsd:/media/a.bin\t0\t4\na\0b\x7f";
    assert(lume_cmd_parse((const uint8_t *)put, 34, &cmd) == 0);
    assert(cmd.kind == LUME_CMD_FPUT && cmd.data_len == 4 && cmd.data[1] == 0);
    check("FPUT\tsd:/x\t0\t4", LUME_CMD_ERR_FORMAT, 0);
    check("FPUT\tconfig\tsd:/x\t0\t1\nx", LUME_CMD_ERR_ARG, 0);
    check("FPUT\tsd:/x\t5\t4\nx", LUME_CMD_ERR_ARG, 0);
    check("FPUT\tsd:/x\t0\t8388609\nx", LUME_CMD_ERR_ARG, 0);
    check("FPUT\tsd:/../x\t0\t1\nx", LUME_CMD_ERR_ARG, 0);
    check("FPUT\tfs:/x\t0\t2\nabc", LUME_CMD_ERR_ARG, 0);
    check("FLS\tfs:/", LUME_CMD_OK, LUME_CMD_FLS);
    check("FLS\tfs:/media/", LUME_CMD_OK, LUME_CMD_FLS);
    check("FDEL\tsd:/a", LUME_CMD_OK, LUME_CMD_FDEL);
    check("FGET\tsd:/a\t0\t768", LUME_CMD_OK, LUME_CMD_FGET);
    check("FGET\tsd:/a\t0\t769", LUME_CMD_ERR_ARG, 0);
    check("LIST", LUME_CMD_OK, LUME_CMD_LIST);
    puts("file protocol parser: 13 PASS");
}
