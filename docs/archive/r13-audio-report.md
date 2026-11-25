# r13 audio implementation report

Vendor checkout: `waveshareteam/ESP32-S3-Touch-AMOLED-2.16` main at `225a62b` (read from `/tmp/waveshare-amoled`). The `examples/esp-idf` demos do not contain a direct ES7210/ES8311 codec driver; the board's Arduino `06_ES7210` and `07_ES8311` examples provide the register sequences. Code here is a fresh implementation using ESP-IDF 5.5's I2C master and I2S standard drivers.

## Board and register cross-check

Paths under `examples/arduino/` refer to the vendor checkout. Own path is `firmware/components/lume-audio/lume_audio.c` unless otherwise stated. Values in a single table cell are in actual write order. Fixed 16 kHz uses MCLK = 4.096 MHz (256 × fs).

| Item | Vendor source:lines | Our source:lines | Match / note |
| --- | --- | --- | --- |
| I2C ES8311 = `0x18`; ES7210 = `0x40` | `07_ES8311/es8311.h:18-20`, `07_ES8311/07_ES8311.ino:24`; `06_ES7210/es7210.h:32-39` | `lume_audio.c:13-14,110-116` | 7-bit addresses |
| I2C SDA=15, SCL=14 | `libraries/Mylibrary/pin_config.h:16-17`; `06_ES7210/06_ES7210.ino:21`; `07_ES8311/07_ES8311.ino:52` | `firmware/components/lume-board/include/lume_pins.h:26-27`, `lume_board.c:95-106` | Shared board I2C bus |
| MCLK=42, BCLK=9, LRCK=45, DAC DOUT=8, ADC DIN=10 | `libraries/Mylibrary/pin_config.h:21-25`; `07_ES8311/07_ES8311.ino:15-19,47-48`; `06_ES7210/06_ES7210.ino:67-74` | `lume_pins.h:41-45`; `lume_audio.c:124-145` | I2S0 master TX and I2S1 slave RX use shared clocks |
| PA=GPIO46, high before codec init | `libraries/Mylibrary/pin_config.h:27`; `07_ES8311/07_ES8311.ino:54-57` | `lume_pins.h:46`; `lume_audio.c:142-148` | IDF 5.5.5 `esp32s3/soc_caps.h:187-189` permits output; speaker effect awaits board |
| ES8311 `00=1f,00,80`; `01=3f` | `07_ES8311/es8311.c:230-258,330-336` | `lume_audio.c:57-60,67` | Reset/power and MCLK pin source |
| ES8311 16k coefficient `02,03=10,04=10,05=00,06,07,08=ff` | `07_ES8311/es8311.c:73,174-225` | `lume_audio.c:61,68-75` | `02/06/07` preserve unrelated bits through read-modify-write; `06` divisor = 4−1 |
| ES8311 slave Philips 16-bit `00 bit6=0,09=0c,0a=0c` | `07_ES8311/es8311.c:261-303` | `lume_audio.c:63,75` | 16-bit I2S |
| ES8311 power/EQ `0d=01,0e=02,12=00,13=10,1c=6a,37=08` | `07_ES8311/es8311.c:341-346` | `lume_audio.c:64-65,76` | DAC power and EQ bypass |
| ES8311 analog MIC defaults `17=c8,14=1a,16=03` | `07_ES8311/es8311.c:306-316,405-407`; `07_ES8311/07_ES8311.ino:36-39` | `lume_audio.c:65` | Same vendor defaults even though ES7210 supplies record input |
| ES8311 volume `32`, mute `31` | `07_ES8311/es8311.c:356-375,391-402` | `lume_audio.c:95-101,153-160,184-189` | 0–100 maps to vendor formula; stop mutes |
| ES7210 reset `00=ff,41`; clocks `01=1f`; timing `09=30,0a=30` | `06_ES7210/es7210.cpp:282-286` | `lume_audio.c:82` | Same write order |
| ES7210 slave mode, analog/bias `40=c3,41=70,42=70` | `06_ES7210/es7210.cpp:311-321` | `lume_audio.c:83-84` | No master-mode `08/03` writes, matching vendor slave branch |
| ES7210 16k clocks `02=c1,07=20,04=01,05=00` | `06_ES7210/es7210.cpp:94,209-230,321-322` | `lume_audio.c:84` | Vendor 4.096 MHz / 16 kHz coefficient |
| ES7210 Philips 16-bit `11=60,12=00` | `06_ES7210/es7210.cpp:333-365,368-398` | `lume_audio.c:85` | Standard format and routing |
| ES7210 MIC power `4b/4c=ff→00`, gain `43/44=10,45/46=1e`, clocks `01=00`, ADC `06=00,47..4a=00` | `06_ES7210/es7210.cpp:235-267,401-412,450-473`; `06_ES7210/06_ES7210.ino:40-46` | `lume_audio.c:86-90` | All four enabled, MIC1/2 0dB, MIC3/4 37.5dB. Vendor HPF register writes are commented out at `es7210.cpp:287-290`; no AEC/denoise override. |

