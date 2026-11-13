# Lume firmware (M1)

ESP-IDF project hosting the Lume JS runtime for the
Waveshare ESP32-S3-Touch-AMOLED-2.16.

## Components

- `lume-engine` — QuickJS-NG integration (engine task, PSRAM heap, event loop)
- `lume-board` — board init + JS bindings (display LVGL backend, touch, PMIC, IMU, audio, TF card)
- `lume-ui-bridge` — declarative UI → LVGL bridge (M1: View/Text/Button)
- `lume-hotreload` — USB CDC bundle receiver (M1)

## Build

```
idf.py set-target esp32s3
idf.py build flash monitor
```
