#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
qjs="$root/firmware/components/quickjs-ng"
stub=/tmp/lume-r79-qjs-stub
mkdir -p "$stub"
printf '#define CONFIG_LUME_PERF_PROFILE 0\n' > "$stub/sdkconfig.h"
gcc -O2 -std=gnu11 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -DQJS_BUILD_LIBC \
  -funsigned-char -I"$qjs" -I"$stub" -I"$root/firmware/components/lume-perf/include" \
  "$qjs/qjs.c" "$qjs/gen/repl.c" "$qjs/gen/standalone.c" \
  "$qjs/quickjs.c" "$qjs/dtoa.c" "$qjs/libregexp.c" \
  "$qjs/libunicode.c" "$qjs/quickjs-libc.c" \
  -o /tmp/lume-r79-qjs -lm -lpthread -ldl
