/**
 * Lume JS API types (M1 surface — grows in M2/M3).
 */

declare namespace lume.ui {
  interface Style {
    display?: 'flex';
    flexDirection?: 'row' | 'column';
    flexWrap?: 'nowrap' | 'wrap';
    justifyContent?: 'start' | 'end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
    alignItems?: 'start' | 'end' | 'center' | 'stretch';
    gap?: number;
    padding?: number;
    borderRadius?: number;
    borderWidth?: number;
    /** #RRGGBB or a key in lume.theme.get().colors. */
    borderColor?: string | (() => string);
    opacity?: number | (() => number); // 0..1
    x?: number | (() => number);
    y?: number | (() => number);
    transition?: { property: 'bg' | 'x' | 'y' | 'width' | 'height' | 'opacity'; durationMs: number; easing?: lume.anim.Easing };
    /** #RRGGBB or a key in lume.theme.get().colors; number keeps the M1 bg path. */
    background?: string | number | (() => string | number);
    width?: number | `${number}%` | (() => number);
    height?: number | `${number}%` | (() => number);
    /** Enables LVGL native scrolling on a View. */
    scroll?: 'vertical' | 'horizontal' | 'none';
    scrollbar?: 'off' | 'auto' | 'on';
  }

  /** Nodes are numeric ids returned by the embedded prelude. */
  type Node = number;
  interface ViewProps { style?: Style; parent?: Node; bg?: number | (() => number); w?: number; h?: number; align?: number; visible?: boolean; onPress?: () => void; onScroll?: (offsetPx: number) => void }
  interface ListProps<T> { style: Style & { height: number }; parent?: Node; items: T[] | (() => T[]); itemHeight: number; overscan?: number; renderItem(item: T, index: number): Node }
  interface TextProps extends ViewProps { text?: string | (() => string) }
  interface ButtonProps extends ViewProps { title?: string | (() => string); onPress?: () => void }
  /** RGB565 canvas, fixed size. All coordinates use canvas-local integer pixels. */
  interface CanvasContext {
    fillColor(color: `#${string}` | number): void;
    /** Clears to black. */
    clear(): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    line(x1: number, y1: number, x2: number, y2: number, color: `#${string}` | number, width?: number): void;
    /** Up to 240 [x,y] points. */
    polyline(points: [number, number][], color: `#${string}` | number, width?: number): void;
    circle(x: number, y: number, radius: number, color: `#${string}` | number): void;
    /** LVGL default 14px font; UTF-8 text at most 63 bytes. */
    text(x: number, y: number, str: string, color: `#${string}` | number, size?: 14): void;
  }
  interface CanvasProps {
    /** 1..480 pixels; all canvases share a 460,800-byte RGB565 budget. */
    width: number;
    height: number;
    /** Runs on creation and when a signal read inside changes. */
    onDraw(ctx: CanvasContext): void;
    parent?: Node;
    /** Layout styling; width and height must be specified above. */
    style?: Omit<Style, 'width' | 'height'>;
  }

  function View(props: ViewProps, children?: Node[]): Node;
  function List<T>(props: ListProps<T>): Node;
  function Text(props: TextProps): Node;
  function Button(props: ButtonProps): Node;
  function Canvas(props: CanvasProps): Node;
}

/** Embedded prelude globals used by the firmware fallback bundle. */
declare function View(props: lume.ui.ViewProps, children?: lume.ui.Node[]): lume.ui.Node;
declare function List<T>(props: lume.ui.ListProps<T>): lume.ui.Node;
declare function Text(props: lume.ui.TextProps): lume.ui.Node;
declare function Button(props: lume.ui.ButtonProps): lume.ui.Node;
declare function Canvas(props: lume.ui.CanvasProps): lume.ui.Node;
declare function signal<T>(initial: T): (() => T) & { set(value: T): void };

