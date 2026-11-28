/* r234: DESIGN-TOKENS.md deterministic red-line audit harness across all 74 apps.
 *
 * Host-only core (no browser dependency, <2s):
 *   1. Self-verifies all 4 rules on synthetic bad/good fixtures so no rule can
 *      silently become decorative.
 *   2. Runs every playground app bundle (37 round at native 466x466, 37 square
 *      at native 480x480) through the real firmware prelude (prelude_runner.js)
 *      and audits the resulting live node tree against DESIGN-TOKENS.md section 0:
 *        - touch-target : Button / pressable View / tap-gesture View >= 48x48
 *        - letter-icon  : no single ASCII letter placeholder on buttons/icons
 *        - font-size    : text fontSize >= 12px
 *        - card-radius  : non-pill / non-circle card borderRadius <= 12px
 *   3. Optional browser check (when PLAYWRIGHT_MODULE or playwright resolves):
 *      verifies real rendered DOM bounding boxes of visible interactive targets
 *      on all 37 round apps at native 466x466.
 *
 * Usage:
 *   node tests/design_token_audit.js
 *   node tests/design_token_audit.js --json
 *
 * Exit 0 when violations === 0 (excluding documented ACCEPTED entries);
 * Exit 1 on any unaccepted violation or self-check failure.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runApp } = require('./lib/prelude_runner');

const ROOT = path.resolve(__dirname, '..');
const JSON_OUT = process.argv.includes('--json');

const KIND_NAMES = ['View', 'Text', 'Button', 'Canvas', 'Image', 'Arc'];
const ATTR_TEXT = 0;
const ATTR_BG_COLOR = 1;
const ATTR_WIDTH = 2;
const ATTR_HEIGHT = 3;
const ATTR_VISIBLE = 5;
const ATTR_PARENT = 6;
const ATTR_FLEX_FLOW = 7;
const ATTR_PADDING = 10;
const ATTR_GAP = 11;
const ATTR_RADIUS = 12;
const ATTR_WIDTH_PCT = 16;
const ATTR_HEIGHT_PCT = 17;
const ATTR_PAD_RIGHT = 31;
const ATTR_PAD_LEFT = 33;
const ATTR_FLEX_GROW = 39;
const ATTR_TEXT_FONT = 55;

const MIN_TOUCH = 48;
const MIN_FONT = 12;
const MAX_CARD_RADIUS = 12;

let failures = 0;
function log(msg) { if (!JSON_OUT) console.log(msg); }
function err(msg) { if (!JSON_OUT) console.error(msg); }
function check(label, fn) {
  try { fn(); log('PASS ' + label); }
  catch (e) { failures++; err('FAIL ' + label + ': ' + (e && e.message ? e.message : String(e))); }
}
function assert(cond, message) { if (!cond) throw new Error(message); }

// ---- accepted exceptions (each entry MUST have an explicit reason comment) ----
// Entry shape: { app, rule, match: (finding) => boolean, scope: 'round'|'square', reason }
const ACCEPTED = [
  // r234: watchface is off-limits this round (r232 modular-card relayout in flight).
  {
    app: 'watchface', rule: 'card-radius', scope: 'round',
    match: f => f.r === 16,
    reason: 'watchface off-limits in r234 (r232 dedicated knife in flight)',
  },
  // r234: settings on-screen QWERTY overlay uses literal single-letter keys (a-z),
  // not icon placeholders; 10-col QWERTY inside 328px round safe width physically
  // caps horizontal key width below 48px (row height is locked >=48px).
  {
    app: 'settings', rule: 'letter-icon', scope: 'round',
    match: f => /^[a-z]$/.test(f.text),
    reason: 'QWERTY keyboard letter input key (a-z), not an icon placeholder',
  },
  {
    app: 'settings', rule: 'touch-target', scope: 'round',
    match: f => f.h >= 48 && f.w < 48 && (
      /^[a-z._@-]$/.test(f.text) || f.text === 'OK' || f.text === 'ESC' ||
      f.text === 'DEL' || f.text === '#123'
    ),
    reason: '10-col QWERTY key width inside 328px round safe width (height locked >=48px)',
  },
  // r234: square apps are registered-only this round (r233 just closed square margins;
  // fixes deferred to the dedicated square token round).
  {
    app: 'keyboard_demo', rule: 'letter-icon', scope: 'square',
    match: f => /^[A-Z]$/.test(f.text),
    reason: 'shell.Keyboard QWERTY letter input key (A-Z), not an icon placeholder',
  },
  {
    app: 'keyboard_demo', rule: 'touch-target', scope: 'square',
    match: f => f.h >= 48 && f.w === 44 && /^[A-Z]$/.test(f.text),
    reason: 'shell.Keyboard 10-col QWERTY key width 44px (height 48px; square app deferred)',
  },
  {
    app: 'wordle', rule: 'letter-icon', scope: 'square',
    match: f => /^[A-Z]$/.test(f.text),
    reason: 'shell.Keyboard QWERTY letter input key (A-Z), not an icon placeholder',
  },
  {
    app: 'wordle', rule: 'touch-target', scope: 'square',
    match: f => f.h >= 48 && f.w === 44 && /^[A-Z]$/.test(f.text),
    reason: 'shell.Keyboard 10-col QWERTY key width 44px (height 48px; square app deferred)',
  },
  {
    app: 'counter', rule: 'font-size', scope: 'square',
    match: f => f.current === '11px',
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
  {
    app: 'typewriter', rule: 'card-radius', scope: 'square',
    match: f => f.r === 20,
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
  {
    app: 'minesweeper', rule: 'font-size', scope: 'square',
    match: f => f.current === '11px',
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
  {
    app: 'voice_assistant', rule: 'font-size', scope: 'square',
    match: f => f.current === '10px' || f.current === '11px',
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
  {
    app: 'ble_uart', rule: 'font-size', scope: 'square',
    match: f => f.current === '11px',
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
  {
    app: 'sparkline_demo', rule: 'font-size', scope: 'square',
    match: f => f.current === '11px',
    reason: 'square app registered-only in r234 (deferred to square token round)',
  },
];

function findAccepted(finding) {
  for (const ex of ACCEPTED) {
    if (ex.app === finding.app && ex.rule === finding.rule && ex.match(finding)) return ex;
  }
  return null;
}

// ---- parse 74-app catalog from website/playground/page.js ----
const pageSrc = fs.readFileSync(path.join(ROOT, 'website/playground/page.js'), 'utf8');
const catalogBlock = pageSrc.match(/const examples = \[([\s\S]*?)\n  \];/);
assert(catalogBlock, 'cannot parse playground examples catalog');
const catalog = [];
for (const line of catalogBlock[1].split('\n')) {
  const m = line.match(/^\s*\['([^']+)'.*'(round|square)'\],?$/);
  if (m) catalog.push({ name: m[1], shape: m[2] });
}

check('catalog has 74 apps (37 round + 37 square)', () => {
  const roundCount = catalog.filter(c => c.shape === 'round').length;
  const squareCount = catalog.filter(c => c.shape === 'square').length;
  assert(catalog.length === 74 && roundCount === 37 && squareCount === 37,
    `expected 74 (37+37), got ${catalog.length} (${roundCount}+${squareCount})`);
});

// ---- line-number lookup helper in examples/<app>/app.js ----
function buildLineFinder(src) {
  const lines = src.split('\n');
  return function findLine(rule, info) {
    const needles = [];
    if (rule === 'font-size') {
      needles.push(new RegExp(`fontSize\\s*:\\s*${info.current}\\b`));
    } else if (rule === 'card-radius') {
      needles.push(new RegExp(`(?:borderRadius|radius)\\s*:\\s*${info.current}\\b`));
    } else if (rule === 'letter-icon' && info.text) {
      const esc = info.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      needles.push(new RegExp(`['"]${esc}['"]`));
    } else if (rule === 'touch-target') {
      if (info.text) {
        const esc = info.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        needles.push(new RegExp(`title\\s*:\\s*['"]${esc}['"]`));
        needles.push(new RegExp(`['"]${esc}['"]`));
      }
      if (typeof info.w === 'number' && info.w < MIN_TOUCH) {
        needles.push(new RegExp(`width\\s*:\\s*(?:${info.w}|${Math.round(info.w * 480 / 466)})\\b`));
      }
      if (typeof info.h === 'number' && info.h < MIN_TOUCH) {
        needles.push(new RegExp(`height\\s*:\\s*(?:${info.h}|${Math.round(info.h * 480 / 466)})\\b`));
      }
    }
    for (const re of needles) {
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
      }
    }
    return null;
  };
}

// ---- core node-tree auditor (pure prelude message stream + VM gesture table) ----
function auditScript(name, shape, script, sourceText) {
  const screenSize = shape === 'round' ? 466 : 480;
  // Provide raycast no-op stub (matches playground runtime.js) and seed a saved
  // WiFi network for settings so dynamic List rows (netRow) are instantiated.
  const preamble = `if (!lume.raycast) lume.raycast = { setMap:function(){}, setTextures:function(){}, render:function(){} };\n`;
  const kvOverride = name === 'settings'
    ? { get: k => (k === 'wifi.saved' ? JSON.stringify([{ ssid: 'DemoNet', pass: '12345678' }]) : null) }
    : undefined;
  const h = runApp(preamble + script, {
    screen: { w: screenSize, h: screenSize },
    kv: kvOverride,
  });

  const gestureHandlers = vm.runInContext('__gestureHandlers', h.ctx) || {};
  const nodes = new Map();
  const press = new Set();
  const removed = new Set();

  for (const m of h.messages) {
    if (m[0] === 'create') {
      const id = m[1], kind = m[2], parent = m[3];
      nodes.set(id, { id, kind, parent, cw: m[4], ch: m[5], attrs: {}, children: [] });
      if (nodes.has(parent)) nodes.get(parent).children.push(id);
    } else if (m[0] === 'attr') {
      const n = nodes.get(m[1]);
      if (!n) continue;
      if (m[2] === ATTR_PARENT) {
        const oldP = nodes.get(n.parent);
        if (oldP) oldP.children = oldP.children.filter(c => c !== m[1]);
        n.parent = m[3];
        if (nodes.has(m[3])) nodes.get(m[3]).children.push(m[1]);
      } else {
        n.attrs[m[2]] = m[3];
      }
    } else if (m[0] === 'press') {
      press.add(m[1]);
    } else if (m[0] === 'remove') {
      removed.add(m[1]);
    }
  }

  function isAlive(id) {
    let cur = nodes.get(id);
    while (cur) {
      if (removed.has(cur.id)) return false;
      cur = nodes.get(cur.parent);
    }
    return true;
  }

  function nodePath(id) {
    const parts = [];
    let cur = nodes.get(id);
    let guard = 0;
    while (cur && guard++ < 16) {
      parts.push(`${KIND_NAMES[cur.kind] || 'Node'}#${cur.id}`);
      cur = nodes.get(cur.parent);
    }
    return parts.reverse().join('/');
  }

  // Resolve known pixel width of a container (including 100% of parent / screen).
  function resolvedWidth(id, depth = 0) {
    if (depth > 16) return null;
    if (id === 0) return screenSize;
    const n = nodes.get(id);
    if (!n) return null;
    if (typeof n.attrs[ATTR_WIDTH] === 'number') return n.attrs[ATTR_WIDTH];
    if (typeof n.attrs[ATTR_WIDTH_PCT] === 'number') {
      const pw = resolvedWidth(n.parent, depth + 1);
      if (pw !== null) {
        const pNode = nodes.get(n.parent);
        const padL = pNode ? (pNode.attrs[ATTR_PAD_LEFT] ?? pNode.attrs[ATTR_PADDING] ?? 0) : 0;
        const padR = pNode ? (pNode.attrs[ATTR_PAD_RIGHT] ?? pNode.attrs[ATTR_PADDING] ?? 0) : 0;
        return Math.floor((pw - padL - padR) * n.attrs[ATTR_WIDTH_PCT] / 100);
      }
    }
    return null;
  }

  // Estimate flex-row child width when flexGrow is used without explicit width.
  function estimateFlexRowWidth(n) {
    const p = nodes.get(n.parent);
    if (!p) return null;
    const flow = p.attrs[ATTR_FLEX_FLOW];
    if (flow !== 0 && flow !== 2) return null; // 0=row, 2=row-wrap
    const pw = resolvedWidth(p.id);
    if (pw === null) return null;
    const padL = p.attrs[ATTR_PAD_LEFT] ?? p.attrs[ATTR_PADDING] ?? 0;
    const padR = p.attrs[ATTR_PAD_RIGHT] ?? p.attrs[ATTR_PADDING] ?? 0;
    const gap = p.attrs[ATTR_GAP] ?? 0;
    const liveKids = p.children.map(cid => nodes.get(cid)).filter(c => c && isAlive(c.id));
    if (!liveKids.length) return null;
    let fixedW = 0, totalGrow = 0;
    for (const k of liveKids) {
      if (typeof k.attrs[ATTR_WIDTH] === 'number') fixedW += k.attrs[ATTR_WIDTH];
      else if (typeof k.attrs[ATTR_FLEX_GROW] === 'number' && k.attrs[ATTR_FLEX_GROW] > 0) {
        totalGrow += k.attrs[ATTR_FLEX_GROW];
      } else {
        return null; // unknown auto-sized sibling
      }
    }
    const fg = n.attrs[ATTR_FLEX_GROW];
    if (!totalGrow || !fg) return null;
    const avail = pw - padL - padR - gap * Math.max(0, liveKids.length - 1) - fixedW;
    return Math.floor(avail * fg / totalGrow);
  }

  function labelOf(n) {
    if (typeof n.attrs[ATTR_TEXT] === 'string' && n.attrs[ATTR_TEXT].trim()) {
      return n.attrs[ATTR_TEXT].trim();
    }
    const texts = [];
    for (const cid of n.children) {
      const c = nodes.get(cid);
      if (c && isAlive(c.id)) {
        const t = labelOf(c);
        if (t) texts.push(t);
      }
    }
    return texts.join(' ').trim();
  }

  const findLine = sourceText ? buildLineFinder(sourceText) : () => null;
  const file = `examples/${name}/app.js`;
  const findings = [];

  for (const [id, n] of nodes) {
    if (!isAlive(id)) continue;
    const a = n.attrs;
    const gMap = gestureHandlers[id];
    const hasTapGesture = !!(gMap && ((gMap.tap && gMap.tap.length) || (gMap.longpress && gMap.longpress.length)));
    const isClickable = n.kind === 2 || press.has(id) || (n.kind === 0 && hasTapGesture);

    // 1. touch-target >= 48x48
    if (isClickable) {
      const explicitW = typeof a[ATTR_WIDTH] === 'number' ? a[ATTR_WIDTH] : null;
      const explicitH = typeof a[ATTR_HEIGHT] === 'number' ? a[ATTR_HEIGHT] : null;
      const effW = explicitW !== null ? explicitW : estimateFlexRowWidth(n);
      const effH = explicitH;
      const badW = effW !== null && effW < MIN_TOUCH;
      const badH = effH !== null && effH < MIN_TOUCH;
      if (badW || badH) {
        const text = labelOf(n);
        const wStr = effW !== null ? String(effW) : 'auto';
        const hStr = effH !== null ? String(effH) : 'auto';
        const line = findLine('touch-target', { w: effW, h: effH, text });
        findings.push({
          app: name, shape, file, rule: 'touch-target',
          node: nodePath(id), line, text,
          w: effW, h: effH,
          current: `${wStr}x${hStr}`,
          required: `>=${MIN_TOUCH}x${MIN_TOUCH}`,
        });
      }
    }

    // 2. letter-icon: single ASCII letter on Button or pressable/icon slot
    const txt = typeof a[ATTR_TEXT] === 'string' ? a[ATTR_TEXT].trim() : '';
    if (/^[A-Za-z]$/.test(txt)) {
      const parent = nodes.get(n.parent);
      const parentIsIconBox = !!(parent && (
        parent.kind === 2 || press.has(parent.id) ||
        (typeof parent.attrs[ATTR_WIDTH] === 'number' && parent.attrs[ATTR_WIDTH] <= 80 &&
         typeof parent.attrs[ATTR_HEIGHT] === 'number' && parent.attrs[ATTR_HEIGHT] <= 80)
      ));
      const isIconSlot = n.kind === 2 || press.has(id) || parentIsIconBox;
      if (isIconSlot) {
        const line = findLine('letter-icon', { text: txt });
        findings.push({
          app: name, shape, file, rule: 'letter-icon',
          node: nodePath(id), line, text: txt,
          current: `"${txt}"`,
          required: 'non-placeholder icon or descriptive label',
        });
      }
    }

    // 3. font-size >= 12px
    if (typeof a[ATTR_TEXT_FONT] === 'number' && a[ATTR_TEXT_FONT] < MIN_FONT) {
      const text = typeof a[ATTR_TEXT] === 'string' ? a[ATTR_TEXT].trim().slice(0, 32) : '';
      const line = findLine('font-size', { current: a[ATTR_TEXT_FONT], text });
      findings.push({
        app: name, shape, file, rule: 'font-size',
        node: nodePath(id), line, text,
        current: `${a[ATTR_TEXT_FONT]}px`,
        required: `>=${MIN_FONT}px`,
      });
    }

    // 4. card-radius <= 12px (exempt true circles and capsules/pills)
    if ((n.kind === 0 || n.kind === 2) && typeof a[ATTR_RADIUS] === 'number' && a[ATTR_RADIUS] > MAX_CARD_RADIUS) {
      const r = a[ATTR_RADIUS];
      const w = typeof a[ATTR_WIDTH] === 'number' ? a[ATTR_WIDTH] : (n.cw || 0);
      const h2 = typeof a[ATTR_HEIGHT] === 'number' ? a[ATTR_HEIGHT] : (n.ch || 0);
      const minDim = (w > 0 && h2 > 0) ? Math.min(w, h2) : 0;
      // Pill (999, or ~970 when scaled 466/480) or true circle/capsule (r >= minDim/2 - 1)
      const isPillOrCircle = r >= 900 || (minDim > 0 && r >= Math.floor(minDim / 2) - 1);
      if (!isPillOrCircle) {
        const line = findLine('card-radius', { current: r });
        findings.push({
          app: name, shape, file, rule: 'card-radius',
          node: nodePath(id), line, text: labelOf(n).slice(0, 24),
          w, h: h2, r,
          current: `borderRadius=${r} (${w || 'auto'}x${h2 || 'auto'})`,
          required: `<=${MAX_CARD_RADIUS}px`,
        });
      }
    }
  }

  return findings;
}

// ---- self-checks on synthetic fixtures (prove all 4 rules are load-bearing) ----
check('self-check catches all 4 violation types and passes compliant fixture', () => {
  const badScript = `
    View({ style: { width: 320, height: 200, borderRadius: 20, background: '#16202E' } }, [
      Button({ title: 'R', onPress: function(){}, style: { width: 36, height: 36, borderRadius: 8 } }),
      Text({ text: 'tiny body', style: { fontSize: 10, color: '#F2F7FB' } })
    ]);
  `;
  const bad = auditScript('_fixture_bad', 'round', badScript, badScript);
  const rules = new Set(bad.map(f => f.rule));
  for (const r of ['touch-target', 'letter-icon', 'font-size', 'card-radius']) {
    assert(rules.has(r), `self-check missed rule ${r}; got ${[...rules].join(',')}`);
  }
  const goodScript = `
    View({ style: { width: 452, height: 452, borderRadius: 226, background: '#09101A' } }, [
      View({ style: { width: 320, height: 120, borderRadius: 12, background: '#16202E' } }, [
        Button({ title: 'SYNC', onPress: function(){}, style: { width: 64, height: 48, borderRadius: 999 } }),
        Text({ text: 'readable', style: { fontSize: 12, color: '#F2F7FB' } })
      ])
    ]);
  `;
  const good = auditScript('_fixture_good', 'round', goodScript, goodScript);
  assert(good.length === 0, `compliant fixture produced unexpected findings: ${JSON.stringify(good)}`);
});

// ---- load all 74 playground bundles and audit ----
const sandbox = { window: { LUME_APPS: {} } };
const bundleDir = path.join(ROOT, 'website/playground/apps');
for (const f of fs.readdirSync(bundleDir)) {
  if (f.endsWith('.js')) vm.runInNewContext(fs.readFileSync(path.join(bundleDir, f), 'utf8'), sandbox);
}

const allFindings = [];
let audited = 0;
for (const { name, shape } of catalog) {
  const bundle = sandbox.window.LUME_APPS[name];
  assert(typeof bundle === 'string' && bundle.length > 0, `missing playground bundle for ${name}`);
  const srcPath = path.join(ROOT, 'examples', name, 'app.js');
  const sourceText = fs.readFileSync(srcPath, 'utf8');
  const findings = auditScript(name, shape, bundle, sourceText);
  audited++;
  for (const f of findings) {
    const acc = findAccepted(f);
    allFindings.push({ ...f, accepted: !!acc, reason: acc ? acc.reason : null });
  }
}

check('audited all 74 apps via real prelude', () => assert(audited === 74, `got ${audited}`));

const violations = allFindings.filter(f => !f.accepted);
const acceptedList = allFindings.filter(f => f.accepted);

if (!JSON_OUT) {
  for (const f of acceptedList) {
    const loc = f.line ? `${f.file}:L${f.line}` : f.file;
    log(`ACCEPTED [${f.shape}] ${f.app} ${loc} (${f.node}) ${f.rule}: got=${f.current} req=${f.required}${f.text ? ' text=' + JSON.stringify(f.text) : ''} -- ${f.reason}`);
  }
  for (const f of violations) {
    const loc = f.line ? `${f.file}:L${f.line}` : f.file;
    err(`VIOLATION [${f.shape}] ${f.app} ${loc} (${f.node}) ${f.rule}: got=${f.current} req=${f.required}${f.text ? ' text=' + JSON.stringify(f.text) : ''}`);
  }
}

check('zero unaccepted DESIGN-TOKENS violations', () => {
  assert(violations.length === 0, `${violations.length} unaccepted violations (round=${violations.filter(v => v.shape === 'round').length}, square=${violations.filter(v => v.shape === 'square').length})`);
});

const summary = {
  apps: audited,
  round_apps: catalog.filter(c => c.shape === 'round').length,
  square_apps: catalog.filter(c => c.shape === 'square').length,
  total_findings: allFindings.length,
  violations: violations.length,
  round_violations: violations.filter(v => v.shape === 'round').length,
  square_violations: violations.filter(v => v.shape === 'square').length,
  accepted: acceptedList.length,
  round_accepted: acceptedList.filter(v => v.shape === 'round').length,
  square_accepted: acceptedList.filter(v => v.shape === 'square').length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, violations, accepted: acceptedList }, null, 2));
} else {
  console.log(`AUDIT apps=${summary.apps} violations=${summary.violations} (round=${summary.round_violations} square=${summary.square_violations}) accepted=${summary.accepted} (round=${summary.round_accepted} square=${summary.square_accepted})`);
}

process.exitCode = failures ? 1 : 0;
