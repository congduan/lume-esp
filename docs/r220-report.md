# r220 报告：r200 §5 遗留 1 剩余两项收口（`shell.Slider` 圆 thumb 默认化 + `prelude` `Text` `theme.radius` 实证销账）

## 0. 基线与诚实口径

- **基线**：`origin/main` `84eb7ad`（2026-11-28，r219 StatusBar round 收紧 + piano 单八度已合入推送），工作树 `/tmp/lume-r220-wt`，分支 `r220-r200-legacy-closure`，开工时工作树干净。
- **本轮目标**：收口 `docs/r200-ui-quality-report.md` §5 遗留 1 剩余两项：
  1. **任务一（主刀）**：`shell.Slider` 圆形 thumb 升级默认行为（采用**方案 A**，`roundThumb` 默认值由 `false` 改为 `true`，保留显式 `roundThumb: false` 字节等价退出路径），清理唯一消费 app `examples/controls_demo/app.js` 的冗余 opt-in 传参，并迁移唯一受影响测试 `tests/shell_slider.js`。
  2. **任务二（副刀，先实证）**：在宿主 `tests/lib/prelude_runner.js`（Node `vm` 直读 `firmware/components/lume-engine/prelude/prelude.js`）复现 `theme.set({radius: N})` 下 `Text` 节点（含 `scroll: 'none'`）是否继承 `theme.radius`。**实证结果：无法复现 / 已不成立**——该缺陷已在 r204 提交 `ca1fb77`（`feat(prelude): skip implicit theme.radius on Text/Canvas/Image`）根治，并由 `tests/theme_mapping.js` L31–38 持续守卫，且 `website/playground/prelude.js` 与固件源码逐字节一致（`67982 B`）。因此任务二产出为零，**未改动 `firmware/` 与 `prelude.js`**。
- **未执行固件构建原因**：本轮零改动 `firmware/`、`prelude/*.js` 与 vendored 组件，故按简报规则未跑 `idf.py build` / `idf.py size`。
- **诚实口径**：全部结论仅由**宿主机 harness（111 份 `tests/*.js` 改前/改后全量回归）、`prelude_runner` 几何与绘制 dump、esbuild bundle (`lume check --no-emu`)、Playwright 74-app playground 验证与 `scripts/check_website.py`** 支撑；**480×480 AMOLED 真机上的圆 thumb 视觉观感、拖动手感、抗锯齿效果与物理触控精度全部 deferred 到 board bring-up，本报告不构成硬件验收。**

---

## 1. 任务一：`shell.Slider` 圆 thumb 默认化（采用方案 A）

### 1.1 全仓消费方实证清单

改前 grep 全仓 `Slider` / `roundThumb` / `knobDiameter`（`examples/`、`tests/`、`runtime/`、`firmware/`、`tools/`）：

| 位置 | 使用方式 | 备注 |
|---|---|---|
| `runtime/shell.js` L439–524 | 组件定义 `Slider(p)` | 改前 L459：`var roundThumb = p.roundThumb === undefined ? false : p.roundThumb;`，`knobDiameter` 默认 `36`（范围 `32..min(height,64)`） |
| `runtime/types/lume.d.ts` L343–367 | `SliderProps` / `Slider()` 类型契约 | 改前 L352–359 标注 `Default false` / `Ignored unless roundThumb is true` |
| `examples/controls_demo/app.js` L49–52 | **全仓唯一 `lume.ui.shell.Slider` 消费 app** | 改前已于 r203 显式传入 `roundThumb: true`（`width: 320, height: 48`），落于 `SafeArea` 内 |
| `examples/{timer_kit,settings,music_player,control_center}/app.js` | 自绘 `Canvas` 滑块 | 均未调用 `shell.Slider`（零改动） |
| `tests/shell_slider.js` | **全仓唯一断言 Slider 绘制字节流的测试** | 改前锁 pre-r203 方块 thumb 为默认 `GOLDEN`，显式 `roundThumb:true` 测圆 thumb |
| `tests/controls_demo.js` | `controls_demo` 静态/交互/mutation 守卫 | 仅断言 40px 高度下限、受控模式、拖拽量化、信号重绘与 dispose，不锁方块 thumb 字节流（零改动原样 PASS） |
| `tests/shell_components.js` | `Card`/`StatusBar`/`EdgeNavigation`/`Launcher`/`Dialog`/`Toast` | 无 `Slider` 断言（零改动原样 PASS） |

### 1.2 方案 A 取舍与实施明细

