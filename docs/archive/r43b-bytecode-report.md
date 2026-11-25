# r43b — app bundle 字节码装载（任务 A）

基线 `d501ebd`（-O2）。任务 B 结论：GC 耗时占比 <5%，**不做** size-class 分流（见 `docs/r43b-gc-report.md`）。**未接真机**；所有运行数据来自 esp32sim 上 booting 的真实固件镜像。测量期 `CONFIG_LUME_PERF_PROFILE=y`，最终构建已恢复默认关。

## A1 实证 qjsc 可用性

### vendored 源码与 meson.build 源文件清单

`ls firmware/components/quickjs-ng/` 含 `qjsc.c` / `qjsc.man`。**以 `firmware/components/quickjs-ng/meson.build` 为准**（不凭记忆）：

```meson
qjs_srcs = files('dtoa.c', 'libregexp.c', 'libunicode.c', 'quickjs.c')   # :138-143
qjs_libc_srcs = files('quickjs-libc.c')                                  # :149
qjsc_srcs = files('qjsc.c')                                              # :306-308
qjsc_exe = executable('qjsc', qjsc_srcs, c_args: qjs_c_args,
                      dependencies: [qjs_dep, qjs_libc_dep])             # :309-316
qjs_c_args = ['-D_GNU_SOURCE']                                           # :162
```

项目公共参数还有 `-DQUICKJS_NG_BUILD` 与 `-funsigned-char`（`meson.build:19,42`）。宿主编译据此构造命令（`tools/lume/fetch-qjsc.sh` 固化）：

```bash
gcc -O2 -std=gnu11 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -DQJS_BUILD_LIBC \
  -funsigned-char \
  -I firmware/components/quickjs-ng \
  -I <stub> -I firmware/components/lume-perf/include \
  firmware/components/quickjs-ng/qjsc.c \
  firmware/components/quickjs-ng/quickjs.c \
  firmware/components/quickjs-ng/dtoa.c \
  firmware/components/quickjs-ng/libregexp.c \
  firmware/components/quickjs-ng/libunicode.c \
  firmware/components/quickjs-ng/quickjs-libc.c \
  -o tools/lume/bin/qjsc -lm -lpthread -ldl
```

`<stub>` 是一个临时目录，里面只有 `sdkconfig.h`：`#define CONFIG_LUME_PERF_PROFILE 0`。因为 r36b 在 vendored `quickjs.c` 的 `JS_RunGC` 上挂了 perf hook，`quickjs.c` 无条件 `#include "lume_perf.h"`，而该头 `#include "sdkconfig.h"`；宿主没有 ESP-IDF 的 sdkconfig，用桩把 hook 关成 no-op。

原始输出：

```text
$ tools/lume/fetch-qjsc.sh
built /home/ubuntu/lume/tools/lume/bin/qjsc
QuickJS-ng Compiler version 0.18.0
```

### CLI 选项实证（简报假设与实际不符）

简报建议 `./qjsc -c -o test.c test.js` 产 C 数组、`-o test.qbc -e` 产二进制。实际 quickjs-ng 0.18.0 的 `qjsc.c:334-356` **没有 `-c` 选项**，传 `-c` 只会打印 help：

```text
$ /tmp/qjsc -c -o /tmp/qjsc_test_c.c /tmp/qjsc_test.js | head -3
QuickJS-ng Compiler version 0.18.0
usage: qjsc [options] [files]
```

真实选项：`-b` 输出**原始字节码**、`-e` 输出带 main() 的 C、默认输出 C 数组。实测：

```text
$ /tmp/qjsc -b -o /tmp/qjsc_test.qbc -n /tmp/qjsc_test.js /tmp/qjsc_test.js
$ ls -l /tmp/qjsc_test.qbc
-rw-rw-r-- 1 ubuntu ubuntu 101 Nov 15 17:44 /tmp/qjsc_test.qbc
$ od -An -tx1 -N16 /tmp/qjsc_test.qbc
 1d 2f 51 47 d1 03 01 22 2f 74 6d 70 2f 71 6a 73
$ /tmp/qjsc -e -o /tmp/qjsc_test_e.c -n /tmp/qjsc_test.js /tmp/qjsc_test.js
/* File generated automatically by the QuickJS-ng compiler. */
#include "quickjs-libc.h"
const uint32_t qjsc_qjsc_test_size = 101;
```

首字节 `0x1d` = 29 = `quickjs.c:38576` 的 `#define BC_VERSION 29`（由 `JS_WriteObjectAtoms()` 写入，`quickjs.c:39313`），可作为装载前的版本交叉校验锚点。

