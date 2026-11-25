# r91 report - lume.crypto native primitives (SHA-256 / HMAC-SHA256 / CRC32 / AES-CTR)

Baseline: `13c2b76` (origin/main, r90 fishtank), worktree `/tmp/lume-r91-wt`, branch `r91-crypto`.
Model guard: `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`.

## 1. API decision (empirically settled, not assumed)

Read before coding:

- `firmware/components/lume-engine/lume_math.c:8-28` - `JS_GetTypedArrayBuffer` +
  `JS_GetArrayBuffer`, ArrayBuffer held alive, no JS call during pointer use.
  Error path here is `JS_ThrowTypeError` / `JS_ThrowRangeError`.
- `firmware/components/lume-engine/lume_fft.c:14-29, 70-106` - same zero-copy
  view helper, but returns `0 / -1 / -2 / -3` and writes into a caller-owned
  `out` view. This is also how `lume.imgscale.scale` works
  (`lume_imgscale.c`, `runtime/types/lume.d.ts:1056-1072`).
- `docs/roadmap.md:806-818` - contract discipline: 0 success / negative
  failure; typed arrays zero-copy via `JS_GetTypedArrayBuffer`, no JS
  callbacks during access; pure-compute primitives live in their own
  `firmware/components/lume-<name>/` component; all new code in flash
  `.text/.rodata`, IRAM 16384 Remain 0; `.d.ts` + `gen_api_docs.py --check` +
  both host/playground stubs.

**Decision: follow the `lume.fft` / `lume.imgscale` variant of the r78 pattern,
not the `lume.math` exception-throwing variant.** For the brief's
"write into out OR return a fresh Uint8Array, pick one" choice, we picked
**write into a caller-owned `Uint8Array out` and return a status code**. A
native-side allocation would break the 0/-code invariant and put allocation on
the hot path; callers allocate `new Uint8Array(32)` themselves. This is
recorded in `runtime/types/lume.d.ts` as the single documented contract.

Final API (`lume.crypto`):

| call | result | error codes |
|---|---|---|
| `sha256(data, out)` | 32-byte digest into `out` | -1 type, -2 `out` < 32 |
| `hmacSha256(key, data, out)` | 32-byte HMAC into `out` | -1 type, -2 `out` < 32 |
| `crc32(data, seed?)` | unsigned CRC-32 value (number) | -1 type/bad seed |
| `aesCtr(key, iv, data, out)` | `data.length` bytes into `out` (CTR symmetric) | -1 type, -2 key/iv/len/overlap, -3 mbedTLS failure |

Notes: every typed-array input is borrowed as raw bytes (any typed array is
accepted; element size is irrelevant); `out` must be a `Uint8Array`;
`subarray()` byteOffsets are honoured on all views; the caller's `iv` is copied
and never mutated; in-place `aesCtr` (`out === data`) is allowed, partial
overlap is rejected. No JS callbacks run while a backing store is borrowed.

CRC-32 is the one primitive not delegated to mbedTLS: mbedTLS 3.x dropped
`mbedtls_crc32` (no `crc32` symbol in `library/` or `include/mbedtls/`), and
ESP-IDF's `esp_crc32_le` is a ROM wrapper (`esp_hw_support/include/esp_crc.h`)
that cannot run in the host harness. We use a table-free reflected
0xEDB88320 loop in `lume_crypto.c` so the harness compiles the **exact same
source** as the firmware. CRC-32 is not a cryptographic primitive.

## 2. Host compile approach: chose (a), mbedTLS minimal closure on host

Brief offered (a) compile IDF mbedTLS files on host, or (b) pure-JS reference
plus an ESP32-side cross-check. We chose (a) because the repo's existing
native-primitive harnesses (`tests/fft.js`, `tests/imgscale.js`) already
compile the exact firmware `.c` into a host QuickJS runner - that is strictly
harder evidence than a parallel JS reimplementation. The host closure is:

```
MB=/opt/esp/esp-idf/components/mbedtls/mbedtls
cc -O2 -std=gnu11 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -funsigned-char \
  -DMBEDTLS_CONFIG_FILE='"r91_crypto_mbedtls_config.h"' \
  -Itests/lib -Ifirmware/components/quickjs-ng -I$MB/include \
  tests/crypto_host.c firmware/components/lume-crypto/lume_crypto.c \
  $MB/library/{sha256.c,md.c,aes.c,platform_util.c,constant_time.c} \
  firmware/components/quickjs-ng/{quickjs.c,dtoa.c,libregexp.c,libunicode.c} \
  -o <scratch>/crypto_host -lm -lpthread -ldl
node <scratch>/crypto_host tests/lib/crypto_cases.js
```

