/** Basic calculator — 4 operations, decimals, clear and backspace.
 * State-machine core (acc/op/cur/fresh) with signal-driven display texts;
 * button grid is a flex layout sized for the 480x480 panel's 40 px safe inset. */
var calcTheme = { colors: {
  primary: '#0F1115', surface: '#1C1F26', accent: '#2E86FF', text: '#F2F5FA'
}, radius: 14, fontScale: 1 };
lume.theme.set(calcTheme);

/* ---- state (plain values; only the two display strings are signals) ---- */
var acc = null;      /* pending left operand (number) or null */
var op = null;       /* pending operator: '+' '-' '*' '/' */
var cur = '0';       /* what the main line shows */
var fresh = true;    /* next digit starts a new number */
var err = false;     /* latched until AC or a digit */

var dispMain = signal('0');
var dispExpr = signal('');

var MAX_DIGITS = 12;

function fmt(v) {
  /* round away float artifacts, then trim: 0.1+0.2 -> 0.3 */
  var s = String(parseFloat(v.toPrecision(10)));
  return s.length > MAX_DIGITS + 2 ? v.toExponential(6) : s;
}

function apply() {
  var a = acc, b = parseFloat(cur);
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b === 0 ? NaN : a / b;
  return b;
}

function refresh() {
  dispMain.set(err ? 'Error' : cur);
  var line = acc !== null && op !== null ? fmt(acc) + ' ' + op : '';
  dispExpr.set(err ? '' : line);
}

function pressDigit(d) {
  if (err) { acc = null; op = null; cur = '0'; fresh = true; err = false; }
  if (fresh) { cur = d === '.' ? '0.' : d; fresh = false; }
  else if (d === '.') {
    if (cur.indexOf('.') !== -1) return;
    cur += '.';
  } else if (cur.replace('-', '').replace('.', '').length < MAX_DIGITS) {
    if (cur === '0') cur = d;
    else if (cur === '-0') cur = '-' + d;
    else cur += d;
  }
  refresh();
}

function pressOp(o) {
  if (err) return;
  if (op !== null && !fresh) {
    var r = apply();
    if (!isFinite(r)) { err = true; refresh(); return; }
    acc = r; cur = fmt(r);
  } else if (acc === null) {
    acc = parseFloat(cur);
  }
  /* op !== null && fresh -> user just changed their mind, keep acc */
  op = o; fresh = true;
  refresh();
}

function pressEq() {
  if (err || op === null || fresh) return;
  var r = apply();
  if (!isFinite(r)) { err = true; refresh(); return; }
  cur = fmt(r); acc = null; op = null; fresh = true;
  refresh();
}

function pressBack() {
  if (err) { acc = null; op = null; cur = '0'; fresh = true; err = false; refresh(); return; }
  if (fresh || cur.length <= 1 || cur === '0') { cur = '0'; refresh(); return; }
  cur = cur.slice(0, -1);
  refresh();
}

function pressClear() {
  acc = null; op = null; cur = '0'; fresh = true; err = false;
  refresh();
}

/* ---- styles ---- */
var C_KEY = '#242830';     /* digits */
var C_FN = '#2E3340';      /* operators, backspace */
var C_AC = '#B3453C';      /* clear */
var C_EQ = '#2E86FF';      /* equals */

/* Key rows use fixed heights: percent heights resolve against the parent's
 * content box (5x '100%' would overflow), and fixed px works in both LVGL
 * and the browser renderer. 120 + 12 + 5x45 + 4x10 = 397 <= 400 content. */
var KEY_H = 45;

function key(label, bg, flexGrow, onPress) {
  return Button({
    title: label,
    style: { flexGrow: flexGrow || 1, height: KEY_H, borderRadius: 14, background: bg },
    onPress: onPress
  });
}
function digit(d) { return key(d, C_KEY, 1, function () { pressDigit(d); }); }

function keyRow(children) {
  return View({ style: { display: 'flex', flexDirection: 'row', gap: 10,
                         width: '100%', height: KEY_H } }, children);
}

/* ---- display: small expression line over seven-segment digits ----
 * Style has no fontSize (Typography is deferred), so the big main line is
 * drawn as 7-segment digits on a canvas: <=13 chars x ~5 rects stays under
 * the ~100-primitive redraw budget. Cells are 26 px wide / 32 px tall. */
var SEG_W = 26, SEG_X0 = 4, SEG_H = 32;
var SEG_RECTS = {
  a: [2, 0, 14, 4], b: [14, 2, 4, 11], c: [14, 17, 4, 11],
  d: [2, 28, 14, 4], e: [0, 17, 4, 11], f: [0, 2, 4, 11], g: [2, 14, 14, 4]
};
var SEG_MAP = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g', 'E': 'afged', 'r': 'eg', 'o': 'cdeg'
};
function segAdvance(ch) { return ch === '.' ? 18 : SEG_W; }

function drawMainDisplay(c) {
  var text = dispMain();
  var color = text === 'Error' ? '#F87171' : '#F2F5FA';
  c.clear();
  /* clear() paints black; repaint the card surface so the canvas blends in */
  c.fillColor('#1C1F26');
  c.fillRect(0, 0, 368, 44);
  c.fillColor(color);
  /* right-align inside the canvas; overflow past the left edge is clipped */
  var total = 0;
  for (var i = 0; i < text.length; i++) total += segAdvance(text[i]);
  var x = 368 - 4 - total;
  for (var j = 0; j < text.length; j++) {
    var ch = text[j], cx = x + SEG_X0, cy = 4;
    if (ch === '.') c.fillRect(cx + 12, cy + 26, 5, 4);
    else {
      var segs = SEG_MAP[ch];
      if (segs) for (var k = 0; k < segs.length; k++) {
        var r = SEG_RECTS[segs[k]];
        c.fillRect(cx + r[0], cy + r[1], r[2], r[3]);
      }
    }
    x += segAdvance(ch);
  }
}

View({ style: {
  width: '100%', height: '100%', background: 'primary',
  display: 'flex', flexDirection: 'column', padding: 40, gap: 12
} }, [
  View({ style: {
    width: '100%', height: 120, background: 'surface', borderRadius: 14,
    display: 'flex', flexDirection: 'column', alignItems: 'end',
    justifyContent: 'center', padding: 16, gap: 6
  } }, [
    Text({ text: function () { return dispExpr(); }, style: { textAlign: 'right', width: '100%', opacity: 0.55 } }),
    Canvas({ width: 368, height: 44, onDraw: drawMainDisplay })
  ]),
  View({ style: {
    display: 'flex', flexDirection: 'column', gap: 10, width: '100%',
    height: 'auto'
  } }, [
    keyRow([
      key('AC', C_AC, 1, pressClear),
      key('DEL', C_FN, 1, pressBack),
      key('/', C_FN, 1, function () { pressOp('/'); }),
      key('*', C_FN, 1, function () { pressOp('*'); })
    ]),
    keyRow([
      digit('7'), digit('8'), digit('9'),
      key('-', C_FN, 1, function () { pressOp('-'); })
    ]),
    keyRow([
      digit('4'), digit('5'), digit('6'),
      key('+', C_FN, 1, function () { pressOp('+'); })
    ]),
    keyRow([
      digit('1'), digit('2'), digit('3'),
      key('=', C_EQ, 1, pressEq)
    ]),
    keyRow([
      key('0', C_KEY, 3, function () { pressDigit('0'); }), /* spans 3 columns */
      key('.', C_KEY, 1, function () { pressDigit('.'); })
    ])
  ])
]);
