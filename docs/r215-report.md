# r215 报告：圆屏安全区 batch7（games_breakout / files / image_gallery / crypto_check / archive_view）

## 0. 基线与口径

- 基线：`origin/main` `9f7d9d3`（2026-11-27，已含 r214 两分支合并），工作树 `/tmp/lume-r215-wt`，分支 `r215-safearea-batch7`，开工时工作树干净。
- 全部证据均为 **宿主 harness / `prelude_runner` 坐标 dump / esbuild bundle**；**无真机、无截图、未跑 `idf.py build`**（本轮零 `firmware/` / `runtime/` / `tools/` / `tests/` 改动）。圆屏实机观感、触控手感、实际像素渲染效果全部 deferred 到 board bring-up。

## 1. 实证方法与候选选刀（先实证，再改坐标）

1. 对简报给定的 26 个候选 app 逐一用 `tests/lib/prelude_runner.js` 运行真实源码（按宿主 harness 惯例处理 `runtime/shell.js`，解析 `ATTR_PARENT=6` 累加祖先坐标得到**真实屏幕绝对坐标**，并执行一次 `__lume_tick()` 以展开虚拟列表行），同时核查触区尺寸（`<48x48`）、卡片圆角（`>12`）与 `tests/` 硬锚点。
2. 改前基线：`for t in tests/*.js` 全量回归 **0 FAIL**（`artifacts/r215/full-regression-before.txt`）。
3. 可重放坐标导出脚本已归档：`artifacts/r215/geometry_dump.js`，改前/改后同一脚本对照（`artifacts/r215/geometry-before.txt` vs `artifacts/r215/geometry-after.txt`）。

### 1.1 选中清单（5 个真实 P0）

| # | app | 实证 P0 缺陷 |
|---|---|---|
| 1 | `games_breakout` | 玩法画布 `[48..432, 91..441]`（384×350）底角 `(48,441)` 圆距 `278px > 240px` 出圆裁切；挡板 `y=416..426` 滑到左右端直接出玻璃边界；外侧两列砖块 `x=68..122` / `358..412` 越出 `[75,405]`；底部 HUD (`y=356/382`) 压在玩法画布内。 |
| 2 | `files` | 行内 `DEL` 按钮仅 `44×34`（宽高均 `<48`），底部操作栏 `NEW` / `VIEW` / `DEL` 按钮高 `44 < 48`（违反红线 3）；底部 `DEL` 与主操作 `VIEW` 仅隔 `8px`（红线 7 危险操作隔离）。 |
| 3 | `image_gallery` | 底部翻页按钮 `<` 与 `>` 尺寸为 `48×34`（高度 `34 < 48`，违反红线 3）。 |
| 4 | `crypto_check` | 顶部 `NEXT` 按钮尺寸为 `100×36`（高度 `36 < 48`，违反红线 3，且 `borderRadius: 18`）。 |
| 5 | `archive_view` | 顶部 `NEXT` 按钮尺寸为 `100×36`（高度 `36 < 48`，违反红线 3，且 `borderRadius: 18`）。 |

### 1.2 落选清单（21 个候选，逐项实证理由，详单见 `artifacts/r215/selection.txt`）

- **`dashboard`（真实 P0，但受禁止改 `tests/` 阻断，登记 deferred）**：实测三枚 tab 按钮确在 `[24..160, 400..456]` / `[172..308, 400..456]` / `[320..456, 400..456]` 出安全区且 `SYSTEM` 画布文字起于 `(56,48)`；但 `tests/ota_consumers.js` 第 178 行硬断言 `systemStaticLines()` 必须含 `for (var i = 0; i < 9; i++) segs.push([16, 82 + i * 30`，将 10 行数据锁死在 30px 行距（`y=62..346` 占 284px，含表头 338px > 安全区 330px 高）。若仅把 48px tab 上移到 `y=348..396` 会直接遮挡 SYSTEM 第 10 行 `OTA`；若压缩行距则会打挂 `tests/ota_consumers.js`（本轮红线禁止改 `tests/` 断言）。故必须单独立项同步更新测试与 SYSTEM 布局。
- **已由前序轮次（r201/r202/r204/r205/r206/r210）收口、实测 0 问题（14 个）**：`games_snake`、`games_2048`（子文本 `x=0,y=15` 为父相对坐标误报）、`games_tetris`、`pet`、`weather`（r205 圆屏布局+48×48 刷新键，中文为既有本地化测试文案）、`music_player`（r204，全部按钮 ≥48×48）、`sokoban`、`memory`、`lcd_dual`、`adc_meter`、`img_view`、`clock_round`（r205，12/3/6/9 位于半径 R=158 轴线，最大角点 R=178.5 << 240 无裁切）、`aurora_clock`（r205，可见时间精灵绘制在 `[76..404, 196..284]`，被标出的 `x=50` Text 节点被不透明 480×480 Canvas 覆盖）、`compass`（HUD 与 `120×48` MODE 键在 `[84,396]`，360×360 表盘为 R=162 圆形刻度）。
- **满幅玩法画布误报或玩法坐标被 `tests/` 硬锁（6 个）**：`mario`（HUD/三键 100×48 已在安全区，480×352 场景为已知满幅误报）、`golf`（HUD 已在安全区，480×420 球场由 `tests/golf.js` 锁定）、`fishtank`（无 HUD/无按钮的纯 480×480 观赏画布）、`invaders`（HUD 已在安全区，`tests/invaders.js` 硬锁 `480-16` / `CELL_H=44` / `y=430`）、`frogger`（HUD 已在安全区，`tests/frogger.js` 硬锁 `CELL=33, GX=25, GY=44`）、`minesweeper`（HUD 与 `92×48` RESTART 键已在安全区，`CELL=38/GX=41/GY=64` 为 `tests/minesweeper.js` 锚点）。

