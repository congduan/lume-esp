# r70 战报 — 幼儿字母数字学习卡（examples/abc123）

分支 `r70-abc`，worktree `/tmp/lume-r70-wt`，基线 `origin/main` HEAD
`7cc8cfad1bef0294da7404867b7612b11189c067`（开工前 `git fetch` 确认未变）。
改动面收敛在 `examples/abc123/`、`tests/abc123.js`、playground 四处及其生成产物、
README / roadmap / KNOWN-SIMPLIFICATIONS / 本战报。
**未推送**。固件 C / prelude 字符串 / bridge ABI / 帧协议 / `.d.ts` / vendored 均未改。

## 0. 开工前实证（假设先验证）

- 读 `runtime/types/lume.d.ts:54-57`、`lume_scripts.c:660-674`、`lume_ui_bridge.c:659-667`：
  **Text `fontSize` 被桥梁 snap 到 14/20/32 三档，渲染上限 32 px**（即便传 200 也落到 32），
  480 高屏的 ≥60%（~290 px）单字巨幕根本做不到。
- 读 `examples/counter`（最简结构）、`examples/calculator:115-155`（七段数码管先例）、
  `tests/frogger.js` / `tests/lib/prelude_runner.js`（逻辑切分 + 注入手势）、
  `tools/playground/{build,verify}.mjs`、`website/playground/{page.js,index.html,renderer.js}`、
  `tools/emu/{run.sh,prepare.mjs,README.md}` 与 `esp32sim` 脚本动作格式。
- 实测 `ctx.circle` 在 r47 之后是**描边环**（`lume_ui_bridge.c:962-966` 的 `lume_raster_ring`），
  不是实心圆；数字圆点改用整圆扫 `ctx.arc(...,r+2,...)` 的空腔闭合退化得到实心点（见 §4）。

**停下条款核对：未触发。** 字号上限（32 < 48）确实坐实，但 Canvas 矢量方案只用
`fillRect` / 粗笔画 `polyline` / 七段 rect / 整圆 `arc` 等手授权点路径，**不需要真字体轮廓解析、
不引字体解析器**；emoji 方案从一开始就不用（字体无 emoji），图标一律 Canvas 手绘，emu 无 tofu。
两条停刀条件都不成立。

## 1. 渲染方案（最大技术决策，写进 app.js 头注释）

**选定：Canvas 手绘矢量字形。**
- 数字：`ABC_SEG_RECTS` / `ABC_SEG_MAP` 七段数码管，`fillRect` 整数像素拼段，
  与 `examples/calculator` 同一抽象，视觉统一且是「学习写法」的正确抽象。
- 字母：`ABC_UPPER`（26 × 手授 polyline，100×140 归一化盒）与 `ABC_LOWER`
  （26 × 简化小写笔画，100×170 盒，含降部）粗笔画拼形，无字体文件、无轮廓解析。
- 单一字形高度 290 px = 屏高 **60.4%**（数字）/ 302 px = **62.9%**（字母），满足 ≥60% 红线。
- HUD / 底部文案用 20 px Text（正好 20 档），全屏无小字。

## 2. 功能与交互

- 36 张卡：`A..Z` + `0..9`，默认顺序模式（A→…→Z→0→…→9→A 循环）。
- 三模式：顺序 / 随机（Fisher-Yates 袋，抽完才重洗，保证不重复）/ 大小写对照（左右并排 A+a；
  数字无大小写，仍单七段显示）。HUD 顶条点击循环切换，**切换即重置为首卡**。
- 全屏单手势：屏幕下部任意点按 = 下一张；顶部 74 px HUD 条 = 切模式。无 exit / 无 back /
  无家长锁（锁屏归 launcher/boot，单 app 不给退出路径），幼儿乱点零误退。
- 点击同时触发一次 glyph 弹跳（`lume.anim.to` 的 y 回弹 26 px + opacity 0.45→1 闪一下），
  多感官反馈。
- 记忆辅助：数字卡按显示值画**实心圆点**（0 画 0 点）；A-E 各配一个 Canvas 极简图标
  （Apple/Ball/Cat/Dog/Egg），全部卡底部有 `A is for Apple` / `5 is Five (5 dots)` 文案。
- 每张卡轮换 10 色高饱和底色（红/紫/蓝/青绿/绿/橙/靛/粉/蓝绿/玫红）。

## 3. 宿主 harness（10 条全绿，原始输出）

```text
PASS abc123 36-card A-Z0-9 sequence integrity
PASS abc123 sequential cycle boundaries Z->0 and 9->A
PASS abc123 number-card dot count equals digit value
PASS abc123 glyph render-plan dispatch (digit / letter / case)
PASS abc123 word/icon/stroke tables complete for all 36 cards
PASS abc123 nodes (2 canvases) + one gesture + startup event
PASS abc123 full-screen tap advances deck incl. Z->0 wrap
PASS abc123 random mode no-repeat-until-exhausted + reshuffle
PASS abc123 mode switch resets deck and cycles seq/rand/case
PASS abc123 digit dots on canvas + bounce animation on tap
ALL ABC123 HARNESS CASES PASSED
```

## 4. `node tools/lume/lume.js check examples/abc123`（原始输出）

