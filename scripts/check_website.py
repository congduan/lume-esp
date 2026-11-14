#!/usr/bin/env python3
"""Check static links and compare the API catalog with lume.d.ts declarations."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'website'
TYPES = ROOT / 'runtime/types/lume.d.ts'

class Scan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.api = []
        self.signatures = {}
        self._row = None
        self._code_index = 0
        self._in_code = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            self.ids.add(a['id'])
        for key in ('href', 'src'):
            if key in a:
                self.links.append(a[key])
        if 'data-api' in a and tag == 'tr':
            self._row = a.get('data-name', '')
            self.api.append(self._row)
            self._code_index = 0
        if tag == 'code' and self._row:
            self._in_code = True
            self._code_index += 1
    def handle_endtag(self, tag):
        if tag == 'code':
            self._in_code = False
        if tag == 'tr':
            self._row = None
    def handle_data(self, data):
        if self._in_code and self._code_index == 2 and self._row:
            self.signatures[self._row] = self.signatures.get(self._row, '') + data

def type_functions(source):
    names=[]
    namespace=None
    depth=0
    nested=[]
    for line in source.splitlines():
        match=re.match(r'\s*declare namespace (lume(?:\.[\w]+)*)\s*\{', line)
        if match:
            namespace=match.group(1)
            depth=1
            nested=[]
            continue
        if namespace is None:
            continue
        inner=re.match(r'\s*namespace (\w+)\s*\{',line)
        if inner:
            nested.append((inner.group(1),depth))
        func=re.match(r'\s*function\s+(\w+)(?:<[^>]+>)?\s*\(',line)
        if func:
            names.append('.'.join([namespace]+[n for n,_ in nested]+[func.group(1)]))
        depth+=line.count('{')-line.count('}')
        nested=[(n,d) for n,d in nested if depth>d]
        if depth<=0:
            namespace=None
    return names

pages={p.name:Scan() for p in SITE.glob('*.html')}
for name,parser in pages.items():
    parser.feed((SITE/name).read_text())
errors=[]
for name,parser in pages.items():
    for link in parser.links:
        parsed=urlsplit(link)
        if parsed.scheme or parsed.netloc or link.startswith(('mailto:','tel:')):
            continue
        target=(SITE/name).parent/unquote(parsed.path) if parsed.path else SITE/name
        if not target.exists():
            errors.append(f'{name}: missing {link}')
            continue
        if parsed.fragment and target.suffix=='.html':
            target_parser=pages.get(target.name)
            if target_parser is None or unquote(parsed.fragment) not in target_parser.ids:
                errors.append(f'{name}: missing anchor {link}')
actual=pages['api.html'].api
source=TYPES.read_text()
expected=type_functions(source)
# Confirm every shown signature is a declaration in the type file, including
# the multiline animation options object. Whitespace is presentation only.
flat=lambda value: re.sub(r'\s+', '', value)
for name, signature in pages['api.html'].signatures.items():
    if flat(signature) not in flat(source):
        errors.append(f'API signature mismatch: {name}')
missing=sorted(set(expected)-set(actual))
extra=sorted(set(actual)-set(expected))
duplicates=sorted(n for n in set(actual) if actual.count(n)>1)
if missing: errors.append('API missing: '+', '.join(missing))
if extra: errors.append('API invented: '+', '.join(extra))
if duplicates: errors.append('API duplicates: '+', '.join(duplicates))
print(f'HTML pages: {len(pages)}; internal href/src and anchors checked')
print(f'API: {len(actual)} catalog entries, {len(expected)} type declarations, {len(set(n.rsplit(".",1)[0] for n in expected))} function namespaces')
print('API missing:',missing or 'none')
print('API invented:',extra or 'none')
print('API duplicates:',duplicates or 'none')
print('API signatures not found in lume.d.ts:', [e for e in errors if 'signature mismatch' in e] or 'none')
for error in errors: print('ERROR:',error)
sys.exit(bool(errors))
