# r216 报告：圆屏安全区 batch8 专项（dashboard / invaders / frogger / minesweeper 及宿主测试同步）

## 0. 基线与口径

- 基线：`origin/main` `4d473ed`（2026-11-27，r215 batch7 已合入），工作树 `/tmp/lume-r216-wt`，分支 `r216-safearea-deferred`，开工时工作树干净。
- 全部结论仅由 **宿主 harness、`prelude_runner` 坐标 dump、Playwright playground 加载检查与 esbuild bundle** 支撑；**无真机、无硬件截图、未跑 `idf.py build`**（本轮零 `firmware/` / `runtime/` / `prelude` / `tools/` 改动）。480×480 圆屏上的实际视觉观感、手指触控手感、小格扫雷/青蛙操作舒适度均 deferred 到 board bring-up；本报告不构成硬件验收。

## 1. 改前实证（先实证，再改坐标）

1. 使用可重放脚本 `artifacts/r216/geometry_dump.js` 通过 `tests/lib/prelude_runner.js`（叠加 `runtime/shell.js`）运行 4 个目标 app 的真实源码，解析 `ATTR_PARENT=6` 累加绝对坐标，并对 `dashboard` 的 `systemStaticLines()` / `drawSystem()` / `traceStaticLines()` / `drawTrace()` 以及 `invaders` / `frogger` / `minesweeper` 的玩法区边界逐一计算圆心 `(240, 240)` 最大角距 `Rmax` 与安全方块 `[75, 405]` 判据（改前输出见 `artifacts/r216/geometry-before.txt`）。
2. 改前全量回归：`for t in tests/*.js` **0 FAIL**（`artifacts/r216/full-regression-before.txt`）。
3. 4 个候选全部实证存在真实出界（`OUT_SAFE` + `OUT_R240`），无误报、无跳过项：
   - **`dashboard`**：tab 按钮 `GAUGE` `[24..160, 400..456]` / `TRACE` `[172..308, 400..456]` / `SYSTEM` `[320..456, 400..456]` 出安全区且左右两键 `Rmax=305.5 > 240`；`SYSTEM` 页标题 `(56,48)` `Rmax=265.9 > 240`、9 条分隔线 `[56..424, y=122..362]` 与 10 行文字起点 `x=56` 越出 `[75,405]`；`TRACE` 页标题 `(56,48)`/`(340,48)` `Rmax=268.7 > 240` 且底部提示 `(56,370)` 会被上移后的 tab 遮挡。
   - **`invaders`**：HUD 已在 `[84..396, 80..117]`，但玩法区整体包络 `[0..480, 44..454]` `Rmax=321.6 > 240`（编队左右折返 `[16..464]`、UFO `y=44..54`、编队首行 `y=60` 压穿 HUD、炮台 `x∈[0..480], y=430..454`、地线 `y=452` 全部出界）。
   - **`frogger`**：HUD 已在 `[84..396, 80..117]`，但 13×13 格盘 `[25..454, 44..473]` `Rmax=317.0 > 240`（`CELL=33, GX=25, GY=44`，顶部压穿 HUD、四角严重出圆）。
   - **`minesweeper`**：HUD 与 `92×48` `RESTART` 键已在 `[84..396, 78..126]`，但 10×10 格盘 `[41..439, 64..462]` `Rmax=298.1 > 240`（`CELL=38, GAP=2, GX=41, GY=64`，前两行被 HUD/`RESTART` 直接遮挡、四角出圆）。

## 2. 改动前/后坐标对照表（实测 dump）

安全方块为 480 圆屏内切安全区 `[75, 405]`；圆屏半径 `R = 240`（圆心 `(240, 240)`）。完整前后原始输出见 `artifacts/r216/geometry-before.txt` 与 `artifacts/r216/geometry-after.txt`。

### 2.1 `dashboard`（任务一主项）

Canvas 保持 `SAFE=40, W=400, H=360`（屏幕 `[40..440, 40..400]`，底色与全屏 `backdrop` 相同 `#07111D`），全部可见元素与 Canvas 绘制内容缩进至 `[84..396, 78..400] ⊂ [75, 405]`：

