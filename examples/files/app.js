/**
 * 示例：文件管理器（examples/files + 原 examples/file_manager 合并）
 *
 * Fs 目录浏览、进入下级/返回上级、新建目录、预览文本文件、删除确认。
 * 布局为相对布局：根容器 flex column + padding 24（圆角屏安全区），
 * 三段等高节奏（顶栏 56 / 列表 272 / 操作行 56），间距由 space-between
 * 分配为 24。列表行里文件名左对齐（flexGrow 撑满剩余宽度），DEL 按钮
 * 贴右边缘，而不是紧跟在文件名后面。
 * 删除经 Dialog 确认 + 递归删除（POSIX remove() 对非空目录会失败）。
 * 预览整屏叠一层 Text 面板：运行时没有文本输入控件/滚动文本，最多 8 行。
 */
import '../../runtime/shell.js';

lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing:12 });

const GUTTER = 24;
const ROW_H = 56;
const LIST_H = 272;
const PREVIEW_ROWS = 8;

/* ============ 状态 ============ */
const cwd = signal('/');
const entries = signal([]);
const selected = signal(null);
const preview = signal(null);   /* { name, lines } | null —— 预览面板内容 */

function notify(message) { lume.ui.shell.Toast.show(message); }

/* ============ 数据层 ============ */
function isDirPath(p) {
  return Fs.exists(p + '/') === true;   // 目录以 / 结尾探测
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

function loadDir(path) {
  const clean = path.replace(/\/+$/, '') || '/';   // LittleFS rejects trailing '/'
  const list = Fs.list(clean);
  if (typeof list === 'number') {
    entries.set([]);
    cwd.set(clean === '/' ? '/' : clean + '/');
    notify('Read failed: ' + list);
    return;
  }
  list.sort(function (a, b) {
    const da = isDirPath(path + a), db = isDirPath(path + b);
    if (da !== db) return da ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  entries.set(list.map(function (name) {
    return { name: name, isDir: isDirPath(path + name) };
  }));
  cwd.set(clean === '/' ? '/' : clean + '/');   /* keep the trailing-slash join convention */
  selected.set(null);
  closePreview();
}

function goUp() {
  if (cwd() === '/') {
    notify('Already at root');
    return;
  }
  loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
}

function openEntry(e) {
  if (e.isDir) {
    loadDir(cwd() + e.name + '/');
    return;
  }
  selected.set(e.name);
  notify(e.name + ' selected');
}

/* POSIX remove() 对目录等价 rmdir：目录非空时失败，所以自底向上递归。 */
function removeTree(path, isDirectory, depth) {
  if (depth > 8) return -1;
  if (!isDirectory) return Fs.remove(path);
  const list = Fs.list(path + '/');
  if (typeof list !== 'number') {
    for (let i = 0; i < list.length; i++) {
      const child = path + '/' + list[i];
      const err = removeTree(child, isDirPath(child), depth + 1);
      if (err !== 0) return err;
    }
  }
  return Fs.remove(path);
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
  lume.ui.shell.Dialog({title:'Delete ' + name + '?', message:name + ' cannot be recovered.',
    buttons:[{label:'Cancel',style:'plain'},
      {label:'Delete',style:'danger',onPress:function () { deleteEntry(name); }}]});
}

function removeSelected() {
  const name = selected();
  if (!name) {
    notify('Select an item or use row DEL');
    return;
  }
  askDelete(name);
}

/* 运行时装不了输入法，NEW 自动挑一个未占用的 folder-N 名字。 */
function makeDir() {
  for (let i = 1; i < 100; i++) {
    const candidate = 'folder-' + i;
    if (Fs.exists(cwd() + candidate) !== true) {
      const err = Fs.mkdir(cwd() + candidate);
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
  lume.setAttr(previewPanel, 5, 0);   /* ATTR_VISIBLE = 5 */
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
  const text = Fs.read(cwd() + name);
  if (typeof text === 'number') {
    notify('Read failed ' + text);
    return;
  }
  /* 46 字符/行、8 行：预览面板一屏放得下，超长行用 longMode dots 省略。 */
  const raw = String(text).replace(/\r/g, '').split('\n');
  const lines = [];
  for (let i = 0; i < raw.length && lines.length < PREVIEW_ROWS; i++) {
    lines.push(raw[i].slice(0, 46));
  }
  preview.set({ name: name, lines: lines });
  lume.setAttr(previewPanel, 5, 1);
}

/* ============ UI ============ */
const root = View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: GUTTER
}}, [
  /* 顶栏：返回 + 路径 + 项数/挂载状态 */
  View({ style: {
    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
    width: '100%', height: 56,
    background: 'surface', borderRadius: 12,
    paddingLeft: 12, paddingRight: 12, scroll: 'none'
  }}, [
    Button({
      title: '<',
      style: { width: 56, height: 56, borderRadius: 12, background:'surfaceAlt' },
      onPress: goUp,
    }),
    Text({ text: function () { return 'Files / ' + trim(cwd(), 18); },
      style: { flexGrow: 1, textAlign: 'center', longMode: 'dots' } }),
    Text({ text: itemsLabel,
      style: { width: 80, textAlign: 'right', fontSize: 12, longMode: 'dots' } }),
  ]),

  /* 文件列表（固定高度，窗口化渲染） */
  List({
    items: entries, itemHeight: ROW_H,
    style: { width: '100%', height: LIST_H, background: 'surface', borderRadius: 12,
             scrollbar: 'off' },
    renderItem: function (e, index) { return Row({
      style: {
        alignItems: 'center', gap: 8, width: '100%', height: ROW_H,
        paddingLeft: 12, paddingRight: 12, borderRadius: 8,
        background: function () {
          return selected() === e.name ? 'surfaceAlt' : (index % 2 ? 'surfaceAlt' : 'surface');
        },
        scroll: 'none'
      },
      onPress: function () { openEntry(e); },
    }, [
      View({style:{width:4,height:32,background:function(){return selected()===e.name?'accent':'surface';},borderRadius:8}}),
      Text({ text: e.isDir ? 'DIR' : 'FILE',
        style: { width: 44, fontSize: 12, longMode: 'dots' } }),
      /* flexGrow 吃掉剩余宽度：文件名靠左，DEL 按钮被推到行尾。 */
      Text({ text: trim(e.name, 40),
        style: { flexGrow: 1, textAlign: 'left', longMode: 'dots' } }),
      Button({
        title: 'DEL',
        style: { width: 56, height: 56, borderRadius: 8, background:'danger' },
        onPress: function () { askDelete(e.name); },
      }),
    ]); },
  }),

  /* 底部操作行：新建 / 预览 / 删除选中项 */
  View({ style: {
    display: 'flex', flexDirection: 'row', gap: 8,
    width: '100%', height: 56
  }}, [
    Button({ title: 'NEW', style: { flexGrow: 1, height: 56, borderRadius: 12,
             background:'surface', borderWidth: 1, borderColor: 'surfaceAlt' },
             onPress: makeDir }),
    Button({ title: 'VIEW', style: { flexGrow: 1, height: 56, borderRadius: 12,
             background:'surface', borderWidth: 1, borderColor: 'surfaceAlt' },
             onPress: previewSelected }),
    Button({ title: 'DEL', style: { flexGrow: 1, height: 56, borderRadius: 12, background:'accent' },
             onPress: removeSelected }),
  ]),
]);

Text({text:function(){return entries().length?'':'[ ]';},style:{x:200,y:196,width:80,fontSize:32,textAlign:'center'}});
Text({text:function(){return entries().length?'':'No files in this folder';},style:{x:GUTTER,y:244,width:480 - GUTTER * 2,fontSize:13,textAlign:'center'}});

/* 预览面板：整屏覆盖，点任意处关闭（创建后隐藏，VIEW 切换 ATTR_VISIBLE）。 */
const previewPanel = View({
  visible: false,
  style: { x: 0, y: 0, width: 480, height: 480, background: 'primary', scroll: 'none' },
  onPress: closePreview,
});
Text({ parent: previewPanel,
  text: function () { const p = preview(); return p ? trim(p.name, 46) : ''; },
  style: { x: GUTTER, y: 64, width: 480 - GUTTER * 2, height: 32,
    fontSize: 20, textAlign: 'center', longMode: 'dots' } });
for (let i = 0; i < PREVIEW_ROWS; i++) {
  Text({ parent: previewPanel,
    text: function () { const p = preview(); return p && p.lines[i] ? p.lines[i] : ''; },
    style: { x: GUTTER, y: 116 + i * 34, width: 480 - GUTTER * 2, height: 30,
      fontSize: 14, longMode: 'dots' } });
}
Text({ parent: previewPanel, text: 'tap anywhere to close',
  style: { x: GUTTER, y: 432, width: 480 - GUTTER * 2, height: 24,
    fontSize: 12, textAlign: 'center' } });

/* 下滑 = 返回上级（全局 node 0 监听，与 swipe-up 回桌面互不冲突）。 */
lume.gesture.on(0, 'swipe', function (e) {
  if (e.dir !== 'down') return;
  if (preview() !== null) closePreview();
  else goUp();
});

/* BACK 键：先关预览，再逐级上移，根目录放行给系统。 */
lume.app.onBack(function () {
  if (preview() !== null) { closePreview(); return true; }
  if (cwd() === '/') return false;
  goUp();
  return true;
});

/* ============ 生命周期 ============ */
lume.app.onResume(function () { loadDir(cwd()); });   // 回前台重读目录

/* 开发验证：在控制台调用 seedTestEntries()，用 1000 条模拟目录测试滚动。
 * 不写 TF 卡；重新 loadDir(cwd()) 即可恢复真实目录。 */
function seedTestEntries() {
  const test = [];
  for (let i = 0; i < 1000; i++) test.push({name: 'dir-' + i, isDir: true});
  entries.set(test);
}

loadDir('/');
