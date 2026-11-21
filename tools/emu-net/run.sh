#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
app=${1:?usage: tools/emu-net/run.sh examples/net_check}
shift
if [[ $app != /* ]]; then app=$root/$app; fi
[[ -f $app/app.js ]] || { echo "app.js missing: $app" >&2; exit 2; }
name=$(basename "$app")
output=${EMU_NET_OUTPUT_DIR:-$root/artifacts/emu-net/$name}
mkdir -p "$output"
build=${EMU_NET_BUILD_DIR:-$root/firmware/build}
ssid=${EMU_NET_SSID:-emu-test}
pass=${EMU_NET_PASS:-emupass123}
exit_on=${EMU_NET_EXIT_ON:-'[NETCHECK] ALL PASS'}
seconds=${EMU_NET_TIMEOUT:-60}
sd=${EMU_NET_SD:-}
port=${EMU_NET_HTTP_PORT:-18765}
for arg in "$@"; do
  case $arg in
    --ssid=*) ssid=${arg#*=} ;;
    --password=*) pass=${arg#*=} ;;
    --exit-on=*) exit_on=${arg#*=} ;;
    --timeout=*) seconds=${arg#*=} ;;
    --sd=*) sd=${arg#*=} ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
[[ ${#pass} -ge 8 && ${#pass} -le 63 ]] || { echo 'WiFi password must be 8-63 chars' >&2; exit 2; }

if [[ ${EMU_NET_HEADLESS:-0} != 1 ]]; then
  unset VIRTUAL_ENV
  if [[ -d $HOME/.espressif/python_env/idf5.5_py3.12_env ]]; then
    export IDF_PYTHON_ENV_PATH=$HOME/.espressif/python_env/idf5.5_py3.12_env
  fi
  if [[ ! -s $build/lume.bin || ! -s $build/bootloader/bootloader.bin || ! -s $build/partition_table/partition-table.bin ]]; then
    if ! command -v idf.py >/dev/null; then
      source /opt/esp/esp-idf/export.sh >/dev/null
    fi
    (cd "$root/firmware" && idf.py build)
  fi
  python=${EMU_NET_PYTHON:-$HOME/.espressif/python_env/idf5.5_py3.12_env/bin/python}
  [[ -x $python ]] || python=$(command -v python3)
  (cd "$build" && "$python" -m esptool --chip esp32s3 merge_bin -o merged_flash.bin \
    --format raw --flash_mode dio --flash_freq 80m --flash_size 16MB \
    0x0 bootloader/bootloader.bin 0x8000 partition_table/partition-table.bin 0x10000 lume.bin)
fi
base=${EMU_NET_IMAGE:-$build/merged_flash.bin}
[[ -s $base ]] || { echo "merged flash missing: $base" >&2; exit 1; }
cp "$base" "$output/flash.bin"
python=${EMU_NET_PYTHON:-$HOME/.espressif/python_env/idf5.5_py3.12_env/bin/python}
[[ -x $python ]] || python=$(command -v python3)
prepare=("$python" "$root/tools/emu-net/prepare.py" "$output/flash.bin" "$app"
  --ssid "$ssid" --password "$pass" --url "http://192.168.4.1:$port/")
if [[ -n $sd ]]; then prepare+=(--sd); fi
"${prepare[@]}"
wc -c "$base" "$output/flash.bin" > "$output/merged_flash_size.txt"
emu=${EMU_NET_BIN:-$HOME/.local/bin/esp-emu}
[[ -x $emu ]] || { echo "esp-emu missing: $emu" >&2; exit 1; }
http_pid=
cleanup() { if [[ -n $http_pid ]]; then kill "$http_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT
"$python" -m http.server "$port" --bind 127.0.0.1 --directory "$root/tools/emu-net" \
  > "$output/http.log" 2>&1 &
http_pid=$!
emu_args=(--chip esp32s3 --firmware "$output/flash.bin" --wifi-ssid "$ssid"
  --wifi-password "$pass" --wifi-auth wpa2-psk --net user,net=192.168.4.0/24
  --timeout "${seconds}s" --exit-on "$exit_on")
if [[ -n $sd ]]; then
  if [[ $sd != *,* ]]; then sd=$sd,cs=41; fi
  emu_args+=(--sd "$sd")
fi
set +e
"$emu" "${emu_args[@]}" > "$output/serial.log" 2>&1
result=$?
set -e
grep -E 'got ip|\[NETCHECK\]' "$output/serial.log" || true
echo "serial: $output/serial.log"
if [[ $result == 0 ]] && ! grep -Fq "$exit_on" "$output/serial.log"; then
  echo "exit-on string absent (esp-emu timeout): $exit_on" >&2
  result=1
fi
exit "$result"
