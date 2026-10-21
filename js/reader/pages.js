// Page-by-page viewer with pinch to zoom, used for PDF page view and manga.
// One tap on the left or right side turns the page; pinch zooms; drag pans
// while zoomed; a horizontal swipe also turns the page.
import { h, loadPdfjs } from '../util.js';
import { comicPages } from '../formats.js';

const MAX_ZOOM = 5;

export class PagesEngine {
  kind = 'pages';

  // source: {count, size(i) -> {w,h}, draw(i, cssW) -> Element, preload?(i), destroy()}
  constructor(shell, { source, start = 0, fit = 'screen', label }) {
    this.shell = shell;
    this.source = source;
    this.index = Math.max(0, Math.min(source.count - 1, start));
    this.fit = fit;
    this.label = label;
    this.z = 1; this.tx = 0; this.ty = 0;
    this.pointers = new Map();
  }

  async open(stage) {
    this.layer = h('div', { class: 'pages-layer' });
    this.vp = h('div', { class: 'pages-viewport' }, this.layer);
    stage.append(this.vp);
    this.vp.addEventListener('pointerdown', (e) => this.down(e));
    this.vp.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) this.vp.addEventListener(t, (e) => this.up(e));
    this.vp.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.vp);
    await this.show(this.index);
  }

  async show(i) {
    this.index = Math.max(0, Math.min(this.source.count - 1, i));
    const token = (this.token = {});
    this.report();
    const size = await this.source.size(this.index);
    if (token !== this.token) return;
    this.natural = size;
    this.z = 1;
    this.computeBase();
    const el = await this.source.draw(this.index, this.baseW);
    if (token !== this.token || !el) return;
    this.layer.replaceChildren(el);
    this.drawnAt = 1;
    this.apply();
    this.source.preload?.(this.index + 1);
    this.source.preload?.(this.index - 1);
  }

  computeBase() {
    const vw = this.vp.clientWidth, vh = this.vp.clientHeight;
    const { w, h: ht } = this.natural;
    const s = this.fit === 'width' ? vw / w : this.fit === 'height' ? vh / ht : Math.min(vw / w, vh / ht);
    this.baseW = w * s;
    this.baseH = ht * s;
    this.layer.style.width = `${this.baseW}px`;
    this.layer.style.height = `${this.baseH}px`;
    this.tx = (vw - this.baseW) / 2;
    this.ty = this.baseH > vh ? 0 : (vh - this.baseH) / 2;
  }

  layout() {
    if (!this.natural) return;
    this.z = 1;
    this.computeBase();
    this.apply();
    this.sharpen();
  }

  setFit(fit) { this.fit = fit; this.layout(); }

  clamp() {
    const vw = this.vp.clientWidth, vh = this.vp.clientHeight;
    const cw = this.baseW * this.z, ch = this.baseH * this.z;
    this.tx = cw <= vw ? (vw - cw) / 2 : Math.min(0, Math.max(vw - cw, this.tx));
    this.ty = ch <= vh ? (vh - ch) / 2 : Math.min(0, Math.max(vh - ch, this.ty));
  }

  apply() {
    this.clamp();
    this.layer.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.z})`;
  }

  // After zooming, redraw PDF pages at the new size so text stays sharp.
  sharpen() {
    if (!this.source.sharp || Math.abs(this.z - this.drawnAt) < 0.3) return;
    clearTimeout(this.sharpTimer);
    this.sharpTimer = setTimeout(async () => {
      const i = this.index, z = this.z;
      const el = await this.source.draw(i, this.baseW * z);
      if (i !== this.index || !el) return;
      this.layer.replaceChildren(el);
      this.drawnAt = z;
    }, 180);
  }

  // ---- gestures ----
  down(e) {
    try { this.vp.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.start = { x: e.clientX, y: e.clientY, t: performance.now(), tx: this.tx, ty: this.ty };
      this.moved = false;
      this.pinched = false;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: this.z, tx: this.tx, ty: this.ty };
      this.pinched = true;
    }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = this.vp.getBoundingClientRect();
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const p = this.pinch;
      const z = Math.max(1, Math.min(MAX_ZOOM, p.z * (d / p.d)));
      const cx = (p.mx - rect.left - p.tx) / p.z, cy = (p.my - rect.top - p.ty) / p.z;
      this.z = z;
      this.tx = mx - rect.left - cx * z;
      this.ty = my - rect.top - cy * z;
      this.apply();
      return;
    }
    if (this.pinched || !this.start) return;
    const dx = e.clientX - this.start.x, dy = e.clientY - this.start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) this.moved = true;
    if (this.canPan()) {
      this.tx = this.start.tx + dx;
      this.ty = this.start.ty + dy;
      this.apply();
    }
  }

  up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 1 && this.pinch) {
      // One finger lifted after a pinch: continue as a pan from here.
      const [p] = this.pointers.values();
      this.start = { x: p.x, y: p.y, t: 0, tx: this.tx, ty: this.ty };
      this.pinch = null;
      this.sharpen();
      return;
    }
    if (this.pointers.size) return;
    this.pinch = null;
    if (this.pinched) { this.sharpen(); this.start = null; return; }
    const s = this.start;
    this.start = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!this.moved && performance.now() - s.t < 500) {
      const rect = this.vp.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      this.shell.tap(fx < 0.3 ? 'left' : fx > 0.7 ? 'right' : 'center');
    } else if (!this.canPanX() && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.shell.tap(dx < 0 ? 'right' : 'left', true);
    }
  }

  wheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = this.vp.getBoundingClientRect();
    const z = Math.max(1, Math.min(MAX_ZOOM, this.z * Math.exp(-e.deltaY / 200)));
    const cx = (e.clientX - rect.left - this.tx) / this.z, cy = (e.clientY - rect.top - this.ty) / this.z;
    this.z = z;
    this.tx = e.clientX - rect.left - cx * z;
    this.ty = e.clientY - rect.top - cy * z;
    this.apply();
    this.sharpen();
  }

  canPanX() { return this.baseW * this.z > this.vp.clientWidth + 1; }
  canPan() { return this.canPanX() || this.baseH * this.z > this.vp.clientHeight + 1; }

  // ---- navigation ----
  report() {
    const n = this.source.count;
    const progress = n > 1 ? this.index / (n - 1) : 1;
    const extra = this.label?.(this.index);
    this.shell.report({
      position: { page: this.index + (this.source.pdf ? 1 : 0), mode: this.source.pdf ? 'page' : undefined },
      progress,
      top: '',
      left: '',
      right: `${extra ? `${extra} · ` : ''}${this.index + 1} / ${n}`,
      slider: { value: this.index, max: Math.max(0, n - 1) },
      sliderLabel: (v) => `${this.label?.(v) ? `${this.label(v)} · ` : ''}page ${v + 1} of ${n}`,
    });
  }

  next() { if (this.index < this.source.count - 1) this.show(this.index + 1); else this.shell.atEnd(); }
  prev() { if (this.index > 0) this.show(this.index - 1); }
  goToSlider(v) { this.show(v); }

  destroy() {
    this.ro?.disconnect();
    clearTimeout(this.sharpTimer);
    this.token = null;
    this.source.destroy?.();
    this.vp?.remove();
  }
}

// ---- sources ----

export async function imageSource(book, fileRec) {
  const pages = await comicPages(book, fileRec);
  const sizes = new Map();
  const load = async (i) => {
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.draggable = false;
    img.src = await pages.url(i);
    await img.decode().catch(() => new Promise((r) => { img.onload = r; img.onerror = r; }));
    sizes.set(i, { w: img.naturalWidth || 1000, h: img.naturalHeight || 1500 });
    return img;
  };
  const imgs = new Map();
  const get = (i) => {
    if (!imgs.has(i)) imgs.set(i, load(i));
    if (imgs.size > 6) for (const k of imgs.keys()) if (Math.abs(k - i) > 2) imgs.delete(k);
    return imgs.get(i);
  };
  return {
    count: pages.count,
    async size(i) { await get(i); return sizes.get(i); },
    draw: (i) => get(i),
    preload(i) { if (i >= 0 && i < pages.count) get(i); },
    destroy() { pages.destroy(); },
  };
}

export async function pdfSource(pdf) {
  let task = null;
  return {
    pdf: true,
    sharp: true,
    count: pdf.numPages,
    async size(i) {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      return { w: vp.width, h: vp.height };
    },
    async draw(i, cssW) {
      const page = await pdf.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(devicePixelRatio || 1, 3);
      let scale = (cssW / base.width) * dpr;
      const maxSide = 4096;
      scale = Math.min(scale, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = h('canvas', { class: 'pdf-page', width: Math.round(viewport.width), height: Math.round(viewport.height) });
      task?.cancel();
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return null; throw e; }
      return canvas;
    },
    destroy() {},
  };
}

export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
}