declare namespace lume.anim {
  type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  type Attr = 'x' | 'y' | 'width' | 'height' | 'opacity';
  /** Starts from the current LVGL value unless from is supplied. Returns a completion token. */
  function to(node: lume.ui.Node, options: {
    attr: Attr; from?: number; to: number; durationMs: number;
    easing?: Easing; onComplete?: () => void;
  }): number;
  /** Cancels one node/attribute animation; its onComplete will not run. */
  function cancel(node: lume.ui.Node, attr: Attr): void;
}

declare namespace lume.theme {
  interface Theme {
    /** Named colors used by Style.background and Style.borderColor. */
    colors?: Record<string, `#${string}`>;
    /** Default borderRadius for styles without an explicit borderRadius. */
    radius?: number;
    /** Stored for future text sizing; does not change text in r18. */
    fontScale?: number;
  }
  /** Replaces the whole theme and repaints styles that read its named colors. */
  function set(theme: Theme): void;
  /** Returns an isolated snapshot of the current theme. */
  function get(): Theme;
}

declare namespace lume.system {
  function log(msg: string): void;
  /** 20ms engine drain tick, with skipped missed periods; callbacks run on the engine task. */
  function setInterval(cb: () => void, ms: number): number;
  function setTimeout(cb: () => void, ms: number): number;
  function clearInterval(id: number): void;
  function clearTimeout(id: number): void;
}

declare namespace lume.app {
  /** Hooks run in registration order; each returns an idempotent unregister function. */
  function onStart(cb: () => void): () => void;
  function onPause(cb: () => void): () => void;
  function onResume(cb: () => void): () => void;
  /** Returning true handles BACK; false invokes the single-app default. */
  function onBack(cb: () => boolean): () => void;
}

/**
 * GPIO + PWM (LEDC) bindings (M2).
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_gpio.h: -1 invalid/out-of-range arg, -2 ESP-IDF driver failure,
 * -3 pin/channel state conflict). read() returns the 0/1 level on success.
 * Semantic failures are logged via ESP_LOGW and returned as the negative
 * status; they never abort. Calling with too few arguments throws a
 * TypeError (a QuickJS contract: JS_EXCEPTION always implies a pending
 * exception), and passing non-numeric arguments raises the JS_ToInt32
 * conversion error.
 * Channel range is 0..LEDC_TIMER_MAX-1 (0..3 on ESP32-S3); one timer per
 * channel, so each channel has an independent frequency. pwmFree releases
 * the pin + channel; re-attaching a bound channel resets the old pad.
 */
declare namespace lume.gpio {
  /** mode: 0=INPUT 1=OUTPUT 2=OUTPUT_OD; pull: 0=none 1=up 2=down.
    * rejected (-3) while the pin is PWM-attached; pwmFree first. */
  function setPin(pin: number, mode: number, pull: number): number;
  /** level: 0 or 1. */
  function write(pin: number, level: number): number;
  /** returns the pin level (0/1), or a negative error code. */
  function read(pin: number): number;
  function toggle(pin: number): number;
  /** dutyPct 0..100, 8-bit resolution, LEDC low-speed channel.
    * re-attaching a channel resets the pad it previously drove. */
  function pwmAttach(pin: number, freqHz: number, dutyPct: number, channel: number): number;
  /** change duty of an already-attached pin (usable inside signal/effect). */
  function pwmDuty(pin: number, dutyPct: number): number;
  /** release a PWM pin + channel (stops output, resets the pad). */
  function pwmFree(pin: number): number;
}

