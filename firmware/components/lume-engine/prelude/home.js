/** Built-in home: watch-launcher grid with an EDIT uninstall mode.
 *  Status bar (clock / wifi / battery / EDIT), 3-column rounded tiles.
 *  Tap = launch. EDIT: tile turns dark red, 'x name' -> 'SURE?' -> removed.
 *  Launching destroys this context (exactly one live app). */
lume.theme.set({
  colors: { primary: '#0B0F14', surface: '#161B22', accent: '#2F81F7', text: '#E6EDF3' },
  radius: 14, fontScale: 1,
});

var COLS = 3;
var ICON = 56;
var ROW = 112;
var HEAD = 36;

var editMode = signal(false);   /* EDIT: tap a tile twice to uninstall */
var pendingRemove = signal('');
var removedIds = signal([]);
var gridRows = signal([]);

function fmtClock() {
  var n = new Date();
  return ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2);
}
function glyphOf(app) {
  return String(app.icon || app.label || app.id || '?').slice(0, 1).toUpperCase();
}
function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '.' : s;
}

var clock = signal(fmtClock());
var batt = lume.pmic.battPercent();
var busy = signal('');
var wifiFlag = signal('');
function wifiText() {
  var st = lume.net.status();
  if (typeof st !== 'object' || st === null) return '';
  if (st.state === 3) return 'wifi';
  if (st.state === 2) return 'wifi~';
  if (st.state === 1) return 'wifi..';
  return '';
}
wifiFlag.set(wifiText());
lume.system.setInterval(function () {
  clock.set(fmtClock());
  wifiFlag.set(wifiText());
}, 30000);

function rebuildGrid() {
  var apps = lume.apps.entries();
  var rs = [];
  for (var i = 0; i < apps.length; i += COLS) rs.push(apps.slice(i, i + COLS));
  gridRows.set(rs);
}
rebuildGrid();

var root = View({ style: { width: '100%', height: 480,
  background: 'primary', scroll: 'none' } });

/* status bar: clock | wifi | battery | EDIT/DONE */
View({ parent: root, style: {
  display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
  alignItems: 'center', width: '100%', height: HEAD, background: '#11161D',
  paddingLeft: 40, paddingRight: 40, scroll: 'none' } }, [
  Text({ text: clock, style: {} }),
  Text({ text: function () { return wifiFlag(); }, style: {} }),
  Text({ text: function () {
    return typeof batt === 'number' && batt >= 0 ? 'battery ' + batt + '%' : 'battery --';
  }, style: {} })
]);

/* hairline */
View({ parent: root, style: {
  x: 40, y: HEAD, width: 480 - 80, height: 1,
  background: '#1F2630', borderWidth: 0, borderRadius: 0 } });

function tile(app) {
  return View({ style: { display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    width: 148, height: ROW - 16,
    background: function () { return editMode() ? '#3A1D1D' : '#12161D'; },
    borderRadius: 18, borderWidth: 0, scroll: 'none',
    opacity: function () {
      return (busy() === app.id || removedIds().indexOf(app.id) >= 0) ? 0.3 : 1;
    } },
    onPress: function () {
      if (busy()) return;
      if (editMode()) {
        if (pendingRemove() === app.id) {
          busy.set(app.id);
          var r = lume.apps.remove(app.id);
          busy.set('');
          pendingRemove.set('');
          if (r !== 0) lume.system.log('home remove ' + app.id + ' err ' + r);
          removedIds.set([app.id]);
          rebuildGrid();
          return;
        }
        pendingRemove.set(app.id);
        return;
      }
      pendingRemove.set('');
      busy.set(app.id);
      var r = lume.apps.launch(app.id);
      if (r !== 0) { busy.set(''); return; }
      lume.system.setTimeout(function () { busy.set(''); }, 2500);
    } }, [
    View({ style: { width: ICON, height: ICON,
      background: app.color || '#2F81F7', borderRadius: 22,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderWidth: 0, scroll: 'none' } }, [
      Text({ text: glyphOf(app), style: { textAlign: 'center' } })
    ]),
    Text({ text: function () {
      var name = clip(app.label || app.id || '', 10);
      if (!editMode()) return name;
      return pendingRemove() === app.id ? 'SURE?' : 'x ' + name;
    }, style: { width: 140, height: 18, textAlign: 'center' } })
  ]);
}

if (gridRows().length === 0) {
  View({ parent: root, style: { display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', width: '100%', height: 480 - HEAD,
    gap: 10, scroll: 'none' } }, [
    Text({ text: 'no apps installed', style: { textAlign: 'center' } }),
    Text({ text: 'lume deploy <app>', style: { textAlign: 'center' } })
  ]);
} else {
  List({ parent: root, style: { y: HEAD + 12, width: '100%',
      height: 480 - HEAD - 12, background: 'primary', scrollbar: 'off' },
    items: gridRows, itemHeight: ROW, overscan: 1,
    renderItem: function (row) {
      return View({ style: { display: 'flex', flexDirection: 'row',
        justifyContent: 'space-around', alignItems: 'center',
        width: '100%', height: ROW, background: 'primary', scroll: 'none' } },
        row.map(function (app) { return tile(app); }));
    }
  });
}

/* Home is the root: BACK must not tear the runtime down into itself. */
lume.app.onBack(function () { return true; });
