# r205 报告：退役 ota_consumers 过期冻结快照守卫（249 文件永久红 → 全量回归 0 FAIL）

## 0. 基线与边界

- 基线：`origin/main 5b6b022`（2026-11-27，r204 已推）；worktree `/tmp/lume-r205-wt`，分支 `r205-guard-retire`。开工时 HEAD 与 `origin/main` 均为 `5b6b022`，工作树干净。
- 改动面：`tests/ota_consumers.js`、`docs/r205-report.md`、`artifacts/r205/`、`docs/KNOWN-SIMPLIFICATIONS.md`。未动 `firmware/` / `runtime/` / `examples/` / `tools/` / `website/`；未 push；git 身份 `congduan`（仓库既有配置，未改 git config）。
- 未跑 `idf.py build`（未动 firmware/）。新增 JS 代码与注释全 ASCII；本报告沿用仓库中文报告体例。

## 1. 实证先行（改前实测，不是推测）

`node tests/ota_consumers.js` 改前输出：

- 前 18 条 PASS（含 `firmware/ runtime/ CLI tooling identical to 674684a`）；
- 第 19 条 `FAIL ... only known r132 + r133 + r134 + r135 + r136 files differ from 674684a`，`ERR_ASSERTION`，栈指 `tests/ota_consumers.js:947`，`EXIT=1`。

派发简报记录：`git diff --name-only 674684a HEAD` 共 825 个文件，其中 249 个不在白名单内（docs/archive 93、website/playground 93、artifacts 各轮、firmware/components 10、tools/gateway 4、website/wasm 4、tools/lume 3、.gitignore 1）。守卫实际 `BASE = '94f5d4e'`，断言文案仍写 `674684a` —— 文案与围栏本身都已陈旧。

对照 `must()` 区：改前 19 个 mutation 与 19 条 check 一一对应；只有 1 个 mutation 引用失败断言（`an out-of-scope file changes vs d85e69a`，旧 :1017-1019）。其余 18 个 mutation 与本次删除无关。

## 2. 删除清单与理由

| 删除项 | 旧位置 | 唯一用途 | 删除理由 |
|---|---|---|---|
| check `only known r132 + ... files differ from 674684a` | :911-943 | 全仓 diff 必须落在 `ALLOWED` / `artifacts/rNNN/` 前缀 / `R188_REMOVED` 之内 | 本是 r132-r136 单轮改动面围栏，后被历轮当作「新增文件登记处」持续追加 40+ 个 `startsWith` 前缀与数百条路径；每个 artifacts 轮都要手工加前缀，漏加即红。r203/r204 均带着它过 |
| `must('an out-of-scope file changes vs d85e69a', ...)` | :1017-1019 | 上述 check 的唯一 mutation | 随 check 一同退役；删后 mutation 数 18，仍与 18 条 check 一一对应、逐条 mutation-proven |
| `const allChanged = gitChanged([])` | :121 | 仅被上述 check + mutation 引用 | 全仓 diff 采集器，无其他消费者 |
| `R188_REMOVED`（注释 + `new Set(read('artifacts/r188/removed-files.txt')...)`） | :122-123 | 仅在上述 check 谓词尾部做「已删除文件」例外 | 只服务已退役 check，不是通用固件/runtime 防护；一并清理避免留下悬空读取 |
| `const ALLOWED = [...]`（719 行） | :124-842 | 仅被上述 check 引用 | 逐轮手工登记的流水账，会持续腐烂 |
| 头注释陈旧分句 | :17-19 | 描述 r132-r136 全仓围栏 | 改为准确描述 R166_ALLOWED 固件围栏，并指向本报告 |

**保留项逐条实证**：`BASE`（新 :30）、`gitChanged()`（新 :77）、`R166_ALLOWED`（新 :93）、`fwChanged`（新 :121）、check #18（新 :188）及其 mutation（新 :259-261）原样保留；前 18 条 check 的名字、谓词、顺序、mutation 区未改一字。diffstat：`3 insertions(+), 761 deletions(-)`。

## 3. 防护覆盖映射（逐条 → 有无真空）

