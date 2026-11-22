/**
 * r151: controls_demo -- shell form primitives (pure JS app).
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

lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435',
  surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 12 });

var sound = signal(true);
var bright = signal(50);
var charge = signal(0.2);

var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  background: 'primary', scroll: 'none' } });

Text({ parent: root, text: 'CONTROLS DEMO',
  style: { x: 24, y: 24, width: 432, height: 40, fontSize: 26,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: root, text: 'shell Switch / Slider / Progress',
  style: { x: 24, y: 66, width: 432, height: 24, fontSize: 13,
    color: '#9EB3C6', scroll: 'none' } });

/* Switch: sound-effects on/off. The signal is the single source of truth. */
var soundSwitch = lume.ui.shell.Switch({ parent: root, x: 24, y: 120,
  value: sound, trackWidth: 72, height: 48, label: 'Sound FX',
  onChange: function (v) { sound.set(v); } });
Text({ parent: root, text: function () { return sound() ? 'ON' : 'OFF'; },
  style: { x: 320, y: 120, width: 136, height: 48, fontSize: 18,
    color: '#40D8B0', textAlign: 'right', scroll: 'none' } });

/* Slider: brightness 0..100, step 5. Drag maps dx back into the range. */
Text({ parent: root, text: function () { return 'Brightness ' + bright(); },
  style: { x: 24, y: 200, width: 432, height: 28, fontSize: 16,
    color: '#F2F7FB', scroll: 'none' } });
var brightSlider = lume.ui.shell.Slider({ parent: root, x: 24, y: 236,
  width: 432, height: 40, min: 0, max: 100, step: 5, value: bright,
  onChange: function (v) { bright.set(v); } });

/* Progress: simulated charging animation, 0..1 clamped, label above bar. */
Text({ parent: root, text: function () { return 'Battery ' + Math.round(charge() * 100) + '%'; },
  style: { x: 24, y: 316, width: 432, height: 28, fontSize: 16,
    color: '#F2F7FB', scroll: 'none' } });
var batteryBar = lume.ui.shell.Progress({ parent: root, x: 24, y: 376,
  width: 432, height: 18, value: charge, label: 'CHARGING' });
Text({ parent: root, text: 'Drag the bar to change brightness | tap the switch',
  style: { x: 24, y: 432, width: 432, height: 28, fontSize: 12,
    color: '#9EB3C6', scroll: 'none' } });

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
