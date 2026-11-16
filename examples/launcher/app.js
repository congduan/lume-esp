/** Optional boot-pinned launcher. Deploy with id "launcher". */
var bootStatus = lume.apps.setBoot('launcher');
var editing = signal(false);
var status = signal(bootStatus === 0 ? '' : 'boot pin failed ' + bootStatus);
var installed = lume.apps.entries().filter(function (app) {
  return app.id !== 'launcher';
});

function openApp(id) {
  var r = lume.apps.launch(id);
  if (r < 0) status.set('launch failed ' + r);
}

function exitLauncher() {
  var r = lume.apps.setBoot('');
  if (r < 0) {
    status.set('exit failed ' + r);
    return;
  }
  r = lume.apps.home();
  if (r < 0) status.set('home failed ' + r);
}

lume.theme.set({ colors: {
  primary: '#090E17', surface: '#172235', accent: '#4B8BFF', text: '#F0F4FC'
}, radius: 12 });

View({ style: { x: 0, y: 0, width: 480, height: 480,
  background: 'primary', borderWidth: 0, borderRadius: 0 } });
Text({ text: 'Lume', style: { x: 34, y: 36, width: 270, height: 48 } });
Button({ title: function () { return editing() ? 'DONE' : 'EDIT'; },
  style: { x: 355, y: 38, width: 90, height: 42 },
  onPress: function () { editing.set(!editing()); status.set(''); } });
Text({ text: function () { return status(); },
  style: { x: 34, y: 95, width: 410, height: 32 } });

List({ style: { x: 30, y: 138, width: 420, height: 270,
  background: 'surface', borderRadius: 12, scrollbar: 'auto' },
  items: installed, itemHeight: 54, overscan: 1,
  renderItem: function (app) {
    return Button({ title: app.label || app.id,
      style: { width: 390, height: 46, borderRadius: 9 },
      onPress: function () { if (!editing()) openApp(app.id); } });
  } });

Button({ title: 'APP MANAGER', style: { x: 30, y: 422, width: 200, height: 42 },
  onPress: function () { openApp('app_manager'); } });
Button({ title: 'EXIT LAUNCHER MODE',
  style: { x: 245, y: 422, width: 205, height: 42,
    opacity: function () { return editing() ? 1 : 0; } },
  onPress: function () { if (editing()) exitLauncher(); } });

lume.app.onBack(function () {
  if (editing()) editing.set(false);
  return true;
});
