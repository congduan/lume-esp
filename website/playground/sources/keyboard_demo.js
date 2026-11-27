/**
 * r148: keyboard_demo -- shell Keyboard soft-keyboard example (pure JS app).
 *
 * A single-line input display plus the QWERTY Keyboard shell component.
 * Letter / SPACE taps append ASCII characters, BKSP drops the last one and
 * ENTER freezes the current line into a "Submitted:" result line. There is no
 * native input method and no firmware or prelude change: shell.js is bundled
 * by the CLI. All visible copy is ASCII (r64); real touch feel stays deferred
 * to board bring-up.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435',
  surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0',
  danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing: 12 });

var typed = signal('');
var submitted = signal('');

var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  background: 'primary', scroll: 'none' } });

/* r202: input display, result and hint moved into [84,396]. The panel is a
   View behind the Text -- Text style.background is consumed as color by the
   playground renderer (dark-on-dark), so it must not be used here. */
View({ parent: root, style: { x: 84, y: 80, width: 312, height: 56,
  background: '#1F2C3D', borderRadius: 8, scroll: 'none' } });
var display = Text({ parent: root,
  text: function () { return typed() || '_'; },
  style: { x: 92, y: 88, width: 296, height: 40, padding: 8,
    borderRadius: 0, fontSize: 20, color: '#F2F7FB', scroll: 'none' } });

var result = Text({ parent: root,
  text: function () { return submitted() ? 'Submitted: ' + submitted() : 'Type a word, press ENTER'; },
  style: { x: 84, y: 144, width: 312, height: 40, fontSize: 14,
    color: '#9EB3C6', textAlign: 'center', borderRadius: 0, scroll: 'none' } });

Text({ parent: root, text: 'ASCII QWERTY / BKSP deletes / ENTER submits',
  style: { x: 84, y: 188, width: 312, height: 32, fontSize: 12,
    color: '#9EB3C6', textAlign: 'center', borderRadius: 0, scroll: 'none' } });

/* r217: 466 px wide centered (x=7..473, inner 458), 44x48 keys with 2 px gap
 * (46x50 pitch) and controlKeyRatio 1.5 (BKSP/ENTER 66x48, SPACE 136x48).
 * Monotonic QWERTY taper keeps all 29 keys inside R<=233 (worstR 231.2). */
var keyboard = lume.ui.shell.Keyboard({
  parent: root, width: 466, keySize: 44, gap: 2, x: 7, y: 220, controlKeyRatio: 1.5,
  onKey: function (ch) { typed.set(typed() + ch); },
  onBackspace: function () { typed.set(typed().slice(0, -1)); },
  onSubmit: function () { submitted.set(typed()); typed.set(''); },
});

/* Exposed for the host harness and the dev console; no device-side effect. */
globalThis.kb = keyboard;
globalThis.kbDisplay = display;
globalThis.kbResult = result;
