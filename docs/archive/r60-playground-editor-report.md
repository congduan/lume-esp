# r60 Playground editor and sharing

## Changes

- The preview frame is now a 480 × 480 rounded square (`border-radius: 36px`). The playground page and README no longer describe it as a circular screen.
- The new Editor tab uses the same `LumePlaygroundSession` and `LumeRenderer` as the 16 bundled examples. Run and Ctrl/Cmd+Enter bundle the textarea's single-file JavaScript with esbuild-wasm (`iife`, `es2020`, neutral platform), then replace the current session. Compiler and runtime errors appear in `#error`. Editing alone does not run code.
- `tools/playground/build.mjs` copies esbuild-wasm 0.28.2's browser script and wasm from `tools/lume/node_modules` into `website/playground/vendor/`, plus all 16 editable `sources/<name>.js` and a `sources.js` lookup for the local page. Run `npm ci --prefix tools/lume` before building. All assets are served locally. The browser fetches the wasm as an ArrayBuffer, compiles a `WebAssembly.Module`, and passes that to `esbuild.initialize({ wasmModule, worker: true })`. This version does not accept a `wasmBinary` option.
- Run encodes the current source into `#code=<deflate-raw base64url>` using `CompressionStream`. Browsers without `CompressionStream` use `#code0=<encodeURIComponent(source)>`. On load, either hash opens the Editor and runs the decoded source. Share updates the hash and copies the full URL. A hash over 8192 characters is rejected without replacing the existing hash.

## Verification

These are the complete, unedited command outputs. Every command exited 0:

| Command | Raw output |
|---|---|
| `node tools/playground/build.mjs` | [`tools/playground/evidence/build.txt`](../tools/playground/evidence/build.txt) |
| `PLAYWRIGHT_MODULE=/tmp/lume-playwright/node_modules/playwright node tools/playground/verify.mjs` | [`tools/playground/evidence/browser.txt`](../tools/playground/evidence/browser.txt) |
| `python3 scripts/check_website.py` | [`tools/playground/evidence/website.txt`](../tools/playground/evidence/website.txt) |
| `bash -c 'set -e; for test in tests/*.js; do node "$test"; done'` | [`tools/playground/evidence/host-tests.txt`](../tools/playground/evidence/host-tests.txt) |
| `npm test --prefix tools/lume` | [`tools/playground/evidence/cli-tests.txt`](../tools/playground/evidence/cli-tests.txt) |

The browser check serves the static website over a local HTTP server so wasm fetch and clipboard work under the same origin. It records `border-radius: 36px`, exercises all 16 prebuilt apps, recompiles edited counter code, checks a syntax error, restores both hash formats across reload, copies a share URL, and rejects an oversized hash.

## Limits

The browser preview uses the firmware prelude with stub hardware APIs; it does not validate physical display appearance, touch feel, timing, or hardware behavior. App code executes on the page's main thread; an infinite loop can freeze the page until reload. Share URLs are capped at 8192 hash characters and may still exceed limits imposed by some messaging systems. The editor accepts a single source file; imports that need a module resolver are outside this version.
