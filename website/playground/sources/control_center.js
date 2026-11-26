/*
 * r159: control_center -- phone-style quick settings on the r141 shell layout
 * components. Pure app layer: no firmware / runtime / tools/lume / .d.ts change.
 * r200: aligned to docs/DESIGN-TOKENS.md round-screen safe area ([75, 405]),
 * removed redundant STATE ON/OFF copy, moved RESET into a dedicated weakened
 * danger row below the cards, and unified TAP TO RAISE at the card footer.
 *
 * SHELL CONSUMPTION (first real consumer of the three zero-consumer components):
 *   - shell.SafeArea: round-screen safe container; size 480 -> 339x339 safe square.
 *   - shell.Card: four setting cards (WiFi / Bluetooth / Volume / Brightness).
 *   - shell.IconButton: WiFi toggle, Bluetooth toggle and the bottom RESET key.
 * Card / IconButton / SafeArea are View / Button wrappers: this app allocates
 * ZERO Canvas nodes. Slider is deliberately NOT used (it is timer_kit's r157
 * consumption point); volume / brightness cycle by tapping their cards.
 *
 * STATE AND PERSISTENCE:
 *   All four values are signals. Every change is written through
 *   lume.storage.kv under a <=15-char key; startup reads back with strict
 *   validation. Reads and writes are ALL try/catch guarded: when NVS is
 *   unavailable the app degrades to in-memory defaults (volatile only).
 *     cc.wifi : 0 / 1     simulated WiFi switch, default 0
 *     cc.ble  : 0 / 1     simulated Bluetooth switch, default 0
 *     cc.vol  : 0..10     volume step, default 3
 *     cc.brt  : 1..5      brightness step, default 3
 *   WiFi / Bluetooth are LOCAL SIMULATION ONLY -- lume.net / lume.ble are never
 *   called. There is no real radio control and no real backlight coupling;
 *   both stay deferred to board bring-up.
 *
 * Layout is native View / Text / Button at 480x480. Text uses only the 14/20/32
 * bridge faces and all UI copy is ASCII (r64: the firmware font has no symbol
 * glyphs). Static tree is 21 nodes, far below LUME_MAX_NODES=128.
 * Conservative global script: var / function only, one shell.js import.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#0D1420', primary:'#0D1420', surface:'#16202E',
  surfaceAlt:'#1F2C3D', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var KV_WIFI = 'cc.wifi';   /* 7 chars */
var KV_BLE = 'cc.ble';     /* 6 chars */
var KV_VOL = 'cc.vol';     /* 7 chars */
var KV_BRT = 'cc.brt';     /* 7 chars */
var DEF_WIFI = false, DEF_BLE = false, DEF_VOL = 3, DEF_BRT = 3;

var wifi = signal(DEF_WIFI);           /* simulated radio state */
var ble = signal(DEF_BLE);             /* simulated radio state */
var vol = signal(DEF_VOL);             /* 0..10 */
var brt = signal(DEF_BRT);             /* 1..5 */

/* ---- KV: try/catch everywhere, accept only legal values ---------------- */
function kvLoadFlag(key, fallback) {
  try {
    var v = lume.storage.kv.get(key);
    return (v === 0 || v === 1) ? (v === 1) : fallback;
  } catch (e) { return fallback; }
}
function kvLoadStep(key, lo, hi, fallback) {
  try {
    var v = lume.storage.kv.get(key);
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v &&
      v >= lo && v <= hi) ? v : fallback;
  } catch (e) { return fallback; }
}
function kvSave(key, value) {
  try { lume.storage.kv.set(key, value); } catch (e) { /* NVS unavailable: volatile only */ }
  return value;
}

wifi.set(kvLoadFlag(KV_WIFI, DEF_WIFI));
ble.set(kvLoadFlag(KV_BLE, DEF_BLE));
vol.set(kvLoadStep(KV_VOL, 0, 10, DEF_VOL));
brt.set(kvLoadStep(KV_BRT, 1, 5, DEF_BRT));

/* ---- state transitions: every one persists ----------------------------- */
function setWifi(v) { wifi.set(!!v); kvSave(KV_WIFI, wifi() ? 1 : 0); }
function setBle(v) { ble.set(!!v); kvSave(KV_BLE, ble() ? 1 : 0); }
function toggleWifi() { setWifi(!wifi()); }
function toggleBle() { setBle(!ble()); }
function cycleVol() {
  var v = vol() + 1;
  if (v > 10) v = 0;
  vol.set(kvSave(KV_VOL, v));
}
function cycleBrt() {
  var v = brt() + 1;
  if (v > 5) v = 1;
  brt.set(kvSave(KV_BRT, v));
}
function resetAll() {
  setWifi(DEF_WIFI);
  setBle(DEF_BLE);
  vol.set(kvSave(KV_VOL, DEF_VOL));
  brt.set(kvSave(KV_BRT, DEF_BRT));
}

function accent() { return lume.theme.get().colors.accent || '#40D8B0'; }
function surfaceAlt() { return lume.theme.get().colors.surfaceAlt || '#1F2C3D'; }
function flagLabel(v) { return v ? 'ON' : 'OFF'; }
function flagStatus(prefix, v) { return prefix + ' ' + (v ? 'ON' : 'OFF'); }

/* ---- UI: 339x339 safe square (content inset to global [80, 400]), 21 nodes ---- */
var root = lume.ui.shell.SafeArea({ shape: 'round', size: 480, children: [] });

Text({ parent: root, text: 'CONTROL CENTER',
  style: { x: 10, y: 8, width: 320, height: 28, fontSize: 20, borderRadius: 0,
    textAlign: 'center', color: '#F2F7FB', scroll: 'none' } });

