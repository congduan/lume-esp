/* Static app picker and in-process input loop for the Lume playground. */
(() => {
  const examples = [
    ['counter','＋','Counter','计数器','Tap-driven counter','点击计数'],
    ['clock','◷','Clock','时钟','Time and alarms','时间与闹钟'],
    ['games_snake','▦','Snake','贪吃蛇','Swipe to steer','滑动控制方向'],
    ['games_2048','▣','2048','2048','Merge the tiles','合并方块'],
    ['games_breakout','◉','Breakout','打砖块','Arcade paddle game','街机挡板游戏'],
    ['mario','★','Mario','马里奥','Platform demo','平台游戏演示'],
    ['calculator','＝','Calculator','计算器','Everyday arithmetic','日常运算'],
    ['weather','☁','Weather','天气','Forecast with sample data','模拟天气数据'],
    ['music_player','♫','Music player','音乐播放器','Playback with sample tracks','模拟曲目播放'],
    ['dashboard','▥','Dashboard','仪表盘','Live-style gauges','动态仪表'],
    ['gravity_ball','●','Gravity ball','重力球','Motion experiment','运动实验'],
    ['typewriter','⌨','Typewriter','打字机','Animated text','文字动画'],
    ['heart_curve','♥','Heart curve','心形曲线','Canvas drawing','画布绘图'],
    ['speedometer','⌁','Speedometer','速度表','Motion display','运动显示'],
    ['power_demo','⚡','Power demo','电源演示','Power state UI','电源状态界面'],
    ['watchface','◴','Watchface','表盘','Five faces','五种表盘'],
    ['games_tetris','▚','Tetris','俄罗斯方块','Pan, rotate, drop','拖动旋转降落'],
    ['game_of_life','◦','Game of Life','生命游戏','Cellular automata','细胞自动机'],
    ['pet','ᵔ','Desktop pet','桌面宠物','Feed and pet it','喂养与抚摸'],
    ['async_demo','↻','Async demo','异步演示','async / await','异步Await'],
  ];
  const device = document.querySelector('#device');
  const wrap = document.querySelector('.device-wrap');
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
    document.querySelector('#editor-tab').setAttribute('aria-selected', String(next === 'editor'));
    document.querySelector('#examples-tab').setAttribute('aria-selected', String(next === 'examples'));
    title.textContent = next === 'editor' ? (document.documentElement.lang === 'zh' ? '编辑器预览' : 'Editor preview') : (examples.find(entry => entry[0] === current)?.[document.documentElement.lang === 'zh' ? 3 : 2] || current);
  }
  const gestures = new Set();
  function showError(error) { errorBox.hidden = false; errorBox.textContent = error?.stack || String(error); }
  function resize() { device.style.transform = `scale(${wrap.clientWidth / 480})`; }
  new ResizeObserver(resize).observe(wrap); resize();
  function startScript(script) {
    generation++;
    session?.destroy(); session = null;
    renderer.reset(); gestures.clear();
    errorBox.hidden = true; errorBox.textContent = '';
    const mine = generation;
    try {
      session = LumePlaygroundSession(script, {
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
    for (const [name, icon, en, cn, description, descriptionZh] of examples) {
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
    const box = wrap.getBoundingClientRect(), scale = box.width / 480;
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
  for (const [name, , en, zh] of examples) {
    const option = document.createElement('option'); option.value = name; option.textContent = document.documentElement.lang === 'zh' ? zh : en; sourcePicker.append(option);
  }
  sourceCode.value = LUME_SOURCES.counter;
  sourcePicker.addEventListener('change', () => { sourceCode.value = LUME_SOURCES[sourcePicker.value]; });
  document.querySelector('#examples-tab').addEventListener('click', () => select(current));
  document.querySelector('#editor-tab').addEventListener('click', () => setMode('editor'));
  document.querySelector('#run').addEventListener('click', runEditor);
  document.querySelector('#share').addEventListener('click', async () => {
    try {
      if (!await updateHash(sourceCode.value)) return;
      await navigator.clipboard.writeText(location.href);
      status('Link copied!', '链接已复制！');
    } catch (error) { showError(error); }
  });
  sourceCode.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runEditor(); } });
  document.querySelector('#restart').addEventListener('click', () => mode === 'editor' ? runEditor() : select(current));
  renderList(); select(current);
  if (location.hash.startsWith('#code=' ) || location.hash.startsWith('#code0=')) {
    if (location.hash.length > maxHashLength) showError(new Error('Share link is too long'));
    else decodeSource(location.hash).then(source => { sourceCode.value = source; setMode('editor'); return runEditor(); }).catch(showError);
  }
})();
