# r80 Lantern Vault 游戏战报

## 结论与范围

`examples/raycast/` 已升级为原创三关像素迷宫游戏：贴图墙、两类敌人 billboard、巡逻与视野追击、拾取、开门、出口/清场胜利条件、三格生命、分数、96×96 探索小地图和四种短音效。名称和像素造型均为原创。触摸操作为轻点前进、按住射击、横向拖动转向。死亡重开本关，通关第三关后轻点重启。

模拟器的 480×460 场景加 96×96 小地图共 230,016 Canvas 像素，低于 230,400 的预算。原生字体缺少心形字形，HUD 用 `<3` 表示每格生命。纹理版完整 480 列核超出 20ms；根据实测采用每 4 列采样并复制的 q=4 档位，近距 sprite 高度上限 128px，最多绘制最近两只，全部敌人仍参与 AI 与碰撞。最终开局 12.40ms、近距遭遇 14.78ms、第二关 13.50ms，均为模拟器 C 核计时，不含 UI 队列、LCD 传输和真机持续帧率。真机验收仍待完成。

## 性能与素材

| 项目 | 原始结果 | 口径 |
| --- | --- | --- |
| r79 无纹理 | 11.22ms/帧，89.1fps 等效 | 同一模拟器、480×480 C 核，来自 r79 记录 |
| r80 纹理 q=1 | 35.41ms/帧，28.2fps 等效 | 降档前的 480×460 场景；超硬线，已降档 |
| r80 纹理 q=4 开局 | 12.40ms/帧，80.7fps 等效 | 最终固件，120 DDA 射线/帧 |
| r80 纹理 q=4 敌人近景 | 14.78ms/帧，67.7fps 等效 | 两只最近敌人可绘；其余仍更新 AI |
| r80 纹理 q=4 第二关 | 13.50ms/帧，74.1fps 等效 | 过关场景种子 |

宿主成对 benchmark（x86，`gcc -O3`，120 帧；数值不能换算为 ESP32-S3）：

```text
C host 480x480 frames=120 ms/frame=0.332 equivalent_fps=3010.4 checksum=2771600972
C host textured 480x480 frames=120 ms/frame=0.505 equivalent_fps=1979.1 checksum=1932189160
C host textured q4 480x480 frames=120 ms/frame=0.203 equivalent_fps=4930.7 checksum=1936797312
vendored QuickJS JS DDA 480 columns frames=120 ms/frame=0.667 equivalent_fps=1500.0 hits=57600
```

降档探测时的模拟器串口原文；q=2 的单次值贴近硬线，因此最终选择 q=4：

```text
I (3104) lume-ui-bridge: MAZE FRAME 35.41ms 28.2fps hp=3 q=1
I (4120) lume-ui-bridge: MAZE FRAME 19.99ms 50.0fps hp=3 q=2
I (5146) lume-ui-bridge: MAZE FRAME 12.38ms 80.8fps hp=3 q=4
I (6154) lume-ui-bridge: MAZE FRAME 12.38ms 80.8fps hp=3 q=4
I (7162) lume-ui-bridge: MAZE FRAME 12.38ms 80.8fps hp=3 q=4
I (8170) lume-ui-bridge: MAZE FRAME 12.38ms 80.8fps hp=3 q=4
```

三张 16×16 纹理索引总计 768B（每张 256B），RGB565 调色板 32B；两只敌人各 16×16 的原创字符贴片约 512B，均为 flash 常量/JS 源常量，未标入 IRAM。四段 PCM 音频分别为 42/38/45/45ms，16kHz、16bit、立体声，单段同步 `audio.play` 不超过 48ms；[生成脚本](../tools/raycast/generate-sfx.js)和 [WAV 样本](../artifacts/raycast/sfx/) 可重放参数。开门动画与第二武器本刀未做。

## 视觉与模拟器证据

- [开局截图](../artifacts/emu/raycast/tft.png)：砖、石两种墙面可辨，左上 96×96 小地图按半径揭示；HUD 显示三格生命。
- [遭遇截图](../artifacts/emu/raycast-encounter/tft.png)：第三关追击者贴片清晰可见，墙列深度遮挡没有穿墙伪影；HUD 与清场目标可见。
- [过关截图](../artifacts/emu/raycast-passage/tft.png)：第一关拾取后 `collect → won → next` 进入第二关，HUD `SCORE 100`、目标文字和墙面改变。

逐张目视检查以上 PNG，没有发现错列、贴片穿墙或 HUD 缺字。遭遇及过关图使用 [场景种子脚本](../tools/raycast/make-scene.js) 在首个游戏 tick 前设置起点；它们验证固件渲染、精灵及关卡转换路径，并非触摸全程回放。开局图使用未修改的正式 app。完整串口见各截图同目录 `serial.log`；以下为原始标记。

开局：

```text
I (3082) lume-ui-bridge: MAZE FRAME 12.64ms 79.1fps hp=3 q=4
I (4095) lume-ui-bridge: MAZE FRAME 12.39ms 80.7fps hp=3 q=4
I (5102) lume-ui-bridge: MAZE FRAME 12.40ms 80.7fps hp=3 q=4
I (6109) lume-ui-bridge: MAZE FRAME 12.40ms 80.7fps hp=3 q=4
I (7121) lume-ui-bridge: MAZE FRAME 12.40ms 80.7fps hp=3 q=4
I (8128) lume-ui-bridge: MAZE FRAME 12.40ms 80.7fps hp=3 q=4
```

