# r174 — watchface / imu_ball retained-path verification (host only)

Baseline: `origin/main` `f16bfd8` (2026-11-23), worktree `/tmp/lume-r174-wt`,
branch `r174-retained-paths`. No board was available; everything below is host
evidence only. **No on-device acceptance is claimed.**

## 1. Result up front: the migration already landed in r49

The dispatch brief quotes the original `docs/roadmap.md` backlog #6 text
("dashboard, watchface and imu_ball still rebuild geometry in JS every frame").
Before editing, the implementation and the r49 result section were read. The
premise is stale in three ways (same "assume wrong, verify first" discipline the
red lines require):

1. `docs/roadmap.md:352` ("r49 result — rendering backlog #6 + #7") records #6 as
   **closed on host/esp32sim**. The r49 commits are in this baseline:
   `38ad8f7` (watchface), `c261f08` (dashboard), `31f2689` (gravity_ball),
   `485e283` (docs).
2. `watchface` already consumes retained paths in the shipped app:
   `examples/watchface/app.js:37-47` uploads the 60 analog ticks as two
   `retainSegments` paths (48 minor + 12 major) and `examples/watchface/app.js:60-67`
   uploads the three full background rings as `retainPath` paths (121 edges each),
   all replayed with `drawPath`. The brief's own dashboard citation
   (`app.js:134-135`) is the same r49 wave.
3. `examples/imu_ball/` **does not exist** in this baseline. r36 renamed it to
   `examples/gravity_ball/` (`docs/r36-imu-ball-report.md:3-5`); its geometry is a
   single moving filled disc, not line segments. r49 measured the C-side
   retained-path variant and **rejected it**: 49 AA `canvas_line` replays raised
   core0 by 71M instructions, net total **+12 %**. The shipped retained form is a
   precomputed JS span table (`BALL_SPANS`, 49 rows), removing 49 `sqrt()` calls
   per frame.

**Decision: no app code was changed this round.** Applying `retainPath` to the
remaining watchface geometry would hard-fit dynamic data (the three progress
arcs depend on battery/steps/seconds; the three hands rotate) against the brief's
own rule ("若某面几何随数据每帧变形……留在立即模式，不许硬套") and the compass
precedent. Re-applying retained paths to gravity_ball would re-introduce the
measured +12 % regression. Both would be redoing r49 rather than advancing #6.
The useful work this round is therefore: instrumented before/after evidence,
permanent harness coverage for the already-shipped migrations, and the full
regression suite.

## 2. Instrumented JS rebuild counts (before / after r49)

Method: load the app in the real prelude host (`tests/lib/prelude_runner.js`),
call the draw functions with a counting canvas ctx. A JS segment rebuild is one
`c.line()` or one polyline edge; `retainPath`/`retainSegments` are counted once
at DEFINE time and `drawPath` replay costs zero JS segments. "BEFORE" is the
current source with **only** the r49 blocks mechanically restored to their
pre-migration immediate-mode form, so every other byte (including later SNTP /
goals / modular code) is identical. Script: `artifacts/r174/instrument.js`;
raw output: `artifacts/r174/instrument.txt`.

```text
=== watchface: analogDraw + ringDraw + goalDraw, one frame, fixed data ===
BEFORE (r49 reverted for ticks + bg rings): JS segments/frame=672 (line=63, polylineEdges=609) | native arc=6 circle=3 | DEFINE segments=0 pathEdges=0 | drawPath/frame=0
  retained definitions: []
AFTER  (shipped retained paths): JS segments/frame=249 (line=3, polylineEdges=246) | native arc=6 circle=3 | DEFINE segments=60 pathEdges=363 | drawPath/frame=5
  retained definitions: [["segments",48],["segments",12],["path",121],["path",121],["path",121]]
RESULT watchface JS segments/frame 672 -> 249 (-423, 62.9%)

=== gravity_ball (imu_ball successor): disc(), one frame ===
BEFORE per-frame Math.sqrt calls=49, fillRect spans=49
AFTER  per-frame Math.sqrt calls=0, fillRect spans=49
RESULT gravity_ball per-frame trig evaluations 49 -> 0 (-49)
C-side retained line segments: 49 replayed via drawPath -> REJECTED in r49 (+12% total),
                               see docs/roadmap.md r49 result section.
```