## 2. 改动前/后坐标对照表（实测 dump，非抄简报）

安全方块为 480 圆屏的 `[75, 405]`；区间写作 `[absX起点..absX终点, absY起点..absY终点]`。

### 2.1 `games_breakout`

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 玩法画布 `scene`（2） | `x=48 y=91 w=384 h=350` → `[48..432, 91..441]` | `x=84 y=106 w=312 h=244` → `[84..396, 106..350]` |
| 砖块首行首列（3） | `x=68 y=113 w=54 h=22` → `[68..122, 113..135]` | `x=92 y=118 w=46 h=18` → `[92..138, 118..136]` |
| 砖块首行末列（8） | `x=358 y=113 w=54 h=22` → `[358..412, 113..135]` | `x=342 y=118 w=46 h=18` → `[342..388, 118..136]` |
| 砖块末行末列（38） | `x=358 y=248 w=54 h=22` → `[358..412, 248..270]` | `x=342 y=228 w=46 h=18` → `[342..388, 228..246]` |
| 挡板（Canvas 内 `BH-25`） | 屏幕 `y=416..426`，`x∈[48..432]`（出圆） | 屏幕 `y=325..335`，`x∈[84..396]`（全安全区） |
| 标题 `BREAKOUT`（39） | `x=84 y=76` | `x=84 y=78`（位于画布上方无重叠） |
| 计分行（40） | `x=84 y=356 w=312`（压在画布 `91..441` 内） | `x=84 y=356 w=312`（位于画布 `106..350` 下方，无重叠） |
| 提示行（41） | `x=84 y=382 w=312`（压在画布内） | `x=84 y=380 w=312`（`380..396 ⊂ [75,405]`） |

- `placePaddle(x)` 同步把水平偏移从 `48` 改为 `84`，与画布左缘对齐；`tests/games.js` 全部物理断言原样通过。

### 2.2 `files`

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 虚拟列表 `List`（7） | `loc(4,56) 320×204` → `[80..400, 132..336]` | `loc(4,54) 320×212` → `[80..400, 130..342]` |
| 列表行容器（28, 31） | `w=300 h=48`（`ROW_H=48`） | `w=300 h=52`（`ROW_H=52`） |
| 行内 `DEL` 按钮（27, 30） | `w=44 h=34 r=8 [PRESS]`（触区不达标） | `w=48 h=48 r=8 [PRESS]`（达标） |
| 底部操作栏容器（12） | `loc(4,264) 320×58` → `[80..400, 340..398]` | `loc(4,272) 320×52` → `[80..400, 348..400]` |
| 底部 `NEW` / `VIEW` / `DEL`（9, 10, 11） | `h=44 [PRESS]`（高度 `<48`） | `h=48 [PRESS]`；`DEL` 增加 `marginLeft: 16`（与 `VIEW` 总距 `8+16=24px`） |

### 2.3 `image_gallery`

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 2×2 卡片行 0（2, 4） | `y=38 h=112` → `abs y=[114..226]` | `y=36 h=110` → `abs y=[112..222]` |
| 2×2 卡片行 1（6, 8） | `y=158 h=112` → `abs y=[234..346]` | `y=154 h=110` → `abs y=[230..340]` |
| 底部翻页条（15） | `loc(4,280) 320×44` → `[80..400, 356..400]` | `loc(4,272) 320×52` → `[80..400, 348..400]` |
| 翻页键 `<` / `>`（12, 14） | `w=48 h=34 r=9 [PRESS]`（高度 `<48`） | `w=48 h=48 r=10 [PRESS]`（达标） |

