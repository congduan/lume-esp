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

var display = Text({ parent: root,
  text: function () { return typed() || '_'; },
  style: { x: 24, y: 48, width: 432, height: 56, background: 'surface',
    borderRadius: 12, padding: 12, fontSize: 20, scroll: 'none' } });

var result = Text({ parent: root,
  text: function () { return submitted() ? 'Submitted: ' + submitted() : 'Type a word, press ENTER'; },
  style: { x: 24, y: 120, width: 432, height: 40, fontSize: 14,
    textAlign: 'center', scroll: 'none' } });

Text({ parent: root, text: 'ASCII QWERTY / BKSP deletes / ENTER submits',
  style: { x: 24, y: 172, width: 432, height: 32, fontSize: 12,
    textAlign: 'center', scroll: 'none' } });

var keyboard = lume.ui.shell.Keyboard({
  parent: root,
  onKey: function (ch) { typed.set(typed() + ch); },
  onBackspace: function () { typed.set(typed().slice(0, -1)); },
  onSubmit: function () { submitted.set(typed()); typed.set(''); },
});

/* Exposed for the host harness and the dev console; no device-side effect. */
globalThis.kb = keyboard;
globalThis.kbDisplay = display;
globalThis.kbResult = result;
