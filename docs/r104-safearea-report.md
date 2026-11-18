# r104 SafeArea 圆屏适配

## API 与实现

可选导入 `runtime/shell.js` 后，`lume.ui.shell.safeInsets(shape, size)` 是纯函数，按逻辑屏幕边长/直径返回 `{top,right,bottom,left}`。`shape` 只接受 `square` 或 `round`，`size` 必须是 1..16384 的整数像素；非法参数以 `lume: SafeArea …` 格式抛 `TypeError`。

`lume.ui.shell.SafeArea({shape, size, parent, children})` 返回一个 View。`square` 不留边距；`round` 将 View 放在圆内接正方形的位置，并令 View 的 `padding`、`gap` 为 0。组件默认 `shape:'square'`，`size` 默认为运行时屏幕宽度。调用方把内容布局在这个 View 的局部坐标中。没有固件改动。

创建时会检查直接子 View 在声明时可取得的数值 `x/y/width/height`。任一超出安全矩形时，本次 SafeArea 调用只发一次 `console.warn`，不阻止渲染。这个守卫无法预先计算百分比、`auto`、函数尺寸、非 View 节点及更深层后代，也不替代视觉检查。容器的实际裁切与排版仍需真机核对。

## 内切数学

直径为 `d` 的圆内接正方形满足 `side * sqrt(2) <= d`，因此取整数 `side = floor(d / sqrt(2))`。剩余像素按 `near = floor((d-side)/2)`、`far = d-side-near` 分到两边。奇数余量使右、下各多 1px，中心仍在像素网格中央。

| 逻辑直径 | `floor(d/√2)` | `top, right, bottom, left` |
|---:|---:|---|
| 466 | 329 | `68, 69, 69, 68` |
| 480 | 339 | `70, 71, 71, 70` |

r88 playground 把 480 逻辑画布缩到 466 物理预览并作圆形裁切，因此该预览应传 `size:480`；原生 466 逻辑坐标屏传 `size:466`。把 330px 内容居中放进 480 画布才会得到约 75px 的外边距，不能把这个数与 466 逻辑边距混用。

## 现有 app 迁移示例：counter

`examples/counter/app.js` 保持原样。若要给它增加圆屏版本，导入 shell 后将原有计数信号、主题和按钮回调保留，把最外层方屏 `View` 改为以下 SafeArea 内容。原来 480px 画布中的 24px 外边距和固定的 208px 卡片高度需要按 329px 可用区域重新排版；仅把原根节点直接放进 SafeArea 会保留那些固定尺寸。

```js
import '../../runtime/shell.js';

var count = signal(0);
var screenSize = 466; // 原生 466 逻辑屏；r88 playground 使用 480
var safe = lume.ui.shell.safeInsets('round', screenSize);
// safe = {top:68, right:69, bottom:69, left:68}

lume.ui.shell.SafeArea({shape:'round', size:screenSize, children:[
  View({style:{width:'100%', height:'100%', padding:12, gap:10,
    display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'space-between', scroll:'none'}}, [
    Text({text:'Counter', style:{fontSize:24}}),
    Text({text:function () { return String(count()); }, style:{fontSize:48}}),
    Button({title:'Add one', style:{width:220, height:56},
      onPress:function () { count.set(count()+1); }})
  ])
]});
```

方屏版本可传 `shape:'square'`，或继续使用现有根节点。布局变化只是应用代码选择使用组件时生效；这次没有改动任何现有 app。

## 验证

以下为主机测试和无模拟器 bundle 验证；未做 1.75C 真机显示、裁切和触摸验收。

```text
$ node tests/safearea.js
PASS safearea square insets are zero and children stay in full-size view
PASS safearea round 466 uses a centered inscribed 329 px square
PASS safearea oversized direct View children warn once without throwing
PASS safearea fitting direct children do not warn
PASS safearea invalid shape and size throw TypeError
PASS 5 safearea cases
```

```text
$ node tools/lume/lume.js check examples/counter --no-emu
lume check examples/counter

[PASS] bundle   2160 bytes (29 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

完整 JS harness 循环的原始汇总输出：

```text
tests/abc123.js: exit 0
tests/ai.js: exit 0
tests/animation_mapping.js: exit 0
tests/apps.js: exit 0
tests/async_jobs.js: exit 0
tests/aurora_clock.js: exit 0
tests/ble.js: exit 0
tests/canvas_mapping.js: exit 0
tests/canvas_prims.js: exit 0
tests/clock_round.js: exit 0
tests/compass.js: exit 0
tests/compress.js: exit 0
tests/create_failure.js: exit 0
tests/crypto.js: exit 0
tests/dashboard_round.js: exit 0
tests/decode.js: exit 0
tests/fft.js: exit 0
tests/files_dialog.js: exit 0
tests/fishtank.js: exit 0
tests/frogger.js: exit 0
tests/game_of_life.js: exit 0
tests/games.js: exit 0
tests/gesture_queue.js: exit 0
tests/gestures.js: exit 0
tests/golf.js: exit 0
tests/gravity_ball.js: exit 0
tests/image_mapping.js: exit 0
tests/imgscale.js: exit 0
tests/invaders.js: exit 0
tests/lcd_dual.js: exit 0
tests/lifecycle.js: exit 0
tests/list_virtualization.js: exit 0
tests/memory.js: exit 0
tests/minesweeper.js: exit 0
tests/music_player.js: exit 0
tests/particles.js: exit 0
tests/pet.js: exit 0
tests/piano.js: exit 0
tests/plasma.js: exit 0
tests/power.js: exit 0
tests/raycast_game.js: exit 0
tests/reload_staging.js: exit 0
tests/safearea.js: exit 0
tests/scroller.js: exit 0
tests/shell_components.js: exit 0
tests/skyfire.js: exit 0
tests/sokoban.js: exit 0
tests/spectrum.js: exit 0
tests/spectrum_music.js: exit 0
tests/style_mapping.js: exit 0
tests/tetris_dirty.js: exit 0
tests/text_payload.js: exit 0
tests/theme_mapping.js: exit 0
tests/voice_assistant.js: exit 0
tests/watchface.js: exit 0
tests/weather.js: exit 0
tests/webserver.js: exit 0
tests/ws.js: exit 0
```

CLI 单元测试原始结尾输出（`npm test --prefix tools/lume`）：

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 3213.067135
```

跳过的 1 项为需要本机 `qjsc` 的 bytecode 测试；CLI create scaffold 和 bundle 测试通过。
