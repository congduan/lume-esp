/* r230 adaptive: app authored on a 480 logical canvas; map to real screen.
 * At 480 this block is an exact no-op (all wrappers forward unchanged args).
 * Mechanism mirrors the r227 __A_* shim (13 round flagships + 16 others). */
var SW = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.w > 0) ? __lumeScreen.w : 480;
var SH = (typeof __lumeScreen !== 'undefined' && __lumeScreen && __lumeScreen.h > 0) ? __lumeScreen.h : 480;
var __A_ADAPT = SW !== 480 || SH !== 480;
var __A_KX = SW / 480, __A_KY = SH / 480;
function __A_SX(v) { return Math.round(v * __A_KX); }
function __A_SY(v) { return Math.round(v * __A_KY); }
var __A_XK = ',width,x,borderRadius,borderWidth,gap,margin,marginLeft,marginRight,padding,paddingLeft,paddingRight,minWidth,maxWidth,letterSpacing,translateX,';
var __A_YK = ',height,y,borderRadius,borderWidth,gap,margin,marginTop,marginBottom,padding,paddingTop,paddingBottom,minHeight,maxHeight,lineHeight,translateY,';
function __A_style(s) {
  if (!__A_ADAPT || !s || typeof s !== 'object') return s;
  var o = {}, k;
  for (k in s) {
    var v = s[k];
    if (typeof v === 'number' && __A_XK.indexOf(',' + k + ',') >= 0) o[k] = __A_SX(v);
    else if (typeof v === 'number' && __A_YK.indexOf(',' + k + ',') >= 0) o[k] = __A_SY(v);
    else o[k] = v;
  }
  return o;
}
function __A_ctx(c) {
  if (c.__r230Ctx) return c.__r230Ctx;
  var w = { nodeId: c.nodeId };
  function pt(p) { return [__A_SX(p[0]), __A_SY(p[1])]; }
  function sg(s) { return [__A_SX(s[0]), __A_SY(s[1]), __A_SX(s[2]), __A_SY(s[3])]; }
  w.clear = function () { return c.clear(); };
  w.fillColor = function (x) { return c.fillColor(x); };
  w.fillRect = function (x, y, ww, hh) { return c.fillRect(__A_SX(x), __A_SY(y), __A_SX(ww), __A_SY(hh)); };
  w.line = function (a, b, d, e, col, wd) { return c.line(__A_SX(a), __A_SY(b), __A_SX(d), __A_SY(e), col, wd); };
  w.polyline = function (p, col, wd) { return c.polyline(p.map(pt), col, wd); };
  w.retainPath = function (p, col, wd) { return c.retainPath(p.map(pt), col, wd); };
  w.retainSegments = function (p, col, wd) { return c.retainSegments(p.map(sg), col, wd); };
  w.drawPath = function (id, dx, dy) { return c.drawPath(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy)); };
  w.retainImage = function (id, ww, hh, px) {
    var rw = Math.min(SW, __A_SX(ww)), rh = Math.min(SH, __A_SY(hh));
    if (rw === ww && rh === hh) return c.retainImage(id, ww, hh, px);
    var out = new Uint16Array(rw * rh);
    for (var y = 0; y < rh; y++) {
      var sy = Math.min(hh - 1, Math.round(y * hh / rh));
      for (var x = 0; x < rw; x++) {
        var sx = Math.min(ww - 1, Math.round(x * ww / rw));
        out[y * rw + x] = px[sy * ww + sx];
      }
    }
    return c.retainImage(id, rw, rh, out);
  };
  w.drawImage = function (id, dx, dy, flip) { return c.drawImage(id, dx === undefined ? 0 : __A_SX(dx), dy === undefined ? 0 : __A_SY(dy), flip); };
  w.circle = function (x, y, r, col) { return c.circle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillCircle = function (x, y, r, col) { return c.fillCircle(__A_SX(x), __A_SY(y), __A_SX(r), col); };
  w.fillEllipse = function (x, y, rx, ry, col) { return c.fillEllipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col); };
  w.ellipse = function (x, y, rx, ry, col, wd) { return c.ellipse(__A_SX(x), __A_SY(y), __A_SX(rx), __A_SY(ry), col, wd); };
  w.arc = function (x, y, r, fr, to, wd, col) { return c.arc(__A_SX(x), __A_SY(y), __A_SX(r), fr, to, wd, col); };
  w.text = function (x, y, str, col, sz) { return c['text'](__A_SX(x), __A_SY(y), str, col, sz); };
  c.__r230Ctx = w;
  return w;
}
function __A_Canvas(p) {
  if (!__A_ADAPT || !p) return Canvas(p);
  var o = {}, k;
  for (k in p) o[k] = p[k];
  var cw = Math.min(SW, __A_SX(Number(p.width) || 0)), ch = Math.min(SH, __A_SY(Number(p.height) || 0));
  o.width = cw; o.height = ch; o.style = __A_style(p.style);
  var fn = p.onDraw;
  o.onDraw = function (c) {
    var d = fn(__A_ctx(c));
    if (!d || typeof d !== 'object') return d;
    function rect(r) {
      var x = __A_SX(r.x), y = __A_SY(r.y);
      return { x: x, y: y, w: Math.min(cw - x, __A_SX(r.w)), h: Math.min(ch - y, __A_SY(r.h)) };
    }
    return Array.isArray(d) ? d.map(rect) : rect(d);
  };
  return Canvas(o);
}
function __A_props(p, minTouch) {
  if (!__A_ADAPT || !p || typeof p !== 'object') return p;
  var o = {}, k;
  for (k in p) o[k] = (k === 'style') ? __A_style(p[k]) : p[k];
  if (minTouch && p.style && o.style) {
    if (typeof p.style.width === 'number' && p.style.width >= 48 && o.style.width < 48) o.style.width = 48;
    if (typeof p.style.height === 'number' && p.style.height >= 48 && o.style.height < 48) o.style.height = 48;
  }
  return o;
}
function __A_View(p, kids) { return View(__A_props(p, !!(p && p.onPress)), kids); }
function __A_Text(p, kids) { return Text(__A_props(p), kids); }
function __A_Button(p, kids) { return Button(__A_props(p, true), kids); }
function __A_Image(p, kids) { return Image(__A_props(p), kids); }
function __A_List(p) {
  if (!__A_ADAPT || !p) return List(p);
  var o = __A_props(p);
  o.itemHeight = (typeof p.itemHeight === 'number' && p.itemHeight >= 48) ? Math.max(48, __A_SY(p.itemHeight)) : __A_SY(p.itemHeight);
  return List(o);
}

