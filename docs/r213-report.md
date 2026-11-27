# Lume r213 Report — Website Professionalization (Design-First Overhaul)

- **Branch**: `r213-site-pro` (base `origin/main` @ `6d55ef3`)
- **Scope**: `website/` (excluding generated `website/playground/`, `website/wasm/`, `run.html`, `workbench.*`, `terminal.js`, `netmon.js`), `scripts/gen_examples_gallery.py`, `artifacts/r213/`, `docs/r213-report.md`
- **Verification environment**: Host Linux + Python 3 + Node.js + Playwright Chromium (local HTTP server serving `website/`). On-device acceptance remains pending per repository policy.

---

## 1. Defect Audit Closure Checklist

| # | Production Audit Defect | Root Cause & Implemented Fix | Verification Evidence |
|---|---|---|---|
| 1 | **Capabilities blank screen on `index.html`** | `style.css` previously hid `.reveal` at `opacity: 0` unconditionally until IntersectionObserver fired. Replaced with `opacity: 1` unconditionally in CSS; JS adds `html.js-reveal` + `.reveal-pending` only for subtle vertical elevation (`transform: translateY(10px) -> none`). | `artifacts/r213/shots/index-nojs.png` (`javaScriptEnabled: false`, `totalReveals=26 invisible=0 capsOpacity=["1","1","1"]`); unscrolled desktop JS load also has `hiddenReveals=0`. |
| 2 | **Zero product visual assets** | Extracted 39 strictly verified real esp32sim 480×480 firmware renders from `artifacts/emu/` (`ui-refresh/*.png`, `*/tft.png`) and `artifacts/r83/tft-scroller.png`, compressed via PIL to WebP in `website/assets/shots/` (12 featured @ 460px `quality=82`, 27 gallery @ 280px `quality=78`; total **186.0 KB** < 500 KB, max single file **12.2 KB** < 40 KB). Added 12-screen showcase on `index.html` and card thumbnails on `examples.html`. | Explicitly labeled `"Real firmware, rendered by esp32sim — not mockups"` (EN/ZH). Zero browser-sim captures or mockups used. |
| 3 | **Hero composition imbalance** | Tightened `.hero` grid (`1.12fr .88fr`) and H1 typography (`clamp(2.1rem, 3.25vw, 2.95rem)`, `text-wrap: balance`, two block spans for EN/ZH); set `.hero-actions` to `flex-wrap: nowrap` on desktop; refactored What's New wall of text into a compact `.whats-new-card` with scannable chips. | Playwright geometry check at 1440×900: `h1Lines=2 h1Height=103px btnYs=[402,402,402] sameRow=true`. |
| 4 | **No semantic status colors on Roadmap** | Added WCAG AA semantic tokens `--ok` (green), `--warn` (amber), `--prog` (sky-cyan) with tinted backgrounds, borders, and `::before` status dots for both dark and light themes (`Code checked` / `Mixed` / `In progress`). | Verified visually in both `index-desktop.png` (dark) and `index-desktop-light.png` (light). |
| 5 | **Examples cards lack visuals & metadata** | Upgraded `scripts/gen_examples_gallery.py` to emit: (a) esp32sim WebP thumbnail (`39` cards) or honest AMOLED icon tile `"Live in Playground"` (`35` cards), (b) semantic amber `Board hardware` pill strictly preserving existing `HW_TERMS`/`STUB_TERMS` logic (`12` cards), (c) compact `.path-row` with working Copy button, (d) primary `"Open in Playground"` + secondary `"View source"` CTAs. Added search & filter toolbar (`All apps` / `esp32sim captures` / `Hardware APIs`). | `python3 scripts/gen_examples_gallery.py --check` -> `examples.html gallery up to date (74 cards)`; Playwright interactive test `all=74 / 74 shot=39 / 74 hw=12 / 74 copyAfterClick=Copied`. |
| 6 | **Missing OSS trust signals & minimal footer** | Added static shields.io GitHub Stars badge in header + Stars & MIT badges in footer (no JS SDK). Unified top navigation across all pages (including `Playground` link on Guide/API/Examples/FAQ/404). Expanded footer into 4 columns (`lume.` brand, Documentation, Explore, Resources) + honest legal row. | Verified across `index.html`, `guide.html`, `api.html`, `examples.html`, `faq.html`, `404.html`; `check_website.py` checks every internal link & anchor. |
| 7 | **Code highlighting, architecture blend, disclaimer placement** | Added 6-token syntax palette (`--tok-kw/fn/str/num/cmt/prop`) in dark & light themes for hero demo and `guide.html` JS snippets; replaced abrupt architecture gradient with soft radial blend + 4 numbered horizontal pipeline cards; kept the USB hot-reload disclaimer intact in the hero demo card caption. | Verified visually on `index-desktop.png`, `index-desktop-light.png`, `guide-desktop.png`. |

---

## 2. Vision Self-Audit (Post-Redesign)

