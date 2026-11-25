# r75 — Memory Match 记忆翻牌（examples/memory）

日期：2026-11-17。基线 HEAD：`f0b5640`（docs(r74): real-firmware-in-browser report）。

## 派发与接管记录

- 上轮 codebuddy（r75 简报派发）于 02:03:18 启动后 355ms 即死于 **HTTP 429
  quota_token_limit**（重置时间 2026-11-17 18:17 UTC+8），trace `totalTokens=0`，
  进程残留为 `do_wait` 空壳 + model-audit sleep 循环，**零产出**（无
  `examples/memory/`，近 70 分钟无文件改动）。按纪律未切换任何模型，主控接管实施。
- 空壳进程已 kill。本刀为**纯 app 层**，无固件改动。

## 实现

`examples/memory/app.js`（4x4 = 8 对，配对翻牌）：

- **渲染**：r68 retro pixel dialect——硬边 fillRect（无 AA），8 张原创 8x8 像素
  面（berry/sun/cloud/leaf/heart/star/bolt/ring）按 run-length spans 预计算
  （`spanBuilds=8` 稳定计数），eval 时解码一次、每帧回放。卡背为卡其面 +
  军绿边框 + 齿状刻痕原创花纹。无任何第三方素材。
- **玩法**：tap 翻牌 → 两张比对 → 配对消隐（deck 置 -1）/ 未配对回扣
  （flipTimer=2 帧计数回扣，无 setTimeout 依赖；miss 期间第三张翻牌被拒）。
  计分 = 步数（两张翻动 = 1 步）；最优纪录（最少步）走 `lume.storage.kv`，
  key `hisc.memory`（11 字符，< NVS 15 上限）；策略为严格更少才覆盖。
  胜利判定 matched==8 + DEAL 重开重洗。
- **布局**：CELL=88 GAP=8 GX=64 GY=44，网格右缘 440、底缘 420 < 按钮行 y=424
  （harness 锁定）。**单 canvas 480x480 = 230,400 px 恰好全预算**（r64 红线）。
  UI 文案纯 ASCII（r64 字形教训）。miss 回扣只触发一次全网格区重绘
  （376x376 脏区，约 61% 全帧；配对消隐只重画对应格）。
- **简化（登记 KNOWN-SIMPLIFICATIONS r75）**：无翻牌 tween 动画（瞬移式翻面 +
  回扣，r68 同款口径）；无音效；回扣延迟用帧计数（150ms tick × 2 ≈ 300ms），
  非精确 setTimeout。

## 验证（主控独立跑，全部原始输出；无真机，host/esp32sim 口径）

```
$ node tests/memory.js          # 12 用例（含负向：重复翻同一张、三张连翻保护、越界/已消隐/胜利后）
PASS memory deal: 16 cards, 8 faces x2
PASS memory shuffle: deterministic under injected rnd, true permutation
PASS memory single flip: one-open, moves not yet counted
PASS memory match: pair removed, counter advanced
PASS memory miss: face-up window, flipback on tick, cards stay in play
PASS memory negative: no double-flip, no third-card flip
PASS memory negative: range/matched/won guards
PASS memory full game: 8-pair clear, WIN event, best=8 saved
PASS memory best: worse keeps / fewer overwrites / equal keeps
PASS memory spans: 8 faces decoded, palette refs all valid
PASS memory canvas budget: 230400 px single canvas, grid in bounds
PASS memory solvability: 20 random deals all contain exactly 8 pairs
ALL tests/memory.js PASS          (EXIT=0)

$ node tools/lume/lume.js check examples/memory
[PASS] bundle   5574 bytes (18 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for memory
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)

$ node tools/playground/build.mjs     # 28 apps（新增 memory）
PASS bundle memory 5574 bytes
PASS esbuild-wasm assets and 28 editable sources
PASS prelude 65210 bytes; 28 apps

回归：tests/sokoban.js / invaders.js / frogger.js / shell_components.js 全 PASS；
npm test --prefix tools/lume → # tests 44 # pass 44 # fail 0。
gen_api_docs.py --check → api.html is up to date with lume.d.ts (119 entries)。
check_website.py → "run.html: missing canonical"（基线 HEAD 干净树同样报，非本轮引入）。

截图：artifacts/check/memory/tft.png（emu 真渲染管线）：4x4 卡背网格 + MEMORY
标题 + MV/PAIRS/BEST HUD + DEAL 按钮，无越界无错乱（vision 逐项核对通过）。
```

## 未决（pending board，照例）

真机触控手感、回扣节奏、KV 持久化掉电验证留接板轮。playground browser 端
verify.mjs 未跑（需 PLAYWRIGHT_MODULE 环境变量指定模块路径，本机未配置），
已如实标注，不伪造。
