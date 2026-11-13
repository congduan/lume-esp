# Hardware API design

This document defines the JS-facing hardware API surface that Lume's native layer
exposes. All APIs are asynchronous-first where the underlying operation can block
(I2C transactions, WiFi, audio), synchronous where cheap (GPIO, battery telemetry).

Target board: Waveshare ESP32-S3-Touch-AMOLED-2.16.

| Peripheral | Chip | Interface | Notes |
|---|---|---|---|
| Display | CO5300 | QSPI (GPIO4/5/6/7, 38, 12, rst 39) | 480×480, driven by LVGL |
| Touch | CST9220 | I2C (SDA 15 / SCL 14) | int → event loop → JS callback |
| PMIC | AXP2101 | I2C (shared bus) | battery/charging/power rails |
| IMU | QMI8658 | I2C (addr 0x6B) | accel + gyro, optional FIFO |
| Audio out | ES8311 | I2S (MCLK 42, SCLK 9, LRCK 45, DOUT 8) | speaker |
| Audio in | ES7210 | I2S / shared codec path | mic |
| Expansion | header GPIOs | GPIO/PWM/ADC | full JS access |

## Module layout

```
lume/gpio       DigitalIn, DigitalOut, Pwm, Adc
lume/i2c        I2c bus + generic register access
lume/board      Power (AXP2101), Imu (QMI8658), Audio (ES8311/ES7210),
                Touch, Display
lume/net        Wifi, Http, Ble
lume/storage    Kv (NVS), Fs (LittleFS partition)
lume/system     sleep, reboot, time, timers, log
lume/ui         App, View, Text, Button, Image, List, ... (declarative)
```

## Conventions

- Pin numbers are board constants exported from `lume/board` (e.g. `Pins.I2C_SDA`),
  raw numbers allowed for expansion headers.
- Expected failures return typed `Result`-style values; unexpected ones throw.
- Event callbacks run on the JS task; native drivers push events into the QuickJS
  event loop (never call JS from ISR directly).
- Bytecode, not source, is what ships to the device (esbuild → qjs bytecode).

## Hot reload

The runtime exposes a small loader over USB CDC and (optionally) WiFi TCP:

```
push bundle.lumepak → validate header → mount → engine reload → app restart
```

Native peripherals stay alive across reloads; only the JS engine state is reset.
