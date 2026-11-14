/** Theme-switching counter; firmware embeds this exact app in lume_demo_js. */
var darkTheme = { colors: {
  primary: '#0B1E3F', surface: '#24476D', accent: '#386DA1', text: '#FFFFFF'
}, radius: 12, fontScale: 1 };
var lightTheme = { colors: {
  primary: '#E9F2FA', surface: '#FFFFFF', accent: '#A4C7E5', text: '#23425F'
}, radius: 12, fontScale: 1 };
lume.theme.set(darkTheme);
var count = signal(0);
var dim = signal(false);
var darkButton, lightButton;   /* named globals: tests press them directly */

/* Layout: one flex column fills the panel; the 40 px padding is the
 * round-corner safe inset, and the theme buttons share the row evenly. */
var card = View({ style: {
  width: '100%', height: 120, background: 'surface', borderRadius: 12,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 6,
  opacity: function () { return dim() ? 0.55 : 1; }
} }, [
  Text({ text: function () { return 'taps: ' + count(); }, style: {} })
]);

View({ style: {
  width: '100%', height: '100%', background: 'primary',
  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  padding: 40, gap: 12
} }, [
  card,
  View({ style: { display: 'flex', flexDirection: 'row', gap: 12, width: '100%', height: 56 } }, [
    darkButton = Button({ title: 'Dark', style: { flexGrow: 1, height: 56, borderRadius: 12 },
             onPress: function () { lume.theme.set(darkTheme); } }),
    lightButton = Button({ title: 'Light', style: { flexGrow: 1, height: 56, borderRadius: 12 },
             onPress: function () { lume.theme.set(lightTheme); } })
  ]),
  Button({ title: 'Count', style: { width: '100%', height: 64, borderRadius: 12 },
           onPress: function () { count.set(count() + 1); dim.set(count() % 2 === 1); } })
]);
