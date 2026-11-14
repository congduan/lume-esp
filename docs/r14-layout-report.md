# r14 M3 flex layout implementation report

Baseline: `5485e3e`; `git fetch origin && git status --short` showed a clean worktree, and `git log -1 --oneline` returned `5485e3e docs(audio): record vendor cross-check and build limits`. Git identity: `congduan <congduan@users.noreply.github.com>`. No push or board flash.

## Protocol and LVGL source cross-check

All new attributes use `lume_ui_msg_t.value` (int32). `tests/bridge_protocol.c` verifies IDs 7–17 and that the copied record remains 76 bytes. Flex wire enum values are mapped explicitly; LVGL's `SPACE_EVENLY`, `SPACE_AROUND`, and `SPACE_BETWEEN` have a different enum order. Cross-axis wire value 3 means stretch while main-axis value 3 means space-between; the bridge interprets them by attribute ID.

| Wire attribute | Vendored LVGL API / source | Bridge call |
| --- | --- | --- |
| FLEX_FLOW | `lv_flex.h:44-53,73`, `lv_flex.c:101-105` | `lume_ui_bridge.c:200-203` `lv_obj_set_flex_flow` |
| FLEX_MAIN_ALIGN / FLEX_CROSS_ALIGN | `lv_flex.h:35-42,75-83`, `lv_flex.c:107-114` | `lume_ui_bridge.c:94-102,205-212` `lv_obj_set_flex_align` |
| PADDING | `lv_obj_style.h:196-202` | `lume_ui_bridge.c:213-215` `lv_obj_set_style_pad_all` |
| GAP | `lv_obj_style_gen.h:828-829` | `lume_ui_bridge.c:216-219` `lv_obj_set_style_pad_row/column` |
| RADIUS | `lv_obj_style_gen.h:888` | `lume_ui_bridge.c:220-222` `lv_obj_set_style_radius` |
| BORDER_WIDTH / BORDER_COLOR | `lv_obj_style_gen.h:849-851` | `lume_ui_bridge.c:223-228` `lv_obj_set_style_border_width/color` |
| OPACITY | `lv_obj_style_gen.h:891` | `lume_ui_bridge.c:229-231` `lv_obj_set_style_opa` |
| WIDTH_PCT / HEIGHT_PCT | `lv_area.h:246`, `lv_obj_pos.h:86,105` | `lume_ui_bridge.c:192-199` `lv_pct` + `lv_obj_set_width/height` |

LVGL's cross-axis `lv_flex_align_t` has no stretch (`lv_flex.h:35-42,79`), so a child without explicit cross-axis size receives `lv_pct(100)` upon adoption (`lume_ui_bridge.c:79-93,152-155,243-247`). Layout remains LVGL's own flex algorithm. All these calls occur inside the bridge's LVGL-task queue drain; the JS engine only posts messages.

## Host verification: raw output

`node tests/style_mapping.js` extracts the actual C-embedded prelude, evaluates it with a fake `lume` binding, and checks complete attribute sequences:

```text
PASS column + dimensions + color: [[1,728639],[16,100],[17,50],[7,1]]
PASS row: [[7,0]]
PASS row wrap: [[7,2]]
PASS column wrap: [[7,3]]
PASS justify start: [[8,0]]
PASS justify end: [[8,1]]
PASS justify center: [[8,2]]
PASS justify space-between: [[8,3]]
PASS justify space-around: [[8,4]]
PASS justify space-evenly: [[8,5]]
PASS stretch + gap + padding: [[9,3],[10,16],[11,8]]
PASS radius + border + opacity: [[12,12],[13,2],[14,11259375],[15,128]]
PASS pixel + legacy bg: [[1,1122867],[2,240],[3,120]]
PASS invalid percentage/metric/color/opacity rejected in prelude
PASS all style mapping cases
PASS embedded demo matches examples/counter/app.js messages
```

`gcc -std=c11 -Wall -Wextra -Werror -Ifirmware/components/lume-ui-bridge/include tests/bridge_protocol.c -o /tmp/lume_bridge_protocol && /tmp/lume_bridge_protocol`:

```text
PASS bridge protocol enum IDs, cross-axis stretch and fixed-size 76-byte message
```

## Firmware verification: raw output

Built with `env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env` and `/opt/esp/esp-idf/export.sh`.

```text
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x1c9580 bytes. Smallest app partition is 0x640000 bytes. 0x476a80 bytes (71%) free.
[100%] Built target app_check_size
[100%] Built target app
Project build complete. To flash, run:
```

`idf.py size` relevant rows (full log in `/tmp/lume_r14_final.log` for build and size):

```text
│ Flash Code        │      1446362 │          │                │               │
│ Flash Data        │       304356 │          │                │               │
│ DIRAM             │       191331 │    55.98 │         150429 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 1873161 bytes (.bin may be padded larger)
```

The r13 final build at this baseline (see `docs/r13-audio-report.md`) recorded `0x1c85d0` / 1,869,264 bytes. r14 is `0x1c9580` / 1,873,280 bytes: **+4,016 bytes**. IRAM remains exactly **16,384/16,384**; DIRAM rises 640 bytes. This is a comparison with the r13 recorded build size; no separate detached baseline rebuild was performed.

## Hardware acceptance pending

No board was connected. Confirm the column layout, two-child `space-between` placement, percentage root/button sizing, radius/border/opacity rendering, stretch behavior, and touch target placement on the device. The host harness and build do not establish visual correctness.
