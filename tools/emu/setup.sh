#!/usr/bin/env bash
# Build the patched esp32sim. The released v0.3.0 binary has fixed CO5300 geometry.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cache=${EMU_CACHE_DIR:-$root/tools/emu/.cache}
source_dir=$cache/esp32sim
revision=56ea9b2a559f881aa52f44388cde1a71f9047088
mkdir -p "$cache"
if [[ ! -d $source_dir/.git ]]; then
  git clone --no-checkout --filter=blob:none --depth 1 https://github.com/mikroverk/esp32sim.git "$source_dir"
fi
git -C "$source_dir" fetch --depth 1 origin "$revision"
git -C "$source_dir" checkout --detach "$revision"
if git -C "$source_dir" apply --check "$root/tools/emu/esp32sim-56ea9b2-lume.patch" 2>/dev/null; then
  git -C "$source_dir" apply "$root/tools/emu/esp32sim-56ea9b2-lume.patch"
elif ! git -C "$source_dir" apply --reverse --check "$root/tools/emu/esp32sim-56ea9b2-lume.patch"; then
  echo "esp32sim source differs from the pinned patch" >&2; exit 1
fi
cargo build --release -p esp32sim --bin esp32sim --manifest-path "$source_dir/Cargo.toml"
mkdir -p "$cache/bin"
cp "$source_dir/target/release/esp32sim" "$cache/bin/esp32sim"
"$cache/bin/esp32sim" --version