/**
 * ADC1 oneshot bindings (M2), ESP32-S3.
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_adc.h: -1 invalid/out-of-range arg, -2 ESP-IDF adc driver / calibration
 * failure, -3 pin not configured or calibration unavailable). readRaw() /
 * readMv() return a NON-NEGATIVE measurement on success (12-bit raw 0..4095 /
 * calibrated mV); negative values are the error codes. Semantic failures are
 * logged via ESP_LOGW and returned as the negative status; they never abort.
 * Calling with too few arguments throws a TypeError (a QuickJS contract:
 * JS_EXCEPTION always implies a pending exception), and passing non-numeric
 * arguments raises the JS_ToInt32 conversion error.
 *
 * Valid pins are the ADC1-samplable GPIOs 1..10 (hardcoded from the ESP32-S3
 * soc map); ADC2 GPIOs and board-specific dividers are out of scope. Each pin
 * is an independent channel, so there are no cross-pin conflicts: re-running
 * config() on a configured pin is last-wins (rebuilds the channel + calibration
 * for the new atten); free() releases the pin's calibration handle.
 *
 * atten (0..3) selects the input attenuation, which sets the measurable
 * voltage range: 0 = ADC_ATTEN_DB_0, 1 = ADC_ATTEN_DB_2_5, 2 = ADC_ATTEN_DB_6,
 * 3 = ADC_ATTEN_DB_12. Higher attenuation widens the range at the cost of
 * resolution/accuracy near the low end.
 *
 * readMv() returns curve-fitting-calibrated millivolts (ESP32-S3's only
 * compiled calibration scheme), NOT a raw-to-linear estimate. Accuracy is
 * bounded by the chip's eFuse calibration data and the chosen atten; absolute
 * voltage precision is deferred to board-level verification. If eFuse
 * calibration bits are absent, config() still succeeds and readRaw() works,
 * but readMv() returns -3 (calibration unavailable) rather than an
 * uncalibrated guess.
 */
declare namespace lume.adc {
  /** configure an ADC1 pin (GPIO 1..10) with atten 0..3; last-wins on repeat. */
  function config(pin: number, atten: number): number;
  /** raw 12-bit sample (0..4095), or a negative error code. */
  function readRaw(pin: number): number;
  /** calibrated mV, or a negative error code (-3 if calibration unavailable). */
  function readMv(pin: number): number;
  /** release the pin's calibration handle (keeps the shared ADC1 unit). */
  function free(pin: number): number;
}

/**
 * AXP2101 PMIC bindings (M2): battery telemetry, USB/charge status and power
 * off. NO-ARGUMENT API. Every function returns a status NUMBER: 0 = success,
 * negative = error code (lume_pmic_hw.h: -1 reserved / unused here, -2
 * ESP-IDF i2c_master driver failure, -3 PMIC not detected or required source
 * absent). Semantic failures are logged via ESP_LOGW and returned as the
 * negative status; they never abort. All functions take no arguments, so the
 * "too few arguments -> TypeError" path used by lume.gpio/lume.adc never
 * triggers here.
 *
 * The six telemetry/status reads return a NON-NEGATIVE measurement on success;
 * negative values are the error codes. powerOff() returns the status itself
 * (0 = the shutdown bit was written).
 *
 * NO BOARD: lume_pmic_hw_init() (run from the engine's binding registrar on
 * every fresh runtime) cannot confirm AXP2101 CHIP_ID 0x4A @ reg 0x03, so the
 * device handle stays NULL and ALL of battVoltageMv / battPercent /
 * vbusVoltageMv / usbConnected / chargingStatus / dieTempRaw / powerOff return
 * -3. Init failure is non-fatal (WARN only) and retries on the next runtime
 * reset; only a successful init latches. Battery voltage/percent additionally
 * return -3 when no battery is connected (STATUS1 bit3 clear); vbusVoltageMv
 * returns -3 when VBUS is not in (STATUS1 bit5 VBUS_GOOD clear or STATUS2
 * bit3 VINDPM set).
 *
 * Register facts are verified against XPowersLib (see lume_pmic_hw.c head
 * comment for the file:line table). Note the verified correction: VBUS in is
 * STATUS1 bit5 + !STATUS2 bit3, NOT STATUS1 bit4 (which is BATFET state).
 *
 * Charging parameters (voltages, currents, target voltage, fuel-gauge config)
 * are NEVER written — only measurement-channel enables at init and the single
 * shutdown bit in powerOff(). No reboot/restart binding this round: esp_restart
 * belongs to the lume.system namespace (next round).
 */