/**
 * File browser (examples/files, r206 round AMOLED redesign).
 *
 * Fs directory browsing, enter/parent navigation, mkdir, text file preview,
 * and Dialog-confirmed recursive delete. r127 adds TF-card (Sd) mount discovery
 * via an SD/ virtual entry in Fs root with per-op Sd->Fs fallback and try/catch
 * degradation. r206 aligns the presentation layer to the 480x480 round AMOLED
 * [76, 404] safe square with grouped cards, vector folder/file/SD icons, empty
 * state, and danger-isolated delete controls (<= 240 draw calls per frame).
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0'
}, radius: 12, spacing: 12 });

const ROW_H = 52;
const LIST_H = 212;
const PREVIEW_ROWS = 7;

/* ============ State ============ */
const cwd = signal('/');
const entries = signal([]);
const selected = signal(null);
const preview = signal(null);   /* { name, lines } | null */
const onSd = signal(false);     /* true = browsing TF card root, false = Fs */

function notify(message) { lume.ui.shell.Toast.show(message); }

var sd = (lume.storage && lume.storage.Sd) || null;
var sdReady = !!(sd && typeof sd.mounted === 'function' && sd.mounted() === true);

function sdOrFs(method, p) {
  var r;
  try { r = sd[method](p); }
  catch (e) { return Fs[method](p); }
  if (typeof r === 'number' && r < 0) return Fs[method](p);
  return r;
}
function pathExists(p) { return onSd() ? sdOrFs('exists', p) : Fs.exists(p); }
function listDir(p) { return onSd() ? sdOrFs('list', p) : Fs.list(p); }
function readText(p) { return onSd() ? sdOrFs('read', p) : Fs.read(p); }
function removeAt(p) { return onSd() ? sdOrFs('remove', p) : Fs.remove(p); }
function mkdirAt(p) { return onSd() ? sdOrFs('mkdir', p) : Fs.mkdir(p); }

/* ============ Data layer ============ */
function isDirPath(p) {
  try {
    return pathExists(p + '/') === true;
  } catch (e) {
    return false;
  }
}

function trim(text, max) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1) + '~';
}

function itemsLabel() {
  if (Fs.mounted() !== true) return 'no fs';
  const n = entries().length;
  return n + (n === 1 ? ' item' : ' items');
}