### 2.4 `crypto_check`

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 标题 `Crypto Check`（2） | `loc(4,4) 204×28` → `[80..284, 80..108]` | `loc(4,10) 204×28` → `[80..284, 86..114]` |
| `NEXT` 按钮（3） | `loc(224,0) 100×36 r=18 [PRESS]` → `[300..400, 76..112]` | `loc(224,0) 100×48 r=12 [PRESS]` → `[300..400, 76..124]` |
| Payload 胶囊（5） | `loc(4,42) 320×34` → `[80..400, 118..152]` | `loc(4,54) 320×30` → `[80..400, 130..160]` |
| 4 张诊断卡（8, 11, 14, 17） | `y=82/142/202/262`，`h=54/54/54/60` → `abs y=[158..398]` | `y=90/150/210/270`，`h=54×4` → `abs y=[166..400]` |

### 2.5 `archive_view`

| 元素（node） | 改动前（实测） | 改动后（实测） |
|---|---|---|
| 标题 `Archive Viewer`（2） | `loc(4,4) 210×28` → `[80..290, 80..108]` | `loc(4,10) 210×28` → `[80..290, 86..114]` |
| `NEXT` 按钮（3） | `loc(224,0) 100×36 r=18 [PRESS]` → `[300..400, 76..112]` | `loc(224,0) 100×48 r=12 [PRESS]` → `[300..400, 76..124]` |
| Pager 胶囊（5） | `loc(4,42) 320×34` → `[80..400, 118..152]` | `loc(4,54) 320×30` → `[80..400, 130..160]` |
| 内容卡片（7）与文本（6） | `loc(4,82) 320×134`（文本 `300×114`）→ `abs y=[158..292]` | `loc(4,90) 320×126`（文本 `300×106`）→ `abs y=[166..292]` |
| 字节/压缩率行（12）与状态行（15） | `abs y=[298..346]` / `[352..400]` | **不变**（已在 `[80..400, 298..400]`） |

## 3. DESIGN-TOKENS.md §0 八条红线逐条自查

| # | 红线 | 自查结果 |
|---|---|---|
| 1 | 圆屏安全区 `[75, 405]` | **通过**：5 个改动 app 的全部可交互元素、关键文本与玩法区域实测均落在 `[76..404]` / `[84..396] ⊂ [75, 405]`（480×480 root 与 452×452 圆形表圈为装饰性底层，红线 1 允许）；post-audit 脚本校验违规数 = **0**。 |
| 2 | 卡片圆角 ≤12px | **通过**：5 个 app 内所有卡片圆角均为 `3 / 8 / 10 / 12`；`crypto_check` 与 `archive_view` 的 `NEXT` 按钮由 `r=18` 收口为 `r=12`；无 >12 非表圈圆角。 |
| 3 | 触控目标 ≥48×48 | **通过**：`files` 行 `DEL` `48×48`、底部 `NEW/VIEW/DEL` 高 `48`、`image_gallery` `<` / `>` `48×48`、`crypto_check` `NEXT` `100×48`、`archive_view` `NEXT` `100×48`；`games_breakout` 整屏拖动/点击控制挡板。 |
| 4 | 对比度 ≥4.5:1 / 大字 ≥3:1 | **通过**：完全沿用既有 primitive 深色 AMOLED 配色（`#F2F7FB`/`#40D8B0`/`#FF6B79` on `#09101A`/`#16202E`/`#2A1720`），未新增配色对。 |
| 5 | 无信息冗余 | **通过**：各 app 状态与数据展示各司其职，本轮未新增任何重复控件或文案。 |
| 6 | 状态机驱动按钮 | **通过**：各 app 既有按钮语义与状态反馈（`files` 二次 Dialog 确认删除、`games_breakout` gameover 点击重开、`NEXT` 循环）保持不变。 |
| 7 | 危险操作隔离 | **通过**：`files` 底部 `DEL` 使用独立 danger 配色（`#2A1720` 底 / `#7A3240` 框 / `#FF6B79` 字），本轮新增 `marginLeft: 16`（与 `VIEW` 总距 `24px`），且删除操作均走 `shell.Dialog` 二次确认。 |
| 8 | 禁止字母占位图标 | **通过**：`files` 列表行沿用既有 SVG 图标（`SVG_SD`/`SVG_DIR`/`SVG_FILE`），其余按钮均为清晰操作词或方向符（`<`/`>`/`NEXT`/`NEW`/`VIEW`/`DEL`），无 A-Z 占位图标。 |

