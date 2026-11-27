# r221 报告：Canvas `singleBuffer` opt-in（roadmap rendering-backlog #7 固件刀）

## 0. 基线与诚实口径

- **基线**：`origin/main` `b9f3f8a`（2026-11-28，r220 已合入推送），工作树 `/tmp/lume-r221-wt`，分支 `r221-canvas-single-buffer`，开工时工作树干净。
- **固件 size 基线**：`git diff ca1fb77..HEAD -- firmware/` 为 0 字节，r204 提交 `ca1fb77` 是 `origin/main` 上最后一次固件变更，故其构建产物 `artifacts/r204/after-build.log`（`Total image size: 3038183 bytes`，Flash Code `2044076` B，IRAM `16384/16384`）为本轮精确对比基线。
- **本轮范围**：仅实现机制刀（`firmware/components/lume-ui-bridge/lume_ui_bridge.c`、`firmware/components/lume-engine/lume_engine.c`、`firmware/components/lume-engine/prelude/prelude.js`、`runtime/types/lume.d.ts`、`website/playground/prelude.js`、`tests/canvas_mapping.js`、`tests/lib/prelude_runner.js`、`docs/KNOWN-SIMPLIFICATIONS.md`、`docs/r221-report.md`、`artifacts/r221/`）。**不迁移任何 `examples/*`**，不动 vendored（`quickjs-ng/`、`lvgl/`），不动 OTA / 音频 / 网络组件，默认路径（未传或 `singleBuffer: false`）逐字节保持 r48 双缓冲行为。
- **诚实口径**：全部结论由**宿主机 harness（111 份 `tests/*.js` 改前/改后全量回归、新增 `singleBuffer` 断言与默认路径对照）、`bridge_protocol.c` C11 `-Wall -Wextra -Werror` ABI 编译、`npm test --prefix tools/lume`、`lume check examples/counter --no-emu`、playground `prelude.js` 逐字节校验、`scripts/check_website.py` 与 ESP-IDF `idf.py build && idf.py size`** 支撑；**未在真机验收——480×480 AMOLED 板上 `singleBuffer` 实际节省的 PSRAM 峰值与碎片、全帧重绘/脏区下的真实撕裂观感与刷屏时序全部 deferred 至 board bring-up，本报告不构成硬件验收。**

---

## 1. 选型依据：属性通道实证对比

实证查码 `firmware/components/lume-engine/lume_engine.c`（L898–938）、`firmware/components/lume-ui-bridge/lume_ui_bridge.c`（L474–505）与 `firmware/components/lume-ui-bridge/include/lume_ui_bridge.h`（L145–232）后，确认 Canvas create-time 属性**既有先例走 `LUME_OP_CREATE` 消息字段，而非 `LUME_OP_SET_ATTR`**：

| 维度 | 选型 A（采用）：沿用 `LUME_OP_CREATE` 闲置字段 `m.value` bit 0 | 选型 B（否决）：新增 `LUME_ATTR_*` 经 `LUME_OP_SET_ATTR` |
|---|---|---|
| 既有先例 | `Canvas` 的 create-time 尺寸（`width`/`height`）本就通过 `lume.createNode(NODE_CANVAS, parent, w, h)` → `LUME_OP_CREATE`（`m.from`/`m.to`）传入 | 无 Canvas 分配期属性走 `SET_ATTR` 的先例 |
| 时序正确性 | `apply_create()` 在分配 `pixels`/`work` 与做 `CANVAS_BUDGET` 校验**之前**即可读取 `single_buf = (m->value & 1) != 0` | `SET_ATTR` 在 `CREATE` 之后到达：`apply_create()` 已按 2× 预算拒创或已完成双缓冲分配，时序根本倒置 |
| 协议/ABI 影响 | `lume_ui_msg_t.value` 在 `LUME_OP_CREATE` 中原为未使用（`msg_init` 置 0）；**零新增 ATTR/OP ID，零结构体扩容（仍 `<= 128 B`），`lume_ui_bridge.h` 零改动** | 需新增枚举 ID、改 `lume_ui_bridge.h` 及 `_Static_assert`、并级联 21 份 `R166_ALLOWED` 守卫 |
| 默认路径兼容性 | 缺省或 `singleBuffer: false` 时 prelude 仍只传 4 参数 `lume.createNode(NODE_CANVAS, parent, w, h)`，C 侧 `argc < 5` 时 `m.value = 0`，**与原路径逐参数/逐字节一致** | 多发消息或改属性流 |

