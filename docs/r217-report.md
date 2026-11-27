# r217 报告：`shell.Keyboard` 触区达标组件刀（键高 48px 下限 / 梯形圆屏收口）

## 0. 基线与口径

- 基线：`origin/main` `e94b9b9`（2026-11-28，r216 safe-area batch8 已合入），工作树 `/tmp/lume-r217-wt`，分支 `r217-keyboard-touch-target`，开工时工作树干净。
- 本轮定位：收口 `docs/r200-ui-quality-report.md` 红线 3 登记的 `shell.Keyboard` 40px 键高/键宽遗留项，并迁移全部两个消费 app（`examples/wordle/app.js`、`examples/keyboard_demo/app.js`）。
- 全部结论仅由 **宿主 harness、`prelude_runner` 坐标 dump、Playwright playground 74 app 加载检查与 esbuild bundle** 支撑；**未动 `firmware/` 与 prelude，未跑 `idf.py build`，无真机验收**。480×480 AMOLED 圆屏上的实机视觉与手指触控手感留待 board bring-up；本报告不构成硬件验收。
- 简报核对记录：
  - `runtime/shell.js` `Keyboard` 实测位于 L299–392，`keySize` / `keyHeight` 原下限确为 `40..128`（L321–332）。
  - `examples/keyboard_demo/app.js` 原调用未传任何几何参数（`width` 默认 480、`gap` 受 `theme.spacing=12` 钳至 8、`keySize=40`、`y=264`），改前即有 6 键出 `R≤240` 圆域（`worstR=254.1`）。

## 1. 改前实证

使用可重放脚本 `artifacts/r217/geometry_dump.js` 通过 `tests/lib/prelude_runner.js` + `runtime/shell.js` 运行两个消费 app，解析 flex 行/列容器与按键屏幕绝对坐标，逐键计算圆心 `(240, 240)` 最大角距 `Rmax`、`clr240 = 240 - Rmax`、`clr233 = 233 - Rmax`（466px 可视圆弧）及触区达标数（原始输出见 `artifacts/r217/geometry-before.txt`；改前全量回归 0 FAIL 见 `artifacts/r217/full-regression-before.txt`）：

- **`wordle`（改前）**：`width=400, keySize=40, gap=0, x=40, y=240, controlKeyRatio=1.8`，root `[40..440, 240..408]`（400×168）。
  - 全部 29 键高度仅 `40px`（`touchH48=0/29`, `touch48x48=0/29`）；字母键 `40×40`，`SPACE` `160×40`，`BKSP`/`ENTER` `72×40`。
  - 29/29 键在 `R≤240` 与 `R≤233` 内（`worstR=223.6`，底行 `SPACE`/`ENTER`）。
- **`keyboard_demo`（改前）**：无几何参数，默认 `width=480, keySize=40, gap=8, x=0, y=264, controlKeyRatio=1`，root `[0..480, 264..456]`（480×192）。
  - 全部 29 键高度仅 `40px`（`touchH48=0/29`, `touch48x48=0/29`）；`BKSP`/`ENTER` 仅 `40×40`。
  - **仅 23/29 键在 `R≤240` 内**：6 键出圆——`Q`/`P`（`Rmax=245.6`）、`A`/`L`（`Rmax=241.7`）、`SPACE`/`ENTER`（`Rmax=254.1`）。

## 2. 方案取舍与几何证明（按简报顺序评估 a / b / c）

### 2.1 10 列 QWERTY 键宽达 48px 的圆屏几何不可能证明

在 `480×480` 圆屏（圆心 `(240, 240)`，外切圆半径 `R = 240`，466px 可视圆弧半径 `R_bezel = 233`）上，标准 10 列顶行（`qwertyuiop`）若要求单键宽 `W ≥ 48`、高 `H ≥ 48`、`gap = g ≥ 0`：