Baseline production audit scores were **5.5/10 (index)** and **5.0/10 (examples)**. After inspecting every Playwright capture in `artifacts/r213/shots/`:

| Page | Self-Score | Assessment & Remaining Honest Gaps |
|---|---|---|
| `index.html` (desktop dark/light/ZH, mobile 375px, no-JS) | **8.6 / 10** | Crisp 2-line hero headline, single-row CTAs, scannable changelog card, 12 authentic esp32sim firmware renders with honest provenance labeling, smooth architecture flow, distinct semantic roadmap status pills in both dark & light themes, 4-column footer, 100% visible with JS disabled (`index-nojs.png`) and zero mobile nav clipping (`navScrollW=343 navClientW=343`). Remaining gap: hero demo screen remains an illustrative CSS preview (explicitly disclosed) rather than an embedded canvas; external shields.io badges rely on network access. |
| `examples.html` (desktop & mobile 375px) | **8.3 / 10** | Dramatic uplift from text-only boxes: 3-column grid with 39 genuine esp32sim thumbnails + 35 clean AMOLED icon tiles, live search & filter bar, working Copy path buttons, amber hardware badges, and dual Playground/source CTAs. Remaining gap: 35 apps do not yet have CI esp32sim PNG captures in `artifacts/emu/`; `"Open in Playground"` opens `playground/index.html` without per-app deep-linking because `website/playground/page.js` is out of scope. |
| `guide.html` (desktop 1440px) | **8.2 / 10** | Multi-token JS syntax highlighting across all walkthroughs, clean comparison & parameter tables, unified nav and multi-column footer, zero overflow. |
| `faq.html` (desktop 1440px) | **8.2 / 10** | First caveat expanded on load for immediate scannability, crisp typography, unified nav and multi-column footer. |

---

## 3. Raw Verification Outputs

All raw logs are archived in `artifacts/r213/`.

### 3.1 `python3 scripts/check_website.py` (`artifacts/r213/check-website.log`)

```text
examples.html gallery up to date (74 cards)
HTML pages: 7; internal href/src and anchors checked
API: 162 catalog entries, 162 type declarations, 34 function namespaces
API missing: none
API invented: none
API duplicates: none
API signatures not found in lume.d.ts: none
```

### 3.2 `python3 scripts/gen_api_docs.py --check` & `gen_examples_gallery.py --check`

```text
api.html is up to date with lume.d.ts (162 entries)
examples.html gallery up to date (74 cards)
```

### 3.3 ASCII-only & WebP Asset Budget Check (`artifacts/r213/ascii-and-assets.log`)

```text
ASCII check website/assets/style.css: PASS
ASCII check website/assets/site.js: PASS
Shots count=39, total=186.0KB (<500KB), max=12.2KB (<40KB)
```

### 3.4 Playwright Site Audit (`artifacts/r213/playwright-audit.log`)

```text
[desktop-dark-unscrolled] index: overflow=false hiddenReveals=0 localImgs=12 brokenLocal=0
[desktop-dark-unscrolled] examples: overflow=false hiddenReveals=0 localImgs=39 brokenLocal=0
[desktop-dark-unscrolled] guide: overflow=false hiddenReveals=0 localImgs=0 brokenLocal=0
[desktop-dark-unscrolled] faq: overflow=false hiddenReveals=0 localImgs=0 brokenLocal=0
[hero-geometry] h1Lines=2 h1Height=103px btnYs=[402,402,402] sameRow=true
[i18n-zh] h1="屏幕由你定义，\n固件无需反复烧录。"
[examples-interactive] all=74 / 74 shot=39 / 74 hw=12 / 74 copyAfterClick=Copied
[mobile-375] index: docOverflow=false navScrollW=343 navClientW=343
[mobile-375] examples: docOverflow=false navScrollW=343 navClientW=343
[no-js] totalReveals=26 invisible=0 capsOpacity=["1","1","1"]
ALL PLAYWRIGHT AUDITS PASSED
```

### 3.5 Playground Regression Check (`artifacts/r213/playground-verify.log`)

Command: `NODE_PATH=/home/ubuntu/.npm/_npx/705bc6b22212b352/node_modules node tools/playground/verify.mjs`

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
PASS all examples load without runtime errors
```

(All 74 registered Playground apps loaded with non-empty screen DOM and zero runtime errors.)

---

## 4. Captured Screenshots (`artifacts/r213/shots/`)

- `index-desktop.png` (1440×900 fullPage, dark)
- `index-desktop-light.png` (1440×900 fullPage, light)
- `index-desktop-zh.png` (1440×900 fullPage, Chinese)
- `index-nojs.png` (1440×900 fullPage, JavaScript disabled)
- `examples-desktop.png` (1440×900 fullPage, dark)
- `guide-desktop.png` (1440×900 fullPage, dark)
- `faq-desktop.png` (1440×900 fullPage, dark)
- `index-mobile.png` (375×812 fullPage, dark)
- `examples-mobile.png` (375×812 fullPage, dark)
