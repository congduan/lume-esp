/** Optional boot-pinned launcher, rendered by shell.Launcher on a round screen. */
import '../../runtime/shell.js';

var bootStatus = lume.apps.setBoot('launcher');
var editing = signal(false);
var status = signal(bootStatus === 0 ? '' : 'boot pin failed ' + bootStatus);

lume.theme.set({ colors: {
  bg: '#000000', primary: '#0D1420', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0',
  danger: '#FF6B79', success: '#40D8B0'
}, radius: 12 });

/* Design-token badge palette: bg-3/accent-deep fills with accent/info/warn/
 * danger rings, one crisp white ASCII glyph each. shell.Launcher draws the
 * circular badge; the example only supplies token colours and glyphs. */
var BADGE = [
  { id: 'counter',   label: 'COUNTER',  color: '#117B69', ring: '#40D8B0', glyph: 'C' },
  { id: 'timer_kit', label: 'TIMER',    color: '#1F2C3D', ring: '#FFD78E', glyph: 'T' },
  { id: 'control',   label: 'CONTROL',  color: '#117B69', ring: '#40D8B0', glyph: 'Q' },
  { id: 'keys',      label: 'KEYS',     color: '#1F2C3D', ring: '#5B9DF7', glyph: 'K' },
  { id: 'wordle',    label: 'WORDLE',   color: '#117B69', ring: '#40D8B0', glyph: 'W' },
  { id: 'weather',   label: 'WEATHER',  color: '#1F2C3D', ring: '#5B9DF7', glyph: 'E' },
  { id: 'music',     label: 'MUSIC',    color: '#1F2C3D', ring: '#FF6B79', glyph: 'M' },
  { id: 'clock',     label: 'CLOCK',    color: '#1F2C3D', ring: '#FFD78E', glyph: 'L' },
  { id: 'settings',  label: 'SETTINGS', color: '#1F2C3D', ring: '#9EB3C6', glyph: 'S' },
];
var installed = lume.apps.entries().filter(function (app) { return app.id !== 'launcher'; });
/* Hosts without a native app store (playground / simulator) still show the
 * curated grid, so the round layout can be visually reviewed there. */
var apps = installed.length
  ? installed.map(function (app, i) {
      var b = BADGE[i % BADGE.length];
      return { id: app.id, label: app.label || app.id,
        color: b.color, ring: b.ring, glyph: b.glyph };
    })
  : BADGE.slice();

function exitLauncher() {
  var r = lume.apps.setBoot('');
  if (r < 0) { status.set('exit failed ' + r); return; }
  r = lume.apps.home();
  if (r < 0) status.set('home failed ' + r);
}

var root = lume.ui.shell.Launcher({
  shape: 'round',
  apps: apps,
  title: 'LAUNCHER',
  right: function () { return status(); },
  onLaunch: function (id) {
    var r = lume.apps.launch(id);
    if (r < 0) status.set('launch failed ' + r);
  },
  onBack: function () { exitLauncher(); return true; },
  onEditingChange: function (v) { editing.set(v); },
});

/* Hardware BACK exits launcher mode; edge-back is handled by the Launcher. */
lume.app.onBack(function () { exitLauncher(); return true; });
lume.log('LAUNCHER ROUND READY');