declare namespace lume.pmic {
  /** battery voltage in mV (H5L8 of REG 34h/35h, 1 mV/LSB), or -3 / negative error. */
  function battVoltageMv(): number;
  /** fuel-gauge battery percentage (raw REG A4h byte, 0..100 in practice), or -3 / negative error. */
  function battPercent(): number;
  /** VBUS voltage in mV (H6L8 of REG 38h/39h), or -3 when VBUS not in / negative error. */
  function vbusVoltageMv(): number;
  /** 1 = VBUS in, 0 = not in, negative = error. */
  function usbConnected(): number;
  /** charger status = STATUS2[2:0]: 0 tri_charge, 1 pre_charge, 2 CC,
    * 3 CV, 4 charge done, 5 not charging, 6..7 reserved; negative = error.
    * 0 is a VALID state here, not the OK status — test < 0 for errors. */
  function chargingStatus(): number;
  /** internal die-temperature ADC raw 14-bit sample (H6L8 of REG 3Ch/3Dh),
    * or negative error. Returned RAW: degC = 22 + (7274 - raw)/20 per
    * XPowersLib XPOWERS_AXP2101_CONVERSION (AXP2101Constants.h:241) — the
    * linear fit is left to JS because absolute accuracy needs board
    * verification (see docs/KNOWN-SIMPLIFICATIONS.md). */
  function dieTempRaw(): number;
  /** HIGH-RISK: set COMMON_CONFIG (10h) bit0 = soft PWROFF. The PMIC powers
    * off shortly after; returns 0 once written, or a negative error. This is
    * the ONLY register write and no charging parameters are touched. */
  function powerOff(): number;
}

/**
 * QMI8658 accelerometer + gyroscope bindings (M2 / r9). POLLED-ONLY this
 * round: lume_pins.h defines no IMU INT pin and the Waveshare official example
 * for this board polls getDataReady(), so there is no interrupt/event path.
 *
 * read() returns an OBJECT (unlike the int-status lume.gpio/adc/pmic APIs):
 *   {ax, ay, az}  m/s^2  (linear acceleration incl. gravity: ~9.81 on +Z at
 *                         rest; g -> m/s^2 with the standard 9.80665)
 *   {gx, gy, gz}  deg/s  (angular rate, the sensor's native dps unit)
 * The raw->physical scaling is done in NATIVE C (lume-imu), not JS. Config
 * mirrors the Waveshare SensorQMI8658 GetDataExample: accel +/-4g @ the
 * ACC_ODR_1000Hz setting (896.8 Hz effective in 6DOF mode),
 * gyro +/-64dps @ 896.8Hz, both LPFs on.
 *
 * On failure (no board, QMI8658 not detected, I2C error) read() returns null;
 * the native layer logs an ESP_LOGW. Semantic failures never abort/throw.
 * read() is deliberately NOT gated on the STATUS0 "new data since last read"
 * bits, so back-to-back reads always return the latest sample.
 *
 * NO BOARD: lume_imu_hw_init() (run from the engine's binding registrar on
 * every fresh runtime) cannot confirm WHO_AM_I, so read() returns null and
 * onMotion() returns -4. Init failure is non-fatal (WARN only) and retries on
 * the next runtime reset; only a successful init latches (r8 lume-pmic policy).
 *
 * onMotion(cb) is present for API-shape completeness but UNSUPPORTED this
 * round: it ALWAYS returns -4 (LUME_IMU_ERR_NO_INT) and never fires cb. The
 * schematic routes QMI_INT1 -> GPIO17 / QMI_INT2 -> GPIO21, but lume_pins.h
 * has no board-level IMU INT definition and the INT path cannot be validated
 * without a board -- deferred to the main controller's on-board round.
 * See docs/KNOWN-SIMPLIFICATIONS.md (r9 section).
 *
 * WHO_AM_I: the bundled Waveshare QMI8658A datasheet + SensorQMI8658 driver
 * say 0x05; the QMI8658C used on other Waveshare boards says 0xFD (the value
 * in the brief). init ACCEPTS BOTH (a single 0xFD check would fail on an
 * A-die board); the two variants share this register map. The detected ID is
 * logged at init.
 */