| 元素 | 改动前（实测屏幕坐标） | 改动后（实测屏幕坐标） | 改后判据 |
|---|---|---|---|
| Tab `GAUGE`（node 23） | `[24..160, 400..456]`（`136×56`, `Rmax=305.5`） | `[84..182, 352..400]`（`98×48`, `r=10`, `Rmax=223.5`） | `IN_SAFE IN_R240` |
| Tab `TRACE`（node 24） | `[172..308, 400..456]`（`136×56`, `Rmax=226.5`） | `[191..289, 352..400]`（`98×48`, `r=10`, `Rmax=167.3`） | `IN_SAFE IN_R240` |
| Tab `SYSTEM`（node 25） | `[320..456, 400..456]`（`136×56`, `Rmax=305.5`） | `[298..396, 352..400]`（`98×48`, `r=10`, `Rmax=223.5`） | `IN_SAFE IN_R240` |
| Tab 间距 | `12px` | `9px`（`182→191`, `289→298`，互不遮挡且 `≥8px`） | 达标 |
| SYSTEM 标题 `SYSTEM` / `runtime inventory` | `(56,48)` / `(56,66)`（`Rmax=265.9`） | `(84,78)` / `(196,78)`（同列顶栏，`Rmax=224.9`） | `IN_SAFE IN_R240` |
| SYSTEM 9 条分隔线 `systemStaticLines()` | local `[16..384, 82+i*30]` → 屏幕 `[56..424, 122..362]` | local `[44..356, 81+i*24]` → 屏幕 `[84..396, 121..313]` | `IN_SAFE IN_R240` |
| SYSTEM 10 行数据（Row 0 `SOC` .. Row 9 `OTA`） | local `x=16/200, y=62+i*30` → 屏幕 `x=56/240, y=102..386`（压入 `y=352` tab 区） | local `x=44/168, y=62+i*24` → 屏幕 `x=84/208, y=102..332`（`OTA` 底边 `332`，距 tab `352` 净空 **20px**） | `IN_SAFE IN_R240` |
| TRACE 标题 / 采样率 | `(56,48)` / `(340,48)`（`Rmax=268.7`） | `(84,80)` / `(300,80)`（`Rmax=223.5`） | `IN_SAFE IN_R240` |
| TRACE 网格 + `traceSpark` | `[84..396, 84..284]` | `[84..396, 100..280]`（`Rmax=209.6`） | `IN_SAFE IN_R240` |
| TRACE 图例 / samples / swipe 提示 | 屏幕 `x=56, y=308..384`（压入 tab） | 屏幕 `x=84, y=288..344`（距 tab `352` 净空 **8px**） | `IN_SAFE IN_R240` |
| GAUGE 标题 / 4 指标卡 / 状态行 | 标题 `y=84..116`，卡 `h=114` `y=124..364`，状态 `y=376..396`（压入 tab） | 标题 `y=78..106`，卡 `h=98` `y=112..320`，状态 `y=326..346`（距 tab `352` 净空 **6px**），遮罩 `h=348` | `IN_SAFE IN_R240` |

- 保留全部 10 行 SYSTEM 信息（`SOC` / `FLASH` / `PSRAM` / `WIFI` / `IP` / `BLE` / `STORAGE` / `TEMP` / `UPTIME` / `OTA`），无减行；24px 行距（14px 字高 + 上下各 5px 留白居中 1px 分隔线）在 330px 安全区高度内无拥挤、无重叠。

### 2.2 `invaders`

