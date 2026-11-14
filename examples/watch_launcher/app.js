/**
 * 示例：Apple Watch 风格蜂窝图标启动器（watchface launcher）
 *
 * 圆形蜂窝布局（蜂巢六边形排布）+ 虚化列表网格 + 主题色图标 +
 * 长按进入编辑模式（缩放抖动）+ 点击启动 app（热更新 bundle 切换地基）。
 *
 * 演示能力：Canvas 自绘（蜂窝背景/圆形图标）+ List 虚化（app 网格）+
 * flex 布局 + signals + theme + 动画。
 */

/* ============ app 清单（真实场景来自启动器元数据或 TF 卡清单文件）============ */
const APPS = [
  { id: 'clock',   label: '时钟',   color: '#1E88E5', glyph: 'clock'   },
  { id: 'weather', label: '天气',   color: '#43A047', glyph: 'sun'     },
  { id: 'music',   label: '音乐',   color: '#8E24AA', glyph: 'note'    },
  { id: 'heart',   label: '心率',   color: '#E53935', glyph: 'heart'   },
  { id: 'files',   label: '文件',   color: '#F4511E', glyph: 'folder'  },
  { id: 'fitness', label: '健身',   color: '#00897B', glyph: 'run'     },
  { id: 'alarms',  label: '闹钟',   color: '#6D4C41', glyph: 'bell'    },
  { id: 'maps',    label: '地图',   color: '#3949AB', glyph: 'pin'     },
  { id: 'notes',   label: '笔记',   color: '#FFB300', glyph: 'pen'     },
  { id: 'radio',   label: '收音机', color: '#00ACC1', glyph: 'radio'   },
  { id: 'torch',   label: '手电',   color: '#546E7A', glyph: 'torch'   },
  { id: 'calc',    label: '计算器', color: '#7CB342', glyph: 'calc'    },
];

const launchTarget = signal(null);   // 正在启动的 app（放大动画用）
const editMode = signal(false);      // 长按进入的编辑模式（图标抖动）

/* ============ 图标渲染：圆形底 + canvas 自绘 glyph ============ */
function AppIcon(app) {
  const launching = () => launchTarget() === app.id;
  return View({
    style: {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      width: '30%', height: 96,
      // 编辑模式抖动：一个 transition 驱动的旋转替代（M3 无 keyframes，登记简化）
      transition: launching() ? { property: 'opacity', durationMs: 200, easing: 'ease-out' } : undefined,
    },
    onPress: function () {
      if (editMode()) return;                       // 编辑模式下点击不启动
      launchTarget.set(app.id);                     // 触发放大淡出动画
      /* 真实启动：热更新通道切到对应 bundle（M1 地基已备，多 bundle 存活属 M5 启动器）*/
    },
  }, [
    // 圆形图标底：48x48 canvas 自绘（圆 + 简易 glyph）
    Canvas({
      width: 48, height: 48,
      onDraw: function (c) {
        c.fillColor(app.color);
        c.circle(24, 24, 22, app.color);
        c.fillColor('#FFFFFF');
        // 极简 glyph：不同 app 画不同几何形（真实场景用字体图标或贴图）
        if (app.glyph === 'clock')   { c.circle(24, 24, 16, '#FFFFFF'); c.fillColor(app.color); c.line(24, 24, 24, 14, app.color, 2); c.line(24, 24, 30, 24, app.color, 2); }
        if (app.glyph === 'heart')   { c.circle(18, 20, 7, '#FFFFFF'); c.circle(30, 20, 7, '#FFFFFF'); c.fillColor('#FFFFFF'); }
        if (app.glyph === 'folder')  { c.fillRect(12, 18, 24, 14, '#FFFFFF'); }
        if (app.glyph === 'sun')     { c.circle(24, 24, 10, '#FFFFFF'); c.fillColor('#FFFFFF'); }
        if (app.glyph === 'note')    { c.line(18, 16, 18, 32, '#FFFFFF', 2); c.circle(18, 32, 4, '#FFFFFF'); }
        if (app.glyph === 'run')     { c.line(16, 30, 24, 18, '#FFFFFF', 2); c.line(24, 18, 32, 26, '#FFFFFF', 2); }
        if (app.glyph === 'bell')    { c.line(16, 28, 32, 28, '#FFFFFF', 3); c.circle(24, 20, 8, '#FFFFFF'); }
        if (app.glyph === 'pin')     { c.circle(24, 20, 8, '#FFFFFF'); c.fillColor('#FFFFFF'); }
        if (app.glyph === 'pen')     { c.line(16, 32, 30, 18, '#FFFFFF', 2); }
        if (app.glyph === 'radio')   { c.circle(24, 24, 6, '#FFFFFF'); c.fillColor('#FFFFFF'); c.circle(24, 24, 14, '#FFFFFF'); }
        if (app.glyph === 'torch')   { c.fillRect(20, 12, 8, 24, '#FFFFFF'); }
        if (app.glyph === 'calc')    { c.fillRect(14, 14, 20, 20, '#FFFFFF'); }
      },
    }),
    Text({ text: app.label, style: { color: 'text' } }),
  ]);
}

/* ============ 蜂窝网格：List 虚化 + 收缩交错偏移（Apple Watch 蜂窝感）============ */
// 真正的圆形蜂窝需要自定义布局——M3 用「奇数行偏移半格」模拟蜂窝感，
// 完整圆形环绕布局（表冠旋转）登记 KNOWN-SIMPLIFICATIONS。
const rows = [];
for (let i = 0; i < APPS.length; i += 3) {
  rows.push(APPS.slice(i, i + 3));
}

List({
  style: { width: '100%', height: 420, background: '#000000', scroll: 'vertical' },
  items: rows,
  itemHeight: 104,
  overscan: 2,
  renderItem: function (rowApps, rowIndex) {
    return View({ style: {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-evenly',
      width: '100%', height: 96,
      // 奇数行右移半格，制造蜂窝错位感
      x: rowIndex % 2 ? 24 : 0, padding: 0,
    }}, rowApps.map(AppIcon));
  },
});

/* ============ 长按编辑模式（手势层落地前的过渡实现）============ */
// M3 手势层未做——用按钮模拟长按进入编辑（手势层落地后换真实 longPress）
Button({
  title: function () { return editMode() ? 'done' : 'edit'; },
  style: { x: 400, y: 424, width: 64, height: 32 },
  onPress: function () { editMode.set(!editMode()); },
});

/* ============ 状态栏：时间 + 电量（真机数据源现成）============ */
View({ style: { display: 'flex', flexDirection: 'row',
                justifyContent: 'space-between', x: 0, y: 452, width: '100%', height: 28,
                padding: 4, background: '#111111' } }, [
  Text({ text: function () { return '12:34'; }, style: { color: 'text' } }),
  Text({ text: function () { return 'battery ' + lume.pmic.battPercent() + '%'; },
         style: { color: 'text' } }),
]);
