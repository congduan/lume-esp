# r229 报告：playground 圆屏切换为原生 466×466 `__lumeScreen`（纯 website/tools 层）

## 0. 基线、事实核查与诚实口径

- **基线**：`origin/main 6de2bad`（2026-11-28，r228 已推送），worktree `/tmp/lume-r229-wt`，分支 `r229-native466-playground`。开工时 `git status --short` 为空。
- **实证先行**：先跑改动前的 `verify.mjs`（16 项旧断言）与几何探针，不凭简报数字写断言。`artifacts/r229/baseline-verify.log` 退出码 0；`artifacts/r229/baseline-geometry.txt`：
  ```
  SQUARE {"shape":"square","wrapWidth":480,"deviceWidth":"480px","deviceHeight":"480px","transform":"matrix(1, 0, 0, 1, 0, 0)","safeInset":"auto","appCount":74}
  ROUND  {"shape":"round","wrapWidth":466,"deviceWidth":"480px","deviceHeight":"480px","transform":"matrix(0.970833, 0, 0, 0.970833, 0, 0)","safeInset":"auto","appCount":74}
  ```
  即 r226 §2.2 所述旧口径确实为「480 画布 × `scale(466/480)` 映射进 466 圆框」，不是原生 466。
- **前置条件核实**：r227（29 个 app 的 `__A_*` 自适应 shim，466/480 双审计均 `ok=74 fail=0`）与 r228（watchface 双线预算收敛）已兑现 r226 留下的「未来条件」。本轮不重复诊断、不改 app 与 prelude。
- **生成管线实证**：先读 `tools/playground/build.mjs` 全文：它只生成 `prelude.js` / `apps/*` / `sources/*` / `sources.js` / `vendor/*`，**不读也不写 `page.js`、`verify.mjs`、`index.html`、`playground.css`**。故本轮两处源文件改动无需重建产物；实际二次构建仍证实零字节漂移（§4）。
- **口径**：全部证据为宿主机 Playwright 浏览器 / 宿主测试 / 构建产物，**无真机**；`firmware/`、`runtime/`、prelude、`examples/*/app.js`、`tools/lume/` 零 diff，未跑 `idf.py build`。

## 1. 实现（feat `80e21af` / test `4f803d1`，拆 commit）

### 1.1 `website/playground/page.js`

- `logicalScreen` 从固定 `{ w: 480, h: 480 }` 改为随形状取值的状态：`round -> { w: 466, h: 466 }`，`square -> { w: 480, h: 480 }`，在 `setShape()` 内于 `resize()` 与重启之前更新。r226 已把 `resize()` / `dispatch()` / `startScript()` 统一到该状态，本轮只改状态的取值，**三处读取点零改动**。
- `resize()` 同时把 `#device` 的宽高设为 `logicalScreen.w/h` px（466 画布对 466 视口），缩放因子保持 `wrap.clientWidth / logicalScreen.w`：在 466 原生视口下正好等于 **1**，不再是 `466/480`；该因子只剩「窄视口响应式适配」用途（如手机宽度 <466 时等比缩小）。
- `startScript()` 传给 `LumePlaygroundSession` 的 `screen` 随之变为原生 466；`runtime.js` 的 `{ w, h }` 参数化 API（r226 落地）保持不变，不伪造 `__lumeScreen`。
- 切换形状重启当前 app 的行为原样保留（`setShape(..., { restart: true })` 分支未动）；安全区开关、语言、编辑器、分享链路未动。
- 改动后几何（`artifacts/r229/after-page-geometry.txt`）：
  ```
  ROUND  {"shape":"round","wrapWidth":466,"deviceWidth":"466px","deviceHeight":"466px","transform":"matrix(1, 0, 0, 1, 0, 0)","safeInset":"auto","appCount":74}
  ```

### 1.2 `tools/playground/verify.mjs`

- **新增断言 A — 真注入、非映射**（`round mode runs the live app at native 466x466`）：在点击 `watchface` 前临时包装页面的 `LumePlaygroundSession`，截获 **page.js 自己创建的那个 app session** 的选项与返回值；断言 `options.screen == {466,466}`、返回 session 的 `screen == {466,466}`；再用同一 `screen` 创建一个探测 session，令脚本输出 `__lumeScreen.w x h`，断言得到 `LIVE:466x466`；同时断言 `#device` 为 `466px × 466px` 且 transform 为单位矩阵。断言结束恢复原函数，不影响后续用例。
- **新增断言 B — 全量原生 466 加载**（`all 74 examples load at native 466 without runtime errors`）：逐个点击 74 个 app 后强制切到圆屏，断言圆屏类生效、有非空 DOM、无 `#error`、无 `pageerror`。**选择「新增独立用例」而非改写原 `all examples load without runtime errors`**：后者 verbatim 保留，`480/auto` 形态 74/74 守卫不丢，两条口径并存；代价是 74 次额外点击（实测整轮 verify 仍在时限内）。
- 现有断言无一依赖 `scale(466/480)` 映射行为，故**未删除或修改任何守卫**；`abc123` 等触摸坐标用例均为方屏 app，原生 466 不改变其坐标期望。

## 2. 安全区参考线口径