| 元素 | 改动前（实测） | 改动后（实测） | 改后判据 |
|---|---|---|---|
| HUD（标题/计分/提示） | `[84..396, 80..117]` | 不变（`[84..396, 80..117]`） | `IN_SAFE IN_R240` |
| 初始编队（11×5） | `CELL_W=28, CELL_H=44, FORM=(88,60)` → `[88..392, 60..252]`（压 HUD） | `CELL_W=26, CELL_H=26, FORM=(98,142)` → `[98..382, 142..262]`（`Rmax=172.5`） | `IN_SAFE IN_R240` |
| 编队水平折返边界 | `[16..464]`（`left<16`, `right>IW-16`） | `[80..400]`（`PLAY_L=80`, `PLAY_R=400`） | `IN_SAFE IN_R240` |
| UFO 轨道 | `x∈[-32..512], y=44..54` | `x∈[80..400], y=124..134`（距 HUD 净空 7px） | `IN_SAFE IN_R240` |
| 炮台活动区 | `x∈[0..480], y=430..454` | `x∈[80..400], y=372..396`（`CANNON_Y=372`, `32×24`） | `IN_SAFE IN_R240` |
| 地面线 | `[0..480, 452..454]` | `[80..400, 396..398]`（`GROUND_Y=396`） | `IN_SAFE IN_R240` |
| 玩法区总包络 | `[0..480, 44..454]`（`Rmax=321.6`） | `[80..400, 124..398]`（`Rmax=224.9`） | `IN_SAFE IN_R240` |

### 2.3 `frogger`

| 元素 | 改动前（实测） | 改动后（实测） | 改后判据 |
|---|---|---|---|
| HUD（标题/计分/提示） | `[84..396, 80..117]` | 不变（`[84..396, 80..117]`） | `IN_SAFE IN_R240` |
| 13×13 格盘 | `CELL=33, GX=25, GY=44` → `[25..454, 44..473]`（`Rmax=317.0`） | `CELL=21, GX=104, GY=124` → `[104..377, 124..397]`（`Rmax=208.4`） | `IN_SAFE IN_R240` |
| 青蛙精灵与碰撞盒 | `12×12`×2 = `24×24`（`+4,+4`） | `8×8`×2 = `16×16`（`+2,+2`，严丝合缝落于 `21×21` 格内） | `IN_SAFE IN_R240` |
| 青蛙起点 `(12,6)` | `[227..251, 444..468]`（`OUT_SAFE`） | `[232..248, 378..394]`（`Rmax=154.2`） | `IN_SAFE IN_R240` |
| 车流/浮木卷绕区 | `[-20..500]`，遮罩 `GX=25` | `[GX-20..GX+COLS*CELL+20]`，遮罩 `GX=104..377` | `IN_SAFE IN_R240` |

### 2.4 `minesweeper`

| 元素 | 改动前（实测） | 改动后（实测） | 改后判据 |
|---|---|---|---|
| HUD + `RESTART` 键 | `[84..396, 78..127]`（`RESTART` `92×48`） | 不变（`[84..396, 78..127]`） | `IN_SAFE IN_R240` |
| 10×10 格盘 | `CELL=38, GAP=2, GX=41, GY=64` → `[41..439, 64..462]`（`Rmax=298.1`，压 HUD/`RESTART`） | `CELL=25, GAP=2, GX=106, GY=132` → `[106..374, 132..400]`（`Rmax=208.7`，距 HUD/`RESTART` 净空 5–6px） | `IN_SAFE IN_R240` |
| 格内像素精灵缩放 | `scale=4`（7×7 精灵占 28px，offset `5,5`/`9,5`） | `scale=3`（7×7 占 21px offset `2,2`；5×7 数字占 15×21px offset `5,2`，居中且不越 `25×25` 瓦片边界） | 零越界 |

## 3. `tests/` 断言改动对照表

所有逻辑断言（OTA 状态判别/不读 token/Dialog 守卫/非 ASCII 拒绝/firmware 变更守卫，以及三个游戏的碰撞/胜负/步进/帧预算/脏矩形/零空闲绘制）**一条未删、一条未弱化**；仅同步几何数字锚点：

