// EPUB reader, built on epub.js.
import { h, loadScript } from '../util.js';
import { db } from '../db.js';
import { textStyle } from './style.js';

export class EpubEngine {
  kind = 'text';

  constructor(shell, { blob, id, position }) {
    this.shell = shell;
    this.blob = blob;
    this.id = id;
    this.position = position;
    this.progress = 0;
  }

  async open(stage) {
    await loadScript('vendor/jszip.min.js');
    await loadScript('vendor/epub.min.js');
    this.host = h('div', { class: 'epub-host' });
    stage.append(this.host);
    this.book = window.ePub(await this.blob.arrayBuffer());
    this.rendition = this.book.renderTo(this.host, {
      width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false,
    });
    const fontsCss = new URL('../../css/fonts.css', import.meta.url).href;
    this.rendition.hooks.content.register((contents) => contents.addStylesheet(fontsCss));
    this.rendition.themes.default({
      body: { color: '#1a1a1a !important', background: 'transparent !important' },
      a: { color: '#1a1a1a !important' },
      img: { 'max-width': '100% !important' },
    });
    this.applyPrefs();
    this.rendition.on('relocated', (loc) => this.onRelocated(loc));
    await this.book.ready;
    this.toc = this.flatToc(this.book.navigation?.toc || []);
    await this.rendition.display(this.position?.cfi || undefined);
    this.loadLocations();
  }

  flatToc(items, depth = 0) {
    return items.flatMap((it) => [{ label: it.label.trim(), href: it.href, depth }, ...this.flatToc(it.subitems || [], depth + 1)]);
  }

  async loadLocations() {
    const key = `epubloc:${this.id}`;
    const cached = await db.get('cache', key);
    if (this.destroyed) return;
    if (cached) this.book.locations.load(cached.data);
    else {
      await this.book.locations.generate(1200);
      if (this.destroyed) return;
      await db.put('cache', { id: key, data: this.book.locations.save() });
    }
    if (this.lastLoc) this.onRelocated(this.lastLoc);
  }

  applyPrefs() {
    const s = textStyle();
    this.host.style.setProperty('--margin', `${s.margin}px`);
    const t = this.rendition.themes;
    t.fontSize(`${s.size}px`);
    t.override('font-family', s.font, true);
    t.override('line-height', String(s.lead), true);
    t.override('text-align', s.align, true);
    if (this.rendition.manager && this.lastLoc) {
      // Re-show the same spot once the text has reflowed at the new size.
      const cfi = this.lastLoc.start.cfi;
      this.rendition.resize();
      this.rendition.display(cfi);
    }
  }

  onRelocated(loc) {
    this.lastLoc = loc;
    const cfi = loc.start.cfi;
    const hasLocs = this.book.locations.length() > 0;
    if (hasLocs) this.progress = this.book.locations.percentageFromCfi(cfi);
    else if (loc.start.percentage) this.progress = loc.start.percentage;
    if (loc.atEnd) this.progress = 1;
    const chapter = this.chapterFor(loc.start.href);
    const d = loc.start.displayed;
    this.shell.report({
      position: { cfi },
      progress: this.progress,
      top: chapter?.label || '',
      left: d ? `${d.total - d.page > 0 ? `${d.total - d.page} ${d.total - d.page === 1 ? 'page' : 'pages'} left in chapter` : 'Last page in chapter'}` : '',
      right: hasLocs ? `${Math.round(this.progress * 100)}%` : '',
      slider: hasLocs ? { value: Math.round(this.progress * 1000), max: 1000 } : null,
      sliderLabel: (v) => `${Math.round(v / 10)}%`,
    });
  }

  chapterFor(href) {
    if (!href) return null;
    const base = href.split('#')[0];
    let found = null;
    for (const it of this.toc) if (it.href.split('#')[0].endsWith(base) || base.endsWith(it.href.split('#')[0])) { found = it; break; }
    return found;
  }

  next() {
    if (this.lastLoc?.atEnd) this.shell.atEnd();
    else this.rendition.next();
  }
  prev() { this.rendition.prev(); }
  goToSlider(v) {
    const cfi = this.book.locations.cfiFromPercentage(v / 1000);
    if (cfi) this.rendition.display(cfi);
  }

  tocItems() {
    const cur = this.chapterFor(this.lastLoc?.start.href);
    return this.toc.map((it) => ({
      label: `${' '.repeat(it.depth)}${it.label}`,
      current: it === cur,
      go: () => this.rendition.display(it.href),
    }));
  }

  destroy() {
    this.destroyed = true;
    try { this.rendition?.destroy(); this.book?.destroy(); } catch { /* already gone */ }
    this.host?.remove();
  }
}
