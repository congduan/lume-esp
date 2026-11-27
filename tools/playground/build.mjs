import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'website/playground');
const require = createRequire(join(root, 'tools/lume/package.json'));
const { build } = require('esbuild');
const apps = ['counter', 'clock', 'clock_round', 'dashboard_round', 'games_snake', 'games_2048', 'games_breakout',
  'games_tetris', 'mario', 'game_of_life', 'pet', 'calculator', 'weather', 'music_player',
  'dashboard', 'gravity_ball', 'typewriter', 'heart_curve', 'speedometer', 'power_demo', 'luna',
  'watchface', 'async_demo', 'piano', 'compass', 'invaders', 'frogger', 'abc123', 'sokoban', 'lcd_dual', 'memory', 'minesweeper', 'golf', 'scroller', 'raycast', 'fishtank', 'particles', 'voice_assistant', 'spectrum_music', 'plasma', 'skyfire', 'skycombat', 'aurora_clock', 'flapdot', 'wordring',
  'image_gallery', 'files', 'adc_meter', 'crypto_check', 'archive_view', 'img_view', 'vec_demo', 'settings', 'hr_monitor', 'keyboard_demo', 'wordle', 'controls_demo', 'timer_kit', 'control_center', 'launcher_grid', 'minigolf', 'ipod_music', 'color_demo', 'ble_uart', 'spectrum', 'svg_icon', 'gestures',
  'storybook', 'mochi', 'shell_demo', 'sparkline_demo',
  'app_manager', 'imu_poll', 'fitness'];
export function manifestApps() { return [...apps]; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
// r194: lume_scripts.c became a #include placeholder in 920ee22 -- the C
// arrays are generated at firmware build time. Read the same prelude source JS
// that gen_lume_scripts.py embeds, using its SCRIPTS tuple as the single source
// of truth for the filename (same approach as tests/lib/prelude_runner.js).
// gen_lume_scripts.py's c_string() is a lossless round-trip for these files:
// direct reads are byte-identical to the generated C array's parsed payload.
const generator = await readFile(join(root, 'firmware/components/lume-engine/gen_lume_scripts.py'), 'utf8');
const scriptsBlock = generator.match(/SCRIPTS\s*=\s*\(\n([\s\S]*?)^\)$/m);
if (!scriptsBlock) throw new Error('cannot parse SCRIPTS from gen_lume_scripts.py');
const scripts = {};
for (const m of scriptsBlock[1].matchAll(/["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) {
  scripts[m[1]] = m[2];
}
const preludeFile = scripts.lume_prelude_js;
if (!preludeFile) throw new Error('missing lume_prelude_js in gen_lume_scripts.py');
const prelude = await readFile(join(root, 'firmware/components/lume-engine/prelude', preludeFile), 'utf8');
if (!prelude.includes('function __lume_dispatchPress(')) throw new Error('incomplete prelude');
await mkdir(join(out, 'apps'), { recursive: true });
await mkdir(join(out, 'sources'), { recursive: true });
await mkdir(join(out, 'vendor'), { recursive: true });
const wasmRoot = join(root, 'tools/lume/node_modules/esbuild-wasm');
await copyFile(join(wasmRoot, 'esbuild.wasm'), join(out, 'vendor/esbuild.wasm'));
await copyFile(join(wasmRoot, 'lib/browser.min.js'), join(out, 'vendor/esbuild.js'));
const sources = {};
await writeFile(join(out, 'prelude.js'), `/* Generated from firmware/components/lume-engine/lume_scripts.c by tools/playground/build.mjs. */\nwindow.LUME_PRELUDE = ${JSON.stringify(prelude)};\n`);
for (const name of apps) {
  const raw = await readFile(join(root, 'examples', name, 'app.js'), 'utf8');
  sources[name] = raw;
  await writeFile(join(out, 'sources', `${name}.js`), raw);
  const result = await build({ entryPoints: [join(root, 'examples', name, 'app.js')],
    bundle: true, format: 'iife', platform: 'neutral', target: 'es2020',
    minify: true, write: false, logLevel: 'silent', charset: 'utf8' });
  const code = result.outputFiles[0].text;
  await writeFile(join(out, 'apps', `${name}.js`), `window.LUME_APPS[${JSON.stringify(name)}] = ${JSON.stringify(code)};\n`);
  console.log(`PASS bundle ${name} ${Buffer.byteLength(code)} bytes`);
}
await writeFile(join(out, 'sources.js'), `window.LUME_SOURCES = ${JSON.stringify(sources)};\n`);
console.log(`PASS esbuild-wasm assets and ${apps.length} editable sources`);
console.log(`PASS prelude ${Buffer.byteLength(prelude)} bytes; ${apps.length} apps`);

}
