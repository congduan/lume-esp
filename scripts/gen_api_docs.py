#!/usr/bin/env python3
"""Generate the API reference in website/api.html from runtime/types/lume.d.ts.

lume.d.ts is the single source of truth for the JS API surface. This script
parses it (declare namespaces, nested namespaces, top-level declare functions)
and rewrites two marked regions of website/api.html:

  <!-- api-rows:start --> ... <!-- api-rows:end -->
      one <tr data-api=... data-name=...> per namespace function, in source
      order, in the exact shape scripts/check_website.py expects.

  <!-- api-globals:start --> ... <!-- api-globals:end -->
      the global prelude helper list (View/Row/Column/.../signal).

Usage:
  python3 scripts/gen_api_docs.py           # rewrite the marked regions
  python3 scripts/gen_api_docs.py --check   # exit 1 if the file is stale
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = ROOT / 'runtime/types' / 'lume.d.ts'
PAGE = ROOT / 'website' / 'api.html'

ROWS_START = '<!-- api-rows:start -->'
ROWS_END = '<!-- api-rows:end -->'
GLOBALS_START = '<!-- api-globals:start -->'
GLOBALS_END = '<!-- api-globals:end -->'


def collect(source):
    """Return (entries, globals) where entries is an ordered list of
    (qualified_name, signature) for namespace functions and globals is an
    ordered list of (name, signature) for top-level declare functions."""
    entries = []
    globals_ = []
    namespace = None  # current declare namespace, e.g. 'lume.net'
    nested = []       # [(name, depth_inside)] for nested `namespace x {`
    depth = 0         # brace depth relative to the declare namespace opener
    pending = None    # (qualname, is_global, [lines]) for multiline signatures

    def finish(lines):
        return re.sub(r'\s+', ' ', ' '.join(lines)).strip()

    for line in source.splitlines():
        if pending is not None:
            qual, is_global, lines = pending
            lines.append(line.strip())
            text = ' '.join(lines)
            balanced = (text.count('{') - text.count('}')
                        + text.count('(') - text.count(')')) <= 0
            if ';' in line and balanced:
                (globals_ if is_global else entries).append((qual, finish(lines)))
                pending = None
            depth += line.count('{') - line.count('}')
            continue

        if namespace is None:
            m = re.match(r'declare function (\w+)(<[^>]*>)?\s*\(', line)
            if m:
                if ';' in line:
                    globals_.append((m.group(1), finish([line])))
                else:
                    pending = (m.group(1), True, [line.strip()])
                continue
            m = re.match(r'declare namespace (lume(?:\.\w+)*)\s*\{', line)
            if m:
                namespace = m.group(1)
                depth = 1
                nested = []
            continue

        m = re.match(r'\s*namespace (\w+)\s*\{', line)
        if m:
            nested.append((m.group(1), depth))
        fm = re.match(r'\s*function (\w+)(<[^>]*>)?\s*\(', line)
        if fm:
            qual = '.'.join([namespace] + [n for n, _ in nested] + [fm.group(1)])
            if ';' in line:
                entries.append((qual, finish([line.strip()])))
            else:
                pending = (qual, False, [line.strip()])

        depth += line.count('{') - line.count('}')
        nested = [(n, d) for n, d in nested if depth > d]
        if depth <= 0:
            namespace = None
    return entries, globals_


def esc(text):
    return html.escape(text, quote=True)


def param_names(signature):
    """'function View(props: X, children?: Y[]): Z;' -> 'props, children?'."""
    body = signature[signature.index('(') + 1:signature.rindex(')')]
    parts, level, current = [], 0, ''
    for ch in body:
        if ch in '<([{':
            level += 1
        elif ch in '>)]}':
            level -= 1
        if ch == ',' and level == 0:
            parts.append(current)
            current = ''
        else:
            current += ch
    if current.strip():
        parts.append(current)
    names = []
    for part in parts:
        name = part.strip().split(':')[0].strip()
        if name:
            names.append(name)
    return ', '.join(names)


def render_rows(entries):
    rows = []
    for qual, sig in entries:
        data_api = esc((qual + ' ' + sig).lower())
        rows.append(
            f'<tr data-api="{data_api}" data-name="{esc(qual)}">'
            f'<td><code>{esc(qual)}</code></td>'
            f'<td><code>{esc(sig)}</code></td></tr>')
    return '\n'.join(rows)


def render_globals(globals_):
    codes = ', '.join(f'<code>{esc(name)}({esc(param_names(sig))})</code>'
                      for name, sig in globals_)
    return codes


def replace_region(text, start, end, content):
    if start in text:
        pattern = re.compile(re.escape(start) + '.*?' + re.escape(end), re.S)
        if not pattern.search(text):
            raise SystemExit(f'unmatched region markers {start!r} / {end!r}')
        return pattern.sub(lambda _: start + '\n' + content + '\n' + end, text, count=1)
    return None


def validate(entries, globals_):
    for qual, sig in list(entries) + globals_:
        balanced = (sig.count('{') - sig.count('}')
                    + sig.count('(') - sig.count(')')) == 0
        if not (sig.endswith(';') and balanced):
            raise SystemExit(f'unterminated signature for {qual}: {sig!r}')


def build(text):
    entries, globals_ = collect(TYPES.read_text())
    validate(entries, globals_)

    if ROWS_START in text:
        text = replace_region(text, ROWS_START, ROWS_END, render_rows(entries))
    else:
        marker = (ROWS_START + '\n' + render_rows(entries) + '\n' + ROWS_END)
        text, n = re.subn(r'<tbody>.*?</tbody>', lambda _: '<tbody>\n' + marker + '\n</tbody>', text, count=1, flags=re.S)
        if n != 1:
            raise SystemExit('api table <tbody> not found in website/api.html')

    if GLOBALS_START in text:
        text = replace_region(text, GLOBALS_START, GLOBALS_END, render_globals(globals_))
    else:
        marker = (GLOBALS_START + '\n' + render_globals(globals_) + '\n' + GLOBALS_END)
        text, n = re.subn(r'(<strong>Global prelude helpers</strong><p>).*?( — <span)',
                          lambda m: m.group(1) + marker + m.group(2), text, count=1, flags=re.S)
        if n != 1:
            raise SystemExit('global prelude helpers paragraph not found in website/api.html')
    return text


def main():
    original = PAGE.read_text()
    updated = build(original)
    if '--check' in sys.argv:
        if updated == original:
            print(f'api.html is up to date with lume.d.ts ({updated.count("<tr data-api=")} entries)')
            return
        print('ERROR: website/api.html is stale; run: python3 scripts/gen_api_docs.py')
        sys.exit(1)
    PAGE.write_text(updated)
    region = updated[updated.index(GLOBALS_START):updated.index(GLOBALS_END)]
    print(f'wrote {PAGE.relative_to(ROOT)}: {updated.count("<tr data-api=")} API rows, '
          f'{len(re.findall("<code>", region))} global helpers')


if __name__ == '__main__':
    main()