遭遇：

```text
I (3089) lume-ui-bridge: MAZE FRAME 15.02ms 66.6fps hp=3 q=4
I (4123) lume-ui-bridge: MAZE FRAME 14.78ms 67.7fps hp=3 q=4
I (5156) lume-ui-bridge: MAZE FRAME 14.78ms 67.7fps hp=3 q=4
```

过关：

```text
I (3086) lume-ui-bridge: MAZE FRAME 16.71ms 59.8fps hp=3 q=4
I (4093) lume-ui-bridge: MAZE FRAME 13.51ms 74.0fps hp=3 q=4
I (5104) lume-ui-bridge: MAZE FRAME 13.51ms 74.0fps hp=3 q=4
I (6115) lume-ui-bridge: MAZE FRAME 13.50ms 74.1fps hp=3 q=4
I (7126) lume-ui-bridge: MAZE FRAME 13.50ms 74.1fps hp=3 q=4
I (8132) lume-ui-bridge: MAZE FRAME 13.50ms 74.1fps hp=3 q=4
```

## 测试原始输出

`node tests/raycast_game.js`：18 条关卡 BFS、碰撞、AI、拾取、生命、胜利与声音参数断言；C 核 UV、精灵可见与 z-buffer 遮挡断言。

```text
PASS three rectangular levels and bounded map values
PASS BFS reaches exit or every enemy spawn in all stages
PASS three textures carry exactly 768 in-range indices
PASS 16x16 brick and portal texels are distinct
PASS collision blocks wall with player radius
PASS collision admits open corridor
PASS step moves forward and reveals fog
PASS closed door opens and becomes passable
PASS pickup grants 100 only once
PASS patrol reverses at a wall
PASS hunter changes to chase only with line of sight
PASS wall blocks line of sight
PASS shoot rejects occluded or off-axis target
PASS shoot clears aligned visible target and scores
PASS exit cell completes stages one and two
PASS arena requires every enemy cleared
PASS damage has cooldown and resets current stage on death
PASS four sound heads remain within 48 ms stereo PCM
raycast game: 18 cases PASS
PASS raycast UV center east: u=7 v=8 palette=6 rgb565=0xc638
PASS sprite visible at center rgb565=0x4149
PASS sprite occluded by column z-buffer rgb565=0x9d14
```

全量 `for t in tests/*.js; do node "$t" ...; done` 原始输出（445 行、零 `FAIL`）：

首轮全量测试曾暴露 `tests/memory.js` 的随机牌面假设：固定索引 5、6 偶尔成对。已改为按实际牌面选不同花色，随后全量重跑零 FAIL。首轮失败原文保存在 [harness.log](../artifacts/raycast/harness.log)。