| 被删检查原本保护的东西 | 现由哪些活检查覆盖 | 有无真空 |
|---|---|---|
| `firmware/` / `runtime/` / `tools/lume/` 不得越界改动 | 本文件 check #18 `fwChanged ⊆ R166_ALLOWED` + 其 mutation（firmware 文件变更必须转红）；仓库共 22 份 harness 携带 git diff 守卫，其中 14 份（含本文件）用 `gitChanged(['firmware/','runtime/','tools/lume/'])` 且全部再以 `R166_ALLOWED` 过滤做零 diff | 无 |
| playground 生成物与 app 源码漂移 | byte-identical check（`website/playground/sources/dashboard.js === examples/dashboard/app.js`）+ dashboard manifest check + 各自 mutation | 无 |
| UI 字符串 ASCII 纪律 | ASCII-only check + 注入中文 literal 的 mutation | 无 |
| `docs/` / `website/` / `examples/` / `tools/` / `artifacts/` 的文件改动登记 | git 历史、逐轮报告、各 app harness 的具体源码断言；`tools/gateway` 由 `tests/gateway*.js` 覆盖 | 不再是安全边界：原是人工登记流水账，不是行为约束 |
| 全仓「任何新增文件都必须先登记」的观测能力 | 无单一替代 | **主动放弃**：这正是本轮目标（逐轮维护型断言不可持续）。代价是失去全仓总账；firmware/runtime/CLI 的真实围栏未弱化 |

**结论**：没有行为级防护真空。唯一消失的是「全仓新增文件登记册」这种需要逐轮人工维护的观测能力，它不是安全边界，且 git 历史 + 逐轮报告已是权威来源。

## 4. 可选加固：评估后不加

考虑过「`docs/rXXX-report.md` 与 `artifacts/rXXX` 在最近 N 轮内成对出现」这类结构性断言。不加，理由：

- 需要维护滑动窗口 N 或逐轮枚举 → 本身就是新的逐轮维护项，与本轮「删掉逐轮腐烂断言」的目标相悖；
- 历轮存在合法无 artifacts 的纯 docs / 纯测试刀，会引入新 flake 并需要历史数据豁免；
- 结构性配对检查不会比 git 历史更权威。

## 5. 验证原始输出

完整日志在 `artifacts/r205/`：`ota_consumers.log`、`full-regression.log`、`npm-test.log`。

### 5.1 `node tests/ota_consumers.js`（18 check + 18 mutation，EXIT=0）

```
PASS ota_consumers: OTA helper reads lume.ota.status() locally
PASS ota_consumers: number return discriminated via typeof === object, ASCII err code
PASS ota_consumers: four flags + port rendered; .token / [token] never read in either app
PASS ota_consumers: OTA row is exactly View + Text + Button (3 nodes)
PASS ota_consumers: row Text shows only status; New-token opens a Dialog
PASS ota_consumers: setToken sits in the danger Rotate onPress of a Dialog
PASS ota_consumers: Dialog guard degrades to an ASCII note; no 3 s arm timer remains
PASS ota_consumers: replacement token is 32 lowercase hex chars from Math.random
PASS ota_consumers: setToken failure renders ASCII code; success refreshes status
PASS ota_consumers: 600 ms poll refreshes OTA status
PASS ota_consumers: header registers Math.random as NOT cryptographically secure
PASS ota_consumers: dashboard SYSTEM reads status() with typeof === object discrimination
PASS ota_consumers: dashboard publishes OTA row with 9 separators inside 360 px
PASS ota_consumers: dashboard OTA line never reads token
PASS ota_consumers: playground sources/dashboard.js byte-identical to example
PASS ota_consumers: dashboard is in the playground manifest
PASS ota_consumers: all UI string literals ASCII-only (r64)
PASS ota_consumers: firmware/ runtime/ CLI tooling identical to 674684a
PASS ota_consumers mutation: drop the lume.ota.status() read -> FAIL as expected
PASS ota_consumers mutation: truthy test replaces typeof === object discrimination -> FAIL as expected
PASS ota_consumers mutation: render the full token straight into the status text -> FAIL as expected
PASS ota_consumers mutation: drop the OTA row Text -> FAIL as expected
PASS ota_consumers mutation: New-token button no longer opens a Dialog -> FAIL as expected
PASS ota_consumers mutation: danger Rotate button downgraded -> FAIL as expected
PASS ota_consumers mutation: Dialog guard hardened (no ASCII fallback) -> FAIL as expected
PASS ota_consumers mutation: token length shrinks from 32 to 16 hex chars -> FAIL as expected
PASS ota_consumers mutation: setToken failure loses its ASCII return code -> FAIL as expected
PASS ota_consumers mutation: poll no longer refreshes OTA status -> FAIL as expected
PASS ota_consumers mutation: header drops the non-CSPRNG registration -> FAIL as expected
PASS ota_consumers mutation: dashboard truthy test replaces typeof === object -> FAIL as expected
PASS ota_consumers mutation: dashboard separators revert to 8 -> FAIL as expected
PASS ota_consumers mutation: dashboard renders the full token on canvas -> FAIL as expected
PASS ota_consumers mutation: playground generated source drifts from the example -> FAIL as expected
PASS ota_consumers mutation: playground manifest drops dashboard -> FAIL as expected
PASS ota_consumers mutation: a non-ASCII UI literal slips in -> FAIL as expected
PASS ota_consumers mutation: a firmware file changes vs d85e69a -> FAIL as expected
ALL OTA CONSUMERS HARNESS CASES PASSED
OTA_CONSUMERS_EXIT=0
```

