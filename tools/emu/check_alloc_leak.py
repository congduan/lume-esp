#!/usr/bin/env python3
"""esp32sim allocator profile: counter steady state and deliberate leak control."""
import argparse
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EMU = ROOT / 'tools/emu'
PROFILE = ROOT / 'firmware/build-r54-profile'
THRESHOLD = 32768  # calibrated from the r54 esp32sim runs; see roadmap result
SECONDS = 13  # frame arrives at 2.5 s; app runs for roughly 10 s


def capture(name, app):
    out = ROOT / 'artifacts/emu/alloc-leak' / name
    out.mkdir(parents=True, exist_ok=True)
    frame = out / 'app.frame'
    subprocess.run(['node', str(EMU / 'prepare.mjs'), str(app), str(frame)],
                   cwd=ROOT, check=True)
    (out / 'actions.txt').write_text(f'2.5 serial-file {frame}\n')
    sim = pathlib.Path(os.environ.get('EMU_BIN', str(EMU / '.cache/bin/esp32sim')))
    rom = os.environ.get('EMU_ROM')
    if not rom:
        candidates = [EMU / '.cache/rom/esp32s3_rev0_rom.elf'] + list(pathlib.Path.home().glob(
            '.espressif/tools/esp-rom-elfs/*/esp32s3_rev0_rom.elf'))
        candidates = [p for p in candidates if p.is_file()]
        if not candidates:
            raise RuntimeError('S3 ROM missing; set EMU_ROM')
        rom = str(candidates[0])
    images = [PROFILE / 'bootloader/bootloader.bin',
              PROFILE / 'partition_table/partition-table.bin', PROFILE / 'lume.bin']
    if not sim.is_file() or any(not p.is_file() for p in images):
        raise RuntimeError('profile images or esp32sim missing; build with '
                           'idf.py -B build-r54-profile -D SDKCONFIG=sdkconfig.r54-profile build')
    cmd = [str(sim), '--chip', 's3', '--board', 'lume-amoled216', '--boot', 'rom',
           '--rom', rom, '--bootloader', str(images[0]), '--ptable', str(images[1]),
           '--app', str(images[2]), '--flash-mb', '16', '--psram-mb', '8',
           '--script', str(out / 'actions.txt'), '--max-seconds', str(SECONDS),
           '--tft-png', str(out / 'tft.png'), '--console', 'all', '--no-dump']
    with (out / 'serial.log').open('w') as log:
        subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    serial = (out / 'serial.log').read_text(errors='replace')
    matches = list(re.finditer(r'I \((\d+)\) lume-engine: app eval ok; entering event loop', serial))
    if len(matches) < 2 or 'RELOAD ERR' in serial or 'eval failed' in serial:
        raise RuntimeError(f'{name}: app reload failed; see {out / "serial.log"}')
    start = int(matches[-1].group(1))
    samples = [(int(t), int(net), int(live)) for t, net, live in
               re.findall(r'I \((\d+)\) lume-perf: alloc\.net=(\d+) alloc\.live=(\d+)',
                          serial[matches[-1].end():]) if int(t) >= start + 2000]
    if len(samples) < 3:
        raise RuntimeError(f'{name}: fewer than 3 post-warmup profile samples')
    for t, net, live in samples:
        print(f'{name}: I ({t}) lume-perf: alloc.net={net} alloc.live={live}')
    return samples[-1][1] - samples[0][1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=['counter', 'leak', 'both'], default='both')
    args = parser.parse_args()
    cases = [('counter', ROOT / 'examples/counter'),
             ('leak', EMU / 'alloc_leak_app')]
    failed = False
    ran = False
    for name, app in cases:
        if args.case not in (name, 'both'):
            continue
        ran = True
        growth = capture(name, app)
        stable = growth < THRESHOLD
        print(f'{name}: steady-growth={growth} threshold={THRESHOLD} '
              f'{"PASS" if stable else "FAIL"}')
        # counter must stay flat (negative control); leak must trip (proof the
        # counter catches real leaks). Any other outcome fails the harness.
        if (name == 'counter') != stable:
            failed = True
    if not ran:
        print(f'no case ran for --case {args.case}', file=sys.stderr)
        return 2
    return 1 if failed else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(2)