1. 顶行总宽 `L_0 = 10W + 9g ≥ 480 px`，最外侧键 `Q` / `P` 水平距圆心 `|x - 240| ≥ 240 px`。
2. 任意 `H ≥ 48` 的行占据 `[y_0, y_0 + H]`，其上下边距圆心垂直距离至少满足 `max(|y_0 - 240|, |y_0 + H - 240|) ≥ H / 2 ≥ 24 px`。
3. 因此 `Q` / `P` 外角距圆心必满足：
   $$R_{\max}(Q, P) \ge \sqrt{240^2 + 24^2} = \sqrt{58176} \approx 241.2\text{ px} > 240.0\text{ px}$$
   且超出 466px 可视圆弧（`R = 233`）达 `8.2 px`；在消费 app 实际 `y ≥ 220..240` 处（顶行底边 `y_1 ≥ 272..292`），`R=240` 弦宽仅 `475.7..468.6 px`（`R=233` 弦宽仅 `461.6..454.2 px`），10 列键宽上限分别被锁死在 `47.5..46.8 px`（`R=240`）与 `46.1..45.4 px`（`R=233`）。

### 2.2 三候选方案评估与决策

| 候选 | 评估结论 | 实证与理由 |
|---|---|---|
| **a) 放宽 `width` + 梯形收口 + `keyHeight` 下限 40→48（含 4px 字母键宽诚实豁免）** | **采用** | 1. 将 `runtime/shell.js` 的 `keyHeight` 下限与默认值从 `40` 提升至 **`48`**（`Math.max(48, keySize)`，`48..128`），全部 29 键垂直触区 100% 达到 **48px**；<br>2. 将 `spaceWidth` 由 `4*keySize + 3*gap` 收口为 **`3*keySize + 2*gap`**，使 4 行呈单调梯形收缩（`wordle`: `440 → 396 → 308 → 264`；`keyboard_demo`: `458 → 412 → 320 → 272`），抵消键高增高 32px 带来的底行下移，保证两 app 全部 29/29 键严格落于 **`R≤240`**；<br>3. 字母键宽由 `40px` 放宽至 **`44px`**（+10%，全整数像素对齐，无 45px 的 `.5` 亚像素偏移），`keyboard_demo` 叠加 `gap=2` 形成 `46×50px` 中心步距与物理分隔；控制键 `SPACE`（`132..136×48`）与 `BKSP`/`ENTER`（`66×48`）全部 `≥48×48`；<br>4. 保留 `keySize` 下限 `40` 以兼容 10 列圆屏窄距场景，并诚实登记字母键宽 `44px` 较 `48px` 的 4px 几何豁免（见 §2.1 证明）。 |
| **b) 行列重构（拆 `qwertyuiop` 10 列）** | **否决** | 1. 拆为 4 字母行 + 1 控制行（5 行，如 7-7-6-6 + ctrl）需总高 `5×48 = 240px`（圆内最优 `y=154..394`），直接压穿 `wordle` 5×6 网格（`y=110..238`）与 `keyboard_demo` 输入区（`y=80..220`）；<br>2. 拆为 9-9-8 + ctrl（4 行）破坏 QWERTY 键位直觉（`P` 落入第 2 行、`K/L` 落入第 3 行），且最优 `y=192..384` 仍与上方内容冲突；<br>3. 两段翻页键盘破坏 26 字母同时可见性（`wordle` `keyStates` 字母状态总览失效）并直接打挂 `tests/keyboard_demo.js`、`tests/keyboard_states.js`、`tests/wordle.js` 锁定的 4 行 / 29 键 / 33 节点契约。 |
| **c) 纯豁免 + 高度 48 + 间距补偿** | **已吸收进方案 a** | 方案 a 已在保持 4 行 / 29 键 / 33 节点全部既有测试语义零破坏的前提下，同时落实了「键高强制 `≥48` + 键宽 40→44 放宽 + `keyboard_demo` `gap=2` 触感补偿 + 4px 键宽几何证明豁免」，优于仅保留 40px 键宽的纯退让方案。 |