**必须加 `-C`（classic script）**：`qjsc.c:288` 用 `JS_DetectModule()` 自动判定模块，而 `quickjs.c:64958-64992` 的 `JS_DetectModule()` 以 `is_module = true` 起步，只有当按模块解析抛 `could not load module` 时才返回 false；一段普通 IIFE 源码会被判成 **module**，编译出的对象 tag 是 `JS_TAG_MODULE (-3)`，`JS_EvalFunction()` 走模块作用域，prelude 暴露的全局 `signal`/`View` 全部不可见。宿主实证（同一段 `var x=40+2; lume_test_result=x;`，见 `/tmp/qjsc_load_test.c`）：

```text
# 不带 -C（autodetect）
bytecode len=101 first_byte=0x1d (BC_VERSION=29)
JS_ReadObject tag=-3                              <- JS_TAG_MODULE
global.lume_test_result as string = undefined
probe: (null)

# 带 -C
bytecode len=110 first_byte=0x1d (BC_VERSION=29)
JS_ReadObject tag=-2                              <- JS_TAG_FUNCTION_BYTECODE
global.lume_test_result as string = 42
JS_ToInt32 r=0 n=42
probe: number:42
```

因此 CLI 固定用 `qjsc -b -C -o <out> -n app.js <file>`。

### 装载 API 以 quickjs.c / quickjs.h 为准

- `quickjs.h:1323`：`JSValue JS_ReadObject(JSContext *ctx, const uint8_t *buf, size_t buf_len, int flags)`；`JS_READ_OBJ_BYTECODE (1<<0)`（`:1316`）。
- `quickjs.h:1328`：`JSValue JS_EvalFunction(JSContext *ctx, JSValue fun_obj)`；实现 `quickjs.c:38215-38217`，`JS_EvalFunctionInternal()` 消耗（释放）`fun_obj`。
- `quickjs.c:40579-40593`：`JS_ReadObjectAtoms()` 先读 1 字节版本号，`v8 != BC_VERSION` 时 `JS_ThrowSyntaxError("invalid version (%d expected=%d)")` 并返回 -1 → `JS_ReadObject()` 返回 `JS_EXCEPTION`，**不会崩溃**。`quickjs.c:40598` 还校验 checksum。
- `quickjs.h:1500-1502`：`QJS_VERSION_MAJOR/MINOR/PATCH = 0/18/0`；`JS_GetVersion()`（`quickjs.c:101`）返回 `"0.18.0"`。

## 实现（A2 / A3 / A4）

| 层 | 改动 |
|---|---|
| 帧协议 | 新增第三种 magic `LUMB`（`lume_frame.h` `LUME_FRAME_BYTECODE_MAGIC`）、`LUME_FRAME_EV_BYTECODE`，parser 把 `bool is_cmd` 换成 `uint8_t kind`（source/cmd/bytecode），`lume_frame_encode_bytecode()`。12 字节头/CRC/256 KiB 上限不变；旧固件把 `LUMB` 当 bad-magic 重同步，不会崩。`tools/lume/protocol.js` 同步 `MAGIC_BYTECODE`/`bytecodeFrame()`；`tests/bridge_protocol.c` 增加 `_Static_assert`（头长/magic/kind/event/LQBC 布局），`tests/ota_protocol.c` 增加 LUMB 帧与三帧交错断言。 |
| 载荷 | 新 `firmware/components/lume-engine/include/lume_bytecode.h`：16 字节 `LQBC` 头（magic + QJS major/minor/patch + BC_VERSION + 4 保留 0 字节 + u32le body_len），后面是 `qjsc -b -C` 原始 blob。`bytecodePayload()` / `parseBytecodePayload()` 在 `protocol.js`。 |
| 固件装载 | `lume_hotreload.c` 的 `LUME_FRAME_EV_BYTECODE` 走**与源码同一个** staging 槽；`lume_engine.c:eval_buf()` 按 `LQBC` magic 分流：源码仍 `JS_Eval(...GLOBAL)`，字节码走 `eval_bytecode_buf()` → `JS_ReadObject(..., JS_READ_OBJ_BYTECODE)` + `JS_EvalFunction()`。**版本不匹配优雅拒绝**：先比 QJS 版本、再比头里的 BC_VERSION 与 blob[0]，不符返回负错误码（`LUME_BC_ERR_QJS_VERSION = -2` 等）并 `ESP_LOGE`，绝不调用 `JS_ReadObject`；即使被调用，`JS_ReadObjectAtoms` 也会以 SyntaxError 拒绝。失败原因映射到 `RELOAD ERR bc-version` / `bc-read` / `bc-eval` 等 token。两条路径共存，STORE/LAUNCH 存的字节由引擎自动识别（`lume_apps_store` 写原始字节、`lume_apps_read` 读原始字节），所以 `--bytecode` 对 ephemeral 推送和安装都生效。 |
| CLI | `lume deploy --bytecode`（默认仍源码，**不改现有流程**）：esbuild → `qjsc -b -C` → 加 `LQBC` 头 → `LUMB` 帧推送。qjsc 由 `tools/lume/fetch-qjsc.sh` 从 vendored 源码本地编译（无外部依赖），也可 `LUME_QJSC` 指定或 PATH 查找。二进制 STORE 用 `storeCommandBuffer()`，不做 UTF-8 往返。 |
| 版本校验前置 | 新增 `VER` 命令动词（`lume_cmd.c/h`），设备回 `CMD OK ver <MAJOR.MINOR.PATCH>`；引擎版本由 `lume_engine_version()`（`quickjs.h` 宏）提供。CLI 推包前 `queryEngineVersion()` + `assertEngineVersion()`，本地版本取自 vendored `quickjs.h` / `quickjs.c` 的 `QJS_VERSION_*` / `BC_VERSION`；不匹配**本地拒绝并提示**，一个陈旧的 blob 也到不了 `JS_ReadObject`。源码推送不查 VER，旧固件不受影响。 |
| 测量 | `eval_buf()` 在 `CONFIG_LUME_PERF_PROFILE` 下额外打印 `eval '<name>' <us> (source|bytecode)`，用于 A5 装载耗时对比；profile 关闭时零开销。 |

