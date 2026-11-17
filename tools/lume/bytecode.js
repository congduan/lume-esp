// r43b: host-side app-bundle bytecode compilation for `lume deploy --bytecode`.
//
// The qjsc binary is built from the VENDORED QuickJS-NG sources by
// tools/lume/fetch-qjsc.sh (no network / no external dependency). The engine
// version written into the payload header is read from those same vendored
// sources, so the CLI cannot silently drift from the firmware it talks to.
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bytecodePayload } from './protocol.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const qjsDir = join(repoRoot, 'firmware/components/quickjs-ng');
export const localQjsc = join(here, 'bin', 'qjsc');

/** Parse QJS_VERSION_* from quickjs.h and BC_VERSION from quickjs.c text.
 * Pure and exported so the CLI unit tests can exercise it without a board. */
export function parseQjsVersion(headerText, sourceText) {
  const num = (text, re, label) => {
    const m = re.exec(text);
    if (!m) throw new Error(`cannot read ${label} from vendored QuickJS-NG sources`);
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`${label} out of range: ${n}`);
    }
    return n;
  };
  const major = num(headerText, /^\s*#define\s+QJS_VERSION_MAJOR\s+(\d+)/m, 'QJS_VERSION_MAJOR');
  const minor = num(headerText, /^\s*#define\s+QJS_VERSION_MINOR\s+(\d+)/m, 'QJS_VERSION_MINOR');
  const patch = num(headerText, /^\s*#define\s+QJS_VERSION_PATCH\s+(\d+)/m, 'QJS_VERSION_PATCH');
  // BC_VERSION is internal to quickjs.c; it is also byte 0 of every qjsc blob.
  const bcVersion = num(sourceText, /^\s*#define\s+BC_VERSION\s+(\d+)/m, 'BC_VERSION');
  return { major, minor, patch, bcVersion, version: `${major}.${minor}.${patch}` };
}

/** Local engine version = the vendored QuickJS-NG the qjsc was built from. */
export async function qjsVersion() {
  const [headerText, sourceText] = await Promise.all([
    readFile(join(qjsDir, 'quickjs.h'), 'utf8'),
    readFile(join(qjsDir, 'quickjs.c'), 'utf8'),
  ]);
  return parseQjsVersion(headerText, sourceText);
}

/** Locate qjsc: explicit override, local binary, or build from vendored source. */
export async function findQjsc() {
  if (process.env.LUME_QJSC) {
    await access(process.env.LUME_QJSC);
    return process.env.LUME_QJSC;
  }
  for (const candidate of [localQjsc]) {
    try { await access(candidate); return candidate; } catch { /* keep looking */ }
  }
  try { await execFileAsync(join(here, 'fetch-qjsc.sh'), [], { maxBuffer: 4 * 1024 * 1024 }); }
  catch (err) { throw new Error(`cannot build vendored qjsc: ${(err.stderr || err.message).toString().trim()}`); }
  return localQjsc;
}

/** Compile one esbuild bundle to a raw qjsc bytecode blob.
 * -b = raw bytecode (NOT -c: quickjs-ng qjsc has no -c option).
 * -C = classic script: qjsc's JS_DetectModule() defaults to "module", which
 *      would run the app in module scope instead of the GLOBAL scope the
 *      prelude exposes. This flag is mandatory for Lume app bundles. */
export async function compileBytecode(source, qjsc) {
  const bin = qjsc ?? await findQjsc();
  const dir = await mkdtemp(join(tmpdir(), 'lume-qjsc-'));
  try {
    const js = join(dir, 'app.js');
    const out = join(dir, 'app.qbc');
    await writeFile(js, source);
    try {
      await execFileAsync(bin, ['-b', '-C', '-o', out, '-n', 'app.js', js],
                          { maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
      throw new Error(`qjsc failed (${bin}): ${detail}. Build it with tools/lume/fetch-qjsc.sh`);
    }
    const body = await readFile(out);
    if (!body.length) throw new Error('qjsc produced an empty bytecode blob');
    return body;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Full payload: 16-byte "LQBC" header + raw qjsc blob. */
export async function buildBytecodePayload(source) {
  const version = await qjsVersion();
  const body = await compileBytecode(source);
  if (body[0] !== version.bcVersion) {
    throw new Error(`BC_VERSION mismatch: qjsc blob starts with ${body[0]}, vendored quickjs.c says ${version.bcVersion}`);
  }
  return bytecodePayload(body, version);
}

/** Query the device's engine version through the existing command channel
 * (VER, answered "CMD OK ver <MAJOR.MINOR.PATCH>"). Source pushes never do
 * this, so older firmware without VER is unaffected. */
export async function queryEngineVersion(device) {
  let reply;
  try {
    reply = await device.command('VER');
  } catch (err) {
    throw new Error(`cannot query device engine version (${err.message}); ` +
                    `update the firmware to a build that supports the VER command`);
  }
  const version = reply && reply.arg;
  if (!version || reply.verb !== 'ver') {
    throw new Error(`unexpected VER reply from device: ${JSON.stringify(reply)}`);
  }
  return version;
}

/** Local pre-flight: reject a bytecode push when the versions differ. */
export function assertEngineVersion(deviceVersion, localVersion) {
  if (deviceVersion !== localVersion) {
    throw new Error(`engine version mismatch: device ${deviceVersion}, local qjsc ${localVersion}. ` +
                    `Refusing to push bytecode (JS_ReadObject would reject it). ` +
                    `Flash firmware built from the same vendored QuickJS-NG, or use source mode.`);
  }
}