### 5.2 全量回归（`for t in tests/*.js; do node $t || echo "FAIL $t"; done`；0 FAIL）

```
SLOW tests/alloc_inject.js secs=31 (pass)
SLOW tests/compress.js secs=31 (pass)
SLOW tests/crypto.js secs=32 (pass)
SLOW tests/decode.js secs=30 (pass)
SLOW tests/fft.js secs=33 (pass)
SLOW tests/imgscale.js secs=34 (pass)
TEST_FILES_RUN=110
SLOW_PASS=6
FULL_LOOP_EXIT=0
```

参数透明度记录（**非 flake**）：第一次用 20s/测试预算跑，6 个 C 编译 harness（`alloc_inject` / `compress` / `crypto` / `decode` / `fft` / `imgscale`，每次 `cc -O2` 编译 QuickJS）全部 `ec=124`，`FULL_LOOP_EXIT=1`。这是验证脚本参数给得太紧；单次计时 `tests/fft.js` 实测 33s。改 150s/测试后 110/110 PASS。wordle/flake 本轮未触发，无需重跑。

### 5.3 `npm test --prefix tools/lume`（0 fail）

```
# tests 57
# suites 0
# pass 57
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2580.04316
NPM_TEST_EXIT=0
```

## 6. 提交拆分与收尾

- test 段：`tests/ota_consumers.js` + `artifacts/r205/*.log`。
- docs 段：`docs/r205-report.md` + `docs/KNOWN-SIMPLIFICATIONS.md`（r205 取舍登记）。
- 未 push；未跑 `idf.py build`（firmware 零改动）；未做真机验收，板级指标仍 deferred。


---

# Part II: Lume r205 UI 专业度第二梯队报告 — 5 App 设计稿先行 + Lume 翻译验收

> **范围**：纯 app 层重构（`examples/{settings,weather,dashboard_round,aurora_clock,clock_round}/app.js`）、5 张 480×480 圆屏 HTML 设计稿及截图（`artifacts/r205/design/*.{html,png}`）、5 张翻译后 playground 圆屏实拍（`artifacts/r205/*.png`）、对应 4 份宿主 harness（`tests/{weather,dashboard_round,aurora_clock,clock_round}.js`）及 playground 产物重建（74/74 apps）。  
> **目标名澄清**：简报标题曾误写 `color_demo` 并简写 `dashboard`，对照主控 vision 审计表逐项特征（罗盘 S 缺失 / SIM 在刻度环 / 180° 弧 / 外圆穿 LEVEL / 028 DEG，以及 clock_round 8.3/10 三针与 3 时碰撞），实际目标为 `examples/dashboard_round/app.js` 与 `examples/clock_round/app.js`；`examples/dashboard/app.js`（LUME HUB，受 `tests/ota_consumers.js` 守卫）与 `examples/color_demo/app.js` 保持零改动。  
> **红线边界**：`firmware/`、`runtime/`、`prelude`、`shell.js`、`tools/`、其他 `examples/` 零改动；全部数据源 / KV / SNTP / Dialog / OTA / Reboot / Power-off 语义零改动。  
> **诚实口径**：全部截图、帧绘制调用计数与回归测试均为宿主机验证（Node `prelude_runner` + 无头 Chromium Playwright 480×480 / playground 圆屏模式）；CO5300 真机 AMOLED 发光观感、触控手感、实测 WiFi/BLE/IMU/音频仍 deferred 至 board bring-up，**不声称真机验收**。

