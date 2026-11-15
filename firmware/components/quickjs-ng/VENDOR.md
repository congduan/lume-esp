# QuickJS-NG vendored for Lume (ESP-IDF component)

Upstream: https://github.com/quickjs-ng/quickjs (cloned at HEAD on 2026-11-13)
Not vendored: tests/, examples/, .github/, docs/ — trimmed for repo size.

ESP-IDF build entry is this component's CMakeLists.txt (wraps the upstream
sources as a static lib); upstream CMakeLists/Makefile/meson are kept for
reference but unused by the firmware build.

## ESP-IDF build adaptations (2026-11-13)

- CMakeLists.txt `SRCS` corrected to mirror `meson.build`'s `qjs_srcs`
  (`dtoa.c`, `libregexp.c`, `libunicode.c`, `quickjs.c`). The previous list
  used the old upstream layout (`cutils.c`, `xsum.c`) that does not exist in
  quickjs-ng. Only the engine library is built: CLI/libc sources
  (`qjs.c`, `qjsc.c`, `quickjs-libc.c`) and the `gen/` samples are excluded,
  so no POSIX `fork`/`socket`/`epoll` dependencies are pulled into the target.
- `NO_TM_GMTOFF` is defined automatically by `quickjs.c` under `__NEWLIB__`
  (ESP-IDF's libc), so `struct tm.tm_gmtoff` needs no portability patch.
- `js__gettimeofday_us()` resolves to `gettimeofday()` (provided by ESP-IDF
  newlib); no host-time stubs required.
- `-Wno-error=format` added to the component's compile options. ESP-IDF
  builds with `-Werror=all`, but on this Xtensa newlib `uint32_t`/`int32_t`
  are `unsigned long`/`long`, so upstream's debug-printf helpers emit ~30
  `-Wformat` warnings (`%x`/`%u`/`%d`). They are harmless (same 32-bit
  width) and confined to `__maybe_unused` trace helpers, but would be fatal
  under `-Werror=all`. Downgraded to warnings rather than silenced.

(Further per-file stubs/cuts, if any, are recorded here with the reason.)

## r36b measurement hook

`quickjs.c` wraps `JS_RunGC` with a `CONFIG_LUME_PERF_PROFILE` guarded
`lume_perf` timer. The disabled build adds no instructions in the GC path.

## r43b host qjsc (no vendored source changes)

`tools/lume/fetch-qjsc.sh` builds the host `qjsc` from this directory using the
source list in `meson.build` (`qjs_srcs` + `qjs_libc_srcs` + `qjsc_srcs`). No
vendored file is edited. Two quirks are handled on the host side, not by
patching upstream:

- `quickjs.c` includes `lume_perf.h` -> `sdkconfig.h`; the script supplies a
  temporary stub defining `CONFIG_LUME_PERF_PROFILE 0` so the r36b hook is a
  host no-op without ESP-IDF.
- `JS_DetectModule()` defaults to "module", so plain Lume IIFE bundles must be
  compiled with `qjsc -C` (classic script); otherwise the blob is a
  `JS_TAG_MODULE` and `JS_EvalFunction()` runs it in module scope where the
  prelude globals are invisible. See `docs/r43b-bytecode-report.md`.
