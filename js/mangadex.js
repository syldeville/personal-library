// MangaDex: search, volume list, and downloading volumes for offline reading.
// MangaDex doesn't allow browser apps on other sites to call it directly, so
// every request goes through your own small proxy (see proxy/README.md).
import { h, icon, toast, sleep, naturalSort } from './util.js';
import { kv, db } from './db.js';
import { getBook, saveBook, prefs, setPref, emit, on } from './store.js';
import { setCoverBlob } from './covers.js';

let proxy = '';
export async function loadProxy() {
  proxy = (await kv.get('mdProxy', '')) || '';
  return proxy;
}
export async function saveProxy(url) {
  url = url.trim().replace(/\/+$/, '');
  if (url && !/^https:\/\//.test(url)) throw new Error('The proxy address should start with https://');
  if (url) {
    const res = await fetch(`${url}/api/ping`).catch(() => null);
    if (!res || !res.ok) throw new Error("Couldn't reach the proxy. Check the address, and that ALLOWED_ORIGIN matches this site.");
  }
  proxy = url;
  await kv.set('mdProxy', url);
}

const img = (url) => `${proxy}/img?u=${encodeURIComponent(url)}`;
const coverThumb = (mangaId, file, size = 256) => img(`https://uploads.mangadex.org/covers/${mangaId}/${file}.${size}.jpg`);

async function api(path, params) {
  const qs = params ? `?${params}` : '';
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${proxy}/api${path}${qs}`);
    } catch {
      throw new Error("Couldn't reach your MangaDex proxy. Are you online?");
    }
    if (res.status === 429 && attempt < 3) {
      await sleep((Number(res.headers.get('retry-after')) || 5) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`MangaDex error ${res.status}`);
    return res.json();
  }
}

function params(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(`${k}[]`, x));
    else if (v !== undefined && v !== null && v !== '') p.append(k, v);
  }
  return p;
}

const pickLang = (obj = {}, alt = []) => obj[prefs.mdLang] || obj.en || alt.find((a) => a[prefs.mdLang] || a.en)?.[prefs.mdLang]
  || alt.find((a) => a.en)?.en || Object.values(obj)[0] || 'Untitled';

function mangaInfo(m) {
  const rel = (type) => m.relationships.filter((r) => r.type === type);
  return {
    id: m.id,
    title: pickLang(m.attributes.title, m.attributes.altTitles),
    author: [...new Set(rel('author').concat(rel('artist')).map((r) => r.attributes?.name).filter(Boolean))].join(', '),
    cover: rel('cover_art')[0]?.attributes?.fileName,
    status: m.attributes.status,
    description: pickLang(m.attributes.description || {}) === 'Untitled' ? '' : pickLang(m.attributes.description || {}),
    originalLanguage: m.attributes.originalLanguage,
  };
}

const LANGS = { en: 'English', es: 'Spanish', 'es-la': 'Spanish (LatAm)', fr: 'French', 'pt-br': 'Portuguese (BR)', it: 'Italian', de: 'German', ru: 'Russian', id: 'Indonesian', vi: 'Vietnamese' };
const ratings = () => (prefs.mdSafe ? ['safe'] : ['safe', 'suggestive']);

function needsProxy() {
  return h('div', { class: 'notice' },
    h('p', { style: { margin: '0 0 10px' } }, 'MangaDex only works through your own small proxy. Setting it up is free and takes about five minutes.'),
    h('a', { class: 'btn btn-primary', href: '#/settings' }, 'Set up in Settings'));
}

// ---------------- search ----------------

let lastSearch = { q: '', completed: false, results: null };

export function mangadexSearchView() {
  const input = h('input', { type: 'search', placeholder: 'Search MangaDex', 'aria-label': 'Search MangaDex', enterkeyhint: 'search', value: lastSearch.q });
  const results = h('div', { class: 'scroll' });
  const chip = (label, pressed, onclick) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onclick }, label);
  const chips = h('div', { class: 'chips' });

  function drawChips() {
    chips.replaceChildren(
      chip(LANGS[prefs.mdLang] || prefs.mdLang, true, (e) => langMenu(e.currentTarget)),
      chip('Safe only', prefs.mdSafe, async () => { await setPref('mdSafe', !prefs.mdSafe); drawChips(); search(); }),
      chip('Completed', lastSearch.completed, () => { lastSearch.completed = !lastSearch.completed; drawChips(); search(); }));
  }

  async function langMenu(anchor) {
    const { popMenu } = await import('./util.js');
    popMenu(anchor, Object.entries(LANGS).map(([k, label]) => ({
      label, checked: prefs.mdLang === k, run: async () => { await setPref('mdLang', k); drawChips(); search(); },
    })));
  }

  async function search() {
    const q = input.value.trim();
    lastSearch.q = q;
    if (!q) { results.replaceChildren(); return; }
    results.replaceChildren(h('div', { class: 'empty' }, 'Searching…'));
    try {
      const json = await api('/manga', params({
        title: q, limit: 24, 'includes': ['cover_art', 'author'], contentRating: ratings(),
        availableTranslatedLanguage: [prefs.mdLang], 'order[relevance]': 'desc',
        status: lastSearch.completed ? ['completed'] : undefined,
      }));
      lastSearch.results = json.data.map(mangaInfo);
      drawResults();
    } catch (e) {
      results.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  function drawResults() {
    const list = lastSearch.results || [];
    results.replaceChildren(list.length ? h('div', {}, list.map((m) => h('a', { class: 'mdrow', href: `#/mangadex/${m.id}`, style: { textDecoration: 'none', color: 'inherit' } },
      h('span', { class: 'cover' }, m.cover ? h('img', { src: coverThumb(m.id, m.cover), alt: '', loading: 'lazy' }) : null),
      h('span', { class: 'meta' },
        h('span', { class: 'title' }, m.title),
        h('span', { class: 'sub' }, m.author),
        h('span', { class: 'sub' }, cap(m.status)))))) : h('div', { class: 'empty' }, `Nothing found in ${LANGS[prefs.mdLang] || prefs.mdLang}.`));
  }

  const view = h('div', { class: 'view' },
    h('header', { class: 'subbar', style: { borderBottom: '0' } },
      h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back to library' }, icon('back')),
      h('h1', {}, 'MangaDex')),
    proxy ? h('form', { class: 'md-search', onsubmit: (e) => { e.preventDefault(); input.blur(); search(); } },
      h('div', { class: 'searchbox' }, icon('search'), input), chips) : null,
    proxy ? results : needsProxy());
  drawChips();
  if (lastSearch.results) drawResults();
  else if (proxy) setTimeout(() => input.focus(), 50);
  return { el: view };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// ---------------- title & volumes ----------------

