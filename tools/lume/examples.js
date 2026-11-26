/**
 * lume examples - machine-readable metadata catalog for agent authors (r207).
 *
 * The single source of truth for per-app display metadata is
 * `website/playground/page.js` (the `examples` array inside its IIFE). This
 * module parses that array out at runtime - zero duplicated labels - and joins
 * it with:
 *   - `manifestApps()` from tools/playground/build.mjs (the playground
 *     manifest; what the website actually ships)
 *   - the real `examples/` directory listing (what exists on disk)
 *
 * Output shape (one JSON object per line, NDJSON):
 *   { name, icon, en, cn, descriptionEn, descriptionZh, registered,
 *     metaSource }  per app; final line { summary: { total, registered,
 *     unregistered, missingMeta, missingOnDisk } }
 *
 * Contract decisions:
 *   - Parse, never copy: if page.js changes shape the parse throws with a
 *     pointed error instead of silently returning stale metadata.
 *   - Read-only: no board, no network, no writes.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestApps } from '../playground/build.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PAGE_JS = join(ROOT, 'website/playground/page.js');

/** Extract the `examples` array literal from page.js and evaluate it safely. */
export async function parsePageExamples(pageSource = null) {
  const src = pageSource ?? await readFile(PAGE_JS, 'utf8');
  const m = src.match(/const examples = \[([\s\S]*?)\n  \];/);
  if (!m) throw new Error('lume examples: cannot locate "const examples = [...]" in website/playground/page.js - page.js shape changed, update the parser');
  // The array literal contains only string/array literals; evaluate in a
  // sandboxed Function with no access to page scope.
  const entries = Function(`"use strict"; return [${m[1]}];`)();
  if (!Array.isArray(entries) || !entries.length)
    throw new Error('lume examples: page.js examples array is empty or malformed');
  for (const e of entries) {
    if (!Array.isArray(e) || e.length !== 6 || e.some(v => typeof v !== 'string'))
      throw new Error('lume examples: page.js entry is not a 6-string tuple: ' + JSON.stringify(e));
  }
  return entries;
}

/**
 * Build the catalog. `names` defaults to manifestApps() joined with the real
 * examples/ directory (both sources are included; registration status is a
 * per-app flag, not a filter).
 */
export async function catalog(deps = {}) {
  const entries = await (deps.parseExamples ?? parsePageExamples)();
  const manifest = deps.manifestApps ? deps.manifestApps() : manifestApps();
  return catalogImpl(entries, manifest, deps);
}

async function catalogImpl(entries, manifest, deps) {
  const fs = await import('node:fs/promises');
  const dirEntries = await fs.readdir(join(ROOT, 'examples'), { withFileTypes: true });
  const onDisk = deps.examplesDir ?? dirEntries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const byName = new Map(entries.map(e => [e[0], e]));
  const manifestSet = new Set(manifest);
  const diskSet = new Set(onDisk);
  const rows = [];
  const seen = new Set();
  const order = [...new Set([...manifest, ...onDisk])];
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const e = byName.get(name);
    rows.push({
      name,
      icon: e ? e[1] : '?',
      en: e ? e[2] : name,
      cn: e ? e[3] : name,
      descriptionEn: e ? e[4] : name,
      descriptionZh: e ? e[5] : name,
      registered: manifestSet.has(name),
      metaSource: e ? 'page.js' : 'fallback',
    });
  }
  const missingMeta = rows.filter(r => r.metaSource === 'fallback').map(r => r.name);
  const missingOnDisk = manifest.filter(n => !diskSet.has(n));
  const summary = {
    total: rows.length,
    registered: rows.filter(r => r.registered).length,
    unregistered: rows.filter(r => !r.registered).length,
    missingMeta: missingMeta.length,
    missingOnDisk: missingOnDisk.length,
  };
  return { rows, summary, missingOnDisk, missingMeta };
}

export function renderCatalog({ rows, summary }, { json = false } = {}) {
  const lines = [];
  if (json) {
    for (const r of rows) lines.push(JSON.stringify(r));
  } else {
    for (const r of rows) {
      const flag = r.registered ? '+' : '-';
      const label = `${r.en} / ${r.cn}`;
      lines.push(`${flag} ${r.name.padEnd(18)} ${label}  ${r.descriptionEn}`);
    }
  }
  lines.push(JSON.stringify({ summary }));
  return lines.join('\n') + '\n';
}
