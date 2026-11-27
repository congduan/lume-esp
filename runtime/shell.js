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
  /* r153: per-key state tint. keyStates maps a LOWERCASE letter to one of the
   * three Wordle verdicts: 'hit' (right letter, right slot, green), 'present'
   * (right letter, wrong slot, yellow), 'miss' (letter absent, grey). Any other
   * key or value is ignored and the key keeps its default background; SPACE /
   * BKSP / ENTER are never tinted. */
  var KEY_STATE_TINTS = { hit: '#166B3E', present: '#8A6A12', miss: '#30343E' };
  function Keyboard(p) {
    p = p || {};
    callback('Keyboard onKey', p.onKey);
    callback('Keyboard onBackspace', p.onBackspace);
    callback('Keyboard onSubmit', p.onSubmit);
    var keyStates = p.keyStates;
    if (keyStates !== undefined && typeof keyStates !== 'function' &&
        (typeof keyStates !== 'object' || keyStates === null || Array.isArray(keyStates)))
      throw new TypeError('lume: Keyboard keyStates must be an object or a signal function');
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
    /* r203/r217: BKSP / ENTER carry 4-5 character labels, scaled by opt-in
     * controlKeyRatio (1..3, default 1). r217 raises the keyHeight floor and
     * default from 40 to 48 px (Math.max(48, keySize)) to meet the 48 px
     * vertical touch target while keeping keySize >= 40 for 10-col QWERTY
     * inside a 480 px round display (10*48=480 exceeds R<=240 at any height). */
    var controlRatio = p.controlKeyRatio === undefined ? 1 : p.controlKeyRatio;
    if (typeof controlRatio !== 'number' || !isFinite(controlRatio) || controlRatio < 1 || controlRatio > 3)
      throw new RangeError('lume: Keyboard controlKeyRatio must be 1..3');
    var keyHeight = p.keyHeight === undefined ? Math.max(48, keySize) : p.keyHeight;
    if (typeof keyHeight !== 'number' || !isFinite(keyHeight) || Math.floor(keyHeight) !== keyHeight ||
        keyHeight < 48 || keyHeight > 128)
      throw new RangeError('lume: Keyboard keyHeight must be 48..128 pixels');
    var pad = 4;
    var height = 4 * keyHeight + 3 * gap + 2 * pad;
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
    /* SPACE already spans three keys (r217 tapered bottom row for 48 px key
     * height on a round screen); only BKSP / ENTER scale by controlRatio. */
    function controlWidth(label, keyWidth) {
      return (label === 'BKSP' || label === 'ENTER') ? Math.round(keyWidth * controlRatio) : keyWidth;
    }
    function key(label, keyWidth, onPress, background) {
      return function (parent) {
        nodes.push(Button({ parent: parent, title: label,
          style: { width: controlWidth(label, keyWidth), height: keyHeight, borderRadius: 8,
            background: background || color('surface', '#132435') },
          onPress: onPress }));
      };
    }
    /* r153: absent keyStates returns the exact r148 colour helper, so the node
     * and effect graph is unchanged. When present, each letter key binds its
     * own background getter: the prelude wraps a function background in an
     * owned effect, so a published state change rewrites only this key's
     * ATTR_BG_COLOR in place -- no node rebuild, no canvas, control keys stay
     * on their fixed backgrounds. */
    function letterBackground(ch) {
      var fallback = color('surface', '#132435');
      if (keyStates === undefined) return fallback;
      return function () {
        var states = typeof keyStates === 'function' ? keyStates() : keyStates;
        var tint = states && KEY_STATE_TINTS[states[ch]];
        return tint || fallback();
      };
    }
    KEY_ROWS.forEach(function (chars) {
      row(chars.split('').map(function (ch) {
        return key(ch.toUpperCase(), keySize, function () { if (p.onKey) p.onKey(ch); },
          letterBackground(ch));
      }));
    });
    var spaceWidth = 3 * keySize + 2 * gap;
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
    /* r203: opt-in round thumb. The default false path keeps the pre-r203
     * fillRect draw stream byte-for-byte; knobDiameter is floored to an integer
     * radius because the prelude Canvas.fillCircle takes an integer radius. */
    var roundThumb = p.roundThumb === undefined ? false : p.roundThumb;
    if (typeof roundThumb !== 'boolean')
      throw new TypeError('lume: Slider roundThumb must be a boolean');
    var maxKnob = Math.min(height, 64), knobDiameter = 36;
    if (p.knobDiameter !== undefined) {
      if (!isFinite(p.knobDiameter) || Math.floor(p.knobDiameter) !== p.knobDiameter ||
          p.knobDiameter < 32 || p.knobDiameter > maxKnob)
        throw new RangeError('lume: Slider knobDiameter must be 32..' + maxKnob + ' pixels');
      knobDiameter = p.knobDiameter;
    }
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
        if (roundThumb) {
          var r = Math.floor(knobDiameter / 2);
          var tx = Math.round(frac * (width - 2 * r));
          c.fillColor(trackColor()); c.fillRect(0, mid - 2, width, 4);
          c.fillColor(fillColor()); c.fillRect(0, mid - 2, tx + r, 4);
          c.fillCircle(tx + r, mid, r, knobColor());
          return;
        }
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
  /* r155: polar gesture translation. The app owns selection and playback state. */
  function ClickWheel(p) {
    p = p || {};
    callback('ClickWheel onRotate', p.onRotate);
    callback('ClickWheel onCenterTap', p.onCenterTap);
    callback('ClickWheel onOuterTap', p.onOuterTap);
    var cx = p.cx, cy = p.cy, outerR = p.outerR, innerR = p.innerR;
    if (![cx, cy, outerR, innerR].every(function (n) { return typeof n === 'number' && isFinite(n); }) ||
        outerR < 40 || innerR < 1 || innerR >= outerR ||
        Math.floor(cx) !== cx || Math.floor(cy) !== cy ||
        Math.floor(outerR) !== outerR || Math.floor(innerR) !== innerR)
      throw new RangeError('lume: ClickWheel requires integer cx/cy and 1 <= innerR < outerR, outerR >= 40');
    var size = outerR * 2, stepAngle = Math.PI / 8;
    var canvas = Canvas({ parent: p.parent, width: size, height: size,
      style: { position: 'absolute', x: cx - outerR, y: cy - outerR, borderRadius: outerR, scroll: 'none' },
      onDraw: function (c) {
        var colors = lume.theme.get().colors;
        var track = colors.surfaceAlt || '#1C3449';
        var center = colors.surface || '#132435';
        var split = colors.textDim || '#9EB3C6';
        c.fillCircle(outerR, outerR, outerR, track);
        c.fillCircle(outerR, outerR, innerR, center);
        for (var i = 0; i < 4; i++) {
          var a = (i * 90 + 45) * Math.PI / 180;
          c.line(Math.round(outerR + Math.sin(a) * (innerR + 8)), Math.round(outerR - Math.cos(a) * (innerR + 8)),
            Math.round(outerR + Math.sin(a) * (outerR - 8)), Math.round(outerR - Math.cos(a) * (outerR - 8)), split, 2);
        }
      } });
    var last = null, remainder = 0, offs = [];
    function polar(e) {
      if (!e || !isFinite(e.x) || !isFinite(e.y)) return null;
      var dx = e.x - cx, dy = e.y - cy, radius = Math.sqrt(dx * dx + dy * dy);
      if (radius < innerR || radius > outerR) return null;
      return Math.atan2(dx, -dy); /* clockwise from 12 o'clock */
    }
    offs.push(lume.gesture.on(canvas, 'panstart', function (e) {
      last = e && isFinite(e.dx) && isFinite(e.dy) ?
        polar({x:e.x-e.dx,y:e.y-e.dy}) : polar(e);
      remainder = 0;
    }));
    offs.push(lume.gesture.on(canvas, 'pan', function (e) {
      var angle = polar(e);
      if (angle === null) { last = null; remainder = 0; return; }
      if (last === null) { last = angle; return; }
      var delta = angle - last;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      last = angle;
      /* Reject sparse, ambiguous jumps (half a turn or more). */
      if (Math.abs(delta) >= Math.PI) { remainder = 0; return; }
      remainder += delta;
      var steps = remainder > 0 ? Math.floor((remainder + 1e-9) / stepAngle)
                                : Math.ceil((remainder - 1e-9) / stepAngle);
      if (steps) {
        remainder -= steps * stepAngle;
        if (p.onRotate) for (var i = 0; i < Math.abs(steps); i++) p.onRotate(steps > 0 ? 1 : -1);
      }
    }));
    offs.push(lume.gesture.on(canvas, 'panend', function () { last = null; remainder = 0; }));
    offs.push(lume.gesture.on(canvas, 'tap', function (e) {
      if (!e || !isFinite(e.x) || !isFinite(e.y)) return;
      var dx = e.x - cx, dy = e.y - cy, radius = Math.sqrt(dx * dx + dy * dy);
      if (radius <= innerR) { if (p.onCenterTap) p.onCenterTap(); return; }
      if (radius > outerR) return;
      var degrees = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
      var quadrant = Math.floor((degrees + 45) / 90) % 4;
      var distance = Math.abs(((degrees - quadrant * 90 + 540) % 360) - 180);
      if (distance <= 22.5 + 1e-7 && p.onOuterTap) p.onOuterTap(quadrant);
    }));
    cleanups[canvas] = function () {
      offs.forEach(function (off) { off(); });
      lume.removeChild(canvas);
    };
    return canvas;
  }
  function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    var rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] :
      h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
    return '#' + rgb.map(function (n) { return Math.round((n + m) * 255).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function hexToHsv(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
    var r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255, hi = Math.max(r,g,b), lo = Math.min(r,g,b), d = hi-lo, h = 0;
    if (d) {
      if (hi === r) h = 60 * (((g-b)/d + 6) % 6);
      else if (hi === g) h = 60 * ((b-r)/d + 2);
      else h = 60 * ((r-g)/d + 4);
    }
    return {h:h, s:hi ? d/hi : 0, v:hi};
  }
  function pickerInk(hex) {
    var light = 0.299*parseInt(hex.slice(1,3),16) + 0.587*parseInt(hex.slice(3,5),16) + 0.114*parseInt(hex.slice(5,7),16);
    return light >= 145 ? '#07111D' : '#FFFFFF';
  }
  /* r203: compact mode scales Canvas coordinates through a thin context
   * wrapper, so the r166 hit-test and paint source stays verbatim. The 14px
   * canvas font cannot be scaled; labels keep their native size. k=1 bypasses
   * the wrapper entirely, preserving the pre-r203 draw stream byte-for-byte. */
  function scaledPickerContext(c, k) {
    var R = function (v) { return Math.round(v * k); };
    return {
      nodeId: c.nodeId,
      fillColor: function (color) { c.fillColor(color); },
      clear: function () { c.clear(); },
      fillRect: function (x, y, w, h) { c.fillRect(R(x), R(y), R(w), R(h)); },
      fillCircle: function (x, y, r, color) { c.fillCircle(R(x), R(y), R(r), color); },
      arc: function (x, y, r, from, to, width, color) { c.arc(R(x), R(y), R(r), from, to, R(width), color); },
      text: function (x, y, str, color) { c.text(R(x), R(y), str, color); }
    };
  }
  /* r166: one Canvas; local HSV state, gesture subscriptions and disposal. */
  function ColorPicker(p) {
    p = p || {};
    callback('ColorPicker onChange', p.onChange);
    callback('ColorPicker onConfirm', p.onConfirm);
    callback('ColorPicker onDismiss', p.onDismiss);
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var x = p.x === undefined ? Math.floor((screen.w-300)/2) : p.x;
    var y = p.y === undefined ? 8 : p.y;
    if (![x,y].every(function (n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }))
      throw new RangeError('lume: ColorPicker x/y must be integer pixels');
    /* r203: compact:true shrinks the 300x360 picker to 210x252 (k=0.7) so it
     * fits a round safe area; default false keeps the r166 geometry exactly. */
    var compact = p.compact === undefined ? false : p.compact;
    if (typeof compact !== 'boolean')
      throw new TypeError('lume: ColorPicker compact must be a boolean');
    var scale = compact ? 0.7 : 1;
    var hsv = hexToHsv(p.initialHex === undefined ? '#40D8B0' : p.initialHex);
    if (!hsv) {
      if (typeof console !== 'undefined' && console.warn) console.warn('lume: ColorPicker invalid initialHex; using #40D8B0');
      hsv = hexToHsv('#40D8B0');
    }
    var h = hsv.h, s = hsv.s, v = hsv.v, revision = signal(0);
    var lastEmit = -Infinity, pending = false, lastHex = hsvToHex(h,s,v), offs = [], closed = false;
    function redraw() { revision.set(revision()+1); }
    function emit(force) {
      var now = Date.now();
      if (p.onChange && (force || now-lastEmit >= 100)) { p.onChange(lastHex); lastEmit = now; pending = false; }
      else pending = true;
    }
    function set(nextH, nextS, nextV, immediate) {
      var next = hsvToHex(nextH,nextS,nextV);
      h = nextH; s = nextS; v = nextV;
      if (next !== lastHex) { lastHex = next; redraw(); emit(!!immediate); }
    }
    /* Local ring centre (150,110), annulus 82..98; strips x=30..270. */
    function hit(e) {
      if (!e || !isFinite(e.x) || !isFinite(e.y)) return null;
      var px=(e.x-x)/scale, py=(e.y-y)/scale, dx=px-150, dy=py-110, radius=Math.sqrt(dx*dx+dy*dy);
      if (radius >= 82 && radius <= 98) return {kind:'h', value:(Math.atan2(dy,dx)*180/Math.PI+360)%360};
      if (px >= 30 && px <= 270 && py >= 213 && py <= 249) return {kind:'s',value:(px-30)/240};
      if (px >= 30 && px <= 270 && py >= 263 && py <= 299) return {kind:'v',value:(px-30)/240};
      if (px >= 205 && px <= 282 && py >= 312 && py <= 356) return {kind:'confirm'};
      if (px >= 18 && px <= 88 && py >= 312 && py <= 356) return {kind:'dismiss'};
      return null;
    }
    function select(e, immediate) {
      var target=hit(e);
      if (!target) return;
      if (target.kind === 'h') set(target.value,s,v,immediate);
      else if (target.kind === 's') set(h,target.value,v,immediate);
      else if (target.kind === 'v') set(h,s,target.value,immediate);
    }
    var canvas = Canvas({parent:p.parent,width:Math.round(300*scale),height:Math.round(360*scale),
      style:{position:'absolute',x:x,y:y,scroll:'none'},onDraw:function (raw) {
        var c = scale === 1 ? raw : scaledPickerContext(raw, scale);
        revision();
        c.fillColor('#132435'); c.fillRect(0,0,300,360);
        for (var i=0;i<24;i++) c.arc(150,110,90,i*15,i*15+15,16,hsvToHex(i*15,1,1));
        var a=h*Math.PI/180;
        c.fillCircle(Math.round(150+90*Math.cos(a)),Math.round(110+90*Math.sin(a)),7,'#FFFFFF');
        c.fillCircle(150,110,55,lastHex);
        c.text(107,102,'COLOR',pickerInk(lastHex));
        c.text(12,224,'S','#F2F7FB');
        c.text(12,274,'V','#F2F7FB');
        for (var j=0;j<24;j++) {
          c.fillColor(hsvToHex(h,j/23,v)); c.fillRect(30+j*10,213,10,36);
          c.fillColor(hsvToHex(h,s,j/23)); c.fillRect(30+j*10,263,10,36);
        }
        c.fillColor('#FFFFFF'); c.fillRect(Math.round(30+s*240)-2,211,4,40);
        c.fillRect(Math.round(30+v*240)-2,261,4,40);
        c.fillColor(lastHex); c.fillRect(101,308,96,48);
        c.text(105,324,lastHex,pickerInk(lastHex));
        c.fillColor('#30445A'); c.fillRect(18,312,70,44); c.text(27,327,'CLOSE','#FFFFFF');
        c.fillColor('#40D8B0'); c.fillRect(205,312,77,44); c.text(220,327,'SAVE','#07111D');
      }});
    offs.push(lume.gesture.on(canvas,'tap',function (e) {
      var target=hit(e);
      if (!target) return;
      if (target.kind === 'confirm') { if (pending) emit(true); if (p.onConfirm) p.onConfirm(lastHex); }
      else if (target.kind === 'dismiss') { dispose(canvas); if (p.onDismiss) p.onDismiss(); }
      else select(e,true);
    }));
    offs.push(lume.gesture.on(canvas,'pan',select));
    offs.push(lume.gesture.on(canvas,'panend',function () { if (pending) emit(true); }));
    var offPause = lume.app.onPause(function () { if (!closed) dispose(canvas); });
    cleanups[canvas]=function () { closed=true; offPause(); offs.forEach(function (off) { off(); }); lume.removeChild(canvas); };
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
  /* r193: compact mint sparkline. Like the r151 form primitives, the data
   * lives in the caller's signal: pass a getter as `data` / `series` and read
   * it inside Canvas.onDraw, so the prelude's owned effect repaints on every
   * publish. The component only normalises sequence(s) into canvas pixels and
   * registers the canvas with the shell dispose chain -- no new subscription
   * mechanism and no internal data copy.
   *
   * RGB565 Canvas colours carry no alpha (__canvasColor accepts only #RRGGBB
   * or a 24-bit number), so fillArea paints the band under the curve in the
   * theme's surfaceAlt token instead of a translucent tint: a muted area
   * band using the existing line primitive, no new drawing primitive.
   *
   * `series` wins when both `data` and `series` are supplied. `data` is a
   * number[] (single line); `series` is [{data, color?, strokeWidth?}]. */
  var SPARK_POINTS = 240; /* prelude polyline() cap */
  var SPARK_PALETTE = ['#40D8B0', '#5AA9E6', '#FFC857', '#FF6B79'];
  function sparkColor(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value === 'function' || typeof value === 'string' || typeof value === 'number') {
      return function () { return typeof value === 'function' ? value() : value; };
    }
    throw new TypeError('lume: Sparkline color must be a #RRGGBB string or a signal function');
  }
  function sparkData(name, value) {
    var list = typeof value === 'function' ? value() : value;
    if (list === undefined) return [];
    if (!Array.isArray(list))
      throw new TypeError('lume: Sparkline ' + name + ' must be an array or a signal function');
    return list;
  }
  /* Skip non-finite samples and downsample long series to the polyline cap;
   * the first and last sample always survive. */
  function sparkClean(list) {
    var clean = [], i;
    for (i = 0; i < list.length; i++) {
      if (typeof list[i] === 'number' && isFinite(list[i])) clean.push(list[i]);
    }
    if (clean.length <= SPARK_POINTS) return clean;
    var out = [];
    for (i = 0; i < SPARK_POINTS; i++)
      out.push(clean[Math.floor(i * (clean.length - 1) / (SPARK_POINTS - 1))]);
    return out;
  }
  function Sparkline(p) {
    p = p || {};
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var width = positive('Sparkline width', p.width, Math.max(40, screen.w - 48), screen.w);
    var height = positive('Sparkline height', p.height, 96, screen.h);
    var strokeWidth = p.strokeWidth === undefined ? 2 : p.strokeWidth;
    if (!isFinite(strokeWidth) || Math.floor(strokeWidth) !== strokeWidth || strokeWidth < 1 || strokeWidth > 16)
      throw new RangeError('lume: Sparkline strokeWidth must be 1..16 pixels');
    var loProp = p.min, hiProp = p.max;
    if (loProp !== undefined && (typeof loProp !== 'number' || !isFinite(loProp)))
      throw new TypeError('lume: Sparkline min must be a finite number');
    if (hiProp !== undefined && (typeof hiProp !== 'number' || !isFinite(hiProp)))
      throw new TypeError('lume: Sparkline max must be a finite number');
    if (loProp !== undefined && hiProp !== undefined && hiProp <= loProp)
      throw new RangeError('lume: Sparkline requires min < max');
    if (p.colors !== undefined && !Array.isArray(p.colors))
      throw new TypeError('lume: Sparkline colors must be an array');
    var fillArea = p.fillArea === true, showDots = p.showDots === true, showLast = p.showLast === true;
    /* series wins when both are present (documented above). */
    var useSeries = p.series !== undefined;
    if (!useSeries && p.data !== undefined && typeof p.data !== 'function' && !Array.isArray(p.data))
      throw new TypeError('lume: Sparkline data must be an array or a signal function');
    if (useSeries && typeof p.series !== 'function' && !Array.isArray(p.series))
      throw new TypeError('lume: Sparkline series must be an array or a signal function');
    var dotR = showDots || showLast ? 3 : 0;
    var insetX = Math.max(1, Math.ceil(strokeWidth / 2));
    var insetY = Math.max(insetX, dotR);
    var spanX = Math.max(0, width - 2 * insetX);
    var spanY = Math.max(0, height - 2 * insetY);
    function resolve() {
      if (!useSeries) {
        return [{ data: sparkClean(sparkData('data', p.data)),
          color: sparkColor(p.color, color('accent', '#40D8B0')), strokeWidth: strokeWidth }];
      }
      var entries = sparkData('series', p.series);
      return entries.map(function (entry, i) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new TypeError('lume: Sparkline series entries must be objects');
        var fallback = i === 0 ? color('accent', '#40D8B0') :
          function () { return SPARK_PALETTE[i % SPARK_PALETTE.length]; };
        if (p.colors && p.colors[i] !== undefined) fallback = sparkColor(p.colors[i], fallback);
        var sw = entry.strokeWidth === undefined ? strokeWidth : entry.strokeWidth;
        if (!isFinite(sw) || Math.floor(sw) !== sw || sw < 1 || sw > 16)
          throw new RangeError('lume: Sparkline series strokeWidth must be 1..16 pixels');
        return { data: sparkClean(sparkData('series data', entry.data)),
          color: sparkColor(entry.color, fallback), strokeWidth: sw };
      });
    }
    var canvas = Canvas({ parent: p.parent, width: width, height: height,
      style: { x: p.x === undefined ? Math.floor((screen.w - width) / 2) : p.x,
        y: p.y === undefined ? 24 : p.y, scroll: 'none' },
      onDraw: function (c) {
        c.clear();
        var all = resolve(), lo = loProp, hi = hiProp, i, j;
        if (lo === undefined || hi === undefined) {
          var seen = false;
          all.forEach(function (s) { s.data.forEach(function (v) {
            if (!seen) { lo = v; hi = v; seen = true; }
            else { if (v < lo) lo = v; if (v > hi) hi = v; }
          }); });
          if (!seen) { lo = 0; hi = 1; } /* empty: clear only, degenerate below */
        }
        /* Flat sequence (lo == hi) degenerates to the vertical centre: no
         * division by zero, the line is a harmless horizontal segment. */
        var flat = !(hi > lo), range = hi - lo;
        var bottom = height - 1;
        var area = function () { return lume.theme.get().colors.surfaceAlt || '#1C3449'; };
        all.forEach(function (s) {
          var n = s.data.length;
          if (!n) return; /* empty / all non-finite: nothing to draw */
          var pts = [];
          for (i = 0; i < n; i++) {
            var x = n === 1 ? Math.round(width / 2) : insetX + Math.round(spanX * i / (n - 1));
            var y = flat ? Math.round(height / 2) :
              insetY + Math.round(spanY * (1 - (s.data[i] - lo) / range));
            if (y < insetY) y = insetY;
            else if (y > bottom - insetY) y = bottom - insetY;
            pts.push([x, y]);
          }
          var ink = s.color();
          if (fillArea && n > 1) {
            /* One vertical stroke per integer column from the curve to the
             * bottom edge; line() batches them, no polygon primitive needed. */
            for (j = 0; j < pts.length - 1; j++) {
              var x1 = pts[j][0], y1 = pts[j][1], x2 = pts[j + 1][0], y2 = pts[j + 1][1];
              for (var sx = x1; sx <= x2; sx++) {
                var f = x2 === x1 ? 0 : (sx - x1) / (x2 - x1);
                var sy = Math.round(y1 + (y2 - y1) * f);
                c.line(sx, sy, sx, bottom, area(), 1);
              }
            }
          }
          if (n > 1) c.polyline(pts, ink, s.strokeWidth);
          if (showDots) pts.forEach(function (pt) { c.fillCircle(pt[0], pt[1], 2, ink); });
          if (showLast) {
            var last = pts[n - 1];
            c.fillCircle(last[0], last[1], dotR, ink);
          }
        });
      } });
    cleanups[canvas] = function () { lume.removeChild(canvas); };
    return canvas;
  }
  function Launcher(p) {
    p = p || {};
    /* r204: 'round' is opt-in. 'square' keeps every legacy default exactly. */
    var shape = p.shape === undefined ? 'square' : p.shape;
    if (shape !== 'square' && shape !== 'round')
      throw new TypeError('lume: Launcher shape must be square or round');
    var round = shape === 'round';
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
    /* r162: every edit-mode transition goes through this one helper so a host
     * onEditingChange observer sees exactly the two real change points (edit
     * button toggle, EdgeNavigation back-out). No effect subscription: that
     * would misreport false on the first frame and tangle dispose ordering.
     * No try/catch, matching every other shell callback (exceptions surface). */
    function setEditing(v) { editing.set(v); if (p.onEditingChange) p.onEditingChange(v); }
    var root = View({ parent: p.parent, style: { width: '100%', height: 480,
      background: '#000000', scroll: 'none' } });
    var barOpts = { parent: root, left: p.title || 'Lume',
      right: p.right === undefined ? function () { var v = lume.pmic.battPercent(); return v >= 0 && v <= 100 ? 'battery ' + v + '%' : 'battery --'; } : p.right };
    /* StatusBar's own round geometry uses the same safeInsets() as SafeArea. */
    if (round) { barOpts.shape = 'round'; barOpts.height = 48; }
    var bar = p.statusBar === false ? null : StatusBar(barOpts);
    /* Round defaults derive from the 466 round screen's 339x339 inscribed
     * square (safeInsets('round', 480)); square defaults are the legacy
     * byte-for-byte values. */
    var screen = typeof __lumeScreen === 'object' ? __lumeScreen : {w:480,h:480};
    var insets = round ? safeInsets('round', screen.w) : null;
    var bx = round ? insets.left : 0, by = round ? insets.top : 0;
    var side = round ? screen.w - insets.left - insets.right : 480;
    var roundTop = by + (bar === null ? 8 : 56);
    var geo = round
      ? { top: roundTop, listTop: roundTop + 64, editX: bx + side - 64,
          listX: bx + 8, listWidth: side - 16, listHeight: by + side - 8 - roundTop - 64,
          itemHeight: 70, rowHeight: 70, cellHeight: 68, icon: 44, pad: 0, gap: 2,
          titleX: bx + 8, titleY: by + 8 }
      : { top: bar === null ? 24 : 96, listTop: bar === null ? 96 : 168,
          editX: 400, listX: 24, listWidth: 432, listHeight: 456 - (bar === null ? 96 : 168),
          itemHeight: 84, rowHeight: 96, cellHeight: 94, icon: 48, pad: undefined, gap: undefined,
          titleX: 24, titleY: 40 };
    if (bar === null) Text({ parent: root, text: p.title || 'Lume',
      style: { x: geo.titleX, y: geo.titleY } });
    Button({ parent: root, title: function () { return editing() ? 'done' : 'edit'; },
      style: { x: geo.editX, y: geo.top, width: 56, height: 56 },
      onPress: function () { setEditing(!editing()); } });
    var rows = [];
    for (var i = 0; i < apps.length; i += columns) rows.push(apps.slice(i, i + columns));
    var list = List({ parent: root,
      style: { x: geo.listX, y: geo.listTop, width: geo.listWidth, height: geo.listHeight,
        background: '#000000', scrollbar: 'auto' },
      items: rows, itemHeight: geo.itemHeight, overscan: 1,
      renderItem: function (row) {
        var rowStyle = { display: 'flex', flexDirection: 'row',
          justifyContent: 'space-evenly', width: '100%', height: geo.rowHeight, scroll: 'none' };
        if (round) { rowStyle.padding = geo.pad; rowStyle.gap = geo.gap; }
        return View({ style: rowStyle }, row.map(function (app) {
          var cellStyle = { display: 'flex', flexDirection: 'column',
            alignItems: 'center', width: Math.floor(geo.listWidth / columns), height: geo.cellHeight, scroll: 'none',
            opacity: function () { return launching() === app.id ? 0.55 : 1; } };
          if (round) { cellStyle.padding = geo.pad; cellStyle.gap = geo.gap; }
          var glyph = String(app.icon || app.glyph || app.label || '').slice(0, 1);
          return View({ style: cellStyle, onPress: function () {
            if (editing()) return;
            launching.set(app.id);
            /* Default to a real runtime switch; a host callback overrides. */
            if (p.onLaunch) p.onLaunch(app.id);
            else if (lume.apps && typeof lume.apps.launch === 'function') lume.apps.launch(app.id);
          } }, [
            Canvas({ width: geo.icon, height: geo.icon,
              style: round ? { scroll: 'none' } : { borderRadius: 24 },
              onDraw: function (c) {
                c.clear();
                if (round) {
                  /* r200 launcher_grid badge: filled circle + token-colour ring
                   * + crisp centred white glyph. app.ring is a token colour. */
                  var r = geo.icon / 2;
                  c.fillCircle(r, r, r - 2, app.color || '#1F2C3D');
                  c.circle(r, r, r - 3, app.ring || '#40D8B0', 2);
                  c.text(r - 5, r - 7, glyph, '#F2F7FB');
                } else {
                  c.fillColor(app.color || '#385CA5'); c.fillRect(2, 2, 44, 44);
                  c.text(17, 18, glyph, '#FFFFFF');
                }
              } }),
            Text({ text: app.label || app.id || '', style: {} }),
          ]);
        }));
      },
    });
    var edge = EdgeNavigation({ parent: root, indicator: p.indicator,
      onBack: function () { if (editing()) { setEditing(false); return true; } return p.onBack ? p.onBack() : false; },
      onPageSwipe: p.onPageSwipe });
    cleanups[root] = function () { if (bar !== null) dispose(bar); dispose(edge); };
    return root;
  }
  shell.StatusBar = StatusBar;
  shell.Keyboard = Keyboard;
  shell.Switch = Switch;
  shell.ClickWheel = ClickWheel;
  shell.ColorPicker = ColorPicker;
  shell.hsvToHex = hsvToHex;
  shell.hexToHsv = hexToHsv;
  shell.Slider = Slider;
  shell.Progress = Progress;
  shell.Sparkline = Sparkline;
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