declare namespace lume.imu {
  interface ImuSample {
    /** linear acceleration in m/s^2 (gravity included). */
    ax: number; ay: number; az: number;
    /** angular rate in deg/s. */
    gx: number; gy: number; gz: number;
  }
  /** latest 6-axis sample, or null on no board / IMU not initialised / I2C error. */
  function read(): ImuSample | null;
  /** UNSUPPORTED (polled-only): always returns -4, cb is never called. */
  function onMotion(cb: () => void): number;
}

/**
 * NVS-backed persistent key-value store (M2 / r10).
 * Natives self-register under lume.storage.kv, so the prelude is unchanged.
 *
 * Status contract (returned as a NUMBER): 0 = success, negative = error code
 * (lume_kv.h: -1 invalid key/value, -2 ESP-IDF nvs_* driver failure, -3 NVS
 * not available). Semantic failures are logged via ESP_LOGW and returned as
 * the negative status; they never abort or throw. Calling with too few
 * arguments throws a TypeError (a QuickJS contract: JS_EXCEPTION always
 * implies a pending exception).
 *
 * DEGRADATION: nvs_flash_init() failure (e.g. the partition table has no NVS
 * partition) is NON-FATAL and makes ALL five APIs return -3. Init is
 * idempotent across hot-reload runtime resets and retries on failure. No
 * board is needed: NVS lives in main flash, so unlike lume.pmic/lume.imu
 * there is no "no board" path.
 *
 * Keys: NVS keys are at most 15 characters (NVS_KEY_NAME_MAX_SIZE 16 incl.
 * the NUL); empty or longer keys return -1. A single FIXED default namespace
 * "lume" is used (NVS namespace names are also <= 15 chars); namespace is not
 * JS-specifiable this round -- see docs/KNOWN-SIMPLIFICATIONS.md (r10).
 *
 * Values: one distinct NVS type per JS type so get() can reconstruct it --
 *   string      -> nvs_set_str  -> NVS_TYPE_STR
 *   number(int) -> nvs_set_i32  -> NVS_TYPE_I32   (JS_ToInt32 truncation/wrap)
 *   boolean     -> nvs_set_u8   -> NVS_TYPE_U8
 *   ArrayBuffer -> nvs_set_blob -> NVS_TYPE_BLOB  (small binary blob)
 * set() overwriting a key with a different type is handled by NVS. get()
 * recovers the type with nvs_find_key(). Strings/values are capped at < 4000
 * bytes (a string of 3999 B + NUL = the NVS single-page string limit; a blob
 * ~one NVS page in the 24 KB partition). Zero-length blobs, embedded-NUL
 * strings and unsupported value types (e.g. null/objects) return -1.
 * remove() of a missing key is idempotent (0); every write is nvs_commit()-ed
 * so values survive a power cycle (real power-cycle persistence is verified
 * by the main controller's on-board round, not here).
 *
 * NOTE the get()/keys() return unions: on failure they return a NEGATIVE
 * NUMBER (the error code) rather than a value/array. A stored number can
 * also be negative (-1/-2/-3 are legal stored values), so a negative result
 * from get() is AMBIGUOUS when NVS is available -- it is either a stored
 * number or an error code, and callers cannot reliably tell them apart.
 * Treat this as a known tradeoff (see docs/KNOWN-SIMPLIFICATIONS.md r10);
 * do NOT use `r < 0` as an error discriminator for get(). keys() has no
 * ambiguity: use `Array.isArray(r)` to detect failure there.
 */
declare namespace lume.storage.kv {
  /** string | number(int) | boolean | ArrayBuffer (small blob). */
  type KvValue = string | number | boolean | ArrayBuffer;
  /** persist a value; 0 on success, negative error code on failure. */
  function set(key: string, value: KvValue): number;
  /** the stored value (type preserved), null if the key is absent, or a
    * negative error code (as a number) on failure. */
  function get(key: string): KvValue | null | number;
  /** erase one key (idempotent: a missing key is 0); 0 or negative error. */
  function remove(key: string): number;
  /** all keys in the namespace; string[] (empty when none) or a negative
    * error code (as a number) on failure. */
  function keys(): string[] | number;
  /** erase ALL keys in the namespace; 0 or negative error. */
  function clear(): number;
}

