#!/usr/bin/env python3
"""Generate the examples gallery cards in website/examples.html.

Three catalogs are read-only inputs and must describe the same 73 apps:

  tools/playground/build.mjs   authoritative app id list (the `apps` array)
  website/playground/page.js   per-app display metadata (6-tuple in `examples`)
  website/playground/sources.js generated LUME_SOURCES catalog (cross-check)

Drift between any two is a hard error, so the gallery cannot silently show a
different set than the playground picker. Card copy comes only from the
page.js metadata: titles, bilingual descriptions and source links. No feature
claim is invented. The rendered region is plain static HTML, so the page keeps
working without JavaScript and keeps the site's data-en/data-zh mechanism.

Usage:
  python3 scripts/gen_examples_gallery.py           # rewrite the marked region
  python3 scripts/gen_examples_gallery.py --check   # exit 1 if the page is stale
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'website' / 'examples.html'
MANIFEST = ROOT / 'tools' / 'playground' / 'build.mjs'
META = ROOT / 'website' / 'playground' / 'page.js'
SOURCES = ROOT / 'website' / 'playground' / 'sources.js'

START = '<!-- examples-gallery:start -->'
END = '<!-- examples-gallery:end -->'
REPO = 'https://github.com/congduan/lume-esp/blob/main'

# Metadata words that already state a real board-hardware dependency. The
# badge only repeats the lead's wording ("board peripherals or a prepared TF
# card"); it never adds a capability claim of its own.
HW_TERMS = re.compile(
    r'\bTF\b|TF卡|\bIMU\b|\bPMIC\b|\bADC\d*\b|microphone|walkie-talkie|'
    r'\bBLE\b|\bWiFi\b|Wi-Fi|\bradio\b|magnetometer|inertial|\btilt\b|'
    r'\baudio\b|\bvoice\b|\bsleep\b|'
    r'麦克风|蓝牙|无线|惯性|体感|音频|睡眠', re.I)
# Descriptions that explicitly disclaim hardware (stub / sample data) are not
# badged: their metadata already tells the reader no real peripheral is used.
STUB_TERMS = re.compile(r'\bstub\b|no audio|sample data|模拟|无音频', re.I)


def catalog():
    manifest = MANIFEST.read_text()
    block = re.search(r'const apps = \[([\s\S]*?)\];', manifest)
    if not block:
        raise SystemExit('gen_examples_gallery: build.mjs apps[] not found')
    apps = re.findall(r"'([^']+)'", block.group(1))
    if not apps or len(set(apps)) != len(apps):
        raise SystemExit('gen_examples_gallery: empty or duplicated manifest')

    meta_src = META.read_text()
    block = re.search(r'const examples = \[([\s\S]*?)\];', meta_src)
    if not block:
        raise SystemExit('gen_examples_gallery: page.js examples[] not found')
    rows = re.findall(
        r"\['([^']+)','([^']*)','([^']+)','([^']*)','([^']*)','([^']*)'\]",
        block.group(1))
    meta = {row[0]: row for row in rows}
    if len(meta) != len(rows):
        raise SystemExit('gen_examples_gallery: duplicated page.js metadata id')

    sources_text = SOURCES.read_text()
    sources = json.loads(sources_text[
        sources_text.index('{'):sources_text.rindex('}') + 1])

    if set(apps) != set(meta) or set(apps) != set(sources):
        raise SystemExit(
            'gen_examples_gallery: catalog drift\n'
            f'  manifest={len(apps)} meta={len(meta)} sources={len(sources)}\n'
            f'  missing metadata: {sorted(set(apps) - set(meta))}\n'
            f'  extra metadata:   {sorted(set(meta) - set(apps))}\n'
            f'  missing sources:  {sorted(set(apps) - set(sources))}\n'
            f'  extra sources:    {sorted(set(sources) - set(apps))}')
    return apps, meta


def needs_hardware(entry):
    _, _, _, _, desc_en, desc_zh = entry
    if STUB_TERMS.search(desc_en) or STUB_TERMS.search(desc_zh):
        return False
    return bool(HW_TERMS.search(desc_en) or HW_TERMS.search(desc_zh))


def card(index, app_id, entry):
    _, _, en, cn, desc_en, desc_zh = entry
    title = f'{en} / {cn}' if cn and cn != en else en
    esc = html.escape
    parts = [
        '<article class="example-card card reveal">',
        f'<div class="example-index">{index:02d} / EXAMPLE</div>',
        f'<h2>{esc(title)}</h2>',
        f'<p data-en="{esc(desc_en, quote=True)}" data-zh="{esc(desc_zh, quote=True)}">'
        f'{esc(desc_en)}</p>',
        f'<pre><code>examples/{esc(app_id)}/app.js</code></pre>',
    ]
    if needs_hardware(entry):
        parts.append(
            '<span class="pill" data-en="Board hardware may be required" '
            'data-zh="可能需要板载外设">Board hardware may be required</span>')
    parts.extend([
        f'<a href="{REPO}/examples/{esc(app_id)}/app.js">',
        '<span data-en="View source →" data-zh="查看源码 →">View source →</span>',
        '</a>',
        '</article>',
    ])
    return '\n'.join(parts)


def build(original):
    apps, meta = catalog()
    cards = '\n'.join(card(i + 1, name, meta[name]) for i, name in enumerate(apps))
    region = START + '\n<div class="examples-grid">\n' + cards + '\n</div>\n' + END
    if START not in original or END not in original:
        raise SystemExit('gen_examples_gallery: examples.html gallery markers missing')
    start = original.index(START)
    end = original.index(END, start) + len(END)
    return original[:start] + region + original[end:], apps, meta


def main():
    original = PAGE.read_text()
    updated, apps, meta = build(original)
    if '--check' in sys.argv:
        if updated == original:
            print(f'examples.html gallery up to date ({len(apps)} cards)')
            return
        print('ERROR: website/examples.html is stale; run: python3 scripts/gen_examples_gallery.py')
        sys.exit(1)
    PAGE.write_text(updated)
    badged = [name for name in apps if needs_hardware(meta[name])]
    print(f'wrote {PAGE.relative_to(ROOT)}: {len(apps)} cards from build.mjs + page.js')
    print(f'hardware-annotated cards ({len(badged)}): ' + ', '.join(badged))


if __name__ == '__main__':
    main()
