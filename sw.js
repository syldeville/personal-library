// Service worker: keeps the app available offline.
// The asset list and version below are filled in by `node tools/stamp-sw.mjs`;
// run it after changing any app file so phones pick up the new version.

// BEGIN GENERATED
const VERSION = '9f931f9287';
const ASSETS = [
  "./",
  "css/app.css",
  "css/fonts.css",
  "fonts/literata-latin-ext-wght-normal.woff2",
  "fonts/literata-latin-wght-italic.woff2",
  "fonts/literata-latin-wght-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "js/add.js",
  "js/covers.js",
  "js/db.js",
  "js/formats.js",
  "js/library.js",
  "js/main.js",
  "js/mangadex.js",
  "js/reader/epub.js",
  "js/reader/flow.js",
  "js/reader/pages.js",
  "js/reader/reader.js",
  "js/reader/style.js",
  "js/settings.js",
  "js/store.js",
  "js/sync.js",
  "js/util.js",
  "manifest.webmanifest",
  "vendor/epub.min.js",
  "vendor/jszip.min.js",
  "vendor/libarchive/libarchive.js",
  "vendor/libarchive/libarchive.wasm",
  "vendor/libarchive/worker-bundle.js",
  "vendor/mammoth.browser.min.js",
  "vendor/marked.min.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs"
];
// END GENERATED

const CACHE = `library-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('library-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // covers, GitHub and MangaDex go straight to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
