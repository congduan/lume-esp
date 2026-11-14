# Brookesia 借鉴清单（clean-room：只取概念与设计验证，不抄实现）

来源：`waveshareteam/ESP32-S3-Touch-AMOLED-2.16` main @ `225a62b` 的
`03_esp-brookesia/components/brookesia_core`（实验阶段，API 可能变化——概念级借鉴刚好避开了 API 不稳）。
逐条标注：Brookesia 怎么做（文件:行）→ Lume 采纳形态 → 排期。

## 1. App 生命周期契约（已验证：base_app.hpp:126-408）

Brookesia：`App` 抽象基类——`run/back/close/init/deinit/pause/resume/cleanResource`，
Phone manager 负责多 app 切换时调 pause/resume（资源紧张时 cleanResource 回收）。

**Lume 采纳（r17 已落地，真机待验收）**：JS app 生命周期钩子——
```js
lume.app.onStart(() => {})      // bundle eval 成功后的首次启动
lume.app.onPause(() => {})      // 切后台（停 IMU 轮询/动画省电）
lume.app.onResume(() => {})     // 暂停后回前台
lume.app.onBack(() => boolean)  // 返回键拦截：返回 true=已处理，false=默认退出
```
热更新场景比 Brookesia 更需要它：bundle 替换时旧 app 的 effect/timer/动画要可靠释放
（r4 已有 subtree disposal 地基）。这是「多 app 共存 + 启动器」的前置件。

## 2. Stylesheet Manager（gui/style/esp_brookesia_gui_stylesheet_manager.hpp:31）

Brookesia：主题样式表集中管理，运行时可切换（phone/stylesheets/ 目录放 JSON 样式表）。

**Lume 采纳（r18 已落地，与设计 token 合流）**：`lume.theme` 命名空间——
```js
lume.theme.set({ colors: { primary:'#0B1E3F', text:'#FFFFFF' },
                 radius: 12, fontScale: 1.0 });
```
prelude 把命名色注入样式解析（`background:'primary'` 引用 token），signal 化后全屏
联动重绘（复用 r14/r15 的属性消息管线）。暗色/亮色主题一键切，这是嵌入式设备
（夜间表盘/日间模式）的真实需求。r18 采用扁平 colors 表和 owned signal effect；
默认 radius 随主题更新，fontScale 只存储，字形大小留后续轮次。

## 3. Anim player（gui/anim_player/）

Brookesia：独立动画播放器组件（帧序列/动图）。

**Lume 评估**：r15 的 lv_anim 桥 + r16 canvas 已覆盖补间与自绘两族；帧序列动画
（Lottie 类）登记为 M5 组件库候选，不进 M3（复杂度高、当前无使用场景压力）。

## 4. AI framework（ai_framework/agent + expression）

Brookesia 实验性 AI agent 集成（表情/agent 状态机）——**反向印证了 Lume 路线**：
AI 驱动的 UI 是方向，但 Brookesia 用 C 状态机实现；Lume 的 JS 引擎天然能跑
agent 循环（LiveLoop 式取数+渲染）。不采纳其实现，记录为 Lume M5「AI 表情/
agent 状态组件」的产品方向证据。

## 5. systems/phone 的启动器/导航栏/多任务卡片

Brookesia 最有产品价值的部分：状态栏、app 抽屉、手势导航、最近任务卡片。

**Lume 采纳形态（M5 组件库的骨架清单，按 r17 生命周期刀铺路）**：
- 状态栏组件（时间/电量/WiFi 图标——全部有 JS API 数据源）
- 启动器模板（app 清单 → 图标网格 → 热更新加载对应 bundle）
- 最近任务 = hot-reload 机制天然支持的「多 bundle 存活切换」
这是「Lume 完成后超过 Brookesia」的关键落点：同样的壳元素，但 app 是热更新 JS。

## 排期决定

- r17：App 生命周期 + bundle 资源释放（本刀简报已可写）
- r18：lume.theme 设计 token 系统
- M5 首刀：状态栏/启动器模板组件（依赖 r17/r18）
- 不做：Squareline 式拖拽导出（与声明式哲学冲突）、帧序列动画播放器（延后）

## 用户指令溯源

2026-11-14 用户令：「可以借鉴一些 brookesia 的优秀的点进行完善」——本文档为执行记录。
