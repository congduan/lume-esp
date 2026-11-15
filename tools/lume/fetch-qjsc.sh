#!/usr/bin/env bash
# Build the host `qjsc` bytecode compiler from the VENDORED QuickJS-NG sources.
#
# Run once before `lume deploy --bytecode`:
#   tools/lume/fetch-qjsc.sh
#
# No network, no external toolchain, no vendored-source edits: gcc plus the
# exact source list from firmware/components/quickjs-ng/meson.build (which is
# authoritative -- do NOT infer the list from memory):
#   qjs_srcs      = dtoa.c, libregexp.c, libunicode.c, quickjs.c
#   qjs_libc_srcs = quickjs-libc.c
#   qjsc_srcs     = qjsc.c
# qjsc links [qjs_dep, qjs_libc_dep] with c_args -D_GNU_SOURCE; the project
# adds -DQUICKJS_NG_BUILD and -funsigned-char.
#
# Output: tools/lume/bin/qjsc (override with LUME_QJSC or CC).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
qjs="$root/firmware/components/quickjs-ng"
perf="$root/firmware/components/lume-perf/include"
out="$root/tools/lume/bin/qjsc"
cc=${CC:-cc}

for f in qjsc.c quickjs.c dtoa.c libregexp.c libunicode.c quickjs-libc.c; do
  [[ -f "$qjs/$f" ]] || { echo "vendored source missing: $qjs/$f" >&2; exit 1; }
done

# quickjs.c unconditionally includes lume_perf.h, which includes "sdkconfig.h"
# (an ESP-IDF generated header). Provide a host stub with the r36b profile
# hook OFF so the vendored GC timer compiles to a no-op on the host.
stub=$(mktemp -d)
trap 'rm -rf "$stub"' EXIT
printf '#define CONFIG_LUME_PERF_PROFILE 0\n' > "$stub/sdkconfig.h"

mkdir -p "$(dirname "$out")"
"$cc" -O2 -std=gnu11 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -DQJS_BUILD_LIBC \
  -funsigned-char -I"$qjs" -I"$stub" -I"$perf" \
  "$qjs/qjsc.c" "$qjs/quickjs.c" "$qjs/dtoa.c" "$qjs/libregexp.c" \
  "$qjs/libunicode.c" "$qjs/quickjs-libc.c" \
  -o "$out" -lm -lpthread -ldl

echo "built $out"
"$out" -h 2>&1 | head -1 || true
