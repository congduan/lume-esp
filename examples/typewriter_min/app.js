var darkTheme = { colors: { bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449', text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0' }, radius:12, spacing:12, fontScale:1 };
lume.theme.set(darkTheme);
var shown = signal('');
var t = Text({ text: function(){ return shown(); }, style: { fontSize: 20, color: 'text' } });
var n = 0;
lume.system.setInterval(function () { n++; shown.set('x'.repeat(n)); }, 100);
