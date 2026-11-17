#!/usr/bin/env bash
# Reproduce r78 host QuickJS bytecode and Float32Array measurements.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
qjs="$root/firmware/components/quickjs-ng"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
printf '#define CONFIG_LUME_PERF_PROFILE 0\n' > "$scratch/sdkconfig.h"
"$root/tools/lume/fetch-qjsc.sh" > /dev/null
python3 - "$scratch/app.js" <<'PY'
import sys
with open(sys.argv[1], 'w') as out:
    out.write('globalThis.r78Result=42;\n')
    for i in range(82000):
        out.write(f'var r78v{i}=({i}%97)+({i}%13);\n')
PY
"$root/tools/lume/bin/qjsc" -b -C -o "$scratch/app.qbc" -n app.js "$scratch/app.js"
${CC:-cc} -O2 -std=gnu11 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -funsigned-char \
  -I"$qjs" -I"$scratch" -I"$root/firmware/components/lume-perf/include" \
  "$root/tests/perf_r78.c" "$root/firmware/components/lume-engine/lume_math.c" \
  "$qjs/quickjs.c" "$qjs/dtoa.c" "$qjs/libregexp.c" "$qjs/libunicode.c" \
  -o "$scratch/perf_r78" -lm -lpthread -ldl
"$scratch/perf_r78" "$scratch/app.js" "$scratch/app.qbc"
