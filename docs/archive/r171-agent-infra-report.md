# r171 agent infrastructure report

## Manifest

The editable playground app list remains defined once in `tools/playground/build.mjs` and is now exported by `manifestApps()`. `tests/lib/manifest.js` reads that declaration. Seventeen app guards replaced their 66-app exact count assertions with a nonempty list plus their own required app name; `tests/sntp_consumers2.js` keeps its three required names. Historical scope guards were updated to allow the two CLI files changed by this round. No guard needs a count update when another app is registered.

`tests/playground_manifest.js` checks the exported list against `website/playground/sources.js`, every generated source file, every example source, and every generated app bundle. Its mutation checks prove removal fails and a corresponding added source-map entry passes set equality. Before r171 a new app could require edits in 17 harnesses; after r171 the manifest registration is one edit in `build.mjs`, followed by regeneration of playground artifacts.

## Visual check

`lume check <app> --visual` bundles the app, starts the host simulator, opens headless Playwright, and takes device screenshots at 1, 3, and 6 seconds. It writes `frame-01.png` through `frame-03.png` and `visual.json` under `artifacts/check/<app>/visual/`. This mode skips the firmware emulator and layout rules, so it works without board firmware images. Playwright is supplied by `PLAYWRIGHT_MODULE` or a normal local installation.

Each frame records URL, timestamp, elapsed time, Canvas draw messages, DOM/render messages, nonempty pixel ratio, top five colors, and assertions. Canvas apps use Canvas pixels for blank detection and must draw at least once; DOM-only apps use the full device image and render messages. A 250-message budget applies to the relevant message count. If a DOM app declares a theme background color, it must appear in the frame's top five colors. This is a host browser check, not on-device visual acceptance.

## Verification

```text
$ node tests/playground_manifest.js
PASS playground manifest 66 apps match generated sources and examples; removal/addition mutation caught

$ PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/lume/lume.js check examples/counter --visual --json
"ok": true
"step": "visual", "ok": true, "frames": 3

$ PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/lume/lume.js check /tmp/r171-white --no-emu --visual --json
"ok": false
"step": "visual", "ok": false, "frames": 3
visual.json: nonEmptyRatio=0 for all 3 frames; canvasDrawCalls=0

$ npm test --prefix tools/lume
# tests 51
# pass 50
# fail 0
# skipped 1
```

The counter app has no Canvas. Its Canvas draw count is correctly zero, while its render message count is 110 and its top color is `#07111D`, matching its declared background theme. The blank Canvas fixture is outside the repository and did not change `examples/`.
