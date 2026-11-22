/*
 * r160: launcher_grid -- first real consumer of shell.Launcher.
 * r162: first consumer of shell.Launcher's onEditingChange observable edit
 * state; the status line reads EDIT while editing and restores the prior
 * action on exit (host-only evidence, no real touch).
 * Pure app layer: no firmware / runtime / tools/lume / .d.ts change by r160;
 * r162 adds the callback prop to runtime/ (separate runtime knife).
 *
 * SHELL CONSUMPTION (the last zero-consumer component):
 *   - shell.Launcher renders a 3x3 icon grid with an explicit curated app
 *     list, a custom theme, an onLaunch host callback and an onBack handler.
 *   - indicator:false disables EdgeNavigation's two 24x64 edge canvases, so
 *     every Canvas in the tree is one 48x48 icon owned by Launcher.renderItem.
 *     Budget lock: 9 icons x 2304 px = 20736 px <= 230400 px (480x480 frame).
 *
 * HOST SEMANTICS (no real app switch, no app-store dependency):
 *   APPS is an explicit literal array; the component's app-store default is
 *   deliberately NOT used: the host runner cannot stub the app store reliably
 *   and the boot-pinned device path has different semantics. onLaunch records
 *   the target id and updates the status line ("launch <id>"); it does NOT
 *   switch apps -- real runtime switching stays a firmware-round topic.
 *   onBack is the non-editing fallback; Launcher consumes editing-mode back
 *   itself before calling it, so the host only sees the plain back case.
 *   r162: onEditingChange mirrors Launcher's internal editing signal into the
 *   app's `editing` signal; the status Text shows EDIT while editing and
 *   restores lastAction() on exit. No effect subscription / no first-frame
 *   false report -- the callback is the single source of edit-state truth.
 *
 * Layout is a full-bleed 480x480 square (not round: no SafeArea needed).
 * Text uses only the 14/20/32 bridge faces and all UI copy is ASCII (r64:
 * the firmware font has no symbol glyphs). Conservative global script:
 * var / function only, one shell.js import.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg: '#050914', primary: '#1B2B4B', surface: '#101C33',
  surfaceAlt: '#223862', text: '#E8F0FB', textDim: '#8FA6C8', accent: '#5CE1E6' },
  radius: 12, spacing: 12 });

/* Nine curated apps. Single-letter ASCII glyphs (r64), one Canvas each. */
var APPS = [
  { id: 'counter',        label: 'COUNTER',  color: '#2E6FB7', glyph: 'C' },
  { id: 'timer_kit',      label: 'TIMER',    color: '#B7542E', glyph: 'T' },
  { id: 'control_center', label: 'CONTROL',  color: '#2E8B6B', glyph: 'Q' },
  { id: 'keyboard_demo',  label: 'KEYBOARD', color: '#7A4FB5', glyph: 'K' },
  { id: 'wordle',         label: 'WORDLE',   color: '#166B3E', glyph: 'W' },
  { id: 'weather',        label: 'WEATHER',  color: '#2E86A5', glyph: 'E' },
  { id: 'music_player',   label: 'MUSIC',    color: '#A5447A', glyph: 'M' },
  { id: 'clock',          label: 'CLOCK',    color: '#8A6A12', glyph: 'L' },
  { id: 'settings',       label: 'SETTINGS', color: '#4A5568', glyph: 'S' },
];

var ICON_PX = 48;
var ICON_AREA = ICON_PX * ICON_PX;          /* 2304 px per icon */
var FRAME_AREA = 480 * 480;                 /* 230400 px full frame */
var lastAction = signal('READY');
var editing = signal(false);   /* driven by Launcher.onEditingChange (r162) */

var root = lume.ui.shell.Launcher({
  title: 'GRID',
  apps: APPS,
  columns: 3,
  indicator: false,
  right: '9 APPS',
  onLaunch: function (id) { lastAction.set('launch ' + id); },
  onEditingChange: function (v) { editing.set(v); },
  onBack: function () { lastAction.set('BACK'); return true; },
});

/* Status hint sits in the 24px strip below the 288px list (y 456..480).
 * r162: EDIT while editing, otherwise the last launch/back action. */
var statusText = Text({ parent: root, text: function () { return editing() ? 'EDIT' : lastAction(); },
  style: { x: 24, y: 458, width: 432, height: 18, fontSize: 14,
    color: '#8FA6C8', scroll: 'none' } });

/* Harness / simulator introspection surface (same convention as timer_kit). */
globalThis.lgApi = {
  root: root,
  status: lastAction,
  statusNode: statusText,
  editing: editing,
  appList: APPS,
  ICON_PX: ICON_PX,
  ICON_AREA: ICON_AREA,
  FRAME_AREA: FRAME_AREA,
  launch: function (id) { lastAction.set('launch ' + id); },
};
lume.log('LAUNCHER GRID READY');
