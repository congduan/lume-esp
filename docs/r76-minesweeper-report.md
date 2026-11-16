# r76 — Minesweeper 扫雷（examples/minesweeper）

日期：2026-11-17。基线 HEAD：`18fdd9a`（docs(r75): memory match report; roadmap P1 marked landed）。

## 派发与接管记录

- r76 简报（examples/minesweeper，P1 经典 app 复刻批次第二刀）于 03:11 派发
  codebuddy 后，进程存活但累计 CPU 仅 3+9 jiffies（0.0%），log 末尾为
  **HTTP 429 `您的使用量已超出频率限制，将在 2026-11-17 18:17:07 UTC+8 重置`**
  + `CBC_EXIT=0`——quota_token_limit 限流零产出，与 r75 死法相同（同一额度
  窗口，重置时间一致）。剩余进程为 bash 空壳 + 20s sleep 循环（r64 已知的
  中毒特征），已 kill。**零 commit、零半成品**（examples/minesweeper/ 不存在，
  工作树除已知 artifacts/emu 噪声外干净，HEAD=origin/main）。
- 按红线纪律未切换任何模型（hy4std/deepseek 等全部禁止），主控接管实施。
- 本刀为**纯 app 层**：未动 `firmware/`、未动 vendored 组件、未动 prelude/bridge。

## 实现

`examples/minesweeper/app.js`（10x10 = 100 格，15 雷）：

- **渲染**：r68 retro pixel dialect——硬边 fillRect（无 AA）。数字 1-8 为
  5x7 像素字形、旗/雷为 7x7 像素原创图案（雷体银灰 + 高光点；旗面红 +
  杆柱卡其，无任何第三方素材），全部按 run-length spans 预计算
  （`spanBuilds=10` 稳定计数），eval 时解码一次、每帧回放。数字墨色字符
  = 各自 palette 键（'1'..'8' 各自颜色，经典扫雷配色惯例的像素化）。
- **玩法**：tap 翻开（flood fill 走显式栈，无递归，QuickJS 深度预算不动）；
  长按插旗（`lume.gesture.on(root,'longpress',…)`；GestureEvent 有 x/y，
  实证自 `runtime/types/lume.d.ts` L987-996）；旗格不可翻开、不被 flood
  自动掀开、不参与胜利判定；踩雷 = 失败（全雷揭晓，踩中格带标记）；翻开
  全部 85 个非雷格 = 胜利（旗 irrelevant）。RESTART 重新布雷。
- **首击安全**：mines/counts 在首击后才布雷——首击格 + 8 邻域排除雷区，
  Fisher-Yates 洗牌可注入 rnd（harness 用种子验证确定性）。
- **计分**：1 Hz 计时（`lume.system.setInterval`，只在 started && !over 时
  走表）；最优（最低）时间走 `lume.storage.kv`，key `hisc.mine`（9 字符 <
  NVS 15 上限）；策略严格更低才覆盖。
- **布局**：CELL=38 GAP=2 GX=41 GY=64，网格 398x398，右缘 439、底缘 462
  在屏内；网格顶（64）与 BEST 行（y=48，14px 行高约至 62）不重叠——初版
  GY=54 压住 BEST 行，emu 截图视觉复检发现后下移 10px 并加了 harness
  断言锁死。HUD（FLAGS/TIME）+ RESTART 按钮（右上 384,6）。
  **单 canvas 480x480 = 230,400 px 恰满预算**（r64 红线）。UI 文案纯 ASCII
  （r64 字形教训）。
- **已知取舍（登记 KNOWN-SIMPLIFICATIONS r76）**：无双击 chord（以数字格
  快速翻周围）、无雷数动态上限调整、无 unsafe-flag 标记；圆屏四角遮挡
  （网格四角/RESTART 外缘超出内切圆半径）为 examples 先例口径——memory/
  sokoban 同样如此，真机可视性 deferred board acceptance。

## 验证（原始输出摘录）

- `node tests/minesweeper.js`：**15 例全 PASS**（布雷正确性/首击 3x3 安全/
  邻雷计数含边角/flood 连通区/旗交互三向/踩雷揭晓/胜利+KV/最优时间三策
  /tick 门控/spans 完整性/画布预算/20 板可解性），末行
  `ALL tests/minesweeper.js PASS`。
- `node tools/lume/lume.js check examples/minesweeper`：
  `[PASS] bundle 6398 bytes` / `[PASS] eval 2x "app eval ok; entering event
  loop"` / `RESULT: PASS (4 steps, 0 failed; exit 0)`；
  截图 `artifacts/check/minesweeper/tft.png` 首屏 = 全卡背 10x10 网格 +
  MINESWEEPER/FLAGS 15/TIME 000 + 提示行 + BEST - + RESTART，布局复检无
  重叠无裁切。
- 回归：`tests/memory.js` / `tests/sokoban.js` / `tests/invaders.js` 全 PASS；
  `npm test --prefix tools/lume` = `# pass 44 / # fail 0 / # skipped 0`。
- Playground：`node tools/playground/build.mjs` = `PASS prelude 65210 bytes;
  29 apps`，`website/playground/apps/minesweeper.js` 已生成；
  `tools/playground/verify.mjs` 需 PLAYWRIGHT_MODULE（本机未配置），如实
  说明未跑。

## Pending board

- 真机触摸手感（长按阈值 350ms 是否顺手）、圆屏四角可视性、1 Hz 计时
  精度、NVS 持久化实况——deferred board acceptance（用户接板后做）。
