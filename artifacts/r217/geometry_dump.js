/* r217 reproducible geometry evidence for shell.Keyboard consumers: wordle, keyboard_demo.
 * Usage: node artifacts/r217/geometry_dump.js
 *
 * Runs each real app source through tests/lib/prelude_runner.js (firmware
 * prelude in a Node vm) with runtime/shell.js prepended, then resolves both
 * absolute-positioned nodes and flex-laid-out Keyboard rows/keys into screen
 * coordinates on the 480x480 display (center (240,240), R=240 full circle,
 * R=233 visible 466px bezel, inscribed safe square [75,405]).
 * Host-only evidence; no firmware/board needed.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = path.resolve(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'runtime/shell.js'), 'utf8');
const ATTR = {
  TEXT: 0, WIDTH: 2, HEIGHT: 3, VISIBLE: 5, PARENT: 6,
  FLEX_DIR: 7, JUSTIFY: 8, ALIGN: 9, PADDING: 10, GAP: 11, RADIUS: 12,
  X: 18, Y: 19,
};
const KIND = ['View', 'Text', 'Btn', 'Canvas', 'Img', 'Arc', 'Slider', 'Switch'];
const SAFE_MIN = 75, SAFE_MAX = 405, CX = 240, CY = 240, R_SCREEN = 240, R_BEZEL = 233;

function maxCornerR(x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  let m = 0;
  for (const [x, y] of pts) {
    const r = Math.hypot(x - CX, y - CY);
    if (r > m) m = r;
  }
  return +m.toFixed(1);
}

function safeTag(x0, y0, x1, y1) {
  const inSq = x0 >= SAFE_MIN && x1 <= SAFE_MAX && y0 >= SAFE_MIN && y1 <= SAFE_MAX;
  const rMax = maxCornerR(x0, y0, x1, y1);
  const inCircle = rMax <= R_SCREEN;
  const inBezel = rMax <= R_BEZEL;
  return `Rmax=${rMax} clr240=${(R_SCREEN - rMax).toFixed(1)} clr233=${(R_BEZEL - rMax).toFixed(1)} ${inSq ? 'IN_SAFE' : 'OUT_SAFE'} ${inCircle ? 'IN_R240' : 'OUT_R240'} ${inBezel ? 'IN_R233' : 'OUT_R233'}`;
}

function loadApp(name) {
  const raw = fs.readFileSync(path.join(root, 'examples', name, 'app.js'), 'utf8');
  const hasShell = /runtime\/shell\.js/.test(raw);
  const src = raw.replace(/^\s*import\s+[^;]*runtime\/shell\.js[^;]*;\s*$/m, '');
  const s = runApp((hasShell ? shell + '\n' : '') + src, { filename: name + '/app.js' });
  if (typeof s.ctx.__lume_tick === 'function') s.ctx.__lume_tick();
  return { raw, s };
}

function buildTree(s) {
  const nodes = new Map();
  const children = new Map();
  const pressSet = new Set();
  for (const m of s.messages) {
    if (m[0] === 'create') {
      const id = m[1], parent = m[3];
      nodes.set(id, { id, kind: m[2], parent, w: m[4] || undefined, h: m[5] || undefined, vis: 1 });
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    } else if (m[0] === 'attr') {
      const n = nodes.get(m[1]);
      if (!n) continue;
      const a = m[2], v = m[3];
      if (a === ATTR.X) n.x = v;
      else if (a === ATTR.Y) n.y = v;
      else if (a === ATTR.WIDTH) n.w = v;
      else if (a === ATTR.HEIGHT) n.h = v;
      else if (a === ATTR.VISIBLE) n.vis = v;
      else if (a === ATTR.TEXT) n.text = v;
      else if (a === ATTR.PARENT) n.parent = v;
      else if (a === ATTR.RADIUS) n.r = v;
      else if (a === ATTR.FLEX_DIR) n.flexDir = v;
      else if (a === ATTR.JUSTIFY) n.justify = v;
      else if (a === ATTR.ALIGN) n.align = v;
      else if (a === ATTR.PADDING) n.pad = v;
      else if (a === ATTR.GAP) n.gap = v;
    } else if (m[0] === 'press') pressSet.add(m[1]);
  }

  function measure(id) {
    const n = nodes.get(id);
    const kids = (children.get(id) || []).filter(cid => nodes.has(cid));
    for (const cid of kids) measure(cid);
    const pad = n.pad || 0;
    const gap = n.gap || 0;
    if (n.w !== undefined && n.h !== undefined) {
      n.rw = n.w; n.rh = n.h;
      return;
    }
    if (n.flexDir === 0) {
      const sumW = kids.reduce((acc, cid) => acc + (nodes.get(cid).rw || 0), 0) + Math.max(0, kids.length - 1) * gap;
      const maxH = kids.reduce((acc, cid) => Math.max(acc, nodes.get(cid).rh || 0), 0);
      n.rw = n.w !== undefined ? n.w : sumW + 2 * pad;
      n.rh = n.h !== undefined ? n.h : maxH + 2 * pad;
    } else if (n.flexDir === 1) {
      const maxW = kids.reduce((acc, cid) => Math.max(acc, nodes.get(cid).rw || 0), 0);
      const sumH = kids.reduce((acc, cid) => acc + (nodes.get(cid).rh || 0), 0) + Math.max(0, kids.length - 1) * gap;
      n.rw = n.w !== undefined ? n.w : maxW + 2 * pad;
      n.rh = n.h !== undefined ? n.h : sumH + 2 * pad;
    } else {
      n.rw = n.w || 0;
      n.rh = n.h || 0;
    }
  }

  function layout(id, ax, ay) {
    const n = nodes.get(id);
    n.ax = ax; n.ay = ay;
    const kids = (children.get(id) || []).filter(cid => nodes.has(cid));
    if (!kids.length) return;
    const pad = n.pad || 0;
    const gap = n.gap || 0;
    const ix = ax + pad, iy = ay + pad;
    const iw = n.rw - 2 * pad, ih = n.rh - 2 * pad;
    if (n.flexDir === 1) {
      const flow = kids.filter(cid => nodes.get(cid).x === undefined && nodes.get(cid).y === undefined);
      const totalH = flow.reduce((acc, cid) => acc + nodes.get(cid).rh, 0) + Math.max(0, flow.length - 1) * gap;
      let cy = n.justify === 2 ? iy + (ih - totalH) / 2 : iy;
      for (const cid of kids) {
        const c = nodes.get(cid);
        if (c.x !== undefined || c.y !== undefined) {
          layout(cid, ax + (c.x || 0), ay + (c.y || 0));
        } else {
          const cx = n.align === 2 ? ix + (iw - c.rw) / 2 : ix;
          layout(cid, cx, cy);
          cy += c.rh + gap;
        }
      }
    } else if (n.flexDir === 0) {
      const flow = kids.filter(cid => nodes.get(cid).x === undefined && nodes.get(cid).y === undefined);
      const totalW = flow.reduce((acc, cid) => acc + nodes.get(cid).rw, 0) + Math.max(0, flow.length - 1) * gap;
      let cx = n.justify === 2 ? ix + (iw - totalW) / 2 : ix;
      for (const cid of kids) {
        const c = nodes.get(cid);
        if (c.x !== undefined || c.y !== undefined) {
          layout(cid, ax + (c.x || 0), ay + (c.y || 0));
        } else {
          const cy = n.align === 2 ? iy + (ih - c.rh) / 2 : iy;
          layout(cid, cx, cy);
          cx += c.rw + gap;
        }
      }
    } else {
      for (const cid of kids) {
        const c = nodes.get(cid);
        layout(cid, ax + (c.x || 0), ay + (c.y || 0));
      }
    }
  }

  const roots = children.get(0) || [];
  for (const rid of roots) {
    measure(rid);
    const r = nodes.get(rid);
    layout(rid, r.x || 0, r.y || 0);
  }
  return { nodes, children, pressSet };
}

function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function dumpApp(name, kbGlobal) {
  const { s } = loadApp(name);
  const { nodes, children, pressSet } = buildTree(s);
  const kbId = s.ctx[kbGlobal];
  console.log('=== ' + name.toUpperCase() + ' ===');

  const kbRows = (children.get(kbId) || []).filter(cid => nodes.get(cid)?.kind === 0);
  const kbRowSet = new Set(kbRows);
  const kbKeyIds = new Set();
  for (const rid of kbRows) {
    for (const kid of (children.get(rid) || [])) {
      if (nodes.get(kid)?.kind === 2) kbKeyIds.add(kid);
    }
  }

  for (const [id, n] of nodes) {
    if (kbRowSet.has(id) || kbKeyIds.has(id)) continue;
    const x0 = n.ax, y0 = n.ay, x1 = n.ax + n.rw, y1 = n.ay + n.rh;
    const press = pressSet.has(id) ? ' [PRESS]' : '';
    const kbTag = id === kbId ? ' [KB_ROOT]' : '';
    const tag = (n.rw > 0 || n.rh > 0) ? ' ' + safeTag(x0, y0, x1, y1) : '';
    console.log(
      'node ' + id + ' (' + (KIND[n.kind] || n.kind) + ', p=' + n.parent + '):' +
      ' w=' + n.rw + ' h=' + n.rh +
      ' abs=[' + fmt(x0) + '..' + fmt(x1) + ',' + fmt(y0) + '..' + fmt(y1) + ']' +
      ' pad=' + (n.pad ?? '-') + ' gap=' + (n.gap ?? '-') + press + kbTag + tag +
      ' text="' + String(n.text === undefined ? '' : n.text).replace(/\n/g, '\\n') + '"'
    );
  }

  const kb = nodes.get(kbId);
  console.log(`--- ${name.toUpperCase()} KEYBOARD KEYS (root=${kbId}, rows=${kbRows.length}, keys=${kbKeyIds.size}, root=[${fmt(kb.ax)}..${fmt(kb.ax + kb.rw)},${fmt(kb.ay)}..${fmt(kb.ay + kb.rh)}] ${kb.rw}x${kb.rh}, gap=${kb.gap}, pad=${kb.pad}) ---`);

  let minW = Infinity, maxW = 0, minH = Infinity, maxH = 0;
  let worstR = 0, worstKey = '';
  let pass48x48 = 0, passH48 = 0, passR240 = 0, passR233 = 0, passSafe = 0;
  let totalKeys = 0;

  kbRows.forEach((rid, rowIdx) => {
    const r = nodes.get(rid);
    const kids = (children.get(rid) || []).filter(kid => nodes.get(kid)?.kind === 2);
    console.log(`  row[${rowIdx}] (node ${rid}, ${kids.length} keys): abs=[${fmt(r.ax)}..${fmt(r.ax + r.rw)},${fmt(r.ay)}..${fmt(r.ay + r.rh)}] ${fmt(r.rw)}x${fmt(r.rh)} ${safeTag(r.ax, r.ay, r.ax + r.rw, r.ay + r.rh)}`);
    for (const kid of kids) {
      const k = nodes.get(kid);
      const x0 = k.ax, y0 = k.ay, x1 = k.ax + k.rw, y1 = k.ay + k.rh;
      const rMax = maxCornerR(x0, y0, x1, y1);
      const inSq = x0 >= SAFE_MIN && x1 <= SAFE_MAX && y0 >= SAFE_MIN && y1 <= SAFE_MAX;
      totalKeys++;
      if (k.rw < minW) minW = k.rw;
      if (k.rw > maxW) maxW = k.rw;
      if (k.rh < minH) minH = k.rh;
      if (k.rh > maxH) maxH = k.rh;
      if (rMax > worstR) { worstR = rMax; worstKey = `${k.text}(row${rowIdx})`; }
      if (k.rw >= 48 && k.rh >= 48) pass48x48++;
      if (k.rh >= 48) passH48++;
      if (rMax <= R_SCREEN) passR240++;
      if (rMax <= R_BEZEL) passR233++;
      if (inSq) passSafe++;
      const tTag = (k.rw >= 48 && k.rh >= 48) ? 'TOUCH_48x48' : (k.rh >= 48 ? 'TOUCH_H48_ONLY' : 'TOUCH_UNDER48');
      console.log(`    key "${k.text}" (node ${kid}): ${k.rw}x${k.rh} abs=[${fmt(x0)}..${fmt(x1)},${fmt(y0)}..${fmt(y1)}] ${tTag} ${safeTag(x0, y0, x1, y1)}`);
    }
  });

  console.log(`SUMMARY ${name}: totalKeys=${totalKeys} w=${minW}..${maxW} h=${minH}..${maxH} touch48x48=${pass48x48}/${totalKeys} touchH48=${passH48}/${totalKeys} inR240=${passR240}/${totalKeys} inR233=${passR233}/${totalKeys} inSafe=${passSafe}/${totalKeys} worstR=${worstR} (${worstKey})`);
  console.log('');
}

dumpApp('wordle', 'wdKb');
dumpApp('keyboard_demo', 'kb');
