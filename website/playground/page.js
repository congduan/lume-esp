/* Static app picker and in-process input loop for the Lume playground. */
(() => {
  const examples = [
    ['counter','＋','Counter','计数器','Tap-driven counter','点击计数','square'],
    ['clock','◷','Clock','时钟','Time and alarms','时间与闹钟','round'],
    ['clock_round','12','Round clock','圆屏时钟','Round analog clock','圆屏模拟表盘','round'],
    ['dashboard_round','N','Round dashboard','圆屏仪表','Relative heading and level','相对方位和水平仪','round'],
    ['games_snake','▦','Snake','贪吃蛇','Swipe to steer','滑动控制方向','square'],
    ['games_2048','▣','2048','2048','Merge the tiles','合并方块','square'],
    ['games_breakout','◉','Breakout','打砖块','Arcade paddle game','街机挡板游戏','square'],
    ['mario','★','Mario','马里奥','Platform demo','平台游戏演示','square'],
    ['calculator','＝','Calculator','计算器','Everyday arithmetic','日常运算','square'],
    ['weather','☁','Weather','天气','Forecast with sample data','模拟天气数据','round'],
    ['music_player','♫','Music player','音乐播放器','Playback with sample tracks','模拟曲目播放','round'],
    ['storybook','★','StoryBook','儿童绘本','Three-page sample story or TF story pack','三页示例故事或 TF 故事包','square'],
    ['ipod_music','◉','Wheel Music','转盘音乐','ClickWheel UI demo, no audio','转盘界面演示，无音频','round'],
    ['dashboard','▥','Dashboard','仪表盘','Live-style gauges','动态仪表','round'],
    ['gravity_ball','●','Gravity ball','重力球','Motion experiment','运动实验','square'],
    ['typewriter','⌨','Typewriter','打字机','Animated text','文字动画','square'],
    ['heart_curve','♥','Heart curve','心形曲线','Canvas drawing','画布绘图','round'],
    ['speedometer','⌁','Speedometer','速度表','Motion display','运动显示','round'],
    ['power_demo','⚡','Power demo','电源演示','Power state UI','电源状态界面','square'],
    ['watchface','◴','Watchface','表盘','Five faces','五种表盘','round'],
    ['games_tetris','▚','Tetris','俄罗斯方块','Pan, rotate, drop','拖动旋转降落','square'],
    ['game_of_life','◦','Game of Life','生命游戏','Cellular automata','细胞自动机','round'],
    ['pet','ᵔ','Desktop pet','桌面宠物','Feed and pet it','喂养与抚摸','square'],
    ['async_demo','↻','Async demo','异步演示','async / await','异步Await','square'],
    ['piano','♬','Piano','钢琴','Two-octave touch piano','双八度触屏钢琴','square'],
    ['compass','⊙','Heading dial','方位仪表','Inertial heading, no magnetometer','惯性方位，无磁力计','round'],
    ['skyfire','✈','Skyfire','打飞机','Vertical shooter','纵向弹幕射击','square'],
    ['skycombat','3D','SkyCombat 3D','体感空战','Tilt and fire in 3D','倾斜瞄准，点击开火','square'],
    ['luna','◐','Luna','月球','Explore the real lunar surface','浏览真实月面','round'],
    ['invaders','▴','Invaders','太空侵略者','Arcade-style shooter','街机风格射击','square'],
    ['frogger','✦','Frogger','过河青蛙','Road and river crossing','公路河道穿越','square'],
    ['abc123','A','ABC 123','字母数字卡','Tap-to-learn alphabet cards','点击学习字母数字','square'],
    ['sokoban','▣','Sokoban','推箱子','10 puzzles, swipe to push','十关推箱子','square'],
    ['lcd_dual','◫','LCD dual','双屏 LCD','Segment-LCD catch & dodge','幽灵段接面包与闪避','round'],
    ['memory','▸','Memory Match','记忆翻牌','4x4 pair-matching card game','4x4 配对翻牌','square'],
    ['minesweeper','✸','Minesweeper','扫雷','10x10 grid, tap dig + long-press flag','10x10 扫雷：点开 + 长按插旗','square'],
    ['golf','◉','Golf','迷你高尔夫','Swing golf, 10 procedural holes','体感挥杆，10 个程序化球洞','round'],
    ['scroller','▤','Scroller','横向卷轴','Retained-sprite side scroller','精灵 blit 横向卷轴','square'],
    ['raycast','◈','Raycast 3D','射线迷宫','Raycast maze shooter','第一人称射线迷宫射击','square'],
    ['fishtank','◉','Fishtank','电子鱼缸','Procedural aquarium with feeding','程序化鱼群 + 投喂互动','square'],
    ['particles','o','Fluid Particles','流体粒子','IMU gravity + touch velocity field','IMU 重力 + 触摸速度场','square'],
    ['plasma','◉','Plasma','等离子屏保','Tilt the lava; tap to change theme','倾斜熔岩，点击切换主题','round'],
    ['voice_assistant','◎','Voice Assistant','语音助手','Push-to-talk walkie-talkie demo','按住说话对讲机演示','square'],
    ['spectrum_music','♫','Spectrum Music','频谱音乐盒','Radial live and demo spectrum','麦克风与演示径向频谱','round'],
    ['ble_uart','B','BLE UART','蓝牙串口','BLE link lifecycle with stub radio','模拟蓝牙连接流程','square'],
    ['spectrum','▥','Spectrum','音频频谱','Microphone spectrum with browser stub','模拟麦克风频谱','round'],
    ['svg_icon','◇','SVG icon','SVG 图标','Vector icon rendering','矢量图标渲染','square'],
    ['gestures','↗','Gestures','手势','Tap, swipe, hold and pan','点击、滑动、长按与拖动','square'],
    ['aurora_clock','o','Aurora Clock','极光时钟','Flowing ribbons and time','流动极光与时间','round'],
    ['flapdot','b','Flapdot','拍拍鸟','One-tap arcade flyer','一键街机飞行','square'],
    ['wordring','WR','Word Ring','字母环','Tap-only 5-letter word game','点选字母的 5 字母猜词','round'],
    ['image_gallery','IM','Image Gallery','图片画廊','TF-card photos with Fs fallback','TF 卡图片，回退到 Fs','round'],
    ['files','FS','File Manager','文件管理器','Browse directories and preview text','浏览目录并预览文本','round'],
    ['adc_meter','AD','ADC Meter','电压表','ADC1 pin and attenuation voltage readout','ADC1 引脚与衰减档位电压读数','round'],
    ['crypto_check','CR','Crypto Check','加密校验','SHA-256, HMAC, CRC32 and AES loopback','SHA-256、HMAC、CRC32 与 AES 回环','round'],
    ['archive_view','AR','Archive Viewer','压缩包查看','DEFLATE inflate of embedded payloads','内置 DEFLATE 数据解压展示','round'],
    ['img_view','SC','Image Scaler','图像缩放','RGB565 nearest / bilinear zoom demo','RGB565 最近邻与双线性缩放','round'],
    ['vec_demo','V2','Vector Physics','向量物理','lume.math integrate and dot particles','lume.math 积分与点积粒子','round'],
    ['settings','ST','Settings','系统设置','WiFi, BLE, volume and power settings','WiFi、蓝牙、音量与电源设置','round'],
    ['hr_monitor','HR','HR Monitor','心率广播','BLE peripheral streams simulated heart rate','BLE 外设广播模拟心率','round'],
    ['keyboard_demo','KB','Keyboard Demo','键盘演示','QWERTY soft keyboard input demo','QWERTY 软键盘输入演示','square'],
    ['wordle','WD','Wordle','猜词游戏','Five letters, six tries, on-screen keyboard','5 字母 6 次机会的屏幕键盘猜词','square'],
    ['controls_demo','UI','Controls Demo','控件演示','Switch, Slider and Progress shell controls','开关、滑块与进度条控件','round'],
    ['timer_kit','TM','Timer Kit','计时工具','Countdown and stopwatch via shell controls','基于 shell 控件的倒计时与秒表','round'],
    ['control_center','CC','Control Center','控制中心','Quick settings cards in a safe area','安全区内的快捷设置卡片','round'],
    ['launcher_grid','LG','Launcher Grid','应用宫格','3x3 app grid built with shell.Launcher','shell.Launcher 的 3x3 应用宫格','round'],
    ['minigolf','GF','Mini Golf','迷你高尔夫','Drag or IMU swing putting demo','拖拽或体感挥杆推杆演示','round'],
    ['color_demo','CL','Color Studio','调色台','ColorPicker tint saved to KV','ColorPicker 调色并存入 KV','round'],
    ['mochi','MC','Mochi','吉祥物','Programmatic Canvas mascot expressions','Canvas 绘制的吉祥物表情演示','square'],
    ['shell_demo','SB','Shell Demo','外壳组件','StatusBar and EdgeNavigation demo','状态栏与边缘导航演示','round'],
    ['sparkline_demo','SP','Sparkline','迷你折线图','Canvas mini line charts with shell.Sparkline','shell.Sparkline 迷你折线图','square'],
    ['app_manager','AM','App Manager','应用管理','Two-tap uninstall from the installed app list via browser stub','浏览器桩应用列表：双击确认卸载','square'],
    ['imu_poll','IM','IMU Poll','惯性采样','Poll raw X/Y/Z axes at 1 Hz; browser stub reports unavailable','1 Hz 轮询 X/Y/Z 原始轴；浏览器桩显示不可用','square'],
    ['fitness','◎','Fitness','运动环','Triple activity rings with IMU step estimation and simulated HR','三环运动仪表：IMU 计步近似与模拟心率','round']
  ];
  // r169: LUME_SOURCES is the authoritative catalog; `examples` holds display
  // metadata only (7-tuple: id, icon, en, zh, descEn, descZh, shape). Both the
  // picker and the editor dropdown derive from the catalog, so the rendered
  // list can no longer drift from the manifest.
  function catalogNames() {
    const names = examples.map(entry => entry[0]).filter(name => Object.hasOwn(LUME_SOURCES, name));
    const seen = new Set(names);
    for (const name of Object.keys(LUME_SOURCES)) {
      if (!seen.has(name)) { names.push(name); seen.add(name); }
    }
    return names;
  }
  function meta(name) {
    return examples.find(entry => entry[0] === name) || [name, '?', name, name, name, name, 'square'];
  }
  const device = document.querySelector('#device');
  const wrap = document.querySelector('.device-wrap');
  const shapeButtons = [...document.querySelectorAll('[data-screen-shape]')];
  const safeToggle = document.querySelector('#safe-area-toggle');
  // r229: round mode now injects a native 466x466 __lumeScreen (r227 migrated
  // all 29 apps that cannot run at 466); square mode keeps 480x480. This is the
  // single screen state read by resize(), dispatch() and startScript().
  let logicalScreen = { w: 480, h: 480 };
  let savedShape = 'square';
  try { savedShape = localStorage.getItem('lume-screen-shape') === 'round' ? 'round' : 'square'; } catch (error) { /* storage disabled */ }
  let currentShape = savedShape;
  function appShape(name) {
    const entry = examples.find(item => item[0] === name);
    const s = entry && entry[6];
    if (s === 'round' || s === 'square') return s;
    return savedShape || 'square';
  }
  function setShape(shape, opts = {}) {
    const next = shape === 'round' ? 'round' : 'square';
    const changed = next !== currentShape;
    currentShape = next;
    const round = next === 'round';
    logicalScreen = round ? { w: 466, h: 466 } : { w: 480, h: 480 };
    wrap.classList.toggle('round', round);
    shapeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.screenShape === next)));
    device.setAttribute('aria-label', round ? 'Lume round screen' : 'Lume rounded square screen');
    if (safeToggle) {
      safeToggle.hidden = !round;
      if (!round) {
        wrap.classList.remove('show-safe');
        safeToggle.setAttribute('aria-pressed', 'false');
      }
    }
    if (opts.persist) {
      savedShape = next;
      try { localStorage.setItem('lume-screen-shape', next); } catch (error) { /* storage disabled */ }
    }
    resize();
    if (opts.restart && changed && session) {
      if (mode === 'editor') runEditor();
      else if (Object.hasOwn(LUME_APPS, current)) startScript(LUME_APPS[current]);
    }
  }
  shapeButtons.forEach(button => button.addEventListener('click', () => setShape(button.dataset.screenShape, { persist: true, restart: true })));
  if (safeToggle) {
    safeToggle.addEventListener('click', () => {
      const on = !wrap.classList.contains('show-safe');
      wrap.classList.toggle('show-safe', on);
      safeToggle.setAttribute('aria-pressed', String(on));
    });
  }
  const list = document.querySelector('#app-list');
  const errorBox = document.querySelector('#error');
  const title = document.querySelector('#app-title');
  const renderer = new LumeRenderer(device, event => {
    try {
      if (event.type === 'press') session?.press(event.id);
      if (event.type === 'scroll') session?.scroll(event.id, event.y);
    } catch (error) { showError(error); }
  });
  let session = null, current = 'counter', generation = 0, mode = 'examples';
  const sourceCode = document.querySelector('#source-code');
  const sourcePicker = document.querySelector('#source-picker');
  const editorPanel = document.querySelector('#editor-panel');
  const examplesPanel = document.querySelector('#examples-panel');
  const firmwarePanel = document.querySelector('#firmware-panel');
  let esbuildReady;
  const shareStatus = document.querySelector('#share-status');
  const maxHashLength = 8192;
  function status(en, zh) { shareStatus.textContent = document.documentElement.lang === 'zh' ? zh : en; }
  async function encodeSource(source) {
    if (typeof CompressionStream !== 'function') return '#code0=' + encodeURIComponent(source);
    const stream = new Blob([new TextEncoder().encode(source)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return '#code=' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  async function decodeSource(hash) {
    if (hash.startsWith('#code0=')) return decodeURIComponent(hash.slice(7));
    if (!hash.startsWith('#code=')) return null;
    if (typeof DecompressionStream !== 'function') throw Error('This browser cannot open compressed share links');
    const encoded = hash.slice(6).replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  async function updateHash(source) {
    const hash = await encodeSource(source);
    if (hash.length > maxHashLength) { status('Source too large; share link unavailable.', '源码过大，分享链接不可用。'); return false; }
    history.replaceState(null, '', location.pathname + location.search + hash);
    shareStatus.textContent = '';
    return true;
  }
  function setMode(next) {
    mode = next;
    editorPanel.hidden = next !== 'editor'; examplesPanel.hidden = next !== 'examples';
    firmwarePanel.hidden = next !== 'firmware';
    document.querySelector('#editor-tab').setAttribute('aria-selected', String(next === 'editor'));
    document.querySelector('#firmware-tab').setAttribute('aria-selected', String(next === 'firmware'));
    document.querySelector('#examples-tab').setAttribute('aria-selected', String(next === 'examples'));
    if (next === 'firmware') { title.textContent = document.documentElement.lang === 'zh' ? '真机固件' : 'Real firmware'; return; }
    title.textContent = next === 'editor' ? (document.documentElement.lang === 'zh' ? '编辑器预览' : 'Editor preview') : meta(current)[document.documentElement.lang === 'zh' ? 3 : 2];
  }
  const gestures = new Set();
  function showError(error) { errorBox.hidden = false; errorBox.textContent = error?.stack || String(error); }
  function resize() {
    device.style.width = logicalScreen.w + 'px';
    device.style.height = logicalScreen.h + 'px';
    // Native viewport == native canvas in round mode (466 / 466 = 1): this is
    // only a responsive fit factor for narrower viewports, not a 466/480 map.
    device.style.transform = `scale(${wrap.clientWidth / logicalScreen.w})`;
  }
  new ResizeObserver(resize).observe(wrap); setShape(savedShape, { persist: false, restart: false });
  function startScript(script) {
    generation++;
    session?.destroy(); session = null;
    renderer.reset(); gestures.clear();
    errorBox.hidden = true; errorBox.textContent = '';
    const mine = generation;
    try {
      session = LumePlaygroundSession(script, {
        screen: { w: logicalScreen.w, h: logicalScreen.h },
        onMessage: message => {
          if (mine !== generation) return;
          if (message[0] === 'gesture') gestures.add(message[1]);
          if (message[0] === 'remove') gestures.delete(message[1]);
          renderer.apply(message);
        },
        onError: showError,
      });
    } catch (error) { showError(error); }
  }
  function select(name) {
    if (!Object.hasOwn(LUME_APPS, name)) { showError(new Error(`Missing bundle: ${name}`)); return; }
    current = name; setMode('examples');
    setShape(appShape(name), { persist: false, restart: false });
    list.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.dataset.app === name)));
    startScript(LUME_APPS[name]);
  }
  async function runEditor() {
    setMode('editor');
    const source = sourceCode.value;
    try {
      await updateHash(source);
      if (!esbuildReady) esbuildReady = fetch('vendor/esbuild.wasm').then(r => { if (!r.ok) throw Error(`Wasm HTTP ${r.status}`); return r.arrayBuffer(); }).then(bytes => WebAssembly.compile(bytes)).then(wasmModule => esbuild.initialize({ wasmModule, worker: true }));
      await esbuildReady;
      const result = await esbuild.build({ stdin: { contents: source, sourcefile: 'app.js', loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020', logLevel: 'silent' });
      startScript(result.outputFiles[0].text);
    } catch (error) { showError(error); }
  }
  function renderList() {
    const zh = document.documentElement.lang === 'zh';
    list.replaceChildren();
    for (const name of catalogNames()) {
      const [, icon, en, cn, description, descriptionZh] = meta(name);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'app-item'; button.dataset.app = name;
      button.setAttribute('aria-current', String(name === current));
      const symbol = document.createElement('span'); symbol.className = 'app-icon'; symbol.textContent = icon;
      const copy = document.createElement('span');
      const strong = document.createElement('strong'); strong.textContent = zh ? cn : en;
      const small = document.createElement('small'); small.textContent = zh ? descriptionZh : description;
      copy.append(strong, small); button.append(symbol, copy);
      button.addEventListener('click', () => select(name)); list.append(button);
    }
    for (const option of sourcePicker.options) {
      const entry = examples.find(item => item[0] === option.value);
      if (entry) option.textContent = entry[zh ? 3 : 2];
    }
    setMode(mode);
  }
  new MutationObserver(renderList).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  function gestureId(target) {
    let element = target.closest?.('[data-node-id]');
    while (element && device.contains(element)) {
      const id = Number(element.dataset.nodeId);
      if (gestures.has(id)) return id;
      element = element.parentElement;
    }
    return null;
  }
  let pointer = null;
  function dispatch(kind, e) {
    if (!pointer || !session) return;
    const box = wrap.getBoundingClientRect(), scale = box.width / logicalScreen.w;
    const x = (e.clientX - box.left) / scale, y = (e.clientY - box.top) / scale;
    try { session.gesture(pointer.id, kind, x, y, performance.now(), 0, 0); }
    catch (error) { showError(error); }
  }
  device.addEventListener('pointerdown', e => {
    const id = gestureId(e.target);
    if (id == null) return;
    pointer = { id, pointerId: e.pointerId };
    device.setPointerCapture(e.pointerId);
    dispatch(0, e);
  });
  device.addEventListener('pointermove', e => { if (pointer?.pointerId === e.pointerId) dispatch(1, e); });
  device.addEventListener('pointerup', e => { if (pointer?.pointerId === e.pointerId) { dispatch(2, e); pointer = null; } });
  device.addEventListener('pointercancel', e => { if (pointer?.pointerId === e.pointerId) pointer = null; });
  for (const name of catalogNames()) {
    const entry = meta(name);
    const option = document.createElement('option'); option.value = name; option.textContent = document.documentElement.lang === 'zh' ? entry[3] : entry[2]; sourcePicker.append(option);
  }
  sourceCode.value = LUME_SOURCES.counter;
  sourcePicker.addEventListener('change', () => { sourceCode.value = LUME_SOURCES[sourcePicker.value]; });
  document.querySelector('#examples-tab').addEventListener('click', () => select(current));
  document.querySelector('#editor-tab').addEventListener('click', () => setMode('editor'));
  document.querySelector('#firmware-tab').addEventListener('click', () => setMode('firmware'));
  fetch('../wasm/fw/lume.json', { headers: { accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).then(manifest => {
    const note = document.querySelector('#firmware-version');
    const launch = document.querySelector('#firmware-launch');
    if (!manifest) { if (note) note.textContent = document.documentElement.lang === 'zh' ? '固件尚未构建，稍后再来。' : 'Firmware not built yet — check back soon.'; if (launch) launch.setAttribute('aria-disabled', 'true'); return; }
    if (note) note.textContent = (document.documentElement.lang === 'zh' ? '当前固件：' : 'Current firmware: ') + (manifest._note || 'lume');
  }).catch(() => {});
  document.querySelector('#run').addEventListener('click', runEditor);
  document.querySelector('#share').addEventListener('click', async () => {
    try {
      if (!await updateHash(sourceCode.value)) return;
      await navigator.clipboard.writeText(location.href);
      status('Link copied!', '链接已复制！');
    } catch (error) { showError(error); }
  });
  sourceCode.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runEditor(); } });
  document.querySelector('#restart').addEventListener('click', () => mode === 'editor' ? runEditor() : startScript(LUME_APPS[current]));
  renderList(); select(current);
  if (location.hash.startsWith('#code=' ) || location.hash.startsWith('#code0=')) {
    if (location.hash.length > maxHashLength) showError(new Error('Share link is too long'));
    else decodeSource(location.hash).then(source => { sourceCode.value = source; setMode('editor'); setShape(savedShape, { persist: false, restart: false }); return runEditor(); }).catch(showError);
  }
})();
