// IndexedDB storage. Stores:
//   books  – library records (synced metadata + local flags)
//   files  – the book files themselves ({id, blob} or {id, pages: [Blob]})
//   covers – cover images ({id, blob})
//   cache  – derived data that is slow to compute (EPUB locations, PDF text)
//   kv     – settings

const NAME = 'personal-library';
const VERSION = 1;
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of ['books', 'files', 'covers', 'cache']) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write was aborted (the device may be out of space)'));
  });
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  put: (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key)),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
};

export const kv = {
  async get(key, fallback) {
    const v = await db.get('kv', key);
    return v === undefined ? fallback : v;
  },
  set: (key, value) => db.put('kv', value, key),
};
