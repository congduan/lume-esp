/** Watch launcher: shell composition over the on-device app store. */
import '../../runtime/shell.js';

/* Real apps come from LittleFS through lume.apps.entries(). The static list is
 * only a preview fallback for the simulator / a device with nothing installed;
 * tapping an entry calls lume.apps.launch(id), which switches the single live
 * app (this launcher context is destroyed by that switch). */
const PREVIEW = [
  { id: 'clock', label: '时钟', color: '#1E88E5', icon: 'T' },
  { id: 'weather', label: '天气', color: '#43A047', icon: 'W' },
  { id: 'music', label: '音乐', color: '#8E24AA', icon: 'M' },
  { id: 'heart', label: '心率', color: '#E53935', icon: 'H' },
  { id: 'files', label: '文件', color: '#F4511E', icon: 'F' },
  { id: 'fitness', label: '健身', color: '#00897B', icon: 'R' },
  { id: 'alarms', label: '闹钟', color: '#6D4C41', icon: 'A' },
  { id: 'maps', label: '地图', color: '#3949AB', icon: 'P' },
  { id: 'notes', label: '笔记', color: '#FFB300', icon: 'N' },
  { id: 'radio', label: '收音机', color: '#00ACC1', icon: 'O' },
  { id: 'torch', label: '手电', color: '#546E7A', icon: 'L' },
  { id: 'calc', label: '计算器', color: '#7CB342', icon: 'C' },
  { id: 'games_2048', label: '2048', color: '#EDC850', icon: '2' },
  { id: 'games_snake', label: '贪吃蛇', color: '#57E49B', icon: 'S' },
  { id: 'games_breakout', label: '打砖块', color: '#63B8F0', icon: 'B' },
];

const installed = lume.apps.entries();

lume.ui.shell.Launcher({
  apps: installed.length ? installed : PREVIEW,
  columns: 3,
  title: 'Lume',
  statusBar: true,
});