function cardInfoText() {
  if (!sd || typeof sd.statvfs !== 'function') return '';
  try {
    var stat = sd.statvfs();
    if (stat && typeof stat === 'object') {
      var freeMB = Math.floor(stat.free / 1048576);
      return 'SD ' + freeMB + 'MB FREE';
    }
    return 'NO CARD';
  } catch (e) {
    return 'NO CARD';
  }
}

function statusLabel() {
  return onSd() ? cardInfoText() : itemsLabel();
}

function loadDir(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  let list;
  try { list = listDir(clean); }
  catch (e) { list = -2; }
  if (typeof list === 'number') {
    entries.set([]);
    cwd.set(clean === '/' ? '/' : clean + '/');
    selected.set(null);
    closePreview();
    notify('Read failed: ' + list);
    return;
  }
  if (!onSd() && sdReady && clean === '/' && list.indexOf('SD/') < 0) {
    list = list.slice();
    list.push('SD/');
  }
  list.sort(function (a, b) {
    const da = a === 'SD/' ? true : isDirPath(path + a);
    const db = b === 'SD/' ? true : isDirPath(path + b);
    if (da !== db) return da ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  entries.set(list.map(function (name) {
    if (name === 'SD/') return { name: name, isDir: true, sd: true };
    return { name: name, isDir: isDirPath(path + name) };
  }));
  cwd.set(clean === '/' ? '/' : clean + '/');
  selected.set(null);
  closePreview();
}

function goUp() {
  if (cwd() === '/') {
    if (onSd()) {
      onSd.set(false);
      loadDir('/');
      return;
    }
    notify('Already at root');
    return;
  }
  loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
}

function openEntry(e) {
  if (e.sd) {
    onSd.set(true);
    loadDir('/');
    return;
  }
  if (e.isDir) {
    loadDir(cwd() + e.name + '/');
    return;
  }
  selected.set(e.name);
  notify(e.name + ' selected');
}

function removeTree(path, isDirectory, depth) {
  if (depth > 8) return -1;
  if (!isDirectory) {
    try { return removeAt(path); }
    catch (e) { return -2; }
  }
  let list;
  try { list = listDir(path + '/'); }
  catch (e) { return -2; }
  if (typeof list !== 'number') {
    for (let i = 0; i < list.length; i++) {
      const child = path + '/' + list[i];
      const err = removeTree(child, isDirPath(child), depth + 1);
      if (err !== 0) return err;
    }
  }
  try { return removeAt(path); }
  catch (e) { return -2; }
}

function deleteEntry(name) {
  if (!name) {
    notify('Select an item first');
    return;
  }
  const err = removeTree(cwd() + name, isDirPath(cwd() + name), 0);
  loadDir(cwd());
  if (err === 0) notify('Deleted ' + name);
  else notify('Delete failed ' + err);
}

function askDelete(name) {
  if (!name) {
    notify('Select an item first');
    return;
  }
  if (name === 'SD/') {
    notify('Cannot delete SD entry');
    return;
  }
  lume.ui.shell.Dialog({
    title: 'Delete ' + name + '?',
    message: name + ' cannot be recovered.',
    buttons: [
      { label: 'Cancel', style: 'plain' },
      { label: 'Delete', style: 'danger', onPress: function () { deleteEntry(name); } }
    ]
  });
}

function removeSelected() {
  const name = selected();
  if (!name) {
    notify('Select an item or use row DEL');
    return;
  }
  askDelete(name);
}

function makeDir() {
  for (let i = 1; i < 100; i++) {
    const candidate = 'folder-' + i;
    let exists;
    try { exists = pathExists(cwd() + candidate); }
    catch (e) { exists = -2; }
    if (exists !== true) {
      let err;
      try { err = mkdirAt(cwd() + candidate); }
      catch (e) { err = -2; }
      if (err === 0) notify('Created ' + candidate);
      else notify('mkdir failed ' + err);
      loadDir(cwd());
      return;
    }
  }
  notify('No free folder name');
}

function closePreview() {
  if (preview() === null) return;
  preview.set(null);
  lume.setAttr(previewPanel, 5, 0);
}

function previewSelected() {
  if (preview() !== null) {
    closePreview();
    return;
  }
  const name = selected();
  if (!name) {
    notify('Select a file first');
    return;
  }
  let text;
  try { text = readText(cwd() + name); }
  catch (e) { text = -2; }
  if (typeof text === 'number') {
    notify('Read failed ' + text);
    return;
  }
  const raw = String(text).replace(/\r/g, '').split('\n');
  const lines = [];
  for (let i = 0; i < raw.length && lines.length < PREVIEW_ROWS; i++) {
    lines.push(raw[i].slice(0, 38));
  }
  preview.set({ name: name, lines: lines });
  lume.setAttr(previewPanel, 5, 1);
}

/* ============ Inline SVG Icons (0 Canvas PSRAM, 0 draw calls) ============ */
function svgBuf(svg) {
  var b = new Uint8Array(svg.length);
  for (var i = 0; i < svg.length; i++) b[i] = svg.charCodeAt(i);
  return b.buffer;
}

var SVG_SD = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#152B44" stroke="#2B4E75" stroke-width="1"/>' +
  '<path d="M 10 8 L 19 8 L 23 12 L 23 24 L 10 24 Z" fill="none" stroke="#5B9DF7" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<line x1="13.5" y1="11" x2="13.5" y2="14.5" stroke="#5B9DF7" stroke-width="1.6"/>' +
  '<line x1="17" y1="11" x2="17" y2="14.5" stroke="#5B9DF7" stroke-width="1.6"/>' +
  '</svg>'
);

var SVG_DIR = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#2E2616" stroke="#5F4D26" stroke-width="1"/>' +
  '<path d="M 7 11 L 13 11 L 15.5 13.5 L 25 13.5 L 25 23 L 7 23 Z" fill="none" stroke="#FFD78E" stroke-width="1.8" stroke-linejoin="round"/>' +
  '</svg>'
);

