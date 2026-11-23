"""Exercise the real r173 firmware file commands in esp32sim LittleFS."""
import base64
import os
import re
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/r173/emu-file'
OUT.mkdir(parents=True, exist_ok=True)
FW = ROOT / 'firmware/build'
SIM = Path(os.environ.get('EMU_BIN', '/home/ubuntu/lume/tools/emu/.cache/bin/esp32sim'))
ROM = Path(os.environ.get('EMU_ROM', '/home/ubuntu/.espressif/tools/esp-rom-elfs/20241011/esp32s3_rev0_rom.elf'))
DATA = bytes(range(64))


def frame(payload):
    return b'LUMC' + len(payload).to_bytes(4, 'little') + zlib.crc32(payload).to_bytes(4, 'little') + payload


commands = [
    b'FPUT\tfile\tfs:/r173.bin\t0\t64\n' + DATA[:32],
    b'FPUT\tfile\tfs:/r173.bin\t33\t64\nx',  # rejected, preserves 32 bytes
    b'FPUT\tfile\tfs:/../escape\t0\t1\nx',  # traversal rejected by parser
    b'FPUT\tfile\tfs:/r173.bin\t32\t64\n' + DATA[32:],
    b'FLS\tfs:/',
    b'FGET\tfs:/r173.bin\t0\t64',
    b'FDEL\tfs:/r173.bin',
    b'FLS\tfs:/',
]
actions = []
for i, payload in enumerate(commands):
    name = OUT / f'cmd-{i}.frame'
    name.write_bytes(frame(payload))
    actions.append(f'{2.5 + i * .7:.1f} serial-file {name}')
(OUT / 'actions.txt').write_text('\n'.join(actions) + '\n')
args = [str(SIM), '--chip', 's3', '--board', 'lume-amoled216', '--boot', 'rom',
        '--rom', str(ROM), '--bootloader', str(FW / 'bootloader/bootloader.bin'),
        '--ptable', str(FW / 'partition_table/partition-table.bin'),
        '--app', str(FW / 'lume.bin'), '--flash-mb', '16', '--psram-mb', '8',
        '--script', str(OUT / 'actions.txt'), '--max-seconds', '9',
        '--console', 'all', '--no-dump']
with (OUT / 'serial.log').open('wb') as log:
    subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=180)
text = (OUT / 'serial.log').read_text(errors='replace')
assert 'CMD OK fput 32' in text and 'CMD OK fput 64' in text, 'FPUT ACK missing'
assert 'CMD ERR offset' in text and 'CMD ERR arg' in text, 'negative cases missing'
assert re.search(r'FLS\t\[.*"name":"r173.bin".*"size":64.*\]', text), 'FLS metadata missing'
assert 'F64' + base64.b64encode(DATA).decode() in text, 'FGET bytes differ'
assert 'CMD OK fdel' in text, 'FDEL ACK missing'
assert text.count('CMD OK fls') >= 2, 'FLS after delete missing'
assert re.search(r'FLS\t\[\{"name":"apps","size":0,"dir":true\}\]', text), 'deleted file still listed'
print('esp32sim LittleFS: FPUT chunks / FLS size / FGET bytes / FDEL PASS')