---

## 1. 设计稿自检与翻译还原度对照

依据 `docs/DESIGN-TOKENS.md`（R1–R8 红线、12 Primitive 色板、≤3 字阶、≤3 accent）与主控实拍审计结论，先在 `artifacts/r205/design/` 产出 5 张独立高保真 HTML 设计稿并通过 Playwright 480×480 截图与 DOM 安全区/触区自动化校验（全部 0 error / 0 safeViolations / 0 touchIssues），再逐 app 翻译并在 `website/playground/index.html` 圆屏模式截图对照：

| App | 审计原分 | 设计稿 | 设计稿自检 | 翻译实拍 | 布局 | 层级 | 色彩 | 图标 | 还原度 |
|---|---:|---|---:|---|---:|---:|---:|---:|---:|
| `settings` | 4.0/10 | `artifacts/r205/design/settings.png` | **9.0/10** | `artifacts/r205/settings.png` | 9.3 | 9.2 | 9.3 | 9.2 | **9.2/10** |
| `weather` | 3.5/10 | `artifacts/r205/design/weather.png` | **9.0/10** | `artifacts/r205/weather.png` | 9.0 | 9.0 | 9.0 | 8.9 | **9.0/10** |
| `dashboard_round` | 6.0/10 | `artifacts/r205/design/dashboard.png` | **9.2/10** | `artifacts/r205/dashboard_round.png` | 9.3 | 9.2 | 9.2 | 9.1 | **9.2/10** |
| `aurora_clock` | 6.0/10 | `artifacts/r205/design/aurora.png` | **9.2/10** | `artifacts/r205/aurora_clock.png` | 8.9 | 9.0 | 8.9 | 8.6 | **8.8/10** |
| `clock_round` | 8.3/10 | `artifacts/r205/design/clock-round.png` | **9.2/10** | `artifacts/r205/clock_round.png` | 9.2 | 9.2 | 9.2 | 9.0 | **9.2/10** |

全部 5 张设计稿自检 ≥ 9.0/10（要求 ≥ 8.0），全部 5 个翻译 app 还原度 8.8–9.2/10（要求 ≥ 7.5）。

---

## 2. 审计缺陷逐项销账表

### 2.1 `examples/settings/app.js`（4/10 → 9.2/10）

| # | 原审计致命缺陷 | 本轮修复方案 | 状态 |
|---|---|---|---|
| 1 | W/B/G 字母占位图标（违红线 R8） | 4 枚内联 ASCII SVG 圆盘图标（`Image({ src })` + `xmlns`）：Wi-Fi 扇形波纹 / Bluetooth 符文 / 喇叭声波 / 8 齿齿轮 | 已销账 |
| 2 | 面包屑失控（`Settings Battery →CONNECTIONS` 挤一行） | 顶部独立三段紧凑栏：左时间胶囊 `HH:MM` + 中 `Settings` + 右电量 Canvas 图标胶囊 `80%`；分组头 `CONNECTIONS / SOUND / DEVICE` 独立 10px 矢量微字条 | 已销账 |
| 3 | 纯矩形布局贴边裁切 | 外层 `#000000` + `452×452` 圆形表盘底 + 全菜单项严守 `x ∈ [80, 400], y ∈ [76, 395]` 安全区；子页同步收拢 `SAFE = 76` | 已销账 |
| 4 | 底部 40% 大面积空白 | 重组为 `CONNECTIONS`（Wi-Fi / Bluetooth）+ `SOUND`（Volume）+ `DEVICE`（General）三组四卡（每卡 `320×52px`），均匀填满 `[75, 405]` 圆屏安全区 | 已销账 |
| 5 | `Swipe up to go back` 教学文案常驻 | 彻底移除常驻教学文案，保留 prelude 全局上滑返回行为 | 已销账 |
| 6 | General 行值=`50% volume` 语义错位 | 拆出 `SOUND -> Volume` 行显示迷你 teal 音量条 + `50%`；`DEVICE -> General` 行显示 `System` + chevron | 已销账 |
| 7 | 缺少 iOS 式开关与 chevron | Wi-Fi / Bluetooth 行右侧以轻量化 `66×28` Canvas 绘制 iOS 胶囊开关（含分层圆 knob 投影）+ chevron `>`；Volume/General 配对应右侧读数与 chevron | 已销账 |
| 8 | 既有功能守卫兼容 | 完整保留 `r129` NTP、`r132` OTA Dialog、`r143` Reboot Dialog、`r164` Power-off Dialog、100% ASCII 字面量与 `125 <= 128` 节点预算 | 已销账 |