var SVG_FILE = svgBuf(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#133334" stroke="#285E5C" stroke-width="1"/>' +
  '<path d="M 10 8 L 18.5 8 L 22.5 12 L 22.5 24 L 10 24 Z" fill="none" stroke="#40D8B0" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<line x1="13" y1="15.5" x2="19.5" y2="15.5" stroke="#40D8B0" stroke-width="1.5"/>' +
  '<line x1="13" y1="19.5" x2="18" y2="19.5" stroke="#40D8B0" stroke-width="1.5"/>' +
  '</svg>'
);

var hasImageApi = !!(lume.image && typeof lume.image.sizeOf === 'function');

/* ============ UI (480x480 Round AMOLED, [76, 404] safe area) ============ */
const root = __A_View({ style: {
  width: '100%', height: '100%', background: '#000000', scroll: 'none'
} }, [
  /* Round dial bezel */
  __A_View({ style: {
    position: 'absolute', x: 14, y: 14, width: 452, height: 452,
    borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
    scroll: 'none'
  } }),

  /* Safe area container [76, 404] */
  __A_View({ style: {
    position: 'absolute', x: 76, y: 76, width: 328, height: 328,
    background: '#09101A', scroll: 'none'
  } }, [
    /* Breadcrumb top bar */
    __A_View({ style: {
      position: 'absolute', x: 4, y: 0, width: 320, height: 48,
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, scroll: 'none'
    } }, [
      __A_Button({
        title: '<',
        style: {
          width: 48, height: 48, borderRadius: 12,
          background: '#16202E', borderColor: '#233245', borderWidth: 1,
          color: '#F2F7FB', fontSize: 18
        },
        onPress: goUp
      }),
      __A_View({ style: {
        flexGrow: 1, height: 48, background: '#16202E',
        borderColor: '#233245', borderWidth: 1, borderRadius: 12,
        paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', scroll: 'none'
      } }, [
        __A_Text({
          text: function () { return (onSd() ? 'SD:' : 'Files:') + trim(cwd(), 18); },
          style: { width: '100%', height: 20, fontSize: 14, color: '#F2F7FB', longMode: 'dots' }
        }),
        __A_Text({
          text: statusLabel,
          style: { width: '100%', height: 16, fontSize: 12, color: '#40D8B0', longMode: 'dots' }
        })
      ])
    ]),

    /* Virtualized file list (<= 4.2 visible rows -> <= 28 live row nodes) */
    __A_List({
      items: entries, itemHeight: ROW_H, overscan: 1,
      style: { position: 'absolute', x: 4, y: 54, width: 320, height: LIST_H, background: '#09101A', scrollbar: 'off' },
      renderItem: function (e) {
        var rowKids = [];
        if (hasImageApi) {
          var ic = __A_Image({ src: e.sd ? SVG_SD : (e.isDir ? SVG_DIR : SVG_FILE),
            style: { width: 32, height: 32, borderRadius: 8 } });
          if (ic > 0) rowKids.push(ic);
        }
        rowKids.push(__A_Text({
          text: trim(e.name, 18),
          style: { flexGrow: 1, fontSize: 14, color: '#F2F7FB', textAlign: 'left', longMode: 'dots' }
        }));
        rowKids.push(__A_Button({
          title: 'DEL',
          style: {
            width: 48, height: 48, borderRadius: 8,
            background: '#2A1720', borderColor: '#692C3B', borderWidth: 1,
            color: '#FF6B79', fontSize: 12
          },
          onPress: function () { askDelete(e.name); }
        }));
        return __A_View({
          style: {
            width: 300, height: ROW_H - 2,
            background: function () { return selected() === e.name ? '#13292F' : '#16202E'; },
            borderColor: function () { return selected() === e.name ? '#34A88B' : '#233245'; },
            borderWidth: 1, borderRadius: 12,
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            paddingLeft: 8, paddingRight: 4, gap: 8, scroll: 'none'
          },
          onPress: function () { openEntry(e); }
        }, rowKids);
      }
    }),

    /* Bottom action row: New Dir / View / Delete (48px tap targets, danger isolated) */
    __A_View({ style: {
      position: 'absolute', x: 4, y: 272, width: 320, height: 52,
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, scroll: 'none'
    } }, [
      __A_Button({
        title: 'NEW',
        style: {
          flexGrow: 1, height: 48, borderRadius: 12,
          background: '#16202E', borderColor: '#233245', borderWidth: 1,
          color: '#F2F7FB', fontSize: 13
        },
        onPress: makeDir
      }),
      __A_Button({
        title: 'VIEW',
        style: {
          flexGrow: 1, height: 48, borderRadius: 12,
          background: '#116354', borderColor: '#40D8B0', borderWidth: 1,
          color: '#F2F7FB', fontSize: 13
        },
        onPress: previewSelected
      }),
      __A_Button({
        title: 'DEL',
        style: {
          flexGrow: 1, height: 48, marginLeft: 16, borderRadius: 12,
          background: '#2A1720', borderColor: '#7A3240', borderWidth: 1,
          color: '#FF6B79', fontSize: 13
        },
        onPress: removeSelected
      })
    ])
  ])
]);

