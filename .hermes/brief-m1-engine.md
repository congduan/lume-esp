# Lume M1 任务简报 — 第一刀：固件可编译 + QuickJS 上板

## 背景与仓库

- 仓库：/home/ubuntu/lume（remote: github.com/congduan/lume-esp，main）
- 基线 HEAD：见 `git log -1`（80303d9 附近，以实际为准）
- 目标板：Waveshare ESP32-S3-Touch-AMOLED-2.16（ESP32-S3, 16MB flash, 8MB Octal PSRAM, CO5300 480×480 QSPI AMOLED, CST9220 触摸）
- 工具链：ESP-IDF v5.5.5 已装于 /opt/esp/esp-idf；构建命令见下（环境 quirk 必读）
- 项目使命：最现代前端技术（声明式 UI/VDOM diff/热更新/TS 工具链）+ 最少 ESP 资源（字节码、脏区渲染、PSRAM 堆管理）= 最优嵌入式开发体验

## 环境 quirk（重要，构建失败多半是这个）

1. Hermes 会话有 VIRTUAL_ENV 泄漏，必须 `env -u VIRTUAL_ENV` 隔离
2. python_env 是 py3.12 版本，需设 `IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env`
3. 构建命令模板：
```bash
cd /opt/esp/esp-idf && env -u VIRTUAL_ENV IDF_PYTHON_ENV_PATH=/home/ubuntu/.espressif/python_env/idf5.5_py3.12_env bash -c '. ./export.sh >/dev/null 2>&1; cd /home/ubuntu/lume/firmware && idf.py build'
```

## 当前状态（已核实）

- firmware/ 顶层 CMakeLists.txt 已建好（刚写，未提交）
- components/: lume-engine（骨架）、lume-board（骨架+引脚映射 lume_pins.h）、lume-ui-bridge（骨架）、lume-hotreload（骨架）、quickjs-ng（已 vendor 完整源码）、lvgl（已 vendor v9.3 src + lv_conf.h）
- **已知编译错误**：quickjs-ng/CMakeLists.txt 里 SRCS 列表是旧版 quickjs 布局（cutils.c/xsum.c 不存在）。quickjs-ng 的真实源文件布局看 components/quickjs-ng/meson.build 第 138 行 `qjs_srcs = files(...)` ——以 meson.build 为准修正 CMakeLists.txt SRCS。引擎目标只需 lib 部分（qjs.c/qjsc.c/quickjs-libc.c 这些是 CLI 的，不要编进固件；gen/ 目录是生成示例，不要）
- quickjs-ng 是 ng 分叉，API 有差异（JS_NewRuntime 等），编译时若遇到 ESP-IDF 缺 POSIX 函数（如 fork/socket 全套不需要），用宏裁剪或 stub，改动要记录在 components/quickjs-ng/VENDOR.md

## 任务清单

1. 修正 components/quickjs-ng/CMakeLists.txt 的源文件列表（对照 meson.build:138）
2. 让 `idf.py build` 通过：lume-engine 引用 quickjs-ng 头文件创建一个 JS runtime 冒烟调用（js_NewRuntime + js_Eval "1+1" + log 结果 + js_FreeRuntime），跑在 engine_task 里
3. LVGL 组件确保能编译进固件（GLOB src/*.c 已配，如报错修正 include/依赖）
4. main/lume_main.c 串起来：board_init（暂 stub）→ engine_start（冒烟 eval）→ hotreload_start（stub）
5. build 通过后 `idf.py size` 输出贴出（固件大小/内存占用是本项目核心指标，必须记录）
6. 提交：commits 按逻辑拆分（quickjs CMake 修正 / engine 冒烟 / 顶层 CMake），**不推送**（主控复测后统一推）

## 验证要求（逐步贴原始输出）

- idf.py build 完整通过，末尾二进制大小统计贴出
- idf.py size 输出贴出（DRAM/PSRAM/flash 占用）
- 冒烟 eval 的结果现在还看不到（无板），但代码里 ESP_LOGI 输出 "js eval: 2" 这样的日志，主控之后接板验证

## 纪律

- 假设可能错，先实证再修（如 meson.build 里看到的才是真源列表）
- 防失败条款：若 quickjs-ng 在 ESP32 上有无法快速解决的编译阻塞（如需要 openat/epoll 等），记录阻塞点并做最小 stub 绕过，不要大改引擎源码；每处改动写进 VENDOR.md
- 不改 docs/roadmap.md 的里程碑定义；不顺手重构无关文件
- git 身份已是 congduan（repo 级已配），提交签名不要改
