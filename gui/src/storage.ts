// ---------------------------------------------------------------------------
// Browser-side persistence.
//
// Two different things live here, for two different reasons:
//
//   * The handle to the user's KeyMapper folder. IndexedDB is the only store
//     that can hold a `FileSystemDirectoryHandle` — it survives `structuredClone`
//     but not `JSON.stringify`, so `localStorage` cannot keep one. Persisting it
//     is what lets someone grant the folder once instead of on every visit.
//
//   * A draft of the config being edited, and the typing-trainer statistics.
//     Both are per-browser and never leave it.
//
// Written against raw IndexedDB rather than a wrapper: this is three key/value
// operations, and a dependency to spell them differently is not worth it.
// ---------------------------------------------------------------------------

const DB_NAME = 'keymapper';
const DB_VERSION = 1;
const STORE = 'kv';

/// Keys in the single object store. Kept as constants because a typo in one of
/// these silently reads back `undefined` rather than failing.
const KEY_DIR = 'config-dir-handle';
const KEY_DRAFT = 'config-draft';
const KEY_STATS = 'typing-stats';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function get<T>(key: string): Promise<T | undefined> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const req = conn.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function set(key: string, value: unknown): Promise<void> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function del(key: string): Promise<void> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// The KeyMapper folder
// ---------------------------------------------------------------------------

export const saveDirHandle = (h: FileSystemDirectoryHandle) => set(KEY_DIR, h);
export const loadDirHandle = () => get<FileSystemDirectoryHandle>(KEY_DIR);
export const forgetDirHandle = () => del(KEY_DIR);

// ---------------------------------------------------------------------------
// Work in progress
//
// Stored as the YAML text rather than a parsed object: it is what the user
// would have got had they saved, it survives a schema change in either
// direction, and it can be handed straight to a download.
// ---------------------------------------------------------------------------

export const saveDraft = (yaml: string) => set(KEY_DRAFT, yaml);
export const loadDraft = () => get<string>(KEY_DRAFT);
export const clearDraft = () => del(KEY_DRAFT);

// ---------------------------------------------------------------------------
// Typing-trainer statistics
//
// The shape is owned by the trainer and free to evolve, exactly as it was when
// the Tauri backend stored this as opaque JSON.
// ---------------------------------------------------------------------------

export const saveStats = (stats: unknown) => set(KEY_STATS, stats);
export const loadStats = () => get<unknown>(KEY_STATS);
