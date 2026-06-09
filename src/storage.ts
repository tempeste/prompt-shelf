import type { DirectoryHandle, PromptCache, StoredSettings } from "./types";

const DB_NAME = "prompt-shelf";
const STORE_NAME = "handles";
const HANDLE_KEY = "prompts-dir";
const CACHE_KEY = "prompt-cache";
const LOCAL_STORAGE_PREFIX = "prompt-shelf:";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export function loadDirectoryHandle(): Promise<DirectoryHandle | null> {
  return withStore<DirectoryHandle>("readonly", (store) => store.get(HANDLE_KEY)).catch(() => null);
}

export function saveDirectoryHandle(handle: DirectoryHandle): Promise<void> {
  return withStore<IDBValidKey>("readwrite", (store) => store.put(handle, HANDLE_KEY)).then(() => undefined);
}

export function loadPromptCache(): Promise<PromptCache | null> {
  return withStore<PromptCache>("readonly", (store) => store.get(CACHE_KEY)).catch(() => null);
}

export function savePromptCache(cache: PromptCache): Promise<void> {
  return withStore<IDBValidKey>("readwrite", (store) => store.put(cache, CACHE_KEY)).then(() => undefined);
}

function parseLocalStorageValue(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function storageGet(keys: Array<keyof StoredSettings>): Promise<StoredSettings> {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return Object.fromEntries(
      keys.map((key) => [key, parseLocalStorageValue(localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`))]),
    ) as StoredSettings;
  }
  return (await storage.get(keys)) as StoredSettings;
}

export function storageSet(values: StoredSettings): Promise<void> {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(value));
    }
    return Promise.resolve();
  }
  return storage.set(values as Record<string, unknown>);
}
