# r88 圆屏应用与 playground 报告

## 实证与 API 差异

- `runtime/types/lume.d.ts` 没有 `lume.rtc.now()`。`examples/clock` 以 `Date` / `lume._nowMs()` 取时间，并可经网络校时。本轮圆屏时钟使用 `new Date()`；未联网的设备显示设备系统时间，准确墙钟时间留待真机联网验证。
- `lume.imu.read()` 返回 `{ax,ay,az,gx,gy,gz}` 或 `null`，`gz` 单位为度/秒，`ax/ay` 为 m/s²。QMI8658 没有磁力计，罗盘只显示陀螺仪积分的相对方位，不表示磁北或地理北。`examples/compass` 也是 `gz` 积分并标注漂移。本轮缺样本时使用模拟数据，角标为 `SIM`；有样本时为 `REL`。
- Canvas 仅用 `clear/fillRect/line/circle/arc/text`，均见 `CanvasContext` 声明。没有使用 ellipse 或路径填充。

## 圆屏安全区

两个应用在 480 逻辑坐标中央放置 400×400 Canvas，表盘外缘半径最多 188，文本及标记也位于圆心 233 的内切圆内。Playground 将完整 480 逻辑画面等比缩到 466 并裁成圆形，故关键内容距裁切边界至少约 45 逻辑像素。方屏仍以 480×480 居中显示。`tools/simulator/renderer.js` 的 480 坐标未修改，此点仍是本轮已知简化。

时钟绘制 60 条刻度、三根不同线宽的指针、数字时间。逻辑与 `/* GAME UI */` 分段；角度函数纯净。仪表上部为相对方位，下部为加速度映射的气泡水平仪；气泡按 ±9.81 m/s² 归一化并限幅。绘图调用的 host 计数分别为每帧 71、28 次，低于 200。

## Playground

`tools/playground/build.mjs` apps 列表新增两个入口，重生成 `apps/`、`sources/` 与 `sources.js`；`prelude.js` 从固件 C 字符串生成且内容未变。预览区提供方形 480×480、圆形 466×466 两个按钮。圆形把 `.device-wrap` 设为 `width: min(466px,100%)`、`border-radius: 50%`；既有 resize 逻辑把 480 逻辑画面缩放到框宽。形状记在 `localStorage` 的 `lume-screen-shape`，刷新恢复。源码分享 hash 保持原语义。

## 验证

原始输出见 `artifacts/r88/`，截图为 `01-square.png`、`02-round.png`、`03-clock-round.png`、`04-dashboard-round.png`。

```text
PASS clock_round pure angles, prelude, 71 calls/frame, 60-second tick smoke
PASS dashboard_round SIM prelude, 28 calls/frame
PASS dashboard_round IMU prelude, 28 calls/frame
PASS dashboard_round relative heading and linear level mapping
```

```text
lume check examples/clock_round
[PASS] bundle   1339 bytes (153 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)

lume check examples/dashboard_round
[PASS] bundle   1877 bytes (168 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
```

```text
HTML pages: 7; internal href/src and anchors checked
API: 130 catalog entries, 130 type declarations, 30 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

Playwright 输出：`{"info":{"round":"50%","width":466,"title":"Round dashboard","error":""},"persisted":true,"errors":[]}`。

## 真机调参

- 时钟针长、线宽及颜色需在 466 AMOLED 上核对对比度和高亮下可读性。
- QMI8658 的 Z 轴正负、板子正面朝向、水平仪 `ax/ay` 映射方向需实测后调节；陀螺积分会漂移。
- 本轮均为 host / 浏览器验证，没有板上显示、触摸、RTC、IMU 或功耗验收。

全量 `tests/*.js` 循环完整退出码为 0；`artifacts/r88/regression.txt` 共 497 行，`rg '^FAIL'` 无匹配。原始末尾输出：

```text
PASS stop lifecycle
PASS built-in welcome and handler exception
webserver: 8 cases PASS
WebSocket host prelude: PASS
```