async function fetchFeed(mangaId) {
  const all = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const json = await api(`/manga/${mangaId}/feed`, params({
      translatedLanguage: [prefs.mdLang], limit: 500, offset, includes: ['scanlation_group'],
      contentRating: ['safe', 'suggestive', 'erotica', 'pornographic'],
      'order[volume]': 'asc', 'order[chapter]': 'asc', includeExternalUrl: 1,
    }));
    all.push(...json.data);
    if (offset + 500 >= json.total) break;
  }
  return all;
}

// Groups chapters into volumes, keeping one copy of each chapter (preferring
// the translation group that did the most chapters).
function buildVolumes(chapters) {
  const groupCount = new Map();
  const groupOf = (c) => c.relationships.find((r) => r.type === 'scanlation_group')?.id || 'none';
  const readable = (c) => c.attributes.pages > 0 && !c.attributes.externalUrl;
  for (const c of chapters) if (readable(c)) groupCount.set(groupOf(c), (groupCount.get(groupOf(c)) || 0) + 1);
  const score = (c) => (readable(c) ? 1e6 : 0) + (groupCount.get(groupOf(c)) || 0);

  const best = new Map();
  for (const c of chapters) {
    const key = c.attributes.chapter ?? `oneshot-${c.id}`;
    const cur = best.get(key);
    if (!cur || score(c) > score(cur)) best.set(key, c);
  }
  const vols = new Map();
  for (const c of best.values()) {
    const v = c.attributes.volume ?? 'none';
    if (!vols.has(v)) vols.set(v, []);
    vols.get(v).push(c);
  }
  return [...vols.entries()]
    .sort(([a], [b]) => (a === 'none') - (b === 'none') || naturalSort(String(a), String(b)))
    .map(([vol, list]) => {
      list.sort((a, b) => naturalSort(a.attributes.chapter ?? '0', b.attributes.chapter ?? '0'));
      return {
        vol,
        chapters: list.filter(readable).map((c) => ({ id: c.id, num: c.attributes.chapter ?? 'Oneshot', title: c.attributes.title || '', pages: c.attributes.pages })),
        official: list.filter((c) => !readable(c)).length,
      };
    });
}

