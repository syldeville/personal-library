// Settings: GitHub sync, MangaDex proxy, backup and restore, storage.
import { h, icon, toast, downloadBlob, pickFiles, fmtBytes, timeAgo } from './util.js';
import { allRecords, prefs, setPref, emit, on } from './store.js';
import { db } from './db.js';
import { getSyncConfig, saveSyncConfig, disconnectSync, syncNow, syncState } from './sync.js';
import { loadProxy, saveProxy } from './mangadex.js';

export function settingsView() {
  const repo = h('input', { id: 'st-repo', class: 'input', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'your-name/library-data' });
  const token = h('input', { id: 'st-token', class: 'input', type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' });
  const syncStatus = h('div', { class: 'hint', style: { fontSize: '13px' } });
  const syncBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save & sync');
  const disconnectBtn = h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await disconnectSync(); token.value = ''; draw(); } }, 'Turn off sync');

  const proxyInput = h('input', { id: 'st-proxy', class: 'input', type: 'url', autocomplete: 'off', autocapitalize: 'off', placeholder: 'https://library-proxy.you.workers.dev' });
  const proxyStatus = h('div', { class: 'hint', style: { fontSize: '13px' } });
  const storage = h('div', { class: 'hint', style: { fontSize: '13px' } });

  const view = h('div', { class: 'view' },
    h('header', { class: 'subbar' }, h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back to library' }, icon('back')), h('h1', {}, 'Settings')),
    h('div', { class: 'scroll' }, h('div', { class: 'settings' },
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          syncBtn.disabled = true;
          syncStatus.textContent = 'Checking…';
          try {
            const warn = await saveSyncConfig(repo.value, token.value);
            if (warn) toast(warn, null, 7000);
          } catch (err) {
            syncStatus.textContent = err.message;
            syncBtn.disabled = false;
            return;
          }
          syncBtn.disabled = false;
          draw();
        },
      }, h('section', {},
        h('h2', { class: 'label-caps' }, 'Sync with GitHub'),
        h('p', { class: 'hint', style: { margin: 0, fontSize: '13px' } }, 'Keeps your library list and reading positions the same on every device. Book files stay on each device.'),
        h('div', { class: 'field' }, h('label', { for: 'st-repo' }, 'Private repository'), repo),
        h('div', { class: 'field' }, h('label', { for: 'st-token' }, 'Access token'), token,
          h('div', { class: 'hint' }, 'A fine-grained token with “Contents: Read and write” on that one repository. It is stored only on this device.')),
        h('div', { class: 'row' }, syncStatus, h('div', { style: { display: 'flex', gap: '8px', flexShrink: '0' } }, syncBtn)),
        disconnectBtn)),

      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          proxyStatus.textContent = 'Checking…';
          try {
            await saveProxy(proxyInput.value);
            proxyStatus.textContent = proxyInput.value.trim() ? 'Connected' : 'MangaDex is off';
          } catch (err) {
            proxyStatus.textContent = err.message;
          }
        },
      }, h('section', {},
        h('h2', { class: 'label-caps' }, 'MangaDex'),
        h('div', { class: 'field' }, h('label', { for: 'st-proxy' }, 'Proxy address'), proxyInput,
          h('div', { class: 'hint' }, 'Your own Cloudflare Worker. Setup steps are in the README on GitHub (proxy/README.md).')),
        h('div', { class: 'row' }, proxyStatus, h('button', { class: 'btn', type: 'submit' }, 'Save')),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: prefs.dataSaver, onchange: (e) => setPref('dataSaver', e.target.checked) }),
          'Data saver (smaller, lower-quality pages)'))),

      h('section', {},
        h('h2', { class: 'label-caps' }, 'Backup'),
        h('p', { class: 'hint', style: { margin: 0, fontSize: '13px' } }, 'A file with your library list and reading positions (not the books themselves).'),
        h('div', {},
          h('button', { class: 'linkrow', onclick: exportBackup }, 'Export backup file', h('span', { style: { color: 'var(--muted)' } }, '›')),
          h('button', { class: 'linkrow', onclick: importBackup }, 'Restore from backup', h('span', { style: { color: 'var(--muted)' } }, '›')))),

      h('section', {},
        h('h2', { class: 'label-caps' }, 'This device'),
        storage,
        h('p', { class: 'hint', style: { margin: 0, fontSize: '13px' } }, 'To install: in Safari tap Share, then “Add to Home Screen”. It then opens full screen and works offline.')))));

  async function draw() {
    const cfg = await getSyncConfig();
    repo.value = cfg.repo || '';
    if (cfg.token && !token.value) token.value = cfg.token;
    const s = syncState();
    syncStatus.textContent = !s.configured ? 'Sync is off' : s.busy ? 'Syncing…' : s.error ? s.error : `Last synced ${timeAgo(s.at)}`;
    disconnectBtn.hidden = !s.configured;
    syncBtn.textContent = s.configured ? 'Sync now' : 'Save & sync';
    const p = await loadProxy();
    proxyInput.value = p;
    if (!proxyStatus.textContent) proxyStatus.textContent = p ? 'Saved' : 'Not set up';
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    storage.textContent = est ? `Using ${fmtBytes(est.usage)} for books and covers.${persisted ? '' : ' iOS may clear this if the app goes unused for a long time; sync keeps your places safe.'}` : '';
  }

  syncBtn.addEventListener('click', (e) => {
    if (syncState().configured && token.value === token.defaultValue) { e.preventDefault(); syncNow({ manual: true }); }
  });
  const off = on('sync', draw);
  draw().then(() => { token.defaultValue = token.value; });
  return { el: view, destroy: off };
}

async function exportBackup() {
  const books = (await allRecords()).map(({ hasFile, hasCover, ...rest }) => rest);
  const blob = new Blob([JSON.stringify({ app: 'personal-library', version: 1, exportedAt: new Date().toISOString(), books, prefs }, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `library-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

async function importBackup() {
  const [file] = await pickFiles({ accept: 'application/json,.json' });
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'personal-library' || !Array.isArray(data.books)) throw new Error('Not a library backup file');
    const local = new Map((await allRecords()).map((b) => [b.id, b]));
    let n = 0;
    for (const b of data.books) {
      const l = local.get(b.id);
      if (l && (l.updatedAt || 0) >= (b.updatedAt || 0)) continue;
      await db.put('books', { ...b, hasFile: l?.hasFile ?? false, hasCover: l?.hasCover });
      n++;
    }
    emit('books');
    emit('changed');
    toast(n ? `Restored ${n} ${n === 1 ? 'book' : 'books'}` : 'Everything was already up to date');
  } catch (e) {
    toast(e.message, null, 5000);
  }
}
