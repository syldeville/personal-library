// Small DOM and data helpers shared across the app.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5"/><rect x="13.5" y="4" width="6.5" height="6.5"/><rect x="4" y="13.5" width="6.5" height="6.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5"/>',
  folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  manga: '<path d="M4 4h7v16H4zM13 4h7v16h-7z"/>',
  toc: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

export function icon(name, size) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${size ? ` width="${size}" height="${size}"` : ''}>${ICONS[name]}</svg>`;
  return span;
}

let toastEl, toastTimer;
export function toast(msg, action, ms = 3200) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'toast', role: 'status' }, msg,
    action ? h('button', { onclick: () => { toastEl?.remove(); action.run(); } }, action.label) : null);
  document.body.append(toastEl);
  if (ms) toastTimer = setTimeout(() => toastEl?.remove(), ms);
  return { update: (m) => { if (toastEl) toastEl.firstChild.textContent = m; }, close: () => toastEl?.remove() };
}

// Bottom sheet. Returns a close function.
export function sheet(title, body, { onClose } = {}) {
  const close = () => { backdrop.remove(); onClose?.(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'iconbtn', 'aria-label': 'Close', style: { marginRight: '-12px' }, onclick: close }, icon('close'))),
    body);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  document.body.append(backdrop);
  return close;
}

// Drop-down menu anchored to an element. items: [{label, checked, danger, run}] or {section: 'Title'}.
export function popMenu(anchor, items, { align = 'left' } = {}) {
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.section !== undefined) {
      if (menu.childElementCount) menu.append(h('hr'));
      menu.append(h('div', { class: 'label-caps' }, it.section));
      continue;
    }
    menu.append(h('button', {
      role: it.checked === undefined ? 'menuitem' : 'menuitemradio',
      'aria-checked': it.checked === undefined ? null : String(!!it.checked),
      class: it.danger ? 'danger' : null,
      onclick: () => { close(); it.run(); },
    }, it.label, it.checked ? h('span', {}, '✓') : null));
  }
  const close = () => { scrim.remove(); menu.remove(); };
  document.body.append(scrim, menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  Object.assign(menu.style, { left: left + 'px', top: top + 'px' });
  menu.querySelector('button')?.focus({ preventScroll: true });
  return close;
}

export function relDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return relDate(ts);
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => { scripts.delete(src); rej(new Error(`Could not load ${src}`)); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export const loadJSZip = () => loadScript('vendor/jszip.min.js').then(() => window.JSZip);

export async function loadPdfjs() {
  const lib = await import('../vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}

// Stable id for a file: SHA-256 over its size, head and tail, so the same file
// imported on two devices gets the same id and its reading position syncs.
export async function fileId(blob) {
  const chunk = 1 << 20;
  const parts = [new TextEncoder().encode(String(blob.size)), await blob.slice(0, chunk).arrayBuffer()];
  if (blob.size > chunk) parts.push(await blob.slice(Math.max(chunk, blob.size - chunk)).arrayBuffer());
  const buf = await new Blob(parts).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return 'f' + [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALLOWED_TAGS = new Set('a abbr b blockquote br caption cite code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s small span strong sub sup table tbody td tfoot th thead tr u ul'.split(' '));
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'form', 'link', 'meta', 'head', 'title']);

// Keeps only plain document markup; used for Markdown, Word and downloaded text.
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
      walk(child);
      if (!ALLOWED_TAGS.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const keep = (name === 'href' && tag === 'a') || (name === 'src' && tag === 'img') || name === 'alt' || name === 'colspan' || name === 'rowspan' || name === 'title';
        if (!keep) child.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src') && !/^(https?:|data:image\/|blob:|#)/i.test(attr.value.trim())) child.removeAttribute(attr.name);
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
