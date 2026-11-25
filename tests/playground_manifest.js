// The manifest and checked-in generated sources must have the same app set.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { readManifest } = require('./lib/manifest');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function verifySet(apps, sources) {
  assert.equal(Object.keys(sources).length, apps.length, 'manifest / sources.js app count');
  assert.deepEqual(Object.keys(sources).sort(), [...apps].sort(), 'manifest / sources.js app set');
}

function verify(apps, sources) {
  verifySet(apps, sources);
  for (const name of apps) {
    assert.equal(sources[name], read(`website/playground/sources/${name}.js`), name + ' source file');
    assert.equal(sources[name], read(`examples/${name}/app.js`), name + ' example source');
    assert.ok(fs.existsSync(path.join(root, 'website/playground/apps', name + '.js')), name + ' bundle');
  }
}

(async () => {
  const exported = await import(pathToFileURL(path.join(root, 'tools/playground/build.mjs')));
  const apps = readManifest();
  assert.deepEqual(exported.manifestApps(), apps);
  const sandbox = { window: {} };
  vm.runInNewContext(read('website/playground/sources.js'), sandbox);
  const sources = JSON.parse(JSON.stringify(sandbox.window.LUME_SOURCES));
  verify(apps, sources);
  assert.throws(() => verify(apps.filter(x => x !== 'counter'), sources), /app count/);
  assert.throws(() => verify([...apps, 'new_app'], sources), /app count/);
  // A registered app passes once the generated source map contains it.
  const added = { ...sources, new_app: 'new source' };
  assert.doesNotThrow(() => verifySet([...apps, 'new_app'], added));
  console.log(`PASS playground manifest ${apps.length} apps match generated sources and examples; removal/addition mutation caught`);
})().catch(e => { console.error(e); process.exitCode = 1; });