**完整调用链路**：
1. `prelude.js`（`Canvas(props)`）：校验 `props.singleBuffer`（非 `undefined` 时必须为 `boolean`）；`singleBuf = props.singleBuffer === true` 时以 5 参调用 `lume.createNode(NODE_CANVAS, props.parent || 0, w, h, 1)`，否则沿用原 4 参调用。
2. `lume_engine.c`（`js_create_node`）：当 `kind == LUME_NODE_CANVAS` 且 `argc >= 5 && !JS_IsUndefined(argv[4])` 时，通过 `JS_ToBool` 置 `canvas_flags = 1` 并写入 `m.value = canvas_flags`。
3. `lume_ui_bridge.c`（`apply_create`）：`bool single_buf = (m->value & 1) != 0;`、`size_t copies = single_buf ? 1u : 2u;`；`single_buf` 为真时跳过 `work` PSRAM 分配（不打印 OOM WARN），直接落入既有 `s_canvas_work[id] = work ? work : pixels`（即 **`work == front`**）退化形态。
4. `lume_ui_bridge.c`（`apply_canvas_draw` / `canvas_publish` / `release_dead_canvases`）：读码复核全部已以 `work != front` 守卫——`LUME_DRAW_TEXT` 跳过双次 `lv_canvas_set_buffer` 切换，`canvas_publish()` 跳过整帧 swap 与脏区 `memcpy` 直接 invalidate，`release_dead_canvases()` 由 `split = work != NULL && work != front` 避免二次释放并精确扣除 1× 字节数，无副作用。

---

## 2. 预算语义变化前后对照

共享池上限 `CANVAS_BUDGET` 维持为 **2 个整屏帧缓冲**（480×480 RGB565 下为 `480 × 480 × 2 × 2 = 921,600 B`，与 r48 相同，不扩张 PSRAM 上限）；变化在于**记账倍率从「所有画布一律 2×」改为「按画布缓冲形态记 2× 或 1×」**：

| 层面 | 改造前（r48 基线） | 改造后（r221） |
|---|---|---|
| C `CANVAS_BUDGET` | `LUME_LCD_H_RES * LUME_LCD_V_RES * (BPP/8) * 2` (`921,600 B` @480×480) | 同值 `921,600 B`（注释同步改写为 opt-in 语义与让步条件） |
| C 准入检查（`apply_create`） | `bytes > (CANVAS_BUDGET - s_canvas_bytes) / 2u`（硬按 2×） | `copies = single_buf ? 1u : 2u; s_canvas_bytes >= CANVAS_BUDGET \|\| bytes > (CANVAS_BUDGET - s_canvas_bytes) / copies` |
| C 记账与释放 | 创建 `+= bytes * (work ? 2u : 1u)`，释放 `-= bytes * (split ? 2u : 1u)` | 同公式：`single_buf` 下 `work == NULL` / `split == false`，自然按 1× 记账与退账 |
| JS `prelude.js` 准入与记账 | `__canvasBytes + w*h*2 > SW*SH*2`（隐式把 2× 约去，按 1× 逻辑面对比单帧） | `cost = w * h * 2 * (singleBuf ? 1 : 2)`；`__canvasBytes + cost > SW * SH * 4`；`__canvasAlloc[id] = cost`；`__dispose` 精确退还 `cost` |
| 全双缓冲画布容量 | 最多 `230,400 px`（1 个 480×480，占 `921,600 B`） | **完全等价**：最多 `230,400 px`（`480×480×4 = 921,600 B`，多 1×1 即拒） |
| 全单缓冲画布容量 | 不支持 | 最多 `460,800 px`（例如 2 个 480×480 `singleBuffer: true`，各 `460,800 B`，合计 `921,600 B`） |
| 混合池算例 | — | 例：1 个 480×240 默认双缓冲（`460,800 B`）+ 1 个 480×480 `singleBuffer: true`（`460,800 B`）= `921,600 B` 允许；再增 1×1 拒绝 |

---

## 3. 原子性让步：适用 / 不适用清单

`singleBuffer: true` 放弃了 r48 引入的「LVGL 刷新不会采样到绘制到一半的缓冲」帧原子性保证，以换回一半 PSRAM 预算：

