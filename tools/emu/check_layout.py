#!/usr/bin/env python3
"""Scan rendered PNG geometry against an explicit JSON layout contract.

Usage: check_layout.py screenshot.png expectations.json [--app name]
       check_layout.py --all expectations.json --images artifacts/emu/ui-refresh

Rectangles use half-open coordinates. A block's ROI only limits the search; its
reported bounding box comes from rendered pixels. Solid fills are matched in
RGB565 space, which also works when a card is close to the page background.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image


def rgb565(rgb):
    return tuple((v >> shift) for v, shift in zip(rgb, (3, 2, 3)))


def hex_rgb(value):
    return tuple(bytes.fromhex(value.removeprefix('#')))


def bbox(points):
    if not points:
        return None
    return [min(x for x, _ in points), min(y for _, y in points),
            max(x for x, _ in points) + 1, max(y for _, y in points) + 1]


def scan(image, block, background):
    x0, y0, x1, y1 = block['roi']
    mode = block.get('mode', 'fill')
    targets = [rgb565(hex_rgb(value)) for value in block.get('colors', [block.get('color', '#000000')])] if mode == 'fill' else []
    bg = rgb565(hex_rgb(block.get('background', background)))
    sample = image.getpixel(tuple(block['sample'])) if mode == 'sample' else None
    threshold = block.get('threshold', 0)
    points = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            raw = image.getpixel((x, y))[:3]
            pixel = rgb565(raw)
            if mode == 'fill':
                matched = pixel in targets
            elif mode == 'sample':
                matched = max(abs(a-b) for a, b in zip(raw, sample)) <= threshold
            elif mode == 'edge':
                limit = block.get('edge_threshold', 4)
                matched = any(max(abs(a-b) for a, b in zip(raw, image.getpixel((nx, ny))[:3])) >= limit
                              for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1))
                              if 0 <= nx < image.width and 0 <= ny < image.height)
            else:
                matched = pixel != bg
            if matched:
                points.append((x, y))
    return bbox(points)


def delta(a, b):
    return abs(a - b)


def check(path, spec):
    image = Image.open(path).convert('RGB')
    width, height = image.size
    results = []
    boxes = {}
    for name, block in spec['blocks'].items():
        box = scan(image, block, spec['background'])
        boxes[name] = box
        print(f'  {name:18} bbox={box}')
        if box is None:
            results.append((block.get('rule', 'R1'), False, f'{name}: no pixels'))

    def record(rule, label, actual, expected, tolerance):
        good = actual is not None and delta(actual, expected) <= tolerance
        results.append((rule, good, f'{label}: {actual} expected {expected} ±{tolerance}'))

    gutter = spec['gutter']
    for name in spec.get('full', []):
        box = boxes[name]
        if box:
            record('R1', f'{name}.left', box[0], gutter, 1)
            record('R1', f'{name}.right', box[2], width - gutter, 1)
    for row in spec.get('rows', []):
        items = [boxes[n] for n in row]
        if all(items):
            record('R1', f'{row[0]}.left', items[0][0], gutter, 1)
            record('R1', f'{row[-1]}.right', items[-1][2], width - gutter, 1)
            for a, b in zip(items, items[1:]):
                gap = b[0] - a[2]
                results.append(('R5', min(delta(gap, n) for n in (4, 8, 12, 16, 24, 32)) <= 1,
                                f'{row}: horizontal gap {gap}'))
    for row in spec.get('edge_rows', []):
        a, b = boxes[row[0]], boxes[row[-1]]
        if a and b:
            record('R1', f'{row[0]}.left', a[0], gutter, 1)
            record('R1', f'{row[-1]}.right', b[2], width - gutter, 1)
    for group in spec.get('same_width', []):
        sizes = [boxes[n][2] - boxes[n][0] for n in group if boxes[n]]
        results.append(('R2', len(sizes) == len(group) and max(sizes) - min(sizes) <= 1,
                        f'{group}: widths {sizes}'))
    for title, control in spec.get('headers', []):
        a, b = boxes[title], boxes[control]
        if a and b:
            record('R3', f'{title}/{control} centerY', (a[1]+a[3])/2, (b[1]+b[3])/2, 2)
    for card, content in spec.get('centers', []):
        a, b = boxes[card], boxes[content]
        if a and b:
            top, bottom = b[1]-a[1], a[3]-b[3]
            results.append(('R4', delta(top, bottom) <= 2,
                            f'{card}/{content}: top={top} bottom={bottom} difference={delta(top,bottom)}'))
    for upper, lower in spec.get('vertical_gaps', []):
        a, b = boxes[upper], boxes[lower]
        if a and b:
            gap = b[1] - a[3]
            results.append(('R5', min(delta(gap, n) for n in (4, 8, 12, 16, 24, 32)) <= 1,
                            f'{upper}/{lower}: vertical gap {gap}'))
    for name in spec.get('buttons', []):
        box = boxes[name]
        if box:
            actual = box[3] - box[1]
            results.append(('R6', actual >= 56, f'{name}: height {actual} >= 56'))
            results.append(('R6', min(box[0], width-box[2], box[1], height-box[3]) >= gutter,
                            f'{name}: screen inset >= {gutter}'))
    for group in spec.get('text_left', []):
        xs = [boxes[n][0] for n in group if boxes[n]]
        results.append(('R7', len(xs) == len(group) and max(xs)-min(xs) <= 2,
                        f'{group}: ink left edges {xs}'))
    for group in spec.get('text_center', []):
        cs = [(boxes[n][0]+boxes[n][2])/2 for n in group if boxes[n]]
        results.append(('R7', len(cs) == len(group) and max(cs)-min(cs) <= 2,
                        f'{group}: ink centerX {cs}'))
    by_rule = {rule: [] for rule in ('R1','R2','R3','R4','R5','R6','R7')}
    for rule, good, message in results:
        by_rule[rule].append(good)
        print(f'  {"PASS" if good else "FAIL"} {rule} {message}')
    return {rule: ('PASS' if not values or all(values) else 'FAIL')
            for rule, values in by_rule.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('png_or_spec', type=Path)
    parser.add_argument('spec', nargs='?', type=Path)
    parser.add_argument('--app')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--images', type=Path, default=Path('artifacts/emu/ui-refresh'))
    args = parser.parse_args()
    source = args.png_or_spec if args.all else args.spec
    if source is None:
        parser.error('expectations JSON is required')
    specs = json.loads(source.read_text())
    if args.all:
        apps = list(specs)
    else:
        apps = [args.app or args.png_or_spec.stem]
    table = {}
    for app in apps:
        path = args.images / (app + '.png') if args.all else args.png_or_spec
        if app not in specs:
            parser.error(f'no specification for {app}')
        print(f'\n{app}: {path}')
        table[app] = check(path, specs[app])
    print('\napp                  R1    R2    R3    R4    R5    R6    R7')
    for app, row in table.items():
        print(f'{app:20} ' + ' '.join(f'{row[r]:5}' for r in ('R1','R2','R3','R4','R5','R6','R7')))
    return 1 if any(v == 'FAIL' for row in table.values() for v in row.values()) else 0


if __name__ == '__main__':
    sys.exit(main())
