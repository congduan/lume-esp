/* Optional shell components. Import this file into an app bundle after the embedded prelude. */
(function () {
  var shell = lume.ui && lume.ui.shell || {};
  var cleanups = {};
  /* Shell-owned spacing extension: the embedded prelude remains unchanged. */
  var nativeThemeSet = lume.theme.set, nativeThemeGet = lume.theme.get;
  var spacing, spaced = {}, declared = {};
  if (!Object.keys(nativeThemeGet().colors).length) {
    nativeThemeSet({colors:{bg:'#07111D',primary:'#07111D',surface:'#132435',
      surfaceAlt:'#1C3449',text:'#F2F7FB',textDim:'#9EB3C6',accent:'#40D8B0',
      danger:'#FF6B79',success:'#40D8B0'},radius:12,fontScale:1});
    spacing = 12;
  }
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
  __lume_dispatchRemove = function (id) { delete spaced[id]; delete declared[id]; nativeDispatchRemove(id); };
  View = function (props, children) {
    props = props || {};
    var style = props.style || {};
    if (spacing === undefined || (style.padding !== undefined && style.gap !== undefined)) {
      var plainId = nativeView(props, children);
      declared[plainId] = style;
      return plainId;
    }
    var copy = {}, styled = {};
    Object.keys(props).forEach(function (key) { copy[key] = props[key]; });
    Object.keys(style).forEach(function (key) { styled[key] = style[key]; });
    var inheritPadding = style.padding === undefined, inheritGap = style.gap === undefined;
    if (inheritPadding) styled.padding = spacing;
    if (inheritGap) styled.gap = spacing;
    copy.style = styled;
    var id = nativeView(copy, children);
    declared[id] = style;
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
  function Card(p) {
    p = p || {};
    var style = {background:'surface',borderRadius:12,padding:16,gap:12,
      display:'flex',flexDirection:'column',scroll:'none'};
    Object.keys(p.style || {}).forEach(function (key) { style[key] = p.style[key]; });
    return View({parent:p.parent,style:style,onPress:p.onPress},p.children || []);
  }
  function IconButton(p) {
    p = p || {};
    var size = positive('IconButton size',p.size,56,120);
    var style = {width:size,height:size,borderRadius:999,background:'surfaceAlt'};
    Object.keys(p.style || {}).forEach(function (key) { style[key] = p.style[key]; });
    return Button({parent:p.parent,title:p.title || '',style:style,onPress:p.onPress});
  }
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
      if (button.style === 'plain' || !button.style) children.push(View({style:{height:56,width:'100%',
        display:'flex',alignItems:'center',justifyContent:'center',padding:0,gap:0},onPress:press},
        [Text({text:String(button.label),style:{}})]));
      else children.push(Button({title:String(button.label),style:{width:'100%',height:56,
        background:color(button.style === 'danger' ? 'danger' : 'primary', button.style === 'danger' ? '#C62828' : '#385CA5')},onPress:press}));
    });
    entry.card = View({style:{width:screen.w-48,height:'auto',alignItems:'stretch',display:'flex',
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
    var id = Text({text:String(message),style:{x:24,y:options.position === 'top' ? 48 : screen.h - 80,
      width:screen.w - 48,height:56,background:'#222222',borderRadius:12,padding:12,
      textAlign:'center',opacity:opacity,transition:{property:'opacity',durationMs:180,easing:'ease-out'}}});
    var current = {id:id}; toast = current;
    current.timer = lume.system.setTimeout(function () {
      opacity.set(0);
      current.fade = lume.system.setTimeout(function () { if (toast === current) clearToast(); },180);
    },duration);
  }};
  lume.app.onPause(function () { dialogs.slice().forEach(closeDialog); clearToast(); });
  function positive(name, value, fallback, max, errorType) {
    var n = value === undefined ? fallback : value;
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > max)
      throw new (errorType || RangeError)('lume: ' + name + ' must be 1..' + max + ' pixels');
    return n;
  }
  function safeInsets(shape, size) {
    if (shape !== 'square' && shape !== 'round')
      throw new TypeError('lume: SafeArea shape must be square or round');
    size = positive('SafeArea size', size, undefined, 16384, TypeError);
    if (shape === 'square') return {top:0,right:0,bottom:0,left:0};
    var side = Math.floor(size / Math.SQRT2);
    var near = Math.floor((size - side) / 2);
    var far = size - side - near;
    return {top:near,right:far,bottom:far,left:near};
  }
  function SafeArea(p) {
    p = p || {};
    var shape = p.shape === undefined ? 'square' : p.shape;
    var size = p.size === undefined ? (typeof __lumeScreen === 'object' ? __lumeScreen.w : 480) : p.size;
    var insets = safeInsets(shape, size);
    var side = size - insets.left - insets.right;
    var children = p.children === undefined ? [] : p.children;
    if (!Array.isArray(children)) throw new TypeError('lume: SafeArea children must be an array');
    if (shape === 'round') {
      for (var i = 0; i < children.length; i++) {
        var style = declared[children[i]];
        if (!style) continue;
        var x = typeof style.x === 'number' ? style.x : 0;
        var y = typeof style.y === 'number' ? style.y : 0;
        var width = style.width, height = style.height;
        if ((typeof width === 'number' && (x < 0 || x + width > side)) ||
            (typeof height === 'number' && (y < 0 || y + height > side))) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function')
            console.warn('lume: SafeArea child exceeds ' + side + 'x' + side + ' safe bounds');
          break;
        }
      }
    }
    return View({parent:p.parent,style:{x:insets.left,y:insets.top,width:side,height:side,
      padding:0,gap:0,scroll:'none'}},children);
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
    var height = positive('StatusBar height', p.height, 56, 480);
    /* r109: geometry used to be hard-coded to width 432 / x,y 24 (a 480px
     * square layout). Derive it from the screen instead, reusing SafeArea's
     * safeInsets() so a round 1.75C bar matches the inscribed safe square
     * instead of overflowing it. Square screens keep the legacy 24px margin,
     * which evaluates to the exact old 432x24 layout at 480px (2.16 / 1.8
     * unchanged). No firmware or prelude change. */
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var shape = p.shape === undefined ? 'square' : p.shape;
    if (shape !== 'square' && shape !== 'round')
      throw new TypeError('lume: StatusBar shape must be square or round');
    var insets = safeInsets(shape, screen.w);
    /* Round: the SafeArea insets already provide the margin, so the bar spans
     * the full safe side (equal-width with a SafeArea View). Square: the
     * classic 24px side margins; width tracks the screen so 368px-wide bars
     * no longer overflow. */
    var margin = shape === 'round' ? 0 : 24;
    var barWidth = Math.max(1, screen.w - insets.left - insets.right - 2 * margin);
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
      alignItems: 'center', width: barWidth, height: height, padding: 0,
      background: p.background || '#111111', scroll: 'none',
      x: p.x === undefined ? insets.left + margin : p.x,
      y: p.y === undefined ? insets.top + margin : p.y,
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
  /* r148: QWERTY soft keyboard. Pure JS shell component: letter/control keys
   * are Buttons driven by the existing press pipeline, rows are shell Views so
   * theme.spacing still feeds unstyled children. All labels are ASCII (r64);
   * prelude / native ATTR semantics are untouched, touch feel is deferred to
   * board bring-up. */
  var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function Keyboard(p) {
    p = p || {};
    callback('Keyboard onKey', p.onKey);
    callback('Keyboard onBackspace', p.onBackspace);
    callback('Keyboard onSubmit', p.onSubmit);
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var width = positive('Keyboard width', p.width, screen.w, 16384);
    var columns = KEY_ROWS[0].length;                 /* 10 letters on the top row */
    var maxGap = Math.floor((width - columns * 40) / (columns - 1));
    if (maxGap < 0) throw new RangeError('lume: Keyboard width too narrow for 40px keys');
    /* theme.spacing is the default key gap, clamped so ten columns keep the
     * 40 px touch target; an explicit gap wins and can fail validation loudly. */
    var gap = p.gap === undefined ? Math.min(spacing === undefined ? 8 : spacing, maxGap) : p.gap;
    if (typeof gap !== 'number' || !isFinite(gap) || Math.floor(gap) !== gap || gap < 0 || gap > 32)
      throw new RangeError('lume: Keyboard gap must be 0..32 pixels');
    var fitted = Math.floor((width - (columns - 1) * gap) / columns);
    var keySize = p.keySize === undefined ? fitted : p.keySize;
    if (typeof keySize !== 'number' || !isFinite(keySize) || Math.floor(keySize) !== keySize ||
        keySize < 40 || keySize > 128)
      throw new RangeError('lume: Keyboard keySize must be 40..128 pixels');
    var pad = 4;
    var height = 4 * keySize + 3 * gap + 2 * pad;
    var style = { x: p.x === undefined ? Math.floor((screen.w - width) / 2) : p.x,
      y: p.y === undefined ? Math.max(0, screen.h - height - 24) : p.y,
      width: width, height: height, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: gap, padding: pad,
      background: color('surfaceAlt', '#1C3449'), borderRadius: 12, scroll: 'none' };
    Object.keys(p.style || {}).forEach(function (key) { style[key] = p.style[key]; });
    var nodes = [], root = View({ parent: p.parent, style: style }, []);
    function row(children) {
      var id = View({ parent: root, style: { display: 'flex', flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: gap, padding: 0,
        scroll: 'none' } }, []);
      nodes.push(id);
      children.forEach(function (child) { child(id); });
      return id;
    }
    function key(label, keyWidth, onPress, background) {
      return function (parent) {
        nodes.push(Button({ parent: parent, title: label,
          style: { width: keyWidth, height: keySize, borderRadius: 8,
            background: background || color('surface', '#132435') },
          onPress: onPress }));
      };
    }
    KEY_ROWS.forEach(function (chars) {
      row(chars.split('').map(function (ch) {
        return key(ch.toUpperCase(), keySize, function () { if (p.onKey) p.onKey(ch); });
      }));
    });
    var spaceWidth = 4 * keySize + 3 * gap;
    row([
      key('SPACE', spaceWidth, function () { if (p.onKey) p.onKey(' '); }),
      key('BKSP', keySize, function () { if (p.onBackspace) p.onBackspace(); }, color('danger', '#FF6B79')),
      key('ENTER', keySize, function () { if (p.onSubmit) p.onSubmit(); }, color('accent', '#40D8B0')),
    ]);
    cleanups[root] = function () { nodes.forEach(function (id) { lume.removeChild(id); }); };
    return root;
  }
  /* r151: controlled form primitives. All three keep state in the app's
   * signals (the component never stores it), use theme tokens for colour, and
   * register every node + gesture unsubscriber through the shell dispose chain.
   * Touch feel / on-device hit calibration is deferred to board bring-up. */
  function boolValue(name, value, fallback) {
    var v = value === undefined ? fallback : value;
    if (typeof v !== 'function' && typeof v !== 'boolean')
      throw new TypeError('lume: ' + name + ' must be a boolean or a signal function');
    return v;
  }
  function readBool(v) { return typeof v === 'function' ? !!v() : v; }
  function Switch(p) {
    p = p || {};
    callback('Switch onChange', p.onChange);
    var height = p.height === undefined ? 48 : p.height;
    if (!isFinite(height) || Math.floor(height) !== height || height < 40 || height > 128)
      throw new RangeError('lume: Switch height must be 40..128 pixels');
    var trackWidth = p.trackWidth === undefined ? 72 : p.trackWidth;
    if (!isFinite(trackWidth) || Math.floor(trackWidth) !== trackWidth || trackWidth < 48 || trackWidth > 480)
      throw new RangeError('lume: Switch trackWidth must be 48..480 pixels');
    var value = boolValue('Switch value', p.value, false);
    var onColor = color('accent', '#40D8B0'), offColor = color('surfaceAlt', '#1C3449');
    var knobColor = color('text', '#F2F7FB');
    function isOn() { return readBool(value); }
    function toggle() { if (p.onChange) p.onChange(!isOn()); }
    var trackHeight = height - 8, knobSize = height - 8, inset = 4;
    var travel = trackWidth - knobSize - 2 * inset;
    var labelWidth = p.label === undefined ? 0 : 200;
    var root = View({ parent: p.parent, style: {
      x: p.x === undefined ? 24 : p.x, y: p.y === undefined ? 24 : p.y,
      width: trackWidth + labelWidth, height: height, scroll: 'none' }, onPress: toggle }, []);
    var nodes = [root];
    nodes.push(View({ parent: root, style: { position: 'absolute', x: 0, y: inset,
      width: trackWidth, height: trackHeight, borderRadius: Math.floor(trackHeight / 2),
      background: function () { return isOn() ? onColor() : offColor(); }, scroll: 'none' } }));
    nodes.push(View({ parent: root, style: { position: 'absolute', y: inset,
      width: knobSize, height: knobSize, borderRadius: Math.floor(knobSize / 2),
      x: function () { return isOn() ? inset + travel : inset; },
      background: knobColor, scroll: 'none' } }));
    if (p.label !== undefined) nodes.push(Text({ parent: root,
      text: typeof p.label === 'function' ? p.label : String(p.label),
      style: { position: 'absolute', x: trackWidth + 12, y: 0,
        width: Math.max(1, labelWidth - 12), height: height, fontSize: 16,
        color: color('text', '#F2F7FB'), scroll: 'none' } }));
    cleanups[root] = function () { nodes.forEach(function (id) { lume.removeChild(id); }); };
    return root;
  }
  function Slider(p) {
    p = p || {};
    callback('Slider onChange', p.onChange);
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var width = positive('Slider width', p.width, Math.max(40, screen.w - 48), 16384);
    var height = p.height === undefined ? 40 : p.height;
    if (!isFinite(height) || Math.floor(height) !== height || height < 40 || height > 128)
      throw new RangeError('lume: Slider height must be 40..128 pixels');
    var min = p.min === undefined ? 0 : p.min, max = p.max === undefined ? 100 : p.max;
    if (!isFinite(min) || !isFinite(max) || max <= min)
      throw new RangeError('lume: Slider requires finite min < max');
    var step = p.step === undefined ? 1 : p.step;
    if (!isFinite(step) || step <= 0 || (max - min) / step > 4096)
      throw new RangeError('lume: Slider step must be positive and yield <=4096 steps');
    var value = p.value === undefined ? min : p.value;
    if (typeof value !== 'function' && (typeof value !== 'number' || !isFinite(value)))
      throw new TypeError('lume: Slider value must be a number or a signal function');
    function current() {
      var v = typeof value === 'function' ? value() : value;
      if (!isFinite(v)) v = min;
      return Math.max(min, Math.min(max, v));
    }
    function quantize(raw) {
      if (!isFinite(raw)) raw = min;
      var q = min + Math.round((raw - min) / step) * step;
      q = Math.round(q * 1e6) / 1e6;                 /* kill float drift */
      return Math.max(min, Math.min(max, q));
    }
    var knob = Math.min(24, Math.max(8, Math.floor(height / 2)));
    var mid = Math.floor(height / 2);
    var trackColor = color('surfaceAlt', '#1C3449'), fillColor = color('accent', '#40D8B0');
    var knobColor = color('text', '#F2F7FB');
    var canvas = Canvas({ parent: p.parent, width: width, height: height,
      style: { x: p.x === undefined ? Math.floor((screen.w - width) / 2) : p.x,
        y: p.y === undefined ? 24 : p.y, scroll: 'none' },
      onDraw: function (c) {
        c.clear();
        var frac = (current() - min) / (max - min);
        var kx = Math.round(frac * (width - knob));
        c.fillColor(trackColor()); c.fillRect(0, mid - 2, width, 4);
        c.fillColor(fillColor()); c.fillRect(0, mid - 2, kx + knob, 4);
        c.fillColor(knobColor()); c.fillRect(kx, mid - Math.floor(knob / 2), knob, knob);
      } });
    /* dx is displacement from press start (prelude gesture state machine), so a
     * pan maps startValue + dx*(range/width) back into the value domain. onChange
     * fires only when the step-quantised value CHANGES during a drag: live
     * feedback with no per-move jitter. panend only ends the drag, no extra emit.
     * On LVGL a Canvas is a normal node id, so it can be a gesture target; the
     * piano overlay (transparent View + absolute e.x) is kept as a fallback. */
    var offs = [], startValue = min, lastQ = min, active = false;
    offs.push(lume.gesture.on(canvas, 'panstart', function () {
      active = true; startValue = current(); lastQ = quantize(startValue);
    }));
    offs.push(lume.gesture.on(canvas, 'pan', function (e) {
      if (!active) return;
      var q = quantize(startValue + (e.dx || 0) * (max - min) / width);
      if (q !== lastQ) { lastQ = q; if (p.onChange) p.onChange(q); }
    }));
    offs.push(lume.gesture.on(canvas, 'panend', function () { active = false; }));
    cleanups[canvas] = function () {
      offs.forEach(function (off) { off(); });
      lume.removeChild(canvas);
    };
    return canvas;
  }
  function Progress(p) {
    p = p || {};
    var height = positive('Progress height', p.height, 12, 128);
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var width = positive('Progress width', p.width, Math.max(40, screen.w - 48), 16384);
    var value = p.value === undefined ? 0 : p.value;
    if (typeof value !== 'function' && (typeof value !== 'number' || !isFinite(value)))
      throw new TypeError('lume: Progress value must be a number or a signal function');
    function fraction() {
      var v = typeof value === 'function' ? value() : value;
      if (!isFinite(v)) v = 0;
      return Math.max(0, Math.min(1, v));
    }
    var nodes = [];
    var root = View({ parent: p.parent, style: {
      x: p.x === undefined ? 24 : p.x, y: p.y === undefined ? 24 : p.y,
      width: width, height: height, borderRadius: Math.floor(height / 2),
      background: color('surfaceAlt', '#1C3449'), scroll: 'none' } }, []);
    nodes.push(root);
    /* width is a bound numeric style: the prelude's owned effect calls
     * setAttr(fill, ATTR_WIDTH=2, px) on every signal change. No Canvas, no
     * pixel budget, and the effect dies with the node on dispose. */
    nodes.push(View({ parent: root, style: { position: 'absolute', x: 0, y: 0,
      height: height, borderRadius: Math.floor(height / 2),
      width: function () { return Math.round(fraction() * width); },
      background: color('accent', '#40D8B0'), scroll: 'none' } }));
    if (p.label !== undefined) nodes.push(Text({ parent: p.parent,
      text: typeof p.label === 'function' ? p.label : String(p.label),
      style: { x: p.x === undefined ? 24 : p.x,
        y: (p.y === undefined ? 24 : p.y) - 24, width: width, height: 20,
        fontSize: 14, color: color('textDim', '#9EB3C6'), scroll: 'none' } }));
    cleanups[root] = function () { nodes.forEach(function (id) { lume.removeChild(id); }); };
    return root;
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
      right: p.right === undefined ? function () { var v = lume.pmic.battPercent(); return v >= 0 && v <= 100 ? 'battery ' + v + '%' : 'battery --'; } : p.right });
    var top = bar === null ? 24 : 96;
    var listTop = bar === null ? 96 : 168;
    if (bar === null) Text({ parent: root, text: p.title || 'Lume', style: { x: 24, y: 40 } });
    Button({ parent: root, title: function () { return editing() ? 'done' : 'edit'; },
      style: { x: 400, y: top, width: 56, height: 56 },
      onPress: function () { editing.set(!editing()); } });
    var rows = [];
    for (var i = 0; i < apps.length; i += columns) rows.push(apps.slice(i, i + columns));
    var list = List({ parent: root,
      style: { x: 24, y: listTop, width: 432, height: 456 - listTop,
        background: '#000000', scrollbar: 'auto' },
      items: rows, itemHeight: 84, overscan: 1,
      renderItem: function (row) {
        return View({ style: { display: 'flex', flexDirection: 'row',
          justifyContent: 'space-evenly', width: '100%', height: 96, scroll: 'none' } },
          row.map(function (app) {
            return View({ style: { display: 'flex', flexDirection: 'column',
              alignItems: 'center', width: Math.floor(432 / columns), height: 94, scroll: 'none',
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
  shell.Keyboard = Keyboard;
  shell.Switch = Switch;
  shell.Slider = Slider;
  shell.Progress = Progress;
  shell.SafeArea = SafeArea;
  shell.safeInsets = safeInsets;
  shell.Card = Card;
  shell.IconButton = IconButton;
  shell.EdgeNavigation = EdgeNavigation;
  shell.Launcher = Launcher;
  shell.Dialog = Dialog;
  shell.Toast = Toast;
  shell.dispose = dispose;
  lume.ui = lume.ui || {};
  lume.ui.shell = shell;
})();
