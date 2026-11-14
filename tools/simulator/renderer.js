/* Browser-side replay of lume_ui_bridge.c messages. No package or build step. */
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
    reset() { this.device.replaceChildren(); this.nodes.clear(); this.kinds.clear(); this.press.clear(); }
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
    }
    attr(id, attr, value) {
      const el = this.nodes.get(id); if (!el) return;
      const s = el.style;
      switch (attr) {
        case 0: el.textContent = value; break;
        case 1: s.backgroundColor = color(value); break;
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
    }
  }
  global.LumeRenderer = Renderer;
  if (typeof module !== 'undefined') module.exports = Renderer;
})(typeof window === 'undefined' ? globalThis : window);
