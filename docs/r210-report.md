# r210 报告：圆屏安全区 batch5 收口（memory / wordring / voice_assistant）

## 0. 基线与口径

- 简报写的基线是 `f5ed20a`；开工实证时 worktree 实际 HEAD 为 `029343e`（`origin/main`，已含 r206/r212 两次 merge），分支 `r210-safearea-batch5`，工作树干净。按「实施岗」口径直接在当前 HEAD 开工，未 rebase、未 push。
- 全部证据均为**宿主 harness / prelude_runner / esbuild bundle**；无真机、无截图、无 playground 重建。圆屏观感、触感、可点手感 deferred 到 board bring-up。

## 1. 实证方法（先实证，再改断言）

1. 先用 `tests/lib/prelude_runner.js` 跑原始 app，dump `create`/`attr` 消息拿到真实 `x/y/w/h`，确认简报数字与当前码一致（三 app 基线 harness 全绿后才动手）。
2. 改后用同一 runner dump 同一组属性，逐项对照。原始输出：
   - `artifacts/r210/geometry-before.txt`
   - `artifacts/r210/geometry-after.txt`

## 2. 逐 app 改动前/后坐标对照表（实测，非抄简报）

坐标区间均为 `[x起点..x终点, y起点..y终点]`；安全方块为 480 圆屏的 `[75,405]`。

### 2.1 memory

| 元素 | 改动前（实测） | 改动后（实测） |
|---|---|---|
| DEAL 按钮 | `[184..328, 424..468]`，144×44 → **下缘出安全区/不可点** | `[168..312, 356..404]`，144×48 ✓ |
| MEMORY 标题 | `(8, 6)` → x/y 越界 | `(80, 76)` ✓ |
| MV / PAIRS 行 | `(104, 6)` → y 越界 | `(80, 94)`，并合并 BEST ✓ |
| 状态提示 | `(8, 26)` → 越界 | `(80, 112)` ✓ |
| BEST 单独行 | `(8, 46)` → 越界 | **删除**（并入 MV 行，消除冗余） |
| 4×4 棋盘 | `CELL=88, GAP=8, GX=64, GY=44` → `[64..440, 44..420]` | `CELL=52, GAP=4, GX=130, GY=132` → `[130..350, 132..352]` ✓ |
| 8×8 脸谱 | 固定 10px/tile（80px，溢出 52px 卡片） | `TS=5`（40px/tile），随 `CELL` 居中缩放 |
| canvas | `480×480 @ (0,0)` | 不变 |

### 2.2 wordring

| 元素 | 改动前（实测） | 改动后（实测） |
|---|---|---|
| DEL | `[236..306, 4..36]`，70×32 → **顶部圆边外不可点** | `[104..176, 356..404]`，72×48 ✓ |
| ENTER | `[312..396, 4..36]`，84×32 → 不可点 | `[192..288, 356..404]`，96×48 ✓ |
| NEW | `[402..472, 4..36]`，70×32 → 不可点且 x>405 | `[304..376, 356..404]`，72×48 ✓ |
| 标题 / HUD / 提示 | `(8,6)/(8,26)/(8,46)` → 越界 | `(84,76)/(210,76 右对齐)/(84,94)` ✓ |
| 5×6 棋盘 | `CELL=42, GAP=5, GX=125, GY=56` → `[125..355, 56..333]` | `CELL=29, GAP=2, GX=163, GY=116` → `[163..316, 116..300]` ✓ |
| 字母环带 | `CY=388, RX=176, RY=30` → `x[64..416], y[358..418]`；点击带 `352..428` | `CY=328, RX=150, RY=18` → `x[90..390], y[310..346]`；点击带 `304..352`（48px 高）✓ |
| 左右旋转提示字形 | `x=36 / 430`（出安全区） | `x=78 / 394` ✓ |
| canvas | `480×430 @ (0,0)` | 不变 |
| 按钮索引 | `press(6/7/8)` = DEL/ENTER/NEW | 不变 |

