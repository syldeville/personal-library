// File format detection, metadata, and content loading for each format.
import { loadJSZip, loadPdfjs, loadScript, sanitizeHtml, escapeHtml, naturalSort, IMAGE_RE } from './util.js';
import { db } from './db.js';

const EXT = {
  pdf: 'pdf', epub: 'epub', txt: 'txt', text: 'txt', md: 'md', markdown: 'md', docx: 'docx',
  cbz: 'cbz', zip: 'cbz', cbr: 'cbr', rar: 'cbr', cb7: 'cbr', '7z': 'cbr',
};

export const ACCEPT = '.pdf,.epub,.txt,.text,.md,.markdown,.docx,.cbz,.cbr,.zip,.rar,.cb7,image/*,application/pdf,application/epub+zip,text/plain,text/markdown';

export const FORMAT_LABEL = { pdf: 'PDF', epub: 'EPUB', txt: 'TXT', md: 'MD', docx: 'DOCX', cbz: 'CBZ', cbr: 'CBR', images: 'IMAGES', mangadex: 'MANGA' };

export async function detectFormat(name, blob) {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const str = String.fromCharCode(...head);
  if (str.startsWith('%PDF')) return 'pdf';
  if (str.startsWith('Rar!') || str.startsWith('7z\xBC\xAF')) return 'cbr';
  if (str.startsWith('PK')) {
    if (str.includes('mimetypeapplication/epub+zip')) return 'epub';
    const ext = EXT[extOf(name)];
    if (ext === 'epub' || ext === 'docx') return ext;
    return 'cbz';
  }
  if (IMAGE_RE.test(name) || blob.type.startsWith('image/')) return 'image';
  const ext = EXT[extOf(name)];
  if (ext) return ext;
  if (blob.type.startsWith('text/')) return blob.type.includes('markdown') ? 'md' : 'txt';
  return null;
}

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

export function titleFromName(name) {
  let t = name.replace(/\.[a-z0-9]+$/i, '').replace(/_+/g, ' ');
  if (!t.includes(' ')) t = t.replace(/-+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Untitled';
}

// ---------- metadata ----------

export async function readMeta(format, blob, name) {
  const meta = { title: titleFromName(name), author: '', cover: null, pageCount: 0 };
  try {
    if (format === 'epub') Object.assign(meta, await epubMeta(blob));
    else if (format === 'docx') Object.assign(meta, await docxMeta(blob));
    else if (format === 'pdf') Object.assign(meta, await pdfMeta(blob));
    else if (format === 'txt') {
      const head = await blob.slice(0, 4000).text();
      const t = head.match(/^Title:\s*(.+)$/m), a = head.match(/^Author:\s*(.+)$/m);
      if (t) meta.title = t[1].trim();
      if (a) meta.author = a[1].trim();
    } else if (format === 'md') {
      const first = (await blob.slice(0, 4000).text()).match(/^#\s+(.+)$/m);
      if (first) meta.title = first[1].trim();
    } else if (format === 'cbz' || format === 'cbr') {
      const src = await openArchive(format, blob);
      meta.pageCount = src.count;
      if (src.count) meta.cover = await src.blob(0);
      if (src.info?.title) meta.title = src.info.title;
      if (src.info?.author) meta.author = src.info.author;
      src.destroy();
    }
  } catch (e) {
    console.warn('metadata', e);
  }
  for (const k of ['title', 'author']) if (!meta[k]) delete meta[k];
  meta.title ||= titleFromName(name);
  return meta;
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const tagText = (doc, local) => doc.getElementsByTagNameNS('*', local)[0]?.textContent?.trim() || '';

async function epubMeta(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const container = xml(await zip.file('META-INF/container.xml').async('string'));
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0].getAttribute('full-path');
  const opf = xml(await zip.file(opfPath).async('string'));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const items = [...opf.getElementsByTagNameNS('*', 'item')];
  const coverId = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const item = items.find((i) => (i.getAttribute('properties') || '').split(/\s+/).includes('cover-image'))
    || items.find((i) => coverId && i.getAttribute('id') === coverId)
    || items.find((i) => /cover/i.test(i.getAttribute('id') + i.getAttribute('href')) && /^image\//.test(i.getAttribute('media-type')));
  let cover = null;
  if (item) {
    const path = resolvePath(base, decodeURIComponent(item.getAttribute('href')));
    const f = zip.file(path);
    if (f) cover = new Blob([await f.async('arraybuffer')], { type: item.getAttribute('media-type') || 'image/jpeg' });
  }
  return { title: tagText(opf, 'title'), author: tagText(opf, 'creator'), cover };
}

function resolvePath(base, rel) {
  const parts = (base + rel).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

async function docxMeta(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const core = zip.file('docProps/core.xml');
  if (!core) return {};
  const doc = xml(await core.async('string'));
  return { title: tagText(doc, 'title'), author: tagText(doc, 'creator') };
}

async function pdfMeta(blob) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    const { info } = await pdf.getMetadata().catch(() => ({ info: {} }));
    const junk = (s) => !s || /^(untitled|microsoft word|document\d*|untitled-\d+)/i.test(s) || /\.(docx?|pdf|indd)$/i.test(s);
    return { title: junk(info?.Title) ? '' : info.Title.trim(), author: (info?.Author || '').trim(), pageCount: pdf.numPages };
  } finally {
    pdf.destroy();
  }
}

// ---------- flowing text ----------

async function decodeText(blob) {
  const buf = await blob.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export async function textToHtml(blob) {
  let text = (await decodeText(blob)).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  // Project Gutenberg files: drop the licence header and footer.
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) text = text.slice(0, end);

  const blankSeparated = (text.match(/\n\s*\n/g) || []).length > text.split('\n').length / 12;
  const paras = blankSeparated ? text.split(/\n\s*\n/) : text.split('\n');
  const out = [];
  for (let p of paras) {
    p = p.trim();
    if (!p) continue;
    const oneLine = !p.includes('\n');
    if (oneLine && p.length < 80 && /^(chapter|book|part|section|prologue|epilogue|act)\b/i.test(p)) {
      out.push(`<h2>${escapeHtml(p)}</h2>`);
    } else if (oneLine && p.length < 60 && p === p.toUpperCase() && /[A-Z]/.test(p)) {
      out.push(`<h3>${escapeHtml(p)}</h3>`);
    } else {
      out.push(`<p>${escapeHtml(p.replace(/\s*\n\s*/g, ' '))}</p>`);
    }
  }
  return out.join('\n');
}

export async function markdownToHtml(blob) {
  await loadScript('vendor/marked.min.js');
  return sanitizeHtml(window.marked.parse(await decodeText(blob), { gfm: true }));
}

export async function docxToHtml(blob) {
  await loadScript('vendor/mammoth.browser.min.js');
  const res = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
  return sanitizeHtml(res.value);
}

// Pulls the text out of a PDF and rebuilds paragraphs. Cached because it takes
// a few seconds on long books. Each page starts with a marker carrying data-page.
export async function pdfTextHtml(id, pdf, onProgress) {
  const cached = await db.get('cache', `pdftext:${id}`);
  if (cached) return cached.html;
  const out = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    out.push(`<div class="pg" data-page="${n}">${n}</div>`);
    let para = '', lastY = null, lastH = 0;
    const flush = () => { if (para.trim()) out.push(`<p data-page="${n}">${escapeHtml(para.trim())}</p>`); para = ''; };
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5], hgt = Math.abs(item.transform[3]) || item.height || 10;
      if (lastY !== null && Math.abs(lastY - y) > Math.max(lastH, hgt) * 1.7) flush();
      if (lastY !== null && Math.abs(lastY - y) > 1 && para && !para.endsWith(' ')) {
        para = para.endsWith('-') ? para.slice(0, -1) : para + ' ';
      }
      para += item.str;
      if (item.str.trim()) { lastY = y; lastH = hgt; }
      if (item.hasEOL && para && !para.endsWith(' ') && !para.endsWith('-')) para += ' ';
    }
    flush();
    page.cleanup();
    if (n % 10 === 0) onProgress?.(n / pdf.numPages);
  }
  const html = out.join('\n');
  await db.put('cache', { id: `pdftext:${id}`, html });
  return html;
}

