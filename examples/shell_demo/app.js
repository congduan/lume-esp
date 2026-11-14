/** Status bar and edge navigation; the host controls the active page. */
import '../../runtime/shell.js';

const page = signal(0);
const pages = ['Home', 'Sensors', 'Settings'];
View({ style: { width: '100%', height: 480, background: '#0B1E3F', scroll: 'none' } }, [
  Text({ text: () => pages[page()], style: { x: 150, y: 185 } }),
  Text({ text: () => 'page ' + (page() + 1) + ' / 3', style: { x: 180, y: 220 } }),
  Button({ title: 'Next', style: { x: 190, y: 300, width: 100, height: 40 },
    onPress: () => page.set((page() + 1) % pages.length) }),
]);
lume.ui.shell.StatusBar({ left: 'Shell demo', right: () => 'page ' + (page() + 1),
  background: '#111111' });
lume.ui.shell.EdgeNavigation({
  onBack: () => { if (page() > 0) { page.set(page() - 1); return true; } return false; },
  onPageSwipe: dir => page.set((page() + (dir === 'left' ? 1 : -1) + pages.length) % pages.length),
  indicator: true,
});
