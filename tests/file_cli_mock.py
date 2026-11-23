"""r173 serial CLI integration against a PTY device implementing LUMC replies."""
import json
import os
import pty
import select
import subprocess
import tempfile
import threading
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
master, slave = pty.openpty()
port = os.ttyname(slave)
files = {}
errors = []
stop = False


def device():
    pending = bytearray()
    while not stop:
        if not select.select([master], [], [], .1)[0]:
            continue
        try:
            pending.extend(os.read(master, 65536))
        except OSError:
            continue
        while len(pending) >= 12:
            if pending[:4] != b'LUMC':
                pending.pop(0)
                continue
            size = int.from_bytes(pending[4:8], 'little')
            if len(pending) < size + 12:
                break
            crc = int.from_bytes(pending[8:12], 'little')
            payload = bytes(pending[12:12 + size])
            del pending[:12 + size]
            if zlib.crc32(payload) != crc:
                errors.append('CRC mismatch')
                continue
            head, _, raw = payload.partition(b'\n')
            fields = head.decode().split('\t')
            op = fields[0]
            try:
                if op == 'FPUT':
                    _, typ, path, offset, total = fields
                    assert typ == 'file'
                    offset, total = int(offset), int(total)
                    assert offset == len(files.get(path, b''))
                    assert total <= 8 * 1024 * 1024 and offset + len(raw) <= total
                    files[path] = files.get(path, b'') + raw
                    reply = f'CMD OK fput {len(files[path])}\n'.encode()
                elif op == 'FGET':
                    _, path, offset, length = fields
                    data = files[path][int(offset):int(offset) + int(length)]
                    import base64
                    reply = b'F64' + base64.b64encode(data) + b'\n' + f'CMD OK fget {len(data)}\n'.encode()
                elif op == 'FLS':
                    path = fields[1]
                    entries = [{'name': k.split('/')[-1], 'size': len(v), 'dir': False}
                               for k, v in files.items() if k.startswith(path)]
                    document = json.dumps(entries).encode()
                    mid = len(document) // 2
                    reply = b'FLS\t' + document[:mid] + b'\nFLS\t' + document[mid:] + b'\n' + f'CMD OK fls {len(entries)}\n'.encode()
                elif op == 'FDEL':
                    del files[fields[1]]
                    reply = b'CMD OK fdel\n'
                else:
                    raise AssertionError(op)
                os.write(master, reply)
            except Exception as exc:
                errors.append(str(exc))
                os.write(master, b'CMD ERR mock\n')


thread = threading.Thread(target=device, daemon=True)
thread.start()
with tempfile.TemporaryDirectory() as temp:
    source = Path(temp) / 'sample.bin'
    data = bytes(range(256)) * 400  # 102400 bytes
    source.write_bytes(data)
    cli = ROOT / 'tools/lume/lume.js'

    def run(*args):
        result = subprocess.run(['node', str(cli), *args, '--port', port],
                                cwd=ROOT, capture_output=True, text=True, timeout=90)
        assert result.returncode == 0, result.stderr
        return result.stdout

    assert 'verified' in run('fput', str(source), 'sd:/sample.bin')
    listing = json.loads(run('fls', 'sd:/'))
    assert listing == [{'name': 'sample.bin', 'size': 102400, 'dir': False}]
    assert files['sd:/sample.bin'] == data
    run('fdel', 'sd:/sample.bin')
    assert not files
stop = True
thread.join(timeout=1)
assert not errors, errors
print('file CLI PTY mock: FPUT 100 KiB / FLS / FGET SHA-256 / FDEL PASS')