- **选型理由**：全仓受默认绘制流影响的测试**仅 `tests/shell_slider.js` 1 个文件**（远低于退回方案 B 的「≥3 个测试文件语义弱化」熔断线），且不弱化任何断言语义，确认采用**方案 A**。
- **组件改动**：
  - `runtime/shell.js` L456–460：`roundThumb` 默认值由 `false` 改为 `true`；显式传入 `roundThumb: false` 仍走原 4 行 `fillRect` 分支，保持 pre-r203 字节流不变。
  - `runtime/types/lume.d.ts` L352–360：同步 JSDoc 契约说明默认 `true`、`roundThumb: false` 退回旧方块路径（函数签名未变，`gen_api_docs.py --check` 通过，无需改 `api.html`）。
  - `examples/controls_demo/app.js` L43–52：移除冗余 `roundThumb: true` 并更新注释，使唯一消费 app 直接验证新默认路径。
- **触区几何与红线核验**：
  - 默认 `knobDiameter = 36`（`r = floor(36/2) = 18`，直径 `36px ≥ 32px` 圆形 thumb 红线），且在组件最小高度 `height = 40` 下 `mid = 20`、`y ∈ [2..38]` 严格落于画布内，零裁切。
  - 整个 `Canvas` 仍为手势热区：`controls_demo` 的 `brightSlider`（node 10）尺寸 `320×48`（`abs=[80..400, 224..272]`, `Rmax=163.2`, `IN_SAFE=true`），满足 `≥48×48` 触区红线（无需数学豁免）。

### 1.3 `tests/shell_slider.js` 断言迁移说明（零弱化，反增覆盖）

对 r203 既有的「默认路径字节流不变」断言的取舍：
- **未删除，转为双路径双黄金流 + 双变异证明**：
  1. 原默认 `GOLDEN`（pre-r203 方块 `fillRect`）保留为 `LEGACY_GOLDEN`，断言显式 `roundThumb: false` 仍与 pre-r203 绘制流**逐字节等价**，并保留 `kx + 1` 变异证明；
  2. 新增 `ROUND_GOLDEN`（4 条 draw：clear + track + accent fill 至圆心 `160` + `fillCircle` opcode 6 `(160, 24) r=18` `#F2F7FB`），断言默认 `launch()` 与显式 `launch(',roundThumb:true')` 均精确匹配 `ROUND_GOLDEN`，并新增 `tx + 1` 默认路径变异证明；
  3. 新增最小高度 `height: 40` 下默认圆 thumb（`mid=20, r=18`）不越界断言；
  4. `knobDiameter`、`params validate` 与拖拽步进量化断言全部升级覆盖默认路径（同时比对 default / `roundThumb:true` / `roundThumb:false` 三路径量化结果均为 `[60]`）。

### 1.4 改后绘制与消费方几何实测 dump（原始输出见 `artifacts/r220/slider-dump.txt`、`controls_demo-nodes-dump.txt`、`controls_demo-geometry.txt`）

| 场景 | 实测 thumb 形态 | 实测坐标 / 绘制流摘要 | 判据 |
|---|---|---|---|
| `Slider(default, h=48, val=50)` | `fillCircle(cx=160, cy=24, r=18, d=36)` | `draw` op `0, 1, 1(w=160), 6(160,24,18)` | 默认圆形 `d=36≥32` |
| `Slider(roundThumb:true, h=48, val=50)` | `fillCircle(cx=160, cy=24, r=18, d=36)` | 与 default 逐字节一致 | 等价 |
| `Slider(roundThumb:false, h=48, val=50)` | `fillRect(x=148, y=12, w=24, h=24)` | `draw` op `0, 1, 1(w=172), 1(148,12,24,24)` | pre-r203 字节等价退出路径 |
| `Slider(default, h=48, knobDiameter=40)` | `fillCircle(cx=160, cy=24, r=20, d=40)` | `draw` op `6(160,24,20)` | 默认路径支持 `knobDiameter` |
| `Slider(default min h=40, val=50)` | `fillCircle(cx=160, cy=20, r=18, d=36)` | `y∈[2..38]` 落于 40px 轨道内 | 最小高度不裁切 |
| `controls_demo` `brightSlider` (node 10) | `fillCircle(cx=160, cy=24, r=18, d=36)` | `320×48 abs=[80..400,224..272] Rmax=163.2 IN_SAFE=true` | `audit.js` 整 app **`CLEAN`** (`MAX_R=227.7, OUT240=0, OUTSAF=0, T<48=0, R>12=0, NASC=0`) |

---

## 2. 任务二实证：`prelude.js` `Text` 节点 `theme.radius` 继承（无法复现 / 已不成立）