/* Empty state inside safe area when directory has 0 entries */
__A_Text({
  text: function () { return entries().length ? '' : 'No files in this folder'; },
  style: {
    position: 'absolute', x: 80, y: 224, width: 320, height: 24,
    fontSize: 14, color: '#5C7794', textAlign: 'center'
  }
});

/* Text preview overlay inside round safe area */
const previewPanel = __A_View({
  visible: false,
  style: {
    position: 'absolute', x: 76, y: 76, width: 328, height: 328,
    background: '#0D1420', borderColor: '#2B3E54', borderWidth: 1, borderRadius: 12,
    scroll: 'none'
  },
  onPress: closePreview
});
__A_Text({
  parent: previewPanel,
  text: function () { const p = preview(); return p ? trim(p.name, 30) : ''; },
  style: {
    position: 'absolute', x: 12, y: 10, width: 304, height: 26,
    fontSize: 18, color: '#40D8B0', textAlign: 'center', longMode: 'dots'
  }
});
for (let i = 0; i < PREVIEW_ROWS; i++) {
  __A_Text({
    parent: previewPanel,
    text: function () { const p = preview(); return p && p.lines[i] ? p.lines[i] : ''; },
    style: {
      position: 'absolute', x: 12, y: 44 + i * 34, width: 304, height: 28,
      fontSize: 13, color: '#F2F7FB', longMode: 'dots'
    }
  });
}
__A_Text({
  parent: previewPanel,
  text: 'Tap anywhere to close',
  style: {
    position: 'absolute', x: 12, y: 296, width: 304, height: 22,
    fontSize: 12, color: '#5C7794', textAlign: 'center'
  }
});

lume.gesture.on(0, 'swipe', function (e) {
  if (e.dir !== 'down') return;
  if (preview() !== null) closePreview();
  else goUp();
});

lume.app.onBack(function () {
  if (preview() !== null) { closePreview(); return true; }
  if (cwd() === '/' && !onSd()) return false;
  goUp();
  return true;
});

lume.app.onResume(function () { loadDir(cwd()); });

function seedTestEntries() {
  const test = [];
  for (let i = 0; i < 1000; i++) test.push({ name: 'dir-' + i, isDir: true });
  entries.set(test);
}

loadDir('/');