| 分类 | 适用场景（可评估 opt-in `singleBuffer: true`） | 不适用场景（保持默认双缓冲 `singleBuffer: false`） |
|---|---|---|
| 绘制模式 | **全帧重绘（full-frame redraw）**：每个高频 tick（如 ~20 ms）重绘整幅画布的游戏/动画 surface（如贪吃蛇、太空射击、粒子、raycast） | **脏区局部重绘（dirty-rect）或低频更新面**：表盘、圆环仪表、静态底图 + 活动指针（watchface、speedometer、fitness、timer_kit） |
| 撕裂容忍度 | 即使某次刷屏撞上绘制中途，下一 tick（~20 ms 内）会整帧覆写，短暂撕裂可接受 | 刷新间隔较长（如 1 s 表盘或事件驱动），一旦采样到半帧（残弧、丢针）会在屏上停留明显时长 |
| 典型代价 | 省去 1 份 `w × h × 2` B PSRAM（480×480 理论省 `460,800 B`，实机待测），且 `canvas_publish` 跳过 buffer swap | 维持 2× PSRAM（`front + work`）以保证每帧原子切换 / 脏区原子 `memcpy` |

**契约面同步**：
- `runtime/types/lume.d.ts`：`CanvasProps` 新增 `singleBuffer?: boolean` 及适用/不适用注释，并同步 `width` 注释为共享 `921,600 B`（2 帧）池口径。
- `docs/KNOWN-SIMPLIFICATIONS.md`：在既有的 r16/r48 `Frame atomicity` 段落（L670）下补入 r221 `singleBuffer` opt-in 小节，并在文末登记 `## r221` 条目。

---

## 4. 验收硬指标与原始输出指针（`artifacts/r221/`）

| # | 验收项 | Artifact 指针 | 原始实测结果 |
|---|---|---|---|
| 1 | 改前基线全量回归 | `artifacts/r221/regression-before.log` | `REGRESSION DONE pass=111 fail=0` |
| 2 | 改后全量回归（提交后） | `artifacts/r221/regression-after.log` | `REGRESSION DONE pass=111 fail=0` |
| 3 | `idf.py build` + `idf.py size` | `artifacts/r221/firmware-build-size.log` | `BUILD_SIZE_EXIT=0`；涉改 C 文件 0 warning；见下表逐项对比 |
| 4 | 新增宿主断言 + 默认路径对照 | `artifacts/r221/targeted-tests.log` | `tests/canvas_mapping.js` 全部 PASS（含 4 条新增 `r221 singleBuffer` 断言 + 全部既有双缓冲用例）；`tests/watchface.js`（`228544/230400 px`）、`tests/control_center.js`、`tests/controls_demo.js`、`tests/ota_consumers.js`、`tests/wordle.js` 原样 PASS |
| 5 | `bridge_protocol.c` C11 编译 | `artifacts/r221/bridge-protocol.log` | `gcc -std=c11 -Wall -Wextra -Werror ... tests/bridge_protocol.c` 退出 0，`BRIDGE_PROTOCOL_OK` |
| 6 | Playground prelude 镜像 + 网站检查 | `artifacts/r221/playground-build.log`、`prelude-mirror-check.log`、`check-website.log` | `PASS prelude 68299 bytes; 74 apps`；`PASS prelude mirror byte-identical: 68299 bytes`；`api.html is up to date with lume.d.ts (162 entries)`；`examples.html gallery up to date (74 cards)`；4 项 API 告警全 `none`；`lume_scripts.c` 无变更 |
| 7 | `lume check` 哨兵 + CLI 单测 | `artifacts/r221/lume-check-counter.log`、`npm-test-lume.log` | `lume check examples/counter --no-emu` → `RESULT: PASS (4 steps, 0 failed; exit 0)`；`npm test --prefix tools/lume` → `76 pass / 0 fail` |
| 8 | ASCII 纪律 | `artifacts/r221/ascii-added.log` | 本轮新增代码/类型/测试行 `ADDED_NON_ASCII=0` |

### 4.1 宿主测试覆盖边界（诚实标注）

