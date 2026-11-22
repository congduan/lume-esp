# Lume v0.3.2

本版汇集 v0.3.1 之后的时间、WiFi OTA、可靠性、组件和 Playground 更新。默认固件资产适用于 Waveshare ESP32-S3-Touch-AMOLED-2.16。

## 应用开发者

- **时间体系**：新增 `lume.system.setTimeNtp`，时钟、圆形时钟、Aurora Clock、表盘和天气应用优先通过 SNTP 校时；设置页提供手动同步。网络时间另有 HTTP 兜底源列表，时区选择通过 KV 持久化。
- **组件库**：可选 JS shell 增加 SafeArea、软键盘 Keyboard、Switch、Slider、Progress 表单控件，以及 ClickWheel 手势转盘。
- **Playground**：当前检入 56 个应用，新增或更新 Wordle、Wordring、Minigolf、Flapdot、心率监测、键盘演示、ADC 表、加密检查、归档与图片浏览、矢量演示、Aurora Clock、Skyfire、Plasma、音乐频谱、转盘音乐界面等。Flapdot 修复跳帧时振翅留下的鬼影。

## 设备与工具

- **WiFi OTA**：保留挑战响应 HMAC 鉴权；设置页加入 OTA 状态行和两段式 token 轮换，`ota_consumers` 守卫覆盖消费方。
- **可靠性工程**：增加 host OOM 注入及确定性失败断言、固件 OOM verb 门控和 denial-positive 演练；新增只读 `lume.perf` 绑定与 `lume.system.reboot`。
- **模拟器**：`tools/emu-net` 提供 esp-emu 无头网络验收入口。当前虚拟 WiFi 关联仍受上游行为阻塞，尚无成功 DHCP/HTTP 全链验收。

## 升级与验证边界

已有 Lume 固件的板子运行纯 JS 应用更新时，可使用 `lume deploy` 热更新；应用使用 SNTP、reboot、perf 等新增原生 API 时，需刷入 v0.3.2 固件。固件构建、host 回归和模拟器证据不等于真机验收；显示、触摸、WiFi、OTA、休眠电流等仍待实板验证。
