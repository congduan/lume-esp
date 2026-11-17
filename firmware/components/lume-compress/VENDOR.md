# VENDOR.md — lume-compress vendored sources

## miniz 3.1.0 tinfl (DEFLATE decompressor)

- **File:** `miniz_tinfl.c` (single self-contained file, included by `lume_compress.c`)
- **Upstream:** https://github.com/richgel999/miniz — `miniz_tinfl.c`,
  `miniz_tinfl.h`, `miniz_common.h` at tag 3.1.0 (last updated 2013-10-13).
- **Author:** Rich Geldreich; Copyright 2013-2014 RAD Game Tools and Valve
  Software; Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC.
- **License:** public domain (Unlicense) / MIT, permissive. Upstream license
  text is reproduced verbatim at the top of `miniz_tinfl.c`. Vendoring a copy
  is explicitly permitted.
- **What it implements:** RFC 1951 raw DEFLATE and RFC 1950 zlib wrapper via
  the `tinfl_decompress` coroutine. No dynamic allocation in the coroutine.
- **Lume modifications (all documented at the top of `miniz_tinfl.c`):**
  1. Merged the type/flag/status/struct declarations from `miniz_common.h` +
     `miniz_tinfl.h` into the single `.c` so there are no external miniz
     headers and no build-system dependency.
  2. Kept only `tinfl_init`, `tinfl_clear_tree` and `tinfl_decompress`; the
     malloc-based high-level helpers were intentionally dropped (Lume uses a
     caller-owned fixed-size output buffer).
  3. Forced `TINFL_USE_64BIT_BITBUF 0` so host (x86_64) and firmware (Xtensa)
     compile the identical 32-bit code path; inflate output is bit-width
     independent.
  4. The inflate coroutine body (upstream lines 36-671) is byte-for-byte
     verbatim; the exact slice boundaries are marked in the file.

No other third-party code is vendored here. No upstream file under
`firmware/components/quickjs-ng/` or `firmware/components/lvgl/` was touched.
