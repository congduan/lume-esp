# r155 ClickWheel and music UI

## API and scope

`lume.ui.shell.ClickWheel({ parent, cx, cy, outerR, innerR, onRotate, onCenterTap, onOuterTap })` returns its Canvas node. Coordinates are absolute screen pixels. `outerR` is at least 40 px and `innerR` is positive and smaller than `outerR`. The component registers `panstart`, `pan`, `panend`, and `tap` on that Canvas. `lume.ui.shell.dispose(node)` removes it and unregisters all four handlers. Rotation emits signed integer steps. Center tap emits no argument; outer tap emits `0` top (menu), `1` right (play), `2` bottom (previous), or `3` left (next). The outer tap sectors span 45 degrees centered on each cardinal direction; taps in the gaps do nothing. Visuals use the theme's `surfaceAlt`, `surface`, and `textDim` colors. There is no lettering on the wheel.

ClickWheel stores only a transient angle and fractional step remainder during one pan. It does not own a list index, volume, or playback state. The app owns those values in signals.

## Angle math

For an annular touch `(x,y)`, angle is `atan2(x-cx, cy-y)`, measured clockwise from 12 o'clock. The initial press position is reconstructed from `panstart`'s `(x-dx,y-dy)`, since the prelude emits `panstart` after its movement threshold. Each next pan sample contributes the shortest wrapped angular difference in `(-pi,pi)`. One step is `2*pi/16 = pi/8` radians (22.5 degrees), equal to one sixteenth of the outer circumference. Unused fractional angle carries to the next sample in the same pan. Out of ring samples reset the accumulator; an isolated move cannot emit a step.

## Music UI and patent boundary

`examples/ipod_music` has ten original track names, a five-row highlighted list, and a playback page with a Canvas progress ring and time. Wheel rotation selects a list item or changes progress by five seconds per step. The center opens the selected track. Outer sectors return to the list, toggle a UI play state, or change tracks. A one-second timer advances the ring while the UI play state is active. The page states `DEMO - UI ONLY / NO AUDIO`; no MP3 decoding or output is claimed. The component implements annular gesture translation only. Its unlettered theme-token appearance does not reproduce Apple branding or the Click Wheel's marked visual layout.

## Evidence

- `artifacts/r155/list.png`: list with selected row and wheel.
- `artifacts/r155/play.png`: playback page with progress ring, track, time, and wheel.
- `artifacts/r155/lume-check.txt`: host bundle PASS; emulator, layout, and performance steps skipped under `--no-emu`.
- `artifacts/r155/api-docs.txt`: generated API page contains `lume.ui.shell.ClickWheel`.
- `artifacts/r155/playground-build.txt`: the repository builder generated its hard-coded 55 entries.
- `artifacts/r155/playground-extra.txt`: a one-off build added `ipod_music`, giving the checked-in playground 56 editable sources and 56 bundles. `tools/playground/build.mjs` remains fixed at 55 because this brief forbids changes to `tools/`; rerunning only that script will remove `ipod_music` from `sources.js` until `node artifacts/r155/playground-extra.cjs` is repeated.
- `artifacts/r155/host-tests.txt`: host harness output (89 harnesses, 0 failed).
- `artifacts/r155/cli-tests.txt`: CLI tests (49 passed, 1 skipped).
- `artifacts/r155/playground-page.txt`: browser selector and demo-render check.

On-device visuals, touch feel, audio, and timing remain unverified. The screenshots and harnesses are host evidence only.

### Raw gate output

```text
lume check examples/ipod_music
[PASS] bundle   22084 bytes (33 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)

wrote website/api.html: 158 API rows, 9 global helpers
PASS esbuild-wasm assets and 55 editable sources
PASS extra ipod_music bundle 22084 bytes; 56 editable sources
TOTAL 89 harnesses, failed=0
# tests 50
# pass 49
# fail 0
# skipped 1
```
