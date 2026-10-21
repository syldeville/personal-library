// App start-up and routing.
//   #/              library
//   #/read/<id>     reader
//   #/settings      settings
//   #/mangadex      MangaDex search
//   #/mangadex/<id> MangaDex title
import { loadPrefs } from './store.js';
import { libraryView } from './library.js';
import { initSync } from './sync.js';
import { loadProxy } from './mangadex.js';
import { importFiles } from './add.js';

const app = document.getElementById('app');
let current = null;

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  let next;
  if (name === 'read' && arg) {
    const { readerView } = await import('./reader/reader.js');
    next = readerView(decodeURIComponent(arg));
  } else if (name === 'settings') {
    const { settingsView } = await import('./settings.js');
    next = settingsView();
  } else if (name === 'mangadex') {
    const md = await import('./mangadex.js');
    next = arg ? md.mangadexTitleView(arg) : md.mangadexSearchView();
  } else {
    next = libraryView();
  }
  current?.destroy?.();
  current = next;
  app.replaceChildren(next.el);
  if (pendingReload && !name) location.reload();
}

// Stops Safari's whole-page pinch zoom; the reader does its own zooming.
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());

// Drag and drop files onto the window (desktop).
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
});

let pendingReload = false;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update().catch(() => {});
  }).catch((e) => console.warn('service worker', e));
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    // A new version was installed: reload when it won't interrupt reading.
    if (!location.hash.startsWith('#/read')) location.reload();
    else pendingReload = true;
  });
}

(async () => {
  await loadPrefs();
  await loadProxy();
  navigator.storage?.persist?.().catch(() => {});
  addEventListener('hashchange', route);
  await route();
  initSync();
})();