### 2.2 `examples/weather/app.js`（3.5/10 → 9.0/10）

| # | 原审计致命缺陷 | 本轮修复方案 | 状态 |
|---|---|---|---|
| 1 | 纯矩形布局、刷新钮右上角与温度列贴边裁切 | 圆形 AMOLED 表盘 + 全部元素收拢至 `x ∈ [82, 398], y ∈ [78, 398]`；圆形 `48×48` 刷新按钮内收至 `(350, 78)` 零裁切 | 已销账 |
| 2 | 涂鸦风天气图标 + 黑方块底 + 灰色杂块 | 重写 `drawWeatherIcon`：表盘同色无缝底（消除黑方块）、分层太阳暖光晕 + 高光核 + 三层立体云朵（阴影/冷灰底/主云体/顶部高光），同步赋能主图标与三日迷你图标 | 已销账 |
| 3 | 调试文案「WiFi 未连接，显示演示数据」红字外露 | 离线态改为低噪圆角胶囊：内联 `cloud-off` SVG 图标 + 柔和次文本 `演示数据`（保留 SNTP/HTTP 故障时的真实错误码回报契约） | 已销账 |
| 4 | 「今日」卡与三日预报「今天」完全重复 | 三指标胶囊重设为 **体感**（温度计 SVG）/ **湿度**（水滴 SVG）/ **风速**（风线 SVG），与三日预报零重复 | 已销账 |
| 5 | 温度主视觉偏小且偏向一侧 | 径向居中主舞台：`84×84` 精绘天气图标配 `44px` 居中大号温度 `18°` + 状态与当日区间；三日预报卡增补迷你天气图标与温度范围条 | 已销账 |

### 2.3 `examples/dashboard_round/app.js`（6/10 → 9.2/10）

| # | 原审计致命缺陷 | 本轮修复方案 | 状态 |
|---|---|---|---|
| 1 | 罗盘 S 缺失 | 补齐 360° 全四向矢量方位标：`N`（珊瑚红 `#FF6B79`）/ `E` / `S` / `W` 均布于 `r = 164` | 已销账 |
| 2 | `SIM` 出现在刻度环上易误读为方位 | `SIM` / `REL` 移出刻度环，迁入内舱左上独立徽章胶囊 `(146, 110)`，右侧对称配十六方位扇区胶囊（如 `NE`） | 已销账 |
| 3 | 刻度弧仅 180°（90°–270° 无法显示） | 升级为完整 360° 72 刻度表圈（每 5°/15°/30°/90° 分级，通过 `retainSegments` 静态缓存），配全 360° 外轨航向实心指针与航向扇弧 | 已销账 |
| 4 | 外圈大圆穿 `LEVEL` 表盘元素重叠 | 居中分层仪表架构：外圈 `r = 184..215`、四向标 `r = 164`、圆形水平仪居中 `(240, 282)` 半径 `r = 58`、`LEVEL` 标于 `y = 352`（距底部 `S` 留白 ≥ 40px），零重叠 | 已销账 |
| 5 | `028 DEG` 非等宽数字 + 水平仪缺容差圈 | Canvas 逐字符定宽等宽矢量数字 `drawMonoHeading`（零水平抖动）；水平仪新增虚线外容差圈（`r = 38`）+ 中心靶心容差圈（`r = 17`，入圈亮 mint / 出圈转 amber）+ 立体气泡高光 | 已销账 |

### 2.4 `examples/aurora_clock/app.js`（6/10 → 8.8/10）

