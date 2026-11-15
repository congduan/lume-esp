import { readFile } from 'node:fs/promises';

/* Error markers verified against a real esp32sim serial.log and
 * firmware/components/lume-engine/lume_engine.c (dump_js_exception / eval_buf):
 *   E (..) lume-engine: JS exception [<lume-app>]: TypeError: not a function
 *   E (..) lume-engine: JS stack [<lume-app>]:     at <anonymous> (<lume-app>:1:14)
 *   W (..) lume-engine: reload/launch eval failed for ''
 * A later "app eval ok" can come from the HOME fallback after a failed app
 * eval, so success is never inferred from that line alone. The OTA reply
 * "RELOAD ERR <reason>" is optional (it is not emitted on the emu console). */
export const EVAL_FAIL_RE = /JS exception \[|reload\/launch eval failed|eval failed|RELOAD ERR/;
export const EVAL_OK_RE = /lume-engine: app eval ok; entering event loop/;
/* QuickJS-NG reports a missing member as "TypeError: not a function" without
 * naming the expression; only these shapes get an API-name spelling hint. */
export const MISSING_MEMBER_RE = /not a function|not defined|is undefined|cannot read|undefined/i;

/** Extract the raw eval error message and the bundled line number (if any). */
export function parseEvalError(log) {
  if (!log || !EVAL_FAIL_RE.test(log)) return null;
  const lines = log.split(/\r?\n/);
  let message = null, line = null, tag = null;
  for (const l of lines) {
    const ex = l.match(/JS exception \[([^\]]+)\]:\s*(.*)$/);
    if (ex && message === null) {
      tag = ex[1];
      message = ex[2].trim() || '(no message)';
    }
    const st = l.match(/JS stack \[[^\]]+\]:\s*(.*)$/);
    if (st && line === null) {
      const mm = st[1].match(/:(\d+):\d+\)/) || st[1].match(/:(\d+)\)/);
      if (mm) line = Number(mm[1]);
    }
  }
  if (message === null) {
    const rr = log.match(/RELOAD ERR\s+(.+)/);
    if (rr) message = rr[1].trim();
  }
  return { message: message ?? 'app eval failed (see serial log)', line, tag };
}

/* runtime/types/lume.d.ts declares one top-level `declare namespace lume.X {`
 * block per namespace; its closing brace sits at column 0 while nested
 * `namespace`/`interface` bodies are indented, so that boundary is reliable
 * for this file. Collect function / const / namespace member names per block. */
export function extractLumeCatalog(dtsText) {
  const lines = dtsText.split(/\r?\n/);
  const namespaces = new Map();
  const allMembers = new Set();
  const memberRe = /^\s*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*:|namespace\s+([A-Za-z_$][\w$]*)\s*\{)/;
  let i = 0;
  while (i < lines.length) {
    const head = lines[i].match(/^\s*declare namespace ([\w.]+)\s*\{/);
    if (!head) { i++; continue; }
    const name = head[1];
    if (!namespaces.has(name)) namespaces.set(name, new Set());
    const set = namespaces.get(name);
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^\}/.test(lines[j])) break;
      const m = lines[j].match(memberRe);
      const member = m && (m[1] ?? m[2] ?? m[3]);
      if (member) { set.add(member); allMembers.add(member); }
    }
    i = j + 1;
  }
  return { namespaces, allMembers };
}

/** Members declared by a namespace (exact first, then nested-block fallback). */
export function namespaceMembers(catalog, fullName) {
  if (catalog.namespaces.has(fullName)) return [...catalog.namespaces.get(fullName)];
  const merged = new Set();
  for (const [ns, set] of catalog.namespaces) {
    if (ns === fullName || ns.startsWith(fullName + '.')) {
      for (const member of set) merged.add(member);
    }
  }
  return [...merged];
}

export function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/* Find `lume.<...>.<member>` accesses whose final member is not declared in
 * that namespace by the .d.ts. Report the ORIGINAL source file/line so the
 * hint points at the app's own code, not the minified line QuickJS reports. */
export function findUnknownMembers(sources, catalog) {
  const found = [];
  const re = /\blume\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  for (const { file, text } of sources) {
    text.split(/\r?\n/).forEach((srcLine, idx) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(srcLine))) {
        const parts = m[1].split('.');
        const member = parts.pop();
        const ns = 'lume' + (parts.length ? '.' + parts.join('.') : '');
        const available = namespaceMembers(catalog, ns);
        if (available.length && !available.includes(member)) {
          found.push({ file, line: idx + 1, expression: 'lume.' + m[1],
                       namespace: ns, member, available });
        }
      }
    });
  }
  return found;
}

/** Nearest-neighbour (Levenshtein <= 2 or prefix) spelling hint. */
export function suggest(unknown) {
  const { member, available, namespace } = unknown;
  const lower = member.toLowerCase();
  const candidates = available
    .map(name => ({ name, d: levenshtein(lower, name.toLowerCase()),
                    prefix: name.toLowerCase().startsWith(lower) || lower.startsWith(name.toLowerCase()) }))
    .filter(c => c.d <= 2 || c.prefix)
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name));
  const list = available.join(', ');
  if (candidates.length) {
    return `did you mean ${namespace}.${candidates[0].name}? (available: ${list})`;
  }
  return `unknown member ${namespace}.${member} (available: ${list})`;
}

export async function readCatalog(dtsPath) {
  return extractLumeCatalog(await readFile(dtsPath, 'utf8'));
}