| 测试文件 | 位置 | 旧断言 / 正则 / 值 | 新断言 / 正则 / 值 | 几何依据 |
|---|---|---|---|---|
| `tests/ota_consumers.js` | L176-178, L249 | `/function systemStaticLines\(\)[\s\S]*?for \(var i = 0; i < 9; i\+\+\) segs\.push\(\[16, 82 \+ i \* 30/` | `/function systemStaticLines\(\)[\s\S]*?for \(var i = 0; i < 9; i\+\+\) segs\.push\(\[44, 81 \+ i \* 24, W - 44, 81 \+ i \* 24\]\)/` | `dashboard` 画布原点 `(40,40)`，分隔线缩进至 `local x=44..W-44`（屏幕 `84..396`）与 24px 行距（`81+i*24`，屏幕 `121..313`），使第 10 行 `OTA`（屏幕 `318..332`）净空 `y=352..400` tab 行 20px；同时补强右端点 `W - 44` 校验，`i < 9` → `i < 8` mutation 仍 FAIL。 |
| `tests/invaders.js` | L29 | `s.fx = 480 - 16 - ((11 - 1) * 28 + 24) - 1;` | `s.fx = 400 - ((11 - 1) * 26 + 24) - 1;` | 右折返墙由 `IW-16=464` 缩进为 `PLAY_R=400`，列距 `CELL_W` 由 `28` 缩为 `26`。 |
| `tests/invaders.js` | L35, L48 | `assert.equal(s.fy, y + 44);` | `assert.equal(s.fy, y + 26);` | 行距 `CELL_H` 由 `44` 缩为 `26`（5 行编队高 120px，保持 4 次下沉后触底判负节奏）。 |
| `tests/invaders.js` | L43, L47 | `s.fx = 17;` / `assert.equal(s.fx, 16);` | `s.fx = 81;` / `assert.equal(s.fx, 80);` | 左折返墙由 `16` 缩进为 `PLAY_L=80`。 |
| `tests/invaders.js` | L72 | `s.enemyBullets.push({ x: s.cannonX + 16, y: 430 });` | `s.enemyBullets.push({ x: s.cannonX + 16, y: 372 });` | 炮台纵坐标 `CANNON_Y` 由 `430` 上移至 `372`（`372..396 ⊂ [75,405]`）。 |
| `tests/invaders.js` | L85-86 | `s.ufo = { x: 200, y: 44 }; s.bullet = { x: 210, y: 52 };` | `s.ufo = { x: 200, y: 124 }; s.bullet = { x: 210, y: 132 };` | UFO 纵坐标 `UFO_Y` 由 `44` 下移至 `124`（位于 HUD `y=80..117` 下方 7px，子弹上限 `BULLET_TOP=120`）。 |
| `tests/frogger.js` | L22 | `const ROOT = 1, CELL = 33, GX = 25, GY = 44;` | `const ROOT = 1, CELL = 21, GX = 104, GY = 124;` | 13×13 格盘缩进至 `[104..377, 124..397]`（`273×273`，位于 HUD 下方 7px 且居中于安全方块）。 |
| `tests/minesweeper.js` | L302-307 | 格宽 `398`（`10×38+9×2`），`gridR <= 480` / `gridB <= 480` / `gridB >= 62` | 格宽 `268`（`10×25+9×2`），`GX >= 75 && gridR <= 405` 且 `GY >= 132 && gridB <= 405` | 10×10 格盘缩进至 `[106..374, 132..400]`，断言由宽泛 `<=480` 收紧为安全方块 `[75,405]` 且清出 HUD/`RESTART`（`y≤127`）。 |
| `tests/minesweeper.js` | L340-342 | `ui.gesture(1, *, 41 + 10, 64 + 10, ...)` | `ui.gesture(1, *, 106 + 10, 132 + 10, ...)` | 格 `(0,0)` 原点由 `(41,64)` 移至 `(106,132)`。 |
| `tests/minesweeper.js` | L349-350 | `ui.gesture(1, *, 41 + 5 * 40 + 10, 64 + 5 * 40 + 10, ...)` | `ui.gesture(1, *, 106 + 5 * 27 + 10, 132 + 5 * 27 + 10, ...)` | 格 `(5,5)` 步距 `CELL+GAP` 由 `40` 变为 `27`，命中点 `(251,277)`。 |

## 4. 验证证据汇总（原始输出见 `artifacts/r216/`）

