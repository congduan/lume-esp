# r63 — 俄罗斯方块消行后残留方块（主控派发）

- 分支：`r63-tetris-fix`，基线 `7cc8cfa`（= origin/main）
- 工作范围：只改 `examples/games_tetris/app.js`，新增 `tests/tetris_dirty.js`，本报告。未碰固件 / prelude / 其他 app。
- 提交：`57ac53f`（修复）、`ddab8d4`（测试）、本报告。未推送。

## 1. 根因（读码确认：与主控描述一致）

### 1.1 C 端语义：`canvas_publish` 的 work/front 双缓冲

`firmware/components/lume-ui-bridge/lume_ui_bridge.c:1062` 的 `canvas_publish`：

- **整屏路径**（`!m->kind`，:1067-1075）：把 work 与 front **交换**（`lv_canvas_set_buffer(obj, work,...)`、交换 `s_canvas_pixels`/`s_canvas_work`），语义前提是「本帧每个像素都已重画」，旧 front 才能安全变成下一帧 work。
- **dirty-rect 路径**（`m->kind`，:1076-1101）：**不交换**，按行把 work 的 rect 区域 `memcpy` 到 front（:1084-1091）：
  ```c
  memcpy(front + (y+row)*stride + x, work + (y+row)*stride + x, rw*sizeof(uint16_t));
  ```
  语义前提同样成立且更严格：**rect 内每个像素本帧都必须已重画**。rect 之外保持 front 原样（这正是 dirty-rect 存在的意义），rect 之内 work 是什么就上屏什么。

prelude 的 `Canvas` effect（`firmware/components/lume-engine/lume_scripts.c:1062-1074`）把 `onDraw` 返回的 `x/y/w/h` 原样发给 `lume.canvasInvalidate(id,x,y,rw,rh)`；即 **app 返回多大的 rect，C 就 memcpy 多大的区域**。C 无法知道 rect 内哪些像素真的被画过。

### 1.2 JS 端：消行帧返回了全画布 rect，却只重画 dirtyCells

`examples/games_tetris/app.js`：

- `onDraw`（:71-87）遍历 `dirtyCells` 逐格 `fillRect`，用这些格子的 bbox 算 `area = {x:minX*16, y:minY*16, w:.., h:..}`，`return [area]`（:86）。**它不会用背景色铺满整个 `area`**。
- `tetrisClear`（:42-49）`splice+unshift` 使消行点上方所有行下移，`dirtyRows` 会包含所有内容发生变化的行（往往是多行）；`refresh`（:99-104）把这些整行全部 push 进 `dirtyCells`，再加上旧 piece 格子与新 piece（出生在 row 0，:57）格子。
- 结果：消行帧的 `dirtyCells` bbox 很容易从 row 0 跨到底部、从 col 0 跨到 col 9，于是 `onDraw` 返回接近/等于全画布的 `(0,0,160,320)`。但 bbox 只是一个**矩形包络**，里面大量格子（未变化的中间行、row 0/1 出生位两侧的空格）**并不在 `dirtyCells` 里、本帧没有重画**。
- work buffer 里这些格子停留着**更早帧的 piece 痕迹**。全屏 rect 一 memcpy，陈旧像素全部上屏 → 用户看到的「残留方块」。

### 1.3 宿主复现（负面对照）

主控的宿主复现现象一致：消行后残留 `4,0 5,0 3,1 4,1 5,1`（消行前 piece 出生位置）。本次新增的 harness 在未修复代码上跑出的违规格子列表（节选）同样包含 `4,0 5,0 3,1 4,1 5,1`，并额外暴露整张中间行的残留，共 174 格违规格子（rect 200 格，实际只重画 26 格）。见 §4.3。

> 结论：主控的机制描述与代码一致，无出入，按方案修复。

## 2. 修复 diff

`examples/games_tetris/app.js:100`，一处一行：

```diff
 function refresh(old,result){mark(old);if(result&&result.dirtyRows.length){for(var j=0;j<result.dirtyRows.length;j++)for(var x=0;x<TW;x++)dirtyCells.push({x:x,y:result.dirtyRows[j]});}
-  if(result&&result.lines)pendingLine=result.lines;
+  if(result&&result.lines){pendingLine=result.lines;fullBoard=true;}
   if(!state.over)mark(tetrisCells(state.piece));boardRev.set(boardRev()+1);
```

