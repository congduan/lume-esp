# r172 StoryBook implementation report

Baseline: `origin/main` / `210229a` (fetched before work). All implementation is in `examples/storybook/app.js`; no firmware, runtime, prelude or CLI source changed.

## Delivered

- TF pack scan at `/storybook/<name>/`: `page-NN.mp3` sorted numerically; optional `page-NN.meta.js` fields are parsed as data and never evaluated. Missing meta yields audio-only reading. PNG loads through `Sd.readBinary` and `lume.image.decode` into the existing Canvas sprite path. The card image read limit remains 64 KiB.
- Fixed bookshelf and reading trees, gesture page turns, large 28 px captions, page number, mood-based corner mascot, circular hotspot, playback controls, and `storybook.last` KV continuation.
- One MP3 frame per 35 ms timer tick. The exclusive decoder closes for hotspot audio, then reopens the page and skips already played frames. Output failures show `MUTE`; page turns remain available. Browser/no-card path uses a labelled three-page sample with synthetic vector scenes and a short generated PCM cue.
- Browser Playground source and bundle, app picker entry, and three screenshots. The existing build script produced 66 app bundles; StoryBook was appended without editing `tools/`, yielding 67 bundled sources.

`artifacts/r172/playground-count.txt` confirms the final generated catalog:

```text
sources 67
bundles 67
missing 0
```

## Evidence

`node tests/storybook.js` (full output: `artifacts/r172/storybook-test.txt`):

```text
PASS pack: sorted pages, optional meta and audio-only page
PASS mutation page order
PASS mutation optional meta
PASS MP3 EOF advances only in automatic mode and within bounds
PASS mutation EOF gate
PASS mutation auto gate
PASS mutation last page bound
PASS hotspot circle inside, edge, outside
PASS mutation hotspot boundary
PASS mutation hotspot outside
PASS KV continuation roundtrip and rejection of stale page
PASS mutation KV page value
PASS missing TF directory activates labelled three-page sample
PASS mutation empty-library fallback
PASS host prelude loads the actual app with a three-page sample
PASS live sample ticks advance all three pages and stop at THE END
PASS playback failure switches the live reader to MUTE
PASS mutation sample has three pages
```

`node tools/lume/lume.js check examples/storybook --no-emu` (`artifacts/r172/lume-check.txt`):

```text
[PASS] bundle   9293 bytes (221 ms)
[SKIP] eval     --no-emu
[SKIP] layout   requires emulator screenshot (--no-emu)
[SKIP] perf     profile disabled
RESULT: PASS (4 steps, 0 failed; exit 0)
```

`npm test --prefix tools/lume` (`artifacts/r172/cli-tests.txt`):

```text
# tests 50
# pass 49
# fail 0
# skipped 1
```

Selected adjacent host harness regression (`artifacts/r172/host-regression.txt`): StoryBook, music player, gestures, SD gallery, SD files, SD card, image mapping, and OTA consumers all PASS. `python3 scripts/check_website.py` also found no missing or invented API entries (`artifacts/r172/website.txt`). A broad run of every `tests/*.js` was stopped after native harnesses exceeded several minutes; no complete all-host result is claimed.

Playwright screenshots: [bookshelf](../artifacts/r172/shelf.png), [reading page](../artifacts/r172/reading.png), [controls](../artifacts/r172/controls.png). The browser error box was empty in all three states. Visual inspection finds the caption at 28 px, a dark scene with high contrast text, one prominent story choice, and four large controls. The requested independent vision review by the main controller remains pending.

## Independent vision review (main controller, r175 cadence round)

The three screenshots were re-reviewed by an independent vision model. Verdict: **all three PASS** — no truncation, overflow, misalignment, tofu glyphs, overlap or pixel defects on any of the three pages; contrast is high on all text; the four shelf cards and the four reading controls are evenly sized and aligned.

The one finding — the 2nd–4th shelf cards render as blank cards — was traced to app code and is **by design, not a rendering bug**: `examples/storybook/app.js:156` creates exactly 4 fixed shelf slots and `sbRefreshShelf()` (line 68) fills only `sbBooks.length` of them; in the browser-stub environment the TF-card listing throws at line 62 so the library degrades to the single built-in sample book, leaving slots 2–4 intentionally empty (`''` titles). On device with TF content all four slots fill. No app change required.

`tools/playground/verify.mjs` remains red in the pre-existing complete-catalog check (`artifacts/r172/playground-verify.txt`). Before this change, the build had 66 sources but `page.js` exposed only 48 examples and `index.html` omitted their scripts. This change makes those counts 67 and 49 respectively; the verifier reports `expected 67 examples, got 49`. Exposing all missing entries within this slice would require fixing unrelated app/browser stubs (the first is `adc_meter`), so r172 leaves the existing gap untouched. StoryBook's own browser entry loads and renders without errors.

## Deferred board acceptance

No real board was connected. TF card directory enumeration, PNG read/decode, MP3 frame timing and stream finish, hotspot sound interruption, DAC output, touch gestures, NVS persistence across reboot, and sleep/current metrics require on-device acceptance. Browser output is semantic simulation, not hardware verification.
