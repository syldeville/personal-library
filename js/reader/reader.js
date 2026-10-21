// Reader screen: picks the right engine for the book, draws the controls,
// turns pages on tap, and saves the reading position as you go.
import { h, icon, sheet, toast, debounce } from '../util.js';
import { db } from '../db.js';
import { getBook, saveBook, prefs, setPref, SIZES } from '../store.js';
import { textToHtml, markdownToHtml, docxToHtml, pdfTextHtml } from '../formats.js';
import { FlowEngine } from './flow.js';
import { EpubEngine } from './epub.js';
import { PagesEngine, imageSource, pdfSource, openPdf } from './pages.js';
import { FONTS, SPACING, MARGINS } from './style.js';
import { syncNow } from '../sync.js';

export function readerView(id) {
  const root = h('div', { class: 'reader' });
  const miniTop = h('div', { class: 'reader-mini-top' });
  const stage = h('div', { class: 'reader-stage' });
  const miniLeft = h('span'), miniRight = h('span');
  const miniBottom = h('div', { class: 'reader-mini-bottom' }, miniLeft, miniRight);
  const loading = h('div', { class: 'loading' }, 'Opening…');
  stage.append(loading);
  root.append(miniTop, stage, miniBottom);

  let book, fileRec, engine, pdf, barsOpen = false, settingsOpen = false, last = null, destroyed = false;

  const save = debounce(async () => {
    if (!last || !book) return;
    const fresh = await getBook(book.id);
    if (!fresh) return;
    Object.assign(fresh, { position: last.position, progress: last.progress, lastReadAt: Date.now() });
    book = await saveBook(fresh);
  }, 800);

  // ---- bars ----
  const titleEl = h('div', { class: 'ttl' });
  const aaBtn = h('button', { class: 'iconbtn aa', 'aria-label': 'Reading settings', 'aria-pressed': 'false', onclick: () => toggleSettings() }, 'Aa');
  const tocBtn = h('button', { class: 'iconbtn', 'aria-label': 'Contents', onclick: () => showToc() }, icon('toc'));
  const topBar = h('header', { class: 'reader-bar top', hidden: true },
    h('button', { class: 'back', onclick: () => exit() }, icon('back'), 'Library'),
    titleEl,
    h('div', { style: { display: 'flex' } }, tocBtn, aaBtn));
  const settingsPanel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' }, hidden: true });
  const slider = h('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', 'aria-label': 'Position in book' });
  const sliderLeft = h('span'), sliderRight = h('span');
  const bottomBar = h('section', { class: 'reader-bar bottom', hidden: true, 'aria-label': 'Reader controls' },
    settingsPanel,
    h('div', { class: 'slider' }, slider, h('div', { class: 'lbl' }, sliderLeft, sliderRight)));
  slider.addEventListener('input', () => { sliderLeft.textContent = last?.sliderLabel?.(Number(slider.value)) || ''; });
  slider.addEventListener('change', () => engine?.goToSlider(Number(slider.value)));

  // ---- tap zones (text readers; the page viewer handles its own gestures) ----
  const zones = h('div', { class: 'tapzones' }, h('div', { 'data-z': 'left' }), h('div', { 'data-z': 'center' }), h('div', { 'data-z': 'right' }));
  let swipe = null;
  zones.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  zones.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    const quick = performance.now() - swipe.t < 600;
    swipe = null;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) shell.tap(e.target.dataset.z || 'center');
    else if (quick && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shell.tap(dx < 0 ? 'right' : 'left', true);
  });

  root.append(topBar, bottomBar);

  const shell = {
    get book() { return book; },
    report(info) {
      last = info;
      miniTop.textContent = info.top || book.title;
      miniLeft.textContent = info.left || '';
      miniRight.textContent = info.right || '';
      if (info.slider) {
        slider.disabled = false;
        slider.max = String(info.slider.max);
        slider.value = String(info.slider.value);
        sliderLeft.textContent = info.sliderLabel?.(info.slider.value) || '';
      } else {
        slider.disabled = true;
        sliderLeft.textContent = 'Counting pages…';
      }
      sliderRight.textContent = `${Math.round(info.progress * 100)}%`;
      if (info.position) save();
    },
    tap(zone, swiped) {
      if (zone === 'center') return toggleBars();
      if (barsOpen && !swiped) return toggleBars(false);
      const rtl = book.dir === 'rtl' && engine.kind === 'pages';
      const forward = (zone === 'right') !== rtl;
      if (forward) engine.next(); else engine.prev();
    },
    atEnd() {
      if ((last?.progress ?? 0) < 0.995) return;
      toast('You reached the end', { label: 'Back to library', run: () => exit() });
    },
  };

  function toggleBars(open = !barsOpen) {
    barsOpen = open;
    topBar.hidden = bottomBar.hidden = !open;
    if (!open) { settingsOpen = false; settingsPanel.hidden = true; aaBtn.setAttribute('aria-pressed', 'false'); }
  }

  function toggleSettings() {
    settingsOpen = !settingsOpen;
    settingsPanel.hidden = !settingsOpen;
    aaBtn.setAttribute('aria-pressed', String(settingsOpen));
    if (settingsOpen) buildSettings();
  }

  function seg(label, options, current, onPick) {
    return h('div', { class: 'group' },
      h('div', { class: 'glabel' }, label),
      h('div', { class: 'seg', role: 'group', 'aria-label': label },
        Object.entries(options).map(([k, text]) => h('button', {
          'aria-pressed': String(k === current),
          style: k === 'georgia' ? { fontFamily: 'Georgia, serif' } : k === 'literata' ? { fontFamily: 'Literata, Georgia, serif' } : null,
          onclick: async () => { await onPick(k); buildSettings(); },
        }, text))));
  }

  function buildSettings() {
    const parts = [];
    const isPdf = book.format === 'pdf';
    if (engine.kind === 'text') {
      parts.push(h('div', { class: 'group' },
        h('div', { class: 'glabel' }, 'Text size'),
        h('div', { class: 'sizerow' },
          h('button', { 'aria-label': 'Smaller text', style: { fontSize: '14px' }, onclick: () => setSize(prefs.size - 1) }, 'A−'),
          h('div', { class: 'sizedots', 'aria-hidden': 'true' }, SIZES.map((_, i) => h('span', {
            class: i === prefs.size ? 'on' : '', style: { width: `${7 + i * 1.5}px`, height: `${7 + i * 1.5}px` },
          }))),
          h('button', { 'aria-label': 'Larger text', style: { fontSize: '20px' }, onclick: () => setSize(prefs.size + 1) }, 'A+'))));
      parts.push(seg('Font', Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.label])), prefs.font, (k) => setStyle('font', k)));
      parts.push(seg('Line spacing', Object.fromEntries(Object.entries(SPACING).map(([k, v]) => [k, v[0]])), prefs.spacing, (k) => setStyle('spacing', k)));
      parts.push(seg('Margins', Object.fromEntries(Object.entries(MARGINS).map(([k, v]) => [k, v[0]])), prefs.margins, (k) => setStyle('margins', k)));
      parts.push(seg('Alignment', { justify: 'Justified', left: 'Left' }, prefs.justify ? 'justify' : 'left', (k) => setStyle('justify', k === 'justify')));
    } else {
      if (book.kind === 'manga') {
        parts.push(seg('Page direction', { rtl: 'Right to left', ltr: 'Left to right' }, book.dir || 'rtl', async (k) => {
          const fresh = await getBook(book.id);
          fresh.dir = k;
          book = await saveBook(fresh);
          slider.dir = k === 'rtl' ? 'rtl' : 'ltr';
        }));
      }
      parts.push(seg('Fit page', { screen: 'Screen', width: 'Width', height: 'Height' }, prefs.fit, async (k) => {
        await setPref('fit', k);
        engine.setFit(k);
      }));
    }
    if (isPdf) {
      parts.push(seg('PDF view', { page: 'Page', text: 'Text (resizable)' }, engine.kind === 'pages' ? 'page' : 'text', (k) => switchPdfMode(k)));
    }
    settingsPanel.replaceChildren(...parts);
  }

  async function setSize(i) {
    i = Math.max(0, Math.min(SIZES.length - 1, i));
    if (i === prefs.size) return;
    await setPref('size', i);
    engine.applyPrefs();
    buildSettings();
  }
  async function setStyle(key, value) {
    await setPref(key, value);
    engine.applyPrefs();
  }

  function showToc() {
    const items = engine?.tocItems?.() || [];
    const body = items.length
      ? h('div', { class: 'toc' }, items.map((it) => h('button', {
        class: it.current ? 'current' : '',
        onclick: () => { close(); toggleBars(false); it.go(); },
      }, it.label)))
      : h('p', { class: 'hint', style: { fontSize: '14px' } }, 'This book has no table of contents. Use the slider to jump around.');
    const close = sheet('Contents', body);
    body.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  async function switchPdfMode(mode) {
    const pos = last?.position || {};
    const fresh = await getBook(book.id);
    fresh.position = { ...pos, mode };
    book = await saveBook(fresh, { sync: false });
    await startEngine();
    if (settingsOpen) buildSettings();
  }

  async function startEngine() {
    engine?.destroy();
    engine = null;
    zones.remove();
    stage.append(loading);
    loading.textContent = 'Opening…';
    const pos = book.position;
    try {
      if (book.format === 'epub') {
        engine = new EpubEngine(shell, { blob: fileRec.blob, id: book.id, position: pos });
      } else if (book.format === 'pdf') {
        pdf ??= await openPdf(fileRec.blob);
        if (pos?.mode === 'text') {
          const html = await pdfTextHtml(book.id, pdf, (f) => { loading.textContent = `Preparing text… ${Math.round(f * 100)}%`; });
          if (!html.replace(/<div class="pg"[^>]*>\d+<\/div>/g, '').trim()) {
            toast('This PDF has no text layer (it may be scanned images), so it can only be shown as pages.', null, 6000);
            book.position = { ...pos, mode: 'page' };
            return startEngine();
          }
          engine = new FlowEngine(shell, { html, cls: 'pdf', position: pos, pdfPages: pdf.numPages });
        } else {
          engine = new PagesEngine(shell, { source: await pdfSource(pdf), start: (pos?.page || 1) - 1, fit: prefs.fit === 'screen' ? 'width' : prefs.fit });
        }
      } else if (['cbz', 'cbr', 'images', 'mangadex'].includes(book.format)) {
        const chapters = book.chapters || [];
        const label = chapters.length ? (i) => {
          const c = chapters.filter((ch) => ch.start <= i).at(-1);
          return c ? `Ch. ${c.num}` : '';
        } : null;
        engine = new PagesEngine(shell, { source: await imageSource(book, fileRec), start: pos?.page || 0, fit: prefs.fit, label });
        engine.tocItems = chapters.length ? () => chapters.map((c, n) => ({
          label: `Chapter ${c.num}${c.title ? `: ${c.title}` : ''}`,
          current: engine.index >= c.start && engine.index < (chapters[n + 1]?.start ?? Infinity),
          go: () => engine.show(c.start),
        })) : null;
      } else {
        const html = book.format === 'md' ? await markdownToHtml(fileRec.blob)
          : book.format === 'docx' ? await docxToHtml(fileRec.blob)
            : await textToHtml(fileRec.blob);
        engine = new FlowEngine(shell, { html, cls: book.format, position: pos });
      }
      if (destroyed) return;
      root.classList.toggle('pages-mode', engine.kind === 'pages');
      slider.dir = engine.kind === 'pages' && book.dir === 'rtl' ? 'rtl' : 'ltr';
      tocBtn.hidden = !engine.tocItems;
      await engine.open(stage);
      if (engine.kind === 'text') stage.append(zones);
      loading.remove();
    } catch (e) {
      console.error(e);
      loading.replaceChildren(h('div', {},
        h('p', {}, `Couldn't open this file. ${e.message || ''}`),
        h('button', { class: 'btn', style: { pointerEvents: 'auto' }, onclick: () => exit() }, 'Back to library')));
    }
  }

  function onKey(e) {
    if (!engine || e.target.closest?.('input, select, textarea')) return;
    const rtl = book.dir === 'rtl' && engine.kind === 'pages';
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); rtl && e.key === 'ArrowRight' ? engine.prev() : engine.next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); rtl && e.key === 'ArrowLeft' ? engine.next() : engine.prev(); }
    else if (e.key === 'Escape') exit();
  }
  addEventListener('keydown', onKey);

  function exit() {
    location.hash = '#/';
  }

  (async () => {
    book = await getBook(id);
    fileRec = book && await db.get('files', id);
    if (!book || !fileRec) {
      loading.replaceChildren(h('div', {},
        h('p', {}, 'This book is not downloaded on this device.'),
        h('button', { class: 'btn', style: { pointerEvents: 'auto' }, onclick: () => exit() }, 'Back to library')));
      return;
    }
    titleEl.textContent = book.title;
    miniTop.textContent = book.title;
    const fresh = await getBook(id);
    fresh.lastReadAt = Date.now();
    book = await saveBook(fresh);
    await startEngine();
  })();

  return {
    el: root,
    destroy() {
      destroyed = true;
      removeEventListener('keydown', onKey);
      save.flush();
      engine?.destroy();
      pdf?.destroy();
      syncNow();
    },
  };
}
