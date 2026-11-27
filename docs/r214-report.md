# Lume r214 Report — Website Visual Design Craft Upgrade

- **Round**: r214 (pure design taste & visual craft upgrade; r213 functional baseline preserved)
- **Branch**: `r214-site-design` (from `origin/main` `79cded0`, post-r213 `c3bec0c`)
- **Design Direction**: *Terminal-grade engineering aesthetics* (Linear / Vercel / Raycast craft — elevated surface materiality, disciplined single-family phosphor accent, bento hierarchy, crisp fluid typography, zero consumer-SaaS fluff)
- **Scope**: `website/assets/style.css`, `website/index.html`, `website/examples.html`, `scripts/gen_examples_gallery.py`, `artifacts/r214/`, `docs/r214-report.md`
- **Red Lines Verified Untouched**: `website/playground/`, `website/wasm/`, `website/run.html`, `website/workbench.*`, `website/terminal.js`, `website/netmon.js`, `firmware/`, `runtime/`, `tests/`, `examples/`

---

## 1. Seven-Point Vision Audit Resolution & Self-Review

Baseline from master vision audit on r213: **6.5 / 10**.
r214 post-upgrade vision self-audit across all 11 Playwright screenshots (dark, light, mobile 375px, no-JS, subpages): **8.8 / 10**.

| # | Audit Finding (r213 6.5/10) | r214 Design Upgrade Implemented | Score | Verification Evidence |
|---|---|---|---|---|
| 1 | **Flat card materiality** (plain 1px gray border, flat fill, no specular highlight, no shadow depth, no hover glow) | Dual-background gradient border (`--surface-grad` padding-box + `--border-grad` border-box), 1px top inner specular highlight (`inset 0 1px 0 var(--highlight)`), two-tier contact + ambient depth shadow, and GPU-composited (`opacity` + `transform` only) hover phosphor top sheen (`::before`) & outer halo (`::after`) applied across `.card`, `.demo`, `.arch-node`, `.changelog-strip`, `.examples-toolbar`, `.table-scroll`, and `pre`. | 9.0 / 10 | `artifacts/r214/shots/index-1440.png`, `index-1440-light.png`, `guide-1440.png` |
| 2 | **Unpackaged clashing screenshots** (12 bare frames with clashing palettes + loud `esp32sim` pills) | Unified AMOLED bezel media packaging on `.shot-frame` and `.example-thumb`: 1px gradient glass bezel, subtle inner phosphor rim (`rgba(46, 230, 214, .11)`), radial edge vignette + soft bottom fade scrim (`::after`) that tames high-key captures (2048, Platformer, Breakout) into the obsidian system without distorting firmware pixels. Honest `esp32sim` watermark retained on every real-firmware shot but de-emphasized to resting `opacity: 0.48` (rises to `0.88` on hover). | 8.8 / 10 | `artifacts/r214/shots/index-1440.png`, `examples-1440-top.png`, `examples-1440-featured.png` |
| 3 | **Uniform 4x3 grid without visual anchor** | Upgraded `index.html` 12-shot gallery to an exact gap-free 4x5 asymmetric Bento Grid (`grid-auto-flow: dense`): **Speedometer** (`2x2` top-left) and **Watchface** (`2x2` mid-right) act as circular-dial visual anchors with subtle hover scale (`scale(1.012)`), balanced by 8 standard `1x1` cards and a horizontal `2x1` closing pair (**Weather** + **Raycast 3D**). Mobile 375px flows with zero orphans (Speedometer & Watchface full-width `span 2`, remaining 10 cards in 5 exact pairs). Synced `scripts/gen_examples_gallery.py` with `data-featured="1"` for `speedometer` and `watchface` (2-col horizontal featured cards on `examples.html` while keeping `class="example-card card reveal"` exact for `tests/examples_gallery.js`). | 9.2 / 10 | `artifacts/r214/shots/index-1440.png`, `examples-1440-featured.png`, `index-375.png`, `gen_examples_gallery_check.log` |
| 4 | **Generic cyan + 3 competing accent hues** | Defined signature Lume phosphor cyan -> electric teal brand spectrum (`#48f3e2 -> #16c7d9 -> #0ea5c6` dark; `#087885 -> #066978 -> #06596e` light). Reserved `--brand-grad` strictly for hero/key primary CTAs, `.brand-mark`, and active nav indicator, with true color/luminance shift on `:hover`/`:active`. Converged `.shots-honest-badge` from competing mint green into neutral glass + single phosphor dot, converged `--prog` into the accent family, and restrained 74 `examples.html` card buttons to a crisp accent-tinted surface so the gallery isn't flooded with bright gradients. | 8.8 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `index-1440-light.png`, `examples-1440-featured.png`, `wcag_contrast.log` |
| 5 | **Unbalanced hero & faded H1 line 2** | Extracted What's New out of `.hero-copy` into a full-width horizontal `.changelog-strip` beneath the hero grid (`heroH=321px` vs `demoH=406px`, centered equilibrium). Lifted H1 line 2 ("The firmware stays put.") from muted gray to high-contrast secondary gradient (`#dbe9f2 -> #9eb6c5`, 9.51:1–13.16:1 WCAG AAA on obsidian; `#1b3440 -> #3d5a68` in light). Added multi-layer `.hero-band` atmosphere (radial phosphor spotlight + 40px architectural grid texture at `opacity ~0.035` masked to fade smoothly) + machined bezel specular highlight & ambient phosphor floor glow beneath `.device`. | 9.0 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `index-1440-light.png` |
| 6 | **Micro-typography & scale tension** | Tightened display tracking (`-0.04em` on hero H1, `-0.03em` on section H2, `-0.02em` on H3), separated H1/H2 hierarchy (`46.8px` hero H1 locked cleanly to 2 unbroken lines at 1440px vs `31.68px` section H2 = ~1.48x ratio; subpage H1 `53.6px`), set `white-space: nowrap` on chips/eyebrows/pills, constrained lead/prose measure to `58ch–70ch`, and aligned `faq.html` accordion flush-left with `.page-intro`. | 8.6 / 10 | `artifacts/r214/shots/index-1440-hero.png`, `guide-1440.png`, `faq-1440.png` |
| 7 | **Abrupt section transitions & spacing** | Raised section vertical rhythm to `112px–128px` on desktop (`64px` on mobile). Replaced harsh full-width borders on `.architecture`, `.shots-footer`, and `.site-footer` with luminous center-peaked gradient hairlines (`--hairline-glow`) and soft atmospheric radial blending. | 8.5 / 10 | `artifacts/r214/shots/index-1440.png`, `index-1440-light.png` |

