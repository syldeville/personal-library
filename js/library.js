// Library screen: list or grid of books, sorting, search, per-book actions.
import { h, icon, popMenu, sheet, toast, relDate, timeAgo, pickFiles, downloadBlob } from './util.js';
import { listBooks, prefs, setPref, on, coverSrc, deleteBook, removeFile, saveBook, getBook } from './store.js';
import { FORMAT_LABEL } from './formats.js';
import { openAddSheet, reimport } from './add.js';
import { findCovers, setCoverBlob, setCoverUrl, pdfFirstPage } from './covers.js';
import { syncState, syncNow } from './sync.js';
import { db } from './db.js';

const SORTS = {
  recent: ['Recently read', (a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0) || b.addedAt - a.addedAt],
  title: ['Title', (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })],
  author: ['Author', (a, b) => (a.author || '~').localeCompare(b.author || '~') || a.title.localeCompare(b.title, undefined, { numeric: true })],
  added: ['Date added', (a, b) => b.addedAt - a.addedAt],
  progress: ['Progress', (a, b) => (b.progress || 0) - (a.progress || 0)],
};
const SHOWS = { all: 'Everything', book: 'Books only', manga: 'Manga only' };

export function libraryView() {
  let query = '';
  let searching = false;
  const listHost = h('div', { class: 'scroll' });
  const sortValue = h('span', { class: 'v' });
  const listBtn = h('button', { 'aria-label': 'List view', onclick: () => setPref('view', 'list') }, icon('list'));
  const gridBtn = h('button', { 'aria-label': 'Grid view', onclick: () => setPref('view', 'grid') }, icon('grid'));
  const count = h('span');
  const syncLabel = h('button', { onclick: () => syncNow({ manual: true }) });
  const searchInput = h('input', {
    class: 'input', type: 'search', placeholder: 'Search titles and authors', 'aria-label': 'Search library',
    oninput: () => { query = searchInput.value.trim().toLowerCase(); render(); },
  });
  const searchBar = h('div', { class: 'searchbar', hidden: true }, searchInput);

  const sortBtn = h('button', {
    class: 'sortbtn', 'aria-haspopup': 'menu',
    onclick: () => popMenu(sortBtn, [
      { section: 'Sort by' },
      ...Object.entries(SORTS).map(([k, [label]]) => ({ label, checked: prefs.sort === k, run: () => setPref('sort', k) })),
      { section: 'Show' },
      ...Object.entries(SHOWS).map(([k, label]) => ({ label, checked: prefs.show === k, run: () => setPref('show', k) })),
    ]),
  }, h('span', { class: 'k' }, 'Sort:'), sortValue, icon('chevron', 14));

  const view = h('div', { class: 'view' },
    h('header', { class: 'topbar' },
      h('h1', {}, 'Library'),
      h('div', { style: { display: 'flex' } },
        h('button', {
          class: 'iconbtn', 'aria-label': 'Search',
          onclick: () => {
            searching = !searching;
            searchBar.hidden = !searching;
            if (searching) searchInput.focus();
            else { searchInput.value = ''; query = ''; render(); }
          },
        }, icon('search')),
        h('button', { class: 'iconbtn', 'aria-label': 'Add books', onclick: openAddSheet }, icon('plus')),
        h('a', { class: 'iconbtn', href: '#/settings', 'aria-label': 'Settings' }, icon('menu')))),
    h('div', { class: 'lib-tools' }, sortBtn, h('div', { class: 'viewtoggle', role: 'group', 'aria-label': 'Library view' }, listBtn, gridBtn)),
    searchBar,
    listHost,
    h('footer', { class: 'libfooter' }, count, syncLabel));

  async function render() {
    sortValue.textContent = SORTS[prefs.sort][0];
    listBtn.setAttribute('aria-pressed', String(prefs.view === 'list'));
    gridBtn.setAttribute('aria-pressed', String(prefs.view === 'grid'));
    let books = (await listBooks()).filter((b) => prefs.show === 'all' || b.kind === prefs.show);
    if (query) books = books.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(query));
    books.sort(SORTS[prefs.sort][1]);
    count.textContent = `${books.length} ${books.length === 1 ? 'item' : 'items'}`;
    renderSync();
    const scrollTop = listHost.scrollTop;
    listHost.replaceChildren(books.length ? (prefs.view === 'grid' ? grid(books) : list(books)) : emptyState());
    listHost.scrollTop = scrollTop;
  }

  function renderSync() {
    const s = syncState();
    syncLabel.textContent = !s.configured ? 'Sync is off' : s.busy ? 'Syncing…' : s.error ? 'Sync problem: tap to retry' : `Synced · ${timeAgo(s.at)}`;
    syncLabel.disabled = !s.configured;
  }

  function emptyState() {
    if (query) return h('div', { class: 'empty' }, 'Nothing matches that search.');
    return h('div', { class: 'empty' },
      h('h2', {}, 'Your library is empty'),
      h('p', {}, 'Tap + to import books and manga from Files, download from a link, or browse MangaDex.'),
      h('button', { class: 'btn btn-primary', onclick: openAddSheet }, 'Add books'));
  }

  const offs = [on('books', render), on('prefs', render), on('cover', render), on('sync', renderSync)];
  const ticker = setInterval(renderSync, 30000);
  render();
  return { el: view, destroy: () => { offs.forEach((f) => f()); clearInterval(ticker); } };
}

function statusText(b) {
  if (!b.hasFile && b.source?.type === 'mangadex') return 'Not downloaded';
  if (!b.hasFile) return 'Not on this device';
  if (b.progress >= 0.995) return 'Finished';
  if (!b.lastReadAt) return 'New';
  return `${Math.round((b.progress || 0) * 100)}% · ${relDate(b.lastReadAt)}`;
}