| artifact | 结果摘要 |
|---|---|
| `geometry-before.txt` / `geometry-after.txt` | 同一脚本 `geometry_dump.js` 前后对照；改后 4 个 app 全部交互节点、文字与玩法区均为 `IN_SAFE IN_R240`（仅 480×480 背景 root/canvas、dashboard `400×360` 背景画布与底部 3px 装饰条外围装饰层不在内切方块内）。 |
| `ota_consumers.txt` | `ALL OTA CONSUMERS HARNESS CASES PASSED`（18 项正向断言 + 18 项 mutation 断言全部 PASS，含分隔线回退 8 条、非 ASCII 字面量、token 读取与 firmware 变更守卫）。 |
| `invaders.txt` | `ALL INVADERS HARNESS CASES PASSED`（`active max 6 draws / 64 total ops (<=240), paused/over 0 ops in 10 ticks, 8 spriteDefine`）。 |
| `frogger.txt` | `ALL FROGGER HARNESS CASES PASSED`（`active max 16 draws / 49 total ops (<=240), over 0 ops in 10 ticks, 8 spriteDefine`）。 |
| `minesweeper.txt` | `ALL tests/minesweeper.js PASS`（`boot 101 ops, flag 1 op, dig 42 ops (<=240), idle 0 ops in 10 ticks, 8 spriteDefine`）。 |
| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 全量回归改前、改后均 **0 FAIL**，末尾 `REGRESSION DONE`。 |
| `playground-verify.txt` | Playwright `tools/playground/verify.mjs` 全部 PASS，74 个 app 加载无运行时错误（含 `dashboard: 27 nodes`, `invaders: 5 nodes`, `frogger: 5 nodes`, `minesweeper: 7 nodes`）。 |
| `playground-manifest.txt` | `PASS playground manifest 74 apps match generated sources and examples; removal/addition mutation caught`。 |
| `check-website.txt` | `examples.html gallery up to date (74 cards)`；`API missing/invented/duplicates/not found: none`。 |
| `ascii.txt` | 4 个改动 `app.js` 的 `grep -cPn '[^\x00-\x7F]'` 全部 = **0**（顺手清理了 invaders/frogger/minesweeper 注释中原有的非 ASCII 破折号与零宽空格，UI 字符串本就全 ASCII）。 |
| `check-{dashboard,invaders,frogger,minesweeper}.txt` | 4 项 `lume check --no-emu` 全部 `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 大小：`dashboard` 36497 B、`invaders` 9697 B、`frogger` 9590 B、`minesweeper` 8062 B）。 |

## 5. 偏离与范围纪律说明

- **Playground 生成物同步**：执行 `node tools/playground/build.mjs` 重生成全部产物并用 Playwright `verify.mjs` 验证全通过后，按 r214 `e9606d5` / r215 `034fc8e` 先例与简报改动面声明（`website/playground/sources*`），仅提交 `website/playground/sources/{dashboard,invaders,frogger,minesweeper}.js` 与 `website/playground/sources.js`，回退了 `website/playground/apps/` 下 15 个编译包（其中 11 个为前序轮次未入库的无关 app）以避免越界改动；回退后复跑 `tests/playground_manifest.js` 与 `tests/ota_consumers.js` 均 PASS。
- **未动范围**：未改 `firmware/`、`runtime/`、`prelude`、`tools/`、`.d.ts`；未跑 `idf.py build`；未 push；git 身份为 `congduan`。
- **真机验收留待**：所有 4 个 app 的 480×480 AMOLED 圆屏实机观感、手指点击精度（特别是 `minesweeper` 25px 格盘与 `frogger` 21px 车道）与帧率表现均未实机验证，deferred 到 board bring-up。

## 6. 提交拆分

- `4f7c688` `feat(dashboard): fit tab bar and SYSTEM/TRACE/GAUGE layouts inside round safe square`
- `e4e3741` `feat(invaders): fit formation, UFO, cannon and ground inside round safe square`
- `44928a9` `feat(frogger): fit 13x13 grid, lanes and frog inside round safe square`
- `4326e48` `feat(minesweeper): fit 10x10 grid and tiles inside round safe square below HUD`
- `d4cd368` `chore(playground): re-sync generated source mirrors and sources.js for r216`
- `eb23e49` `chore(artifacts): record r216 geometry, regression, ota_consumers, playground and ASCII evidence`
- 本报告 `docs/r216-report.md` 单独 commit；未 push。