// ---------- comics / manga ----------

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
const typed = (b, name) => new Blob([b], { type: MIME[extOf(name)] || 'image/jpeg' });
const isPage = (path) => IMAGE_RE.test(path) && !/(^|\/)(__MACOSX|\.)/.test(path);

// Opens a CBZ/CBR archive. Returns {count, blob(i), info, destroy()}.
export async function openArchive(format, blob) {
  if (format === 'cbz') {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && isPage(n)).sort(naturalSort);
    let info = null;
    const ci = Object.keys(zip.files).find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
    if (ci) info = comicInfo(await zip.file(ci).async('string'));
    return {
      count: names.length,
      info,
      blob: async (i) => typed(await zip.file(names[i]).async('arraybuffer'), names[i]),
      destroy() {},
    };
  }
  const { Archive } = await import('../vendor/libarchive/libarchive.js');
  Archive.init({ workerUrl: new URL('../vendor/libarchive/worker-bundle.js', import.meta.url).href });
  const archive = await Archive.open(blob instanceof File ? blob : new File([blob], 'book.cbr'));
  const entries = (await archive.getFilesArray())
    .map((e) => ({ file: e.file, path: e.path + e.file.name }))
    .filter((e) => isPage(e.path))
    .sort((a, b) => naturalSort(a.path, b.path));
  return {
    count: entries.length,
    info: null,
    blob: async (i) => typed(await entries[i].file.extract(), entries[i].path),
    destroy() { archive.close(); },
  };
}

function comicInfo(str) {
  const doc = xml(str);
  const series = tagText(doc, 'Series'), num = tagText(doc, 'Volume') || tagText(doc, 'Number');
  const title = series ? `${series}${num ? ` Vol. ${num}` : ''}` : tagText(doc, 'Title');
  return { title, author: tagText(doc, 'Writer') };
}

// Page source for any comic-type book, with a small cache of object URLs.
export async function comicPages(book, fileRec) {
  let src;
  if (fileRec.pages) {
    src = { count: fileRec.pages.length, blob: async (i) => fileRec.pages[i], destroy() {} };
  } else {
    src = await openArchive(book.format, fileRec.blob);
  }
  const urls = new Map();
  return {
    count: src.count,
    async url(i) {
      if (urls.has(i)) return urls.get(i);
      const p = src.blob(i).then((b) => URL.createObjectURL(b));
      urls.set(i, p);
      if (urls.size > 10) {
        for (const [k, v] of urls) {
          if (Math.abs(k - i) > 4) { urls.delete(k); v.then((u) => URL.revokeObjectURL(u)); }
          if (urls.size <= 8) break;
        }
      }
      return p;
    },
    destroy() {
      for (const v of urls.values()) v.then((u) => URL.revokeObjectURL(u));
      src.destroy();
    },
  };
}