```text
lume check examples/abc123

[PASS] bundle   7998 bytes (46 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for abc123
[SKIP] perf     profile disabled

screenshot: artifacts/check/abc123/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

## 5. emu 冒烟（esp32sim，真实固件镜像 + 注入点击）

三次独立 `actions.txt` 场景（脚本格式 `<秒> touch <x> <y> <1|0>`，2.5 s 注入 `serial-file` 帧）：
- 默认：无点击，终态 A；
- 数字：31 次屏体点击（240,300）A→5；
- 模式：2 次 HUD 点击（240,40）seq→rand→case。

串口原事件（`ABC CARD <ch> mode=<...>` / `ABC MODE <mode>`）：

```text
# 默认
I (2976) lume-engine: js: ABC CARD A mode=seq
# 数字（尾部）
I (6716) lume-engine: js: ABC CARD 2 mode=seq
I (6815) lume-engine: js: ABC CARD 3 mode=seq
I (6947) lume-engine: js: ABC CARD 4 mode=seq
I (7079) lume-engine: js: ABC CARD 5 mode=seq
# 模式
I (2976) lume-engine: js: ABC CARD A mode=seq
I (3767) lume-engine: js: ABC MODE rand
I (3768) lume-engine: js: ABC CARD 9 mode=rand
I (4855) lume-engine: js: ABC MODE case
I (4856) lume-engine: js: ABC CARD A mode=case
```

三次均 reload 干净（无 `eval failed|RELOAD ERR`），无掉帧日志；唯一 error 行是
`esp_littlefs ... Corrupted dir pair`（首挂格式化，固件既有噪声，与 app 无关）。
`EMU_SECONDS=8` 的 stop 行（默认场景）：

```text
[emu] stop: Halted — core0 150380501 + core1 62962758 insns in 6.5s wall = 33.0 Minsn/s; emulated 8.000s (1920000000 cycles); 354881 exceptions, 23213 interrupts
```

### Vision 核验（`artifacts/emu/ui-refresh/abc123*.png`）

像素实测白色字形墨迹在字形带（y=60..376）内的纵向跨度：

| 截图 | 字形 | 墨迹 y 范围 | 屏高占比 |
|---|---|---|---|
| `abc123.png` | 字母 A | 74..375 | 302 px = **62.9%** |
| `abc123-digit.png` | 七段 5 | 80..369 | 290 px = **60.4%** |
| `abc123-case.png` | A + a 并排 | 95..355 | 261 px = 54.4%（两字形各让宽，如实登记） |

- 字母 A：粗笔画 A + 横杠完整，红底高饱和，HUD `MODE: SEQUENCE - TAP TOP TO CHANGE`
  与底部 `A is for Apple` 清晰可读；底部苹果为空心环 + 绿柄简笔图标，无 tofu。
- 数字 5：七段数码管造型正确，底部**恰好 5 个实心白点**，文案 `5 is Five (5 dots)`；
  紫底高饱和。
- 大小写：左大写 A、右简化小写 a 并排，`MODE: Aa / CASE` 可读。
- 无黑块 / 补丁缝隙 / 字形出屏 / HUD 截断。

## 6. Playground 四处同步（原始输出节选）

`node tools/playground/build.mjs`：

```text
PASS bundle invaders 8945 bytes
PASS bundle frogger 8892 bytes
PASS bundle abc123 7998 bytes
PASS esbuild-wasm assets and 25 editable sources
PASS prelude 60379 bytes; 25 apps
```

`PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs`：

```text
PASS page loads without JavaScript errors
...
PASS all examples load without runtime errors
  frogger: 5 nodes
  abc123: 5 nodes
```

四处：build.mjs apps 列表（24→25）、page.js picker（新增 abc123 行）、index.html
script 标签（`apps/abc123.js`）、verify.mjs 计数 24→25；`sources.js` / `apps/abc123.js` /
`sources/abc123.js` 生成产物已纳入提交。

## 7. 回归（全部 host / 浏览器 / esp32sim，EXIT=0；无真机）

```text
JS_HARNESS_COUNT=32  JS_HARNESS_FAILURES=0      # tests/*.js 全绿（含新增 tests/abc123.js）
npm test --prefix tools/lume  # pass 43 / fail 0 / skipped 1
lume check examples/abc123    # RESULT: PASS (4 steps, 0 failed; exit 0)
playground build              # 25 apps, PASS
playground verify             # 25/25 examples load, PASS
```

## 8. 诚实登记

- **基线计数差**：简报写「r69 后 apps 数 +2」，但 `git fetch` 确认 origin/main 仍停在 r68
  （24 apps），r69 worktree 的 `examples/sokoban/` 尚未并入。本分支只加 abc123 → **25 apps**；
  两刀合并后应为 **26**，由主控合并时统一四处计数（不要把对方 app 计入各自分支造成缺文件）。
- **无语音开关**：无 TTS 固件能力（audio 只有裸 PCM / playStream / MP3 解码），登记不做。
- **无家长锁**：单 app 模式无退出误触风险，锁屏归 launcher/boot，本 app 不设任何退出路径。
- **大小写模式**：每字形 54.4% 屏高（低于单字形 ≥60%），为并排对照主动让宽；数字无大小写。
- **ctx.circle 是环**：数字圆点改走整圆扫 `arc(r+2)` 的空腔闭合退化得实心，浏览器 op5 同参兼容。
- **真机 pending**：点屏 / 色彩 / 弹跳流畅度 / HUD 可读性 / 帧率 / bundle 推送全部未验。
  host harness + `lume check` + 浏览器 verify + esp32sim 截图均 ≠ 真机验收。
- **提交拆分**：app+tests 一刀、playground 一刀、docs 一刀；均未推送。
