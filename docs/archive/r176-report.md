# r176 report — M5 board abstraction, second cut: register lume-board drivers into the HAL singleton (zero behaviour change)

Baseline: `origin/main` `83498cc` (2026-11-23). Worktree `/tmp/lume-r176-wt`, branch
`r176-hal-consumers`. Opening guard: `bash /home/ubuntu/.hermes/scripts/lume_model_guard.sh`
-> `GUARD: settings.json model=hy4flash-free ✓` / `GUARD: model=hy4flash-free ✓ (settings + runtime audit clean)`,
no 429, no writes into the main repo `/home/ubuntu/lume`.

## 1. Empirical findings (source first; brief assumptions corrected where needed)

| HAL op | Real driver shape (source) | Verdict |
|---|---|---|
| `panel_init` | `esp_err_t lume_display_init(lv_display_t **out_disp)` — `lume_display.c:459` | maps via adapter; `void **` cast for the erased out-param |
| `touch_init` | `esp_err_t lume_touch_init(i2c_master_bus_handle_t bus, lv_display_t *disp)` — `lume_touch.c:214` (CST9220) and `:382` (CST816S) | maps via adapter; both params are pointer-sized |
| `touch_read` | **no standalone point-read API**. Reads happen in the static LVGL indev callback `indev_read_cb(lv_indev_t *, lv_indev_data_t *)` — `lume_touch.c:136` and `:324`; it also owns error recovery and throttled logging | **DRIFT**: the brief's "point read (x, y, pressed)" has no real function to register. Downgraded honestly (see below) |
| `power_init` | `esp_err_t lume_pmic_display_power_on(i2c_master_bus_handle_t bus)` — `lume_pmic.c:79` | still exists; maps via adapter |

Call timing in `lume_board_init()` (unchanged order): step 0 registration
(`lume_board.c:315`) happens before step 2 PMIC (`:335`), step 3 LVGL/display
(`:356`) and step 4 touch (`:360`). Registration is an observation point only;
the init flow still calls every driver directly. Board identity comes from
`LUME_BOARD_NAME`, present in all three profiles
(`2_16` profile `:159`, `1_75c` `:149`, `1_8` `:340`).

`esp_err_t` uses positive error codes while the HAL contract is 0/negative, so
the adapters map `ESP_OK -> 0`, positive codes -> `-err`, already-negative codes
unchanged (`lume_board.c:38-43`). No adapter is reachable from any existing call
path, so this mapping cannot alter current behaviour.

## 2. Implementation (feat commit `4a2bd29`)

- `lume-board-hal/include/lume_board_hal.h:66` / `lume_board_hal.c:66`: new
  `int lume_board_hal_register(const lume_board_t *board)`. It validates
  non-NULL board, all four ops and a non-empty `board_id` (`-2` =
  `LUME_BOARD_ERR_INVALID_ARG`), **copies** the struct into a static slot and
  repoints the singleton; `lume_board_get()` stays stable. Stale "NO consumer
  today" / "runtime dispatch stub" comments replaced with registry wording
  that still states there is no dispatch consumer.
- `lume-board/CMakeLists.txt`: added `REQUIRES lume-board-hal`. The HAL CMake
  has no `REQUIRES` at all — dependency points one way.
- `lume_board.c`: three real init ops registered via adapters; `touch_read` is
  a non-NULL NOT_SUPPORTED face because no real point-read function exists.
  This is the brief's downgrade clause: exposing one would require refactoring
  `lume_touch.c` (splitting the indev callback), which is out of scope for a
  zero-behaviour-change slice. No driver source (`lume_display.c`,
  `lume_touch.c`, `lume_pmic.c`) was modified; no profile or vendored file was
  modified; prelude / `runtime/` / `tools/` untouched.

## 3. Verification (raw output excerpts; compile/host evidence, NOT hardware)

Wrapper used exactly as briefed except `cd` points at the worktree copy of
`firmware/` so the main repo stays clean:
`cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /tmp/lume-r176-wt/firmware && idf.py build'`.

### 3.1 Build + size (logs: `artifacts/r176/{baseline-build,baseline-size,build,size}.log`)