The 249 remaining watchface segments are exactly the dynamic geometry that must
stay immediate-mode: 246 polyline edges from the three progress arcs plus 3
`line()` calls for the rotating hands. Native `arc` (6) and `circle` (3) ops cost
no JS segments. This reconciles the brief's "段数应有可测下降" requirement with
its "dynamic parts stay immediate" rule: the 62.9 % drop is already in the
shipped app, and the remaining segments are deliberately not retained.

## 3. Cascade changes

- `tests/watchface.js` — added static contract (ticks + 3 rings retained, old
  per-frame rebuilds absent), live assertions on the real `pathDefine` /
  `pathDraw` stream (48/12/121/121/121 flat segments defined exactly once;
  `faceNow` redraw replays 5 paths, `faceBatt` redraw replays 3; zero new
  DEFINEs), and two mutation proofs (removing ticks block, removing rings block).
- `tests/gravity_ball.js` — the existing `imu_ball` harness. Added static span-cache
  contract, a live 0-`sqrt()` / 49-`fillRect` measurement, and a mutation proof.
- `tests/ota_consumers.js` — added the two harnesses, this report and the eight
  enumerated `artifacts/r174/` files to `ALLOWED`. Paths are enumerated rather
  than prefix-wildcarded, so the guard is not loosened.
- Grep sweep: no `=== <number>` manifest/app-count assertion is affected (no
  manifest or app count changed). `tests/sntp_consumers2.js` references
  `watchface` only through the r130 sync block (ASCII literals + cadence gate);
  it is byte-scoped to that block and unaffected. No guard was deleted or
  weakened; all additions are assertions.
- `tests/ota_consumers.js` BASE stays pinned at `80e76b2` (no `runtime/` change),
  so no r162/r165 re-pin or extra regression was needed.

## 4. Verification (raw output in `artifacts/r174/`)

| # | Command | Result | Artifact |
|---|---|---|---|
| 1 | `gcc ... tests/canvas_aa.c && /tmp/lume_canvas_aa` | 19 PASS + `ALL CANVAS AA HOST TESTS PASSED`, EXIT=0 | `aa-raster.log` |
| 2 | `for t in tests/*.js; do node $t \|\| echo FAIL $t; done` | 100 harness files, `FAIL_COUNT=0`, `PASS_COUNT=1440` | `js-harnesses.log` |
| 3 | `npm test --prefix tools/lume` | 52 tests, 51 pass, 1 skipped, 0 fail, EXIT=0 | `cli-tests.log` |
| 4 | `python3 scripts/check_website.py` | API missing/invented/duplicates/signatures-not-found: **none**, EXIT=0 | `website-check.log` |
| 5 | JS rebuild instrument | watchface 672→249 segments/frame; gravity_ball 49→0 `sqrt()`/frame | `instrument.txt` |
| 6 | `idf.py build && idf.py size` | **not required**: `git diff --name-only HEAD -- firmware/ runtime/ tools/` is empty (COUNT=0); no firmware flash/IRAM delta | `git-diff-stat.log` |

The wordle存量 flake did not reproduce: `tests/wordle.js` passed on the first run
in both full-loop executions (`ALL WORDLE HARNESS CASES PASSED`); no separate
re-run was needed. Raw wordle lines and that disposition are in
`artifacts/r174/wordle-recheck.log`.

## 5. Invariants held

- ASCII discipline: every new harness literal is ASCII. Existing watchface CJK
  complications are untouched; r64 scopes the ASCII rule to the added sync
  block (`docs/KNOWN-SIMPLIFICATIONS.md`), not the whole file.
- Watchface canvas budget: `tests/watchface.js:26` still asserts exactly
  `228544/230400 px`; no canvas size changed. The assertion was not edited.
- No firmware, runtime, prelude, `.d.ts`, vendored or tools/ source was changed.
  No commit was pushed.

## 6. Deferred

Board-level verification (display/touch feel, sleep current, radio, OTA push,
on-device frame rate) remains deferred to board bring-up, per AGENTS.md §1.
The r49 emu A/B numbers (`docs/roadmap.md:352`) are host/simulator evidence, not
hardware verification.

## 7. Commits

- `test(r174)`: harness coverage + ota allowlist.
- `docs(r174)`: this report + `artifacts/r174/` evidence.

No `feat` commit: the implementation was already shipped in r49, and redoing it
would either violate the dynamic-geometry rule or regress total instruction
count. This is recorded as a premise correction rather than silently skipped.