function coverEl(b) {
  const el = h('span', { class: `cover${b.hasFile ? '' : ' missing'}` },
    h('span', { class: 'fallback' }, h('span', { class: 't' }, b.title), h('span', { class: 'f' }, FORMAT_LABEL[b.format] || '')));
  coverSrc(b).then((src) => {
    if (!src) return;
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src });
    img.onload = () => el.classList.add('has-img');
    img.onerror = () => img.remove();
    el.append(img);
  });
  return el;
}

const progressBar = (b) => h('div', { class: 'progress' }, h('div', { style: { width: `${Math.round((b.progress || 0) * 100)}%` } }));

function list(books) {
  return h('ul', { class: 'booklist' }, books.map((b) => h('li', { class: 'bookrow' },
    h('button', { class: 'open', onclick: () => openBook(b) },
      coverEl(b),
      h('span', { class: 'meta' },
        h('span', { class: 'title' }, b.title),
        h('span', { class: 'author' }, b.hasFile ? (b.author || b.fileName || '') : (b.source?.type === 'mangadex' ? 'Tap to download again' : 'Tap to import the file on this device')),
        h('span', { class: 'line' },
          h('span', { class: 'tag' }, b.kind === 'manga' ? 'MANGA' : FORMAT_LABEL[b.format]),
          progressBar(b),
          h('span', { class: 'status' }, statusText(b))))),
    h('button', { class: 'iconbtn more', 'aria-label': `More for ${b.title}`, onclick: (e) => bookMenu(e.currentTarget, b) }, icon('more')))));
}

function grid(books) {
  return h('ul', { class: 'bookgrid' }, books.map((b) => h('li', { class: 'gridcell' },
    h('button', { class: 'open', 'aria-label': b.title, onclick: () => openBook(b) }, coverEl(b)),
    progressBar(b),
    h('div', { class: 'under' },
      h('span', { class: 'status' }, statusText(b)),
      h('button', { class: 'iconbtn more', 'aria-label': `More for ${b.title}`, onclick: (e) => bookMenu(e.currentTarget, b) }, icon('more', 18))))));
}

async function openBook(b) {
  if (b.hasFile) { location.hash = `#/read/${encodeURIComponent(b.id)}`; return; }
  if (b.source?.type === 'mangadex') { location.hash = `#/mangadex/${b.source.mangaId}`; return; }
  await reimport(b);
}

function bookMenu(anchor, b) {
  popMenu(anchor, [
    { label: 'Change cover', run: () => coverSheet(b) },
    { label: 'Edit title and author', run: () => editSheet(b) },
    { label: b.progress >= 0.995 ? 'Mark as unread' : 'Mark as finished', run: () => markFinished(b) },
    b.hasFile && b.format !== 'mangadex' && b.format !== 'images' ? { label: 'Save file to device', run: () => exportFile(b) } : null,
    b.hasFile ? { label: 'Remove download (keep in library)', run: () => removeFile(b.id) } : null,
    { label: 'Delete from library', danger: true, run: () => confirmDelete(b) },
  ].filter(Boolean), { align: 'right' });
}

async function markFinished(b) {
  const book = await getBook(b.id);
  const done = !(book.progress >= 0.995);
  book.progress = done ? 1 : 0;
  book.position = done ? book.position : null;
  if (done) book.lastReadAt = Date.now();
  await saveBook(book);
}

async function confirmDelete(b) {
  if (!confirm(`Delete “${b.title}” from your library on all devices?`)) return;
  await deleteBook(b.id);
  toast('Deleted');
}

async function exportFile(b) {
  const rec = await db.get('files', b.id);
  if (rec?.blob) downloadBlob(rec.blob, b.fileName || `${b.title}.${b.format}`);
}

function editSheet(b) {
  const title = h('input', { id: 'ed-title', class: 'input', value: b.title });
  const author = h('input', { id: 'ed-author', class: 'input', value: b.author || '' });
  const close = sheet('Edit details', h('form', {
    style: { display: 'flex', flexDirection: 'column', gap: '14px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const book = await getBook(b.id);
      book.title = title.value.trim() || book.title;
      book.author = author.value.trim();
      await saveBook(book);
      close();
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'ed-title' }, 'Title'), title),
  h('div', { class: 'field' }, h('label', { for: 'ed-author' }, 'Author'), author),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')));
}

function coverSheet(b) {
  const results = h('div', { class: 'coverpick' }, h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'Searching online…'));
  const close = sheet('Change cover', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    results,
    h('button', {
      class: 'btn',
      onclick: async () => {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        await setCoverBlob(b.id, file);
        close();
      },
    }, 'Choose an image…'),
    b.hasFile && (b.format === 'pdf' || b.kind === 'manga') ? h('button', {
      class: 'btn',
      onclick: async () => {
        const rec = await db.get('files', b.id);
        let blob;
        if (b.format === 'pdf') blob = await pdfFirstPage(rec.blob);
        else {
          const { comicPages } = await import('./formats.js');
          const pages = await comicPages(b, rec);
          blob = await fetch(await pages.url(0)).then((r) => r.blob());
          pages.destroy();
        }
        await setCoverBlob(b.id, blob);
        close();
      },
    }, 'Use the first page') : null));
  findCovers(b).then((urls) => {
    results.replaceChildren(...(urls.length ? urls.map((u) => h('button', {
      'aria-label': 'Use this cover',
      onclick: async () => { close(); await setCoverUrl(b.id, u); },
    }, h('img', { src: u, alt: '', loading: 'lazy' }))) : [h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'No covers found online. Try editing the title, or choose an image.')]));
  }).catch(() => results.replaceChildren(h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, "Couldn't search online right now.")));
}