## 4. 验证证据汇总（原始输出见 `artifacts/r215/`）

| artifact | 结果 |
|---|---|
| `selection.txt` | 26 个候选全量实证选刀结果（5 选 + 21 落选逐项理由） |
| `geometry-before.txt` / `geometry-after.txt` | 改前/改后同一脚本 `geometry_dump.js` 实测绝对坐标与尺寸对照；改后违规数 **0** |
| `full-regression-before.txt` / `full-regression-after.txt` | `for t in tests/*.js` 全量回归改前、改后均 **0 FAIL**，末尾 `REGRESSION DONE` |
| `check-games_breakout.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 4424 bytes） |
| `check-files.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 37854 bytes） |
| `check-image_gallery.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 5486 bytes） |
| `check-crypto_check.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 3393 bytes） |
| `check-archive_view.txt` | `RESULT: PASS (4 steps, 0 failed; exit 0)`（bundle 4508 bytes） |
| `playground-manifest.txt` | `PASS playground manifest 74 apps match generated sources and examples; removal/addition mutation caught` |
| `check-website.txt` | `examples.html gallery up to date (74 cards)`；`API missing/invented/duplicates/not found: none` |
| `ascii.txt` | 5 个改动 `app.js` 的 `grep -cPn '[^\x00-\x7F]'` 全部 = **0** |

- 全量回归全部通过且 **零修改** `tests/`、`runtime/`、`firmware/`、`tools/`。
- `--no-emu` 按 CLI 设计跳过 eval/layout/perf；布局合规结论来自 `prelude_runner` 实测坐标 dump 与宿主 harness，不冒充仿真器截图或真机验收。

## 5. 偏离与遗留登记

- **`dashboard` tab 行与 SYSTEM 画布坐标（deferred）**：见 §1.2。实测 tab 按钮（`y=400..456`）与 `SYSTEM` 画布文字确有真实出界，但因 `tests/ota_consumers.js` 第 178 行硬断言 `systemStaticLines()` 的 `82 + i * 30` 固定 30px 行距，330px 安全区高度下无法同时容纳 10 行×30px 与 48px tab 行而不遮挡 `OTA` 行；按本轮禁止改 `tests/` 断言红线，未硬改、已明确登记为后续专项（需同 PR 放宽/同步 `tests/ota_consumers.js`）。
- **`invaders` / `frogger` / `minesweeper` 玩法网格坐标（deferred）**：三者 HUD 与按钮均已在安全区内，但底层玩法画布边界仍被各自宿主测试硬锚定（`tests/invaders.js`、`tests/frogger.js`、`tests/minesweeper.js`），若需将玩法区一并缩进安全方块需另立项同步调整对应测试。
- **生成镜像同步**：按 r214 `e9606d5` 先例同步 `website/playground/sources/{games_breakout,files,image_gallery,crypto_check,archive_view}.js` 与 `website/playground/sources.js`，manifest 保持 **74** 个 app 不变，未动 website HTML/CSS/生成器。
- **未做**：未新建 harness、未改 `firmware/`/`runtime/`/`prelude`/`tools/`/`tests/`/`.d.ts`、未跑 `idf.py build`、未 push。

## 6. 诚实口径

所有结论仅由宿主 harness、`prelude_runner` 坐标 dump 与 esbuild bundle 支撑。480×480 圆屏上的实际视觉观感、手指触控手感、游戏游玩节奏与像素渲染效果均**未做真机验证**，deferred 到 board bring-up；本报告不构成硬件验收。

## 7. 提交拆分

- `0142a24` `feat(games_breakout): fit playfield, bricks and paddle inside round safe square`
- `ff1e2cf` `feat(files): raise row and action buttons to 48px and isolate danger DEL`
- `b2654cb` `feat(image_gallery): raise pagination buttons to 48x48 inside safe square`
- `99c13d5` `feat(crypto_check): raise NEXT button to 48px with radius 12 inside safe square`
- `497a8ad` `feat(archive_view): raise NEXT button to 48px with radius 12 inside safe square`
- `034fc8e` `chore(playground): re-sync generated source mirrors and sources.js for r215 batch7`
- `4e08bae` `chore(artifacts): record r215 selection, geometry, regression, check and ASCII evidence`
- 本报告 `docs/r215-report.md` 单独 commit；未 push。