Live pre-edit baseline at `83498cc` (`BASELINE_BUILD_EXIT=0`, `BASELINE_SIZE_EXIT=0`):
```
lume.bin binary size 0x2e61b0 bytes. Smallest app partition is 0x640000 bytes. 0x359e50 bytes (54%) free.
| Flash Code          |      2044328 |
| Flash Data          |       853436 |
| DIRAM               |       247491 |    72.42 |          94269 |        341760 |
| IRAM                |        16384 |    100.0 |              0 |         16384 |
Total image size: 3039535 bytes (.bin may be padded larger)
```
After the change (`BUILD_EXIT=0`, `error:` count 0, `SIZE_EXIT=0`):
```
lume.bin binary size 0x2e62e0 bytes. Smallest app partition is 0x640000 bytes. 0x359d20 bytes (54%) free.
| Flash Code          |      2044520 |
| Flash Data          |       853532 |
| DIRAM               |       247523 |    72.43 |          94237 |        341760 |
| IRAM                |        16384 |    100.0 |              0 |         16384 |
Total image size: 3039839 bytes (.bin may be padded larger)
```
Deltas vs the live baseline: Flash Code **+192 B**, Flash Data +96 B, DIRAM +32 B,
total image **+304 B** (`lume.bin` 0x2e61b0 -> 0x2e62e0). Against the r147
snapshot (Flash Code 2041288) the cumulative delta is +3232 B across all
intervening rounds plus this one. **IRAM stays 16384 / Remain 0 — hard line not
broken.** Map evidence confirms the registry is now linked:
`esp-idf/lume-board/liblume-board.a(lume_board.c.obj) (lume_board_hal_register)`.
The build dir was removed immediately after size capture (`rm -rf firmware/build`):
`df -h /` 4.2G avail -> 4.5G avail.

### 3.2 Host harnesses

`node tests/board_abi.js` -> `BOARD_ABI_EXIT=0` (log `artifacts/r176/board-abi.log`):
```
PASS header declares registration API and invalid-arg code
PASS impl copies the board and keeps a stable current pointer
PASS lume-board registers real drivers with the profile board name
PASS touch_read drift documented: no standalone driver point-read API
PASS dependency points lume-board -> lume-board-hal, never the reverse
PASS all four ops return -1 (not supported) before registration
PASS invalid registrations rejected; generic stub still current
PASS registered board queryable: four non-NULL ops + board_id
PASS registry copies the struct and stays stable
PASS registered ops dispatch to the host fake with correct args
board_abi: ALL CHECKS PASSED
```
The C harness (`tests/board_abi.c`, gcc `-std=c11 -Wall -Wextra -Werror`) keeps
the 4-op layout `_Static_assert`s and adds host-only fake-registration checks;
it never links firmware.

Full sweep `for t in tests/*.js; do node "$t" || echo FAIL $t; done`:
- Before re-pin (`artifacts/r176/regression-before-repin.log`): **22 FAIL** —
  13 app-only guards plus 8 more firmware-diff guards (`confirm_sweep`,
  `control_center`, `controls_demo`, `keyboard_demo`, `keyboard_states`,
  `launcher_grid`, `settings_dialog`, `timer_kit`, `wordle`) and the baseline
  `ota_consumers` stale-allowlist failure. Every failure was a BASE-pinned
  firmware diff assertion; board_abi itself stayed green (its guard excludes
  both board components).
- After re-pin (`artifacts/r176/regression-after-repin.log`): **0 FAIL**.

### 3.3 BASE re-pin (test commit `1a07692`)

All 22 guard BASEs re-pinned to feat `4a2bd29`; `controls_demo` had a second
`HEAD_BASE` pin (`31adb96`) also re-pinned. Semantics were not relaxed:
`git diff` predicates, allowlist membership and mutation proofs are byte
identical except the BASE hash/labels, and `ota_consumers` admits this round's
regenerable evidence by an `artifacts/r176/` prefix (same pattern the r173
precedent uses for `artifacts/r173/`).

### 3.4 Other checks

- `npm test --prefix tools/lume` -> `NPM_TEST_EXIT=0`, `# tests 52 / # pass 52 / # fail 0 / # skipped 0` (`artifacts/r176/npm-test.log`).
- `python3 scripts/check_website.py` -> `WEBSITE_EXIT=0`, `API: 161 catalog entries, 161 type declarations, 34 function namespaces`, `API missing/invented/duplicates: none` (`artifacts/r176/website.log`).
- Sentinel `node tools/lume/lume.js check examples/counter --no-emu` -> `LUME_CHECK_EXIT=0`, `RESULT: PASS (4 steps, 0 failed; exit 0)` (`artifacts/r176/lume-check.log`).
- Worktree lacked gitignored `tools/lume/node_modules` and `tools/lume/bin`; both were aligned as read-only symlinks to the main repo. No source under `tools/` changed.

## 4. Milestone / honesty statement

All conclusions above are **compile/host evidence, not on-device verification**.
No display, touch, sleep-current, radio or second-board measurement was taken.
The M5 Board abstraction checkbox stays unticked: there is no second board,
no runtime switching, and no real board acceptance. `touch_read` is advertised
as NOT_SUPPORTED until a real point-read API exists; the registry has no
dispatch consumer yet, so existing behaviour is unchanged. ASCII-only strings
in code and UI; commits split feat / test / docs; **not pushed**; no codex
review (controller round handles that).
