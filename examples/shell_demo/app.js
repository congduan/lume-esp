/** Status bar and edge navigation; the host controls the active page.
 *  The page content is centered by flex; StatusBar/EdgeNavigation are layered
 *  on top (created after the root so they stay on top of it). */
import '../../runtime/shell.js';

const page = signal(0);
const pages = ['Home', 'Sensors', 'Settings'];

View({ style: {
  width: '100%', height: '100%', background: '#0B1E3F', scroll: 'none',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 16
} }, [
  Text({ text: () => pages[page()], style: { textAlign: 'center' } }),
  Text({ text: () => 'page ' + (page() + 1) + ' / 3', style: {} }),
  Button({ title: 'Next', style: { width: 180, height: 48, borderRadius: 12 },
    onPress: () => page.set((page() + 1) % pages.length) }),
]);

lume.ui.shell.StatusBar({ left: 'Shell demo', right: () => 'page ' + (page() + 1),
  background: '#111111' });
lume.ui.shell.EdgeNavigation({
  onBack: () => { if (page() > 0) { page.set(page() - 1); return true; } return false; },
  onPageSwipe: dir => page.set((page() + (dir === 'left' ? 1 : -1) + pages.length) % pages.length),
  indicator: true,
});
