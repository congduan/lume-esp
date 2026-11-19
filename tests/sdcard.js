// Host harness for the r125 TF-card storage slice. Standalone CommonJS:
//   node tests/sdcard.js
// Two layers, mirroring tests/ble.js: (1) static wiring checks so the C
// component / QuickJS natives / board profile / .d.ts cannot drift apart
// on a host without ESP-IDF; (2) error-convention checks against the Fs
// precedent. There is NO card on the host: nothing here proves the SPI
// mount works -- board acceptance is deferred.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// --- 1. wiring -----------------------------------------------------------
const header = read('firmware/components/lume-storage/include/lume_sd.h');
for (const macro of ['LUME_SD_OK', 'LUME_SD_ERR_ARG', 'LUME_SD_ERR_DRIVER',
                     'LUME_SD_ERR_STATE', 'LUME_SD_ERR_NO_CD',
                     'LUME_SD_PATH_MAX', 'LUME_SD_READ_MAX']) {
  assert.match(header, new RegExp('#define\\s+' + macro + '\\b'),
               'lume_sd.h is missing ' + macro);
}
assert.match(header, /LUME_SD_PATH_MAX\s+240/);
assert.match(header, /LUME_SD_READ_MAX\s+\(64 \* 1024\)/,
             'Sd read cap must stay 64 KiB (Fs parity)');
for (const fn of ['lume_sd_init', 'lume_sd_mounted', 'lume_sd_has_cd',
                  'lume_sd_detect', 'lume_sd_write', 'lume_sd_read',
                  'lume_sd_remove', 'lume_sd_mkdir', 'lume_sd_exists',
                  'lume_sd_list', 'lume_sd_statvfs']) {
  assert.match(header, new RegExp('(int|bool) ' + fn + '\\('), 'missing ' + fn);
}

const sd = read('firmware/components/lume-storage/lume_sd.c');
// Mount policy: never format, same speed-class default as the Waveshare
// demo precedent, SPI3 + board profile pins only.
assert.match(sd, /format_if_mount_failed\s*=\s*false/,
             'Sd must NEVER auto-format the card');
assert.match(sd, /host\.slot = SPI3_HOST/);
assert.match(sd, /#include "lume_pins\.h"/);
assert.match(sd, /esp_vfs_fat_sdspi_mount/);
assert.match(sd, /#define SD_BASE "\/lume_sd"/);
// No-slot boards compile out: the mount path is gated on all four pins.
assert.match(sd, /#if defined\(LUME_PIN_SD_MOSI\)[\s\S]*#define LUME_SD_HAS_SLOT/);

const cmake = read('firmware/components/lume-storage/CMakeLists.txt');
assert.match(cmake, /lume_sd\.c/);
assert.match(cmake, /fatfs sdmmc/);
assert.match(cmake, /esp_driver_sdspi/);
assert.match(cmake, /lume-board/, 'pins shim comes from lume-board');

// Board profile: the 2.16 slot pins are sourced (Waveshare doc/schematic);
// the profile without a slot must not define them.
const p216 = read('firmware/boards/waveshare_esp32_s3_touch_amoled_2_16/lume_board_profile.h');
assert.match(p216, /#define LUME_PIN_SD_MOSI\s+1/);
assert.match(p216, /#define LUME_PIN_SD_CLK\s+2/);
assert.match(p216, /#define LUME_PIN_SD_MISO\s+3/);
assert.match(p216, /#define LUME_PIN_SD_CS\s+41/);
assert.ok(!/LUME_PIN_SD_CD/.test(p216),
          '2.16 profile defines no CD pin; detect() must return -4');
const p175 = read('firmware/boards/waveshare_esp32_s3_touch_amoled_1_75c/lume_board_profile.h');
assert.ok(!/define LUME_PIN_SD_/.test(p175),
          '1.75c has no TF slot: LUME_PIN_SD_* must stay undefined');

// Engine wiring: natives registered under lume.storage.Sd, lazy mount
// (no lume_sd_init() before register_bindings).
const engine = read('firmware/components/lume-engine/lume_engine.c');
assert.ok(engine.includes('#include "lume_sd.h"'));
for (const fn of ['mounted', 'detect', 'statvfs', 'write', 'append', 'read',
                  'readBinary', 'remove', 'mkdir', 'exists', 'list']) {
  assert.match(engine, new RegExp('JS_SetPropertyStr\\(ctx, sd, "' + fn + '"'),
               'lume.storage.Sd.' + fn + ' is not registered');
}
assert.ok(!/register_bindings[\s\S]{0,20000}?lume_sd_init\(\);/.test(
  engine.slice(engine.indexOf('static void register_bindings'))),
  'SD mount must stay lazy (no lume_sd_init() in register_bindings)');
const engineCmake = read('firmware/components/lume-engine/CMakeLists.txt');
assert.match(engineCmake, /lume-storage/,
             'engine links lume-storage (Sd natives live there)');

// sdkconfig: LFN + UTF-8 API encoding are required for real card names.
const defaults = read('firmware/sdkconfig.defaults');
assert.ok(defaults.includes('CONFIG_FATFS_LFN_STACK=y'),
          'sdkconfig.defaults is missing CONFIG_FATFS_LFN_STACK=y');
assert.ok(defaults.includes('CONFIG_FATFS_API_ENCODING_UTF_8=y'),
          'sdkconfig.defaults is missing CONFIG_FATFS_API_ENCODING_UTF_8=y');

// .d.ts contract.
const dts = read('runtime/types/lume.d.ts');
assert.match(dts, /declare namespace lume\.storage\.Sd \{/);
const sdBlock = dts.slice(dts.indexOf('declare namespace lume.storage.Sd {'))
  .split('\n}\n')[0];
for (const fn of ['mounted', 'detect', 'statvfs', 'write', 'append', 'read',
                  'readBinary', 'remove', 'mkdir', 'list', 'exists']) {
  assert.match(sdBlock, new RegExp('function\\s+' + fn + '\\('),
               'lume.d.ts is missing lume.storage.Sd.' + fn);
}
assert.match(dts, /NEVER formats the card/);

// --- 2. no-auto-format vs Fs precedent, error-code parity ----------------
const fsHeader = read('firmware/components/lume-storage/include/lume_fs.h');
const sdCodes = ['ERR_ARG', 'ERR_DRIVER', 'ERR_STATE'].map(k =>
  header.match(new RegExp('#define LUME_SD_' + k + '\\s+\\((-\\d+)\\)'))[1]);
const fsCodes = ['ERR_ARG', 'ERR_DRIVER', 'ERR_STATE'].map(k =>
  fsHeader.match(new RegExp('#define LUME_FS_' + k + '\\s+\\((-\\d+)\\)'))[1]);
assert.deepEqual(sdCodes, fsCodes,
                 'Sd error codes must equal the Fs convention (-1/-2/-3)');
assert.ok(header.includes('LUME_SD_ERR_NO_CD (-4)'), 'CD-missing is -4');

// --- 3. prelude untouched -------------------------------------------------
const scripts = read('firmware/components/lume-engine/lume_scripts.c');
assert.ok(!scripts.includes('storage.Sd') && !scripts.includes('storage["Sd"]'),
          'prelude must stay Sd-free (natives self-register)');

console.log('PASS sdcard: wiring (component/engine/boards/sdkconfig/d.ts)');
console.log('PASS sdcard: never-format + lazy-mount policy locked');
console.log('PASS sdcard: error-code parity with lume.storage.Fs');
console.log('PASS sdcard: prelude unchanged (natives self-register)');
console.log('ALL SD HARNESS CASES PASSED');
