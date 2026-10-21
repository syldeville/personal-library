// Adding books: import from Files, download from a link, and the "Add books" sheet.
import { h, icon, sheet, toast, fileId, pickFiles, IMAGE_RE, naturalSort } from './util.js';
import { db } from './db.js';
import { getBook, saveBook, COMIC_FORMATS } from './store.js';
import { detectFormat, readMeta, ACCEPT, titleFromName } from './formats.js';
import { autoCover } from './covers.js';

export function openAddSheet() {
  const urlInput = h('input', { id: 'add-url', class: 'input', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://…/book.epub', style: { flex: '1', minWidth: '0' } });
  const close = sheet('Add books', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
    h('button', { class: 'bigoption', onclick: async () => { close(); await importFromPicker(); } },
      icon('folder'),
      h('span', {}, h('span', { class: 't' }, 'Import from Files'), h('span', { class: 's' }, 'iCloud Drive, On My iPhone, Downloads'))),
    h('a', { class: 'bigoption', href: '#/mangadex', onclick: () => close() },
      icon('manga'),
      h('span', {}, h('span', { class: 't' }, 'Browse MangaDex'), h('span', { class: 's' }, 'Search and download manga volumes'))),
    h('form', {
      class: 'field',
      onsubmit: async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;
        close();
        await importFromUrl(url);
      },
    },
    h('label', { for: 'add-url', style: { fontSize: '16px', fontWeight: '600' } }, 'Download from a link'),
    h('div', { style: { display: 'flex', gap: '8px' } }, urlInput, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Get')),
    h('div', { class: 'hint' }, "Some sites don't allow downloads from other apps. If that happens, save the file to Files and import it instead.")),
    h('div', { class: 'hint', style: { borderTop: '1px solid var(--rule)', paddingTop: '14px', fontSize: '13px' } },
      'Reads PDF, EPUB, TXT, Markdown, Word (.docx), and manga as CBZ, CBR, ZIP or a set of images. Files stay on this device; your place syncs.')));
}

export async function importFromPicker() {
  const files = await pickFiles({ accept: ACCEPT, multiple: true });
  if (files.length) await importFiles(files);
}

// Imports files. Loose images are grouped into one volume.
export async function importFiles(files) {
  const images = files.filter((f) => IMAGE_RE.test(f.name) || f.type.startsWith('image/'));
  const others = files.filter((f) => !images.includes(f));
  const t = toast('Importing…', null, 0);
  let added = 0;
  const errors = [];
  for (const [i, f] of others.entries()) {
    t.update(others.length > 1 ? `Importing ${i + 1} of ${others.length}…` : `Importing ${f.name}…`);
    try {
      if (await importBlob(f, f.name, { type: 'file' })) added++;
    } catch (e) {
      console.error(e);
      errors.push(`${f.name}: ${e.message}`);
    }
  }
  if (images.length) {
    t.update('Importing images…');
    try {
      if (await importImages(images)) added++;
    } catch (e) {
      errors.push(e.message);
    }
  }
  t.close();
  if (errors.length) toast(errors.join(' · '), null, 6000);
  else if (added) toast(added === 1 ? 'Added to your library' : `Added ${added} items`);
  return added;
}

export async function importFromUrl(url) {
  const t = toast('Downloading…', null, 0);
  try {
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error("That site doesn't allow downloads from other apps. Save the file to Files, then import it.");
    }
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const fromHeader = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1];
    let name = fromHeader ? decodeURIComponent(fromHeader) : decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download');
    t.close();
    const ok = await importBlob(blob, name, { type: 'url', url });
    if (ok) toast('Added to your library');
  } catch (e) {
    t.close();
    toast(e.message, null, 7000);
  }
}

// Returns true when a new book was added (or a missing file reattached).
export async function importBlob(blob, name, source) {
  const format = await detectFormat(name, blob);
  if (!format || format === 'image') throw new Error("This file type isn't supported");
  const id = await fileId(blob);
  const existing = await getBook(id);
  if (existing && !existing.deleted && existing.hasFile) {
    toast(`“${existing.title}” is already in your library`);
    return false;
  }
  const meta = await readMeta(format, blob, name);
  await db.put('files', { id, blob });
  const book = existing && !existing.deleted
    ? { ...existing, hasFile: true }
    : {
      id, title: meta.title, author: meta.author || '', format,
      kind: COMIC_FORMATS.has(format) ? 'manga' : 'book',
      fileName: name, size: blob.size, addedAt: Date.now(), lastReadAt: 0,
      progress: 0, position: null, source, hasFile: true,
      dir: COMIC_FORMATS.has(format) ? 'rtl' : 'ltr',
      pageCount: meta.pageCount || 0,
    };
  await saveBook(book, { sync: !existing || existing.deleted });
  autoCover(book, meta.cover, blob).catch((e) => console.warn(e));
  return true;
}

async function importImages(images) {
  images.sort((a, b) => naturalSort(a.name, b.name));
  const id = await fileId(new Blob(images.slice(0, 4).concat(String(images.length))));
  const title = titleFromName(images[0].name).replace(/[\s_-]*\d+$/, '') || 'Images';
  await db.put('files', { id, pages: images.map((f) => new Blob([f], { type: f.type || 'image/jpeg' })) });
  const existing = await getBook(id);
  const book = existing && !existing.deleted ? { ...existing, hasFile: true } : {
    id, title, author: `${images.length} images`, format: 'images', kind: 'manga', fileName: images[0].name,
    size: images.reduce((s, f) => s + f.size, 0), addedAt: Date.now(), lastReadAt: 0, progress: 0,
    position: null, source: { type: 'file' }, hasFile: true, dir: 'rtl', pageCount: images.length,
  };
  await saveBook(book);
  autoCover(book, images[0]).catch(() => {});
  return true;
}

// Re-attaches a file to a book that synced from another device.
export async function reimport(book) {
  const [file] = await pickFiles({ accept: ACCEPT });
  if (!file) return;
  const id = await fileId(file);
  if (id !== book.id) {
    toast("That's a different file from the one on your other device. It was added as a new book.", null, 6000);
  }
  await importFiles([file]);
}