## 3. 改动前/后坐标对照表（实测 dump）

完整前后 29 键逐键坐标见 `artifacts/r217/geometry-before.txt` 与 `artifacts/r217/geometry-after.txt`（由同一脚本 `artifacts/r217/geometry_dump.js` 产出）。

### 3.1 `examples/wordle/app.js`

Canvas（`320×128`, `[80..400, 110..238]`）、HUD（`[84..332, 75..112]`）与 `NEW` 键（`60×48`, `[336..396, 75..123]`）完全不变；Keyboard 迁移为 `width: 448, keySize: 44, gap: 0, x: 16, y: 240, controlKeyRatio: 1.5`（默认 `keyHeight: 48`）：

| 行 / 项 | 改前（实测） | 改后（实测） | 改后判据 |
|---|---|---|---|
| Keyboard root | `[40..440, 240..408]`（400×168, `pad=4, gap=0`） | `[16..464, 240..440]`（448×200, `pad=4, gap=0`，内宽精确 440） | 清出 Canvas (`238 < 240`) |
| `row 0`（Q..P, 10 键） | `40×40`, `[40..440, 244..284]`, `Rmax=204.8` | `44×48`, `[20..460, 244..292]`, `Rmax=226.1`（`clr240=13.9, clr233=6.9`） | `IN_R240 IN_R233` |
| `row 1`（A..L, 9 键） | `40×40`, `[60..420, 284..324]`, `Rmax=198.6` | `44×48`, `[42..438, 292..340]`, `Rmax=221.8`（`clr240=18.2, clr233=11.2`） | `IN_R240 IN_R233` |
| `row 2`（Z..M, 7 键） | `40×40`, `[100..380, 324..364]`, `Rmax=187.0` | `44×48`, `[86..394, 340..388]`, `Rmax=213.6`（`clr240=26.4, clr233=19.4`） | `IN_R240 IN_R233` |
| `row 3`（SPACE / BKSP / ENTER） | `160/72/72 × 40`, `[88..392, 364..404]`, `Rmax=223.6` | `132/66/66 × 48`, `[108..372, 388..436]`, `Rmax=236.3`（`clr240=3.7`） | `IN_R240`, **3/3 `≥48×48`** |
| **汇总** | `touchH48=0/29`, `touch48x48=0/29`, `inR240=29/29`, `worstR=223.6` | **`touchH48=29/29`**, **`touch48x48=3/29`**, **`inR240=29/29`**, `worstR=236.3` | 键高全达标，全键在圆内 |

### 3.2 `examples/keyboard_demo/app.js`

输入面板（`[84..396, 80..136]`）、结果行（`[84..396, 144..184]`）与提示行（`[84..396, 188..220]`）保持不变；Keyboard 迁移为 `width: 466, keySize: 44, gap: 2, x: 7, y: 220, controlKeyRatio: 1.5`（默认 `keyHeight: 48`）：

| 行 / 项 | 改前（实测） | 改后（实测） | 改后判据 |
|---|---|---|---|
| Keyboard root | `[0..480, 264..456]`（480×192, `pad=4, gap=8`） | `[7..473, 220..426]`（466×206, `pad=4, gap=2`，内宽精确 458） | 清出提示行 (`220`) |
| `row 0`（Q..P, 10 键） | `40×40`, `[4..476, 268..308]`, **`Rmax=245.6 OUT_R240`** | `44×48`, `[11..469, 224..272]`, `Rmax=231.2`（`clr240=8.8, clr233=1.8`） | `IN_R240 IN_R233` |
| `row 1`（A..L, 9 键） | `40×40`, `[28..452, 316..356]`, **`Rmax=241.7 OUT_R240`** | `44×48`, `[34..446, 274..322]`, `Rmax=221.7`（`clr240=18.3, clr233=11.3`） | `IN_R240 IN_R233` |
| `row 2`（Z..M, 7 键） | `40×40`, `[76..404, 364..404]`, `Rmax=231.9` | `44×48`, `[80..400, 324..372]`, `Rmax=207.4`（`clr240=32.6, clr233=25.6`） | `IN_R240 IN_R233` |
| `row 3`（SPACE / BKSP / ENTER） | `184/40/40 × 40`, `[100..380, 412..452]`, **`Rmax=254.1 OUT_R240`** | `136/66/66 × 48`, `[104..376, 374..422]`, `Rmax=227.2`（`clr240=12.8, clr233=5.8`） | `IN_R240 IN_R233`, **3/3 `≥48×48`** |
| **汇总** | `touchH48=0/29`, `inR240=23/29`（**6 键出圆**）, `worstR=254.1` | **`touchH48=29/29`**, **`touch48x48=3/29`**, **`inR240=29/29`**, **`inR233=29/29`**, `worstR=231.2` | 6 键出圆全清零，键高全达标 |