/** LittleFS storage partition (M2 / r12). Paths are root-relative and may
 * start with '/'. Empty, '.', '..', repeated slash, trailing slash, embedded
 * NUL, and paths longer than 240 bytes are rejected with -1. No automatic
 * parent-directory creation; mkdir creates one level. Files are limited to
 * 64 KiB per read. write/append accept UTF-8 strings or ArrayBuffers.
 * read decodes UTF-8 text (invalid sequences use QuickJS replacement decoding);
 * readBinary returns exact bytes. Missing file on read/list is -2; remove of
 * a missing path is 0. All semantic failures return -1 invalid argument,
 * -2 filesystem/IO failure, or -3 unmounted. Too few arguments throw
 * TypeError; runtime allocation failures propagate a JS exception.
 * Mount failure is nonfatal; mounted() reports readiness. First mount may
 * format an unmountable partition, destroying any previous contents there.
 */
declare namespace lume.storage.Fs {
  function mounted(): boolean;
  function write(path: string, data: string | ArrayBuffer): number;
  function append(path: string, data: string | ArrayBuffer): number;
  function read(path: string): string | number;
  function readBinary(path: string): ArrayBuffer | number;
  function remove(path: string): number;
  function mkdir(path: string): number;
  function list(dirPath: string): string[] | number;
  function exists(path: string): boolean | number;
}

/**
 * WiFi station + basic HTTP client bindings (M2 / r11). Station-only,
 * WPA2-PSK only, http:// this round; smartconfig / softAP / BLE coexistence /
 * WPA3-Enterprise are NOT exposed. Natives self-register under lume.net and
 * lume.net.http (prelude unchanged).
 *
 * Status contract (returned as a NUMBER for the int-style APIs), mirrors
 * lume.storage.kv (r10) / lume.pmic: 0 = success, negative = error code
 * (lume_net.h: -1 invalid ssid/password/url/options, -2 ESP-IDF wifi/netif/
 * event/http_client driver failure, -3 WiFi not initialized / not connected
 * with an IP -- the UNIFORM degradation path). Semantic failures are logged
 * via ESP_LOGW and returned as the negative status; they never abort or throw.
 * Calling with too few arguments throws a TypeError (QuickJS contract).
 *
 * DEGRADATION: lume_net_init() runs from register_bindings() on every fresh
 * runtime; it is idempotent (a successful init latches for the process
 * lifetime, a failed init does NOT latch and retries on the next runtime reset)
 * and non-fatal. With a missing NVS partition / failed WiFi init, EVERY net
 * API (except init) returns -3 and never crashes. httpGet additionally needs
 * state GOT_IP (a usable IPv4), else -3.
 *
 * Credentials (password) are NEVER logged; the url is never logged either
 * (query strings may carry secrets). SSID <= 32 bytes, password 8..63 bytes
 * (WPA2-PSK), embedded NUL rejected with -1.
 *
 * THREAD NOTE (verified against ESP-IDF v5.5.5 source): WIFI_EVENT/IP_EVENT
 * handlers run on the dedicated "sys_evt" task (core 0), NOT the engine task
 * (core 1); the shared connection state is guarded by a portMUX spinlock
 * critical section. httpGet is SYNCHRONOUS and blocks the engine task for up
 * to timeoutMs (hot-reload/touch events stall meanwhile) -- an async/callback
 * version is a LATER round (docs/KNOWN-SIMPLIFICATIONS.md r11).
 *
 * Real WiFi association / HTTP transfer is NOT verified this round (compile +
 * size + ESP-IDF API self-check only); on-board acceptance is deferred to the
 * main controller's board round.
 */