`fullBoard=true` 让紧随其后的那次 `onDraw`（:73）走 `for(y)for(x)` 把全部 200 格都画一遍（画满 work），返回的 rect 仍是全画布，但此时 rect 内每个像素都是本帧新画的，memcpy 上屏的是完整画面，陈旧像素被覆盖。`onDraw` 在 :81 照常把 `fullBoard` 复位为 false，所以**只有消行帧整屏重画**，普通下落/旋转/平移仍是紧致 dirty rect。

## 3. 其他 Canvas app 的 rect 覆盖率排查（只列不改）

判定口径：返回 rect 覆盖的区域是否**每个像素都在本帧被重画**。若 app 在画内容前先用背景色把**整个 rect** `fillRect` 一遍，则安全（与 tetris 的区别正是缺少这一步）；若依赖「work 里的旧像素恰好没变」，则属于同款隐患——是否真机上屏残留取决于该区域旧像素是否真的恒定。

| App | 返回方式 | 是否用背景铺满整个返回 rect | 结论 |
| --- | --- | --- | --- |
| `gravity_ball` (`app.js:119-124`) | 单个 union rect | 是（`fillRect(area)` BG，:120-121） | 安全 |
| `game_of_life` (`app.js:169-175`) | 单个 changed-box rect | 是（`fillRect(area)` BG，:171） | 安全 |
| `pet` (`app.js:305-315`) | 单个 tight box | 是（`fillRect(area)` BG，:312） | 安全 |
| `speedometer` (`app.js:107-113`) | 1–2 个 needle box | 是（逐 area `fillRect` DIAL_BG，:108-111） | 安全 |
| `mario` (`app.js:51-53`) | 多个 area | 是（`staticScene` 先 `fillRect(SKY, area)`，:35） | 安全 |
| `invaders` (`app.js:104-119`) | 多个 area | 是（`drawStatic` 先 `fillRect(BG, a)`，`invaders/app.js:82`） | 安全 |
| `games_breakout` (`app.js:46-56`) | 多个 entity-trail rect | 是（每块 trail 先按 board 色 `fillRect`，再画新实体） | 安全 |
| `games_snake` (`app.js:63-76`) | 每格一个 rect；整屏帧返回 `undefined` | 是（每 dirty 格按前景/背景 `fillRect`，:71；整屏帧走 swap） | 安全 |
| `compass` (`app.js:125-142`) | 返回全画布 `{0,0,CW,CH}` | **否**（只 `fillRect(10,10,CW-20,CH-20)`，:125；外圈 10px 不重画） | **同款隐患（当前良性）**：外圈自首帧起恒为 BG，memcpy 推的是同值；若外圈内容改为动态即会出现残留。 |
| `frogger` (`app.js:178-185`) | 多条带 area（含 2px padding） | **否**（`paintRow` 只铺 `GX..GX+COLS*CELL` 的中央条，`frogger/app.js:144`；左右/上下 2px padding 不重画） | **同款隐患（当前良性）**：padding 是首帧留下的静态边距，恒定。 |
| `weather` / `heart_curve` / `clock` / `watchface` / `dashboard` / `device_monitor` / `calculator` | 不返回 dirty rect（`ctx.clear()` 或默认 `undefined` → 整屏 swap） | 不适用 | 安全（走整屏路径，语义自洽） |
| `games_tetris` | 单个 bbox rect | **否**（本次修复前） | **已确认 bug，本报告修复**（消行帧强制整屏重画）。 |

> 给后续维护的提示：新增「返回 dirty rect 但只画部分格子」的 Canvas app 时，务必让 rect 内每个像素本帧都被覆盖（先铺背景再画内容，或像修复后的 tetris 那样整屏重画），否则就会复现本 bug。

## 4. 验证（原始输出）

### 4.1 `node tools/lume/lume.js check examples/games_tetris`

```
lume check examples/games_tetris

[PASS] bundle   5911 bytes (159 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for games_tetris
[SKIP] perf     profile disabled

screenshot: artifacts/check/games_tetris/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
EXIT=0
```

