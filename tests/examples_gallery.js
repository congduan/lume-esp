// r189: the static examples gallery must mirror the playground catalog.
// Standalone CommonJS: node tests/examples_gallery.js
// The manifest (70 apps) is the source of truth; every rendered card must
// correspond one-to-one to a registered app, and its title/description must
// come from the page.js `examples` metadata rather than invented copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readManifest } = require('./lib/manifest');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('website/examples.html');
const START = '<!-- examples-gallery:start -->';
const END = '<!-- examples-gallery:end -->';

function galleryRegion(doc) {
  const i = doc.indexOf(START), j = doc.indexOf(END, i);
  assert.ok(i >= 0 && j > i, 'gallery markers missing');
  return doc.slice(i, j + END.length);
}
const region = galleryRegion(html);
const cards = region.match(/<article class="example-card card reveal">/g) || [];
const blocks = [...region.matchAll(/<article class="example-card card reveal">([\s\S]*?)<\/article>/g)]
  .map(m => m[1]);
const ids = blocks.map(b => (b.match(/<pre><code>examples\/([a-z0-9_]+)\/app\.js<\/code><\/pre>/) || [])[1]);
const apps = readManifest();

const metaBlock = (read('website/playground/page.js').match(/const examples = \[([\s\S]*?)\];/) || [])[1];
const meta = new Map([...metaBlock.matchAll(
  /\['([^']+)','([^']*)','([^']+)','([^']*)','([^']*)','([^']*)'\]/g)]
  .map(m => [m[1], { icon: m[2], en: m[3], cn: m[4], descEn: m[5], descZh: m[6] }]));

const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const title = e => (e.cn && e.cn !== e.en ? `${e.en} / ${e.cn}` : e.en);
const HW = /\bTF\b|TF卡|\bIMU\b|\bPMIC\b|\bADC\d*\b|microphone|walkie-talkie|\bBLE\b|\bWiFi\b|Wi-Fi|\bradio\b|magnetometer|inertial|\btilt\b|\baudio\b|\bvoice\b|\bsleep\b|麦克风|蓝牙|无线|惯性|体感|音频|睡眠/i;
const STUB = /\bstub\b|no audio|sample data|模拟|无音频/i;
const needsHardware = e => !STUB.test(e.descEn) && !STUB.test(e.descZh) &&
  (HW.test(e.descEn) || HW.test(e.descZh));
const BADGE_HTML = '<span class="pill" data-en="Board hardware may be required" ' +
  'data-zh="可能需要板载外设">Board hardware may be required</span>';

function cardMetaOk(block, app) {
  const e = meta.get(app);
  if (!e) return false;
  const heading = (block.match(/<h2>([^<]*)<\/h2>/) || [])[1];
  if (heading !== title(e)) return false;
  const desc = block.match(/<p data-en="([^"]*)" data-zh="([^"]*)">/);
  if (!desc || decode(desc[1]) !== e.descEn || decode(desc[2]) !== e.descZh) return false;
  return block.includes(`/examples/${app}/app.js`);
}

const checks = [
  ['gallery card count equals manifest app count', [cards.length, n => n === apps.length]],
  ['one card per app, in manifest order', [ids, a => JSON.stringify(a) === JSON.stringify(apps)]],
  ['every card title / description / link comes from page.js metadata',
    [blocks, bs => bs.length === apps.length && bs.every((b, i) => cardMetaOk(b, apps[i]))]],
  ['every card description keeps bilingual data-en / data-zh attributes',
    [blocks, bs => bs.length > 0 && bs.every(b => /<p data-en="[^"]+" data-zh="[^"]+">/.test(b))]],
  ['no stale "Seven" headline or meta description remains',
    [html, s => !/Seven ways into the stack|Seven real Lume examples|七个切入项目的示例/.test(s)]],
  ['hardware badge appears exactly where metadata states a board dependency',
    [blocks, bs => bs.length === apps.length && bs.every((b, i) =>
      b.includes(BADGE_HTML) === needsHardware(meta.get(apps[i])))]],
];

for (const [name, [src, test]] of checks) {
  assert.ok(test(src), 'FAIL examples_gallery: ' + name);
  console.log('PASS examples_gallery: ' + name);
}

// --- mutation proof: every assertion MUST fail when its contract is removed --
function must(name, mutation, checkName, source) {
  const mutated = mutation(source);
  assert.notEqual(mutated, source, 'mutation did not change source: ' + name);
  const found = checks.find(([n]) => n === checkName);
  assert.ok(found, 'unknown check: ' + checkName);
  assert.equal(found[1][1](mutated), false,
    'assertion is decorative; mutation did not FAIL: ' + name);
  console.log('PASS examples_gallery mutation: ' + name + ' -> FAIL as expected');
}
const dropLast = arr => arr.slice(0, -1);
const mutateBlock = (bs, from, to) => {
  const copy = [...bs];
  assert.ok(copy[0].includes(from), 'mutation target not found');
  copy[0] = copy[0].replace(from, to);
  return copy;
};

must('one card disappears', n => n + 1,
  'gallery card count equals manifest app count', cards.length);
must('a card drifts out of manifest order', a => [a[1], ...a.slice(2), a[0]],
  'one card per app, in manifest order', ids);
must('a card invents a title',
  bs => mutateBlock(bs, '<h2>', '<h2>Imaginary feature / '),
  'every card title / description / link comes from page.js metadata', blocks);
must('a card loses its bilingual attributes',
  bs => mutateBlock(bs, ' data-zh="', ' data-zh-removed="'),
  'every card description keeps bilingual data-en / data-zh attributes', blocks);
must('the old Seven headline returns',
  s => s.replace('Explore the example gallery.', 'Seven ways into the stack.'),
  'no stale "Seven" headline or meta description remains', html);
must('a hardware badge is dropped from a dependency card',
  bs => {
    const copy = [...bs];
    const i = copy.findIndex(b => b.includes(BADGE_HTML));
    copy[i] = copy[i].replace(BADGE_HTML, '');
    return copy;
  },
  'hardware badge appears exactly where metadata states a board dependency', blocks);

console.log(`ALL EXAMPLES GALLERY CASES PASSED (${apps.length} apps / ${cards.length} cards)`);
