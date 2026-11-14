/* Optional shell components. Import this file into an app bundle after the embedded prelude. */
(function () {
  var shell = lume.ui && lume.ui.shell || {};
  var cleanups = {};
  /* Shell-owned spacing extension: the embedded prelude remains unchanged. */
  var nativeThemeSet = lume.theme.set, nativeThemeGet = lume.theme.get;
  var spacing, spaced = {};
  lume.theme.set = function (next) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return nativeThemeSet(next);
    var value = next.spacing;
    if (value !== undefined && (typeof value !== 'number' || !isFinite(value) || value < 0 || Math.floor(value) !== value))
      throw new Error('lume: theme spacing must be nonnegative integer pixels');
    nativeThemeSet(next);
    spacing = value;
    Object.keys(spaced).forEach(function (id) {
      var record = spaced[id];
      if (record.padding) {
        lume.setAttr(Number(id), 10, spacing === undefined ? 0 : spacing);
        Object.keys(record.sides).forEach(function (key) { lume.setAttr(Number(id), Number(key), record.sides[key]); });
      }
      if (record.gap) lume.setAttr(Number(id), 11, spacing === undefined ? 0 : spacing);
    });
  };
  lume.theme.get = function () { var current = nativeThemeGet(); current.spacing = spacing; return current; };
  var nativeView = View;
  var nativeDispatchRemove = __lume_dispatchRemove;
  __lume_dispatchRemove = function (id) { delete spaced[id]; nativeDispatchRemove(id); };
  View = function (props, children) {
    props = props || {};
    var style = props.style || {};
    if (spacing === undefined || (style.padding !== undefined && style.gap !== undefined)) return nativeView(props, children);
    var copy = {}, styled = {};
    Object.keys(props).forEach(function (key) { copy[key] = props[key]; });
    Object.keys(style).forEach(function (key) { styled[key] = style[key]; });
    var inheritPadding = style.padding === undefined, inheritGap = style.gap === undefined;
    if (inheritPadding) styled.padding = spacing;
    if (inheritGap) styled.gap = spacing;
    copy.style = styled;
    var id = nativeView(copy, children);
    if (inheritPadding || inheritGap) {
      var sides = {};
      if (inheritPadding) ['Top','Right','Bottom','Left'].forEach(function (side, i) {
        var key = 'padding' + side;
        if (style[key] !== undefined) sides[30 + i] = style[key];
      });
      spaced[id] = { padding: inheritPadding, gap: inheritGap, sides: sides };
    }
    return id;
  };
  function color(name, fallback) { return function () { return lume.theme.get().colors[name] || fallback; }; }
  var dialogs = [], toast = null;
  function closeDialog(entry) {
    if (entry.closed) return;
    entry.closed = true;
    var i = dialogs.indexOf(entry);
    if (i >= 0) dialogs.splice(i, 1);
    lume.removeChild(entry.mask);
    lume.removeChild(entry.card);
  }
  function Dialog(p) {
    p = p || {};
    if (!Array.isArray(p.buttons)) throw new TypeError('lume: Dialog buttons must be an array');
    var entry = { closed: false };
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    entry.mask = View({ style: { x:0, y:0, width:screen.w, height:screen.h,
      background:'#000000', opacity:0.65, scroll:'none' },
      onPress: function () { if (p.modal !== false && dialogs[dialogs.length - 1] === entry) closeDialog(entry); } });
    var children = [Text({text:String(p.title || ''),style:{fontSize:20}})];
    if (p.message) children.push(Text({text:String(p.message),style:{longMode:'wrap'}}));
    p.buttons.forEach(function (button) {
      if (!button || ['plain','primary','danger'].indexOf(button.style || 'plain') < 0)
        throw new TypeError('lume: Dialog button style must be plain, primary or danger');
      callback('Dialog onPress', button.onPress);
      var press = function () { if (dialogs[dialogs.length - 1] !== entry) return; closeDialog(entry); if (button.onPress) button.onPress(); };
      if (button.style === 'plain' || !button.style) children.push(View({style:{height:44,width:'100%',
        display:'flex',alignItems:'center',justifyContent:'center',padding:0,gap:0},onPress:press},
        [Text({text:String(button.label),style:{}})]));
      else children.push(Button({title:String(button.label),style:{width:'100%',height:44,
        background:color(button.style === 'danger' ? 'danger' : 'accent', button.style === 'danger' ? '#C62828' : '#385CA5')},onPress:press}));
    });
    entry.card = View({style:{width:360,height:'auto',alignItems:'stretch',display:'flex',
      flexDirection:'column',background:color('surface','#202632'),padding:16,gap:12,scroll:'none'},
      align:'center',onPress:function () {}},children);
    dialogs.push(entry);
    return function () { closeDialog(entry); };
  }
  function clearToast() {
    if (!toast) return;
    if (toast.timer) lume.system.clearTimeout(toast.timer);
    if (toast.fade) lume.system.clearTimeout(toast.fade);
    lume.anim.cancel(toast.id, 'opacity');
    lume.removeChild(toast.id);
    toast = null;
  }
  var Toast = { show: function (message, options) {
    options = options || {};
    var duration = options.durationMs === undefined ? 2000 : options.durationMs;
    if (!Number.isInteger(duration) || duration < 1) throw new RangeError('lume: Toast durationMs must be positive integer');
    clearToast();
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var opacity = signal(1);
    var id = Text({text:String(message),style:{x:40,y:options.position === 'top' ? 48 : screen.h - 84,
      width:screen.w - 80,height:48,background:'#222222',borderRadius:12,padding:12,
      textAlign:'center',opacity:opacity,transition:{property:'opacity',durationMs:180,easing:'ease-out'}}});
    var current = {id:id}; toast = current;
    current.timer = lume.system.setTimeout(function () {
      opacity.set(0);
      current.fade = lume.system.setTimeout(function () { if (toast === current) clearToast(); },180);
    },duration);
  }};
  lume.app.onPause(function () { dialogs.slice().forEach(closeDialog); clearToast(); });
  function positive(name, value, fallback, max) {
    var n = value === undefined ? fallback : value;
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > max)
      throw new RangeError('lume: ' + name + ' must be 1..' + max + ' pixels');
    return n;
  }
  function callback(name, value) {
    if (value !== undefined && typeof value !== 'function') throw new TypeError('lume: ' + name + ' must be a function');
  }
  function dispose(id) {
    var fn = cleanups[id];
    if (fn) { delete cleanups[id]; fn(); }
  }
  function StatusBar(p) {
    p = p || {};
    var height = positive('StatusBar height', p.height, 28, 480);
    var clock = signal('');
    var timer;
    if (p.clock) {
      function tickClock() {
        var now = new Date();
        clock.set(('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2));
      }
      tickClock();
      timer = lume.system.setInterval(tickClock, 60000);
    }
    var left = p.left === undefined ? (p.clock ? clock : '') : p.left;
    var right = p.right === undefined ? '' : p.right;
    var id = View({ parent: p.parent, style: {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', width: '100%', height: height, padding: 4,
      background: p.background || '#111111', scroll: 'none',
      x: p.x === undefined ? 0 : p.x, y: p.y === undefined ? 0 : p.y,
    } }, [Text({ text: left, style: {} }), Text({ text: right, style: {} })]);
    cleanups[id] = function () { if (timer !== undefined) lume.system.clearInterval(timer); };
    return id;
  }
  function EdgeNavigation(p) {
    p = p || {};
    callback('onBack', p.onBack); callback('onPageSwipe', p.onPageSwipe);
    var width = positive('edgeWidth', p.edgeWidth, 24, 120);
    var height = positive('EdgeNavigation height', p.height, 480, 480);
    var screenWidth = positive('EdgeNavigation width', p.width, 480, 480);
    if (width * 2 > screenWidth) throw new RangeError('lume: edgeWidth exceeds screen');
    var mask = View({ parent: p.parent, visible: false, style: {
      x: width, y: 0, width: screenWidth - 2 * width, height: height,
      background: '#000000', opacity: 0.35, scroll: 'none',
    } });
    var offs = [], strips = [];
    function edge(side) {
      var progress = signal(0);
      var strip = View({ parent: p.parent, style: {
        x: side === 'left' ? 0 : screenWidth - width, y: 0,
        width: width, height: height, scroll: 'none',
      } });
      if (p.indicator !== false) Canvas({ parent: strip, width: width, height: 64,
        style: { x: 0, y: Math.floor((height - 64) / 2), scroll: 'none' },
        onDraw: function (c) {
          var amount = progress();
          c.clear();
          if (amount > 0) c.fillRect(side === 'left' ? 0 : width - Math.max(3, amount), 8,
            Math.max(3, amount), 48);
        },
      });
      function reset() {
        lume.setAttr(mask, 5, 0);
        if (progress() > 0) {
          progress.set(0);
          lume.anim.to(strip, { attr: 'opacity', from: 0.65, to: 1, durationMs: 180, easing: 'ease-out' });
        }
      }
      offs.push(lume.gesture.on(strip, 'pan', function (e) {
        var dx = side === 'left' ? e.dx : -e.dx;
        if (dx > 0 && Math.abs(e.dx) > Math.abs(e.dy)) {
          lume.setAttr(mask, 5, 1);
          progress.set(Math.min(width, Math.max(3, Math.round(dx / 4))));
        }
      }));
      offs.push(lume.gesture.on(strip, 'panend', reset));
      offs.push(lume.gesture.on(strip, 'swipe', function (e) {
        if ((side === 'left' && e.dir === 'right') || (side === 'right' && e.dir === 'left')) {
          var handled = side === 'left' && p.onBack ? p.onBack() === true : false;
          if (!handled && p.onPageSwipe) p.onPageSwipe(e.dir);
        }
        reset();
      }));
      strips.push(strip);
    }
    edge('left'); edge('right');
    cleanups[strips[0]] = function () {
      offs.forEach(function (off) { off(); });
      lume.anim.cancel(strips[0], 'opacity'); lume.anim.cancel(strips[1], 'opacity');
      lume.removeChild(mask); lume.removeChild(strips[0]); lume.removeChild(strips[1]);
    };
    return strips[0];
  }
  function Launcher(p) {
    p = p || {};
    /* Default source: the installed app set (lume.apps.entries()). Passing
     * `apps` still wins, so the component stays usable without the store. */
    var apps = p.apps;
    if (apps === undefined) {
      apps = lume.apps && typeof lume.apps.entries === 'function' ? lume.apps.entries() : [];
    }
    if (!Array.isArray(apps)) throw new TypeError('lume: Launcher apps must be an array');
    callback('onLaunch', p.onLaunch);
    var columns = positive('Launcher columns', p.columns, 3, 8);
    var editing = signal(false), launching = signal(null);
    var root = View({ parent: p.parent, style: { width: '100%', height: 480,
      background: '#000000', scroll: 'none' } });
    var bar = p.statusBar === false ? null : StatusBar({ parent: root, left: p.title || 'Lume',
      right: p.right === undefined ? function () { return 'battery ' + lume.pmic.battPercent() + '%'; } : p.right });
    var top = bar === null ? 0 : 28;
    if (bar === null) Text({ parent: root, text: p.title || 'Lume', style: { x: 8, y: 4 } });
    Button({ parent: root, title: function () { return editing() ? 'done' : 'edit'; },
      style: { x: 404, y: top + 2, width: 68, height: 30 },
      onPress: function () { editing.set(!editing()); } });
    var rows = [];
    for (var i = 0; i < apps.length; i += columns) rows.push(apps.slice(i, i + columns));
    var list = List({ parent: root,
      style: { x: 0, y: top + 36, width: '100%', height: 480 - top - 36,
        background: '#000000', scrollbar: 'auto' },
      items: rows, itemHeight: 100, overscan: 1,
      renderItem: function (row) {
        return View({ style: { display: 'flex', flexDirection: 'row',
          justifyContent: 'space-evenly', width: '100%', height: 96, scroll: 'none' } },
          row.map(function (app) {
            return View({ style: { display: 'flex', flexDirection: 'column',
              alignItems: 'center', width: Math.floor(460 / columns), height: 94, scroll: 'none',
              opacity: function () { return launching() === app.id ? 0.55 : 1; } },
              onPress: function () {
                if (editing()) return;
                launching.set(app.id);
                /* Default to a real runtime switch; a host callback overrides. */
                if (p.onLaunch) p.onLaunch(app.id);
                else if (lume.apps && typeof lume.apps.launch === 'function') lume.apps.launch(app.id);
              } }, [
              Canvas({ width: 48, height: 48, style: { borderRadius: 24 }, onDraw: function (c) {
                c.clear(); c.fillColor(app.color || '#385CA5'); c.fillRect(2, 2, 44, 44);
                c.text(17, 18, String(app.icon || app.glyph || app.label || '').slice(0, 1), '#FFFFFF');
              } }),
              Text({ text: app.label || app.id || '', style: {} }),
            ]);
          }));
      },
    });
    var edge = EdgeNavigation({ parent: root, indicator: p.indicator,
      onBack: function () { if (editing()) { editing.set(false); return true; } return p.onBack ? p.onBack() : false; },
      onPageSwipe: p.onPageSwipe });
    cleanups[root] = function () { if (bar !== null) dispose(bar); dispose(edge); };
    return root;
  }
  shell.StatusBar = StatusBar;
  shell.EdgeNavigation = EdgeNavigation;
  shell.Launcher = Launcher;
  shell.Dialog = Dialog;
  shell.Toast = Toast;
  shell.dispose = dispose;
  lume.ui = lume.ui || {};
  lume.ui.shell = shell;
})();