### 2.1 源码与历史核查

- `firmware/components/lume-engine/prelude/prelude.js` 在 **r204 提交 `ca1fb77`**（`feat(prelude): skip implicit theme.radius on Text/Canvas/Image`）已修复该缺陷：
  - L697：`__applyAttrs(id, p, nodeType)` 接收节点类型；
  - L819–830：`if (s.borderRadius !== undefined) metric(s.borderRadius, ATTR_RADIUS); else if (nodeType !== NODE_TEXT && nodeType !== NODE_CANVAS && nodeType !== NODE_IMAGE) { ... }`；
  - `Text`（L876）、`Image`（L957）、`Canvas`（L1068）均传入对应 `nodeType`，跳过隐式 `theme.radius` 订阅，仅显式 `style.borderRadius` 才发送 `ATTR_RADIUS (12)`。
- 镜像核验：`website/playground/prelude.js` 解码后与 `firmware/components/lume-engine/prelude/prelude.js` **逐字节等价（`67982 === 67982`）**。
- 既有测试守卫：`tests/theme_mapping.js` L31–38 已覆盖 `Text without borderRadius does not inherit theme.radius` 与 `explicit borderRadius still applies on Text`（实跑 PASS）。

### 2.2 最小复现输出（原始日志见 `artifacts/r220/task2-text-radius-repro.txt`）

通过 `tests/lib/prelude_runner.js` 执行 `lume.theme.set({ radius: 12 })` → 创建 `View(scroll:'none')`、`Text(scroll:'none')`、`Text()`、`Text(scroll:'none', borderRadius:5)`、`Canvas(scroll:'none')` → 动态切换 `lume.theme.set({ radius: 20 })`，dump `ATTR_RADIUS (12)` 与 `ATTR_SCROLL_DIR (20)`：

```text
IDs: {"v1":1,"t1":2,"t2":3,"t3":4,"c1":5}
v1 (node 1): radius_attrs=[["attr",1,12,12],["attr",1,12,20]] scroll_attrs=[["attr",1,20,0]]
t1 (node 2): radius_attrs=[] scroll_attrs=[["attr",2,20,0]]
t2 (node 3): radius_attrs=[] scroll_attrs=[]
t3 (node 4): radius_attrs=[["attr",4,12,5]] scroll_attrs=[["attr",4,20,0]]
c1 (node 5): radius_attrs=[] scroll_attrs=[["attr",5,20,0]]
```

**结论**：`Text`（含 `scroll: 'none'`）与 `Canvas` 在 `theme.set({radius: 12})` 及动态变更 `{radius: 20}` 下均**不发出任何 `ATTR_RADIUS`**；仅容器 `View` 继承 `12 -> 20`，仅显式 `borderRadius: 5` 的 `Text` 发出 `[12, 5]`。此外 `controls_demo` 节点 dump（`artifacts/r220/controls_demo-nodes-dump.txt`）中未写 `borderRadius: 0` 的 5 个 `Text` 节点（node 3/4/8/14/15）同样无 `ATTR_RADIUS`。**按简报纪律如实登记「无法复现 / 已于 r204 `ca1fb77` 收口」，本轮任务二零代码改动，未触发 `idf.py build`。**

---

## 3. `docs/r200-ui-quality-report.md` §5 遗留 1 全部 4 项总销账

| r200 §5 遗留 1 子项 | 收口轮次与依据 | 状态 |
|---|---|---|
| 1. `shell.Keyboard` 40px 键高/键宽与控制键紧凑 | r203 (`4dc73fd`) 新增 `controlKeyRatio`/`keyHeight` → **r217**（`docs/r217-report.md`）键高下限提至 48px + 44px 梯形收口 + 4px 键宽数学豁免 | **已收口（r217）** |
| 2. `shell.Launcher` 圆屏安全区与 `StatusBar` round inset / 圆形徽章 | r204 (`0f62b38`) 新增 `Launcher({shape:'round'})` 与圆形徽章 → **r219**（`docs/r219-report.md`）`StatusBar(round)` 收紧 8px 落入 `[78..401]` 对齐 `Launcher` | **已收口（r204 + r219）** |
| 3. `shell.Slider` 默认方块 thumb → 升级圆形 ≥32px thumb | r203 (`4dc73fd`) opt-in `roundThumb` → **r220（本轮）** 默认改 `true`（`d=36px ≥ 32px`），保留 `roundThumb:false` 退出路径，`controls_demo` 直接走默认路径 | **已收口（r220）** |
| 4. `prelude.js` `Text` 节点默认不应继承 `theme.radius` | r204 (`ca1fb77`) 跳过 Text/Canvas/Image 隐式 `theme.radius` → **r220（本轮）** `prelude_runner` 实证无法复现，确认已不成立 | **已收口（r204，r220 实证确认）** |