三段在 466px 高度内无重叠：棋盘底 `300` < 环带顶 `304` < 环带底 `352` < 按钮顶 `356` < 按钮底 `404` ≤ 405。

### 2.3 voice_assistant

| 元素 | 改动前（实测） | 改动后（实测） |
|---|---|---|
| TALK 按钮 | `[170..310, 436..476]`，140×40 → **下缘出安全区/不可点** | `[170..310, 332..380]`，140×48 ✓ |
| LUME VOICE 标题 | `(0,34)` 480×34 → x/y 越界 | `(84,76)` 312×22 ✓ |
| MODE 徽标 | `(0,72)` 480×24 → 越界 | `(84,98)` 312×14 ✓ |
| TURN 上下文 | `(0,94)` 480×16 → 越界 | `(84,112)` 312×12 ✓ |
| 状态大字 | `(0,110)` 480×58, fs40 → 越界 | `(84,126)` 312×38, fs28 ✓ |
| 波形 canvas | `(80,176)` 320×160 → 安全区内 | `(80,168)` 320×160（手势热区随之移动）✓ |
| 回答文本 | `(40,344)` 400×62 → x<75、底 406>405 | `(84,288)` 312×38（叠在波形下段，r202/r209 接受的 overdraw）✓ |
| 操作提示 | `(0,412)` 480×22 → 越界 | `(84,384)` 312×16 ✓ |

手势绑定不动：`tap/longpress/panstart/panend` 仍绑在 `vaRoot` + `vaCanvas`；canvas 热区随节点上移 8px，根节点仍包住所有可见目标，harness 继续向同一 root 节点派发 PTT。BLE / 音频 / WS / 状态机零改动。

## 3. harness 断言改动明细

### tests/memory.js（1 个用例块，12 个用例全保留）
- `CELL` 88→52、`GAP` 8→4（锚定值）。
- `gridW` 右界：`<= 480` → `<= 405`（**收紧**，从整屏改为安全方块）。
- `gridH` 下界：`<= 424`（贴旧按钮行）→ `<= 356`（贴新 DEAL 行 y=356，**收紧**）。
- 负向用例原样保留：重复翻同一张（#6）、三张连翻保护（#6）、越界/已配对/胜利后锁定（#7）；best 策略（#9）与洗牌/可解性（#2/#12）未改。

### tests/wordring.js（2 个用例块，16 个用例全保留）
- 点击锚点 `(80,388)/(400,388)/(240,388)` → `(90,328)/(390,328)/(240,328)`（`tapLetter`、#14、#15 共 9 处），跟随环带重排；坐标仍落在各自弧区与 48px 点击带内。
- `gridRight` 右界：`<= s.IW` → `<= 405`（**收紧**）；`gridBottom < BAND_TOP` 保留。
- `BAND_BOT <= s.IH` → `<= 405`（**收紧**），并新增 `BAND_BOT < 356`（环带不得压按钮行）。
- 负向用例原样保留：短词/重复提交不耗回合（#7）、六次失败锁盘（#9）、fewest-tries 策略（#10）、KV 抛异常降级（#11）。

### tests/voice_assistant.js
- **未改**（该文件不在简报允许的改动面内）。18 个既有用例（含 r124 PTT 全套）无需改断言即全绿；按钮坐标未被 harness 冻结。

**语义未放宽声明**：上述所有数值变更均为「收紧」或「等价平移」；没有任何 `assert` 被删除、降级或改写成更宽松的条件。

## 4. DESIGN-TOKENS §0 八条红线逐条自查

