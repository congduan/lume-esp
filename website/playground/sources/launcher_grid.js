/*
 * r160: launcher_grid -- curated 3x3 app launcher grid.
 * r162: observable edit-mode state (editing signal + EDIT status feedback).
 * r200: aligned to docs/DESIGN-TOKENS.md for round 480x480 screens without
 * modifying runtime/shell.js:
 *   - Wrapped in shell.SafeArea (339x339 inscribed square; all controls inside
 *     global [80, 400] <= [75, 405]).
 *   - GRID / 9 APPS header and EDIT button moved inside the safe area.
 *   - Replaced octagonal fillRect tiles with circular fillCircle(24, 24, 22)
 *     badges + crisp white uppercase glyphs using DESIGN-TOKENS colors.
 *   - Evenly spaced, centered 3x3 grid with visible app labels; preserves the
 *     exact 9 x 48x48 Canvas budget (20736 px <= 230400 px), EdgeNavigation
 *     back-out-of-edit, onLaunch / onBack host semantics, and lgApi surface.
 *
 * Pure app layer: no firmware / runtime / tools/lume / .d.ts change.
 * Text uses only the 14/20/32 bridge faces and all UI copy is ASCII (r64).
 * Conservative global script: var / function only, one shell.js import.
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg: '#000000', primary: '#0D1420', surface: '#16202E',
  surfaceAlt: '#1F2C3D', text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0',
  danger: '#FF6B79', success: '#40D8B0' },
  radius: 12, spacing: 8 });

/* Nine curated apps. Circular badges using DESIGN-TOKENS palette (bg-3 /
 * accent-deep fills with token-family accent/info/warn/danger rings) and
 * crisp centered white single-letter ASCII glyphs (r64). */
var APPS = [
  { id: 'counter',        label: 'COUNTER',  color: '#117B69', ring: '#40D8B0', glyph: 'C' },
  { id: 'timer_kit',      label: 'TIMER',    color: '#1F2C3D', ring: '#FFD78E', glyph: 'T' },
  { id: 'control_center', label: 'CONTROL',  color: '#117B69', ring: '#40D8B0', glyph: 'Q' },
  { id: 'keyboard_demo',  label: 'KEYS',     color: '#1F2C3D', ring: '#5B9DF7', glyph: 'K' },
  { id: 'wordle',         label: 'WORDLE',   color: '#117B69', ring: '#40D8B0', glyph: 'W' },
  { id: 'weather',        label: 'WEATHER',  color: '#1F2C3D', ring: '#5B9DF7', glyph: 'E' },
  { id: 'music_player',   label: 'MUSIC',    color: '#1F2C3D', ring: '#FF6B79', glyph: 'M' },
  { id: 'clock',          label: 'CLOCK',    color: '#1F2C3D', ring: '#FFD78E', glyph: 'L' },
  { id: 'settings',       label: 'SETTINGS', color: '#1F2C3D', ring: '#9EB3C6', glyph: 'S' },
];

var ICON_PX = 48;
var ICON_AREA = ICON_PX * ICON_PX;          /* 2304 px per icon */
var FRAME_AREA = 480 * 480;                 /* 230400 px full frame */
var COLUMNS = 3;
var lastAction = signal('READY');
var editing = signal(false);
var launching = signal(null);

function setEditing(v) { editing.set(!!v); }
function onLaunch(id) { lastAction.set('launch ' + id); }
function onBack() { lastAction.set('BACK'); return true; }

var root = View({ style: { x: 0, y: 0, width: 480, height: 480,
  padding: 0, gap: 0, background: '#000000', scroll: 'none' } });

var safe = lume.ui.shell.SafeArea({ parent: root, shape: 'round', size: 480, children: [] });

/* Header inside safe area (global y: 76..124, x: 80..400). */
Text({ parent: safe, text: 'GRID',
  style: { x: 10, y: 8, width: 120, height: 24, fontSize: 20, borderRadius: 0,
    color: '#F2F7FB', scroll: 'none' } });
Text({ parent: safe, text: '9 APPS',
  style: { x: 10, y: 34, width: 120, height: 18, fontSize: 14, borderRadius: 0,
    color: '#9EB3C6', scroll: 'none' } });

Button({ parent: safe,
  title: function () { return editing() ? 'DONE' : 'EDIT'; },
  style: { x: 254, y: 6, width: 76, height: 48, borderRadius: 999, fontSize: 14,
    background: function () { return editing() ? '#117B69' : '#1F2C3D'; },
    borderWidth: 2,
    borderColor: function () { return editing() ? '#40D8B0' : '#5C7794'; } },
  onPress: function () { setEditing(!editing()); } });

/* Centered 3x3 grid inside safe area: 3 cols x 104 px = 312 px (local x: 14..326),
 * 3 rows x 82 px = 246 px (local y: 60..306 -> global [84..396] x [130..376]). */
var CELL_W = 104, CELL_H = 80, GRID_X = 14, GRID_Y = 60;
for (var idx = 0; idx < APPS.length; idx++) {
  (function (app, i) {
    var col = i % COLUMNS;
    var row = Math.floor(i / COLUMNS);
    var tile = View({ parent: safe,
      style: { x: GRID_X + col * CELL_W, y: GRID_Y + row * CELL_H,
        width: CELL_W, height: CELL_H, padding: 4, gap: 4,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', scroll: 'none',
        opacity: function () { return launching() === app.id ? 0.55 : 1; } },
      onPress: function () {
        if (editing()) return;
        launching.set(app.id);
        onLaunch(app.id);
      } }, [
      Canvas({ width: ICON_PX, height: ICON_PX, style: { scroll: 'none' }, onDraw: function (c) {
        c.clear();
        c.fillCircle(24, 24, 22, app.color);
        c.circle(24, 24, 21, app.ring, 2);
        c.text(19, 17, app.glyph, '#F2F7FB');
      } }),
      Text({ text: app.label, style: { width: 96, height: 18, fontSize: 14,
        textAlign: 'center', color: '#F2F7FB', scroll: 'none' } }),
    ]);
    return tile;
  })(APPS[idx], idx);
}

/* Status strip inside safe area (local y: 310..330 -> global y: 380..400 <= 405). */
var statusText = Text({ parent: safe,
  text: function () { return editing() ? 'EDIT' : lastAction(); },
  style: { x: 10, y: 310, width: 320, height: 20, fontSize: 14,
    textAlign: 'center', color: '#9EB3C6', scroll: 'none' } });

/* EdgeNavigation back: exits editing mode first, otherwise invokes host onBack. */
lume.ui.shell.EdgeNavigation({ parent: root, indicator: false,
  onBack: function () {
    if (editing()) { setEditing(false); return true; }
    return onBack();
  } });

/* Harness / simulator introspection surface (same convention as timer_kit). */
globalThis.lgApi = {
  root: root,
  safe: safe,
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
