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
 *   { name, icon, en, cn, descriptionEn, descriptionZh, shape, registered,
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

/** Extract the `examples` array literal from page.js and parse it as data.
 *  r208 (Codex review fix #4): the previous implementation evaluated the
 *  captured text with `Function(...)`, which executes arbitrary expressions
 *  embedded in page.js. The array is specified as plain 7-string tuples
 *  (r226 added shape: 'round' | 'square'), so we parse it structurally: every
 *  element must be `[ 'str','str',... ]` with single-quoted simple strings,
 *  separated by commas/newlines. Anything else (an identifier, a call, a
 *  template literal) is a pointed parse error, not executable code. Duplicate
 *  or unmatched entries are rejected so page shape drift cannot silently
 *  change the catalog. */
export async function parsePageExamples(pageSource = null) {
  const src = pageSource ?? await readFile(PAGE_JS, 'utf8');
  const m = src.match(/const examples = \[([\s\S]*?)\n  \];/);
  if (!m) throw new Error('lume examples: cannot locate "const examples = [...]" in website/playground/page.js - page.js shape changed, update the parser');
  const entries = parseStringTuples(m[1]);
  if (!entries.length)
    throw new Error('lume examples: page.js examples array is empty or malformed');
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e[0]))
      throw new Error('lume examples: duplicate page.js entry: ' + e[0]);
    seen.add(e[0]);
  }
  return entries;
}

/* Strict tokenizer for the tuple-array body: only the grammar
 *   tuple   := '[' STRING (',' STRING)* ']'
 *   body    := (tuple | STRING-within-first-slot)*  separated by ',' / newlines
 * is accepted. Strings are single-quoted with backslash escapes; every other
 * token (identifiers, calls, backticks) throws. Returns string[] entries
 * (one per tuple). */
function parseStringTuples(body) {
  const entries = [];
  let i = 0;
  const n = body.length;
  const str = () => {
    /* at body[i] === "'" */
    let out = '';
    i++;
    for (;;) {
      if (i >= n) throw new Error('lume examples: unterminated string in page.js examples array');
      const c = body[i];
      if (c === '\\') {
        const next = body[i + 1];
        if (next === undefined) throw new Error('lume examples: bad escape at end of page.js examples array');
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        i += 2;
        continue;
      }
      if (c === "'") { i++; return out; }
      out += c;
      i++;
    }
  };
  for (;;) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    if (i >= n) break;
    if (body[i] !== '[') {
      throw new Error('lume examples: page.js entry is not a 7-string tuple (expected "[", got ' +
        JSON.stringify(body.slice(i, i + 20)) + ') - non-literal content is not allowed');
    }
    i++;
    const fields = [];
    for (;;) {
      while (i < n && /\s/.test(body[i])) i++;
      if (i >= n) throw new Error('lume examples: unterminated tuple in page.js examples array');
      if (body[i] === ']') { i++; break; }
      if (body[i] !== "'") {
        throw new Error('lume examples: page.js entry is not a 7-string tuple (non-string field) - non-literal content is not allowed');
      }
      fields.push(str());
      while (i < n && /\s/.test(body[i])) i++;
      if (body[i] === ',') { i++; continue; }
      if (body[i] === ']') { i++; break; }
      throw new Error('lume examples: malformed tuple separator in page.js examples array');
    }
    if (fields.length !== 7 || fields.some(v => typeof v !== 'string') ||
        (fields[6] !== 'round' && fields[6] !== 'square'))
      throw new Error('lume examples: page.js entry is not a 7-string tuple: ' + JSON.stringify(fields));
    entries.push(fields);
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
      shape: e && (e[6] === 'round' || e[6] === 'square') ? e[6] : 'square',
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