| # | 原审计致命缺陷 | 本轮修复方案 | 状态 |
|---|---|---|---|
| 1 | 光带满幅出血被圆表圈切割 | 引入弦长约束函数 `acChordHalf(y)`（赤道弦宽 ≤ 424px ≤ 430px），上下极光幕布宽 `340px / 320px` 随圆弦收束并自然淡出 | 已销账 |
| 2 | 错位重影图层显脏 | 移除原 3 组错位重叠椭圆与 `acGlow` 硬贴图；改为每主题预渲染一次的高斯羽化 RGB565 极光幕布精灵（`retainImage` 槽 2/3），丝滑无重影 | 已销账 |
| 3 | 辉光与数字叠加发虚 | 极光幕布严格分离至时间区上下方（`y ∈ [106, 196]` 与 `[288, 370]`），中部保留纯净 `#040C16` 深空井；升级圆角几何时间精灵配圆形 mint 冒号 | 已销账 |
| 4 | `NO WIFI` 纯文字无图标无异常态且缺电量位 | 底部安全区设双 complication 胶囊：左电池 SVG + 电量百分比，右异常态 `wifi-off` SVG + `NO WIFI` 琥珀徽章（同步后切回低噪 `AURORA`） | 已销账 |

### 2.5 `examples/clock_round/app.js`（8.3/10 → 9.2/10）

| # | 原审计遗留问题 | 本轮精修方案 | 状态 |
|---|---|---|---|
| 1 | 字体三套不统一 | 统一无衬线几何字系：`12 / 3 / 6 / 9`（22px）、底部数字时间胶囊（20px）、顶部状态胶囊（13px）均走原生统一无衬线排版 | 已销账 |
| 2 | `NO WIFI` 贴左上角 `(8, 8)` 被圆屏裁切且无 complication 位 | 迁入表盘 12 时内舱专用 complication 胶囊 `(184, 132)`，配内联 `wifi-off` SVG 图标，同步成功后自动隐藏 | 已销账 |
| 3 | 分钟针扫 3 时碰撞 | 时标定于 `r = 158`，分钟针缩短至 `r = 128`（针尖距 `3/6/9/12` 保留 30px 净空，零碰撞），配镂空时针与平衡锤秒针 | 已销账 |
| 4 | 表圈偏暗 | 表圈提亮一档：`#244862` → 金属蓝灰 `#5689AC`（3px 主圈）+ `#294A63` 内反射圈 + `retainSegments` 60 刻度（四主时标 mint 强调） | 已销账 |

---

## 3. 翻译映射与偏差/简化记录

| App | 设计稿元素 | Lume 实现方式 | 偏差 / 简化记录 |
|---|---|---|---|
| `settings` | CSS 线性渐变卡片与柔光开关投影 | 1px 描边 `View` + 内联 `Image` SVG 圆盘 + 轻量 Canvas 分层圆 knob 投影 | **简化**：CSS `linear-gradient` / `box-shadow` 退化为深色纯底 + 1px 亮边 + 双层偏移圆；菜单静态+全子页共 125 节点（≤ 128 预算） |
| `weather` | SVG `radialGradient` 太阳光晕与背景大气渐层 | `Canvas` 分层同心圆光晕 + 三层立体云朵；其余 pin/cloud-off/refresh/metric 图标用 `Image` 内联 SVG | **简化**：表盘顶部大气弧光与温度条双色渐变简化为纯色 `#40D8B0` 温度条；离线胶囊固定宽度 `102px` 避免长状态串撑爆 |
| `dashboard_round` | SVG 72 刻度 + `radialGradient` 气泡 + `DejaVu Sans Mono` | 单张 `480×480` Canvas + 4 条 `retainSegments` 静态路径 + `drawMonoHeading` 等宽矢量数字 + 三层高光气泡 | **偏差（有意）**：全仪表收进单张 Canvas（2 节点），每帧仅 81–88 次绘制调用（远低于 240 上限） |
| `aurora_clock` | SVG `feGaussianBlur` 双极光丝带 + 矢量字体 `10:09` | 预渲染高斯羽化 RGB565 极光精灵（主题切换上传一次）+ 每分钟上传一次的 RGB565 几何时间精灵 | **简化**：受限于 RGB565 无实时高斯模糊，用预计算高斯羽化精灵实现平滑渐晕；底部两枚 complication 用独立 `View + Image + Text` 保证零逐帧文本写入 |
| `clock_round` | SVG 金属渐变表圈 + 几何无衬线时标 | 单张 `480×480` Canvas + 3 条 `retainSegments` 静态刻度 + 原生 `Text` 统一无衬线时标与胶囊 | **简化**：表圈渐变简化为 `#5689AC` + `#294A63` 双环；状态胶囊子节点用绝对定位规避 `ATTR_VISIBLE` 切回时重置 flex |

