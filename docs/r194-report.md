# r194 简报收口报告 — playground 基线读取现代化 + Sparkline 存量消费 + 未注册 example 审计

基线 `origin/main 569d9d4`（2026-11-26），worktree `/tmp/lume-r194-wt`，分支 `r194-playground-build-baseline`。全部证据为宿主机证据；真机显示/触控/功耗未实测，deferred 到 board bring-up。

## 1. 任务一：build.mjs 基线读取现代化（选 A）

**实证**：先读 `gen_lume_scripts.py`（SCRIPTS 顺序：`lume_prelude_js`→`prelude.js`，`lume_demo_js`→`demo.js`，`lume_home_js`→`home.js`）、`tests/lib/prelude_runner.js`（宿主侧已解析同一 SCRIPTS 元组后直读源 JS）、`lume_scripts.c`（第 3 行已是 `#include "lume_scripts.inc"` 占位）。裸跑旧 build.mjs 复现 `Error: missing lume_prelude_js`（原始输出见 `artifacts/r194/tests-all-round1.txt` 之前的复现记录，重建日志见 `artifacts/r194/playground-build.log`）。

**取舍**：采用 **方案 A** —— `tools/playground/build.mjs` 解析 `gen_lume_scripts.py` 的 `SCRIPTS` 元组取 `lume_prelude_js` 对应文件名，再直读 `firmware/components/lume-engine/prelude/<file>`。

- 相对方案 B（检测占位文件后临时物化 C 数组）：A 不引入 Python 运行时依赖，不产生临时文件或清理步骤，playground 构建保持纯 Node/esbuild；与 `prelude_runner.js` 的既有宿主读取路径同构，单一事实来源仍是生成器的 SCRIPTS 元组。
- 语义不变：`c_string()` 对这批源 JS 是无损往返。物化 `lume_scripts.inc` 后解析 `lume_prelude_js` 数组得 67,546 字节，与 `prelude.js` 直读逐字节一致；`website/playground/prelude.js` 内嵌字符串亦与基线逐字节一致（`artifacts/r194/prelude-equivalence.txt`）。
- 保留了原 `incomplete prelude` 守卫；生成文件的头部注释刻意不改，确保生成物零 diff。
- 幂等：连续两次裸跑 `node tools/playground/build.mjs` 均 PASS，`website/playground/prelude.js` 未进入 `git status`（`artifacts/r194/playground-build.log`）。

`firmware/` 零 diff：`git diff origin/main -- firmware/` 原始输出为空（`artifacts/r194/firmware-zero-diff.txt`），因此未跑 `idf.py build`。

## 2. 任务二：三处手搓折线改用 shell.Sparkline

组件本体零改动（`runtime/shell.js` 不在本轮 diff）。数据仍由调用方 signal 持有，组件在 `Canvas.onDraw` 内读值；多序列用 `series`，未为旧视觉扩组件。

| app | 原实现 | 替换后 props | 语义保留 / 差异 |
|---|---|---|---|
| `hr_monitor` | 400x96 Canvas：`fillRect(surface)` + `polyline` + 手算 `lo=55,hi=105` 映射 | `data: history`，`min:55 max:105`，`width:400 height:96`，`strokeWidth:3` | BPM 信号与固定 55..105 域保留；去掉了不透明 surface 底填充（纯视觉） |
| `heart_curve` | 400x152 Canvas：surface 底 + y=132 基准线 + `polyline` + 每点白圆点 | `data: samples`，`width:400 height:152`，`strokeWidth:3`，`showDots:true` | 自动域等同原 `128-value` 相对形状；基准线与底填充去掉，点标改为组件默认的 2px 主题色（未扩组件） |
| `dashboard` | TRACE 页同一 Canvas 内三轴 `polyline` + 每轴末端圆点，固定 `TRACE_POINTS` 间距，5+5 网格 retained path | `series` 三项 getter 读 `view().trace` 并按 `t[k]*9` 映射，`min:-100 max:100`，`x:44 y:44 width:340 height:200`，`strokeWidth:2`，`showLast:true`；`go()` 中按页显隐，图层在网格之上 | 三轴颜色/±100 域/末端标记/发布即重绘保留；网格与图例留在原 Canvas。差异：缓冲区未满时组件把 N 点铺满宽度，原实现按 `TRACE_POINTS` 固定间距只画左侧一段——仅填充期观感差异，非语义缺口 |

