/* Typewriter — 逐字打印机屏显效果 demo（r51）。
 * 三段文本逐字显示 + 闪烁光标；触屏跳过，打完重播。
 * 纯 app 层：lume.system.setInterval + signal text setter。
 * 已知边界（esp32sim 实证）：interval 回调里每拍 slice/join 新字符串会触发 QuickJS
 * InternalError: out of memory（8MB JS 堆在 66-125ms 节奏下碎片化，真机待 profile）——
 * 故回调里只做整数索引 signal set，字符串渲染交给 Text 绑定层按需拼接。 */
var darkTheme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(darkTheme);

var SEG_TEXTS = [
  'Hello, Lume!',
  'Typewriter effect: characters appear one by one. Tap to skip.',
  '> ready.'
];
var SEG_CPS = [8, 14, 6];

var pos = signal(0);           /* 全局字符位置（跨段累计） */
var cursorOn = signal(true);
var doneAll = signal(false);
var skipAll = signal(false);

/* 总字符数（按段边界累计） */
var TOTAL = 0, ACC = [];
for (var s = 0; s < SEG_TEXTS.length; s++) { ACC.push(TOTAL); TOTAL += SEG_TEXTS[s].length; }
/* 位置 → 画面文本：段间插入换行。O(segs) 字符串拼接，仅在 getter 求值时发生。 */
function render(p) {
  if (p >= TOTAL) { p = TOTAL; }
  var out = '';
  for (var s = 0; s < SEG_TEXTS.length; s++) {
    var start = ACC[s], end = SEG_TEXTS[s].length;
    var take = p - start;
    if (take <= 0) break;
    if (take > end) take = end;
    out += SEG_TEXTS[s].substring(0, take);
    if (p > start + end) out += '\n';
  }
  return out;
}

/* 光标闪烁 300ms */
lume.system.setInterval(function () { cursorOn.set(!cursorOn()); }, 300);

/* 打字循环：66ms/字 ≈ 15 字/秒；段间停 500ms */
var seg = 0;
function startSegment() {
  var segLen = SEG_TEXTS[seg].length;
  var k = 0;
  var id = lume.system.setInterval(function () {
    k++;
    if (skipAll()) k = segLen;
    pos.set(ACC[seg] + k);
    if (k >= segLen) {
      lume.system.clearInterval(id);
      seg++;
      if (seg >= SEG_TEXTS.length) {
        doneAll.set(true);
      } else {
        lume.system.setTimeout(startSegment, 500);
      }
    }
  }, Math.max(33, Math.round(1000 / SEG_CPS[seg])));
}
lume.app.onStart(startSegment);

function displayText() {
  var s = render(pos());
  return doneAll() ? s : s + (cursorOn() ? '|' : ' ');
}

var root = View({ style: {
  width:'100%', height:'100%', background:'bg', scroll:'none',
  display:'flex', flexDirection:'column', justifyContent:'center', padding:28, gap:16
}}, [
  View({ style: {
    width:'100%', height:'100%', background:'surface', borderRadius:20,
    display:'flex', flexDirection:'column', justifyContent:'center', padding:20, gap:12
  }, onPress: function () {
    if (doneAll()) {
      doneAll.set(false); skipAll.set(false); seg = 0; pos.set(0);
      startSegment();
    } else {
      skipAll.set(true);
    }
  }}, [
    Text({ text: 'TYPEWRITER', style: { fontSize: 13, color: 'textDim' } }),
    Text({ text: displayText, style: { fontSize: 20, color: 'text' } }),
    Text({ text: function () {
      return doneAll() ? 'tap to replay' : 'tap to skip';
    }, style: { fontSize: 12, color: 'textDim' } })
  ])
]);
