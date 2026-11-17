# r78 性能三连刀战报

基线：`origin/main` `f0dd8ef069e24268fc00f4c11c321758d6ded1f8`（开工前 fetch）；实现位于 `/tmp/lume-r78-perf-wt`，未推送。

## A. CO5300 QSPI 40 → 80 MHz

- `CONFIG_LUME_LCD_PCLK_MHZ` 默认 80，Kconfig 可设回 40；两个板 profile 共用。`firmware/sdkconfig` 已同步为 80。
- 总线理想带宽：80 MHz × 4 bit = 40 MB/s。480 × 480 × 16 bit = 460,800 B = 460.8 kB/帧，故全帧纯传输上限约 86.8 fps；40 MHz 为 20 MB/s、43.4 fps。命令、间隙、DMA、渲染开销都会降低实际帧率。
- **超规格风险**：[CO5300 原厂 datasheet](https://dl.espressif.com/AE/esp-iot-solution/CO5300_Datasheet_V0.00.pdf) 表 6.4 给出写时钟周期最小 20 ns，即 50 MHz 最大写时钟。80 MHz 是本刀按简报要求设置的实验超频，不能称为 CO5300 规格内频率。真机信号完整性、花屏、温度/批次稳定性均为 **pending board**；失败时设 `CONFIG_LUME_LCD_PCLK_MHZ=40`。emu 层不受时钟设置影响。
- 固件独立构建与 `idf.py -B build-r78 size` PASS：IRAM **16,384/16,384 B**，Flash Code **2,010,348 B**。同一配置下暂时使用 `origin/main` 的 `lume_engine.c` 移除 math 注册后复建为 **2,008,740 B**，故本刀原生绑定的 Flash Code 增量 **+1,608 B**；A 的时钟常量改动未单独测尺寸。QuickJS 目标的调试信息汇编在宿主 swap 压力下停滞，构建时仅对该目标使用 `-g0`，未改变源码或 `-O2`。

## B. QuickJS-NG app 冷启动字节码

- vendored QuickJS-NG 0.18.0 的 `qjsc -b -C` 可生成经典脚本字节码；设备端既有 `LQBC`/`LUMB`、`JS_ReadObject`、版本预检路径。CLI deploy/dev 默认使用字节码，缺少本地 qjsc 时从 vendored 源码自动构建；`--source` 是旧固件/调试回退。部署前仍核对引擎版本。
- host harness 用 3,000,695 B 的合成 app.js：源码编译 **3,749.318 ms**，3,711,625 B 字节码 `JS_ReadObject` **13.788 ms**；执行结果两条路径均为 42。计时是单次 host 样本，绝非真机启动时间。样本字节码大于现有 256 KiB LUMB 帧上限，只用于解析成本对照。
- 收益仅在冷启动的解析/编译阶段。字节码在 QuickJS 解释器上执行，运行时 2–5 倍提速需要上游原生 JIT/AOT；当前 vendored qjsc 及[上游 qjsc](https://github.com/quickjs-ng/quickjs/blob/master/qjsc.c) 提供的是字节码和 C 包装输出，没有原生机器码路径。这是根据其工具选项和源码得出的判断。

## C. `lume.math` Float32Array 原生批量运算

- 新增 `vecAdd(a,b)`、`vecScale(a,scale)`、`dot(a,b)`、`integrate(acc,vx,vy,dt)`。`vecAdd`/`vecScale` 原地修改并返回 `a`；`integrate` 接受交错 `[ax,ay]` 加速度并原地更新 `vx/vy`。位置坐标由调用方更新。
- `JS_GetTypedArrayBuffer` + `JS_GetArrayBuffer` 直接访问带偏移的 Float32Array backing store，输入/输出无拷贝；访问期间不回调 JS。host harness 对正确结果按 Float32 位模式逐位比较，也覆盖带偏移视图及类型/长度错误。
- 1000 质点 × 100 步：JS 循环 **20.334 ms**，原生 API **0.248 ms**（单次 host 样本，约 82×；不代表 ESP32-S3）。两者结果逐位相同。
- `.d.ts` 已同步。在临时镜像运行 `python3 scripts/gen_api_docs.py` 并 `--check` 均通过（123 API rows）；生成结果会改变 `website/api.html` 四行，遵守本刀“勿碰 website/**”的约束，仓库网站页未更新。

## 验收

- `for t in tests/*.js; do node "$t" || echo FAIL; done`：0 FAIL（378 条 PASS 输出）。
- `node --test tools/lume/lume.test.js`：33/33 PASS。
- `tests/perf_r78.sh`：源码→qjsc→`JS_ReadObject` 往返、数值对照、性能计时 PASS。
- `node tools/lume/lume.js check examples/counter --no-emu`：PASS。
- `idf.py -B build-r78 build` + `idf.py -B build-r78 size`：PASS；基线差值 +1,608 B Flash Code，IRAM 仍满线。
- **pending board**：80 MHz 超规格 CO5300 实机信号/画面验收；app 字节码实机冷启动时间；原生积分在 Xtensa 上的真实加速比。
