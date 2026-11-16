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
    ['watchface','◴','Watchface','表盘','Analog and digital','模拟与数字表盘'],
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
  let session = null, current = 'counter', generation = 0;
  const gestures = new Set();
  function showError(error) { errorBox.hidden = false; errorBox.textContent = error?.stack || String(error); }
  function resize() { device.style.transform = `scale(${wrap.clientWidth / 480})`; }
  new ResizeObserver(resize).observe(wrap); resize();
  function select(name) {
    if (!Object.hasOwn(LUME_APPS, name)) { showError(new Error(`Missing bundle: ${name}`)); return; }
    generation++;
    session?.destroy(); session = null;
    renderer.reset(); gestures.clear();
    errorBox.hidden = true; errorBox.textContent = '';
    current = name;
    const item = examples.find(entry => entry[0] === name);
    title.textContent = item?.[document.documentElement.lang === 'zh' ? 3 : 2] || name;
    list.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.dataset.app === name)));
    const mine = generation;
    try {
      session = LumePlaygroundSession(LUME_APPS[name], {
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
    title.textContent = examples.find(entry => entry[0] === current)?.[zh ? 3 : 2] || current;
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
  document.querySelector('#restart').addEventListener('click', () => select(current));
  renderList(); select(current);
})();
