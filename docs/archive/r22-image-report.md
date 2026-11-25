# r22 image rendering report

## Implementation and API check

The vendored `lv_conf.h` previously enabled neither PNG nor JPEG. The vendored tree contains `src/libs/lodepng` and `src/libs/tjpgd`; `src/libs/libpng` is present but needs an external libpng dependency. I enabled lodepng and tjpgd. `lv_image` is less code than blitting into a canvas: the image descriptor points directly at the PSRAM RGB565/RGB565A8 buffer and LVGL owns scaling and alpha compositing. Encoded data stays in JS; no LVGL filesystem or network source is used.

| Vendored API | Verified location |
|---|---|
| `lv_image_create`, `lv_image_set_src` | `firmware/components/lvgl/src/widgets/image/lv_image.h:86,99` |
| `LV_IMAGE_ALIGN_CONTAIN`, `lv_image_set_inner_align` | `firmware/components/lvgl/src/widgets/image/lv_image.h:56,199` |
| `lv_image_dsc_t`, header magic | `firmware/components/lvgl/src/draw/lv_image_dsc.h:25,128-133` |
| `lodepng_decode32` | `firmware/components/lvgl/src/libs/lodepng/lodepng.h:161` |
| `jd_prepare`, `jd_decomp` | `firmware/components/lvgl/src/libs/tjpgd/tjpgd.h:92,94` |
| Decoder registration | `firmware/components/lvgl/src/lv_init.c:366,374` |

The decoded output buffer is explicitly `MALLOC_CAP_SPIRAM`. RGB565 requires `w×h×2`, maximum 460,800 bytes (~450 KiB). RGB565A8 requires `w×h×3`, maximum 691,200 bytes (~675 KiB). PNG's RGBA intermediate needs up to 921,600 bytes more; source ArrayBuffer and decoder scratch are additional. Header checks reject dimensions above 480×480 before either allocation or decode. Errors: `-1` argument/size, `-2` bad/unsupported/decode, `-3` allocation or queue pressure. Visual acceptance remains for the board round.

## Build and size (raw output)

Baseline at `e5bf92c`: `lume.bin` 0x1d4d20 = 1,920,288 bytes. Clean committed-tree build: 0x1ddee0 = 1,957,600 bytes, increase 37,312 bytes. The build ran in a separate clean worktree so concurrent uncommitted r21 review fixes are excluded.

```text
[100%] Built target lume.elf
Successfully created esp32s3 image.
lume.bin binary size 0x1ddee0 bytes. Smallest app partition is 0x640000 bytes. 0x462120 bytes (70%) free.
[100%] Built target app_check_size
Project build complete.
```

```text
Flash Code        1488706
Flash Data         343932
DIRAM              203711
IRAM                16384 (100.0%, remain 0)
Total image size  1957477 bytes
```

`idf.py size-components` (CSV raw rows):

```text
"liblvgl.a","366986","0","0","0","66124","66044","80","0","272959","272959","27903","27903","0","0","0","0","0","0","0"
"liblume-engine.a","55004","0","0","0","197","189","8","0","16214","16214","38593","38593","0","0","0","0","0","0","0"
"liblume-ui-bridge.a","17983","0","0","0","11160","11160","0","0","6823","6823","0","0","0","0","0","0","0","0"
```

`idf.py size-files` attribution within LVGL (total/code/rodata): lodepng 27,339/18,487/8,852; tjpgd 4,579/3,363/1,216; LVGL decoder wrappers 535/527/8 and 769/769/0. All report zero IRAM. No sdkconfig IRAM change was needed; the 16,384-byte red line remains exact.

## Host harness (raw output)

```text
PASS PNG IHDR 1x1
PASS JPEG SOF 3x2
PASS oversize rejected before decode
PASS bad bytes rejected
PASS invalid argument error code
PASS 1x1 opaque red RGBA to exact RGB565A8 bytes
PASS Image create/source/size message order
PASS Image participates in View flex child adoption
PASS Image preserves aspect ratio for one explicit dimension
PASS Image propagates decoder error and removes failed node
PASS Image rejects invalid input and propagates header error
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
```

The 1×1 assertion inflates the known test PNG's IDAT and checks the filter byte plus RGBA bytes (`00 ff 00 00 ff`), then exercises the native pixel conversion helper and checks RGB565A8 (`00 f8 ff`). The native header parser and pixel conversion run as a host C binary. Vendored tjpgd `JD_FORMAT=0` writes B,G,R bytes (`tjpgd.c:880-886`); the bridge reverses them when packing RGB565. Full LVGL rendering, JPEG color output, alpha compositing, and scale quality have no board result yet.