declare namespace lume.net {
  /** status().state enum values, also exposed as lume.net.DISCONNECTED etc. */
  const DISCONNECTED: 0;
  const CONNECTING: 1;
  const CONNECTED: 2;   /* associated, DHCP pending (no IP yet) */
  const GOT_IP: 3;      /* has an IPv4 address, usable for httpGet */
  type NetState = 0 | 1 | 2 | 3;

  interface NetStatus {
    state: NetState;
    /** dotted IPv4 string, or null when the station has no IP yet. */
    ip: string | null;
  }

  type HttpBody = string | ArrayBuffer;
  interface HttpGetOptions {
    /** network timeout in ms; <=0 -> 5000, clamped to 30000. */
    timeoutMs?: number;
    /** 'text' (default) -> string body; 'arraybuffer' -> ArrayBuffer body. */
    /**
     * 'text' (default) or 'arraybuffer'. Unknown string values fall back to
     * text at runtime (string-compare based coercion).
     */
    responseType?: 'text' | 'arraybuffer';
  }
  interface HttpResponse {
    /** HTTP status code (200/404/...). A 404 is a SUCCESS result, not an error. */
    status: number;
    /** response body; string by default, ArrayBuffer when requested. Capped
      * at 32 KB; if longer, `truncated` is true and body is truncated. */
    body: HttpBody;
    /** Content-Length from the server (may be -1 / larger than body). */
    contentLength: number;
    /** true when the body exceeded the 32 KB native cap. */
    truncated: boolean;
  }

  /** One-time WiFi station setup (idempotent, latches on success). 0 or -2/-3. */
  function init(): number;
  /** Tear down the station and allow a later re-init. 0 or -3 when not up. */
  function deinit(): number;
  /** Non-blocking WPA2-PSK connect. Returns 0 immediately; poll status() for
    * DISCONNECTED -> CONNECTING -> CONNECTED -> GOT_IP. 0 or negative error. */
  function connect(ssid: string, password: string): number;
  /** Disconnect (non-blocking; the DISCONNECTED event clears state/IP). */
  function disconnect(): number;
  /** Snapshot state + IP; negative error code (number) when WiFi is not up. */
  function status(): NetStatus | number;
  /** Synchronous oneshot HTTP GET, primary shape. Object on a completed
    * transfer, negative error code (number) on failure / WiFi down. */
  function httpGet(url: string, options?: HttpGetOptions): HttpResponse | number;

  /** Reserved `http` sub-namespace: get() is the SAME native as httpGet(). */
  namespace http {
    function get(url: string, options?: HttpGetOptions): HttpResponse | number;
  }
}

/** M2 audio: signed little-endian 16-bit stereo PCM at 16 kHz, no WAV header.
 * play/record block the JS engine task; 64000 bytes = one second. */
declare namespace lume.audio {
  interface Options { sampleRate?: 16000; channels?: 2; bits?: 16; }
  /** 0 success; -1 bad argument, -2 driver/I2C/I2S failure, -3 board not ready. */
  function play(pcm: ArrayBuffer, opts?: Options): number;
  /** 0 < seconds <= 10; PSRAM buffer copied into the returned ArrayBuffer.
   * On failure returns -1 argument, -2 driver, -3 board, -4 allocation. */
  function record(seconds: number, opts?: Options): ArrayBuffer | number;
  /** 0..100; returns 0 or negative error code. */
  function setVolume(percent: number): number;
  /** Mutes future output; cannot interrupt an active synchronous play call. */
  function stop(): number;
}

declare namespace lume {
  const ui: typeof lume.ui;
  const system: typeof lume.system;
  const app: typeof lume.app;
  const theme: typeof lume.theme;
  const gpio: typeof lume.gpio;
  const adc: typeof lume.adc;
  const pmic: typeof lume.pmic;
  const imu: typeof lume.imu;
  const storage: typeof lume.storage;
  const net: typeof lume.net;
  const audio: typeof lume.audio;
  function start(root: lume.ui.Node): void;
}
