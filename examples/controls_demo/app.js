/**
 * r151: controls_demo -- shell form primitives (pure JS app).
 * r200: aligned to docs/DESIGN-TOKENS.md for round 480x480 screens: wrapped in
 * shell.SafeArea (all controls inside global [80, 400] x [78, 398]), removed
 * redundant ON/OFF text beside Switch, and applied DESIGN-TOKENS palette.
 *
 * One screen showing the three new shell controls wired to app signals:
 *   - Switch : sound-effects toggle (onChange writes back to the signal)
 *   - Slider : brightness 0..100 in steps of 5 (drag to change)
 *   - Progress: battery charge level driven by a simulated charge timer
 * Every value lives in a signal; the components are controlled and hold no
 * internal state. shell.js is bundled by the CLI; there is no firmware or
 * prelude change. All visible copy is ASCII (r64). Touch feel is deferred to
 * board bring-up.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#0D1420', primary:'#0D1420', surface:'#16202E',
  surfaceAlt:'#1F2C3D', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 8 });

var sound = signal(true);
var bright = signal(50);
var charge = signal(0.2);

var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: 'primary', scroll: 'none' } });
var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480, children: [] });

Text({ parent: safe, text: 'CONTROLS DEMO',
  style: { x: 10, y: 8, width: 320, height: 28, fontSize: 20,
    textAlign: 'center', color: '#F2F7FB', scroll: 'none' } });
Text({ parent: safe, text: 'Switch / Slider / Progress',
  style: { x: 10, y: 36, width: 320, height: 18, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });

/* Switch: sound-effects on/off. Track color + knob position expresses state
 * directly (no redundant ON/OFF text). */
var soundSwitch = lume.ui.shell.Switch({ parent: safe, x: 10, y: 66,
  value: sound, trackWidth: 68, height: 48, label: 'Sound FX',
  onChange: function (v) { sound.set(v); } });

/* Slider: brightness 0..100, step 5. Drag maps dx back into the range.
 * r203: opt into the round thumb (36px diameter); existing apps keep the
 * component's byte-identical default square-thumb rendering. */
Text({ parent: safe, text: function () { return 'Brightness ' + bright(); },
  style: { x: 10, y: 128, width: 320, height: 22, fontSize: 16, borderRadius: 0,
    color: '#F2F7FB', scroll: 'none' } });
var brightSlider = lume.ui.shell.Slider({ parent: safe, x: 10, y: 154,
  width: 320, height: 48, min: 0, max: 100, step: 5, value: bright,
  roundThumb: true,
  onChange: function (v) { bright.set(v); } });

/* Progress: simulated charging animation, 0..1 clamped, label above bar. */
Text({ parent: safe, text: function () { return 'Battery ' + Math.round(charge() * 100) + '%'; },
  style: { x: 10, y: 218, width: 320, height: 22, fontSize: 16, borderRadius: 0,
    color: '#F2F7FB', scroll: 'none' } });
var batteryBar = lume.ui.shell.Progress({ parent: safe, x: 10, y: 266,
  width: 320, height: 12, value: charge, label: 'CHARGING' });
Text({ parent: safe, text: 'DRAG SLIDER | TAP SWITCH',
  style: { x: 10, y: 298, width: 320, height: 20, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });

/* Simulated charge: 2% per tick, wrap to 0 at full. Cleared on pause. */
var chargeTimer = lume.system.setInterval(function () {
  var next = charge() + 0.02;
  charge.set(next > 1 ? 0 : next);
}, 200);
lume.app.onPause(function () { lume.system.clearInterval(chargeTimer); });

globalThis.controlsDemo = {
  switch: soundSwitch, slider: brightSlider, progress: batteryBar,
  sound: sound, bright: bright, charge: charge
};
lume.log('CONTROLS DEMO READY');
