/* r206: protocol-level tests for the `lume mcp` stdio server (node --test).
 * Each case spawns a REAL `lume.js mcp` process and speaks ndjson JSON-RPC
 * 2.0 to it over stdio, the same way an MCP client would. Heavy tool calls
 * (lume_check / lume_manifest / lume_context) actually run against the repo
 * in the current working directory, so the test doubles as an end-to-end
 * acceptance for the tool contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/* One MCP session = one spawned server process. Requests are serialized;
 * responses are matched by id. */
class McpSession {
  constructor() {
    this.child = spawn(process.execPath, [join(HERE, 'lume.js'), 'mcp'], {
      cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.child.stdout.on('data', d => this.onData(d));
    this.child.stderr.on('data', () => { /* diagnostics only */ });
    this.exit = new Promise(res => this.child.on('close', res));
  }

  onData(d) {
    this.buffer += d;
    for (;;) {
      const i = this.buffer.indexOf('\n');
      if (i < 0) break;
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const resolver = this.pending.get(msg.id);
      if (resolver) { this.pending.delete(msg.id); resolver(msg); }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    this.child.stdin.write(JSON.stringify(msg) + '\n');
    return new Promise(res => this.pending.set(id, res));
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  sendRaw(line) { this.child.stdin.write(line + '\n'); }

  async close() {
    this.child.stdin.end();
    return await this.exit;
  }
}

async function withSession(fn) {
  const s = new McpSession();
  try { return await fn(s); } finally { await s.close(); }
}

/* Thin the tool result down to what callers assert on. */
function textOf(res) {
  assert.ok(res.result, 'tools/call response missing result');
  assert.equal(res.result.isError === true, false, 'unexpected isError: ' + JSON.stringify(res.result).slice(0, 400));
  return res.result.content.map(c => c.text).join('\n');
}
function textOfErr(res) {
  assert.ok(res.result && res.result.isError === true, 'expected isError result');
  return res.result.content.map(c => c.text).join('\n');
}

test('initialize handshake negotiates a known protocolVersion', async () => {
  await withSession(async s => {
    const res = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lume-mcp-test', version: '0.0.1' } });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.result.protocolVersion, '2025-06-18');
    assert.equal(res.result.serverInfo.name, 'lume');
    assert.deepEqual(res.result.capabilities.tools, {});
    s.notify('notifications/initialized', {});
  });
});

test('initialize with unknown protocolVersion answers the server latest', async () => {
  await withSession(async s => {
    const res = await s.request('initialize', { protocolVersion: '1999-01-01' });
    assert.match(res.result.protocolVersion, /^202[45]-\d{2}-\d{2}$/);
  });
});

test('tools/list exposes exactly the six stable tools with schemas', async () => {
  await withSession(async s => {
    const res = await s.request('tools/list', {});
    const names = res.result.tools.map(t => t.name);
    assert.deepEqual(names, ['lume_check', 'lume_bundle', 'lume_manifest', 'lume_context', 'lume_help', 'lume_deploy']);
    for (const t of res.result.tools) {
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(typeof t.description, 'string');
    }
  });
});

test('ping round-trips', async () => {
  await withSession(async s => {
    const res = await s.request('ping', {});
    assert.deepEqual(res.result, {});
  });
});

test('lume_help returns the CLI usage text', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_help', arguments: {} });
    const text = textOf(res);
    assert.match(text, /Usage:/);
    assert.match(text, /lume check/);
  });
});

test('lume_manifest lists the playground apps (counter present, count > 70)', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_manifest', arguments: {} });
    const data = JSON.parse(textOf(res));
    assert.equal(typeof data.count, 'number');
    assert.ok(data.count > 70, 'manifest count unexpectedly small: ' + data.count);
    assert.ok(data.apps.includes('counter'));
  });
});

test('lume_context returns the machine-readable snapshot (skipCheck default)', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_context', arguments: {} });
    const data = JSON.parse(textOf(res));
    assert.match(data.version, /^\d+\.\d+\.\d+$/);
    assert.match(data.head, /^[0-9a-f]+$/);
    assert.ok(Array.isArray(data.manifest) && data.manifest.length > 0);
    assert.equal(data.snapshotFailed, false);
  });
});

test('lume_check runs the counter sentinel (noEmu default) and passes', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_check', arguments: { appDir: 'examples/counter' } });
    const data = JSON.parse(textOf(res));
    assert.equal(data.exitCode, 0);
    assert.equal(data.check.ok, true);
    assert.ok(data.check.steps.some(st => st.step === 'bundle' && st.ok));
  });
});

test('lume_check on a broken app returns isError with the check failure', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_check', arguments: { appDir: 'examples/no_such_app_xyz' } });
    const text = textOfErr(res);
    assert.match(text, /exitCode/);
  });
});

test('lume_deploy without a board returns isError and never hangs', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'lume_deploy', arguments: { appDir: 'examples/counter' } });
    const text = textOfErr(res);
    assert.match(text, /no board/);
    assert.match(text, /lume_check/);
  });
});

test('unknown tool is JSON-RPC error -32602', async () => {
  await withSession(async s => {
    const res = await s.request('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.equal(res.error.code, -32602);
  });
});

test('unknown method is JSON-RPC error -32601', async () => {
  await withSession(async s => {
    const res = await s.request('resources/list', {});
    assert.equal(res.error.code, -32601);
  });
});

test('non-JSON and malformed lines do not kill the server', async () => {
  await withSession(async s => {
    s.sendRaw('this is not json');
    s.sendRaw('[1,2,3]');
    s.sendRaw('');
    const res = await s.request('ping', {});
    assert.deepEqual(res.result, {});
  });
});

test('server exits cleanly on stdin EOF', async () => {
  const code = await withSession(async s => {
    await s.request('initialize', { protocolVersion: '2025-06-18' });
    return null; // close() inside withSession ends stdin
  }).then(() => null);
  // withSession already closed the session; verify a fresh one exits 0.
  const s2 = new McpSession();
  await s2.request('initialize', { protocolVersion: '2025-06-18' });
  const exitCode = await s2.close();
  assert.equal(exitCode, 0);
});
