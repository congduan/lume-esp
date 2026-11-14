/**
 * 示例：文件管理器（files app）
 *
 * Fs 目录浏览 + signals 列表渲染 + flex 相对布局 + 生命周期。
 * 布局为相对布局：根容器 flex column + padding 40（圆角屏安全区），
 * 列表高度固定，其余行高固定，间距由布局分配。
 * 删除为两段式确认 + 递归（POSIX remove() 对非空目录会失败）。
 */
lume.theme.set({ colors: { primary: '#0B1724', surface: '#132436', text: '#FFFFFF' }, radius: 10 });

/* ============ 状态 ============ */
const cwd = signal('/');
const entries = signal([]);
const selected = signal(null);
const status = signal('');
const pendingDelete = signal(null);   // 待二次确认的条目名

/* ============ 数据层 ============ */
function isDirPath(p) {
  return Fs.exists(p + '/') === true;   // 目录以 / 结尾探测
}

function loadDir(path) {
  const clean = path.replace(/\/+$/, '') || '/';   // LittleFS rejects trailing '/'
  const list = Fs.list(clean);
  if (typeof list === 'number') {
    status.set('read failed: ' + list);
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
  pendingDelete.set(null);
  status.set(list.length + ' items');
}

function openEntry(name) {
  const path = cwd() + name;
  if (isDirPath(path)) {
    selected.set(null);
    loadDir(path + '/');
    return;
  }
  selected.set(name);
  status.set(name + ' selected');
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
    status.set('select an item first');
    return;
  }
  const err = removeTree(cwd() + name, isDirPath(cwd() + name), 0);
  pendingDelete.set(null);
  status.set(err === 0 ? 'deleted ' + name : 'delete failed ' + err);
  loadDir(cwd());
}

function askDelete(name) {
  if (pendingDelete() === name) {
    deleteEntry(name);
    return;
  }
  pendingDelete.set(name);
  status.set('press DEL again to delete ' + name);
}

function removeSelected() {
  const name = selected();
  if (!name) {
    status.set('select an item, or use the row DEL');
    return;
  }
  askDelete(name);
}

/* ============ UI ============ */
View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 40
}}, [
  /* 顶栏：返回 + 路径 + 占位 */
  View({ style: {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', width: '100%', height: 44,
    background: 'surface', borderRadius: 10,
    paddingLeft: 10, paddingRight: 10, scroll: 'none'
  }}, [
    Button({
      title: '<',
      style: { width: 44, height: 30, borderRadius: 8 },
      onPress: function () {
        if (cwd() !== '/') loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
      },
    }),
    Text({ text: function () { return cwd(); }, style: {} }),
    View({ style: { width: 44, height: 30 } }),           // 占位保持路径居中
  ]),

  /* 文件列表（固定高度，窗口化渲染） */
  List({
    items: entries, itemHeight: 42,
    style: { width: '100%', height: 260, background: 'surface', borderRadius: 10,
             scrollbar: 'off' },
    renderItem: function (e) { return View({
      style: {
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
        width: '100%', height: 42, paddingLeft: 10, borderRadius: 8,
        background: function () {
          return selected() === e.name ? '#2A4A7A' : '#101828';
        },
        scroll: 'none'
      },
      onPress: function () { openEntry(e.name); },
    }, [
      Text({ text: e.isDir ? '[DIR]' : '[FILE]' }),
      Text({ text: e.name }),
      Button({
        title: function () { return pendingDelete() === e.name ? 'SURE' : 'DEL'; },
        style: { width: 56, height: 28, borderRadius: 7 },
        onPress: function () { askDelete(e.name); },
      }),
    ]); },
  }),

  /* 底部操作行 */
  View({ style: {
    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
    width: '100%', height: 44
  }}, [
    Button({ title: 'del selected', style: { width: 130, height: 40, borderRadius: 10 },
             onPress: removeSelected }),
    Text({ text: function () { return status(); }, style: { flexGrow: 1 } }),
  ]),
]);

/* ============ 生命周期 ============ */
lume.app.onResume(function () { loadDir(cwd()); });   // 回前台重读目录

/* 开发验证：在控制台调用 seedTestEntries()，用 1000 条模拟目录测试滚动。
 * 不写 TF 卡；重新 loadDir(cwd()) 即可恢复真实目录。 */
function seedTestEntries() {
  var test = [];
  for (var i = 0; i < 1000; i++) test.push({name: 'dir-' + i, isDir: true});
  entries.set(test);
  status.set('1000 test directories');
}

loadDir('/');