至此，`docs/r200-ui-quality-report.md` §5 遗留 1 全部 4 项均已完成宿主机层面收口；r200 §5 遗留 3（全部 app 的真机 AMOLED 观感、触控命中率、背光与音频）仍按原则 **deferred 至 board bring-up**。

---

## 4. 验收硬指标汇总（原始输出见 `artifacts/r220/`）

| # | 验收项 | Artifact 文件 | 实测结果 |
|---|---|---|---|
| 1 | 改前基线全量回归 | `full-regression-before.txt` | 111 份 `tests/*.js`：**0 FAIL**，末尾 `REGRESSION DONE`（1980 行） |
| 2 | 改后全量回归 | `full-regression-after.txt` | 111 份 `tests/*.js`：**0 FAIL**，末尾 `REGRESSION DONE`（1981 行） |
| 3 | Slider 改后绘制与消费方几何 dump | `slider-dump.txt`、`controls_demo-nodes-dump.txt`、`controls_demo-geometry.txt` | default / `roundThumb:true` / `controls_demo` 均 `fillCircle(cx=160,cy=24,r=18,d=36)`；`roundThumb:false` 保留 `fillRect(148,12,24,24)`；`controls_demo` 经 `audit.js` 判定 **`CLEAN`**（`MAX_R=227.7, OUT240=0, OUTSAF=0, T<48=0, R>12=0, NASC=0`） |
| 4 | 涉改 app `lume check --no-emu` | `check-controls_demo.txt` | `controls_demo`（`31037 bytes`）：**`RESULT: PASS (4 steps, 0 failed; exit 0)`** |
| 5 | Playwright 74-app Playground | `playground-verify.txt`（重建日志见 `playground-build.txt`） | `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs`：**74/74 apps PASS**（`controls_demo: 15 nodes`，`PASS all examples load without runtime errors`） |
| 6 | 网站一致性检查 | `check-website.txt` | `examples.html gallery up to date (74 cards)`；`API missing / invented / duplicates / signatures not found: none`；`api.html is up to date with lume.d.ts (162 entries)` |
| 7 | ASCII 门禁 | `ascii.txt` | 全部 4 份涉改 JS 文件（`runtime/shell.js`、`examples/controls_demo/app.js`、`tests/shell_slider.js`、`website/playground/sources/controls_demo.js`）`grep -cPn '[^\x00-\x7F]'` 全部 = **0**（`runtime/types/lume.d.ts` 新增行亦全 ASCII） |
| 8 | Manifest + OTA 守卫（回退 `apps/` 后） | `playground-manifest.txt`、`ota-consumers.txt` | `tests/playground_manifest.js`（74 apps）与 `tests/ota_consumers.js` 全部 **PASS** |
| 9 | 任务二复现证据 + 定向回归 | `task2-text-radius-repro.txt`、`targeted-tests.txt` | `Text` (`scroll:'none'` 与无 `scroll`) `radius_attrs=[]`；`shell_slider.js`（7 cases）、`controls_demo.js`、`theme_mapping.js` 全 **PASS** |
| 10 | 固件构建（`idf.py build/size`） | — | **未执行**：任务二实证已于 r204 `ca1fb77` 修复，本轮零改动 `firmware/` 与 `prelude/` |

---

## 5. 范围纪律与提交拆分

- **改动面**：`runtime/shell.js`、`runtime/types/lume.d.ts`、`examples/controls_demo/app.js`、`tests/shell_slider.js`、`website/playground/sources.js`、`website/playground/sources/controls_demo.js`、`artifacts/r220/`、`docs/r220-report.md`。按 r216 `d4cd368` 先例回退了 `website/playground/apps/` 编译包。
- **零越界**：`firmware/`、prelude、vendored、`tools/lume/` 全部 **0 改动**；未 push；git 身份 `congduan`。
- **提交拆分**：
  1. `feat(shell): default Slider roundThumb to true and drop redundant opt-in in controls_demo`
  2. `test(slider): migrate shell_slider golden to round default and keep roundThumb:false parity`
  3. `chore(playground): re-sync controls_demo source mirror and sources.js for r220`
  4. `chore(artifacts): record r220 regressions, Slider dumps, task2 repro and verification evidence`
  5. `docs(r220): close r200 legacy-1 remaining items (Slider roundThumb default & prelude Text radius verification)`
