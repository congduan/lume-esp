# r57 — `lume.net.ws` WebSocket client 收口报告

## 实施与改动面

基线 `f9f1620`，分支 `r57-ws`。Codex credits 在上一轮实施中耗尽，中断了一次；主控随后独立复测固件构建、size 和 host 回归。本轮 Codex 自查 diff、复跑 host 检查，按逻辑单元提交并补齐本报告。未做真机验收。

- `firmware/main/idf_component.yml` 声明 `espressif/esp_websocket_client 1.8.0`；`lume-net/CMakeLists.txt` 接入组件和新源文件；`sdkconfig` 固化 WebSocket 配置。已跟踪的 `firmware/dependencies.lock` 在本 worktree 已含该版本，本轮没有 diff。
- `lume_ws.c` 管理两个连接槽、ESP WebSocket 事件及发送/关闭；`lume_ws_frame.c/.h` 拼接分片并产出由接收方拥有的 payload；`lume_net.h` 声明 sink 与传输接口。
- `lume_engine.c/.h` 注册原生绑定，把事件排入引擎队列，并在引擎线程派发到 JS；`lume_scripts.c` 提供应用层连接对象、回调与 Promise 封装。
- `runtime/types/lume.d.ts`、`docs/hardware-api.md`、`website/api.html` 和 `docs/KNOWN-SIMPLIFICATIONS.md` 更新契约与限制；`tests/lib/prelude_runner.js` 增加 host stub；`tests/ws.js`、`tests/ws_frame.c` 和 `examples/ws_echo/app.js` 覆盖基本流程。

## API 契约

`lume.net.ws.connect(url, options?, cb?)` 接受 `ws://` 或 `wss://` URL。`options` 可含 `headers`、`onOpen`、`onMessage`、`onClose`、`onError`。带 `cb` 时，连接成功调用 `cb(null, handle)`，连接失败调用 `cb(negativeError, null)`，且只结算一次；省略 `cb` 时返回 `Promise<handle>`。`handle.send(string | ArrayBuffer)` 发送文本或二进制帧，`handle.close()` 关闭连接，均返回 `0` 或负错误码。`onMessage` 收到 `string | ArrayBuffer`。错误码：`-1` 参数或句柄、`-2` 传输、`-3` 无 WiFi IP、`-4` 两槽已满。

同时最多两个连接；接收逻辑消息上限 64 KiB。传输层将片段复制并拼接成独立 owned payload；队列投递失败或 JS 派发完毕后释放。发送长度也限制为 64 KiB。连接 ID 递增，旧句柄不会误指向复用的连接槽。

事件路径：`esp_websocket` 回调线程 → `lume_net_ws_sink_t` → 有界 FreeRTOS 引擎事件队列 → 引擎线程 `dispatch_ws()` → JS `__lume_dispatchWS()` → 应用回调。回调不在 WebSocket 组件线程运行。事件队列拥塞时可丢事件，消息 payload 仍释放；`send()` 最多阻塞引擎约 1 秒。

## 构建与验证

主控在上一轮中断后**独立复测**：`idf.py build` exit 0；IRAM `16384/16384`，与基线持平，未超过硬线；Flash Code `1955504 → 1971076` 字节（`+15572`）；DIRAM `+56` 字节；原有 host 测试无回归。以下 size 数值来自主控复测记录，本轮未重新运行完整固件构建；本地 `build-r57.log` 是此前未完成的构建输出，不能作为构建成功证据。

本轮重新执行的原始 host 输出：

```text
$ node tests/ws.js
WebSocket host prelude: PASS
$ cc -std=c11 -Wall -Wextra -Werror -Ifirmware/components/lume-net/include tests/ws_frame.c firmware/components/lume-net/lume_ws_frame.c -o /tmp/lume-r57-ws-frame-check && /tmp/lume-r57-ws-frame-check
WebSocket owned-copy frame C test: PASS
$ for t in tests/*.js; do node "$t" ...; done
PASS tests/ai.js
PASS tests/animation_mapping.js
PASS tests/apps.js
PASS tests/async_jobs.js
PASS tests/ble.js
PASS tests/canvas_mapping.js
PASS tests/create_failure.js
PASS tests/files_dialog.js
PASS tests/games.js
PASS tests/gesture_queue.js
PASS tests/gestures.js
PASS tests/gravity_ball.js
PASS tests/image_mapping.js
PASS tests/lifecycle.js
PASS tests/list_virtualization.js
PASS tests/music_player.js
PASS tests/power.js
PASS tests/reload_staging.js
PASS tests/shell_components.js
PASS tests/style_mapping.js
PASS tests/text_payload.js
PASS tests/theme_mapping.js
PASS tests/weather.js
PASS tests/ws.js
HOST_JS_PASS=24
$ python3 scripts/gen_api_docs.py --check && python3 scripts/check_website.py
api.html is up to date with lume.d.ts (112 entries)
HTML pages: 6; internal href/src and anchors checked
API: 112 catalog entries, 112 type declarations, 25 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

## 已知简化与真机验收

有界引擎队列没有 WS 专用背压；队列饱和可丢事件。示例需要填写 WiFi 凭据并访问公共 echo endpoint。host 测试验证 JS 路由和 C 帧所有权，不证明 WiFi 或 TLS 的设备行为。

真机 pending：WiFi 下 `esp_websocket` 长连接和断线稳定性、收发时延/吞吐与内存峰值、流量下的触控响应、TLS 证书 bundle 与公共 echo endpoint 的握手、关闭与重连行为。上述项目交由主控板级验收，不能以绿色构建或 host harness 代替。
