# Playground verification

These files contain the unedited stdout of the commands below. Each command exited 0.
The browser command used the Playwright installation already available in this environment.

| Output | Command |
|---|---|
| `build.txt` | `node tools/playground/build.mjs` |
| `browser.txt` | `PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs` |
| `website.txt` | `python3 scripts/check_website.py` |
| `cli-tests.txt` | `npm test --prefix tools/lume` |
| `host-tests.txt` | `bash -c 'set -e; for test in tests/*.js; do node "$test"; done'` |

The browser runs the firmware's exact prelude and replayed UI messages with host stub data. It is a **prelude semantic simulation**. Its successful browser checks do not verify touch feel, timing, visual fidelity on the panel, or hardware behavior. The snake example starts its timer when loaded and has no start button; the browser check exercises a screen tap and swipe.
