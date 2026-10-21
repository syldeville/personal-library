// Sync through a private GitHub repository: one JSON file holding every book's
// details and reading position. Book files are not uploaded.
import { kv, db } from './db.js';
import { allRecords, SYNC_FIELDS, emit, on } from './store.js';
import { debounce, toast } from './util.js';

const API = 'https://api.github.com';
const FILE = 'library.json';
let config = null;
const state = { configured: false, busy: false, at: 0, error: null };

export const syncState = () => ({ ...state });

export async function initSync() {
  config = await kv.get('sync', null);
  state.configured = !!(config?.repo && config?.token);
  state.at = config?.lastSync || 0;
  on('changed', () => schedule());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') schedule.flush();
    else if (Date.now() - state.at > 60000) syncNow();
  });
  addEventListener('online', () => syncNow());
  if (state.configured) syncNow();
}

const schedule = debounce(() => syncNow(), 4000);

export async function getSyncConfig() {
  return (await kv.get('sync', null)) || { repo: '', token: '' };
}

export async function saveSyncConfig(repo, token) {
  repo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository should look like name/library-data');
  const res = await gh(`/repos/${repo}`, { token: token.trim() });
  if (res.status === 401) throw new Error('GitHub rejected that token');
  if (res.status === 404) throw new Error("Can't see that repository. Check the name and that the token has access to it.");
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  const info = await res.json();
  if (!info.permissions?.push) throw new Error('The token needs Contents: Read and write on that repository');
  config = { repo, token: token.trim(), lastSync: 0 };
  await kv.set('sync', config);
  state.configured = true;
  state.error = null;
  const warn = info.private ? null : 'Heads up: that repository is public, so anyone can see your reading list.';
  await syncNow({ manual: true });
  return warn;
}

export async function disconnectSync() {
  config = null;
  await kv.set('sync', null);
  Object.assign(state, { configured: false, error: null, at: 0 });
  emit('sync');
}

function gh(path, { token = config.token, method = 'GET', body } = {}) {
  return fetch(API + path, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
}

const toB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function pick(rec) {
  const out = {};
  for (const k of SYNC_FIELDS) if (rec[k] !== undefined) out[k] = rec[k];
  return out;
}

let running = null;
export function syncNow(opts = {}) {
  if (!state.configured || !navigator.onLine) return Promise.resolve();
  running ??= doSync(opts).finally(() => { running = null; });
  return running;
}

async function doSync({ manual } = {}) {
  state.busy = true;
  emit('sync');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await gh(`/repos/${config.repo}/contents/${FILE}`);
      let remote = { version: 1, books: {} }, sha;
      if (res.ok) {
        const json = await res.json();
        sha = json.sha;
        remote = JSON.parse(fromB64(json.content));
        remote.books ||= {};
      } else if (res.status !== 404) {
        throw new Error(res.status === 401 ? 'GitHub token expired or was revoked' : `GitHub error ${res.status}`);
      }

      // Merge: for each book, the copy changed most recently wins.
      const local = new Map((await allRecords()).map((b) => [b.id, b]));
      const merged = {};
      let remoteChanged = false;
      for (const id of new Set([...local.keys(), ...Object.keys(remote.books)])) {
        const l = local.get(id), r = remote.books[id];
        if (l && (!r || (l.updatedAt || 0) > (r.updatedAt || 0))) {
          merged[id] = pick(l);
          if (!r || JSON.stringify(pick(l)) !== JSON.stringify(r)) remoteChanged = true;
        } else {
          merged[id] = r;
          if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) {
            await db.put('books', { ...r, hasFile: l?.hasFile ?? false, hasCover: l?.hasCover });
            if (r.deleted && l?.hasFile) { await db.del('files', id); await db.del('covers', id); }
          }
        }
      }
      emit('books');

      if (remoteChanged) {
        const body = { version: 1, updatedAt: Date.now(), books: merged };
        const put = await gh(`/repos/${config.repo}/contents/${FILE}`, {
          method: 'PUT',
          body: { message: 'Update reading progress', content: toB64(JSON.stringify(body, null, 1)), ...(sha && { sha }) },
        });
        if (put.status === 409 || put.status === 422) continue; // changed meanwhile; merge again
        if (!put.ok) throw new Error(`Couldn't save to GitHub (${put.status})`);
      }
      state.at = Date.now();
      state.error = null;
      config.lastSync = state.at;
      await kv.set('sync', config);
      if (manual) toast('Synced');
      return;
    }
    throw new Error('Sync kept conflicting; try again');
  } catch (e) {
    state.error = e.message;
    if (manual) toast(e.message, null, 6000);
    console.warn('sync', e);
  } finally {
    state.busy = false;
    emit('sync');
  }
}