const volBookId = (mangaId, vol) => `mdx-${mangaId}-${prefs.mdLang}-v${vol}`;
const downloads = new Map(); // bookId -> {done, total}

export function mangadexTitleView(mangaId) {
  const host = h('div', { class: 'scroll' }, h('div', { class: 'empty' }, 'Loading…'));
  const view = h('div', { class: 'view' },
    h('header', { class: 'subbar', style: { borderBottom: '0' } },
      h('a', { class: 'iconbtn', href: '#/mangadex', 'aria-label': 'Back to search' }, icon('back'))),
    proxy ? host : needsProxy());
  let manga, volumes, rows = new Map();

  async function load() {
    try {
      const [m, feed] = await Promise.all([
        api(`/manga/${mangaId}`, params({ includes: ['cover_art', 'author', 'artist'] })),
        fetchFeed(mangaId),
      ]);
      manga = mangaInfo(m.data);
      volumes = buildVolumes(feed);
      draw();
    } catch (e) {
      host.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  function draw() {
    const desc = h('div', { class: 'desc', onclick: () => desc.classList.toggle('open') }, manga.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_]{1,2}/g, ''));
    const downloadable = volumes.filter((v) => v.chapters.length);
    host.replaceChildren(
      h('section', { class: 'mdhead' },
        h('span', { class: 'cover' }, manga.cover ? h('img', { src: coverThumb(manga.id, manga.cover, 512), alt: '' }) : null),
        h('div', { class: 'info' },
          h('h2', {}, manga.title),
          h('div', { class: 'sub', style: { fontSize: '14px', color: 'var(--muted)' } }, manga.author),
          h('div', { class: 'sub', style: { fontSize: '13px', color: 'var(--muted)' } }, `${cap(manga.status)} · ${LANGS[prefs.mdLang] || prefs.mdLang}`),
          downloadable.length ? h('button', {
            class: 'btn btn-primary', style: { marginTop: 'auto', alignSelf: 'flex-start' },
            onclick: async () => { for (const v of downloadable) await download(v); },
          }, 'Download all') : null)),
      manga.description ? desc : null,
      h('div', { style: { padding: '10px 20px', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' } }, h('div', { class: 'label-caps' }, 'Volumes')),
      volumes.length ? h('div', {}, volumes.map((v) => row(v)))
        : h('div', { class: 'empty' }, `No chapters in ${LANGS[prefs.mdLang] || prefs.mdLang} on MangaDex.`),
      h('p', { class: 'hint', style: { padding: '14px 20px 32px' } },
        'Downloaded volumes are saved on this device and readable offline. Chapters that only link to an official publisher can’t be downloaded.'));
  }

  function row(v) {
    const name = v.vol === 'none' ? 'No volume' : `Volume ${v.vol}`;
    const nums = v.chapters.map((c) => c.num);
    const sub = !v.chapters.length ? 'Official publisher only'
      : nums.length === 1 ? `Chapter ${nums[0]}` : `Chapters ${nums[0]}–${nums.at(-1)}${v.official ? ` · ${v.official} official only` : ''}`;
    const btn = h('button', { class: 'btn' });
    const bar = h('div', { class: 'progress', style: { marginTop: '4px', flex: 'none' }, hidden: true }, h('div', { style: { width: '0%' } }));
    const el = h('div', { class: 'volrow' }, h('div', { class: 'meta' }, h('span', { class: 'name' }, name), h('span', { class: 'sub' }, sub), bar), btn);
    const id = volBookId(mangaId, v.vol);
    const update = async () => {
      const d = downloads.get(id);
      const book = await getBook(id);
      bar.hidden = !d;
      if (d) {
        bar.firstChild.style.width = `${Math.round((d.done / Math.max(1, d.total)) * 100)}%`;
        btn.textContent = d.total ? `${Math.round((d.done / d.total) * 100)}%` : 'Starting…';
        btn.disabled = true;
        btn.className = 'btn';
      } else if (book?.hasFile && !book.deleted) {
        btn.textContent = 'Read';
        btn.disabled = false;
        btn.className = 'btn btn-primary';
        btn.onclick = () => { location.hash = `#/read/${encodeURIComponent(id)}`; };
      } else {
        btn.textContent = v.chapters.length ? 'Download' : 'Unavailable';
        btn.disabled = !v.chapters.length;
        btn.className = 'btn';
        btn.onclick = () => download(v);
      }
    };
    rows.set(id, update);
    update();
    return el;
  }

  async function download(v) {
    await downloadVolume(manga, v);
  }

  const off = on('mdx', (id) => rows.get(id)?.());
  if (proxy) load();
  return { el: view, destroy: off };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function fetchImage(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = performance.now();
    try {
      const res = await fetch(img(url));
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      report(url, true, blob.size, performance.now() - t0, res.headers.get('x-cache'));
      return blob;
    } catch {
      report(url, false, 0, performance.now() - t0, null);
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error('An image failed to download');
}

// MangaDex@Home asks apps to report how image downloads went, so it can keep
// its servers healthy. Not needed for MangaDex's own image host.
function report(url, success, bytes, duration, xcache) {
  if (url.includes('mangadex.org')) return;
  fetch(`${proxy}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, success, bytes, duration: Math.round(duration), cached: !!xcache?.startsWith('HIT') }),
  }).catch(() => {});
}

export async function downloadVolume(manga, v) {
  const id = volBookId(manga.id, v.vol);
  if (downloads.has(id) || !v.chapters.length) return;
  const state = { done: 0, total: v.chapters.reduce((s, c) => s + (c.pages || 0), 0) };
  downloads.set(id, state);
  emit('mdx', id);
  const name = v.vol === 'none' ? `${manga.title} (chapters)` : `${manga.title} Vol. ${v.vol}`;
  try {
    const pages = [], chapters = [];
    for (const [n, ch] of v.chapters.entries()) {
      if (n) await sleep(1600); // stay under MangaDex's limit for page-server lookups
      const server = await api(`/at-home/server/${ch.id}`);
      const saver = prefs.dataSaver;
      const files = saver ? server.chapter.dataSaver : server.chapter.data;
      const base = `${server.baseUrl}/${saver ? 'data-saver' : 'data'}/${server.chapter.hash}/`;
      chapters.push({ num: ch.num, title: ch.title, start: pages.length });
      if (files.length !== ch.pages) state.total += files.length - (ch.pages || 0);
      const blobs = await pool(files, 3, async (f) => {
        const b = await fetchImage(base + f);
        state.done++;
        emit('mdx', id);
        return b;
      });
      pages.push(...blobs);
    }
    await db.put('files', { id, pages });
    const existing = await getBook(id);
    const book = existing && !existing.deleted ? existing : {
      id, addedAt: Date.now(), lastReadAt: 0, progress: 0, position: null,
    };
    Object.assign(book, {
      title: name, author: manga.author, format: 'mangadex', kind: 'manga', hasFile: true, deleted: undefined,
      dir: manga.originalLanguage === 'ja' ? 'rtl' : (book.dir || 'ltr'),
      chapters, pageCount: pages.length, size: pages.reduce((s, b) => s + b.size, 0),
      source: { type: 'mangadex', mangaId: manga.id, volume: v.vol, lang: prefs.mdLang },
    });
    await saveBook(book);
    volumeCover(manga, v.vol, id, pages[0]).catch(() => {});
    toast(`Downloaded ${name}`, { label: 'Read', run: () => { location.hash = `#/read/${encodeURIComponent(id)}`; } }, 6000);
  } catch (e) {
    toast(`${name}: ${e.message}`, null, 6000);
  } finally {
    downloads.delete(id);
    emit('mdx', id);
  }
}

async function volumeCover(manga, vol, id, firstPage) {
  try {
    const json = await api('/cover', params({ manga: [manga.id], limit: 100 }));
    const covers = json.data.map((c) => c.attributes);
    const match = covers.find((c) => c.volume === vol && (c.locale === 'ja' || !c.locale))
      || covers.find((c) => c.volume === vol);
    const file = match?.fileName || manga.cover;
    if (file) {
      const url = coverThumb(manga.id, file, 512);
      const res = await fetch(url);
      if (res.ok) return setCoverBlob(id, await res.blob(), url);
    }
  } catch { /* fall back to first page */ }
  if (firstPage) await setCoverBlob(id, firstPage);
}