## 4. `tests/` 断言改动对照表

`tests/shell_components.js`、`tests/keyboard_demo.js`、`tests/keyboard_states.js` **零改动、原样全 PASS**；所有逻辑/状态机/回调路由/dispose/mutation 断言一条未删、一条未弱化，仅迁移以下几何锚点：

| 测试文件 | 位置 | 旧锚点 | 新锚点 | 依据 |
|---|---|---|---|---|
| `tests/shell_keyboard.js` | L16–67 | `width:400, keySize:40, x:40, y:240`；`controlKeyRatio:1.8` → `72`；`SPACE=160`；`rootH=168`；`keyHeight:48` 覆盖；拒 `keyHeight:39` | `width:448, keySize:44, x:16, y:240`；新增默认 `keyHeight=Math.max(48,keySize)`（44→48、56→56）断言；`controlKeyRatio:1.5` → `66`；`SPACE=132`；`rootH=200`；`keyHeight:56` → `rootH=232`；拒 `keyHeight:40/47/48.5/129` | 同步 r217 `keyHeight` 48px 下限与 3× `SPACE` 规格，保留全部校验与变异证明 |
| `tests/fixtures/shell_keyboard_default.json` | 249 条消息 | pre-r203 `400×168`（40×40 键、160px SPACE）golden | r217 `448×200`（44×48 键、132px SPACE）golden | 对应 `tests/shell_keyboard.js` 新默认基准与 `+1` 变异证明 |
| `tests/wordle.js` | L300, L605–606, L665, L683 | `240 + 4 * 40 + 2 * 4 <= 480`；`keySize: 40, gap: 0, x: 40, y: 240` | `240 + 4 * 48 + 2 * 4 <= 480`；`keySize: 44, gap: 0, x: 16, y: 240` | 同步 `examples/wordle/app.js` 新键盘参数；对应 mutation 仍 FAIL |

## 5. 验证证据汇总（原始输出见 `artifacts/r217/`）

