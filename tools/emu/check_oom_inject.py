#!/usr/bin/env python3
"""esp32sim OOM fault-injection drill (r77, denial-positive case added in r140):
arm the allocator failure window over the LUMC command channel, then prove the
engine survived AND (in the denial-positive case) that N>=1 allocations really
landed inside the window.

Cases:
  counter         (original, unchanged):
    t=2.5  serial "OOM\\t2500"   -> CMD OK oom 2500      (arm; failures at 5.0 s)
    t=5.0  (window opens)       allocator returns NULL for 1 s; the running app
           keeps allocating, so denials land as JS exceptions
    t=7.5  serial "LIST"        -> CMD OK list <n>      (channel alive after OOM)
    t=9.0  reload a tiny LUME source frame -> RELOAD OK <len>  (recycle works)
    Asserts window closed with >=0 denials (honest r139 boundary).

  denial-positive (new, the main r140 acceptance):
    same sequence, but lightweight REPL source frames are evaluated at t=5.2
    and t=5.5 (INSIDE the 5.0-6.0 s window). Their string building must
    allocate QuickJS cells, so the window must close with N>=1 denials.
    Asserts "window closed after [1-9]\\d* denials"; zero denials is a FAIL.

Empirical r140 notes (see KNOWN-SIMPLIFICATIONS r140):
  - A LUME *reload* staged inside the window OOMs in __lume_shutdown and trips
    the watchdog, losing the window-closed log; a LUMR REPL expression gives
    clean in-window allocations without a runtime tear-down.
  - The final recycle check uses a 10-byte LUME source frame instead of the
    3445-byte clock bundle; the emulator drops the large frame under this
    firmware's instruction timing. The RELOAD OK assertion is unchanged.

Fail if any of: no CMD OK oom, no oom-inject ACTIVE log, no window-closed log,
LIST missing, RELOAD ERR / eval failed after the window, or (denial-positive)
no allocation denial landed in the window.
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
OUT = ROOT / 'artifacts/emu/oom-inject'
SECONDS = 13


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


def data_frame(text):
    """Encode a LUME data frame: JS source evaluated on the engine task (with
    runtime recycle). Same 12-byte header/CRC as lumc_frame but magic 'LUME'.
    Used for the final 'RELOAD OK' recycle check with a tiny source body."""
    payload = text.encode('utf-8')
    return (b'LUME' + struct.pack('<II', len(payload),
                                  zlib.crc32(payload) & 0xffffffff) +
            payload)


def repl_frame(text):
    """Encode a LUMR REPL frame: ONE JS expression evaluated synchronously on
    the engine task INSIDE the current app context (no runtime recycle). Same
    12-byte header/CRC as lumc_frame but magic 'LUMR'. Used by the r140
    denial-positive case to force QuickJS string allocations into the window
    WITHOUT tearing down the app (a LUME reload inside the window OOMs in
    __lume_shutdown and trips the watchdog, losing the window-closed log)."""
    payload = text.encode('utf-8')
    return (b'LUMR' + struct.pack('<II', len(payload),
                                  zlib.crc32(payload) & 0xffffffff) +
            payload)


def check_case(actions, name, denial_positive):
    """Run one drill case and print/return its findings (True == PASS)."""
    serial, out = run_sim(actions, name)
    problems = []

    def need(pattern, what):
        if not re.search(pattern, serial):
            problems.append(f'missing {what}')

    need(r'CMD OK oom 2500', 'OOM arm ack (CMD OK oom 2500)')
    need(r'oom-inject: armed', 'armed log line')
    need(r'oom-inject: ACTIVE', 'ACTIVE log line (window opened)')
    if denial_positive:
        # r140: the whole point of this case -- N>=1 real allocation denials.
        need(r'oom-inject: window closed after [1-9]\d* denials',
             'window-closed log line with N>=1 denials (denial-positive)')
    else:
        need(r'oom-inject: window closed after \d+ denials',
             'window-closed log line')
    need(r'CMD OK list \d+', 'LIST alive after the OOM window')
    # r140: only judge reload/eval health AFTER the window closed. The
    # denial-positive case deliberately stages ephemeral frames that OOM
    # inside the window; their expected RELOAD ERR is not a drill failure.
    marker = serial.find('oom-inject: window closed')
    tail = serial[marker:] if marker >= 0 else serial
    if re.search(r'RELOAD ERR|eval failed', tail):
        problems.append('reload/eval failed after the OOM window')
    need(r'RELOAD OK \d+', 'counter reloaded OK after the drill')

    print(f'=== case: {name} ===')
    for line in serial.splitlines():
        if ('oom-inject' in line or 'CMD OK' in line or 'RELOAD' in line or
                'eval failed' in line or 'app eval' in line):
            print(line)

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
        return False
    if denial_positive:
        print(f'PASS: denial-positive window closed with >=1 allocation '
              f'denials (in-window REPL expressions forced allocations); '
              f'artifacts: {out}')
    else:
        print(f'PASS: engine survived the OOM window '
              f'(arm -> 2500 ms -> ACTIVE -> window closed -> LIST ok -> '
              f'reload ok); artifacts: {out}')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=['counter', 'denial-positive', 'all'],
                        default='all',
                        help='which drill case to run (default: all)')
    parser.add_argument('--denial-positive', action='store_true',
                        help='run only the denial-positive case '
                             '(alias for --case denial-positive)')
    parser.add_argument('--keep-going', action='store_true',
                        help='print all findings instead of stopping at the first')
    args = parser.parse_args()

    if args.denial_positive:
        cases = ['denial-positive']
    elif args.case == 'all':
        cases = ['counter', 'denial-positive']
    else:
        cases = [args.case]

    OUT.mkdir(parents=True, exist_ok=True)
    # r64: run.sh would overwrite actions.txt; we invoke esp32sim directly.
    # esp32sim has no `cmd` action: LUMC verbs ride inside LUMC frames on the
    # USB serial console. `serial <text>` would be rejected as bad-magic by
    # the frame parser, so commands are pre-encoded frames fed via
    # `serial-file` (same channel the reload frame uses).
    oom_frame = OUT / 'oom.cmd.frame'
    list_frame = OUT / 'list.cmd.frame'
    oom_frame.write_bytes(lumc_frame('OOM\t2500\n'))
    list_frame.write_bytes(lumc_frame('LIST\n'))

    # r140: a single REPL expression whose eval necessarily allocates (200
    # string concatenations). Evaluated synchronously inside the window it
    # guarantees N>=1 denials, with no runtime teardown / shutdown hook.
    ephem_frame = OUT / 'ephem.frame'
    ephem_frame.write_bytes(repl_frame(
        '(function(){var s="";for(var i=0;i<200;i++)s+="x";return s.length;})()'))
    # r140: tiny LUME source frame for the final recycle check (the emulator
    # drops the 3445-byte clock frame under this firmware's instruction timing).
    final_frame = OUT / 'final.frame'
    final_frame.write_bytes(data_frame('var a = 1;'))

    # Hot-reload RX driver is up ~1.8 s into sim time (log: "USB hot-reload
    # up"); arm at 2.5 s -> failure window 5.0-6.0 s.
    failed = False
    for case in cases:
        positive = case == 'denial-positive'
        actions = f'2.5 serial-file {oom_frame}\n'
        if positive:
            actions += f'5.2 serial-file {ephem_frame}\n'
            actions += f'5.5 serial-file {ephem_frame}\n'
        actions += f'7.5 serial-file {list_frame}\n'
        actions += f'9.0 serial-file {final_frame}\n'
        ok = check_case(actions, case, positive)
        if not ok:
            failed = True
            if not args.keep_going:
                break
    return 1 if failed else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(2)