**断言锚点同步**（未删守卫、未放宽谓词）：`tests/ota_consumers.js` 的 `allChanged` 允许清单在改断言前先跑确认真实失败（`FAIL ota_consumers: only known ... files differ`），随后仅加入本轮合法新增文件；其 r194 文件预加入同样在提交前完成，避免未跟踪文件使守卫变红。`tests/examples_gallery.js` / `scripts/gen_examples_gallery.py` 的 71→73 注释同步。

## 3. 任务三：11 个未注册 example 审计

分类规则：浏览器 stub 可降级运行→注册（build.mjs + page.js 元数据 + index.html script 标签 + 生成物 + gallery 全链路同步）；真机硬件/服务端/模拟器测试夹具/重复变体→跳过。

| example | 分类 | 理由 |
|---|---|---|
| `app_manager` | **注册** | 纯 `lume.apps.entries()/remove()`，prelude 自带 entries，浏览器桩下退化为 0 应用列表，可运行 |
| `imu_poll` | **注册** | 1 Hz 轮询 `lume.imu.read()`，浏览器桩返回 null → 显示 `IMU unavailable`，降级清晰 |
| `ai_chat` | 跳过 | 需 NVS 预置 WiFi/API key 且要访问远端 AI 服务 |
| `device_monitor` | 跳过 | 与已注册 `dashboard` 的 SYSTEM 页（PMIC/IMU/NET/BLE/存储清单）重复变体 |
| `games` | 跳过 | 无 `app.js`，只有 README.md 与 shared.js（games_* 的共享源） |
| `launcher` | 跳过 | 与已注册 `launcher_grid` 重复，且启动 pin 语义依赖真机多应用运行时 |
| `net_check` | 跳过 | 写死 WiFi 配置与 HTTP 目标，需真网络/服务端 |
| `nettest_open` | 跳过 | 连接 `emu-test` 的模拟器冒烟夹具，非普通示例 |
| `typewriter_min` | 跳过 | 与已注册 `typewriter` 的极简重复变体 |
| `web_config` | 跳过 | 需 WiFi + 本地 Web 服务端，浏览器桩无法起服务 |
| `ws_echo` | 跳过 | 需 WiFi + 外部 WebSocket 服务端 |

最终注册 2 个，manifest 71→73。按 r168 教训同步了 `website/playground/index.html` 的 `<script defer src="apps/...">` 标签（首轮 Playwright 报 `Missing bundle: app_manager`，补后复绿）。

## 4. 验证（原始输出均在 `artifacts/r194/`）

1. `node tools/playground/build.mjs`：PASS，73 apps，`prelude 67546 bytes`；二次跑幂等 → `playground-build.log`
2. `for t in tests/*.js; do node $t || echo FAIL; done`：`FAIL_COUNT=0` → `tests-all.txt`（`tests/wordle.js` 存量随机 flake 本轮未触发；未修改）
3. `lume check examples/{dashboard,hr_monitor,heart_curve,counter} --no-emu`：4× `RESULT: PASS` → `lume-check.txt`
4. `python3 scripts/check_website.py`：API missing/invented/duplicates/signatures-not-found 全 none；`verify.mjs`（Playwright，指定 NODE_PATH）：全 PASS，含 `app_manager: 6 nodes` / `imu_poll: 20 nodes` → `website-check.txt`、`playground-verify.txt`
5. `npm test --prefix tools/lume`：52 pass / 0 fail → `cli-tests.txt`；未改 `runtime/types/lume.d.ts`，另附 `gen_api_docs.py --check` fresh
6. `git diff origin/main -- firmware/`：空，跳过 idf.py build → `firmware-zero-diff.txt`

未 push；未改 vendored / `.github/` / `runtime/shell.js` / `tests/board_abi.js` 排除项；未改 milestone 定义。commits 按 feat / test / docs 拆分，git 身份 congduan。
