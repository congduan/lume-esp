/* Optional shell components. Import this file into an app bundle after the embedded prelude. */
(function () {
  var shell = lume.ui && lume.ui.shell || {};
  var cleanups = {};
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
    if (!Array.isArray(p.apps)) throw new TypeError('lume: Launcher apps must be an array');
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
    for (var i = 0; i < p.apps.length; i += columns) rows.push(p.apps.slice(i, i + columns));
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
              onPress: function () { if (!editing()) { launching.set(app.id); if (p.onLaunch) p.onLaunch(app.id); } } }, [
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
  shell.dispose = dispose;
  lume.ui = lume.ui || {};
  lume.ui.shell = shell;
})();