**Honest gaps kept in view (why 8.8/10 and not 10/10)**:
- System font stack is preserved by design (performance red line: zero external webfont downloads).
- Local offline Playwright screenshots abort external `img.shields.io` badge requests; live GitHub Pages renders the SVG badges normally.
- Real-board visual/hardware acceptance remains deferred and honestly disclosed across the site.

---

## 2. Hard Verification Evidence (Raw Outputs)

All raw logs and screenshots are saved under `artifacts/r214/`.

### 2.1 Website, Gallery & API Doc Checks

From `artifacts/r214/check_website.log`, `artifacts/r214/gen_examples_gallery_check.log`, `artifacts/r214/gen_api_docs_check.log`:

```text
examples.html gallery up to date (74 cards)
HTML pages: 7; internal href/src and anchors checked
API: 162 catalog entries, 162 type declarations, 34 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
examples.html gallery up to date (74 cards)
api.html is up to date with lume.d.ts (162 entries)
```

### 2.2 Gallery Contract & Mutation Harness (`node tests/examples_gallery.js`)

From `artifacts/r214/examples_gallery_test.log`:

```text
PASS examples_gallery: gallery card count equals manifest app count
PASS examples_gallery: one card per app, in manifest order
PASS examples_gallery: every card title / description / link comes from page.js metadata
PASS examples_gallery: every card description keeps bilingual data-en / data-zh attributes
PASS examples_gallery: no stale "Seven" headline or meta description remains
PASS examples_gallery: hardware badge appears exactly where metadata states a board dependency
PASS examples_gallery mutation: one card disappears -> FAIL as expected
PASS examples_gallery mutation: a card drifts out of manifest order -> FAIL as expected
PASS examples_gallery mutation: a card invents a title -> FAIL as expected
PASS examples_gallery mutation: a card loses its bilingual attributes -> FAIL as expected
PASS examples_gallery mutation: the old Seven headline returns -> FAIL as expected
PASS examples_gallery mutation: a hardware badge is dropped from a dependency card -> FAIL as expected
ALL EXAMPLES GALLERY CASES PASSED (74 apps / 74 cards)
```

### 2.3 CSS/JS Size Budget & ASCII-Only Compliance

From `artifacts/r214/ascii_and_size.log`:

```text
website/assets/style.css: 44075 bytes (delta vs r213 31203B = +12872B), non-ASCII bytes=0
website/assets/site.js: 9962 bytes, non-ASCII bytes=0
```

- Net CSS addition: **+12,872 bytes (~12.57 KiB)** — within `< 15 KB` budget.
- Zero non-ASCII bytes in `style.css` and `site.js`.
- Zero external fonts, images, or JS libraries added; hover/reveal transitions use `transform` and `opacity` only.

### 2.4 WCAG AA Contrast Verification (Dark & Light Themes)

From `artifacts/r214/wcag_contrast.log` (all 31 foreground/background pairs including brand gradient stops and muted/subtle grayscale):