The minimal config is `tests/lib/r91_crypto_mbedtls_config.h` (only
`MBEDTLS_HAVE_ASM`, `MBEDTLS_SHA256_C`, `MBEDTLS_MD_C`, `MBEDTLS_AES_C`,
`MBEDTLS_CIPHER_MODE_CTR`, `MBEDTLS_PLATFORM_C`, `MBEDTLS_ERROR_C`).
Two empirical traps found and fixed while establishing this:

1. A config file named `mbedtls_config.h` is shadowed: `#include
   "mbedtls_config.h"` from `build_info.h` resolves relative to that header's
   own directory first, silently loading IDF's full config (all hashes + PSA)
   and forcing ~20 undefined `mbedtls_md5_*` / `psa_*` symbols at link time.
   Fix: unique filename via `MBEDTLS_CONFIG_FILE`.
2. Manually including `mbedtls/check_config.h` from the custom config runs it
   before `config_adjust_*`, causing a spurious "MBEDTLS_MD_C defined, but no
   hash algorithm"; also `MBEDTLS_HAVE_INT64` + `MBEDTLS_HAVE_ASM` and
   `MBEDTLS_CHECK_PARAMS` are rejected by this mbedTLS version. Removed all
   three from the config.

Freestanding probe raw output (same config/closure, tiny C caller of
`mbedtls_sha256` / `mbedtls_md_hmac` / `mbedtls_aes_crypt_ctr`):

```
COMPILE_OK
=== RUN ===
sha256 abc: ba7816bf
hmac ok, info=0x587f165d5168
aes ctr ok
```

## 3. Vector and host-harness evidence

`node tests/crypto.js` raw output:

```
PASS SHA-256 NIST vectors: empty / abc / 56-byte two-block
PASS HMAC-SHA256 RFC 4231 cases 1/2/3
PASS CRC-32 0xCBF43926 + JS reference cross-check (seed/no-seed)
PASS AES-128/256-CTR SP 800-38A F.5 vectors + CTR symmetry + in-place
PASS subarray/byteOffset views for all four primitives
PASS error contract: -1 type / -2 length, no exceptions
PERF host single sample (20000x 60B): native=15ms js=832ms ratio=55.5x (sink=1966913649, NOT ESP32-S3)
ALL OK
EXIT=0
```

Vectors were independently recomputed with Node `crypto`/`zlib` before being
hardcoded (Node v22.23.1): sha256("abc") `ba7816bf...`, RFC 4231 cases 1-3,
`zlib.crc32("123456789") = cbf43926`, SP 800-38A F.5.1 AES-128 CTR
`874d6191b620e3261bef6864990db6ce` + `9806f66b7970fdff8617187bb9fffdff`,
F.5.2 AES-256 first block `601ec313775789a5b7a7f504bbf3d228`. The initially
recalled F.5.1 block-2 value was wrong; ECB-keystream XOR against the counter
block `f0f1...ff00` confirmed Node's value, which the mbedTLS-backed harness
then reproduced.

Perf note: native vs JS is a single host sample (20k x 60-byte CRC-32), it is
NOT an ESP32-S3 measurement and is only evidence for why a native primitive
is worth having. Real board throughput/timing stays deferred.

## 4. Firmware build and size

Command (exact wrapper, used for both baseline and post):

```
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r91-wt/firmware && idf.py build && idf.py size'
```

The first baseline attempts were killed while assembling `quickjs.c`
(2.7 GiB swap in use). Per r78/r82/r84 precedent, only that build-directory
object was recompiled in isolation with the same `-O2` and `-g0` appended
(44.5 s), then `idf.py build` completed. No vendored source, firmware source,
or optimization level was changed for this workaround; it affects debug
information only. Command used:

```
# command taken verbatim from build/compile_commands.json for quickjs.c, then:
... -O2 ... -o CMakeFiles/__idf_quickjs-ng.dir/quickjs.c.obj -c .../quickjs.c -g0
```

Baseline size (`13c2b76`, unmodified worktree), raw:

```
│ Flash Code          │      2027804 │          │                │               │
│    .text            │      2027804 │          │                │               │
│ Flash Data          │       850132 │          │                │               │
│    .rodata          │       849876 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│    .bss             │       121960 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
Total image size: 3019707 bytes (.bin may be padded larger)
lume.bin binary size 0x2e1430 bytes.
```

Post-change size (with `lume-crypto`), raw:

```
│ Flash Code          │      2031220 │          │                │               │
│    .text            │      2031220 │          │                │               │
│ Flash Data          │       850164 │          │                │               │
│    .rodata          │       849908 │          │                │               │
│    .appdesc         │          256 │          │                │               │
│ DIRAM               │       247267 │    72.35 │          94493 │        341760 │
│    .bss             │       121960 │    35.69 │                │               │
│    .text            │       101679 │    29.75 │                │               │
│    .data            │        23628 │     6.91 │                │               │
│ IRAM                │        16384 │    100.0 │              0 │         16384 │
│    .text            │        15356 │    93.73 │                │               │
│    .vectors         │         1028 │     6.27 │                │               │
Total image size: 3023155 bytes (.bin may be padded larger)
lume.bin binary size 0x2e21b0 bytes.
```

Per-item delta:

| metric | baseline | post | delta |
|---|---|---|---|
| Flash Code (`.text`) | 2027804 | 2031220 | +3416 |
| Flash Data (`.rodata`+`.appdesc`) | 850132 | 850164 | +32 |
| DIRAM | 247267 | 247267 | 0 |
| IRAM | 16384 / 16384, Remain 0 | 16384 / 16384, Remain 0 | 0 |
| Total image | 3019707 | 3023155 | +3448 |

IRAM hard line respected: used stays 16384, Remain 0, never negative. All new
native code is in flash `.text`; DIRAM is unchanged (no new static buffers -
the AES key schedule lives on the engine task stack for the call duration and
the CRC path is table-free). Build tail: `Project build complete`,
`Built target __idf_lume-crypto`, zero warnings attributable to
`lume_crypto.c`.

## 5. Synchronized surfaces and full verification

Changed: `firmware/components/lume-crypto/{CMakeLists.txt,include/lume_crypto.h,lume_crypto.c}`;
`lume-engine/CMakeLists.txt` (+ `lume-crypto` in REQUIRES); `lume_engine.c`
(register `lume_crypto_register`); `runtime/types/lume.d.ts`; regenerated
`website/api.html`; `website/playground/runtime.js` and
`tests/lib/prelude_runner.js` (crypto stubs); `tests/crypto.js`,
`tests/crypto_host.c`, `tests/lib/crypto_cases.js`,
`tests/lib/r91_crypto_mbedtls_config.h`; this report + roadmap r91 result.
No vendored component (quickjs-ng / lvgl) modified. mbedTLS is included as an
IDF component only - no IDF source edited.

Playground / host-prelude stubs: mbedTLS is unavailable in the browser and in
the Node prelude runner. Per the brief's "implement JS semantics or mark
unsupported" choice, we took the minimal-intrusion route: the four methods
exist with the right names and return `-3` ("unsupported/internal") with an
`onWarn` message; `options.crypto` can inject a real implementation. This keeps
app code that calls `lume.crypto` from throwing in the playground while being
honest that no cryptographic result is produced there. Firmware and host
harness are the authoritative paths.

Raw verification output:

```
$ for t in tests/*.js; do node "$t" || echo FAIL "$t"; done
TESTS_DONE fail=0

$ npm test --prefix tools/lume
# tests 44
# pass 43
# fail 0
# skipped 1
NPM_TEST_EXIT=0

$ node tools/lume/lume.js check examples/counter --no-emu
[PASS] bundle   2160 bytes (19 ms)
RESULT: PASS (4 steps, 0 failed; exit 0)
CHECK_EXIT=0

$ python3 scripts/gen_api_docs.py
wrote website/api.html: 134 API rows, 9 global helpers
$ python3 scripts/gen_api_docs.py --check
api.html is up to date with lume.d.ts (134 entries)

$ python3 scripts/check_website.py
HTML pages: 7; internal href/src and anchors checked
API: 134 catalog entries, 134 type declarations, 31 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

Note: a fresh worktree initially failed `tests/files_dialog.js` /
`tests/spectrum.js` with `Cannot find module '../tools/lume/node_modules/esbuild'`.
This was a missing dependency in the new worktree, fixed with
`npm ci --prefix tools/lume` (`found 0 vulnerabilities`); it is not a code
regression.

## 6. KNOWN-SIMPLIFICATIONS / deferred acceptance

- The repo-wide "all board-level metrics deferred" entry in
  `docs/KNOWN-SIMPLIFICATIONS.md` applies: no on-device verification of
  `lume.crypto` (actual mbedTLS execution on ESP32-S3, AES hardware-AES path,
  timing, or consumption by WS/OTA/provisioning code). Host vectors + build +
  size are not board acceptance.
- Browser playground / host prelude crypto methods are unsupported stubs
  (`-3`), as documented above and in `.d.ts`; this is the r91-specific
  simplification and is new (no existing entry covered it).
- The `-g0` quickjs recompile is a local build-environment workaround for
  host swap pressure (r78/r82/r84/r85 precedent), not a committed project
  setting; it changes debug info only.
- emu was not run; three-piece image copy + `EMU_SKIP_BUILD=1` was therefore
  not needed for this pure-compute primitive.
