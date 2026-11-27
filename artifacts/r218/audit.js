/* r218 full-manifest round-screen safe-area & touch-target geometry audit.
 * Usage: node artifacts/r218/audit.js [--apps app1,app2] [--json out.json] [--txt out.txt]
 *
 * Runs every app in tools/playground/build.mjs manifest through esbuild IIFE
 * bundling (matching playground/CLI) + tests/lib/prelude_runner.js (firmware
 * prelude in a Node vm), ticks one frame if __lume_tick exists, resolves full
 * node tree layout (absolute, align, flex row/col/wrap, pct, per-side padding),
 * and reports screen-space bounds, Rmax from (240,240), IN_SAFE [75,405],
 * IN_R240 (<=240), touch targets (<48x48), card borderRadius (>12), canvas
 * text/sprite bounds, and non-ASCII bytes.
 * Host-only evidence; no firmware/board needed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { readManifest } = require('../../tests/lib/manifest');
const { runApp } = require('../../tests/lib/prelude_runner');

const root = path.resolve(__dirname, '../..');
const lumeReq = createRequire(path.join(root, 'tools/lume/package.json'));
const esbuild = lumeReq('esbuild');

const ATTR = {
  TEXT: 0, BG_COLOR: 1, WIDTH: 2, HEIGHT: 3, ALIGN: 4, VISIBLE: 5, PARENT: 6,
  FLEX_FLOW: 7, FLEX_MAIN: 8, FLEX_CROSS: 9, PADDING: 10, GAP: 11, RADIUS: 12,
  BORDER_WIDTH: 13, BORDER_COLOR: 14, OPACITY: 15, WIDTH_PCT: 16, HEIGHT_PCT: 17,
  X: 18, Y: 19, SCROLL_DIR: 20, SCROLLBAR_MODE: 21, SCROLL_Y: 22, IGNORE_LAYOUT: 23,
  PAD_TOP: 30, PAD_RIGHT: 31, PAD_BOTTOM: 32, PAD_LEFT: 33,
  MARGIN: 34, MARGIN_TOP: 35, MARGIN_RIGHT: 36, MARGIN_BOTTOM: 37, MARGIN_LEFT: 38,
  FLEX_GROW: 39, ALIGN_TARGET: 40, ALIGN_OFS_X: 41, ALIGN_OFS_Y: 42,
  WIDTH_AUTO: 43, HEIGHT_AUTO: 44,
  TRANSLATE_X: 49, TRANSLATE_X_PCT: 50, TRANSLATE_Y: 51, TRANSLATE_Y_PCT: 52,
  TEXT_ALIGN: 53, TEXT_LONG_MODE: 54, TEXT_FONT: 55,
};

const KIND = ['View', 'Text', 'Btn', 'Canvas', 'Img', 'Arc'];
const SCREEN_W = 480, SCREEN_H = 480;
const CX = 240, CY = 240, R_SCREEN = 240, R_BEZEL = 233;
const SAFE_MIN = 75, SAFE_MAX = 405;

function maxCornerR(x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  let m = 0;
  for (const [x, y] of pts) {
    const r = Math.hypot(x - CX, y - CY);
    if (r > m) m = r;
  }
  return +m.toFixed(1);
}

function boxMetrics(x0, y0, x1, y1) {
  const rMax = maxCornerR(x0, y0, x1, y1);
  const inSafe = x0 >= SAFE_MIN && x1 <= SAFE_MAX && y0 >= SAFE_MIN && y1 <= SAFE_MAX;
  const inR240 = rMax <= R_SCREEN;
  const inR233 = rMax <= R_BEZEL;
  return { rMax, inSafe, inR240, inR233 };
}

function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function bundleApp(name) {
  const entry = path.join(root, 'examples', name, 'app.js');
  const res = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'neutral',
    target: 'es2020',
    minify: false,
    write: false,
    logLevel: 'silent',
    charset: 'utf8',
  });
  return res.outputFiles[0].text;
}

function analyzeSource(name) {
  const filePath = path.join(root, 'examples', name, 'app.js');
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let nonAsciiLines = 0;
  for (const l of lines) {
    if (/[^\x00-\x7F]/.test(l)) nonAsciiLines++;
  }
  return { raw, nonAsciiLines, usesSafeArea: /\bSafeArea\b/.test(raw), usesShell: /runtime\/shell\.js/.test(raw) };
}

function buildTree(messages) {
  const nodes = new Map();
  const children = new Map(); // parentId -> [childId]
  const removed = new Set();
  const pressSet = new Set();
  const gestureSet = new Set();
  const canvasDraws = new Map(); // nodeId -> [{op, ...}]
  const spriteSizes = new Map(); // `${id}:${slot}` -> {w,h}

  function addChild(parent, id) {
    if (!children.has(parent)) children.set(parent, []);
    const list = children.get(parent);
    if (!list.includes(id)) list.push(id);
  }
  function removeChildRef(parent, id) {
    const list = children.get(parent);
    if (!list) return;
    const idx = list.indexOf(id);
    if (idx !== -1) list.splice(idx, 1);
  }
  function markRemoved(id) {
    removed.add(id);
    const kids = children.get(id) || [];
    for (const cid of kids) markRemoved(cid);
  }

  for (const m of messages) {
    const op = m[0];
    if (op === 'create') {
      const id = m[1], kind = m[2], parent = m[3], w = m[4], h = m[5];
      nodes.set(id, {
        id, kind, parent,
        w: w > 0 ? w : undefined,
        h: h > 0 ? h : undefined,
        vis: 1,
        opacity: 255,
      });
      addChild(parent, id);
    } else if (op === 'remove') {
      const id = m[1];
      const n = nodes.get(id);
      if (n) {
        removeChildRef(n.parent, id);
        markRemoved(id);
      }
    } else if (op === 'attr') {
      const id = m[1], a = m[2], v = m[3];
      const n = nodes.get(id);
      if (!n) continue;
      if (a === ATTR.TEXT) n.text = v;
      else if (a === ATTR.BG_COLOR) n.bg = v;
      else if (a === ATTR.WIDTH) { n.w = v; n.wPct = undefined; n.wAuto = false; }
      else if (a === ATTR.HEIGHT) { n.h = v; n.hPct = undefined; n.hAuto = false; }
      else if (a === ATTR.WIDTH_PCT) { n.wPct = v; n.w = undefined; n.wAuto = false; }
      else if (a === ATTR.HEIGHT_PCT) { n.hPct = v; n.h = undefined; n.hAuto = false; }
      else if (a === ATTR.WIDTH_AUTO) { n.wAuto = true; n.w = undefined; }
      else if (a === ATTR.HEIGHT_AUTO) { n.hAuto = true; n.h = undefined; }
      else if (a === ATTR.ALIGN) n.align = v;
      else if (a === ATTR.ALIGN_TARGET) n.alignTarget = v;
      else if (a === ATTR.ALIGN_OFS_X) n.alignOfsX = v;
      else if (a === ATTR.ALIGN_OFS_Y) n.alignOfsY = v;
      else if (a === ATTR.VISIBLE) n.vis = v;
      else if (a === ATTR.PARENT) {
        if (n.parent !== v) {
          removeChildRef(n.parent, id);
          n.parent = v;
          addChild(v, id);
        }
      }
      else if (a === ATTR.FLEX_FLOW) n.flexFlow = v;
      else if (a === ATTR.FLEX_MAIN) n.flexMain = v;
      else if (a === ATTR.FLEX_CROSS) n.flexCross = v;
      else if (a === ATTR.PADDING) { n.padT = n.padR = n.padB = n.padL = v; }
      else if (a === ATTR.PAD_TOP) n.padT = v;
      else if (a === ATTR.PAD_RIGHT) n.padR = v;
      else if (a === ATTR.PAD_BOTTOM) n.padB = v;
      else if (a === ATTR.PAD_LEFT) n.padL = v;
      else if (a === ATTR.GAP) n.gap = v;
      else if (a === ATTR.RADIUS) n.r = v;
      else if (a === ATTR.BORDER_WIDTH) n.bw = v;
      else if (a === ATTR.BORDER_COLOR) n.bc = v;
      else if (a === ATTR.OPACITY) n.opacity = v;
      else if (a === ATTR.X) n.x = v;
      else if (a === ATTR.Y) n.y = v;
      else if (a === ATTR.SCROLL_DIR) n.scrollDir = v;
      else if (a === ATTR.IGNORE_LAYOUT) n.ignoreLayout = v;
      else if (a === ATTR.FLEX_GROW) n.flexGrow = v;
      else if (a === ATTR.TRANSLATE_X) n.tx = v;
      else if (a === ATTR.TRANSLATE_Y) n.ty = v;
      else if (a === ATTR.TEXT_FONT) n.fontSize = v;
    } else if (op === 'press') {
      pressSet.add(m[1]);
    } else if (op === 'gesture') {
      gestureSet.add(m[1]);
    } else if (op === 'draw') {
      const cid = m[1], dop = m[2];
      if (!canvasDraws.has(cid)) canvasDraws.set(cid, []);
      canvasDraws.get(cid).push({ op: dop, x: m[3], y: m[4], a: m[5], b: m[6], color: m[7], width: m[8], label: m[9], from: m[9], to: m[10] });
    } else if (op === 'spriteDefine') {
      spriteSizes.set(`${m[1]}:${m[2]}`, { w: m[3], h: m[4] });
    } else if (op === 'spriteDraw') {
      const cid = m[1], slot = m[2], dx = m[3] || 0, dy = m[4] || 0;
      const sz = spriteSizes.get(`${cid}:${slot}`);
      if (!canvasDraws.has(cid)) canvasDraws.set(cid, []);
      if (sz) canvasDraws.get(cid).push({ op: 'sprite', x: dx, y: dy, w: sz.w, h: sz.h, slot });
    }
  }

  // Filter removed nodes
  for (const id of removed) nodes.delete(id);

  function liveKids(pid) {
    return (children.get(pid) || []).filter(cid => nodes.has(cid));
  }

  function getPad(n) {
    return { t: n.padT || 0, r: n.padR || 0, b: n.padB || 0, l: n.padL || 0 };
  }

  function estTextSize(n, availW) {
    const fs = n.fontSize || 16;
    const str = n.text !== undefined ? String(n.text) : '';
    const lines = str.split('\n');
    const maxLen = lines.reduce((acc, s) => Math.max(acc, s.length), 0);
    const charW = fs * 0.55;
    const w = Math.min(availW || SCREEN_W, Math.ceil(maxLen * charW));
    const h = Math.ceil(lines.length * (fs * 1.25));
    return { w, h };
  }

  function measure(id, parentInnerW, parentInnerH) {
    const n = nodes.get(id);
    const p = getPad(n);
    const gap = n.gap || 0;

    // Resolve explicit or percentage sizes first
    let rw = n.w !== undefined ? n.w : (n.wPct !== undefined ? Math.round(parentInnerW * n.wPct / 100) : undefined);
    let rh = n.h !== undefined ? n.h : (n.hPct !== undefined ? Math.round(parentInnerH * n.hPct / 100) : undefined);

    const innerW = rw !== undefined ? Math.max(0, rw - p.l - p.r) : Math.max(0, parentInnerW - p.l - p.r);
    const innerH = rh !== undefined ? Math.max(0, rh - p.t - p.b) : Math.max(0, parentInnerH - p.t - p.b);

    const kids = liveKids(id);
    for (const cid of kids) measure(cid, innerW, innerH);

    if (rw === undefined || rh === undefined) {
      if (n.kind === 1) {
        const est = estTextSize(n, innerW);
        if (rw === undefined) rw = est.w + p.l + p.r;
        if (rh === undefined) rh = est.h + p.t + p.b;
      } else if (n.kind === 2) {
        const est = estTextSize(n, innerW);
        if (rw === undefined) rw = Math.max(est.w + Math.max(24, p.l + p.r), 48);
        if (rh === undefined) rh = Math.max(est.h + Math.max(12, p.t + p.b), 36);
      } else if (n.flexFlow === 0 || n.flexFlow === 2) {
        const flow = kids.filter(cid => {
          const c = nodes.get(cid);
          return c.vis !== 0 && !c.ignoreLayout && c.x === undefined && c.y === undefined && c.align === undefined;
        });
        const sumW = flow.reduce((acc, cid) => {
          const c = nodes.get(cid);
          return acc + ((c.flexGrow > 0 && c.w === undefined && c.wPct === undefined) ? 0 : (c.rw || 0));
        }, 0) + Math.max(0, flow.length - 1) * gap;
        const maxH = flow.reduce((acc, cid) => Math.max(acc, nodes.get(cid).rh || 0), 0);
        if (rw === undefined) rw = sumW + p.l + p.r;
        if (rh === undefined) rh = maxH + p.t + p.b;
      } else if (n.flexFlow === 1 || n.flexFlow === 3) {
        const flow = kids.filter(cid => {
          const c = nodes.get(cid);
          return c.vis !== 0 && !c.ignoreLayout && c.x === undefined && c.y === undefined && c.align === undefined;
        });
        const maxW = flow.reduce((acc, cid) => Math.max(acc, nodes.get(cid).rw || 0), 0);
        const sumH = flow.reduce((acc, cid) => {
          const c = nodes.get(cid);
          return acc + ((c.flexGrow > 0 && c.h === undefined && c.hPct === undefined) ? 0 : (c.rh || 0));
        }, 0) + Math.max(0, flow.length - 1) * gap;
        if (rw === undefined) rw = maxW + p.l + p.r;
        if (rh === undefined) rh = sumH + p.t + p.b;
      } else {
        if (rw === undefined) rw = kids.reduce((acc, cid) => Math.max(acc, (nodes.get(cid).x || 0) + (nodes.get(cid).rw || 0)), 0) + p.l + p.r;
        if (rh === undefined) rh = kids.reduce((acc, cid) => Math.max(acc, (nodes.get(cid).y || 0) + (nodes.get(cid).rh || 0)), 0) + p.t + p.b;
      }
    }

    n.rw = rw || 0;
    n.rh = rh || 0;
  }

  function alignPos(c, px, py, pw, ph) {
    const a = c.align;
    const ox = c.alignOfsX || 0;
    const oy = c.alignOfsY || 0;
    let x = px, y = py;
    if (a === 0) { x = px + (pw - c.rw) / 2; y = py + (ph - c.rh) / 2; }
    else if (a === 1) { x = px; y = py; }
    else if (a === 2) { x = px + (pw - c.rw) / 2; y = py; }
    else if (a === 3) { x = px + pw - c.rw; y = py; }
    else if (a === 4) { x = px + (pw - c.rw) / 2; y = py + ph - c.rh; }
    else if (a === 5) { x = px; y = py + ph - c.rh; }
    else if (a === 6) { x = px + pw - c.rw; y = py + ph - c.rh; }
    else if (a === 7) { x = px; y = py + (ph - c.rh) / 2; }
    else if (a === 8) { x = px + pw - c.rw; y = py + (ph - c.rh) / 2; }
    return [x + ox, y + oy];
  }

  function layout(id, ax, ay, parentVis, parentScrollable) {
    const n = nodes.get(id);
    const tx = n.tx || 0, ty = n.ty || 0;
    n.ax = ax + tx;
    n.ay = ay + ty;
    n.effVis = parentVis && (n.vis !== 0) && (n.opacity !== 0);
    n.inScroll = parentScrollable;

    const kids = liveKids(id);
    if (!kids.length) return;
    const p = getPad(n);
    const gap = n.gap || 0;
    const ix = n.ax + p.l, iy = n.ay + p.t;
    const iw = Math.max(0, n.rw - p.l - p.r);
    const ih = Math.max(0, n.rh - p.t - p.b);
    const childScroll = parentScrollable || (n.scrollDir === 1 || n.scrollDir === 2);

    const isAbs = c => c.ignoreLayout || c.x !== undefined || c.y !== undefined || c.align !== undefined;

    if (n.flexFlow === 1 || n.flexFlow === 3) {
      // Column
      const flow = kids.filter(cid => { const c = nodes.get(cid); return c.vis !== 0 && !isAbs(c); });
      const totalGrow = flow.reduce((acc, cid) => acc + (nodes.get(cid).flexGrow || 0), 0);
      const fixedH = flow.reduce((acc, cid) => {
        const c = nodes.get(cid);
        return acc + ((c.flexGrow > 0 && c.h === undefined && c.hPct === undefined) ? 0 : (c.rh || 0));
      }, 0) + Math.max(0, flow.length - 1) * gap;
      const extraH = Math.max(0, ih - fixedH);
      if (totalGrow > 0 && extraH > 0) {
        for (const cid of flow) {
          const c = nodes.get(cid);
          if (c.flexGrow > 0) {
            const base = (c.h === undefined && c.hPct === undefined) ? 0 : (c.rh || 0);
            c.rh = base + extraH * (c.flexGrow / totalGrow);
            const cp = getPad(c);
            for (const gcid of liveKids(cid)) {
              const gc = nodes.get(gcid);
              if (gc.hPct !== undefined) gc.rh = Math.round(Math.max(0, c.rh - cp.t - cp.b) * gc.hPct / 100);
            }
          }
        }
      }
      const totalH = flow.reduce((acc, cid) => acc + (nodes.get(cid).rh || 0), 0) + Math.max(0, flow.length - 1) * gap;
      let cy = iy;
      let stepGap = gap;
      if (n.flexMain === 1) cy = iy + (ih - totalH);
      else if (n.flexMain === 2) cy = iy + (ih - totalH) / 2;
      else if (n.flexMain === 3 && flow.length > 1) stepGap = Math.max(0, (ih - (totalH - (flow.length - 1) * gap)) / (flow.length - 1));
      else if (n.flexMain === 4 && flow.length > 0) {
        const sp = Math.max(0, (ih - (totalH - (flow.length - 1) * gap)) / flow.length);
        cy = iy + sp / 2; stepGap = sp;
      } else if (n.flexMain === 5 && flow.length > 0) {
        const sp = Math.max(0, (ih - (totalH - (flow.length - 1) * gap)) / (flow.length + 1));
        cy = iy + sp; stepGap = sp;
      }

      for (const cid of kids) {
        const c = nodes.get(cid);
        if (isAbs(c)) {
          if (c.align !== undefined) {
            const [cx, cay] = alignPos(c, ix, iy, iw, ih);
            layout(cid, cx, cay, n.effVis, childScroll);
          } else {
            layout(cid, n.ax + (c.x || 0), n.ay + (c.y || 0), n.effVis, childScroll);
          }
        } else if (c.vis === 0) {
          layout(cid, ix, cy, false, childScroll);
        } else {
          let cx = ix;
          if (n.flexCross === 1) cx = ix + iw - c.rw;
          else if (n.flexCross === 2) cx = ix + (iw - c.rw) / 2;
          else if (n.flexCross === 3 && c.w === undefined && c.wPct === undefined) c.rw = iw;
          layout(cid, cx, cy, n.effVis, childScroll);
          cy += c.rh + stepGap;
        }
      }
    } else if (n.flexFlow === 0 || n.flexFlow === 2) {
      // Row (with wrap if flexFlow === 2)
      const flow = kids.filter(cid => { const c = nodes.get(cid); return c.vis !== 0 && !isAbs(c); });
      if (n.flexFlow === 2) {
        // Row wrap
        let cx = ix, cy = iy, rowH = 0;
        for (const cid of kids) {
          const c = nodes.get(cid);
          if (isAbs(c)) {
            if (c.align !== undefined) {
              const [ax2, ay2] = alignPos(c, ix, iy, iw, ih);
              layout(cid, ax2, ay2, n.effVis, childScroll);
            } else {
              layout(cid, n.ax + (c.x || 0), n.ay + (c.y || 0), n.effVis, childScroll);
            }
          } else if (c.vis === 0) {
            layout(cid, cx, cy, false, childScroll);
          } else {
            if (cx > ix && cx + c.rw > ix + iw + 0.5) {
              cx = ix; cy += rowH + gap; rowH = 0;
            }
            layout(cid, cx, cy, n.effVis, childScroll);
            cx += c.rw + gap;
            if (c.rh > rowH) rowH = c.rh;
          }
        }
      } else {
        const totalGrow = flow.reduce((acc, cid) => acc + (nodes.get(cid).flexGrow || 0), 0);
        const fixedW = flow.reduce((acc, cid) => {
          const c = nodes.get(cid);
          return acc + ((c.flexGrow > 0 && c.w === undefined && c.wPct === undefined) ? 0 : (c.rw || 0));
        }, 0) + Math.max(0, flow.length - 1) * gap;
        const extraW = Math.max(0, iw - fixedW);
        if (totalGrow > 0 && extraW > 0) {
          for (const cid of flow) {
            const c = nodes.get(cid);
            if (c.flexGrow > 0) {
              const base = (c.w === undefined && c.wPct === undefined) ? 0 : (c.rw || 0);
              c.rw = base + extraW * (c.flexGrow / totalGrow);
              const cp = getPad(c);
              for (const gcid of liveKids(cid)) {
                const gc = nodes.get(gcid);
                if (gc.wPct !== undefined) gc.rw = Math.round(Math.max(0, c.rw - cp.l - cp.r) * gc.wPct / 100);
              }
            }
          }
        }
        const totalW = flow.reduce((acc, cid) => acc + (nodes.get(cid).rw || 0), 0) + Math.max(0, flow.length - 1) * gap;
        let cx = ix;
        let stepGap = gap;
        if (n.flexMain === 1) cx = ix + (iw - totalW);
        else if (n.flexMain === 2) cx = ix + (iw - totalW) / 2;
        else if (n.flexMain === 3 && flow.length > 1) stepGap = Math.max(0, (iw - (totalW - (flow.length - 1) * gap)) / (flow.length - 1));
        else if (n.flexMain === 4 && flow.length > 0) {
          const sp = Math.max(0, (iw - (totalW - (flow.length - 1) * gap)) / flow.length);
          cx = ix + sp / 2; stepGap = sp;
        } else if (n.flexMain === 5 && flow.length > 0) {
          const sp = Math.max(0, (iw - (totalW - (flow.length - 1) * gap)) / (flow.length + 1));
          cx = ix + sp; stepGap = sp;
        }
        for (const cid of kids) {
          const c = nodes.get(cid);
          if (isAbs(c)) {
            if (c.align !== undefined) {
              const [ax2, ay2] = alignPos(c, ix, iy, iw, ih);
              layout(cid, ax2, ay2, n.effVis, childScroll);
            } else {
              layout(cid, n.ax + (c.x || 0), n.ay + (c.y || 0), n.effVis, childScroll);
            }
          } else if (c.vis === 0) {
            layout(cid, cx, cy, false, childScroll);
          } else {
            let cy = iy;
            if (n.flexCross === 1) cy = iy + ih - c.rh;
            else if (n.flexCross === 2) cy = iy + (ih - c.rh) / 2;
            else if (n.flexCross === 3 && c.h === undefined && c.hPct === undefined) c.rh = ih;
            layout(cid, cx, cy, n.effVis, childScroll);
            cx += c.rw + stepGap;
          }
        }
      }
    } else {
      for (const cid of kids) {
        const c = nodes.get(cid);
        if (c.align !== undefined) {
          const [cx, cy] = alignPos(c, ix, iy, iw, ih);
          layout(cid, cx, cy, n.effVis, childScroll);
        } else {
          layout(cid, n.ax + (c.x || 0), n.ay + (c.y || 0), n.effVis, childScroll);
        }
      }
    }
  }

  const roots = liveKids(0);
  for (const rid of roots) {
    measure(rid, SCREEN_W, SCREEN_H);
    const r = nodes.get(rid);
    if (r.align !== undefined) {
      const [rx, ry] = alignPos(r, 0, 0, SCREEN_W, SCREEN_H);
      layout(rid, rx, ry, true, false);
    } else {
      layout(rid, r.x || 0, r.y || 0, true, false);
    }
  }

  return { nodes, children, pressSet, gestureSet, canvasDraws };
}

function isCircularOrPill(n) {
  if (!n.r) return false;
  const minDim = Math.min(n.rw, n.rh);
  if (minDim <= 0) return false;
  return n.r >= Math.floor(minDim / 2) - 1 || n.r >= 99;
}

function isBackdropOrWrapper(n, pressSet) {
  if (n.kind === 0) {
    // Full screen root or backdrop container
    if (n.rw >= 460 && n.rh >= 460 && !pressSet.has(n.id)) return true;
    // Circular dial bezel (e.g. 436x436 r=218)
    if (n.rw >= 400 && n.rh >= 400 && isCircularOrPill(n) && !pressSet.has(n.id)) return true;
    // SafeArea or transparent flex container with no background, no border, no press
    if (n.bg === undefined && !n.bw && !pressSet.has(n.id)) return true;
  }
  return false;
}

function auditApp(name) {
  const srcInfo = analyzeSource(name);
  let runErr = null;
  let tickErr = null;
  let s;
  try {
    const bundled = bundleApp(name);
    const preludeSetup = `
      if (!lume.raycast) lume.raycast = { setMap: function(){}, setTextures: function(){}, render: function(){} };
      if (lume.image && lume.image.sizeOf) {
        var _origSizeOf = lume.image.sizeOf, _origSetSrc = lume.image._setSource;
        lume.image.sizeOf = function(ab) {
          var r = _origSizeOf(ab);
          if (typeof r === 'number' && ab && ab.byteLength > 0) {
            var s = '';
            var u = new Uint8Array(ab);
            for (var i = 0; i < Math.min(u.length, 256); i++) s += String.fromCharCode(u[i]);
            var wm = s.match(/width="(\\d+)"/), hm = s.match(/height="(\\d+)"/);
            if (wm && hm) return { width: +wm[1], height: +hm[1] };
          }
          return r;
        };
        lume.image._setSource = function(id, ab, w, h) {
          var r = _origSetSrc(id, ab, w, h);
          return r < 0 && ab && ab.byteLength > 0 ? 0 : r;
        };
      }
    `;
    s = runApp(preludeSetup + '\n' + bundled, { filename: name + '/app.js' });
  } catch (e) {
    runErr = String(e.stack || e);
    return { name, runErr, ...srcInfo };
  }
  try {
    if (typeof s.ctx.__lume_tick === 'function') s.ctx.__lume_tick();
  } catch (e) {
    tickErr = String(e.message || e);
  }

  const { nodes, pressSet, gestureSet, canvasDraws } = buildTree(s.messages);

  const nodeRecords = [];
  const touchUnder48 = [];
  const outR240Nodes = [];
  const outSafeNodes = [];
  const badRadiusCards = [];
  const canvasTextIssues = [];

  let worstContentR = 0;
  let worstInteractiveR = 0;
  let interactiveCount = 0;
  let visibleCount = 0;
  let fullScreenCanvas = false;

  for (const [id, n] of nodes) {
    const x0 = n.ax, y0 = n.ay, x1 = n.ax + n.rw, y1 = n.ay + n.rh;
    const isPress = pressSet.has(id);
    const isGesture = gestureSet.has(id);
    const isBtn = n.kind === 2 || isPress;
    const isFullCanvas = n.kind === 3 && n.rw >= 440 && n.rh >= 440;
    if (isFullCanvas) fullScreenCanvas = true;

    // Exclude fullscreen gesture/backdrop overlay from "button touch target" check
    const isOverlayPress = isBtn && n.kind === 0 && n.rw >= 360 && n.rh >= 360;
    const isInteractiveBtn = isBtn && !isOverlayPress;
    const isBackdrop = isBackdropOrWrapper(n, pressSet);

    const m = (n.rw > 0 || n.rh > 0) ? boxMetrics(x0, y0, x1, y1) : { rMax: 0, inSafe: true, inR240: true, inR233: true };

    const rec = {
      id,
      kind: KIND[n.kind] || String(n.kind),
      parent: n.parent,
      w: +n.rw.toFixed(1),
      h: +n.rh.toFixed(1),
      abs: [+x0.toFixed(1), +y0.toFixed(1), +x1.toFixed(1), +y1.toFixed(1)],
      r: n.r ?? null,
      vis: n.effVis,
      press: isPress,
      gesture: isGesture,
      backdrop: isBackdrop,
      fullCanvas: isFullCanvas,
      inScroll: !!n.inScroll,
      text: n.text === undefined ? '' : String(n.text).replace(/\n/g, '\\n').slice(0, 48),
      ...m,
    };
    nodeRecords.push(rec);

    if (!n.effVis || (n.rw === 0 && n.rh === 0)) continue;
    visibleCount++;

    if (isInteractiveBtn) {
      interactiveCount++;
      if (m.rMax > worstInteractiveR) worstInteractiveR = m.rMax;
      if (n.rw < 48 || n.rh < 48) {
        touchUnder48.push({ id, kind: rec.kind, w: rec.w, h: rec.h, abs: rec.abs, rMax: m.rMax, text: rec.text });
      }
    }

    // Check geometry on visible non-backdrop, non-fullscreen-canvas nodes
    if (!isBackdrop && !isFullCanvas && !isOverlayPress) {
      // Ignore tiny invisible/empty text placeholders with empty string
      if (n.kind === 1 && rec.text === '' && !n.bg) continue;
      if (m.rMax > worstContentR) worstContentR = m.rMax;
      if (!m.inR240) {
        outR240Nodes.push({ id, kind: rec.kind, w: rec.w, h: rec.h, abs: rec.abs, rMax: m.rMax, press: isInteractiveBtn, text: rec.text, inScroll: rec.inScroll });
      } else if (!m.inSafe) {
        outSafeNodes.push({ id, kind: rec.kind, w: rec.w, h: rec.h, abs: rec.abs, rMax: m.rMax, press: isInteractiveBtn, text: rec.text, inScroll: rec.inScroll });
      }
      // Card borderRadius > 12 check (only for View cards with bg/border, not circles/pills/dots/buttons)
      if (n.kind === 0 && (n.bg !== undefined || n.bw) && n.r > 12 && !isCircularOrPill(n) && n.rw >= 40 && n.rh >= 30) {
        badRadiusCards.push({ id, w: rec.w, h: rec.h, r: n.r, abs: rec.abs });
      }
    }

    // Inspect canvas draw TEXT calls (op 4) on visible canvases
    if (n.kind === 3 && canvasDraws.has(id)) {
      const draws = canvasDraws.get(id);
      const seenText = new Set();
      for (const d of draws) {
        if (d.op === 4 && d.label) {
          const sx = x0 + (d.x || 0), sy = y0 + (d.y || 0);
          const estW = Math.max(8, String(d.label).length * 8);
          const estH = d.width || 14;
          const key = `${sx},${sy},${d.label}`;
          if (seenText.has(key)) continue;
          seenText.add(key);
          const tm = boxMetrics(sx, sy, sx + estW, sy + estH);
          if (!tm.inSafe || !tm.inR240) {
            canvasTextIssues.push({
              canvasId: id, label: String(d.label).slice(0, 36),
              abs: [+sx.toFixed(1), +sy.toFixed(1), +(sx + estW).toFixed(1), +(sy + estH).toFixed(1)],
              ...tm,
            });
          }
        }
      }
    }
  }

  return {
    name,
    runErr,
    tickErr,
    nodeCount: nodes.size,
    visibleCount,
    interactiveCount,
    fullScreenCanvas,
    usesSafeArea: srcInfo.usesSafeArea,
    usesShell: srcInfo.usesShell,
    nonAsciiLines: srcInfo.nonAsciiLines,
    worstContentR: +worstContentR.toFixed(1),
    worstInteractiveR: +worstInteractiveR.toFixed(1),
    outR240Count: outR240Nodes.length,
    outSafeCount: outSafeNodes.length,
    touchUnder48Count: touchUnder48.length,
    badRadiusCount: badRadiusCards.length,
    canvasTextIssueCount: canvasTextIssues.length,
    outR240Nodes,
    outSafeNodes,
    touchUnder48,
    badRadiusCards,
    canvasTextIssues,
    nodes: nodeRecords,
  };
}

// Parse CLI args
const args = process.argv.slice(2);
let filterApps = null;
let jsonOut = null;
let txtOut = null;
let dumpNodesFlag = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apps' && args[i + 1]) { filterApps = args[++i].split(','); }
  else if (args[i] === '--json' && args[i + 1]) { jsonOut = args[++i]; }
  else if (args[i] === '--txt' && args[i + 1]) { txtOut = args[++i]; }
  else if (args[i] === '--nodes') { dumpNodesFlag = true; }
}

const manifest = readManifest();
const targets = filterApps || manifest;

const results = [];
for (const name of targets) {
  results.push(auditApp(name));
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    manifestCount: manifest.length,
    auditedCount: results.length,
    safeSquare: [SAFE_MIN, SAFE_MAX],
    screenRadius: R_SCREEN,
    results,
  }, null, 2));
}

const lines = [];
lines.push(`# Lume r218 Full-Manifest Geometry Audit (${results.length}/${manifest.length} apps)`);
lines.push(`# Screen: 480x480 circle center=(240,240) R=240; Safe square=[75,405]; Touch>=48x48; Card radius<=12`);
lines.push('');
lines.push(
  'APP'.padEnd(20) +
  'NODES'.padStart(6) +
  'BTNS'.padStart(5) +
  'MAX_R'.padStart(7) +
  'OUT240'.padStart(7) +
  'OUTSAF'.padStart(7) +
  'T<48'.padStart(6) +
  'R>12'.padStart(6) +
  'CTXT'.padStart(6) +
  'NASC'.padStart(6) +
  '  FLAGS'
);
lines.push('-'.repeat(100));

for (const r of results) {
  if (r.runErr) {
    lines.push(`${r.name.padEnd(20)} ERROR: ${r.runErr.split('\n')[0]}`);
    continue;
  }
  const flags = [];
  if (r.outR240Count > 0) flags.push(`OUT_R240(${r.outR240Count})`);
  if (r.outSafeCount > 0) flags.push(`OUT_SAFE(${r.outSafeCount})`);
  if (r.touchUnder48Count > 0) flags.push(`TOUCH<48(${r.touchUnder48Count})`);
  if (r.badRadiusCount > 0) flags.push(`RAD>12(${r.badRadiusCount})`);
  if (r.canvasTextIssueCount > 0) flags.push(`CTXT(${r.canvasTextIssueCount})`);
  if (r.nonAsciiLines > 0) flags.push(`NON_ASCII(${r.nonAsciiLines})`);
  if (r.fullScreenCanvas) flags.push('FULL_CANVAS');
  if (r.tickErr) flags.push(`TICK_ERR`);
  if (!flags.length) flags.push('CLEAN');

  lines.push(
    r.name.padEnd(20) +
    String(r.nodeCount).padStart(6) +
    String(r.interactiveCount).padStart(5) +
    fmt(r.worstContentR).padStart(7) +
    String(r.outR240Count).padStart(7) +
    String(r.outSafeCount).padStart(7) +
    String(r.touchUnder48Count).padStart(6) +
    String(r.badRadiusCount).padStart(6) +
    String(r.canvasTextIssueCount).padStart(6) +
    String(r.nonAsciiLines).padStart(6) +
    '  ' + flags.join(' ')
  );
}

lines.push('');
lines.push('=== DETAILED FINDINGS (non-clean apps) ===');
for (const r of results) {
  if (r.runErr) continue;
  const hasIssue = r.outR240Count || r.outSafeCount || r.touchUnder48Count || r.badRadiusCount || r.canvasTextIssueCount;
  if (!hasIssue && !dumpNodesFlag) continue;
  lines.push(`\n--- ${r.name} (nodes=${r.nodeCount}, btns=${r.interactiveCount}, worstR=${r.worstContentR}, fullCanvas=${r.fullScreenCanvas}) ---`);
  for (const n of r.outR240Nodes) {
    lines.push(`  [OUT_R240] node ${n.id} (${n.kind}${n.press ? ' PRESS' : ''}${n.inScroll ? ' SCROLL' : ''}): ${n.w}x${n.h} abs=[${n.abs[0]}..${n.abs[2]},${n.abs[1]}..${n.abs[3]}] Rmax=${n.rMax} text="${n.text}"`);
  }
  for (const n of r.outSafeNodes) {
    lines.push(`  [OUT_SAFE] node ${n.id} (${n.kind}${n.press ? ' PRESS' : ''}${n.inScroll ? ' SCROLL' : ''}): ${n.w}x${n.h} abs=[${n.abs[0]}..${n.abs[2]},${n.abs[1]}..${n.abs[3]}] Rmax=${n.rMax} text="${n.text}"`);
  }
  for (const t of r.touchUnder48) {
    lines.push(`  [TOUCH<48] node ${t.id} (${t.kind}): ${t.w}x${t.h} abs=[${t.abs[0]}..${t.abs[2]},${t.abs[1]}..${t.abs[3]}] Rmax=${t.rMax} text="${t.text}"`);
  }
  for (const c of r.badRadiusCards) {
    lines.push(`  [RAD>12]   node ${c.id}: ${c.w}x${c.h} r=${c.r} abs=[${c.abs[0]}..${c.abs[2]},${c.abs[1]}..${c.abs[3]}]`);
  }
  for (const ct of r.canvasTextIssues) {
    lines.push(`  [CANVAS_TXT] canvas ${ct.canvasId} "${ct.label}": abs=[${ct.abs[0]}..${ct.abs[2]},${ct.abs[1]}..${ct.abs[3]}] Rmax=${ct.rMax} ${ct.inR240 ? 'IN_R240' : 'OUT_R240'}`);
  }
  if (dumpNodesFlag) {
    for (const n of r.nodes) {
      lines.push(`  [NODE] ${n.id} (${n.kind} p=${n.parent}): ${n.w}x${n.h} abs=[${n.abs[0]}..${n.abs[2]},${n.abs[1]}..${n.abs[3]}] r=${n.r} vis=${n.vis} press=${n.press} Rmax=${n.rMax} text="${n.text}"`);
    }
  }
}

const textReport = lines.join('\n') + '\n';
if (txtOut) fs.writeFileSync(txtOut, textReport);
process.stdout.write(textReport);
