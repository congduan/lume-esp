/**
 * 示例：文件管理器（files app）
 *
 * 演示 Lume 全家桶在真实 app 场景的组合：Fs 目录浏览 + signals 列表渲染 +
 * flex 布局 + 生命周期（后台停刷新）+ 主题命名色。
 *
 * 运行环境：TF 卡已挂载（lume.storage.Fs.mounted()）。
 */

/* ============ 状态 ============ */
const cwd = signal('/');            // 当前目录
const entries = signal([]);         // 当前目录条目 [{name, isDir}]
const selected = signal(null);      // 选中的条目名
const status = signal('');          // 底部状态栏文字

/* ============ 数据层 ============ */
function isDirPath(p) {
  return Fs.exists(p + '/') === true;   // 目录以 / 结尾探测
}

function loadDir(path) {
  const list = Fs.list(path);
  if (typeof list === 'number') {       // 负值 = 错误码（-2 IO 等）
    status.set('read failed: ' + list);
    return;
  }
  // 目录排前、名字排后
  list.sort(function (a, b) {
    const da = isDirPath(path + a), db = isDirPath(path + b);
    if (da !== db) return da ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  entries.set(list.map(function (name) {
    return { name: name, isDir: isDirPath(path + name) };
  }));
  cwd.set(path);
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

function removeSelected() {
  const name = selected();
  if (!name) return;
  Fs.remove(cwd() + name);
  selected.set(null);
  loadDir(cwd());                       // signals 重发列表，屏幕自动更新
}

/* ============ UI：顶栏 ============ */
View({ style: {
  display: 'flex', flexDirection: 'row', alignItems: 'center',
  justifyContent: 'space-between', width: '100%', height: 48, padding: 8,
  background: 'primary',                                // 主题命名色，一键换肤
}}, [
  Button({
    title: '<',
    onPress: function () {
      if (cwd() !== '/') loadDir(cwd().replace(/[^/]+\/$/, '') || '/');
    },
  }),
  Text({ text: function () { return cwd(); }, style: { color: 'text' } }),
  View({ style: { width: 40, height: 32 } }),           // 占位保持标题居中
]);

/* ============ UI：文件列表（signal 驱动逐条渲染）============ */
entries().forEach(function (e) {
  View({
    style: {
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
      width: '100%', height: 36, padding: 6, borderRadius: 6,
      background: function () {
        return selected() === e.name ? '#2A4A7A' : '#16233A';
      },
    },
    onPress: function () { openEntry(e.name); },
  }, [
    Text({ text: e.isDir ? '[DIR]' : '[FILE]',
           style: { color: e.isDir ? '#FFD866' : '#9AB4D8' } }),
    Text({ text: e.name, style: { color: 'text' } }),
  ]);
});

/* ============ UI：底部状态栏 ============ */
View({ style: {
  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
  width: '100%', height: 44, padding: 8, background: '#101828',
}}, [
  Button({ title: 'del', onPress: removeSelected }),
  Text({ text: function () { return status(); }, style: { color: '#8899AA' } }),
]);

/* ============ 生命周期：后台停刷新 ============ */
lume.app.onPause(function () { status.set('paused'); });
lume.app.onResume(function () { loadDir(cwd()); });   // 回前台重读目录

loadDir('/');
