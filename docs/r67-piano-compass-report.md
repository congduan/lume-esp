# r67 战报：钢琴 app（examples/piano）+ 惯性方位仪表（examples/compass）

分支 `r67-piano-compass`，基线 `origin/main` HEAD `adfbcf1`（开工 `git fetch` 后
从 `4f57de7` 快进到 `adfbcf1`，后者只动 README 表头）。纯 app 层，未碰固件/协议/prelude，
未构建固件镜像（emu 用 main 仓预构建镜像 + esp32sim 注入 app frame）。

## 一、开工前实证：简报假设 vs 代码事实

按「假设可能错先实证、以代码为准」先验了四类契约，结论如下（逐条附证据）：

| 简报假设 | 代码事实 | 处置 |
|---|---|---|
| 音频「16 kHz 单声道 16bit」 | `lume.audio.play` 原生 `js_audio_play` 对 opts 逐项校验 `expected={16000,2,16}`；`lume_audio_play()` 要求 `(bytes & 3)==0`，I2S slot 为 `I2S_SLOT_MODE_STEREO`；`KNOWN-SIMPLIFICATIONS.md:531` 明写「16 kHz/16-bit/有符号小端/**双声道**交错裸 PCM，其他 sampleRate/channels/bits 返回 -1」。单声道会被当立体声读成半帧→音高/时长全错 | **改为立体声**：JS 合成单声道波形后复制到 L/R，`pianoBuildPcm` 每帧写两次 int16 |
| `play` 有「≤48 ms 硬上限」 | `lume_audio_play()` 把整个 buffer 按 4096 B 分块 `i2s_channel_write`，**没有时长上限**；所谓 48 ms 来自 `examples/games/shared.js:6-8` 的 `gameBeep` 自设 `Math.min(ms,48)`（避免长阻塞 engine task 的约定）。`KNOWN-SIMPLIFICATIONS.md:932` 记为「12–48 ms synchronous audio calls」经验值 | 按**约定**而非硬限执行：attack 仍限制在 40 ms（`ATTACK_MS=40 ≤48`）走 `play`，tail 走 `playStream`，符合简报 option 1 且把 engine 阻塞压在 40 ms |
| 指南针可做「真·地理北」 | `runtime/types/lume.d.ts:494-505` 的 `lume.imu.read()` 只返回 `{ax,ay,az,gx,gy,gz}`，**无磁力计字段**；注释明说板载 QMI8658 六轴、无 INT、失败返 null。地理北物理不可实现 | **诚实红线**：app 头注释第一行即声明 `INERTIAL HEADING DIAL — NO magnetometer ... geographic north is NOT claimed`；UI/README/roadmap 全部改为「惯性/相对方位」，P2 登记磁力计缺口 |
| emu/浏览器缺 audio 合成 API 会崩 | `website/playground/runtime.js:109-112` 有 `play:()=>0`、`playStream:()=>0`、`streamFinished:()=>true` 等桩；`ArrayBuffer`/`DataView` 是 JS 内建。浏览器桩不解析 PCM，但 app 合成逻辑可独立跑完 | 不触发停下条款；app 仍对 `lume.audio` 做存在性守护 |

**停下条款逐项复核**：play 时长/采样率限制**不严于**简报（16 kHz 一致、无硬时长限，只是通道数不同且可适配）；imu 在 emu/浏览器 `read()` 返 null 时**能降级 demo**（已实测 `COMPASS FALLBACK demo`）；浏览器 prelude 有 audio 桩与 ArrayBuffer。**均未触发停下条款**，按「以代码为准」修正假设后继续。

## 二、钢琴 app（`examples/piano/app.js`）

- **音色引擎**：基频 + 2/3 次泛音（0.5/0.25 权重）+ 4 ms attack ramp × 120 ms 指数衰减包络，`PEAK=11000` 留 int16 余量。一个 400 ms 音符 = 6400 立体声帧 = 25,600 B。单一包络函数在 `ATTACK_MS=40`（640 帧）处切分：前段 `play()` 立即发声，后段 5760 帧按 1152 帧/块（4608 B）经 `playStream()` 续尾。**两段取同一包络函数，接缝幅度连续**（harness 断言相邻帧差 <0.002），按构造避免爆音；每音先 `streamReset()` 切掉前一音尾巴。简报 option 1 落地；若真机验收听到切换杂音，降级路线（option 2：整包络全走 playStream）已写在文件头注释。
- **键盘**：14 白键 × 34 px = 476 px，起点 x=2，一行排满，每键 `borderWidth:1` 画出缝线；10 黑键宽 22 px 绝对定位在白键缝上（seam 0/1/3/4/5/7/8/10/11/12）。键名放在深色 chip 上（本 prelude 的 Text **没有 color 属性**，白字在白键上不可见，故加 chip；这是 vision 核验时发现的真实问题）。
- **交互**：`tap` 触发单音；`panstart`/`pan`/`panend` 在同一透明命中层上做横移滑奏，按半音去重（每键只响一次）。三档八度按钮 C3-C4 / C4-C5 / C5-C6（base MIDI 48/60/72，默认 C4-C5），HUD 显示当前档位与最后音名。Demo 曲按钮内置 42 音小星星序列，280 ms/音，可再按停止。
- **性能**：单键 = 1 次 `play` + 5 次 `playStream` + 1 次 `highlightRev.set`（仅改 signal）；键高亮由 signal 绑定的 `background` 触发 `ATTR_BG_COLOR` 就地改写，harness 断言节点数不变、attr 写入发生；**无每帧重绘**。
- **serial 冒烟**：`lume.log('PIANO KEY <name> freq=<hz>')`。emu 通过注入 CST9220 script touch 实测输出 `PIANO KEY C5 freq=523.25`（见第五节原始输出）；host harness 用 tap/pan 注入覆盖。

## 三、惯性方位仪表（`examples/compass/app.js`）

- **诚实定位**：文件头第一行即 `INERTIAL HEADING DIAL — NO magnetometer on this board; geographic north is NOT claimed`，并说明需外接磁力计固件刀。UI 副标题 `relative estimate - no magnetometer (drag to nudge)`，README App 表副标题 `inertial heading dial, no magnetometer`，roadmap P2 登记真·指南针缺口。harness 断言所有 UI 文案不含 north / magnetic / bearing / point 承诺。
- **形态**：360×360 canvas；静态刻度环 = 36 段 `retainSegments` + 2 条 `retainPath`（外环 120 点 + 内环 90 点），**一次上传、C 侧重放**；每帧重绘指针、外圈旋转标记、中心 hub 与数字。N/E/S/W 字母朝上固定。方向数字是**原生 Text 节点**（不随表盘旋转），harness 以 UI 文本断言。
- **诚实适配**：retained path API 只支持 `drawPath(dx,dy)` 平移、不支持旋转，所以刻度环固定、由指针和外圈标记承载航向；文件头与报告如实写明这是对「表盘转、字不转」的适配而非逐字实现。
- **双模式**：demo（emu/浏览器默认）以 18°/s 平滑旋转，可拖刻度盘调 `demoOffset`；IMU 模式仅在 `imu.read()` 返回样本时可进入，按 `heading += gz·dt` 积分**相对**航向，`|累计自旋|>30°` 时 HUD 亮 `DRIFT` 徽章，明说无绝对参考。无样本时自动回 demo。
- **serial 冒烟**：`lume.log('COMPASS HDG <deg> mode=<demo|imu>')`，emu 8 s 输出 22 条；harness 正则断言格式。

## 四、host harness（各 10 条，原始输出见下）

- `tests/piano.js`：音名→频率表（含 A4=440）、包络样本数=时长×采样率（400 ms→6400 帧、attack 640、release 5 块）、接缝幅度连续、立体声 L=R、14+10 键布局像素、tap 注入 `PIANO KEY`、高亮 attr 就地改写不重建节点、pan 滑奏跨键去重、八度 12 半音映射、Demo 曲启停。
- `tests/compass.js`：角度 wrap 0-360、demo 18°/s、陀螺积分符号与 dt 缩放、36 段刻度 + 2 path 一次上传、DRIFT 条件、无 IMU 降级 demo、serial 格式、注入 gz=30 积分 45° 后亮徽章、模式往返、UI 无「指北」承诺。

全量 29 个 `tests/*.js` 全绿（0 失败）；`npm test --prefix tools/lume` 43 pass / 1 skip / 0 fail。

## 五、验收原始输出

### check（两 app 全 PASS）

```
$ node tools/lume/lume.js check examples/piano
lume check examples/piano

[PASS] bundle   4642 bytes (21 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for piano
[SKIP] perf     profile disabled

screenshot: artifacts/check/piano/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)

$ node tools/lume/lume.js check examples/compass
lume check examples/compass

[PASS] bundle   3820 bytes (21 ms)
[PASS] eval     2x "app eval ok; entering event loop"
[SKIP] layout   no layout expectations for compass
[SKIP] perf     profile disabled

screenshot: artifacts/check/compass/tft.png
RESULT: PASS (4 steps, 0 failed; exit 0)
```

（`layout` SKIP 是 check 工具的既有行为：未登记 `layout_expectations.json` 条目即跳过；键位/刻度环改由 emu 截图 vision 核验。）

### emu 冒烟 serial（节选）

```
$ EMU_SKIP_BUILD=1 EMU_SECONDS=8 tools/emu/run.sh examples/piano   # + script touch 注入
I (2971) lume-engine: js: PIANO READY keys=24 oct=C4-C5 note_ms=400
I (8101) lume-engine: js: PIANO KEY C5 freq=523.25

$ EMU_SKIP_BUILD=1 EMU_SECONDS=8 tools/emu/run.sh examples/compass
I (2962) lume-engine: js: COMPASS READY mode=demo imu=present demo_dps=18
I (3023) lume-engine: js: COMPASS HDG 0 mode=demo
I (3267) lume-engine: js: COMPASS HDG 4 mode=demo
...
I (8147) lume-engine: js: COMPASS HDG 76 mode=demo
```

截图（vision 核验通过：钢琴 14 键等宽、黑键压缝、无重叠、C5 按压高亮；指南针刻度环完整、数字居中朝上、无黑边）：

- `artifacts/emu/piano/tft.png` → `artifacts/emu/ui-refresh/piano.png`
- `artifacts/emu/compass/tft.png` → `artifacts/emu/ui-refresh/compass.png`

### host harness（新增两条）

```
$ node tests/piano.js
PASS piano note->frequency and note-name table
PASS piano envelope sample count, attack budget and stream chunking
PASS piano envelope continuity at handoff and decay shape
PASS piano stereo 16-bit LE PCM, L=R, soft attack
PASS piano 14x34px white row + 10 black seam keys fit 480px
PASS piano tap injection emits PIANO KEY C5 freq=523.25
PASS piano highlight is ATTR_BG_COLOR change, no node rebuild
PASS piano pan glissando crosses keys with per-key dedupe
PASS piano octave switch maps C4->C3/C5 (12-semitone steps)
PASS piano demo melody starts/stops and plays notes
PASS piano host harness: 10/10 assertions

$ node tests/compass.js
PASS compass heading wraps 0-360
PASS compass demo mode angular speed (18 deg/s)
PASS compass gyro-Z integration wraps and scales by dt
PASS compass retained ring: 36 segments + 2 paths uploaded once
PASS compass DRIFT badge condition (IMU mode, |spin|>30deg)
PASS compass no-IMU fallback to demo (honest, no crash)
PASS compass serial smoke: COMPASS HDG <deg> mode=<demo|imu>
PASS compass IMU mode integrates gz and shows DRIFT badge
PASS compass mode toggle returns to demo, badge clears
PASS compass honest wording: inertial/relative only, no north promise in UI
PASS compass host harness: 10/10 assertions
```

全量 suite：`for f in tests/*.js; do node "$f"; done` → 29 个文件，TOTAL FAILURES: 0。

### playground（四处同步 + 22 apps）

`tools/playground/build.mjs`（apps 数组）、`website/playground/page.js`（picker）、
`website/playground/index.html`（script 标签）、`tools/playground/verify.mjs`（计数 20→22，
顺带修掉原来 `!==20` 却写「expected 21」的 off-by-one 文案）四处同步加两个 app。
指南针在浏览器 runtime 的 `imu.read()` 返 null，自动走 demo 独立渲染（verify 中 compass 8 nodes）。

```
$ npm ci --prefix tools/lume
added 30 packages ... found 0 vulnerabilities

$ node tools/playground/build.mjs
PASS bundle piano 4642 bytes
PASS bundle compass 3820 bytes
PASS esbuild-wasm assets and 22 editable sources
PASS prelude 60379 bytes; 22 apps

$ PLAYWRIGHT_MODULE=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules/playwright node tools/playground/verify.mjs
PASS page loads without JavaScript errors
...
  piano: 61 nodes
  compass: 8 nodes
PASS all examples load without runtime errors
```

简报写「21 apps」是基线口径误差：本地 Apps 数组原本 20 项（`verify.mjs` 的旧报错文案还写成 21），
加两 app 后实测 **22 apps**，verify 通过。

## 六、未验收 / 风险登记（诚实）

- 真机音频：未接板，`play`/`playStream` 切换是否可闻爆音、DAC 收尾、PA 时序都属 board 验收；本机只有寄存器桩与 emu 静音注入。
- IMU 模式漂移量：仅注入 `gz=30` 验证积分与徽章逻辑，真机零偏/比例因子/姿态耦合未标定；`DRIFT` 是「未校正相对估计」提示，不是误差测量。
- 单声道→立体声是把合成样本复制到 L/R，真机听感（声像/音量）待板验。
- 未改固件/未跑 `idf.py build`（app 层改动，无固件依赖；若后续要扩 audio 采样率才需停刀）。
