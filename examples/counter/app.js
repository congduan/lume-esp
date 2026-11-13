/**
 * Lume M1 demo app — runs entirely in JS (compiled to QuickJS bytecode).
 * This is the source form; the firmware embeds its compiled bytecode as the
 * fallback bundle until hot reload lands.
 *
 * Demo: interactive button counter — proves engine boot, touch events,
 * and the declarative UI bridge in one loop.
 */

const { View, Text, Button } = lume.ui;
const { log } = lume.system;

let count = 0;

const root = View({ style: { background: '#000000', padding: 40 } }, [
  Text({ text: 'Lume', style: { fontSize: 48, color: '#ffffff' } }),
  Text({ id: 'counter', text: 'taps: 0', style: { fontSize: 24, color: '#888888' } }),
  Button({ title: '+1', onPress: () => {
    count++;
    root.setState('counter', { text: 'taps: ' + count });
    log('tap -> ' + count);
  }}),
]);

lume.start(root);
