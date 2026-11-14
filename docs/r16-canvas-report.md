# r16 Canvas 自绘控件战报

基线核对：开工执行 `git fetch origin && git status --short && git log -1 --oneline`，工作区无修改；实际 HEAD 是 `4b75e22`（仅比简报中的 `721aa7b` 多一条 roadmap 提交）。本轮基于实际 main 实施，未改 `docs/reactivity-design.md`，未推送。

## 链路与取舍

Canvas 是 LVGL canvas widget，`CREATE` 消息带固定宽高。LVGL task 从 PSRAM 分配 RGB565 buffer，绑定 `lv_canvas_set_buffer`，对象照常参与 LVGL flex、脏区和显示 flush。engine task 从不调用 `lv_*`，也不持有像素指针。

`Canvas({width,height,onDraw})` 创建一个 owned effect。首次执行和所读 signal 变化时，JS 绘制 API 将清屏、矩形、线段、圆、文字编码成 96 字节的固定消息，最后发 `CANVAS_INVALIDATE`。LVGL 的 5ms drain timer 在 `lv_timer_handler` 内按 FIFO 落笔，最后 `lv_obj_invalidate`。`polyline` 每段一条消息，最多 240 点。没有逐帧 JS 回调；稳定 signal 不产生绘制消息。

原计划的 LVGL timer → engine JS 请求 → LVGL 完成往返需要两次跨线程排队，并可能在 UI 队列满时形成回压；engine 直接共享 PSRAM 像素还需要处理 LVGL 同时读 buffer 的竞争。本轮采用单向定长绘制命令：所有像素操作由 LVGL task 完成，指针不跨线程。样板首次绘制实测 host 消息为 15 条 draw + 1 条 invalidate，约 1,536 字节队列复制，覆盖 220×120 像素；不用 26,400 条逐像素消息。这个计数验证了消息量，真机绘制耗时尚未测量。绘制过程不是原子事务，LVGL 中途刷新可能看到半帧；较长曲线的视觉一致性留接板轮。

## vendored LVGL API 静态对照

| LVGL 9.3 实现 | 我方调用/使用 | 结论 |
|---|---|---|
| `lv_canvas.c:59` `lv_canvas_create` | `lume_ui_bridge.c:253` | 普通 LVGL 对象，参与父节点布局 |
| `lv_canvas.c:71` `lv_canvas_set_buffer` | `lume_ui_bridge.c:254` | 外部 PSRAM RGB565 buffer 由桥接持有 |
| `lv_canvas.c:107` `lv_canvas_set_px` | 未逐像素调用 | 此 API 每像素调用 `lv_obj_invalidate`，因此桥接批量写 RGB565 buffer |
| `lv_canvas.c:293` `lv_canvas_fill_bg` | 未用于清屏 | 桥接按 stride 清屏，避免每次填充即 invalidate |
| `lv_canvas.c:371,389` layer 初始化/完成 | `lume_ui_bridge.c:483,490` | `ctx.text` 使用 LVGL 默认字体绘入 canvas |
| `lv_obj_invalidate` | `lume_ui_bridge.c:587` | 每次 `onDraw` 的最后一条消息触发一次刷新 |

## 内存与验证

- 单 canvas 上限 480×480，总 canvas 预算 460,800 字节；真实分配量为 `lv_draw_buf_width_to_stride(w, RGB565) × h`。buffer 全部要求 `MALLOC_CAP_SPIRAM`，删除 LVGL 对象后释放。220×120 样板占 52,800 字节；480×480 占 460,800 字节。这些是运行时 PSRAM 占用，不出现在 `idf.py size` 静态表中。
- `node tests/canvas_mapping.js` 六组通过：创建/尺寸、绘制序列、signal 改变与相等值、flex 收养、尺寸/坐标/颜色/点/文字越界、内嵌 demo 与 example 消息一致。`tests/style_mapping.js`、`tests/animation_mapping.js`、`tests/bridge_protocol.c` 也通过。
- Canvas harness 原始用例输出：

```text
PASS canvas create dimensions and fixed wire kind
PASS drawing command order and final invalidate
PASS signal change redraws once; equal value stays idle
PASS canvas is adopted into flex layout flow at fixed size
PASS dimensions/coordinates/color/text/point bounds reject
PASS embedded demo equals example message sequence
```

- 折线图样板的前 12 条 host 消息原始输出：

```text
SAMPLE messages (first 12): [["create",3,0,220,120],["draw",1,0,0,0,0,0,0,1],["draw",1,1,0,0,220,120,1057848,1],["draw",1,2,10,100,210,100,4612474,1],["draw",1,2,10,72,28,69,4710577,2],["draw",1,2,28,69,46,74,4710577,2],["draw",1,2,46,74,64,62,4710577,2],["draw",1,2,64,62,82,55,4710577,2],["draw",1,2,82,55,100,61,4710577,2],["draw",1,2,100,61,118,46,4710577,2],["draw",1,2,118,46,136,39,4710577,2],["draw",1,2,136,39,154,42,4710577,2]]
SAMPLE totals: {"create":4,"draw":15,"invalidate":1,"attr":12,"press":1}
```

以实际 HEAD `4b75e22` 的独立工作树构建作基线，bin 从 `0x1cb0e0` (1,880,288 B) 到 `0x1ccb00` (1,886,976 B)，增量 `0x1a20` = **6,688 B**。Flash Code 1,448,350 → 1,451,490 (+3,140 B)，Flash Data 309,380 → 313,108 (+3,728 B)，DIRAM 194,539 → 195,819 (+1,280 B)，**IRAM 16,384 → 16,384 (+0 B)**。

`idf.py build` 与 `idf.py size` 关键原始输出（完整输出保存在 `/tmp/lume-r16-final-build-size.log`）：

```text
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x1ccbb0 bytes. Smallest app partition is 0x640000 bytes. 0x473450 bytes (71%) free.
[100%] Built target app_check_size
[100%] Built target app
│ Flash Code        │      1451490 │          │                │               │
│ Flash Data        │       313108 │          │                │               │
│ DIRAM             │       195819 │     57.3 │         145941 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 1887041 bytes (.bin may be padded larger)
Built target size
```

基线原始输出（`/tmp/lume-r16-baseline-size.log`）：

```text
lume.bin binary size 0x1cb0e0 bytes. Smallest app partition is 0x640000 bytes. 0x474f20 bytes (71%) free.
│ Flash Code        │      1448350 │          │                │               │
│ Flash Data        │       309380 │          │                │               │
│ DIRAM             │       194539 │    56.92 │         147221 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 1880173 bytes (.bin may be padded larger)
```

真机像素、文字、触摸与绘制时延验收留主控接板轮。