- **已由宿主机实测验证**：真实嵌入源码 `firmware/components/lume-engine/prelude/prelude.js` 在 Node `vm` 中的 `singleBuffer` 参数校验（拒绝非布尔值）、默认 4 参 vs opt-in 5 参 `createNode` 消息流、JS 侧 2×/1×/混合池预算检查与 `__dispose` 退账、`prelude_runner` `runApp` 注入屏幕尺寸（390×390）与脏区 invalidate、以及 `lume_engine.c`/`lume_ui_bridge.c` 关键接线锚点与 ESP-IDF 交叉编译通过。
- **未由宿主机覆盖（留待 board bring-up）**：真实 LVGL 9.3 + ESP-IDF PSRAM 堆上的 `work == front` 运行时分配、多画布并发绘制时 480×480 实际省出的 PSRAM 峰值与碎片表现、以及 CO5300 屏上全帧/脏区撕裂观感。

### 4.2 固件 `idf.py size` 基线对比（原始表见 `artifacts/r221/firmware-build-size.log` vs `artifacts/r204/after-build.log`）

| Memory Type / Section | 基线 (`origin/main` / r204 `ca1fb77`) | r221 (`551e9f1`) | 增量 (Delta) |
|---|---:|---:|---:|
| **Flash Code (`.text`)** | `2,044,076` B | `2,044,124` B | **+48 B** |
| **Flash Data (`.rodata` + `.appdesc`)** | `852,852` B (`852,596` + `256`) | `853,156` B (`852,900` + `256`) | **+304 B**（含 `prelude.js` 源码 +317 B） |
| **DIRAM** | `247,159` B (`72.32%`, Remain `94,601`) | `247,159` B (`72.32%`, Remain `94,601`) | **+0 B** |
| **IRAM** | `16,384` / `16,384` B (`100.0%`, Remain `0`) | `16,384` / `16,384` B (`100.0%`, Remain `0`) | **+0 B**（零 `IRAM_ATTR`） |
| **RTC FAST / SLOW** | `72` / `32` B | `72` / `32` B | **+0 B** |
| **Total image size** | `3,038,183` B (`lume.bin` `0x2e5c60`) | `3,038,535` B (`lume.bin` `0x2e5dc0`) | **+352 B** |

注：`tools/playground/build.mjs` 自 r194 起已直接从 `firmware/components/lume-engine/prelude/prelude.js` 读取 prelude 基线（不再解析 `lume_scripts.c`），故本次直接运行 `node tools/playground/build.mjs` 即完成镜像重建，`lume_scripts.c` 保持原样无变更；并按 r216/r220 先例还原未涉改的 `website/playground/apps/` 编译产物。

---

## 5. 提交拆分与范围纪律

- **commits（本地分支 `r221-canvas-single-buffer`，未 push）**：
  1. `feat(canvas): add opt-in singleBuffer create flag and 1x PSRAM budget`
  2. `chore(playground): rebuild website/playground/prelude.js mirror for r221`
  3. `test(canvas): cover singleBuffer opt-in, 1x budget, and re-pin prelude golden`
  4. `docs(canvas): document r221 singleBuffer opt-in and budget trade-off`
  5. `chore(artifacts): record r221 regressions, ABI check, and firmware build/size`
  6. `docs(r221): add Canvas singleBuffer opt-in report`
- **零越界**：未修改任何 `examples/*`、vendored（`quickjs-ng/`、`lvgl/`）、`lume_ui_bridge.h` 或 `lume_scripts.c`；未 push；git 身份使用 repo 级 `congduan`。

---

## 6. Codex review 与必修（主控收口）

- **Codex review**（`codex exec --sandbox danger-full-access`，只读）：**P-with-fixes**。核心正确性全部确认：无 double-free / 漏 publish 路径（release 对共享缓冲只释放一次，publish 两种模式都触发 invalidate），prelude 1×/2× 记账与 C 桥 RGB565 预算一致，零越界（无 vendored/examples/lume_scripts.c 改动）。
- **唯一必修点**：宿主侧对混合 1×/2× 池的可执行覆盖不足（原有 refund 断言只测单 1× 池；`work==front` 的 C 运行时执行物理上只能真机验证，维持 deferred 口径）。
- **必修落地**（主控接管）：`tests/canvas_mapping.js` 新增 2 条混合池可执行断言——(1) 移除 2× 成员后退款精确 460,800 B（满池后 1×1 也拒绝）且重复 removed 同 id 不再退账；(2) 移除 1× 成员后仅余 2× 占用（全尺寸 2× canvas 拒绝、全尺寸 1× 恰好放下），双向排除 2× 级误退账。
- **复测**：`tests/canvas_mapping.js` 全 PASS（含 2 条新增）；全量回归 `artifacts/r221/review-fix-regression.log`：**total=111 fail=0**。
