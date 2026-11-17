# r90 fishtank 鱼形升级——r89 ellipse 图元回补鱼缸（主控接管收口轮）

## 背景

r87 的鱼缸因当时固件 Canvas 没有 ellipse，鱼身用 5 条变宽线段拼的（vision 验收结论「几何化/棱角分明」）。r89 落库三个新图元（`fillCircle` / `fillEllipse` / `ellipse` 描边，AA，桥 OP 6/7/8）后，本轮把鱼缸回补成真椭圆形态。本轮派发后引擎额度尽中断（`engine_exit=1`，out-of-credits），按纪律不切模型，主控接管收口——半成品已覆盖核心鱼形改造，主控补齐验证链、docs 与 commit 拆分。

## 鱼形改造（examples/fishtank/app.js）

- **身体**：4 站点 `fillEllipse` 椭圆链（头窄 5.2/5.0 → 中宽 6.4/8.2 → 后段 5.4/7.6 → 尾柄 3.6/4.6，坐标沿鱼体轴旋转），轴对齐图元经采样点贴合任意朝向。
- **双色**：腹部叠浅色 `fillEllipse`（深背浅腹），条纹鱼（size>1.1）额外叠 2 条垂直于体轴的深色细椭圆斑纹。
- **尾鳍**：保留双 polyline 弧形尾缘，随相位弯曲；背鳍 1 个小 fillEllipse；鳃盖线 1 条细 ellipse 描边；眼睛 `fillCircle` + 高光点。
- **层次**：绘制顺序按体型降序（大鱼先画在底层、小鱼后画在上层，近大远小）。

## 预算

每帧 137 次绘制调用峰值（harness 实测），远低于 200 断言上限，也低于简报预估的 250——椭圆链 4 站点方案没有超预算，无需降配。旧版预算账：15 fillRect + 3 光斑 + 15 水草 + 10 气泡 + 每鱼 ~18 调用。

## 验证（主控实测原始输出）

- `node tests/fishtank.js`：全绿。60s/1800-tick smoke、觅食转向、进食爆发、摆尾频率、prelude 集成、tap 投喂全部 PASS。`PASS prelude integration: tap feeding, no errors, max draw calls/frame=137`。
- `node tools/lume/lume.js check examples/fishtank --no-emu`：`RESULT: PASS (4 steps, 0 failed; exit 0)`，bundle 5,346 bytes。
- 全量 `for t in tests/*.js`：0 FAIL。
- `npm test --prefix tools/lume`：`# tests 44 / # pass 43 / # fail 0 / # skipped 1`。
- `node tools/playground/build.mjs`：PASS，`prelude 67016 bytes; 35 apps`，fishtank bundle 5,278 bytes，website/playground 三个产物文件更新。
- `PLAYWRIGHT_MODULE=… node tools/simulator/verify.js`：exit 0，10 PASS / 0 FAIL。
- 模拟器截图 3 张（artifacts/r90/01..03-fishtank.png，间隔 ~1.5/4/4s），浏览器 0 page error。vision 验收结论：**鱼身已从棱角线段拼图变为圆润椭圆链形态**，深背浅腹、竖条纹、眼点清晰可辨，橙白条纹鱼一眼可识为小丑鱼风格热带鱼；小体型鱼的腹色对比弱（已知取舍）。

## 局限与 pending

- 椭圆链在体型最小的鱼上仍偏「蝌蚪感」（4 站点对小尺寸过疏），加站点会超预算——登记为取舍。
- 所有验证均为 host / 浏览器仿真，无固件改动（纯 app 层），真机 30fps、AMOLED 色彩、触摸投喂手感 pending board。