环境说明（非代码问题，供复现）：本 worktree 起初未装 CLI 依赖，先跑 `npm ci --prefix tools/lume`（added 30 packages，0 vulnerabilities）。`lume check` 默认会 `idf.py build` + 从源码构建 esp32sim，120s 默认超时不够；本次复用了固件源完全相同的相邻 worktree 的预编译镜像与 esp32sim（已核对 `git diff --stat 7cc8cfa 24f7590 -- firmware/` 为空，即固件源码逐字节一致），以 `EMU_BIN=/tmp/lume-r69-wt/tools/emu/.cache/bin/esp32sim` 运行，check 自动识别镜像齐全而设 `EMU_SKIP_BUILD=1`。未修改任何相邻 worktree。

### 4.2 `node tests/games.js`（既有游戏 harness 零回归）

```
===== node tests/games.js =====
PASS 2048 left
PASS 2048 right
PASS 2048 up
PASS 2048 down
PASS 2048 no change
PASS 2048 game over
PASS snake turns
PASS snake eats
PASS snake wall
PASS snake body
PASS snake IMU threshold and axis sign
PASS 2048 high score KV key
PASS snake high score KV key
PASS brkout high score KV key
PASS breakout wall rebound
PASS breakout brick
PASS breakout level
PASS breakout game over
PASS tetris clockwise wall kick
PASS tetris line clear, score and speed floor
PASS tetris lock scores cleared row
PASS tetris high score KV and graceful failure
PASS tetris canvas, tap rotation, pan follow, soft and hard drop, line log
games.js EXIT=0
```

### 4.3 `node tests/tetris_dirty.js`（新增 harness）

修复后：

```
===== node tests/tetris_dirty.js =====
PASS line-clear frame: rect=[0,0,160,320] cells=200 redrawn=200 (rect subset of redraw)
PASS normal-drop frame: rect=[80,80,32,48] cells=6 redrawn=6 (still a tight dirty rect)
ALL PASS: tetris dirty-rect coverage invariant holds
tetris_dirty.js EXIT=0
```

harness 做法：用 `prelude_runner.runApp` 跑真实 app，构造「底行填满 → 竖 I 落在 col 9 → `tick()` 锁定消行」的确定性场景，捕获该帧 scene 的 `draw` / `invalidate` 消息序列，把 `fillRect(cellX*16,cellY*16,16,16)` 视为该格已重画，断言返回的 rect 内每一格都在本帧 draw 序列中（rect ⊆ 重画集合），违规则打印格子列表。Scenario 2 再断言普通下落仍是 6 格的小 rect（防止「修复」退化成每帧全屏重画）。

负面对照（把 `app.js` 临时换回修复前版本 `HEAD~1`，跑 harness 后已还原）：

```
line-clear frame FAIL: rect [0,0,160,320] covers 200 cells but only 26 were redrawn. Violating cells (rect but not drawn):
0,0 1,0 2,0 3,0 5,0 6,0 7,0 8,0 9,0 0,1 1,1 2,1 6,1 7,1 8,1 9,1 ... 0,17 ... 0,18 ... 9,18
AssertionError [ERR_ASSERTION]: line-clear frame: returned rect must be a subset of redrawn cells
EXIT=1
```

修复前 174 格违规格子中包含主控宿主复现的 `4,0 5,0 3,1 4,1 5,1`（新 piece 出生位两侧），与真机现象吻合；修复后 0 违规格子。harness 确实能捕获该 bug。

## 5. 真机验收 pending 项（未做，不声称已验证）

本项目纪律：宿主 / emu 绿灯不等于硬件验收。以下需在板子上人工确认：

- [ ] 在 Waveshare ESP32-S3-Touch-AMOLED-2.16 上跑 `examples/games_tetris`，反复消行（单行 / 多行 / 连续消行），肉眼确认棋盘不再出现残留方块。
- [ ] 观察消行帧是否有可感知的整屏闪烁 / 掉帧（本次修复让消行帧重画 200 格，需真机确认 20fps 下是否可接受）。
- [ ] 确认普通下落 / 左右移动 / 旋转仍是局部刷新、无明显 trail（harness 已覆盖逻辑，真机手感另验）。
- [ ] 触摸（拖拽 / 点按旋转 / 下滑硬降）在消行后仍正常。
- [ ] 如真机仍有残留，优先复核 §1.2 的 bbox 语义是否还有其他返回大 rect 的路径，并复查 §3 中标为「同款隐患（当前良性）」的 `compass` / `frogger` 是否在真机上真的良性。

`python3 scripts/check_website.py` 按派发简报跳过（未动 website）。