1. **圆屏安全区**：三 app 全部可交互元素与关键文本实测落在 `[75,405]`（见 §2 表）。memory/wordring 的全屏 canvas 是纯装饰背景，承载的关键文本已改为独立 Text 节点并落在安全区。✓
2. **圆角容器嵌套冲突**：未新增嵌套圆角卡片；memory/wordring 按钮 `borderRadius:6`，voice TALK 为单层胶囊 `999`（§1.4 允许），无双层大圆角。✓
3. **触控目标 ≥48×48**：DEAL 144×48；wordring DEL/ENTER/NEW = 72/96/72 ×48，字母环点击带 48px 高；voice TALK 140×48、canvas 320×160；memory 卡片 52×52。✓
4. **对比度**：未引入新配色对，沿用 primitive 色板（`text-hi #F2F7FB` / `accent #40D8B0` 对深底），无新增低对比组合；真机目测 deferred。✓
5. **无信息冗余**：memory 的 BEST 独立行并入 MV/PAIRS 行，不再用两处表达同一状态；wordring/voice 信息结构未增。✓
6. **状态机驱动按钮**：voice TALK 经 `vaActivate/vaCan` 唯一分发；wordring DEL/ENTER/NEW 在逻辑层由 `wrBackspace/wrSubmit` 的 `done` 守卫；memory DEAL 任意时刻合法。未出现非法动作并存。✓
7. **危险操作隔离**：wordring DEL 改为 danger 风格底色/字色并置最左、与 ENTER 间隔 16px；memory/voice 无删除类操作。✓
8. **禁止字母占位图标**：未新增任何图标；旋转箭头沿用既有 5×7 像素字形（非字母占位图标语义）。✓

**三层 token**：Primitive 色板/字号/间距沿用原值，未自造颜色；Semantic 角色（主操作 accent、危险 danger、弱提示 text-low）语义未改写；Component 层按 §1.5 的 48px 触区与 §1.4 圆角约束重排。UI 字面量 ASCII-only（见 §5）。

## 5. 验证原始输出（`artifacts/r210/`，只留文本）

| 文件 | 结果 |
|---|---|
| `memory.txt` | `ALL tests/memory.js PASS`（12 用例） |
| `wordring.txt` | `ALL tests/wordring.js PASSED`（16 用例，含 ~60s smoke） |
| `voice_assistant.txt` | `ALL VOICE ASSISTANT HARNESS CASES PASSED`（18 用例） |
| `full-regression.txt` | `for t in tests/*.js` 全量回归 **0 FAIL**，末尾 `REGRESSION DONE` |
| `check-memory.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| `check-wordring.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| `check-voice_assistant.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)` |
| `ascii.txt` | memory / wordring / voice_assistant 各 `grep -cPn '[^\x00-\x7F]'` = **0** |
| `geometry-before.txt` / `geometry-after.txt` | 改前/改后 `create`/`attr` 实测坐标 dump |

注：`--no-emu` 按 CLI 设计跳过 eval/layout/perf，故布局结论来自宿主 harness 与坐标 dump，不冒充布局 lint 结果。

## 6. 偏离登记（如实上报）

- **website 生成镜像**：简报红线写「不动 website/」，但 `tests/playground_manifest.js` 强制要求 `website/playground/sources/<app>.js` 与 `examples/<app>/app.js` 字节一致，而 memory/wordring/voice_assistant 均已注册。为满足「全量回归 0 FAIL」，只同步了 3 个 `sources/<app>.js` + `sources.js` 这 4 个**派生镜像**文件（2 个 chore commit）；**未运行 playground 重建**，未改 `website/playground/apps/*` bundle，manifest 应用数仍为 **74**。这是本轮唯一超出简报改动面的变更，由绿色回归门禁强制。
- **基线漂移**：简报基线 `f5ed20a`，实际 worktree 在 `029343e`（见 §0）；未做任何 rebase/回滚。

## 7. 诚实口径

本轮全部为宿主 harness / prelude runner / bundle 证据，**不是真机验收**。圆屏实际观感、手指触感、贴边可点性、BLE/音频行为均 deferred 到 board bring-up；未抓取任何截图（磁盘约束），artifacts 只留文本原始输出。
