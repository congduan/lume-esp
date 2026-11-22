# r156 SkyCombat 3D report

## Scope and implementation

`examples/skycombat/app.js` is a plain JavaScript app. It polls `lume.imu.read()` every 33 ms and uses the existing Canvas and gesture APIs. Firmware, runtime, prelude, CLI, and other examples were not changed. The actual `examples/raycast` routes rendering through `lume.raycast.render`; this app follows the pure Canvas pattern used by `skyfire`.

The camera is fixed at the player. For an enemy at `(x,y,z)`, projection is `screen = (240,240) + rotate(roll, ((x-aimX)*400/z, (y-aimY)*400/z))`. At `z=400`, a 40-unit x offset becomes 40 pixels; at `z=800`, it becomes 20 pixels. Enemy size scales with `400/z`. The sky and ground are fully redrawn every frame, while 12 radial grid lines and five traveling cross-lines rotate with the horizon. The airplane silhouette and sight remain fixed.

`roll = clamp(roll + (gz - bias)*dt/1000, -60, 60)`; `pitch = clamp(atan2(ax,az) - zero, -35, 35)`. The first still second establishes gyro bias and pitch zero. Each 10-second window re-zeroes if at least eight seconds have acceleration within 0.5 m/s2 of the initial gravity vector and gyro axes below 8 deg/s. This uses the stationary window's mean `gz` as bias. The host injection of a constant +0.8 deg/s bias leaves less than 5 degrees accumulated after 10 seconds. On-device axis orientation, pitch sign, and drift remain unverified.

When IMU read fails or returns invalid data, the app uses `roll=sin(t*0.7)*25` degrees and `pitch=sin(t*0.5)*12` degrees and shows `SIM` in the HUD. This is the browser playground path.

Tap fires at the fixed 28-pixel sight. A projected enemy circle must overlap and have `z<600`. Hits flash white and pause movement for three ticks; each destroyed enemy emits six particles. Three escaped enemies end the run. Wave N contains 4+N aircraft, queued through a six-aircraft active pool, with speed multiplied by 1.08 per wave.

## Draw budget

The host prelude counted a peak of **96/150 drawing calls** over 250 simulated frames. The approximate upper bound is: clear and two fills 3; ground scan lines 48; horizon 1; grid 17; six enemies x four 24; particles six; player five; sight five; tracer two; HUD five; game-over panel four = 120. Canvas line batching reduces wire messages but the harness counts individual batched lines. Full-canvas clear/fill on each draw prevents stale pixels after skipped ticks.

## Evidence

- `node tests/skycombat.js`: projection, gyro integration, drift re-zero, hit range, wave count, SIM mode, and skipped-tick redraw PASS.
- `node tools/lume/lume.js check examples/skycombat --no-emu`: PASS; emulated eval/layout were skipped by this mode.
- Playground rebuild: **56 apps**, matching the real 55-app baseline plus skycombat. The brief expected 57; the checked-in baseline contains 55 registrations.
- Browser reproduction selected skycombat on the playground page served locally. `SIM` appeared; no page errors. [Far frame](../artifacts/r156/far.png) and [near frame](../artifacts/r156/near.png) show growing aircraft, rolling horizon/grid, and legible HUD. Visual review: depth and roll are apparent; the near frame has an aircraft touching the sight.
- All 90 `tests/*.js` scripts passed in the final batch logs. An initial concurrent run of `gateway_upstream.js` failed an asynchronous frame-timing assertion; its [solo rerun](../artifacts/r156/gateway-solo.txt) and the final sequential batch both passed. The [scope guard](../artifacts/r156/ota-guard.txt) also passed after the app and test commits.
- Raw logs: [skycombat harness](../artifacts/r156/skycombat-harness.txt), [playground build](../artifacts/r156/playground-build.txt), [lume check](../artifacts/r156/lume-check.txt), [browser](../artifacts/r156/playwright.txt), [CLI tests](../artifacts/r156/cli-tests.txt), [website check](../artifacts/r156/website-check.txt), [host tests](../artifacts/r156/host-tests.txt).

```text
PASS projection, integration, drift re-zero, hit range, wave count
PASS real prelude SIM, full redraw after 8 skipped ticks, max 96/150

[PASS] bundle   5944 bytes (25 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)

# tests 50
# pass 49
# fail 0
# skipped 1

90 tests/*.js: PASS, 0 FAIL
```

## Deferred device acceptance

Actual board IMU axis mapping, physical control feel, gyro drift, frame time, touch input, display rendering, and battery impact require board bring-up. A green host harness and browser screenshot do not verify those properties.
