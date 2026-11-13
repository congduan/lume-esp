# Build & development (M1 notes)

## Toolchain
- ESP-IDF v5.5
- Board component: `waveshare/esp32_s3_touch_amoled_2_16 ^2.0.1`
- QuickJS-NG (vendored as IDF component, patched for PSRAM heap)
- LVGL v9 (vendored)

## Directory layout (planned)

```
firmware/            ESP-IDF project (Lume runtime)
  main/              engine task, event loop, hot-reload server
  components/
    lume-engine/     QuickJS-NG integration
    lume-ui-bridge/  declarative → LVGL bridge
    lume-board/      board drivers + JS bindings (CO5300/CST9220/AXP2101/QMI8658/audio)
runtime/             JS-side API (TS types + prelude shipped as bytecode)
tools/               lume CLI (M4)
examples/            JS example apps
docs/
```

## Building
```
idf.py set-target esp32s3
idf.py build flash monitor
```

## Deploying a JS app (M1: USB CDC)
```
lume deploy examples/counter   # esbuild → qjs bytecode → serial push
```
