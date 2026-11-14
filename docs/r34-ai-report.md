# r34 AI API implementation report

Baseline check: local `main` HEAD was `4e07c8b` (not brief's `7ad3ac8`); `git fetch origin` advanced `origin/main` to `d7e7e78`; working tree was clean. Work was made on local `main` without merge or push.

## Contract evidence

| [DeepSeek official Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | Implementation |
|---|---|
| `POST /chat/completions` and JSON body | `lume.ai.chat` builds URL and JSON payload |
| `messages` required, `model` required | validates nonempty messages; default `deepseek-flash` from [official first call](https://api-docs.deepseek.com/) |
| `max_tokens`, `temperature`, `stream` | optional camel-case JS options become API field names; `stream:false` |
| `choices[0].message.content`, `finish_reason`, `usage` | result `{content, finishReason, usage}` |
| Bearer key | `Authorization` header from NVS `ai_api_key` |

Native implementation uses IDF v5.5.5 `esp_http_client_set_header`, `esp_http_client_set_post_field`, and `esp_http_client_perform`; [IDF HTTP client documentation](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32/api-reference/protocols/esp_http_client.html) describes the synchronous perform path and TLS verification. The local header `/opt/esp/esp-idf/components/esp_http_client/include/esp_http_client.h` was checked for these declarations. A complete response lives in a 32 KiB PSRAM buffer; a 16 KiB request cap bounds the POST body. The HTTPS certificate bundle adds approximately 75 KiB to the image. The `httpsInsecure` Kconfig switch only skips validation for requests with no CA/bundle; `httpRequest` supplies the bundle by default. A valid system clock is necessary for certificate date checks.

## Raw host verification

`node tests/ai.js`:

```text
request construction + key storage: PASS
HTTP error + timeout + bad JSON + truncation: PASS
Node local POST round trip: PASS
```

The local Node server exercises HTTP POST round trip from Node's `fetch`; it does **not** execute the ESP-IDF C client. The C client has compile and API-contract checks only.

`for f in tests/*.js; do node "$f" ...; done`: all harnesses exited 0, including `tests/ai.js`, `apps.js`, `ble.js`, `canvas_mapping.js`, `gesture_queue.js`, `lifecycle.js`, `reload_staging.js`, and `text_payload.js`.

`npm test --prefix tools/lume`:

```text
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`python3 scripts/check_website.py`:

```text
HTML pages: 6; internal href/src and anchors checked
API: 94 catalog entries, 94 type declarations, 22 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

`idf.py build` tail:

```text
[100%] Built target lume.elf
Successfully created esp32s3 image.
lume.bin binary size 0x230d40 bytes. Smallest app partition is 0x640000 bytes. 0x40f2c0 bytes (65%) free.
[100%] Built target app_check_size
[100%] Built target app
Project build complete.
```

`idf.py size`:

```text
Flash Code        1681278
Flash Data         467748
DIRAM              229823 / 341760
IRAM                16384 / 16384 (100.0%; 0 remain)
Total image size: 2297025 bytes (.bin may be padded larger)
```

Baseline in `docs/r34-implementation-report.md`: image 2,220,217 bytes, `.bin` `0x21e130`. Current image grew **76,808 bytes**, `.bin` grew **76,816 bytes**. IRAM remains at the 16,384-byte limit.

## Board acceptance pending

No board was attached. Association, SNTP clock setup, verified DeepSeek HTTPS, a custom CA, explicit insecure test mode, response truncation on a long real answer, and UI/touch behavior during a blocking call remain unverified. The synchronous API freezes JS event handling until completion. SSE and async event-loop integration, keyboard input, and encrypted key storage are deferred as recorded in `KNOWN-SIMPLIFICATIONS.md`.

Full raw `idf.py size` table:

```text
Memory Type Usage Summary                            
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      1681278 │          │                │               │
│    .text          │      1681278 │          │                │               │
│ Flash Data        │       467748 │          │                │               │
│    .rodata        │       467492 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       229823 │    67.25 │         111937 │        341760 │
│    .text          │       107687 │    31.51 │                │               │
│    .bss           │        98328 │    28.77 │                │               │
│    .data          │        23808 │     6.97 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC FAST          │          112 │     1.37 │           8080 │          8192 │
│    .text          │           84 │     1.03 │                │               │
│    .rtc_reserved  │           24 │     0.29 │                │               │
│    .force_fast    │            4 │     0.05 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 2297025 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical 
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it 
cannot be reliably determined due to the presence of other data like the 
bootloader, partition table, and application partition size.
Built target size
```
