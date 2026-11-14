/** File manager for the LittleFS partition mounted at /lume_fs (see
 * lume.storage.Fs). Browse, descend, delete, create a folder and peek at a
 * text file.
 *
 * Layout follows the panel rules used elsewhere in this repo: 40 px inset on
 * every edge (round-corner AMOLED), absolute x/y on direct children of the
 * screen, no wrapper container. Text attributes are capped at 63 bytes, so the
 * path and the file preview are truncated/chopped explicitly.
 *
 * There is no on-screen keyboard in the runtime, so NEW creates "folder-N"
 * automatically instead of prompting for a name. */
var fmTheme = { colors: {
  primary: '#08111C',
  surface: '#132436',
  accent: '#1E88E5',
  text: '#E8F2FF'
}, radius: 10, fontScale: 1 };
lume.theme.set(fmTheme);

var SAFE = 40;
var WIDE = 480 - SAFE * 2;
var LIST_Y = 88;
var LIST_H = 300;
var ROW_H = 44;
var Fs = lume.storage.Fs;

var cwd = signal('/');
var entries = signal([]);
var selected = signal('');
var status = signal('loading...');
var preview = signal(null);

/* --- data layer --------------------------------------------------------- */

function isDir(path) {
  return Fs.exists(path + '/') === true;
}

function trim(text, max) {
  var s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1) + '~';
}

function loadDir(path) {
  var list = Fs.list(path);
  if (typeof list === 'number') {
    status.set('list failed ' + list);
    return;
  }
  list.sort(function (a, b) {
    var da = isDir(path + a), db = isDir(path + b);
    if (da !== db) return da ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  entries.set(list.map(function (name) {
    return { name: name, isDir: isDir(path + name) };
  }));
  cwd.set(path);
  selected.set('');
  preview.set(null);
  lume.setAttr(previewCanvas, 5, 0);
  status.set(list.length + ' items');
}

function goUp() {
  if (cwd() === '/') {
    status.set('already at root');
    return;
  }
  loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
}

function open(entry) {
  if (entry.isDir) {
    loadDir(cwd() + entry.name + '/');
    return;
  }
  selected.set(entry.name);
  status.set(entry.name + ' selected');
}

function previewSelected() {
  if (preview() !== null) {
    preview.set(null);
    lume.setAttr(previewCanvas, 5, 0);
    status.set('closed preview');
    return;
  }
  var name = selected();
  if (!name) {
    status.set('select a file first');
    return;
  }
  var text = Fs.read(cwd() + name);
  if (typeof text === 'number') {
    status.set('read failed ' + text);
    return;
  }
  /* 40-char lines, 8 rows: what the preview canvas can show at 14 px. */
  var raw = String(text).replace(/\r/g, '');
  var lines = [];
  for (var i = 0; i < raw.split('\n').length && lines.length < 8; i++) {
    var line = raw.split('\n')[i];
    if (line.length > 40) line = line.slice(0, 40);
    lines.push(line === '' ? ' ' : line);
  }
  preview.set({ name: name, lines: lines });
  lume.setAttr(previewCanvas, 5, 1);
  status.set('preview: ' + name);
}

function removeSelected() {
  var name = selected();
  if (!name) {
    status.set('select an item first');
    return;
  }
  var err = Fs.remove(cwd() + name);
  status.set(err === 0 ? 'deleted ' + name : 'delete failed ' + err);
  loadDir(cwd());
}

function makeDir() {
  for (var i = 1; i < 100; i++) {
    var candidate = 'folder-' + i;
    if (Fs.exists(cwd() + candidate) !== true) {
      var err = Fs.mkdir(cwd() + candidate);
      status.set(err === 0 ? 'created ' + candidate : 'mkdir failed ' + err);
      loadDir(cwd());
      return;
    }
  }
  status.set('no free folder name');
}

/* --- UI ----------------------------------------------------------------- */

var backdrop = View({ style: { x: 0, y: 0, width: 480, height: 480, background: 'primary',
  borderWidth: 0, borderRadius: 0 } });

/* path bar */
View({ style: {
  x: SAFE, y: SAFE, width: WIDE, height: 40,
  background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
  display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
  alignItems: 'center', padding: 8, scroll: 'none'
} }, [
  Text({ text: function () { return trim(cwd(), 26); }, style: {} }),
  Text({ text: function () { return lume.storage.Fs.mounted() === true ? 'mounted' : 'no fs'; },
    style: {} })
]);

/* file list */
List({
  items: entries,
  itemHeight: ROW_H,
  style: { x: SAFE, y: LIST_Y, width: WIDE, height: LIST_H,
    background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 10,
    scrollbar: 'auto' },
  renderItem: function (entry) {
    return View({ style: {
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
      width: '100%', height: ROW_H, padding: 8, borderRadius: 8, scroll: 'none',
      background: function () { return selected() === entry.name ? '#1E3A5C' : '#101E2C'; }
    }, onPress: function () { open(entry); } }, [
      Text({ text: entry.isDir ? 'DIR ' : 'FILE', style: {} }),
      Text({ text: trim(entry.name, 28), style: {} })
    ]);
  }
});

/* preview overlay: a canvas that draws the first 8 lines of the file */
var previewCanvas = Canvas({ width: WIDE, height: 300, style: { x: SAFE, y: LIST_Y, borderRadius: 0 },
  onDraw: function (ctx) {
    var p = preview();
    ctx.clear();
    ctx.fillColor('#04090F');
    ctx.fillRect(0, 0, WIDE, 300);
    if (p === null) return;
    ctx.text(10, 8, trim(p.name, 40), '#5C7794', 14);
    for (var i = 0; i < p.lines.length; i++) {
      ctx.text(10, 36 + i * 30, p.lines[i], '#E6F0FA', 14);
    }
  } });

lume.setAttr(previewCanvas, 5, 0);   /* ATTR_VISIBLE = 5, hidden until VIEW */

/* status line + action bar */
Text({ text: function () { return trim(status(), 46); },
  style: { x: SAFE, y: 394, width: WIDE, height: 18 } });

function action(x, label, handler) {
  return Button({ title: label, style: {
    x: x, y: 408, width: 94, height: 32,
    background: 'surface', borderColor: '#22405A', borderWidth: 1, borderRadius: 9
  }, onPress: handler });
}

action(SAFE, 'UP', goUp);
action(140, 'NEW', makeDir);
action(240, 'DEL', removeSelected);
action(340, 'VIEW', previewSelected);

/* swipe up on the backdrop = leave the current folder (same target as UP) */
lume.gesture.on(backdrop, 'swipe', function (e) {
  if (e.dir === 'bottom') goUp();
});

lume.app.onStart(function () { loadDir(cwd()); });
lume.app.onResume(function () { loadDir(cwd()); });
