import { mkdir, writeFile, access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const template = {
  'app.js': `// Lume provides these globals after its embedded prelude loads.\nconst count = signal(0);\nView({ style: { width: '100%', height: '100%', background: '#0B1E3F' } }, [\n  Text({ text: () => 'Taps: ' + count() }),\n  Button({ title: 'Tap', onPress: () => count.set(count() + 1) }),\n]);\n`,
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', allowJs: true, checkJs: false, noEmit: true }, include: ['app.js'] }, null, 2) + '\n',
  '.gitignore': 'node_modules/\ndist/\n',
};

export async function create(dir) {
  const root = resolve(dir);
  try { await access(root); throw new Error(`destination already exists: ${root}`); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  await mkdir(root, { recursive: true });
  const name = basename(root).toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'lume-app';
  const simulator = resolve(fileURLToPath(new URL('../simulator/sim.js', import.meta.url)));
  const files = { ...template, 'package.json': JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', scripts: { sim: `node "${simulator}" app.js` }, lume: { entry: 'app.js' } }, null, 2) + '\n' };
  await Promise.all(Object.entries(files).map(([file, data]) => writeFile(resolve(root, file), data, { flag: 'wx' })));
  return root;
}
