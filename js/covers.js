// Cover art: from the file itself, or looked up online.
//   Books: Open Library, then Google Books.   Manga: AniList.
import { db } from './db.js';
import { saveBook, getBook, forgetCover, emit, COMIC_FORMATS } from './store.js';
import { loadPdfjs } from './util.js';

const cleanTitle = (t) => t.replace(/\b(vol(ume)?\.?\s*\d+|v\d+)\b/ig, '').replace(/[\[(].*?[\])]/g, '').replace(/\s+/g, ' ').trim();

// Candidate cover image URLs for a book, best first.
export async function findCovers(book) {
  const title = cleanTitle(book.title);
  const author = book.author && !/\.(docx?|pdf|md|txt)$/i.test(book.author) ? book.author : '';
  const out = [];
  const tasks = book.kind === 'manga'
    ? [anilist(title)]
    : [openLibrary(title, author), googleBooks(title, author)];
  for (const r of await Promise.allSettled(tasks)) if (r.status === 'fulfilled') out.push(...r.value);
  return [...new Set(out)].slice(0, 9);
}

async function openLibrary(title, author) {
  const q = new URLSearchParams({ title, limit: '6', fields: 'cover_i,title' });
  if (author) q.set('author', author);
  const res = await fetch(`https://openlibrary.org/search.json?${q}`);
  if (!res.ok) return [];
  const { docs = [] } = await res.json();
  return docs.filter((d) => d.cover_i).map((d) => `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`);
}

async function googleBooks(title, author) {
  const q = `intitle:${title}${author ? ` inauthor:${author}` : ''}`;
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?maxResults=6&q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const { items = [] } = await res.json();
  return items.map((i) => i.volumeInfo?.imageLinks?.thumbnail).filter(Boolean)
    .map((u) => u.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2'));
}

async function anilist(title) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query($s:String){Page(perPage:6){media(search:$s,type:MANGA){coverImage{extraLarge large}}}}',
      variables: { s: title },
    }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data?.Page?.media || []).map((m) => m.coverImage?.extraLarge || m.coverImage?.large).filter(Boolean);
}

// Shrinks an image blob to a small JPEG for the library.
export async function shrinkImage(blob, maxH = 480) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxH / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  } catch {
    return blob;
  }
}

export async function setCoverBlob(id, blob, coverUrl) {
  const book = await getBook(id);
  if (!book) return;
  await db.put('covers', { id, blob: await shrinkImage(blob) });
  forgetCover(id);
  book.hasCover = true;
  if (coverUrl !== undefined) {
    book.coverUrl = coverUrl;
    await saveBook(book);
  } else {
    await saveBook(book, { sync: false });
  }
  emit('cover', id);
}

// Uses an online image. Tries to keep a copy for offline use; if the site does
// not allow that, the library shows it straight from the web.
export async function setCoverUrl(id, url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(res.status);
    await setCoverBlob(id, await res.blob(), url);
  } catch {
    const book = await getBook(id);
    await db.del('covers', id);
    forgetCover(id);
    book.coverUrl = url;
    book.hasCover = false;
    await saveBook(book);
    emit('cover', id);
  }
}

export async function pdfFirstPage(blob) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 480 / vp.height });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  } finally {
    pdf.destroy();
  }
}

// Called after import. Order: cover inside the file (EPUB, comics), online
// lookup, then the first PDF page. Otherwise the library draws a plain cover.
export async function autoCover(book, embedded, fileBlob) {
  if (book.coverUrl || await db.get('covers', book.id)) return;
  if (embedded) return setCoverBlob(book.id, embedded);
  if (navigator.onLine) {
    try {
      const [first] = await findCovers(book);
      if (first) return setCoverUrl(book.id, first);
    } catch (e) {
      console.warn('cover lookup', e);
    }
  }
  if (book.format === 'pdf' && fileBlob) {
    try { return setCoverBlob(book.id, await pdfFirstPage(fileBlob)); } catch (e) { console.warn(e); }
  }
}

export const isComic = (book) => COMIC_FORMATS.has(book.format);
