# r56 — Promise job drain (host and emulation evidence)

## Change and placement

`engine_task` drains QuickJS jobs after event dispatch, removal notifications, and `__lume_tick`, before its next `xQueueReceive` call. This includes Promise reactions created by press/timer callbacks and gives the next loop's `__lume_tick` a chance to check timer due times. The fixed 20 ms queue poll remains unchanged. The drain stops after 64 successful jobs per turn; any remaining jobs are deferred, and the warning is emitted once per runtime. A job exception is reported through the existing JS exception logger. The reload/launch `break` paths skip the drain and proceed to teardown, so jobs from a retiring runtime are not run. FIRSTFRAME is still posted before the inner loop; boot selection happens in the outer loop.

## Host evidence

`node tests/async_jobs.js`:

```text
async jobs host prelude: PASS
```

`node tools/lume/lume.js check examples/async_demo --no-emu`:

```text
lume check examples/async_demo

[PASS] bundle   510 bytes (34 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled

RESULT: PASS (4 steps, 0 failed; exit 0)
```

The host prelude test covers a basic `await Promise.resolve('ok')` continuation and a button press whose async callback updates a signal and the corresponding Text attribute. Node vm uses Node's microtask queue, so this alone does not establish QuickJS behavior.

`for t in tests/*.js; do node "$t" 2>&1 | tail -1; done` (last-line output, 23 scripts):

```text
Node local POST round trip: PASS
PASS color animation rejected
PASS 15 multi-app cases
async jobs host prelude: PASS
PASS failed start() is surfaced without starting the poll timer
PASS retainSegments uploads independent segments
PASS: Canvas failure latches dead id and native attrs become no-op
PASS files after: DEL -> Dialog -> Delete -> remove -> Toast
PASS breakout game over
PASS: MOVE pressure reserves capacity and UP reaches queue tail
PASS 20 r21 gesture cases
PASS gravity_ball the canvas holds exactly one ball and no ghost
PASS embedded PNG 1x1 decodes to exact opaque red RGBA bytes
PASS replacement starts fresh app without old callbacks
PASS 10 list virtualization cases
Restart: Last track and LRC offset restored, playback starts at zero PASS
PASS shutdown clears wake callbacks
PASS: successful post coalesces replacement and preserves latest frame
PASS 18 shell component cases
PASS embedded demo and refreshed counter both register buttons
PASS: external text payload has sender rollback and receiver release paths
PASS demo buttons recolor card, controls and full-screen root
PASS 13 weather cases (10 logic + 3 UI)
```

`npm test --prefix tools/lume`:

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

## Firmware and esp32sim evidence

Pending build and emulation completion. Physical board acceptance remains open.