- CSS `.device-wrap.round.show-safe::after { inset: 15.625% }` 未改。实测 `inset = 72.8125px`（`artifacts/r229/screenshots.log`）：`466 × 15.625% = 72.8125`，内切区 `[72.8125, 393.1875]` / `320.375px`，占屏幕 `68.75%`，与 480 口径的 `[75,405]` / `330px`（同样 `68.75%`）**比例完全等价**，无需硬凑。
- 对 r227 已迁移的 29 个 app：其 480 逻辑坐标按 `466/480` 缩放，`[75,405]` 正好落到 `[72.8125,393.1875]`，与参考线逐像素对齐。
- 对未迁移且仍以 `(240,240)` / `[75,405]` 硬编码的 11 个圆屏 app（r227「未动清单」）：原生 466 下其圆心相对屏幕中心 `(233,233)` 偏移约 `+7px,+7px`，其 `[75,405]` 元素相对参考线左/上外移 `2.19px`、右/下外移 `11.81px`。本轮按 red line 不动 app 源码，差异如实登记于 `KNOWN-SIMPLIFICATIONS.md`；抽样截图 `files` 未见明显裁切（见 §4 截图）。

## 3. 与映射口径的差异（诚实边界）

- 原生 466 下 `__lumeScreen = {466,466}`，app 真实可用画布变小 14px；r227 的 shim 按 `SW/480` 等比缩放几何，故迁移过的 app 在最终像素位置上的预期与旧映射模式一致（**未做逐像素 A/B**，仅为坐标推导，不宣称实测等价）。
- `watchface` 左上角 `LUME / DIGITAL` 标签左端被圆弧裁切是 r226 §3 已登记的存量 app 布局问题（`artifacts/r226/shots/02-watchface-round.png` 可见），本轮原生 466 截图仍可见同类裁切（`artifacts/r229/shots/watchface-round-466.png`），**非本轮引入**；红线禁止改 `examples/watchface/app.js`，故不修、不掩饰。
- 浏览器截图不构成真机验收：CO5300 圆屏显示、触摸手感、帧率、PSRAM 峰值、功耗均 deferred。

## 4. 验证（原始输出见 `artifacts/r229/`）

1. **改动前基线**：`artifacts/r229/baseline-verify.log`（`BASELINE_EXIT=0`，旧断言全 PASS）、`baseline-geometry.txt`（上引）。
2. **`verify.mjs` 全 PASS**（`artifacts/r229/verify.log`，`VERIFY_EXIT=0`，18/18 项）：
   ```
   PASS round mode runs the live app at native 466x466 (no 466/480 mapping)
     live session screen={"w":466,"h":466}, __lumeScreen=LIVE:466x466, device=466px transform=matrix(1, 0, 0, 1, 0, 0)
   PASS all 74 examples load without runtime errors
   PASS all 74 examples load at native 466 without runtime errors
   ```
   旧守卫 `runtime.js honors custom 466x466 __lumeScreen option` 等全部保留并通过。
3. **`build.mjs` 幂等**（`build-first.log` / `build-second.log` / `build-status.txt`，两次退出码均 0）：
   ```
   PASS esbuild-wasm assets and 74 editable sources
   PASS prelude 68299 bytes; 74 apps
   STATUS_AFTER_FIRST:
   ?? artifacts/r229/
   STATUS_AFTER_SECOND:
   ?? artifacts/r229/
   TRACKED_STATUS_AFTER_FIRST=[]
   TRACKED_STATUS_AFTER_SECOND=[]
   ```
   唯一未跟踪项是证据目录本身；无已跟踪文件改动，`page.js` 不属于生成管线输入。
4. **全量回归**（`tests-loop.log`）：`TESTS_TOTAL=112`，`FAILS:` 后为空（0 FAIL）。
5. **`npm test --prefix tools/lume`**（`npm-test.log`，退出码 0）末行：
   ```
   1..87
   # tests 87
   # pass 87
   # fail 0
   ```
6. **`python3 scripts/check_website.py`**（`website-check.log`，退出码 0）：
   ```
   API missing: none
   API invented: none
   API duplicates: none
   API signatures not found in lume.d.ts: none
   ```
7. **Playwright 圆屏截图**（`screenshots.log` + `shots/`）：`watchface-round-466.png`、`clock_round-round-466.png`、`clock-round-safe-466.png`、`files-round-466.png`；每张均记录 `round=true wrap=466 device=466px transform=matrix(1,0,0,1,0,0)` 且无 `#error`。目视：`clock_round` 表盘居中无裁切，safe-guide 虚线框居中；`watchface` 仅有前述存量标签裁切。
8. **红线 diff**（`diff-probe.txt`）：`git diff origin/main -- firmware/ runtime/ tools/lume/` 输出 `DIFF_BYTES=0`；未跑 `idf.py build`。

## 5. 未验收项

- 真机 CO5300 466 圆屏视觉、触控映射（原生坐标下的命中精度）、帧率与 PSRAM 峰值。
- 原生 466 与旧 `466/480` 映射模式在迁移 app 上的逐像素等价（仅有坐标推导，无像素 A/B）。
- 未迁移圆屏 app 的 `+7px` 锚点偏移是否需要后续专刀修正（本轮按红线未动 app）。
- ASCII 纪律：新增 UI 字面量 0 个；本轮仅注释/测试字符串为 ASCII，`data-zh` 文案未动。

## 6. 提交拆分

- `80e21af feat(playground): inject native 466x466 screen in round mode`
- `4f803d1 test(playground): assert native 466 session and all-74 round load`
- docs + `artifacts/r229/` 证据单独提交。
