#pragma once
#include <stdio.h>
/* Returns 1 for a valid v2.3/v2.4 tag, 0 when absent, -1 on malformed input.
 * Output fields are UTF-8 and always NUL terminated. */
int id3v2_parse(FILE *file, char title[128], char artist[128], char album[128]);