## Contract and limits

`lume.audio.play(buffer, opts)` and `record(seconds, opts)` are synchronous on the JS engine task. Both use signed little-endian, interleaved stereo, 16-bit, 16 kHz raw PCM; no WAV parsing. An optional format field with any other value returns `-1`. Record duration must be `(0, 10]` seconds. A native PSRAM buffer is copied into a QuickJS `ArrayBuffer` before being freed. `stop()` mutes subsequent output and cannot preempt a synchronous playback from the same JS task.

The vendor's ADC demo uses I2S1 RX alone; its ES8311 demo configures one I2S standard instance for TX/RX. On this board, both codecs share BCLK/LRCK/MCLK, so the implementation uses I2S0 master TX to drive those pins and I2S1 slave RX to receive on GPIO10. GPIO matrix timing and microphone channel mapping require hardware acceptance. No board was attached for this run; playback and recording were not claimed as tested.

## Build and size

Baseline build from detached worktree at `93b629c`, final build from this branch. Commands used `env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env` and sourced `/opt/esp/esp-idf/export.sh`.

Raw `idf.py build` completion (r13):

```text
lume.bin binary size 0x1c85d0 bytes. Smallest app partition is 0x640000 bytes. 0x477a30 bytes (71%) free.
[100%] Built target app_check_size
[100%] Built target app

Project build complete. To flash, run:
```

Raw baseline `idf.py build` size line:

```text
lume.bin binary size 0x1c3280 bytes. Smallest app partition is 0x640000 bytes. 0x47cd80 bytes (72%) free.
```

`stat -c '%s %n'`:

```text
1869264 firmware/build/lume.bin
1847936 /tmp/lume-r13-base/firmware/build/lume.bin
```

Binary increase: **21,328 bytes**. Raw `idf.py size --format csv`:

```csv
"Memory Type/Section","Used [bytes]","Used [%]","Remain [bytes]","Total [bytes]"
"Flash Code","1445266","","",""
"Flash Data","301444","","",""
"DIRAM","190691","55.8","151069","341760"
"IRAM","16384","100.0","0","16384"
```

Raw `idf.py size-components --format csv --output-file /tmp/lume-r13-components.csv` rows:

```csv
"Archive File","Total Size","IRAM",".text",".vectors","DIRAM",".bss",".data",".text","Flash Code",".text","Flash Data",".rodata",".appdesc","RTC FAST",".rtc_reserved","RTC SLOW",".force_slow"
"libesp_driver_i2c.a","12050","16","16","0","794","28","0","766","10861","10861","379","379","0","0","0","0","0"
"libesp_driver_i2s.a","9345","0","0","0","298","0","24","274","8673","8673","374","374","0","0","0","0","0"
"liblume-audio.a","1529","0","0","0","22","18","4","0","1367","1367","140","140","0","0","0","0","0"
```

The full logs remain in `/tmp/lume-r13-final.log`, `/tmp/lume-r13-base-build.log`, and `/tmp/lume-r13-components.csv` for local review.