---

## 4. 帧预算、Canvas PSRAM 与节点预算汇总

| App | Canvas 节点 | Canvas 总像素（上限 `≤ 230,400`） | 单帧绘制调用（上限 `≤ 240`） | DOM/UI 节点数（上限 `≤ 128`） |
|---|---:|---:|---:|---:|
| `settings` | 8（微标/电量/开关/音量） | `25,312 px` (11%) | N/A（事件/轮询驱动） | **125** |
| `weather` | 4（`84×84` + 3×`24×24`） | `8,784 px` (4%) | N/A（数据变更驱动） | **52** |
| `dashboard_round` | 1（`480×480`） | `230,400 px` (100%) | **81 (SIM) / 88 (IMU)** (`≤ 240` PASS) | **2** |
| `aurora_clock` | 1（`480×480`） | `230,400 px` (100%) | **max 11**, ripple `≤ 35` (`≤ 240` PASS) | **10** |
| `clock_round` | 1（`480×480`） | `230,400 px` (100%) | **17** (`≤ 240` PASS) | **11** |

---

## 5. 原始验证输出

```text
# 1) 设计稿 Playwright 480x480 DOM 几何自检
settings {"errors":0,"safeViolations":[],"touchIssues":[]}
weather {"errors":0,"safeViolations":[],"touchIssues":[]}
dashboard {"errors":0,"safeViolations":[],"touchIssues":[]}
aurora {"errors":0,"safeViolations":[],"touchIssues":[]}
clock-round {"errors":0,"safeViolations":[],"touchIssues":[]}

# 2) 三款径向 Canvas App 帧预算与专项回归
PASS dashboard_round SIM prelude, 81 calls/frame (<=240)
PASS dashboard_round IMU prelude, 88 calls/frame (<=240)
PASS dashboard_round relative heading, 360-deg cardinals, and linear level mapping
PASS prelude/no IMU, per-frame draw calls max=11, ripple <=35 (budget <=240)
ALL AURORA CLOCK CASES PASSED
PASS clock_round pure angles, prelude, 17 calls/frame, 60-second tick smoke
PASS 13 weather cases (10 logic + 3 UI)

# 3) 全量宿主 harness 顺序回归（111/111 PASS，0 FAIL）
SEQUENTIAL_REGRESSION pass=111 fail=0 failed=

# 4) lume check --no-emu（5/5 PASS）
lume check examples/settings        -> [PASS] bundle 50438 bytes | RESULT: PASS (exit 0)
lume check examples/weather         -> [PASS] bundle 12868 bytes | RESULT: PASS (exit 0)
lume check examples/dashboard_round -> [PASS] bundle  5015 bytes | RESULT: PASS (exit 0)
lume check examples/aurora_clock    -> [PASS] bundle  8064 bytes | RESULT: PASS (exit 0)
lume check examples/clock_round     -> [PASS] bundle  4249 bytes | RESULT: PASS (exit 0)

# 5) CLI 单元测试（npm test --prefix tools/lume）
# tests 76 / pass 75 / fail 0 / skipped 1 (qjsc binary)

# 6) Playground 重建与 Playwright 全量加载验证（74/74 apps）
PASS prelude 67986 bytes; 74 apps
PASS all examples load without runtime errors
  settings: 125 nodes | weather: 52 nodes | dashboard_round: 2 nodes | aurora_clock: 10 nodes | clock_round: 11 nodes

# 7) 文档站一致性检查（scripts/check_website.py & gen_api_docs.py --check）
examples.html gallery up to date (74 cards)
HTML pages: 7; internal href/src and anchors checked
API: 162 catalog entries, 162 type declarations, 34 function namespaces
api.html is up to date with lume.d.ts (162 entries)
```
