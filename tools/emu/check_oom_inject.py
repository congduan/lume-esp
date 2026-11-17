#!/usr/bin/env python3
"""esp32sim OOM fault-injection drill (r77): arm the allocator failure window
over the LUMC command channel, then prove the engine survived.

Sequence (all timestamps are simulated serial-script seconds):
  t=2.5  serial "OOM\\t2500"   -> CMD OK oom 2500      (arm; failures at 5.0 s)
  t=5.0  (window opens)       allocator returns NULL for 1 s; the clock app
         keeps its 1 s interval alive, so the denials land as JS exceptions
  t=7.5  serial "LIST"        -> CMD OK list <n>      (channel alive after OOM)
  t=9.0  reload clock.frame    -> RELOAD OK <len>      (runtime recycle works)

Fail if any of: no CMD OK oom, no oom-inject ACTIVE log, no window-closed log,
LIST missing, or RELOAD ERR / eval failed after the drill.
Profile firmware only (CONFIG_LUME_PERF_PROFILE=y, sdkconfig.r54-profile);
non-profile builds answer CMD ERR verb and cannot run this drill.
"""
import argparse
import os
import pathlib
import re
import struct
import subprocess
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
EMU = ROOT / 'tools/emu'
PROFILE = ROOT / 'firmware/build-r54-profile'
APP = ROOT / 'examples/clock'   # 1 s interval keeps allocating during the window
OUT = ROOT / 'artifacts/emu/oom-inject'
SECONDS = 13


def build_frame(dest, app):
    subprocess.run(['node', str(EMU / 'prepare.mjs'), str(app), str(dest)],
                   cwd=ROOT, check=True)


def run_sim(actions_text, name):
    out = OUT / name
    out.mkdir(parents=True, exist_ok=True)
    (out / 'actions.txt').write_text(actions_text)
    sim = pathlib.Path(os.environ.get('EMU_BIN', str(EMU / '.cache/bin/esp32sim')))
    rom = os.environ.get('EMU_ROM')
    if not rom:
        candidates = [EMU / '.cache/rom/esp32s3_rev0_rom.elf'] + list(
            pathlib.Path.home().glob(
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
        subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                       check=True)
    return (out / 'serial.log').read_text(errors='replace'), out


def lumc_frame(text):
    """Encode a LUMC command frame: magic 'LUMC' + len u32le + crc32 u32le +
    payload (see firmware/components/lume-hotreload/include/lume_frame.h).
    The firmware USB channel speaks ONLY this frame protocol -- plain text
    lines are rejected as bad-magic (first-round bug, fixed in r77)."""
    payload = text.encode('utf-8')
    return (b'LUMC' + struct.pack('<II', len(payload),
                                  zlib.crc32(payload) & 0xffffffff) +
            payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-going', action='store_true',
                        help='print all findings instead of stopping at the first')
    args = parser.parse_args()

    frame = OUT / 'clock.frame'
    frame.parent.mkdir(parents=True, exist_ok=True)
    build_frame(frame, APP)
    # r64: run.sh would overwrite actions.txt; we invoke esp32sim directly.
    # esp32sim has no `cmd` action: LUMC verbs ride inside LUMC frames on the
    # USB serial console. `serial <text>` would be rejected as bad-magic by
    # the frame parser, so commands are pre-encoded frames fed via
    # `serial-file` (same channel the reload frame uses).
    oom_frame = OUT / 'oom.cmd.frame'
    list_frame = OUT / 'list.cmd.frame'
    oom_frame.write_bytes(lumc_frame('OOM\t2500\n'))
    list_frame.write_bytes(lumc_frame('LIST\n'))
    # Hot-reload RX driver is up ~1.8 s into sim time (log: "USB hot-reload
    # up"); arm at 2.5 s -> failure window 5.0-6.0 s.
    actions = (
        f'2.5 serial-file {oom_frame}\n'
        f'7.5 serial-file {list_frame}\n'
        f'9.0 serial-file {frame}\n'
    )
    serial, out = run_sim(actions, 'counter')

    problems = []

    def need(pattern, what):
        if not re.search(pattern, serial):
            problems.append(f'missing {what}')

    need(r'CMD OK oom 2500', 'OOM arm ack (CMD OK oom 2500)')
    need(r'oom-inject: armed', 'armed log line')
    need(r'oom-inject: ACTIVE', 'ACTIVE log line (window opened)')
    need(r'oom-inject: window closed after \d+ denials',
         'window-closed log line')
    need(r'CMD OK list \d+', 'LIST alive after the OOM window')
    if re.search(r'RELOAD ERR|eval failed', serial[serial.find('oom-inject'):]):
        problems.append('reload/eval failed after the OOM drill')
    need(r'RELOAD OK \d+', 'counter reloaded OK after the drill')

    for line in serial.splitlines():
        if 'oom-inject' in line or 'CMD OK' in line or 'RELOAD' in line:
            print(line)

    growth = None
    samples = [(int(t), int(net)) for t, net in re.findall(
        r'I \((\d+)\) lume-perf: alloc\.net=(\d+)', serial)]
    if len(samples) >= 2:
        growth = samples[-1][1] - samples[0][1]
        print(f'alloc.net drift across run: {growth} B '
              f'({len(samples)} samples)')

    if problems:
        for p in problems:
            print(f'FAIL: {p}', file=sys.stderr)
        print(f'logs: {out / "serial.log"}', file=sys.stderr)
        return 1
    print(f'PASS: engine survived the OOM window '
          f'(arm -> 2500 ms -> ACTIVE -> window closed -> LIST ok -> reload ok); '
          f'artifacts: {out}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(2)
