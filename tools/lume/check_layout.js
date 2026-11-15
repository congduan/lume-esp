import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const LAYOUT_SPEC_PATH = join(ROOT, 'tools/emu/layout_expectations.json');
const CHECK_LAYOUT = join(ROOT, 'tools/emu/check_layout.py');

/** True when layout_expectations.json has an entry for this app name. */
export async function hasLayoutSpec(appName, specPath = LAYOUT_SPEC_PATH) {
  try {
    const spec = JSON.parse(await readFile(specPath, 'utf8'));
    return Object.hasOwn(spec, appName);
  } catch { return false; }
}

/* check_layout.py prints one "PASS/FAIL Rn ..." line per assertion and a final
 * table with all seven rules. The table is authoritative (rules with no
 * assertions are vacuously PASS); fall back to aggregating per-rule lines. */
export function parseLayoutRules(stdout) {
  const lines = stdout.split(/\r?\n/);
  const header = lines.findIndex(l => /\bR1\b/.test(l) && /\bR7\b/.test(l));
  if (header >= 0) {
    for (let i = header + 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 8 && parts.slice(1, 8).every(v => v === 'PASS' || v === 'FAIL')) {
        const rules = {};
        ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].forEach((r, k) => { rules[r] = parts[k + 1]; });
        return rules;
      }
    }
  }
  const rules = {};
  for (const r of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) rules[r] = 'PASS';
  for (const l of lines) {
    const m = l.match(/^\s*FAIL\s+(R[1-7])\b/);
    if (m) rules[m[1]] = 'FAIL';
  }
  return rules;
}

/* Real CLI: check_layout.py <png> <spec.json> --app <name>. Bare `--app` is
 * not enough (the script needs both positionals); verified via --help. */
export async function runLayout(pngPath, appName, {
  specPath = LAYOUT_SPEC_PATH,
  script = CHECK_LAYOUT,
  python = 'python3',
} = {}) {
  if (!existsSync(pngPath)) return { ok: false, error: `screenshot missing: ${pngPath}` };
  const args = [script, resolve(pngPath), resolve(specPath), '--app', appName];
  return await new Promise(res => {
    const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => res({ ok: false, error: err.message }));
    child.on('close', code => {
      const rules = parseLayoutRules(stdout);
      const failed = Object.entries(rules).filter(([, v]) => v === 'FAIL').map(([r]) => r);
      const lastLine = stdout.trim() ? stdout.trim().split('\n').pop() : '';
      res({
        ok: code === 0 && failed.length === 0,
        exitCode: code, rules, failed,
        error: code !== 0 && failed.length === 0 ? (stderr.trim() || lastLine || `exit ${code}`) : null,
      });
    });
  });
}
