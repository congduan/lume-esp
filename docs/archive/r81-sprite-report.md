# r81 — Canvas 精灵 blit（ctx.retainImage / ctx.drawImage）实施与验证报告

日期：2026-11-17。基线 `965a5b0`（r82 FFT 已合入）。本刀把「固件 canvas drawImage
blit」（roadmap P2 key，deferred 自 r58 精灵路线）收口：JS 侧一次上传 RGB565
位图，之后每帧从 C 侧回放，游戏精灵不再付逐像素 JS 成本（引擎 ~0.5 Mops/s，
r78 实测口径）。

## 交付内容

- **光栅原语**：`lume_raster.h` 新增 `lume_raster_blit()` —— header-only、
  颜色 key（0x0000 透明）、水平 flip、四边裁剪（sx/sy 对齐源矩形）、stride
  padding 不踩。r47 光栅化器同款纪律。
- **桥接协议**：`lume_ui_bridge.h` 追加 `LUME_OP_CANVAS_SPRITE_DEFINE`（=18）/
  `LUME_OP_CANVAS_SPRITE_DRAW`（=19），尾部追加不改既有 ID；8 槽/每画布，
  `LUME_CANVAS_SPRITE_BUDGET` = 480*480*2（一张全屏 RGB565）PSRAM 预算，
  与 r45 retained path 同款「define 持有预算、draw 纯回放」纪律。DEFINE
  持有引擎 `heap_caps_malloc(SPIRAM)` 拷贝，槽重定义替换旧位图（动画帧
  交换不泄漏）；画布死亡经 `canvas_release_sprites()` 释放。
- **引擎 JS API**：`lume.canvasSpriteDefine(id, slot, w, h, Uint16Array)` /
  `lume.canvasSpriteDraw(id, slot, dx, dy, flip)`；prelude 暴露
  `ctx.retainImage(slot, w, h, pixels)`（返回 0）与
  `ctx.drawImage(slot, dx, dy, flip)`。参数校验：slot 1..8、尺寸 1..480、
  像素必须 Uint16Array 且 length==w*h。
- **配套**：`tests/bridge_protocol.c` 追加 op ID/槽数静态断言；
  `tests/canvas_blit.c` 新 freestanding harness（5 组用例：不透明落位、
  颜色 key、四边裁剪、flip、退化输入）；`runtime/types/lume.d.ts` 补两个
  方法契约；浏览器模拟器 `renderer.js` 补 spriteDefine/spriteDraw 回放
  （同款颜色 key + flip 语义，ImageData RGB565→RGBA）；宿主 runner
  （`tests/lib/prelude_runner.js`、`tests/canvas_mapping.js`）补 stub 与
  3 组新断言；`docs/KNOWN-SIMPLIFICATIONS.md` 登记 r81 取舍。

## 主控修正（引擎额度尽后的接管轮）

上一轮派发即遇 429（hy4flash-free 额度尽，18:17 UTC+8 重置），worktree 中
仅存 ~226 行半成品。审阅发现**签名错位 bug**：C 端
`js_canvas_sprite_define` 按 4 参数 `(id, sprite, w, h)` 校验且对 `argv[3]`
（应为 h）做 Uint16Array 检查，而 prelude 调用传 5 参
`(id, slot, w, h, pixels)` —— 原样编译虽绿、但 JS 调用必抛 TypeError。
接管后修正为 5 参并完成 host stubs、d.ts、模拟器、docs 等配套。

## 验证证据（host harness，全部原始输出）