```text
PASS 62 SVG outlines and 26 Aa pairs have valid structure
PASS 36-card deck, words and digit dot counts
PASS Image glyph and auxiliary Canvas nodes
PASS page advance, Z-to-0 transition and Image bounce
PASS four-mode cycle, random bag and vertical Aa source
PASS number-dot Canvas draws three filled arcs
ALL ABC123 HARNESS CASES PASSED
request construction + key storage: PASS
HTTP error + timeout + bad JSON + truncation: PASS
Node local POST round trip: PASS
PASS initial transition value uses SET_ATTR
PASS transition signal.set emits ANIMATE with omitted from and ease-out
PASS ANIMATE_CANCEL path
PASS onComplete registered and dispatched through reverse event hook
PASS same-property replacement discards old completion
PASS color animation rejected
PASS apps entries merges meta.json and falls back per field
PASS apps entries tolerates a store without native metadata
PASS apps entries ignores malformed meta instead of throwing
PASS apps current() reports the running app id
PASS apps launch/home/remove return the native status codes
PASS apps setBoot pins independently of launch and home, then clears
PASS apps setBoot reports invalid ids and storage errors
PASS apps launcher pins itself and its edit exit clears the pin before home
PASS apps Launcher defaults to the installed app set
PASS apps Launcher tap launches the app by default (no host callback)
PASS apps explicit apps + onLaunch still override the store
PASS apps Launcher rejects a non-array app list
PASS apps embedded home renders a clock and one tile per installed app
PASS apps embedded home launches a tile and keeps BACK at the root
PASS apps embedded home shows an empty state with no apps
PASS 15 multi-app cases
async jobs host prelude: PASS
PASS lume.ble wiring (header, CMake, sdkconfig, natives, types, docs)
PASS onStart advertises; first poll of a live link sends HELLO
PASS poll drains one RX packet, verifies the link and acks it
PASS Ping Button press sends a ping
PASS Ping counter Text reflects the press
PASS negative read() status is handled by the app
PASS onPause / shutdown stops advertising
PASS failed start() is surfaced without starting the poll timer
PASS canvas create dimensions and fixed wire kind
PASS drawing command order and final invalidate
PASS r48 native arc emits one LUME_DRAW_ARC (opcode 5) with normalised args
PASS r48 native arc rounds fractional degrees and rejects bad angles
PASS optional dirty rectangles preserve local coordinates
PASS signal change redraws once; equal value stays idle
PASS canvas is adopted into flex layout flow at fixed size
PASS dimensions/coordinates/color/text/point bounds reject
PASS injected 390x390 screen governs canvas size, budget and draw bounds
PASS counter example retains count and theme behavior
SAMPLE messages (first 12): [["create",1,0],["attr",1,12,12],["attr",1,0,"taps: 0"],["create",0,0],["attr",2,1,2377581],["attr",2,16,100],["attr",2,3,120],["attr",2,7,1],["attr",2,8,2],["attr",2,9,2],["attr",2,11,6],["attr",2,12,12]]
SAMPLE totals: {"create":7,"attr":42,"press":3}
PASS 33 contiguous lines split at 32
CANVAS 240 points: old=239 messages / 27724 queue bytes; new=8 messages / 928 queue bytes + 3824 payload bytes
PASS 240-point polyline uses eight batches
CANVAS retained path: 2 segments uploaded once, 2 draws / 1 upload
PASS retained path uploads geometry once and replays from C
PASS retainSegments uploads independent segments
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
PASS: create-failed notice disposes signal effects and warns once
PASS: Canvas failure latches dead id and native attrs become no-op
PASS files before: DEL -> status confirmation -> DEL -> remove
PASS files after: DEL -> Dialog -> Delete -> remove -> Toast
PASS frogger four-direction hop + boundary clamp
PASS frogger vehicle collision
PASS frogger log carry displacement
PASS frogger water death
PASS frogger home fill + level up
PASS frogger difficulty speed-up
PASS frogger high-score KV + graceful failure
PASS frogger sprite spans precomputed once, stable across ticks
PASS frogger game over restart
PASS frogger canvas/events + tap-direction hops
ALL FROGGER HARNESS CASES PASSED
PASS life budget: GRID<=60, 9px cells, single canvas <=300x300
PASS life B3 birth: dead cell with exactly 3 live neighbours comes alive
PASS life B3/S23 survival 2-3, death 0-1 and 4+
PASS life stable 2x2 block is unchanged
PASS life torus edges wrap neighbour counts across all four borders
PASS life boot: glider seeded, RUN at 350ms, LIFE READY logged
PASS life STATIC layer: retainSegments uploaded exactly once (72 segments)
PASS life LIVE layer: each generation logs LIFE GEN and invalidates <30% of frame
PASS life glider translates while conserving 5 live cells
PASS life tap: empty cell plants glider; live cell toggles off
PASS life swipe up toggles play/pause; left/right cycle 200/350/500ms
PASS life longpress clears the grid
PASS life PATTERN cycles GLIDER -> LWSS -> PULSAR(48) -> RANDOM
life harness: 13 cases passed
PASS 2048 left
PASS 2048 right
PASS 2048 up
PASS 2048 down
PASS 2048 no change
PASS 2048 game over
PASS snake turns
PASS snake eats
PASS snake wall
PASS snake body
PASS snake IMU threshold and axis sign
PASS 2048 high score KV key
PASS snake high score KV key
PASS brkout high score KV key
PASS breakout wall rebound
PASS breakout brick
PASS breakout level
PASS breakout game over
PASS tetris clockwise wall kick
PASS tetris line clear, score and speed floor
PASS tetris lock scores cleared row
PASS tetris high score KV and graceful failure
PASS tetris canvas, tap rotation, pan follow, soft and hard drop, line log
PASS: DOWN MOVE UP retain FIFO order
PASS: MOVE pressure reserves capacity and UP reaches queue tail
PASS tap: short press with small displacement -> one tap with end coords
PASS tap boundary: displacement >= tapMovePx(10) is NOT a tap
PASS tap boundary: duration >= tapMaxMs(400) is NOT a tap (becomes longpress)
PASS longpress boundary: fires while still down once t-start >= 400ms
PASS longpress suppresses tap AND swipe on release (no double-fire)
EVIDENCE pan stream types=["panstart","pan","pan","panend"] final dx/dy=35/2
PASS pan stream: panstart -> pan* -> panend, with dx/dy from press start
PASS swipe: LVGL gesture-dir hint (right=2) wins over axis inference
PASS swipe: axis fallback when no LVGL dir hint (vertical -> down)
PASS swipe speed gate: a 5s STATIONARY hold is a longpress, never a swipe
PASS r21-fix: a SLOW drag held past 400ms is pan, NEVER longpress (movement gate)
PASS r21-fix: a slow drag that ends fast stays swipe-eligible (no longpress steal)
PASS r21-fix: slow long drag (dist>=50px, vel<min) is neither longpress nor swipe
PASS swipeMinVel is a real, tunable gate (raise it -> slow drag stops swiping)
PASS scroll-cancelled UP: a List scroll wins, no tap/swipe/longpress
PASS tuning is centralized and tunable: swipeMinPx can be raised at runtime
PASS on() enables LVGL events once per node and rejects bad type/callback
PASS  dispatched GestureEvent reaches the right callback with coordinates
PASS unregister function is idempotent and stops future delivery
PASS longpress then release: no tap delivered; onPress (CLICKED) suppressed
PASS normal tap: onPress AND gesture tap both fire (no longpress latch)
PASS dispose clears per-node gesture state (removed node stops dispatching)
EVIDENCE demo tap -> status="tap (61,100)" taps=1
PASS examples/gestures/app.js evaluates and its tap counter responds
PASS example swipe changes page and longpress toggles color
PASS 20 r21 gesture cases
PASS gravity_ball gravity accelerates and displaces
PASS gravity_ball the screen edge clamps and reflects normal velocity
PASS gravity_ball tilting the other way reverses the fall direction
PASS gravity_ball dt cap limits delayed tick
PASS gravity_ball a hard tilt keeps the ball inside the screen
PASS gravity_ball the first frame paints the canvas once and invalidates all of it
PASS gravity_ball no frame falls back to the whole canvas
PASS gravity_ball per-frame raster stays far below a full repaint
PASS gravity_ball the dirty rect tracks the ball and stays small
PASS gravity_ball the canvas holds exactly one ball and no ghost
PASS Image create/source/size message order
PASS Image participates in View flex child adoption
PASS Image preserves aspect ratio for one explicit dimension
PASS Image forwards two explicit raster dimensions
PASS Image propagates decoder error and removes failed node
PASS Image rejects invalid input and propagates header error
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
PASS invaders formation direction flip at right edge
PASS invaders edge contact descends one row
PASS invaders bullet hit removes member + score
PASS invaders player hit loses lives / game over
PASS invaders UFO adds bonus score
PASS invaders wave speed-up and formation reset
PASS invaders last kill enters next wave
PASS invaders high-score KV + graceful failure
PASS invaders sprite spans precomputed once, stable across ticks
PASS invaders game over restart
PASS invaders canvas/dirty budget, pan follow, tap fire, swipe pause
ALL INVADERS HARNESS CASES PASSED
PASS lcd ghost geometry bounded (A=124, B=99) + lit/ghost split
PASS lcd dual state machines independent
PASS lcd bread catch + score
PASS lcd MISS count + 3-miss game over
PASS lcd bread 3-stage fall + phase wrap
PASS lcd lane collision = one-hit game over
PASS lcd lane clamp + dodge scoring
PASS lcd MODE switch cleanup + score preservation + reset
PASS lcd score KV (<=15 char key, graceful failure)
PASS lcd canvas/ghost-once/dirty budget, A+B swipes, MODE button
ALL LCD_DUAL HARNESS CASES PASSED
PASS registration, unregistration and start/pause/resume sequence
PASS onBack unregistered selects default
PASS onBack false selects default
PASS onBack true intercepts
PASS timeout once and interval skips missed periods
PASS timer clear is idempotent
PASS paused timer waits and resumes without catch-up burst
PASS hot replacement disposes effect, canvas onDraw, animation and timer
PASS shutdown clears lifecycle and timer registries
PASS replacement starts fresh app without old callbacks
EVIDENCE 1000 items / 12 visible: actual created nodes=17 (15 rows + container + spacer)
PASS 1000 items, 12 visible: initial 15 rows, 17 total nodes
EVIDENCE 1000 items / 12 visible: middle window live nodes=20 (18 rows + 2 fixed)
PASS scroll maps to 18-row middle window
PASS scroll window reclaims old rows before creating replacements
PASS small scroll within same window does not churn nodes
PASS same-length items replacement rebuilds window and keeps offset
PASS length change rebuilds and resets scroll to top
PASS removed row loses press callback and signal effects
PASS 1000-item traversal stays within the 127-node table
PASS bridge throttle and overflow policy are present
EVIDENCE files seedTestEntries(): 1000 entries, 40 new nodes
PASS files example seeds 1000 entries without creating 1000 rows
PASS 10 list virtualization cases
PASS memory deal: 16 cards, 8 faces x2
PASS memory shuffle: deterministic under injected rnd, true permutation
PASS memory single flip: one-open, moves not yet counted
PASS memory match: pair removed, counter advanced
PASS memory miss: face-up window, flipback on tick, cards stay in play
PASS memory negative: no double-flip, no third-card flip
PASS memory negative: range/matched/won guards
PASS memory full game: 8-pair clear, WIN event, best=8 saved
PASS memory best: worse keeps / fewer overwrites / equal keeps
PASS memory spans: 8 faces decoded, palette refs all valid
PASS memory canvas budget: 230400 px single canvas, grid in bounds
PASS memory solvability: 20 random deals all contain exactly 8 pairs
ALL tests/memory.js PASS
PASS minesweeper deal: fresh board, mines pending first tap
PASS minesweeper neighbors: corner=3 edge=5 interior=8, in bounds
PASS minesweeper placement: 15 mines, first-tap 3x3 safe, counts correct (10 boards)
PASS minesweeper first tap: always digs, placement deterministic under seed
PASS minesweeper flood: zero region opens, boundary counts stay closed
PASS minesweeper flood vs flags: flagged cells are not auto-opened
PASS minesweeper flag: toggle + guards on revealed/out-of-range
PASS minesweeper dig-vs-flag: flag blocks the dig, unflag re-opens
PASS minesweeper boom: round over, mines revealed, hit cell marked
PASS minesweeper win: 85 safe cells, WIN event, best time saved
PASS minesweeper best: worse keeps / lower overwrites / equal keeps
PASS minesweeper tick: clock runs only between start and end
PASS minesweeper spans: 10 sprites decoded, palette refs all valid
PASS minesweeper canvas budget: 230400 px single canvas, grid in bounds
PASS minesweeper solvability: 20 random boards all diggable to a win
ALL tests/minesweeper.js PASS
LRC normal: PASS
LRC skip untimed: PASS
LRC sort: PASS
LRC bad GBK bytes: PASS
Scheduler: ticks=7 decoded=5 sent=4 retry=2 PASS
Scheduler: stop and negative-index wrap PASS
Lyrics: five-line window and missing LRC PASS
Library: recursive scan, ID3 title order, last track and offset KV PASS
Restart: last track and LRC offset restored, playback starts at zero PASS
PASS pet app loads: IDLE, skin 0, precomputed sprite spans and one full paint
PASS pet buildSpans merges runs and covers exactly the non-empty cells
EVIDENCE PET PET happy=77 state=HAPPY | state=HAPPY
PASS pet tap = pet: happy rises, state -> HAPPY (via gesture dispatch)
EVIDENCE PET FEED hunger=15 state=IDLE | state=IDLE
PASS pet longpress = feed: hunger drops (via gesture dispatch)
PASS pet IMU magnitude spike = startle: -> SURPRISED, then decays back
PASS pet time decay drives hunger into HUNGRY and feeding resolves it
PASS pet sleep is timer-driven; wake()/startle resumes, sleeping decays slowly
EVIDENCE skin KV keys=["pet.skin"]
PASS pet skin switch writes pet.skin (<=15 chars) and wraps modulo 2
PASS pet a fresh runtime restores the persisted skin on boot
PASS pet bad KV values fall back to skin 0 (no negative-number discriminator)
EVIDENCE idle dirty rects=12 widths=72,84,96,96,72,84,96,96,72,84,96,96
PASS pet idle animation repaints only the eye rows (<=96px wide, 12px tall)
EVIDENCE sleep 40 ticks -> draws=0 invalidates=0
PASS pet sleeping never repaints the canvas across many ticks
PASS 12 pet host cases
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
PASS wake registration, unregister, and success-only dispatch
PASS touch feeds idle timer and wake resets activity
PASS shutdown clears wake callbacks
PASS three rectangular levels and bounded map values
PASS BFS reaches exit or every enemy spawn in all stages
PASS three textures carry exactly 768 in-range indices
PASS 16x16 brick and portal texels are distinct
PASS collision blocks wall with player radius
PASS collision admits open corridor
PASS step moves forward and reveals fog
PASS closed door opens and becomes passable
PASS pickup grants 100 only once
PASS patrol reverses at a wall
PASS hunter changes to chase only with line of sight
PASS wall blocks line of sight
PASS shoot rejects occluded or off-axis target
PASS shoot clears aligned visible target and scores
PASS exit cell completes stages one and two
PASS arena requires every enemy cleared
PASS damage has cooldown and resets current stage on death
PASS four sound heads remain within 48 ms stereo PCM
raycast game: 18 cases PASS
PASS: A post failure frees only A; B posts latest frame with pending set
PASS: successful post coalesces replacement and preserves latest frame
PASS shell Card and IconButton expose watch-sized defaults
PASS shell StatusBar getter follows signal
PASS shell StatusBar clock timer and disposal
PASS shell EdgeNavigation true handles back
PASS shell EdgeNavigation false forwards page swipe
PASS shell indicator draws and rebounds, mask toggles
PASS shell Launcher creates bounded virtual grid
PASS shell app press and edge gesture route independently
PASS shell dispose unregisters gestures and app close clears resources
PASS shell spacing injects missing View padding and gap and follows theme changes
PASS shell explicit spacing wins and invalid token is atomic
PASS shell Dialog opens and close is idempotent
PASS shell Dialog stack ignores covered button and closes top first
PASS shell Dialog lifecycle pause removes overlays
PASS shell danger button follows theme danger token
PASS shell primary button follows theme primary token
PASS shell Toast replaces current and resets timer
PASS shell Toast fades then removes itself
PASS 18 shell component cases
PASS sokoban single-box push + move counter
PASS sokoban no two-box push / no wall walk
PASS sokoban box cannot be pushed into wall
PASS sokoban goal coverage + all-boxes-home win
PASS sokoban corner deadlock + goal exemption
PASS sokoban all 10 levels BFS-solvable at stated par (data integrity)
PASS sokoban progress KV (<=15 char key, clamp, graceful failure)
PASS sokoban unlock + next/prev/restart navigation
PASS sokoban sprite spans precomputed once, stable across moves
PASS sokoban canvas/events, dirty budget, swipe push, tap push, reset button
ALL SOKOBAN HARNESS CASES PASSED
PASS spectrum single sine peak ±1 bin
PASS spectrum two tones produce two peaks
PASS spectrum Hann coherent gain normalization
PASS spectrum log groups strictly advance
PASS spectrum 256 FFT and 32 bars bounded
PASS spectrum tap starts one 1024-frame stream
PASS spectrum callback does not redraw canvas
PASS spectrum timer signal drives 400x200 dirty rect
PASS spectrum drop count and SPEC serial event
PASS spectrum stopStream clears callback and capture
PASS column + dimensions + color: [[1,728639],[16,100],[17,50],[7,1]]
PASS row: [[7,0]]
PASS row wrap: [[7,2]]
PASS column wrap: [[7,3]]
PASS justify start: [[8,0]]
PASS justify end: [[8,1]]
PASS justify center: [[8,2]]
PASS justify space-between: [[8,3]]
PASS justify space-around: [[8,4]]
PASS justify space-evenly: [[8,5]]
PASS stretch + gap + padding: [[9,3],[10,16],[11,8]]
PASS radius + border + opacity: [[12,12],[13,2],[14,11259375],[15,128]]
PASS pixel + legacy bg: [[1,1122867],[2,240],[3,120]]
PASS vertical scroll + auto scrollbar: [[20,1],[21,1]]
PASS horizontal scroll + on scrollbar: [[20,2],[21,2]]
PASS scroll disabled + scrollbar off: [[20,0],[21,0]]
PASS per-side padding overrides box shorthand: [[10,8],[30,2],[31,4],[32,6],[33,10]]
PASS margin box + per-side margin: [[34,4],[38,12]]
PASS margin sides only: [[35,2],[36,3],[37,5],[38,7]]
PASS flex grow inside a flex row: [[7,0],[39,1]]
PASS auto sizing: [[43,1],[44,1]]
PASS min/max size bounds: [[45,10],[46,200],[47,20],[48,40]]
PASS absolute position escapes the flow: [[23,1],[18,4],[19,8]]
PASS relative position sends nothing: []
PASS translate px + percent: [[49,6],[52,50]]
PASS text align + long mode: [[53,1],[54,1]]
PASS align string + alignTo + alignOffset: [[40,5],[41,-8],[42,-4],[4,6]]
PASS align center: [[4,0]]
PASS align top-left: [[4,1]]
PASS align top-mid: [[4,2]]
PASS align top-right: [[4,3]]
PASS align bottom-mid: [[4,4]]
PASS align bottom-left: [[4,5]]
PASS align bottom-right: [[4,6]]
PASS align left-mid: [[4,7]]
PASS align right-mid: [[4,8]]
PASS align numeric constant: [[4,4]]
PASS aligned to parent with an offset: [[40,0],[42,12],[4,2]]
PASS outside align below a base node: [[40,7],[4,13]]
PASS outside align above a base node: [[40,7],[4,10]]
PASS outside align right of a base node: [[40,7],[4,19]]
PASS outside align corner: [[40,7],[41,4],[4,18]]
PASS outside align numeric constant: [[4,20]]
PASS invalid align/alignTo/alignOffset/flexGrow/margin/position/translate/text rejected in prelude
PASS Row presets flex row: [[7,0]]
PASS Column presets flex column: [[16,100],[7,1]]
PASS fontSize/letterSpacing/lineHeight: [[55,20],[56,1],[57,-2]]
PASS fontSize snaps + scales via theme.fontScale: [[55,18]]
PASS fontScale below 1 keeps faces in range: [[55,22]]
PASS invalid percentage/metric/color/opacity rejected in prelude
PASS all style mapping cases
PASS embedded demo and refreshed counter both register buttons
PASS line-clear frame: rect=[0,0,160,320] cells=200 redrawn=200 (rect subset of redraw)
PASS normal-drop frame: rect=[80,80,32,48] cells=6 redrawn=6 (still a tight dirty rect)
ALL PASS: tetris dirty-rect coverage invariant holds
PASS: 240-byte Chinese and 256-byte ASCII text accepted; 257 bytes rejected
PASS: external text payload has sender rollback and receiver release paths
PASS set/get returns an isolated snapshot
PASS named background and borderColor resolve
PASS hex literals remain valid
dark→light ATTR messages: [[1,1,15332090],[1,12,16],[1,14,2310751]]
PASS theme.set invalidates every named color and implicit radius
PASS unreferenced literal colors and explicit radius post no messages
PASS removing default radius clears inherited radius
PASS invalid theme is atomic
PASS disposed node stops receiving theme updates
PASS unknown token falls through to literal parser
demo dark→light ATTR messages: [[2,1,16777215],[7,1,15332090]]
PASS demo buttons recolor card, controls and full-screen root
PASS watchface five-page swipe cycle
PASS watchface canvas budget 228544/230400 px; modular uses zero canvas
PASS watchface weather updates only its own complication text
PASS watchface weather WiFi-down fallback --°
PASS watchface six native AA arcs; dirty area 46656 px
PASS watchface progress clamps 0..100
PASS weather WMO codes map to descriptions and icon kinds
PASS weather formatters degrade to -- instead of NaN
PASS weather weekDay parses the ISO date in UTC
PASS weather parseForecast keeps current values and caps the forecast at three days
PASS weather parseForecast rejects bodies it cannot use
PASS weather parseForecast survives a missing daily block and short arrays
PASS weather buildUrl asks for current + daily with auto timezone
PASS weather parseCity validates the Kv JSON
PASS weather dayAt falls back for out-of-range indexes
PASS weather icons issue the expected raster commands and repaint the whole canvas
PASS 10 weather logic cases
PASS weather refresh replaces the demo data
PASS weather request failure keeps the app usable
PASS weather non-200 response is reported
PASS 13 weather cases (10 logic + 3 UI)
PASS default closed and token required
PASS start, URL, and duplicate start
PASS token gate before JS dispatch
PASS exact route, welcome fallback, 404
PASS query decode and response framing
PASS 8 KiB request body cap and full POST to KV
PASS stop lifecycle
PASS built-in welcome and handler exception
webserver: 8 cases PASS
WebSocket host prelude: PASS
```

