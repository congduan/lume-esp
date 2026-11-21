# esp-emu network acceptance

This runner boots the real Lume firmware on Espressif `esp-emu` and executes
`examples/net_check/app.js` from a generated LittleFS storage partition. It
does not use serial frame injection. The original merged image is copied before
the storage partition is populated.

Install the emulator (the binary stays outside this repository):

```sh
curl -fsSL https://raw.githubusercontent.com/espressif/esp-emulator/main/install.sh | sh
~/.local/bin/esp-emu --version
```

Install the image preparation dependency into the Python environment used by
the runner (the ESP-IDF 5.5 py3.12 environment on this host):

```sh
~/.espressif/python_env/idf5.5_py3.12_env/bin/python -m pip install littlefs-python==0.19.0
```

Run from the repository root:

```sh
tools/emu-net/run.sh examples/net_check
```

The runner uses `idf.py build` if the three firmware build images are absent,
then calls `python -m esptool merge_bin` from the build directory. It starts a
loopback HTTP server on port 18765. In user-mode networking, gateway
`192.168.4.1` maps to host loopback; the app requests that server. Output is
`artifacts/emu-net/net_check/serial.log` plus `flash.bin`, `http.log`, and
`merged_flash_size.txt`. The runner returns failure when the exit string is
absent, including esp-emu 1.2.0's zero-code timeout behavior.

`EMU_NET_SSID`, `EMU_NET_PASS`, `EMU_NET_EXIT_ON`, `EMU_NET_TIMEOUT` (seconds),
`EMU_NET_SD`, `EMU_NET_HTTP_PORT`, `EMU_NET_BIN`, `EMU_NET_PYTHON`,
`EMU_NET_BUILD_DIR`, and `EMU_NET_OUTPUT_DIR` override defaults. CLI forms are
`--ssid=...`, `--password=...`, `--exit-on=...`, `--timeout=...`, and `--sd=...`.
The default WiFi credentials are `emu-test` / `emupass123`. The AP is pinned to
WPA2-PSK. A plain `--sd=/path/card.img` gets `,cs=41` appended for this board;
an explicit esp-emu SD spec such as `--sd=/path/card.img,cs=41` is passed as is.
The SD branch runs only when an image is supplied. A FAT32 image can be made
with `dd if=/dev/zero of=card.img bs=1M count=64` followed by
`mkfs.vfat -F 32 card.img`.

For CI, set `EMU_NET_HEADLESS=1` and `EMU_NET_IMAGE=/path/merged_flash.bin` to
skip ESP-IDF build and merge. The Python LittleFS dependency and esp-emu binary
are still required. Set `EMU_NET_PYTHON` when using another Python environment.

This checks a virtual WiFi path. Board-level radio, display, touch, current,
and TF wiring acceptance remain separate.