```
$ gcc -std=c11 -Wall -Wextra -Werror -I firmware/components/lume-ui-bridge/include tests/canvas_blit.c -o /tmp/lume_canvas_blit && /tmp/lume_canvas_blit
PASS opaque 4x4 blit lands exactly at (2,3)
PASS 0x0000 colour key is transparent
PASS blit clips at all four surface edges
PASS flip mirrors the sprite horizontally
PASS NULL/zero-size blit is a no-op
PASS fully off-surface blit is a no-op
canvas_blit: all cases PASS

$ gcc -std=c11 -Wall -Wextra -Werror -I firmware/components/lume-ui-bridge/include tests/canvas_aa.c -o /tmp/lume_canvas_aa -lm && /tmp/lume_canvas_aa
PASS isqrt 8.8 fixed-point contract
PASS width=1 horizontal line: 1px core, no stray ink, stride padding intact
PASS width=1 diagonal line: feather band present (was the staircase)
PASS coverage rises monotonically toward the centreline
PASS zero-length stroke paints a bounded point
PASS width=4 envelope: hw=1 core, feather to +2, nothing at +3
PASS ring: continuous annulus, centre clean, 45-degree sites smooth
PASS wide ring degenerates to anti-aliased disc
PASS 50% blend of white over grey is the channel-exact midpoint
PASS shared joint: opaque core continuous, envelope not doubled
PASS set_color channel decomposition exact
PASS arc: wedge band, round end cap, empty gap, AA feather, padding intact
PASS arc: full 360deg sweep across 0deg is bit-identical to ring
PASS arc: 0deg wrap normalisation, equivalent geometry, correct gap
PASS arc: end seam is continuous (no hard step / gap)
PASS arc: from==to degenerates to a bounded round dot
PASS arc: width>=2r-1 degenerates to a filled AA sector (no hole)
PASS arc: bbox clipped to surface, stride padding intact
PASS arc: r<=0 early return
ALL CANVAS AA HOST TESTS PASSED

$ gcc -std=c11 -Wall -Wextra -Werror -Ifirmware/components/lume-ui-bridge/include -I firmware/components/lume-hotreload/include -I firmware/components/lume-engine/include tests/bridge_protocol.c -o /tmp/lume_bridge_protocol && /tmp/lume_bridge_protocol
EXIT=0
```

`for t in tests/*.js; do node "$t" || echo FAIL "$t"; done` → `TOTAL_JS=42
JS_HARNESS_FAILURES=0`（worktree 已含 esbuild，无需重装）。`tests/canvas_mapping.js`
新增 3 组 sprite 断言：一次上传/多次回放（含 offset+flip）、6 组参数校验负向
（slot 0/9、尺寸 0、长度不匹配、类型错）、槽重定义重上传。回归哨兵
`node tools/lume/lume.js check examples/counter` → `RESULT: PASS (4 steps,
0 failed; exit 0)`（bundle 2160 B、eval 2x、layout R1-R7 全 PASS、perf 未开）。
原始输出见 `artifacts/r81/host-tests.log`。

## 固件构建证据

```
$ cd /opt/esp/esp-idf && env -u VIRTUAL_ENV \
  IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env \
  bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r81-wt/firmware && idf.py build && idf.py size'
BUILD_SIZE_EXIT=0   （构建绿，无新警告；QuickJS 本次未遇汇编卡死，无需 -g0）
```

| 指标 | r82 基线（restored-size.log） | r81 实测 | 增量 |
|---|---|---|---|
| Flash Code | 2,021,336 B | 2,021,204 B | −132 B（略低于基线） |
| Flash Data | 847,828 B | 849,396 B | +1,568 B（prelude JS 串与新增格式串） |
| DIRAM | 239,043 B | 247,267 B | +8,224 B（s_sprite_* 槽元数据，见下） |
| IRAM | 16,384/16,384, Remain 0 | 16,384/16,384, Remain 0 | 持平（硬线内） |
| Total image | 3,010,935 B | 3,012,371 B | +1,436 B |

DIRAM +8,224 B 全部来自精灵槽元数据静态数组：`s_sprite_px[128][8]` 指针
4,096 B + `s_sprite_w/h[128][8]` 各 2,048 B + `s_sprite_bytes` 4 B ≈ 8,196 B
（含对齐），与 r45 retained path 的 `s_path_lines[NODES][PATHS]` 同款 BSS 纪律；
位图像素本身在 PSRAM，不计入 DIRAM。Flash Code 比基线低 132 B（在编译器
codegen 噪声范围内），非回归；IRAM 仍钉在 16,384 B 上限、Remain 0。
完整 size 原始输出见 `artifacts/r81/size.log`。

## 已声明取舍（详见 KNOWN-SIMPLIFICATIONS.md r81）

- 透明 = 颜色 key（0x0000），非 alpha 平面；近黑用 #000001。
- 位图来源仅 JS 像素数组，设备端不解码 PNG/SVG/JPEG。
- 预算：每画布 8 槽共 460,800 B PSRAM；超预算的 define 桥端丢弃并记错误日志。
- flip 仅水平镜像；旋转未做。
- 浏览器模拟器按消息回放同款语义，不建模双缓冲交换。

## 待真机验证

精灵 blit 在 CO5300 面板上的实际帧率/色彩、PSRAM 余量下的批量 define、
游戏 demo 手感均 pending board；host + 浏览器绿不代表硬件验收。
