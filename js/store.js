// Library records and reading preferences.
import { db, kv } from './db.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
};

// Fields shared between devices through GitHub sync. Everything else (hasFile,
// hasCover) describes this device only.
export const SYNC_FIELDS = ['id', 'title', 'author', 'format', 'kind', 'fileName', 'size', 'addedAt', 'lastReadAt',
  'progress', 'position', 'updatedAt', 'deleted', 'source', 'coverUrl', 'dir', 'chapters', 'pageCount'];

export const COMIC_FORMATS = new Set(['cbz', 'cbr', 'images', 'mangadex']);

export async function allRecords() {
  return db.all('books');
}

export async function listBooks() {
  return (await db.all('books')).filter((b) => !b.deleted);
}

export const getBook = (id) => db.get('books', id);

// Save a book. Pass {sync: false} for device-only changes (cover cached, file attached).
export async function saveBook(book, { sync = true } = {}) {
  if (sync) book.updatedAt = Date.now();
  await db.put('books', book);
  emit('books');
  if (sync) emit('changed');
  return book;
}

export async function deleteBook(id) {
  const book = await getBook(id);
  if (!book) return;
  await Promise.all([db.del('files', id), db.del('covers', id), db.del('cache', `epubloc:${id}`), db.del('cache', `pdftext:${id}`)]);
  forgetCover(id);
  await saveBook({ id, title: book.title, deleted: true, addedAt: book.addedAt });
}

// Remove the downloaded file but keep the book, progress and cover.
export async function removeFile(id) {
  const book = await getBook(id);
  await db.del('files', id);
  await db.del('cache', `pdftext:${id}`);
  book.hasFile = false;
  await saveBook(book, { sync: false });
}

// ---- cover object URLs (kept for the session) ----
const coverUrls = new Map();
export async function coverSrc(book) {
  if (coverUrls.has(book.id)) return coverUrls.get(book.id);
  const rec = book.hasCover !== false ? await db.get('covers', book.id) : null;
  const url = rec?.blob ? URL.createObjectURL(rec.blob) : (book.coverUrl || null);
  coverUrls.set(book.id, url);
  return url;
}
export function forgetCover(id) {
  const u = coverUrls.get(id);
  if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  coverUrls.delete(id);
}

// ---- preferences ----
export const SIZES = [14, 16, 18, 19, 21, 24, 28];
const DEFAULT_PREFS = {
  view: 'list', sort: 'recent', show: 'all',
  size: 3, font: 'literata', spacing: 'normal', margins: 'normal', justify: true,
  fit: 'screen', dataSaver: false, mdLang: 'en', mdSafe: true,
};
export const prefs = { ...DEFAULT_PREFS };

export async function loadPrefs() {
  Object.assign(prefs, await kv.get('prefs', {}));
  return prefs;
}
export async function setPref(key, value) {
  prefs[key] = value;
  await kv.set('prefs', { ...prefs });
  emit('prefs', key);
}