## A5 验收数据（esp32sim，同一份 -O2 固件，profile 开）

下列 `artifacts/emu/r43b_*/serial.log` 是测量期临时产物，未入库；原始日志节选已逐条贴在下面。

运行命令（构建产物已最新）：

```bash
EMU_SKIP_BUILD=1 EMU_SECONDS=15 EMU_OUTPUT_DIR=.../r43b_counter_src   tools/emu/run.sh examples/counter
EMU_SKIP_BUILD=1 EMU_SECONDS=15 EMU_BYTECODE=1 EMU_OUTPUT_DIR=.../r43b_counter_bc tools/emu/run.sh examples/counter
# 同样跑 examples/games_snake
```

### 字节数

| app | 源码 bundle | 字节码 payload（含 16B 头） | 源码帧 (12+payload) | 字节码帧 (12+payload) |
|---|---:|---:|---:|---:|
| counter | 2,160 B | 4,694 B | 2,172 B | 4,706 B |
| games_snake | 3,718 B | 12,173 B | 3,730 B | 12,185 B |

字节码**更大**，因为 qjsc 默认保留源码与调试信息。实测 strip 选项（未写进 CLI，仅作数据点）：

```text
examples/counter     source 2160 B | default: 4678 B | -s: 2367 B | -s -s: 2171 B
examples/games_snake source 3718 B | default: 12157 B | -s: 5504 B | -s -s: 4591 B
```

结论：字节码带来的是**装载耗时**收益，不是体积收益；若后续要压体积，可评估 `-s/-s -s`（代价是栈轨迹丢失源码/行号），本轮不改默认行为。

原始 prepare 输出：

```text
bundle examples/counter: source 2160 bytes; payload 2160 bytes; frame 2172 bytes (source)
bundle examples/counter: source 2160 bytes; payload 4694 bytes; frame 4706 bytes (bytecode)
bundle examples/games_snake: source 3718 bytes; payload 3718 bytes; frame 3730 bytes (source)
bundle examples/games_snake: source 3718 bytes; payload 12173 bytes; frame 12185 bytes (bytecode)
```

### 装载耗时（app eval，`esp_timer_get_time`，仅看 reload 那一次）

| app | 源码 app eval | 字节码 app eval | 差值 |
|---|---:|---:|---:|
| counter | 15,682 us | 10,402 us | -5,280 us (-33.7 %) |
| games_snake | 35,759 us | 19,501 us | -16,258 us (-45.5 %) |

原始日志（每次运行都有两次 `eval '<lume-app>'`：boot 的 home 与 reload 的 app；boot 两次都相同，对比取 reload 那次）：

```text
# r43b_counter_src/serial.log
I (2760) lume-engine: eval '<lume-prelude>' 67676 us (source)
I (2777) lume-engine: eval '<lume-app>' 15682 us (source)
# r43b_counter_bc/serial.log
I (2762) lume-engine: eval '<lume-prelude>' 67685 us (source)
I (2773) lume-engine: eval '<lume-app>' 10402 us (bytecode)
# r43b_snake_src/serial.log
I (2761) lume-engine: eval '<lume-prelude>' 67691 us (source)
I (2798) lume-engine: eval '<lume-app>' 35759 us (source)
# r43b_snake_bc/serial.log
I (2765) lume-engine: eval '<lume-prelude>' 67685 us (source)
I (2786) lume-engine: eval '<lume-app>' 19501 us (bytecode)
```

两次字节码运行都 `app eval ok; entering event loop`，证明 64 位宿主 qjsc 产出的字节码能被 32 位 Xtensa 固件 `JS_ReadObject` + `JS_EvalFunction` 装载执行：

