#!/usr/bin/env python3
"""Install an acceptance app into a copy of a merged ESP32-S3 flash image."""
import argparse
import json
from pathlib import Path

from littlefs import LittleFS, UserContext

STORAGE_OFFSET = 0x750000
STORAGE_SIZE = 0x100000


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    parser.add_argument('app', type=Path)
    parser.add_argument('--ssid', required=True)
    parser.add_argument('--password', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--sd', action='store_true')
    args = parser.parse_args()
    flash = bytearray(args.image.read_bytes())
    if len(flash) < 0x10000:
        raise SystemExit('merged flash is smaller than app offset')
    flash.extend(b'\xff' * max(0, STORAGE_OFFSET + STORAGE_SIZE - len(flash)))
    config = {'ssid': args.ssid, 'password': args.password,
              'url': args.url, 'sd': args.sd}
    source = ('var __NETCHECK_CONFIG = ' + json.dumps(config) + ';\n').encode()
    source += (args.app / 'app.js').read_bytes()
    if len(source) > 256 * 1024:
        raise SystemExit('app exceeds firmware 256 KiB limit')
    context = UserContext(buffsize=STORAGE_SIZE)
    fs = LittleFS(context, mount=False, block_size=4096, block_count=STORAGE_SIZE // 4096,
                  read_size=128, prog_size=128, cache_size=512, lookahead_size=128,
                  block_cycles=512)
    fs.format()
    fs.mount()
    fs.mkdir('apps')
    fs.mkdir('apps/net_check')
    with fs.open('apps/net_check/app.js', 'wb') as file:
        file.write(source)
    with fs.open('apps/.current', 'wb') as file:
        file.write(b'net_check')
    fs.unmount()
    flash[STORAGE_OFFSET:STORAGE_OFFSET + STORAGE_SIZE] = context.buffer
    args.image.write_bytes(flash)
    print(f'prepared {args.image}: {len(flash)} bytes; app {len(source)} bytes')


if __name__ == '__main__':
    main()
