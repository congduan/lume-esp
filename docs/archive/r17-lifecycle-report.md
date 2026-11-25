# r17 lifecycle verification

## Sequence (engine task unless labeled)

- Boot: create QuickJS runtime → register native bindings → eval prelude → eval embedded demo → `onStart` → engine Queue B drain/timer tick.
- Hot replacement: USB RX validates LUME frame and queues RELOAD → engine invokes old `onPause` → clears lifecycle/timers → cancels animations → disposes effects, Canvas `onDraw` and press handlers → resets signal queue/version → posts UI RESET to Queue A (LVGL task deletes nodes/canvases) → frees old QuickJS runtime → eval new prelude/bundle → new `onStart`. Failed eval resets partial UI, then retries last good bundle.
- Pause/resume: USB RX sees `PAUS`/`RESM` → Queue B → engine invokes `onPause`/`onResume` once per transition; timer drain skips while paused and runs overdue timers once after resume. `BACK` dispatches `onBack`; strict `true` intercepts; otherwise engine shuts down the app and opens the embedded demo. Touch gesture source remains future work.

The existing 20ms Queue B wait is the tick source; the native monotonic clock is `esp_timer_get_time()`. No JS callback executes on USB RX or LVGL tasks. Synchronous audio and HTTP calls block this drain; a later worker plus fixed message completion event can remove that latency.

## Host harness

`node tests/lifecycle.js` exercises registration/unregistration and sequence, both onBack outcomes, timeout/interval timing, clear semantics, old effect/canvas/animation/timer disposal, registry clear, and fresh replacement start.

## Device acceptance

Compilation and host behavior are verified here. USB protocol, IMU polling, LVGL reset visuals, and timing under audio blocking await the main controller's board round.

## Raw verification output

```text
lume.bin binary size 0x1cdf80 bytes. Smallest app partition is 0x640000 bytes. 0x472080 bytes (71%) free.
[100%] Built target app_check_size
[100%] Built target app
│ Flash Code        │      1452558 │          │                │               │
│ Flash Data        │       317108 │          │                │               │
│ DIRAM             │       195819 │     57.3 │         145941 │        341760 │
│ IRAM              │        16384 │    100.0 │              0 │         16384 │
Total image size: 1892109 bytes (.bin may be padded larger)
Built target size
```

`docs/r16-canvas-report.md` records the latest prior bin as `0x1ccbb0`; the r17 bin is `0x13d0` (5,072 bytes) larger. This is a comparison to the recorded r16 build, not an independent rebuild of 1938fb6.

```text
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
all JS harnesses passed
```