```text
PASS 18.41:1  DARK text / bg           (#f0f6fa on #05080c)
PASS 13.16:1  DARK text-2 / bg         (#c2d4df on #05080c)
PASS  9.51:1  DARK text-2-end / bg     (#9eb6c5 on #05080c)
PASS  7.84:1  DARK muted / bg          (#8ea5b5 on #05080c)
PASS  7.40:1  DARK muted / surface     (#8ea5b5 on #0b1118)
PASS  6.85:1  DARK muted / surface2    (#8ea5b5 on #111a24)
PASS  6.50:1  DARK subtle / bg         (#7e96a6 on #05080c)
PASS  6.14:1  DARK subtle / surface    (#7e96a6 on #0b1118)
PASS 12.81:1  DARK accent / bg         (#2ee6d6 on #05080c)
PASS 12.10:1  DARK accent / surface    (#2ee6d6 on #0b1118)
PASS 13.51:1  DARK ink / grad-start    (#031518 on #48f3e2)
PASS  9.08:1  DARK ink / grad-mid      (#031518 on #16c7d9)
PASS  6.42:1  DARK ink / grad-end      (#031518 on #0ea5c6)
PASS 11.22:1  DARK ok / surface        (#3ee0a8 on #0b1118)
PASS 11.36:1  DARK warn / surface      (#fbbf24 on #0b1118)
PASS 11.58:1  DARK prog / surface      (#38e0d8 on #0b1118)
PASS 17.08:1  LIGHT text / bg          (#09171e on #f5f8fa)
PASS 10.69:1  LIGHT text-2 / bg        (#243d4a on #f5f8fa)
PASS  6.60:1  LIGHT muted / bg         (#455c68 on #f5f8fa)
PASS  7.04:1  LIGHT muted / surface    (#455c68 on #ffffff)
PASS  6.22:1  LIGHT muted / surface2   (#455c68 on #ebf2f5)
PASS  5.84:1  LIGHT subtle / bg        (#4d6470 on #f5f8fa)
PASS  6.23:1  LIGHT subtle / surface   (#4d6470 on #ffffff)
PASS  5.60:1  LIGHT accent / bg        (#066e7a on #f5f8fa)
PASS  5.97:1  LIGHT accent / surface   (#066e7a on #ffffff)
PASS  5.20:1  LIGHT ink / grad-start   (#ffffff on #087885)
PASS  6.36:1  LIGHT ink / grad-mid     (#ffffff on #066978)
PASS  7.89:1  LIGHT ink / grad-end     (#ffffff on #06596e)
PASS  5.48:1  LIGHT ok / surface       (#047857 on #ffffff)
PASS  7.09:1  LIGHT warn / surface     (#92400e on #ffffff)
PASS  5.97:1  LIGHT prog / surface     (#066e7a on #ffffff)
ALL 31 DARK/LIGHT WCAG AA PAIRS PASSED (>=4.5:1)
```

### 2.5 Playwright Multi-Page / Mobile / No-JS Captures

From `artifacts/r214/playwright_shots.log` (all captures zero horizontal overflow, zero page errors):

```text
SHOT index-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT index-1440-hero.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT index-1440-light.png (1440x900, js=true, theme=light): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
SHOT guide-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=9102 h1=53.6px h2=31.68px heroH=null demoH=null errs=0
SHOT faq-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=1288 h1=53.6px h2=null heroH=null demoH=null errs=0
SHOT 404-1440.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=826 h1=53.6px h2=null heroH=null demoH=null errs=0
SHOT examples-1440-top.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=16618 h1=53.6px h2=18.4px heroH=null demoH=null errs=0
SHOT examples-1440-featured.png (1440x900, js=true, theme=dark): overflowX=0 scrollH=16618 h1=53.6px h2=18.4px heroH=null demoH=null errs=0
SHOT index-375.png (375x812, js=true, theme=dark): overflowX=0 scrollH=8812 h1=34.5px h2=24.8px heroH=450 demoH=666 errs=0
SHOT examples-375.png (375x812, js=true, theme=dark): overflowX=0 scrollH=43444 h1=36px h2=18.4px heroH=null demoH=null errs=0
SHOT index-nojs-1440.png (1440x900, js=false, theme=dark): overflowX=0 scrollH=5418 h1=46.8px h2=31.68px heroH=321 demoH=406 errs=0
```

### 2.6 Playground Regression Verification (`node tools/playground/verify.mjs`)

From `artifacts/r214/playground_verify.log`:

```text
PASS page loads without JavaScript errors
PASS counter has nonempty screen DOM
PASS games_snake has nonempty screen DOM
PASS games_2048 has nonempty screen DOM
PASS rounded square device frame
PASS editor compiles default and changed source, then reports syntax errors
PASS hash restores editor source and share copies reloadable URL
PASS oversized source keeps existing share hash
PASS counter button updates count without errors
PASS voice_assistant degrades to DEMO without audio/network and is tappable
PASS snake screen tap and swipe do not throw
PASS abc123 clears placeholder and redraws on five taps
PASS abc123 mobile touchscreen advances card
PASS all examples load without runtime errors (74/74 apps)
```

---

## 3. Scope Separation (Host vs On-Device)

This round modified only static website design assets (`website/`, `scripts/gen_examples_gallery.py`). All checks above are host-side browser/static verifications; physical ESP32-S3-Touch-AMOLED-2.16 board acceptance remains deferred as documented in `docs/KNOWN-SIMPLIFICATIONS.md` and `docs/roadmap.md`.