| artifact | 结果摘要 |
|---|---|
| `geometry-before.txt` / `geometry-after.txt` | 同一脚本 `geometry_dump.js` 前后对照；`wordle` 键高 `40→48`、`worstR=236.3 IN_R240`；`keyboard_demo` 键高 `40→48`、出圆键 `6→0`、`worstR=231.2 IN_R233 IN_R240` |
| `shell_keyboard.txt` | `PASS 6 shell Keyboard cases`（含 golden 精确比对、变异证明、48px 下限与 >48 跟随、1.5 控键宽比、参数校验） |
| `shell_components.txt` | `PASS 20 shell component cases` |
| `wordle.txt` | `ALL WORDLE HARNESS CASES PASSED`（全部逻辑 + 60s 烟测 + 静态守卫 + mutation 全绿） |
| `keyboard_demo.txt` | `ALL KEYBOARD DEMO HARNESS CASES PASSED`（零改动原样 PASS） |
| `keyboard_states.txt` | `ALL KEYBOARD STATES HARNESS CASES PASSED`（零改动原样 PASS） |
| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 改前、改后均 **0 FAIL**（`REGRESSION DONE`） |
| `playground-verify.txt` | `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs` 全部 PASS，74 个 app 加载零错（含 `keyboard_demo: 39 nodes`、`wordle: 39 nodes`） |
| `playground-manifest.txt` | `PASS playground manifest 74 apps match generated sources and examples; removal/addition mutation caught` |
| `check-wordle.txt` / `check-keyboard_demo.txt` | `lume check --no-emu`：`wordle` `39807 bytes`、`keyboard_demo` `30501 bytes`，均 `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| `check-website.txt` | `api.html is up to date with lume.d.ts (162 entries)`；`examples.html gallery up to date (74 cards)`；`API missing/invented/duplicates/not found: none` |
| `cli-tests.txt` | `npm test --prefix tools/lume`：76/76 PASS（0 fail） |
| `ascii.txt` | `examples/wordle/app.js: 0`、`examples/keyboard_demo/app.js: 0`、`runtime/shell.js: 0`（无非 ASCII 字节） |

## 6. 偏离、范围纪律与未做项

- **Playground 产物同步**：执行 `node tools/playground/build.mjs` 并通过 Playwright 74 app `verify.mjs` 后，按 r216 `d4cd368` 先例仅保留 `website/playground/sources/{wordle,keyboard_demo}.js` 与 `website/playground/sources.js`，回退了 `website/playground/apps/` 全部编译包，回退后复跑 `tests/playground_manifest.js`、`tests/wordle.js`、`tests/keyboard_demo.js` 均 PASS。
- **测试文件越界说明**：简报改动面列举了 `tests/shell_keyboard.js` 与 `tests/shell_components.js`；因 `examples/wordle/app.js` 迁移了 `Keyboard` 几何参数，而 `tests/wordle.js` L606 存在字符串锚点 `keySize: 40, gap: 0, x: 40, y: 240`，同步更新了该 2 处几何锚点（及对应 golden fixture `tests/fixtures/shell_keyboard_default.json`），以保证全量回归 0 FAIL 且不弱化任何断言。
- **诚实豁免登记**：10 列 QWERTY 字母键宽在 480px 圆屏 `R≤240` 约束下数学上无法达到 48px（§2.1 证明 `R≥241.2 > 240`），故本轮实收为字母键 `44×48`（`keyboard_demo` 含 `gap=2` 步距 `46×50`）、控制键 `66×48` / `132..136×48`（全部 `≥48×48`）、全键高度 `48px` 强制达标。
- **未做 / deferred**：真机显示效果、44px 字母键与 66px 控键在 2.16" 圆屏上的实际拇指点击精度与误触率均 deferred 到 board bring-up；未动 `firmware/` 与 prelude，未跑 `idf.py build`，未 push。

## 7. 提交拆分

按 `feat / test / chore / docs` 逻辑拆分为独立 commit（git 身份 `congduan`，未 push）：
1. `feat(shell): raise Keyboard keyHeight floor to 48px and taper SPACE to 3x`（`runtime/shell.js`、`runtime/types/lume.d.ts`）
2. `feat(examples): migrate wordle and keyboard_demo to 44x48 tapered Keyboard inside R<=240`（`examples/wordle/app.js`、`examples/keyboard_demo/app.js`）
3. `test(keyboard): migrate Keyboard geometry anchors and golden fixture to r217 48px spec`（`tests/shell_keyboard.js`、`tests/fixtures/shell_keyboard_default.json`、`tests/wordle.js`）
4. `chore(playground): re-sync generated source mirrors and sources.js for r217`（`website/playground/sources.js`、`website/playground/sources/wordle.js`、`website/playground/sources/keyboard_demo.js`）
5. `chore(artifacts): record r217 geometry before/after, harnesses, playground and ASCII evidence`（`artifacts/r217/`）
6. `docs(r217): report Keyboard touch-target upgrade, geometric proof and verification`（`docs/r217-report.md`）
