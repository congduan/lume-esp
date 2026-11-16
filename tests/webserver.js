/* JS route / mocked C HTTP boundary. Run: node tests/webserver.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('./lib/prelude_runner');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
let active = false, token = '', port = 8080;
const native = {
  _start(p, t) { if (active) return -3; if (!t || (p !== null && (p < 1024 || p > 65535))) return -1; active = true; token = t; port = p || 8080; return 0; },
  _stop() { active = false; token = ''; return 0; },
  _url() { return active ? `http://192.168.1.5:${port}/?key=${token}` : null; }
};
const app = fs.readFileSync(path.join(__dirname, '../examples/web_config/app.js'), 'utf8');
const kv = {};
const {ctx, lume} = runApp(app, { net: { web: native }, kv: {
  set(k,v) { kv[k]=v; return 0; }, get(k) { return kv[k] || null; }
}});
function request(raw) {
  if (!active) return {status:503, body:''};
  const sep = raw.indexOf('\r\n\r\n');
  if (sep < 0 || sep + 4 > 1024) return {status:400, body:''};
  const [method, target] = raw.slice(0, raw.indexOf('\r\n')).split(' ');
  const u = new URL(target, 'http://device');
  if (u.searchParams.get('key') !== token) return {status:403, body:''};
  const m = /^Content-Length:\s*(\d+)\s*$/im.exec(raw.slice(0, sep));
  const len = m ? Number(m[1]) : 0;
  if (len > 8192) return {status:413, body:''};
  const body = raw.slice(sep+4, sep+4+len);
  if (body.length !== len) return {status:400, body:''};
  const res = ctx.__lume_web_dispatch({method, path:u.pathname, queryRaw:u.search.slice(1), body});
  const out = typeof res.body === 'string' ? res.body : Buffer.from(res.body);
  return {status:res.status, headers:{...res.headers, 'Content-Length':Buffer.byteLength(out), Connection:'close'}, body:out};
}
check('default closed and token required', () => { assert.equal(request('GET / HTTP/1.1\r\n\r\n').status,503); assert.equal(lume.net.web.start({}),-1); });
check('start, URL, and duplicate start', () => { assert.equal(lume.net.web.start({token:'abc123'}),0); assert.equal(lume.net.web.url(),'http://192.168.1.5:8080/?key=abc123'); assert.equal(lume.net.web.start({token:'x'}),-3); });
check('token gate before JS dispatch', () => { assert.equal(request('GET / HTTP/1.1\r\n\r\n').status,403); assert.equal(request('GET /?key=wrong HTTP/1.1\r\n\r\n').status,403); });
check('exact route, welcome fallback, 404', () => { const page=request('GET /?key=abc123 HTTP/1.1\r\n\r\n'); assert.equal(page.status,200); assert.match(page.body,/<form method="post"/); assert.match(page.body,/name="start"/); assert.equal(request('GET /missing?key=abc123 HTTP/1.1\r\n\r\n').status,404); assert.equal(lume.net.web.on('GET','/exact',r=>({status:201,body:r.path})),0); assert.equal(request('GET /exact?key=abc123 HTTP/1.1\r\n\r\n').status,201); });
check('query decode and response framing', () => { lume.net.web.on('GET','/query',r=>({status:200,headers:{'Content-Type':'text/plain'},body:r.query.name})); const r=request('GET /query?key=abc123&name=Ann+Lee HTTP/1.1\r\n\r\n'); assert.equal(r.body,'Ann Lee'); assert.equal(r.headers['Content-Length'],7); assert.equal(r.headers.Connection,'close'); });
check('8 KiB request body cap and full POST to KV', () => { const body='mode=random&start=C'; const r=request(`POST /api/config?key=abc123 HTTP/1.1\r\nContent-Length: ${body.length}\r\n\r\n${body}`); assert.equal(r.status,200); assert.equal(kv['card.mode'],'random'); assert.equal(kv['card.start'],'C'); assert.equal(request('POST /api/config?key=abc123 HTTP/1.1\r\nContent-Length: 8193\r\n\r\n').status,413); });
check('stop lifecycle', () => { assert.equal(lume.net.web.stop(),0); assert.equal(lume.net.web.url(),null); assert.equal(request('GET /?key=abc123 HTTP/1.1\r\n\r\n').status,503); });
check('built-in welcome and handler exception', () => {
  const bare = runApp('', {net:{web:native}, currentApp:'cards'});
  const welcome = bare.ctx.__lume_web_dispatch({method:'GET',path:'/',queryRaw:'',body:''});
  assert.equal(welcome.status,200);
  assert.match(welcome.body,/cards/);
  bare.lume.net.web.on('GET','/fail',()=>{ throw Error('boom'); });
  assert.equal(bare.ctx.__lume_web_dispatch({method:'GET',path:'/fail',queryRaw:'',body:''}).status,500);
});
console.log(`webserver: ${checks} cases PASS`);
