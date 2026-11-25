# r177 app 渲染帧成本收敛报告

基线：`origin/main` 的 `ea6cdc5`，从该提交新建 `r177-app-perf`。指定的 `/tmp/lume-r177-wt` 已被 board-id 分支占用，因此实施工作树为 `/tmp/lume-r177-perf-wt`。本轮只改 app、对应 host harness、历史守卫和 playground 产物；固件、runtime、prelude、tools 未改。

## 源码核查与帧账

表中的频率是定时器或 host 消息数，均非真机 FPS。`draw` 为 host prelude 发出的绘制调用；全画面动态 app 无法仅凭脏区截断。

| app | 基线 | 本轮 / host 证据 |
|---|---|---|
| plasma | 已为 50ms/20Hz，调色环在启动时预计算；动态全屏画面 | 保持 50ms。harness 确认绘制函数无逐帧颜色/字符串转换，普通帧最多 46 调用，强制重叠加涟漪 47 调用。 |
| skycombat | 交战和 OVER 都按 33ms 定时，全屏绘制每帧最多 231 调用 | 交战保持 33ms；OVER 切到 100ms，静止态 10 次轮询为 0 次绘制；点击重开回 33ms。场景和 r168 视觉绘制函数未改。 |
| golf | 已有球和力线的 unionBox 脏区，50ms 轮询 | 保持原绘制路径；READY 连续 20 次 tick 为 0 次 canvas 绘制，最多 26 调用/帧，滚动帧脏区严格小于 480×420。 |
| minigolf | 已有球、瞄准线和洞的 unionBox 脏区，静态球道保留路径 | 保持原绘制路径；READY 连续 20 次 tick 为 0 次绘制，最多 5 调用/帧，滚动帧最大脏区 9044 像素。 |
| gravity_ball | 已有 50ms 定时器和球旧/新位置脏区，但静止时也每 tick 提交一帧 | 整数像素坐标未变时跳过信号更新。host 轻微倾斜 2 秒：40 次轮询中 36 次绘制，最多 50 个绘制调用/帧；静止 20 次轮询为 0 次绘制。 |
| pet | 已有局部表情脏区；50ms 轮询、动画实际 100ms 换帧 | 轮询改 100ms，动画仍每 100ms 换帧：待机 10 次绘制/秒、最多 6 调用/帧，睡眠 0；脏区宽不超过 96px、高不超过 12px。 |
| wordle | 按键才更新，已有 `painted` 首帧门闩 | 首帧全 480×228、302 次调用；无输入的 tick 为 0 次绘制。逻辑未改。 |
| game_of_life | 演化才更新，已有 `painted` 首帧门闩 | 首帧仅 1 次全画布 invalidation、7 次调用；未到 350ms 周期时 0 次绘制，后续演化脏区低于全帧 30%。逻辑未改。 |

skycombat 当前状态机没有 READY 态，启动后直接交战；静止态降频只作用于 OVER。golf、minigolf、gravity_ball、pet 的局部脏区原本已存在于基线，故本轮没有重新实现。全屏动态画面保持原视觉绘制；只有实际需要的定时器和帧提交发生变化。

## 验证

以下原始输出保存在 `artifacts/r177/`，各 app 的独立 harness 和 `lume check --no-emu` 日志也在该目录。

```text
PASS bundle mochi 8460 bytes
PASS esbuild-wasm assets and 69 editable sources
PASS prelude 67428 bytes; 69 apps
CHECK_COUNT=69 FAIL_COUNT=0
TEST_COUNT=100 FAIL_COUNT=0
# tests 52
# pass 51
# fail 0
# skipped 1
API: 161 catalog entries, 161 type declarations, 34 function namespaces
API missing: none
```

旧守卫的历史比较基点早于已合入主干的 r75 SVG 扫描线填充、LVGL 15ms refresh/style cache、`.gitignore` 和设计令牌文档。本轮只把这些真实差异加入允许列表；`tests/ota_consumers.js` 明列本轮文件与 `artifacts/r177/`。守卫仍会拒绝未列举的固件或其他文件。

真机 FPS、触摸手感和实际绘制耗时尚未测量；本轮结论仅限 host 的定时频率、绘制消息与脏区口径，帧率提升幅度待接板验证。
