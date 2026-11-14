# Roadmap

## M1 — minimal loop (current)
Goal: prove the full stack on real hardware with the smallest possible surface.

- [x] ESP-IDF 5.5 project skeleton + Waveshare BSP (`waveshare/esp32_s3_touch_amoled_2_16`)（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] QuickJS-NG as IDF component, engine task with PSRAM heap（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] LVGL integrated as render backend (hidden from JS)（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] Native bridge: minimal declarative View/Text/Button → lv_obj ops（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）
- [x] CST9220 touch events → QuickJS event loop → JS callback（代码链路已通；mirror_y/swap_xy 方向待实机确认）
- [x] Hot reload over USB CDC（JS 源码推包 + engine runtime 重置；代码链路完整，实机推包验证待接板。bytecode 化留后续）
- [x] Demo app: interactive button counter,全程 JS（代码链路完整；实机验收（点屏/触摸方向/推包）待接板）

## M2 — hardware API surface
- [x] GPIO / PWM / ADC bindings（r6/r7 代码完成 + Codex review 通过；实机采样精度/驱动能力验收待接板）
- [x] AXP2101 power bindings (battery telemetry, power off/reboot)（r8 代码完成 + Codex review P-with-fixes，两条 follow-up 已修并复测；实机电池读数/powerOff 验收待接板。reboot 绑定归 lume.system，后续轮）
- [x] QMI8658 IMU bindings (poll + motion interrupt)（r9 代码完成 + Codex review P-with-fixes（唯一发现：ODR 文档命名 vs 6DOF 有效速率，已修）+ 主控独立复测通过后勾选。polled-only：lume_pins.h 无 IMU INT 定义，运动/数据就绪 INT 中断留接板轮；验收 = 编译绿 + size 达标 + Waveshare 官方例程自查；真机读数验收留接板轮）
- [ ] WiFi + HTTP client bindings（r11 代码完成：新组件 `lume-net` + `lume.net` / `lume.net.http` 绑定，station/WPA2-PSK/同步 httpGet/status 状态机；验收 = 编译绿 + IRAM 16384 不超 + 逐条对照 ESP-IDF v5.5.5 头文件与官方 station/esp_http_client example 自查。WiFi IRAM_OPT/RX_IRAM_OPT=n 压住 IRAM；Flash Code 844742→1398890（+554148，WiFi 栈传递链接 libnet80211/libpp/liblwip/wpa_supplicant/mbedtls，r10 基线被 gc 掉，见 KNOWN-SIMPLIFICATIONS r11 归因）。真机连 WiFi / HTTP 实测留主控接板轮，故整行保持未勾选）
- [ ] NVS KV store + LittleFS partition（r10 Kv（`lume.storage.kv`）**代码完成 + Codex review N→必修（5 发现：map_err 吞 ESP_OK、string 边界值读写不对称、内嵌 NUL key、keys() 吞异常、get() 负值判别歧义）→ 主控已修 + 复审 P-with-fixes（1 发现已修）+ 独立复测绿（IRAM 16384 不变，Flash Code 824086→844742，其中 libnvs_flash.a 首链 14537B / liblume-storage.a 1723B）+ 已推送**。r12 LittleFS / `lume.storage.Fs` 代码完成（组件固定 1.22.3，分区 subtype 改为 littlefs，首挂失败自动格式化；构建与尺寸见 r12 战报）；真机首次挂载、读写和掉电持久性验收留主控接板轮，故整行保持未勾选）
- [ ] ES8311/ES7210 audio playback/record（r13 `lume-audio` + `lume.audio`：16 kHz/16-bit/stereo 裸 PCM 同步放音及最多 10 秒录音，ES8311/ES7210 寄存器序列对照 Waveshare Arduino 示例；构建与尺寸见 r13 战报。GPIO46 PA 实际时序和真机放音/录音验收留接板轮，故整行保持未勾选）

## M3 — declarative UI completeness
- [x] Flex layout engine in the bridge (map to LVGL flex)（r14：flex 方向/主轴/交叉轴/gap/padding/百分比宽高桥接 LVGL flex，CSS camelCase 在 prelude 解析；host harness 校验含负向用例）
- [x] Style resolution (padding/margin/background/border/corner/opacity)（r14 部分：padding/gap/borderRadius/borderWidth/borderColor/opacity/百分比已落地；margin 与分边 padding 登记简化，见 KNOWN-SIMPLIFICATIONS）
- [ ] List virtualization, image rendering (PNG/JPG decode)（r19：LVGL 原生滚动容器、固定行高窗口化 List、滚动反向事件和 files app 已落地；PNG/JPG 解码仍空缺，真机手感待接板，整行保持未勾）
- [x] Animation primitives (tween/transition)（r15 代码完成：LVGL lv_anim 桥接、signal transition、lume.anim.to/cancel、完成事件回流与滑入示例；host harness/构建/size 验证，真机视觉流畅度待接板）
- [ ] Canvas self-drawing widget（r16 代码完成：LVGL RGB565 canvas + PSRAM 预算、Canvas/onDraw 绘制 API、signal effect 重绘与折线图 flex 混排示例；host harness/构建/size 见 r16 战报。真机像素、时序和视觉验收留接板轮，故保持未勾选）
- [ ] Gesture layer (tap/swipe/long-press/pan)
- [x] App lifecycle（r17：生命周期钩子、BACK/PAUS/RESM 协议、timer、热替换释放链；真机待验收）
- [x] Theme system（r18：lume.theme flat color tokens + default radius，命名色通过 owned effect 在 theme.set 时重发 ATTR；fontScale 仅登记，真机视觉待接板验收。详见 docs/brookesia-learnings.md 和 KNOWN-SIMPLIFICATIONS）

## M4 — tooling
- [ ] `lume` CLI: create / dev / deploy (esbuild → qjs bytecode → push)
- [ ] WiFi OTA channel (TCP push, port + auth token)
- [ ] Host simulator (LVGL SDL backend + QuickJS on desktop)

## M5 — ecosystem
- [ ] Component library
- [ ] Docs site + example gallery
- [ ] Board abstraction for additional targets
