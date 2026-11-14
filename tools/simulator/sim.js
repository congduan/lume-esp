#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runApp } = require('../../tests/lib/prelude_runner');
const { buildSync } = require('../lume/node_modules/esbuild');

const appPath = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(appPath)) {
  console.error('usage: node tools/simulator/sim.js <app.js>'); process.exit(1);
}
const port = Number(process.env.LUME_SIM_PORT || 8765);
let generation = 0, messages = [], session, error = null;
function reload() {
  generation++;
  messages = []; error = null; session = undefined;
  try {
    const bundled = buildSync({ entryPoints: [appPath], bundle: true, format: 'iife',
      platform: 'neutral', target: 'es2020', write: false, charset: 'utf8' }).outputFiles[0].text;
    session = runApp(bundled, {
      filename: appPath,
      onMessage: m => {
        messages.push(m);
        if (m[0] === 'remove') queueMicrotask(() => session?.removed(m[1]));
      },
      onLog: (...args) => console.log('[app]', ...args),
    });
    console.log(`sim loaded ${appPath}: ${messages.length} messages`);
  } catch (e) { error = e.stack || String(e); console.error(error); }
}
reload();
fs.watchFile(appPath, { interval: 300 }, (now, before) => { if (now.mtimeMs !== before.mtimeMs) reload(); });
const assets = { '/': ['index.html', 'text/html'], '/renderer.js': ['renderer.js', 'text/javascript'], '/page.js': ['page.js', 'text/javascript'] };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'GET' && assets[url.pathname]) {
    const [file, type] = assets[url.pathname];
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, file))); return;
  }
  if (req.method === 'GET' && url.pathname === '/messages') {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0));
    const same = Number(url.searchParams.get('generation')) === generation;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ generation, reset: !same, messages: messages.slice(same ? since : 0), next: messages.length, error })); return;
  }
  if (req.method === 'POST' && url.pathname === '/input') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.writeHead(413); res.end(); return; } }
    try {
      const input = JSON.parse(body);
      if (!session || !Number.isInteger(input.id) || input.id < 1) throw Error('invalid node');
      if (input.type === 'press') session.press(input.id);
      else if (input.type === 'scroll') session.scroll(input.id, Math.max(0, Number(input.y) || 0));
      else if (input.type === 'gesture') session.gesture(input.id, input.kind, input.x, input.y, input.t, input.dir, input.cancelled);
      else throw Error('invalid input type');
      res.writeHead(204); res.end();
    } catch (e) { console.error(e); res.writeHead(400); res.end(String(e)); }
    return;
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(port, '127.0.0.1', () => console.log(`Lume Host Simulator http://localhost:${port} (${appPath})`));
const ticker = setInterval(() => { if (session) try { vm.runInContext('__lume_tick()', session.ctx); } catch (e) { console.error(e); } }, 50);
process.on('SIGTERM', () => { clearInterval(ticker); fs.unwatchFile(appPath); server.close(); });
