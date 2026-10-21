// Paginated reader for flowing text: TXT, Markdown, Word, and the PDF text view.
// The text is laid out in CSS columns one screen wide; turning a page slides
// the columns over by one screen.
import { h } from '../util.js';
import { textStyle } from './style.js';

const GAP = 40;

export class FlowEngine {
  kind = 'text';

  // opts: {html, cls, position, pdfPages: number|undefined}
  constructor(shell, opts) {
    this.shell = shell;
    this.opts = opts;
    this.page = 0;
    this.pages = 1;
  }

  async open(stage) {
    this.content = h('div', { class: `flow-content ${this.opts.cls || ''}`, html: this.opts.html });
    this.clip = h('div', { class: 'flow-clip' }, this.content);
    this.outer = h('div', { class: 'flow-outer' }, this.clip);
    stage.append(this.outer);
    this.blocks = [...this.content.children];
    if (!this.blocks.length) {
      this.content.append(h('p', {}, 'This file has no readable text.'));
      this.blocks = [...this.content.children];
    }
    this.applyPrefs(false);
    await document.fonts?.ready;
    this.layout();
    this.goToPosition(this.opts.position);
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(this.clip);
    for (const img of this.content.querySelectorAll('img')) {
      if (!img.complete) img.addEventListener('load', () => this.relayout(), { once: true });
    }
  }

  applyPrefs(relayout = true) {
    const s = textStyle();
    const st = this.outer.style;
    st.setProperty('--rsize', `${s.size}px`);
    st.setProperty('--rfont', s.font);
    st.setProperty('--rlead', s.lead);
    st.setProperty('--ralign', s.align);
    st.setProperty('--margin', `${s.margin}px`);
    if (relayout) this.relayout();
  }

  relayout() {
    const pos = this.position();
    this.layout();
    this.goToPosition(pos);
  }

  layout() {
    const w = this.clip.clientWidth;
    this.stride = w + GAP;
    Object.assign(this.content.style, { width: `${w}px`, columnWidth: `${w}px`, columnGap: `${GAP}px`, transform: 'translateX(0)' });
    const base = this.content.getBoundingClientRect().left;
    this.blockPages = [];
    this.blockEnds = [];
    for (const b of this.blocks) {
      const r = b.getBoundingClientRect();
      const start = Math.max(0, Math.floor((r.left - base + 2) / this.stride));
      this.blockPages.push(start);
      this.blockEnds.push(Math.max(start, Math.floor((r.right - base - 2) / this.stride)));
    }
    this.pages = Math.max(1, Math.round((this.content.scrollWidth + GAP) / this.stride), (this.blockPages.at(-1) || 0) + 1);
    this.headings = this.blocks.map((b, i) => (/^H[1-3]$/.test(b.tagName) ? i : -1)).filter((i) => i >= 0);
  }

  // The block at the top of a page: the first one that ends on or after it.
  blockAt(page) {
    let lo = 0, hi = this.blockEnds.length - 1, ans = hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.blockEnds[mid] >= page) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return Math.max(0, ans);
  }

  position() {
    const b = this.blockAt(this.page);
    const pos = { b, d: this.page - this.blockPages[b] };
    if (this.opts.pdfPages) pos.page = this.pdfPageAt(b);
    return pos;
  }

  pdfPageAt(b) {
    for (let i = b; i >= 0; i--) {
      const p = this.blocks[i].dataset.page;
      if (p) return Number(p);
    }
    return 1;
  }

  goToPosition(pos) {
    if (!pos) return this.show(0);
    let b = pos.b;
    if (this.opts.pdfPages && pos.page && (b === undefined || this.pdfPageAt(b) !== pos.page)) {
      b = this.blocks.findIndex((el) => Number(el.dataset.page) >= pos.page);
    }
    b = Math.max(0, Math.min(this.blocks.length - 1, b || 0));
    this.show(Math.min(this.blockPages[b] + (pos.d || 0), this.blockEnds[b]));
  }

  show(page) {
    this.page = Math.max(0, Math.min(this.pages - 1, page));
    this.content.style.transform = `translateX(${-this.page * this.stride}px)`;
    this.report();
  }

  report() {
    const b = this.blockAt(this.page);
    const h = this.headings.filter((i) => i <= b).at(-1);
    const progress = this.pages > 1 ? this.page / (this.pages - 1) : 1;
    const pos = this.position();
    this.shell.report({
      position: this.opts.pdfPages ? { page: pos.page, b: pos.b, d: pos.d, mode: 'text' } : pos,
      progress,
      top: h !== undefined ? this.blocks[h].textContent.trim().slice(0, 80) : '',
      left: this.opts.pdfPages ? `PDF page ${pos.page} of ${this.opts.pdfPages}` : `Page ${this.page + 1} of ${this.pages}`,
      right: `${Math.round(progress * 100)}%`,
      slider: { value: this.page, max: this.pages - 1 },
      sliderLabel: (v) => `Page ${v + 1} of ${this.pages}`,
    });
  }

  next() { if (this.page < this.pages - 1) this.show(this.page + 1); else this.shell.atEnd(); }
  prev() { if (this.page > 0) this.show(this.page - 1); }
  goToSlider(v) { this.show(v); }

  tocItems() {
    const cur = this.blockAt(this.page);
    const items = this.headings.map((i) => ({ label: this.blocks[i].textContent.trim().slice(0, 90), i }));
    return items.map((it, n) => ({
      label: it.label,
      current: it.i <= cur && (items[n + 1]?.i ?? Infinity) > cur,
      go: () => this.show(this.blockPages[it.i]),
    }));
  }

  destroy() {
    this.ro?.disconnect();
    this.outer?.remove();
  }
}