/* Four cards sit on an 8 px grid inside local [10..330] (global [80..400]).
 * WiFi / Bluetooth toggles express state directly via button color + ON/OFF
 * label (no redundant STATE line). RESET occupies a dedicated centered row
 * below the cards with a weakened danger outline. */
var CARD_W = 156, TOP_H = 104, BOT_H = 108;

var wifiBtn = lume.ui.shell.IconButton({ title: function () { return flagLabel(wifi()); }, size: 56,
  style: { fontSize: 14,
    background: function () { return wifi() ? '#117B69' : surfaceAlt(); },
    borderWidth: 2,
    borderColor: function () { return wifi() ? accent() : '#5C7794'; } },
  onPress: function () { toggleWifi(); } });
var bleBtn = lume.ui.shell.IconButton({ title: function () { return flagLabel(ble()); }, size: 56,
  style: { fontSize: 14,
    background: function () { return ble() ? '#117B69' : surfaceAlt(); },
    borderWidth: 2,
    borderColor: function () { return ble() ? accent() : '#5C7794'; } },
  onPress: function () { toggleBle(); } });

var wifiCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { toggleWifi(); },
  style: { x: 10, y: 44, width: CARD_W, height: TOP_H, padding: 8, gap: 8,
    alignItems: 'center', justifyContent: 'space-between' },
  children: [
    Text({ text: 'WIFI', style: { height: 18, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
    wifiBtn,
  ] });

var bleCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { toggleBle(); },
  style: { x: 174, y: 44, width: CARD_W, height: TOP_H, padding: 8, gap: 8,
    alignItems: 'center', justifyContent: 'space-between' },
  children: [
    Text({ text: 'BLUETOOTH', style: { height: 18, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
    bleBtn,
  ] });

var volCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { cycleVol(); },
  style: { x: 10, y: 156, width: CARD_W, height: BOT_H, padding: 8, gap: 4,
    justifyContent: 'space-between' },
  children: [
    Text({ text: 'VOLUME', style: { height: 16, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
    Text({ text: function () { return 'VOL ' + vol() + '/10'; },
      style: { height: 24, fontSize: 20, borderRadius: 0, color: '#F2F7FB', scroll: 'none' } }),
    View({ style: { height: 8, width: 140, padding: 0, gap: 0,
      borderRadius: 4, background: '#1F2C3D', scroll: 'none' } }, [
      View({ style: { height: 8, width: function () { return Math.round(vol() * 14); },
        padding: 0, gap: 0, borderRadius: 4, background: accent(), scroll: 'none' } }),
    ]),
    Text({ text: 'TAP TO RAISE', style: { height: 16, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
  ] });

var brtCard = lume.ui.shell.Card({ parent: root,
  onPress: function () { cycleBrt(); },
  style: { x: 174, y: 156, width: CARD_W, height: BOT_H, padding: 8, gap: 4,
    justifyContent: 'space-between' },
  children: [
    Text({ text: 'BRIGHTNESS', style: { height: 16, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
    Text({ text: function () { return 'BRT ' + brt() + '/5'; },
      style: { height: 24, fontSize: 20, borderRadius: 0, color: '#F2F7FB', scroll: 'none' } }),
    View({ style: { height: 8, width: 140, padding: 0, gap: 0,
      borderRadius: 4, background: '#1F2C3D', scroll: 'none' } }, [
      View({ style: { height: 8, width: function () { return brt() * 28; },
        padding: 0, gap: 0, borderRadius: 4, background: accent(), scroll: 'none' } }),
    ]),
    Text({ text: 'TAP TO RAISE', style: { height: 16, fontSize: 14, borderRadius: 0, color: '#9EB3C6', scroll: 'none' } }),
  ] });

var resetBtn = lume.ui.shell.IconButton({ parent: root, title: 'RESET', size: 48,
  style: { x: 110, y: 280, width: 120, height: 48, borderRadius: 999,
    fontSize: 14, background: '#16202E', borderWidth: 2, borderColor: '#FF6B79' },
  onPress: function () { resetAll(); } });

/* Harness / simulator introspection surface (same convention as timer_kit). */
globalThis.ccWifi = wifi;
globalThis.ccBle = ble;
globalThis.ccVol = vol;
globalThis.ccBrt = brt;
globalThis.ccRoot = root;
globalThis.ccWifiCard = wifiCard;
globalThis.ccBleCard = bleCard;
globalThis.ccVolCard = volCard;
globalThis.ccBrtCard = brtCard;
globalThis.ccWifiBtn = wifiBtn;
globalThis.ccBleBtn = bleBtn;
globalThis.ccResetBtn = resetBtn;
globalThis.ccApi = {
  wifi: wifi, ble: ble, vol: vol, brt: brt,
  root: root, wifiBtn: wifiBtn, bleBtn: bleBtn, resetBtn: resetBtn,
  wifiCard: wifiCard, bleCard: bleCard,
  volCard: volCard, brtCard: brtCard, resetBtn: resetBtn,
  toggleWifi: toggleWifi, toggleBle: toggleBle,
  cycleVol: cycleVol, cycleBrt: cycleBrt, resetAll: resetAll,
  setWifi: setWifi, setBle: setBle,
  kvLoadFlag: kvLoadFlag, kvLoadStep: kvLoadStep, kvSave: kvSave,
  flagLabel: flagLabel, flagStatus: flagStatus,
  KV_WIFI: KV_WIFI, KV_BLE: KV_BLE, KV_VOL: KV_VOL, KV_BRT: KV_BRT,
  DEF_WIFI: DEF_WIFI, DEF_BLE: DEF_BLE, DEF_VOL: DEF_VOL, DEF_BRT: DEF_BRT,
  NODE_BUDGET: 128, STATIC_NODES: 21
};
lume.log('CONTROL CENTER READY');
