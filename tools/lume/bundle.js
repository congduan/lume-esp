import { build } from 'esbuild';
import { access, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { MAX_PAYLOAD } from './protocol.js';

export async function bundle(dir, { minify = true } = {}) {
  const root = resolve(dir);
  const pkgPath = join(root, 'package.json');
  let entry = 'app.js';
  try { entry = JSON.parse(await readFile(pkgPath, 'utf8')).lume?.entry ?? entry; }
  catch (err) { if (err.code !== 'ENOENT') throw new Error(`invalid ${pkgPath}: ${err.message}`); }
  const entryPath = resolve(root, entry);
  const rel = relative(root, entryPath);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('lume.entry must stay inside the app directory');
  await access(entryPath);
  const result = await build({
    entryPoints: [entryPath], absWorkingDir: root, bundle: true, format: 'iife',
    platform: 'neutral', target: 'es2020', minify, write: false,
    logLevel: 'silent', charset: 'utf8',
  });
  const bytes = Buffer.from(result.outputFiles[0].contents);
  if (!bytes.length || bytes.length > MAX_PAYLOAD) throw new Error(`bundle must be 1..${MAX_PAYLOAD} bytes (got ${bytes.length})`);
  return bytes;
}
