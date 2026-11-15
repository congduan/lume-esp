#!/usr/bin/env bash
# Fetch the Espressif S3 mask ROM ELF, pinned to esp-rom-elfs 20260528.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cache=${EMU_CACHE_DIR:-$root/tools/emu/.cache}
rom=$cache/rom/esp32s3_rev0_rom.elf
hash=c0ce0f338d1de1bdc6efbef1591779a2a42c1ab7d759d3c6ae8ae63a7dd34cfd
if [[ -s $rom ]] && echo "$hash  $rom" | sha256sum -c --status; then echo "$rom"; exit 0; fi
mkdir -p "$cache/rom"
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl -fL --retry 3 -o "$archive" https://github.com/espressif/esp-rom-elfs/releases/download/20260528/esp-rom-elfs-20260528.tar.gz
entry=esp32s3_rev0_rom.elf
tar -tzf "$archive" | grep -qx "$entry" || { echo 'S3 ROM not found in archive' >&2; exit 1; }
tar -xOzf "$archive" "$entry" > "$rom"
echo "$hash  $rom" | sha256sum -c
