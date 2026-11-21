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
  'dashboard', 'gravity_ball', 'typewriter', 'heart_curve', 'speedometer', 'power_demo',
  'watchface', 'async_demo', 'piano', 'compass', 'invaders', 'frogger', 'abc123', 'sokoban', 'lcd_dual', 'memory', 'minesweeper', 'golf', 'scroller', 'raycast', 'fishtank', 'particles', 'voice_assistant', 'spectrum_music', 'plasma', 'skyfire', 'aurora_clock', 'flapdot', 'wordring',
  'image_gallery', 'files', 'adc_meter', 'crypto_check', 'archive_view', 'img_view', 'vec_demo', 'settings', 'hr_monitor'];
const source = await readFile(join(root, 'firmware/components/lume-engine/lume_scripts.c'), 'utf8');
const start = 'const char lume_prelude_js[] =\n';
const part = source.split(start)[1];
if (!part) throw new Error('missing lume_prelude_js');
const block = part.split('\n\nconst char lume_demo_js')[0];
const prelude = [...block.matchAll(/^"(?:\\.|[^"\\])*"/gm)].map(m => JSON.parse(m[0])).join('');
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