`npm test --prefix tools/lume` 原始输出保存在 [cli-tests.log](../artifacts/raycast/cli-tests.log)；摘要原文：

```text
1..44
# tests 44
# suites 0
# pass 43
# fail 0
# cancelled 0
# skipped 1
# todo 0
```

`node tools/lume/lume.js check examples/raycast --no-emu`：

```text
lume check examples/raycast

[PASS] bundle   7714 bytes (32 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

`python3 scripts/gen_api_docs.py --check`：

```text
api.html is up to date with lume.d.ts (126 entries)
```

`idf.py size` 原始摘要（完整输出在 [size.log](../artifacts/raycast/size.log)）：

```text
Executing action: size
Running make in directory /tmp/lume-r80-game-wt/firmware/build
Executing "make -j 4 all"...
[  0%] Built target partition_table_bin
[  0%] Built target custom_bundle
[  0%] Built target memory.ld
[  0%] Built target sections.ld.in
[  0%] Built target _project_elf_src
[  0%] Performing build step for 'bootloader'
[  0%] Built target __idf_esp_https_ota
[  1%] Built target __idf_esp_http_server
[  1%] Built target _project_elf_src
[  9%] Built target __idf_log
[  1%] Built target __idf_esp_http_client
[ 19%] Built target __idf_esp_rom
[  2%] Built target __idf_tcp_transport
[ 21%] Built target __idf_esp_common
[ 30%] Built target __idf_esp_hw_support
[  2%] Built target __idf_esp_adc
[ 32%] Built target __idf_esp_system
[  3%] Built target __idf_esp-tls
[  3%] Built target __idf_http_parser
[ 40%] Built target __idf_efuse
[  4%] Built target __idf_driver
[ 59%] Built target __idf_bootloader_support
[  4%] Built target __idf_esp_driver_twai
[ 60%] Built target __idf_esp_bootloader_format
[  4%] Built target __idf_esp_driver_ledc
[ 62%] Built target __idf_spi_flash
[ 68%] Built target __idf_hal
[  4%] Built target __idf_esp_driver_i2c
[ 69%] Built target __idf_micro-ecc
[  4%] Built target __idf_esp_driver_sdm
[  4%] Built target __idf_esp_driver_tsens
[ 92%] Built target __idf_soc
[ 94%] Built target __idf_xtensa
[  5%] Built target __idf_esp_driver_rmt
[ 96%] Built target __idf_main
[  5%] Built target __idf_esp_driver_sdspi
[ 98%] Built target bootloader.elf
[  5%] Built target __idf_esp_driver_sdmmc
[100%] Built target gen_project_binary
[  6%] Built target __idf_sdmmc
[  7%] Built target __idf_esp_driver_i2s
Bootloader binary size 0x5710 bytes. 0x28f0 bytes (32%) free.
[100%] Built target bootloader_check_size
[  7%] Built target __idf_esp_driver_mcpwm
[100%] Built target app
[  7%] Built target __idf_esp_driver_pcnt
[  7%] No install step for 'bootloader'
[  7%] Completed 'bootloader'
[  8%] Built target __idf_esp_gdbstub
[  9%] Built target __idf_esp_driver_spi
[  9%] Built target bootloader
[ 10%] Built target __idf_esp_wifi
[ 10%] Built target __idf_esp_coex
[ 15%] Built target __idf_wpa_supplicant
[ 16%] Built target __idf_esp_netif
[ 22%] Built target __idf_lwip
[ 22%] Built target __idf_vfs
[ 22%] Built target __idf_esp_vfs_console
[ 23%] Built target __idf_esp_driver_usb_serial_jtag
[ 24%] Built target __idf_esp_phy
[ 25%] Built target __idf_nvs_flash
[ 25%] Built target __idf_esp_event
[ 25%] Built target __idf_esp_driver_uart
[ 25%] Built target __idf_esp_psram
[ 25%] Built target __idf_esp_ringbuf
[ 25%] Built target __idf_esp_driver_gptimer
[ 25%] Built target __idf_esp_timer
[ 25%] Built target __idf_cxx
[ 26%] Built target __idf_pthread
[ 27%] Built target __idf_newlib
[ 28%] Built target __idf_freertos
[ 31%] Built target __idf_esp_hw_support
[ 31%] Built target __idf_esp_security
[ 32%] Built target __idf_soc
[ 32%] Built target __idf_heap
[ 33%] Built target __idf_log
[ 37%] Built target __idf_hal
[ 38%] Built target __idf_esp_rom
[ 38%] Built target __idf_esp_common
[ 41%] Built target __idf_esp_system
[ 43%] Built target __idf_spi_flash
[ 43%] Built target __idf_esp_mm
[ 44%] Built target __idf_bootloader_support
[ 44%] Built target __idf_efuse
[ 44%] Built target __idf_esp_partition
[ 44%] Built target __idf_app_update
[ 44%] Built target __idf_esp_bootloader_format
[ 45%] Built target __idf_esp_app_format
[ 46%] Built target mbedtls
[ 47%] Built target mbedx509
[ 53%] Built target mbedcrypto
[ 53%] Built target p256m
[ 54%] Built target everest
[ 54%] Built target __idf_mbedtls
[ 54%] Built target __idf_esp_pm
[ 55%] Built target __idf_esp_driver_gpio
[ 56%] Built target __idf_xtensa
[ 56%] Built target __idf_lume-svg
[ 57%] Built target __idf_esp_lcd
[ 58%] Built target __idf_wear_levelling
[ 58%] Built target __idf_lume-perf
[ 58%] Built target __idf_lume-raycast
[ 58%] Built target __idf_lume-gpio
[ 58%] Built target __idf_lume-adc
[ 65%] Built target __idf_bt
[ 66%] Built target __idf_joltwallet__littlefs
[ 67%] Built target __idf_espressif__esp_websocket_client
[ 67%] Built target __idf_app_trace
[ 67%] Built target __idf_unity
[ 68%] Built target __idf_console
[ 68%] Built target __idf_esp_driver_cam
[ 68%] Built target __idf_esp_driver_touch_sens
[ 68%] Built target __idf_esp_eth
[ 68%] Built target __idf_esp_https_server
[ 68%] Built target __idf_esp_hid
[ 69%] Built target __idf_protobuf-c
[ 69%] Built target __idf_espcoredump
[ 69%] Built target __idf_json
[ 70%] Built target __idf_mqtt
[ 70%] Built target __idf_nvs_sec_provider
[ 70%] Built target __idf_perfmon
[ 70%] Built target __idf_rt
[ 70%] Built target __idf_spiffs
[ 70%] Built target __idf_touch_element
[ 95%] Built target __idf_lvgl
[ 96%] Built target __idf_usb
[ 96%] Built target __idf_fatfs
[ 96%] Built target __idf_quickjs-ng
[ 96%] Built target __idf_lume-storage
[ 97%] Built target __idf_lume-net
[ 97%] Built target __idf_lume-ble
[ 98%] Built target __idf_cmock
[ 98%] Built target __idf_protocomm
[100%] Built target __idf_lume-engine
[100%] Built target __idf_esp_local_ctrl
[100%] Built target __idf_wifi_provisioning
[100%] Built target __idf_lume-power
[100%] Built target __idf_mp3_decoder
[100%] Built target __idf_lume-audio
[100%] Built target __idf_lume-imu
[100%] Built target __idf_lume-pmic
[100%] Built target __idf_lume-board
[100%] Built target __idf_lume-ui-bridge
[100%] Built target __idf_lume-hotreload
[100%] Built target __idf_main
[100%] Built target __ldgen_output_sections.ld
[100%] Built target lume.elf
[100%] Built target gen_project_binary
lume.bin binary size 0x2de220 bytes. Smallest app partition is 0x640000 bytes. 0x361de0 bytes (54%) free.
[100%] Built target app_check_size
[100%] Built target app
Running make in directory /tmp/lume-r80-game-wt/firmware/build
Executing "make -j 4 size"...
                           Memory Type Usage Summary
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ Memory            ┃              ┃          ┃                ┃               ┃
┃ Type/Section      ┃ Used [bytes] ┃ Used [%] ┃ Remain [bytes] ┃ Total [bytes] ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ Flash Code        │      2017296 │          │                │               │
│    .text          │      2017296 │          │                │               │
│ Flash Data        │       847812 │          │                │               │
│    .rodata        │       847556 │          │                │               │
│    .appdesc       │          256 │          │                │               │
│ DIRAM             │       239043 │    69.94 │         102717 │        341760 │
│    .bss           │       113736 │    33.28 │                │               │
│    .text          │       101679 │    29.75 │                │               │
│    .data          │        23628 │     6.91 │                │               │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
│    .text          │        15356 │    93.73 │                │               │
│    .vectors       │         1028 │     6.27 │                │               │
│ RTC FAST          │           72 │     0.88 │           8120 │          8192 │
│    .text          │           44 │     0.54 │                │               │
│    .rtc_reserved  │           24 │     0.29 │                │               │
│    .force_fast    │            4 │     0.05 │                │               │
│ RTC SLOW          │           32 │     0.39 │           8160 │          8192 │
│    .force_slow    │           32 │     0.39 │                │               │
└───────────────────┴──────────────┴──────────┴────────────────┴───────────────┘
Total image size: 3006879 bytes (.bin may be padded larger)
Note: The reported total sizes may be smaller than those in the technical
reference manual due to reserved memory and application configuration. The total
flash size available for the application is not included by default, as it
cannot be reliably determined due to the presence of other data like the
bootloader, partition table, and application partition size.
Built target size
```

IRAM 16,384/16,384，未超过硬线；可执行文件总镜像约 3,006,879B。`lume check --no-emu` 的 PASS 仅表示宿主打包检查；三次 emu 均单独完成重载与截图。

## 待上板验收

- 触摸旋转/前进/长按射击的实际手感与误触。
- 四段音效经真机扬声器的音量、延迟和失真；esp32sim 不建模声学外放。
- 连续运行的实际屏幕帧率、PSRAM 与 LCD 刷新链路；串口 `MAZE FRAME` 仅测 C 核。
