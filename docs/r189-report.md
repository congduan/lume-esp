# r189 — Examples gallery, data-driven from the playground catalog

`website/examples.html` used to hard-code seven curated cards while the
playground registers 70 apps. This round removes the drift without touching the
manifest, any `examples/*/app.js`, firmware, runtime or tooling.

## Route taken

**Build-time generation (route A)**, not runtime rendering. The generator
`scripts/gen_examples_gallery.py` rewrites the marked region of `examples.html`
from three read-only catalogs, which must agree exactly:

| Input | Role |
|---|---|
| `tools/playground/build.mjs` (`apps` array) | authoritative app id list |
| `website/playground/page.js` (`examples` metadata) | en/cn title + description, per app |
| `website/playground/sources.js` (`LUME_SOURCES`) | third set for drift detection |

Route B (inline JSON + JS rendering) was rejected: `page.js` keeps its metadata
inside an IIFE and would need refactoring to export it, the generated page would
no longer render without JS, and `check_website.py` could not see the cards.
Route A keeps static HTML, SEO, the no-JS path, and the existing
`data-en`/`data-zh` mechanism driven by `assets/site.js`.

## What changed

- `website/examples.html`: cards are generated between
  `<!-- examples-gallery:start -->` / `<!-- examples-gallery:end -->`; one card
  per registered app (70), in manifest order. Headline, meta description, lead
  and tail note no longer claim "Seven"; the count is never hard-coded.
- Card copy comes only from `page.js` metadata. The `<pre><code>` slot now shows
  the factual source path `examples/<id>/app.js` instead of a hand-picked API
  line, so no behaviour is invented for the 63 newly shown apps.
- Cards whose own metadata states a board dependency (TF card, IMU, ADC, BLE /
  WiFi, microphone / audio, tilt, sleep, …) carry the existing `.pill` badge
  "Board hardware may be required" / "可能需要板载外设"; metadata that explicitly
  disclaims hardware (stub / sample data) is not badged.
- `scripts/gen_examples_gallery.py`: `--check` mode fails on a stale page;
  `scripts/check_website.py` calls it so the website gate covers gallery drift.
- `tests/examples_gallery.js`: standalone host harness with mutation proofs for
  count, one-to-one manifest order, metadata-sourced copy, bilingual attributes,
  stale "Seven" copy, and hardware badges.

## Trade-offs / notes

- The seven curated cards included `device_monitor` and `imu_poll`, which are
  real app directories but are **not** in the playground manifest. Strict
  one-to-one alignment means those two no longer appear as cards; every shown
  card now has a registered app and a playground preview. Their source files
  are untouched.
- The seven curated cards had hand-picked API snippets. Metadata has no snippet
  field, so the `<pre><code>` slot now shows the factual `examples/<id>/app.js`
  path. No API call is invented for the 63 newly rendered apps.
- `page.js` metadata is a six-field tuple (`id, icon, en, cn, descEn, descZh`),
  not five as the brief's shorthand suggested. All 70 rows parse and match the
  manifest by id.

## Verification (raw output in `artifacts/r189/`)

- `python3 scripts/check_website.py` exit 0; the integrated gallery `--check`
  reports `up to date (70 cards)`.
- All 104 `tests/*.js` host harnesses pass, 0 `FAIL` lines.
- `python3 scripts/gen_api_docs.py --check` exit 0 (api.html unchanged).
- `node tools/playground/build.mjs` exit 0, `70 editable sources / 70 apps`;
  no diff in `tools/playground/build.mjs` or `website/playground/`.
- Counts: manifest 70 = page.js metadata 70 = `LUME_SOURCES` 70 = rendered
  articles 70 = rendered source paths 70; same set confirmed; 11 cards carry
  the board-hardware badge (including `adc_meter`).
- Mutation proofs: `tests/ota_consumers.js` 19 checks + 19 mutations pass;
  `tests/examples_gallery.js` 6 checks + 6 mutations pass; injecting a stale
  card title makes `check_website.py` exit 1 and the page is restored
  byte-identically; `tests/board_abi.js` zero-diff guard passes (website/
  excluded, not triggered).

## Scope

No change to firmware/, runtime/, tools/lume/, tools/gateway/,
firmware/components/lume-engine/, any `examples/*/app.js`, the 70-app manifest,
`lume_ui_bridge.h`, vendored sources, roadmap milestone definitions, or the
playground generated catalog. No push; no `idf.py build` (disk constrained).
Board-level acceptance stays deferred.
