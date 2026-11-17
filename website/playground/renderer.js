/* Browser-side replay of lume_ui_bridge.c messages. Copied from
 * tools/simulator/renderer.js; playground-specific style extensions below. */
(function (global) {
  const color = n => '#' + (Number(n) >>> 0).toString(16).padStart(6, '0').slice(-6);
  const main = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'];
  const cross = ['flex-start', 'flex-end', 'center', 'stretch'];
  const easing = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
  class Renderer {
    constructor(device, send = () => {}) {
      this.device = device;
      this.send = send;
      this.nodes = new Map();
      this.kinds = new Map();
      this.press = new Set();
      device.addEventListener('click', e => {
        const target = e.target.closest('[data-node-id]');
        if (!target) return;
        let el = target;
        while (el && el !== device) {
          const id = Number(el.dataset.nodeId);
          if (this.press.has(id)) { this.send({ type: 'press', id }); break; }
          el = el.parentElement;
        }
      });
      device.addEventListener('scroll', e => {
        const id = Number(e.target.dataset?.nodeId);
        if (id) this.send({ type: 'scroll', id, y: e.target.scrollTop });
      }, true);
    }
    reset() { this.device.replaceChildren(); this.nodes.clear(); this.kinds.clear(); this.press.clear(); this.paths?.clear(); }
    replay(messages) { for (const message of messages) this.apply(message); }
    apply(m) {
      const [op, id] = m;
      if (op === 'create') {
        const kind = m[2], el = document.createElement(kind === 3 ? 'canvas' : kind === 1 ? 'span' : 'div');
        el.dataset.nodeId = id;
        el.className = 'lume-node kind-' + kind;
        if (kind === 3) { el.width = m[4]; el.height = m[5]; el.style.width = m[4] + 'px'; el.style.height = m[5] + 'px'; }
        if (kind === 4) { el.textContent = 'IMAGE'; el.classList.add('image-placeholder'); }
        this.nodes.set(id, el); this.kinds.set(id, kind);
        (this.nodes.get(m[3]) || this.device).appendChild(el);
      } else if (op === 'attr') this.attr(id, m[2], m[3]);
      else if (op === 'remove') {
        const el = this.nodes.get(id);
        if (el) { for (const child of [el, ...el.querySelectorAll('[data-node-id]')]) {
          const n = Number(child.dataset.nodeId); this.nodes.delete(n); this.kinds.delete(n); this.press.delete(n);
        } el.remove(); }
      } else if (op === 'press') { this.press.add(id); this.nodes.get(id)?.classList.add('pressable'); }
      else if (op === 'animate') this.animate(m);
      else if (op === 'cancelAnimate') { const el = this.nodes.get(id); if (el) el.style.transition = ''; }
      else if (op === 'draw') this.draw(m);
      else if (op === 'batch') this.batch(m);
      else if (op === 'pathDefine') this.pathDefine(m);
      else if (op === 'pathDraw') this.pathDraw(m);
      else if (op === 'spriteDefine') this.spriteDefine(m);
      else if (op === 'spriteDraw') this.spriteDraw(m);
      /* invalidate is a native-side dirty flag; the following draw/batch
       * messages replay the full frame, so nothing to do in the browser. */
    }
    attr(id, attr, value) {
      const el = this.nodes.get(id); if (!el) return;
      const s = el.style;
      switch (attr) {
        case 0: el.textContent = value; break;
        case 1: if (this.kinds.get(id) === 1) s.color = color(value); else s.backgroundColor = color(value); break;
        case 2: s.width = value + 'px'; break;
        case 3: s.height = value + 'px'; break;
        case 4: {
          // lume_align_t wire order (not LVGL's enum order).
          const coords = [['50%','50%'],['0','0'],['50%','0'],['100%','0'],['50%','100%'],['0','100%'],['100%','100%'],['0','50%'],['100%','50%']][value] || ['50%','50%'];
          s.position = 'absolute'; s.left = coords[0]; s.top = coords[1];
          s.transform = `translate(${coords[0] === '0' ? '0' : coords[0] === '100%' ? '-100%' : '-50%'}, ${coords[1] === '0' ? '0' : coords[1] === '100%' ? '-100%' : '-50%'})`;
          break;
        }
        case 5: s.display = value ? '' : 'none'; break;
        case 6: (this.nodes.get(value) || this.device).appendChild(el); break;
        case 7: s.display = 'flex'; s.flexDirection = value % 2 ? 'column' : 'row'; s.flexWrap = value >= 2 ? 'wrap' : 'nowrap'; break;
        case 8: s.justifyContent = main[value] || main[0]; break;
        case 9: s.alignItems = cross[value] || cross[0]; break;
        case 10: s.padding = value + 'px'; break;
        case 11: s.gap = value + 'px'; break;
        case 12: s.borderRadius = value + 'px'; break;
        case 13: s.borderWidth = value + 'px'; s.borderStyle = 'solid'; break;
        case 14: s.borderColor = color(value); break;
        case 15: s.opacity = value / 255; break;
        case 16: s.width = value + '%'; break;
        case 17: s.height = value + '%'; break;
        case 18: s.left = value + 'px'; s.position = 'absolute'; s.transform = ''; break;
        case 19: s.top = value + 'px'; s.position = 'absolute'; s.transform = ''; break;
        case 20: s.overflowY = value === 1 ? 'auto' : 'hidden'; s.overflowX = value === 2 ? 'auto' : 'hidden'; break;
        case 21: s.scrollbarWidth = value === 0 ? 'none' : 'auto'; break;
        case 22: el.scrollTop = value; break;
        case 23: if (value) s.position = 'absolute'; break;
        case 30: s.paddingTop = value + 'px'; break;
        case 31: s.paddingRight = value + 'px'; break;
        case 32: s.paddingBottom = value + 'px'; break;
        case 33: s.paddingLeft = value + 'px'; break;
        case 34: s.margin = value + 'px'; break;
        case 35: s.marginTop = value + 'px'; break;
        case 36: s.marginRight = value + 'px'; break;
        case 37: s.marginBottom = value + 'px'; break;
        case 38: s.marginLeft = value + 'px'; break;
        // LUME_ATTR_FLEX_GROW (0..255): mirror lv_obj_set_flex_grow.
        case 39: s.flexGrow = value || ''; break;
        // LUME_ATTR_TEXT_ALIGN: 0=left 1=center 2=right 3=auto(LVGL default=left).
        case 53: s.textAlign = ['', 'center', 'right', ''][value] || ''; break;
        // LUME_ATTR_TEXT_LONG_MODE: 0=wrap 1=dots 2=scroll 3=scroll-circular 4=clip.
        case 54:
          s.overflow = value ? 'hidden' : '';
          s.whiteSpace = value ? 'nowrap' : 'normal';
          s.textOverflow = value === 1 ? 'ellipsis' : '';
          break;
        case 55: s.fontSize = value + 'px'; break;
        case 56: s.letterSpacing = value + 'px'; break;
        case 57: s.lineHeight = `calc(1em + ${value}px)`; break;
      }
    }
    animate(m) {
      const [, id, attr, from, to, duration, curve] = m;
      const el = this.nodes.get(id); if (!el) return;
      const prop = ({18:'left',19:'top',2:'width',3:'height',15:'opacity'})[attr];
      if (!prop) return;
      if (from !== null && from !== undefined) this.attr(id, attr, from);
      // Force the start frame before applying the target value.
      void el.offsetWidth;
      el.style.transition = `${prop} ${duration}ms ${easing[curve] || 'linear'}`;
      this.attr(id, attr, to);
    }
    draw(m) {
      const [, id, op, x, y, a, b, ink, width, label] = m;
      const el = this.nodes.get(id); if (!el || !el.getContext) return;
      const c = el.getContext('2d'); c.fillStyle = c.strokeStyle = color(ink);
      if (op === 0) c.fillRect(0, 0, el.width, el.height);
      if (op === 1) c.fillRect(x, y, a, b);
      if (op === 2) { c.lineWidth = width; c.beginPath(); c.moveTo(x + .5, y + .5); c.lineTo(a + .5, b + .5); c.stroke(); }
      if (op === 3) { c.lineWidth = width; c.beginPath(); c.arc(x, y, a, 0, Math.PI * 2); c.stroke(); }
      if (op === 4) { c.font = '14px sans-serif'; c.textBaseline = 'top'; c.fillText(label || '', x, y); }
      if (op === 5) { /* AA annulus arc (r48): m[9]=from deg, m[10]=to deg, cw from +x */
        const rad = d => Number(d) * Math.PI / 180;
        const from = rad(m[9]), to = rad(m[10] === undefined ? m[9] : m[10]);
        c.lineWidth = width; c.beginPath();
        c.arc(x, y, a, from, from === to ? from + 0.01 : to, false);
        c.stroke();
      }
    }
    /* line()/polyline() flush: flat [x1,y1,x2,y2,color,width] sextuplets
     * (the host emits them as one nested array: ['batch', id, [...]]) */
    batch(m) {
      const [, id] = m, el = this.nodes.get(id);
      if (!el || !el.getContext) return;
      const flat = Array.isArray(m[2]) ? m[2] : m.slice(2);
      const c = el.getContext('2d');
      for (let i = 0; i + 5 < flat.length; i += 6) {
        const [x1, y1, x2, y2, ink, width] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5]];
        c.strokeStyle = color(ink); c.lineWidth = width;
        c.beginPath(); c.moveTo(x1 + .5, y1 + .5); c.lineTo(x2 + .5, y2 + .5); c.stroke();
      }
    }
    /* retainPath(): geometry uploaded once; drawPath() replays it */
    pathDefine(m) {
      const [, id, pid] = m;
      this.paths = this.paths || new Map();
      this.paths.set(`${id}:${pid}`, Array.isArray(m[3]) ? m[3] : m.slice(3));
    }
    pathDraw(m) {
      const [, id, pid, dx, dy] = m;
      const flat = (this.paths || new Map()).get(`${id}:${pid}`);
      if (flat) {
        const shifted = flat.map((value, index) => index % 6 < 4
          ? value + (index % 2 ? dy : dx) : value);
        this.batch(['batch', id, shifted]);
      }
    }
    /* r81 retainImage()/drawImage(): upload RGB565 once into an offscreen canvas
     * (0x0000 colour key = transparent), then blit it with optional horizontal
     * flip. Offscreen + drawImage keeps non-zero (dx,dy) correct and clips to
     * the canvas edges, mirroring lume_raster_blit(). */
    spriteDefine(m) {
      const [, id, slot, w, h, px] = m;
      this.sprites = this.sprites || new Map();
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const oc = off.getContext('2d'), img = oc.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = px[i]; if (v === 0) continue;
        const o = i * 4;
        img.data[o] = ((v >> 11) & 0x1f) * 255 / 31 | 0;
        img.data[o + 1] = ((v >> 5) & 0x3f) * 255 / 63 | 0;
        img.data[o + 2] = (v & 0x1f) * 255 / 31 | 0;
        img.data[o + 3] = 255;
      }
      oc.putImageData(img, 0, 0);
      this.sprites.set(`${id}:${slot}`, off);
    }
    spriteDraw(m) {
      const [, id, slot, dx = 0, dy = 0, flip = 0] = m;
      const el = this.nodes.get(id); if (!el || !el.getContext) return;
      const off = (this.sprites || new Map()).get(`${id}:${slot}`);
      if (!off) return;
      const c = el.getContext('2d');
      c.save();
      if (flip) { c.translate(dx + off.width, dy); c.scale(-1, 1); c.drawImage(off, 0, 0); }
      else c.drawImage(off, dx, dy);
      c.restore();
    }
  }
  global.LumeRenderer = Renderer;
  if (typeof module !== 'undefined') module.exports = Renderer;
})(typeof window === 'undefined' ? globalThis : window);
