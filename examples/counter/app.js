/** Theme-switching counter; firmware embeds this exact app in lume_demo_js. */
var darkTheme = { colors: {
  primary: '#0B1E3F', surface: '#24476D', accent: '#386DA1', text: '#FFFFFF'
}, radius: 12, fontScale: 1 };
var lightTheme = { colors: {
  primary: '#E9F2FA', surface: '#FFFFFF', accent: '#A4C7E5', text: '#23425F'
}, radius: 12, fontScale: 1 };
lume.theme.set(darkTheme);
var count = signal(0);
var cardY = signal(110);
var card = View({ style: {
  x: 24, y: cardY, width: 192, height: 80,
  background: 'surface', borderColor: 'text', borderWidth: 2, opacity: 1,
  transition: { property: 'y', durationMs: 300, easing: 'ease-out' }
} }, [Text({ text: function () { return 'taps: ' + count(); } })]);
var darkButton = Button({ title: 'Dark', style: {
  x: 16, y: 14, width: 96, height: 48, background: 'accent', borderColor: 'text', borderWidth: 1
}, onPress: function () { lume.theme.set(darkTheme); } });
var lightButton = Button({ title: 'Light', style: {
  x: 128, y: 14, width: 96, height: 48, background: 'accent', borderColor: 'text', borderWidth: 1
}, onPress: function () { lume.theme.set(lightTheme); } });
var countButton = Button({ title: 'Count', style: {
  x: 48, y: 220, width: 144, height: 48, background: 'accent', borderColor: 'text', borderWidth: 1
}, onPress: function () {
  count.set(count() + 1);
  cardY.set(count() % 2 ? 125 : 110);
} });
View({ style: { width: '100%', height: '100%', background: 'primary' } },
  [card, darkButton, lightButton, countButton]);
