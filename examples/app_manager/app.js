/** App manager: list installed apps, uninstall with a two-tap confirmation.
 *  Pure JS on lume.apps.entries()/remove() -- no firmware involvement, so it
 *  stays working regardless of what else is being changed in the firmware
 *  tree. "< HOME" returns to the launcher via lume.apps.home(). */
lume.theme.set({ colors: {
  primary: '#0B0F14', surface: '#161B22', accent: '#2F81F7', text: '#E6EDF3'
}, radius: 12 });

/* r233: square-screen margin is 44px ([44,436], 392px content width). */
var SAFE = 44;
var CONTENT_W = 392;
var rows = signal([]);
var pendingRemove = signal('');
var status = signal('');

function rebuild() {
  var apps = lume.apps.entries();
  rows.set(apps.map(function (a) { return { id: a.id, label: a.label || a.id }; }));
  status.set(apps.length + ' apps installed');
}
rebuild();

function askRemove(id) {
  if (pendingRemove() === id) {
    var r = lume.apps.remove(id);
    pendingRemove.set('');
    status.set(r === 0 ? 'removed ' + id : 'remove failed ' + r);
    if (r === 0) rebuild();
    return;
  }
  pendingRemove.set(id);
  status.set('tap UNINSTALL again to remove ' + id);
}

/* full-bleed backdrop */
View({ style: { x: 0, y: 0, width: 480, height: 480, background: 'primary',
  borderWidth: 0, borderRadius: 0 } });

/* header: back-to-home + live status. 56px tall so the HOME tap target is
 * a full 48px; the whole header stays inside [84..396, 84..140]. */
View({ style: { x: SAFE, y: SAFE, width: CONTENT_W, height: 56, background: '#11161D',
  borderRadius: 10, display: 'flex', flexDirection: 'row',
  justifyContent: 'space-between', alignItems: 'center',
  paddingLeft: 10, paddingRight: 10, scroll: 'none' } }, [
  Button({ title: '< HOME', style: { width: 88, height: 48, borderRadius: 8 },
    onPress: function () { lume.apps.home(); } }),
  Text({ text: function () { return status(); }, style: {} })
]);

/* app list with per-row uninstall. Windowed by shell.List: itemHeight stays
 * 48 and overscan stays 1, so only style.height/width/x/y change; the 324px
 * viewport ends at y=436 inside the square margin [44,436]. */
List({ style: { x: SAFE, y: 112, width: CONTENT_W, height: 324, background: 'surface',
  borderRadius: 10, scrollbar: 'off' },
  items: rows, itemHeight: 48, overscan: 1,
  renderItem: function (e) { return View({
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
      width: '100%', height: 48, paddingLeft: 10, borderRadius: 8, scroll: 'none',
      background: function () {
        return pendingRemove() === e.id ? '#3A1D1D' : '#101828';
      } } }, [
    Text({ text: e.label, style: {} }),
    Button({ title: function () { return pendingRemove() === e.id ? 'SURE' : 'UNINSTALL'; },
      style: { width: 92, height: 48, borderRadius: 7 },
      onPress: function () { askRemove(e.id); } })
  ]); }
});

lume.app.onBack(function () { return true; });
