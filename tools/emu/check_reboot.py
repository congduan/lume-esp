#!/usr/bin/env python3
"""r141: minimal esp32sim check that lume.system.reboot() really restarts the SoC.

Run from the repo root after the DEFAULT firmware build:
    python3 tools/emu/check_reboot.py

It injects one LUMR REPL frame (`lume.system.reboot();`) at t=2.5 s into the
running app, then asserts from the serial log that:
  1. the native emitted `lume.system: reboot requested` before the reset;
  2. esp32sim reports a software chip reset (cause 0xc / RTC_SW_CPU_RST);
  3. the engine task came back up AFTER that reset (a second `engine task up`).

This proves the reboot path end-to-end in the simulator. It does NOT prove
real board behaviour (PMIC power sequencing, reset reason on silicon, timing).
Output goes to /tmp by default; set EMU_REBOOT_OUT to override.
"""
import os
import pathlib
import re
import struct
import subprocess
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
EMU = ROOT / 'tools/emu'
IMG = ROOT / 'firmware/build'
OUT = pathlib.Path(os.environ.get('EMU_REBOOT_OUT', '/tmp/lume-emu-reboot'))
SECONDS = 8


def repl_frame(text):
    """LUMR frame: one JS expression evaluated in the current app context."""
    payload = text.encode('utf-8')
    return (b'LUMR' + struct.pack('<II', len(payload),
                                  zlib.crc32(payload) & 0xffffffff) + payload)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    frame = OUT / 'reboot.frame'
    frame.write_bytes(repl_frame('lume.system.reboot();'))
    (OUT / 'actions.txt').write_text(f'2.5 serial-file {frame}\n')

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
    images = [IMG / 'bootloader/bootloader.bin',
              IMG / 'partition_table/partition-table.bin', IMG / 'lume.bin']
    if not sim.is_file() or any(not p.is_file() for p in images):
        raise RuntimeError('default images or esp32sim missing; run idf.py build '
                           'and tools/emu/setup.sh')
    cmd = [str(sim), '--chip', 's3', '--board', 'lume-amoled216', '--boot', 'rom',
           '--rom', rom, '--bootloader', str(images[0]), '--ptable', str(images[1]),
           '--app', str(images[2]), '--flash-mb', '16', '--psram-mb', '8',
           '--script', str(OUT / 'actions.txt'), '--max-seconds', str(SECONDS),
           '--tft-png', str(OUT / 'tft.png'), '--console', 'all', '--no-dump']
    with (OUT / 'serial.log').open('w') as log:
        subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                       check=True)
    serial = (OUT / 'serial.log').read_text(errors='replace')

    problems = []
    log_at = serial.find('lume.system: reboot requested')
    reset_at = serial.find('chip reset at')
    if log_at < 0:
        problems.append('missing lume.system: reboot requested log line')
    if reset_at < 0:
        problems.append('missing esp32sim chip reset marker')
    if log_at >= 0 and reset_at >= 0 and log_at >= reset_at:
        problems.append('reboot log did not precede the chip reset')
    if not re.search(r'cause 0xc \(RTC_SW_CPU_RESET\)', serial):
        problems.append('chip reset cause is not software (0xc)')
    if not re.search(r'rst:0xc \(RTC_SW_CPU_RST\)', serial):
        problems.append('ROM reset reason is not SW_CPU_RST')
    # A second engine boot after the reset proves the SoC actually restarted.
    first_engine = serial.find('engine task up')
    second_engine = serial.find('engine task up', first_engine + 1)
    if first_engine < 0 or second_engine < reset_at:
        problems.append('engine task did not come back up after the reset')

    if problems:
        print('FAIL check_reboot: ' + '; '.join(problems), file=sys.stderr)
        print('--- serial tail ---', file=sys.stderr)
        print('\n'.join(serial.splitlines()[-40:]), file=sys.stderr)
        return 1
    print('PASS check_reboot: native log -> software chip reset -> engine restart')
    print(f'PASS reset reason: rst:0xc (RTC_SW_CPU_RST) / cause 0xc (RTC_SW_CPU_RESET)')
    print(f'PASS serial: {OUT / "serial.log"}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f'FAIL check_reboot (environment): {exc}', file=sys.stderr)
        sys.exit(2)