```text
I (2683) lume-hotreload: bytecode frame (4694 bytes)
I (2684) lume-engine: engine recv RELOAD -> recycle runtime
I (2694) lume-engine: runtime up; eval app '<embedded-demo>' (4694 bytes)
I (2775) lume-engine: app eval ok; entering event loop
```

### 版本查询与拒包（原始输出）

设备 `VER` 命令（esp32sim 注入 `LUMC/VER`）：

```text
CMD OK ver 0.18.0
```

**固件侧拒绝**：把 `LQBC` 头的 major 改成 99、重算 CRC 后经 `STORE` + `LAUNCH` 送入，引擎优雅拒绝、回退到 home，没有崩溃：

```text
E (2768) lume-engine: bytecode: engine version mismatch: bundle 99.18.0, firmware 0.18.0 -- rejecting
I (2769) lume-engine: eval '<lume-app>' 469 us (bytecode)
RELOAD ERR bc-version
W (2769) lume-engine: reload/launch eval failed for 'bcbad'
I (2918) lume-engine: app eval ok; entering event loop
```

直接推 `LUMB` 帧（ephemeral 路径）同样触发 `ESP_LOGE` 并回退，无崩溃：

```text
I (2683) lume-hotreload: bytecode frame (4694 bytes)
E (2763) lume-engine: bytecode: engine version mismatch: bundle 99.18.0, firmware 0.18.0 -- rejecting
I (2763) lume-engine: eval '<lume-app>' 473 us (bytecode)
I (2907) lume-engine: app eval ok; entering event loop
```

**CLI 侧本地拒绝**（`queryEngineVersion` + `assertEngineVersion`，mock device 回 `0.17.0`）：

```text
local qjsc version : 0.18.0 (BC_VERSION 29)
device VER reply   : 0.17.0
lume: engine version mismatch: device 0.17.0, local qjsc 0.18.0. Refusing to push bytecode (JS_ReadObject would reject it). Flash firmware built from the same vendored QuickJS-NG, or use source mode.
```

## 回归与构建（原始数值）

- **21 个 JS harness 全通过**（`node tests/*.js` 逐个跑，21 passed / 0 failed）；**23 个 CLI 测试全通过**（`npm test --prefix tools/lume`：23 pass / 0 fail，其中 17 个为原有回归，6 个为本轮新增；`skipped 0`）。
- C harness：`bridge_protocol.c` 41 checks / 0 failures（含新增 `_Static_assert`）、`apps_protocol.c` 39 checks / 0 failure(s)、`ota_protocol.c` 41 checks / 0 failures（含 LUMB 帧新断言）。
- `idf.py build` 成功（profile 关闭）；`idf.py size`：

```text
Flash Code         1939820
Flash Data          823440
DIRAM               223747    65.47 %   Remain 118013 / 341760
IRAM                 16384   100.0 %   Remain      0 /  16384
Total image size: 2904983 bytes
```

**IRAM 16384/16384，剩余 0，与基线完全一致，没有新增 IRAM 消耗**；新增代码全部落在 flash（Flash Code 1,939,820 B，较 -O2 基线 1,936,968 B 增加 2,852 B）。DIRAM 223,747 B（65.47 %），余 118,013 B——任务 B 未触发分流，所以没有动分配器，也不需要算分流上限。

补充：`python3 scripts/check_website.py` 仍报告 2 项**既有**缺失（`lume.ui.shell.Card` / `lume.ui.shell.IconButton`），与本轮无关（本轮未改 `runtime/types/lume.d.ts` 与 `website/`），未作处理。

## 真机项（如实声明，留接板轮）

- **实际启动时间**、真机上的 **长跑 GC 行为**、字节码与源码在真机上的装载耗时差、以及 `--bytecode` 经 USB/WiFi-OTA 真机推送（VER 查询、STORE/LAUNCH 二进制落盘、ACK 时序）均未接板验证；esp32sim 的 `us` 是模拟环境观测值，不能当真机毫秒数。
- 字节码与 QuickJS-NG 版本/BC_VERSION 强绑定：升级 vendored quickjs-ng 后必须重跑 `fetch-qjsc.sh` 并重新烧固件，否则 `VER` 预检与固件 `bc-version` 检查会拒绝（这是设计行为，不是缺陷）。
- 字节码包含源码/调试信息，故体积大于源码；剥离（`-s`）与压缩留后续评估。
- `LUME_FRAME_EV_BYTECODE` 与 `LUMC` 的 `VER` 是新协议能力：旧固件把 `LUMB` 当 bad-magic 重同步、把 `VER` 当未知动词回 `CMD ERR verb`；CLI 的 `--bytecode` 会因 VER 失败而本地拒绝并提示升级固件，源码模式不受影响。
