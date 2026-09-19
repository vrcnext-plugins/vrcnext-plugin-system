/**
 * IndexedDB key/value store.
 *
 * The page cannot write to the filesystem, so installed plugin code, the repo list and plugin
 * settings all live in IndexedDB.
 *
 * > [!IMPORTANT]
 * > Storage is scoped to the page origin, which on Linux is `http://localhost:<LocalHttpPort>`.
 * > VRCNext picks a random port when its saved one is unavailable, and a new port is a new
 * > origin — which would silently orphan everything stored here. The installer pins
 * > `LocalHttpPort` in `settings.json` for exactly this reason.
 */

const DB_NAME = 'vrcnext-plugins';
const DB_VERSION = 1;

export const STORES = {
  repos: 'repos',
  plugins: 'plugins',
  settings: 'settings',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => { resolve(request.result); };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IndexedDB request failed.'));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = (): void => { resolve(request.result); };
    request.onerror = (): void => {
      reject(request.error ?? new Error('Could not open the plugin database.'));
    };
    request.onblocked = (): void => {
      reject(new Error('The plugin database is blocked by another VRCNext window.'));
    };
  });
}

export class IdbStore {
  #db: IDBDatabase | undefined;

  async #database(): Promise<IDBDatabase> {
    this.#db ??= await openDatabase();
    return this.#db;
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await this.#database();
    const tx = db.transaction(store, 'readonly');
    return await promisify<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  }

  async set(store: StoreName, key: string, value: unknown): Promise<void> {
    const db = await this.#database();
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).put(value, key));
  }

  async delete(store: StoreName, key: string): Promise<void> {
    const db = await this.#database();
    const tx = db.transaction(store, 'readwrite');
    await promisify(tx.objectStore(store).delete(key));
  }

  async entries<T>(store: StoreName): Promise<readonly (readonly [string, T])[]> {
    const db = await this.#database();
    const tx = db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const keys = await promisify(objectStore.getAllKeys());
    const values = await promisify<T[]>(objectStore.getAll() as IDBRequest<T[]>);

    const entries: (readonly [string, T])[] = [];
    for (const [index, key] of keys.entries()) {
      // Every key this store writes is a string; anything else was not written by us.
      if (typeof key !== 'string') continue;
      const value = values[index];
      if (value === undefined) continue;
      entries.push([key, value] as const);
    }
    return entries;
  }

  close(): void {
    this.#db?.close();
    this.#db = undefined;
  }
}
