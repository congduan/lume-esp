# r19 scroll container / virtual List report

Baseline: `23b73d6` on `main`. `git fetch origin && git status --short` returned no status lines before edits. No push performed.

## Implementation

- `View({style:{scroll:'vertical'|'horizontal', scrollbar:'off'|'auto'|'on'}})` maps prelude strings to numeric attributes 20/21. The bridge calls LVGL's scroll flag, direction and scrollbar mode APIs. Programmatic `ATTR_SCROLL_Y=22` resets a List to the top; `ATTR_IGNORE_LAYOUT=23` positions virtual rows over a total-height spacer. `_Static_assert(sizeof(lume_ui_msg_t) == 96)` holds in the firmware build, so Queue A remains 96 bytes.
- LVGL emits `SCROLL` and `SCROLL_END` on its own task. The bridge sends `{node_id, scroll_y}` through Queue B; the engine task calls `__lume_dispatchScroll`. The C callback caps regular emissions to one per 25ms and additionally requires 12px displacement or 40ms elapsed. `SCROLL_END` always sends. Queue overflow drops and counts/logs events. No engine-task `lv_*` calls were added.
- `List` keeps `items` in JS. It creates one scrollable View, one height spacer and rows in `[floor(y/itemHeight)-overscan, ceil((y+viewport)/itemHeight)+overscan)`. Rows use `LV_OBJ_FLAG_IGNORE_LAYOUT` and a fixed y coordinate. Outgoing rows are removed; replacement rows wait for LVGL's removal notice. Node IDs can now be reused after that acknowledgement, avoiding the previous lifetime limit of 127 creations.
- `items` must publish a fresh array. Replacing it rebuilds visible rows. Equal length keeps the offset; changed length resets to 0. The files example uses `List` with 36px rows and offers `seedTestEntries()` to create 1000 in-memory test directories.

## Host evidence

`node tests/list_virtualization.js`:

```text
EVIDENCE 1000 items / 12 visible: actual created nodes=17 (15 rows + container + spacer)
PASS 1000 items, 12 visible: initial 15 rows, 17 total nodes
EVIDENCE 1000 items / 12 visible: middle window live nodes=20 (18 rows + 2 fixed)
PASS scroll maps to 18-row middle window
PASS scroll window reclaims old rows before creating replacements
PASS small scroll within same window does not churn nodes
PASS same-length items replacement rebuilds window and keeps offset
PASS length change rebuilds and resets scroll to top
PASS removed row loses press callback and signal effects
PASS 1000-item traversal stays within the 127-node table
PASS bridge throttle and overflow policy are present
EVIDENCE files seedTestEntries(): 1000 entries, 42 new nodes
PASS files example seeds 1000 entries without creating 1000 rows
PASS 10 list virtualization cases
```

The throttle case checks the C policy statically; the other nine execute the embedded JS prelude against a deferred LVGL-removal mock. The traversal mock enforces the 127-node table and recycles IDs after removal acknowledgements. `tests/style_mapping.js`, `tests/lifecycle.js`, `tests/theme_mapping.js`, `tests/animation_mapping.js` and `tests/canvas_mapping.js` also pass.

For a fixed viewport and fixed per-row subtree size, live LVGL nodes and corresponding JS node-owned effects are proportional to visible rows plus twice `overscan`, independent of `items.length`. Here 1000 entries use 18 live row roots in the middle, rather than 1000. The global 127-node cap still applies to other UI and nested row nodes.

## Vendored LVGL v9 API cross-check

| API / event | Vendored source |
|---|---|
| `LV_OBJ_FLAG_SCROLLABLE`, `LV_OBJ_FLAG_IGNORE_LAYOUT` | `firmware/components/lvgl/src/core/lv_obj.h:97`, `:111` |
| `LV_SCROLLBAR_MODE_OFF/ON/AUTO` | `firmware/components/lvgl/src/core/lv_obj_scroll.h:32-35` |
| `lv_obj_set_scrollbar_mode`, `lv_obj_set_scroll_dir` | `firmware/components/lvgl/src/core/lv_obj_scroll.h:59`, `:66`; definitions `lv_obj_scroll.c:58`, `:69` |
| `lv_obj_get_scroll_y`, `lv_obj_scroll_to_y` | `firmware/components/lvgl/src/core/lv_obj_scroll.h:132`, `:234`; definitions `lv_obj_scroll.c:124`, `:379` |
| `LV_EVENT_SCROLL`, `LV_EVENT_SCROLL_END` | `firmware/components/lvgl/src/misc/lv_event.h:51-52`; emitted in `lv_obj_scroll.c:423`, `:358`, `:699` |

## Build and size

The isolated, detached `23b73d6` worktree was built with the same IDF 5.5.5 environment. Its raw build line was:

```text
lume.bin binary size 0x1cecd0 bytes. Smallest app partition is 0x640000 bytes. 0x471330 bytes (71%) free.
```

The r19 build produced `0x1cffc0` bytes, a `0x12f0` (4,848-byte) increase. Final `idf.py size` output follows below. Device drag feel, momentum and damping are left for the board round.

Raw final `idf.py build` / `idf.py size` excerpt:

```text
lume.bin binary size 0x1cffc0 bytes. Smallest app partition is 0x640000 bytes. 0x470040 bytes (71%) free.
                           Memory Type Usage Summary                            
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1453322 │          │                │               │
│    .text          │      1453322 │          │                │               │
│ Flash Data        │       324596 │          │                │               │
│    .rodata        │       324340 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       197099 │    57.67 │         144661 │        341760 │
│    .bss           │        91072 │    26.65 │                │               │
│    .text          │        83339 │    24.39 │                │               │
│    .data          │        22688 │     6.64 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
│ RTC FAST          │           24 │     0.29 │           8168 │          8192 │
│    .rtc_reserved  │           24 │     0.29 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 1900361 bytes (.bin may be padded larger)
```
