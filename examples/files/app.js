/**
 * 示例：文件管理器（files app）
 *
 * Fs 目录浏览 + signals 列表渲染 + flex 相对布局 + 生命周期。
 * 布局为相对布局：根容器 flex column + padding 40（圆角屏安全区），
 * 列表高度固定，其余行高固定，间距由布局分配。
 * 删除经 Dialog 确认 + 递归（POSIX remove() 对非空目录会失败）。
 */
import '../../runtime/shell.js';
lume.theme.set({ colors: { bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0' }, radius: 12, spacing:12 });

/* ============ 状态 ============ */
const cwd = signal('/');
const entries = signal([]);
const selected = signal(null);
const status = signal('');

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
    lume.ui.shell.Toast.show('Select an item first');
    return;
  }
  const err = removeTree(cwd() + name, isDirPath(cwd() + name), 0);
  loadDir(cwd());
  if (err === 0) lume.ui.shell.Toast.show('Deleted ' + name);
  else lume.ui.shell.Toast.show('Delete failed ' + err);
}

function askDelete(name) {
  lume.ui.shell.Dialog({title:'Delete ' + name + '?', message:name + ' cannot be recovered.',
    buttons:[{label:'Cancel',style:'plain'},
      {label:'Delete',style:'danger',onPress:function () { deleteEntry(name); }}]});
}

function removeSelected() {
  const name = selected();
  if (!name) {
    lume.ui.shell.Toast.show('Select an item or use row DEL');
    return;
  }
  askDelete(name);
}

/* ============ UI ============ */
View({ style: {
  width: '100%', height: '100%', background: 'primary', scroll: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 24
}}, [
  /* 顶栏：返回 + 路径 + 占位 */
  View({ style: {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', width: '100%', height: 56,
    background: 'surface', borderRadius: 12,
    paddingLeft: 12, paddingRight: 12, scroll: 'none'
  }}, [
    Button({
      title: '<',
      style: { width: 56, height: 56, borderRadius: 12, background:'surfaceAlt' },
      onPress: function () {
        if (cwd() !== '/') loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
      },
    }),
    Text({ text: function () { return 'Files / ' + cwd(); }, style: {} }),
    View({ style: { width: 56, height: 56 } }),           // 占位保持路径居中
  ]),

  /* 文件列表（固定高度，窗口化渲染） */
  List({
    items: entries, itemHeight: 56,
    style: { width: '100%', height: 272, background: 'surface', borderRadius: 12,
             scrollbar: 'off' },
    renderItem: function (e) { return View({
      style: {
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
        width: '100%', height: 56, paddingLeft: 12, borderRadius: 8,
        background: function () {
          return selected() === e.name ? 'surfaceAlt' : (entries().indexOf(e) % 2 ? 'surfaceAlt' : 'surface');
        },
        scroll: 'none'
      },
      onPress: function () { openEntry(e.name); },
    }, [
      View({style:{width:4,height:32,background:function(){return selected()===e.name?'accent':'surface';},borderRadius:8}}),
      Text({ text: e.isDir ? '[DIR]' : '[FILE]' }),
      Text({ text: e.name }),
      Button({
        title: 'DEL',
        style: { width: 56, height: 56, borderRadius: 8, background:'danger' },
        onPress: function () { askDelete(e.name); },
      }),
    ]); },
  }),

  /* 底部操作行 */
  View({ style: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    width: '100%', height: 80, padding: 0
  }}, [
    Button({ title: 'del selected', style: { width: '100%', height: 56, borderRadius: 999, background:'accent' },
             onPress: removeSelected }),
    Text({ text: function () { return status(); }, style: { width: '100%', textAlign: 'center' } }),
  ]),
]);

Text({text:function(){return entries().length?'':'[ ]';},style:{x:200,y:180,width:80,fontSize:40,color:'textDim',textAlign:'center'}});
Text({text:function(){return entries().length?'':'No files in this folder';},style:{x:24,y:232,width:432,fontSize:13,color:'textDim',textAlign:'center'}});

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
