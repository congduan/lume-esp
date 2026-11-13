# Roadmap

## M1 — minimal loop (current)
Goal: prove the full stack on real hardware with the smallest possible surface.

- [ ] ESP-IDF 5.5 project skeleton + Waveshare BSP (`waveshare/esp32_s3_touch_amoled_2_16`)
- [ ] QuickJS-NG as IDF component, engine task with PSRAM heap
- [ ] LVGL integrated as render backend (hidden from JS)
- [ ] Native bridge: minimal declarative View/Text/Button → lv_obj ops
- [x] CST9220 touch events → QuickJS event loop → JS callback（代码链路已通；mirror_y/swap_xy 方向待实机确认）
- [x] Hot reload over USB CDC（JS 源码推包 + engine runtime 重置；代码链路完整，实机推包验证待接板。bytecode 化留后续）
- [ ] Demo app: interactive button counter,全程 JS

## M2 — hardware API surface
- [ ] GPIO / PWM / ADC bindings
- [ ] AXP2101 power bindings (battery telemetry, power off/reboot)
- [ ] QMI8658 IMU bindings (poll + motion interrupt)
- [ ] WiFi + HTTP client bindings
- [ ] NVS KV store + LittleFS partition
- [ ] ES8311/ES7210 audio playback/record

## M3 — declarative UI completeness
- [ ] Flex layout engine in the bridge (map to LVGL flex)
- [ ] Style resolution (padding/margin/background/border/corner/opacity)
- [ ] List virtualization, image rendering (PNG/JPG decode)
- [ ] Animation primitives (tween/transition)
- [ ] Gesture layer (tap/swipe/long-press/pan)

## M4 — tooling
- [ ] `lume` CLI: create / dev / deploy (esbuild → qjs bytecode → push)
- [ ] WiFi OTA channel (TCP push, port + auth token)
- [ ] Host simulator (LVGL SDL backend + QuickJS on desktop)

## M5 — ecosystem
- [ ] Component library
- [ ] Docs site + example gallery
- [ ] Board abstraction for additional targets
