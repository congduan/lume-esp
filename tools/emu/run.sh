#!/usr/bin/env bash
# Build firmware, boot its real ROM/bootloader/app, inject an app frame, capture TFT and console.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
app=${1:?usage: tools/emu/run.sh examples/counter}
if [[ $app != /* ]]; then app=$root/$app; fi
[[ -f $app/app.js ]] || { echo "app.js missing: $app" >&2; exit 2; }
name=$(basename "$app")
output=${EMU_OUTPUT_DIR:-$root/artifacts/emu/$name}
mkdir -p "$output"
if [[ ${EMU_SKIP_BUILD:-0} != 1 ]]; then
  if ! command -v idf.py >/dev/null; then
    # Local Linux installations can supply IDF through export.sh.
    unset VIRTUAL_ENV
    if [[ -d $HOME/.espressif/python_env/idf5.5_py3.12_env ]]; then
      export IDF_PYTHON_ENV_PATH=$HOME/.espressif/python_env/idf5.5_py3.12_env
    fi
    source /opt/esp/esp-idf/export.sh >/dev/null
  fi
  (cd "$root/firmware" && idf.py build)
fi
for f in "$root/firmware/build/bootloader/bootloader.bin" "$root/firmware/build/partition_table/partition-table.bin" "$root/firmware/build/lume.bin"; do
  [[ -s $f ]] || { echo "firmware image missing: $f" >&2; exit 1; }
done
sim=${EMU_BIN:-$root/tools/emu/.cache/bin/esp32sim}
[[ -x $sim ]] || { echo "esp32sim missing: $sim; run tools/emu/setup.sh" >&2; exit 1; }
rom=${EMU_ROM:-}
if [[ -z $rom ]]; then
  rom=$(find "$HOME/.espressif/tools/esp-rom-elfs" -name esp32s3_rev0_rom.elf -print -quit 2>/dev/null || true)
fi
[[ -s $rom ]] || { echo 'S3 ROM ELF missing; set EMU_ROM (see README)' >&2; exit 1; }
prepare_args=("$app" "$output/app.frame")
# EMU_BYTECODE=1 compiles the bundle with qjsc and injects a "LUMB" frame.
if [[ ${EMU_BYTECODE:-0} == 1 ]]; then prepare_args+=(--bytecode); fi
node "$root/tools/emu/prepare.mjs" "${prepare_args[@]}"
printf '2.5 serial-file %s\n' "$output/app.frame" > "$output/actions.txt"
"$sim" --chip s3 --board "${EMU_BOARD:-lume-amoled216}" --boot rom --rom "$rom" \
  --bootloader "$root/firmware/build/bootloader/bootloader.bin" \
  --ptable "$root/firmware/build/partition_table/partition-table.bin" \
  --app "$root/firmware/build/lume.bin" --flash-mb 16 --psram-mb 8 \
  --script "$output/actions.txt" --max-seconds "${EMU_SECONDS:-8}" \
  --tft-png "$output/tft.png" --console all --no-dump \
  > "$output/serial.log" 2>&1
[[ -s $output/tft.png ]] || { echo "TFT PNG missing: $output/tft.png" >&2; exit 1; }
if ! grep -qE "engine recv RELOAD" "$output/serial.log" || \
   ! grep -qE "runtime up; eval app '<embedded-demo>'" "$output/serial.log" || \
   [[ $(grep -cE "lume-engine: app eval ok" "$output/serial.log" || true) -lt 2 ]] || \
   grep -qE "eval failed|RELOAD ERR" "$output/serial.log"; then
  echo "app reload did not complete successfully; see $output/serial.log" >&2
  tail -40 "$output/serial.log" >&2
  exit 1
fi
grep -E 'lume-engine: (engine task up|engine recv RELOAD|runtime up; eval app|app eval ok)|\[emu\] stop' "$output/serial.log" || true
echo "TFT: $output/tft.png"
echo "serial: $output/serial.log"
