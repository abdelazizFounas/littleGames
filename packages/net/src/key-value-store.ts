/**
 * The whole persistence surface the networking layer needs.
 *
 * Keeping it this narrow is what lets the session and device-identity code run
 * unchanged in Node during tests, with no browser and no mocking framework.
 */
export interface KeyValueStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** Backs a store with a Web Storage area, such as `localStorage`. */
export function createWebKeyValueStore(storage: Storage): KeyValueStore {
  return {
    read: (key) => storage.getItem(key),
    write: (key, value) => {
      storage.setItem(key, value);
    },
    remove: (key) => {
      storage.removeItem(key);
    },
  };
}

/** Keeps everything in memory. Used by tests, and as a browser fallback. */
export function createMemoryKeyValueStore(): KeyValueStore {
  const entries = new Map<string, string>();
  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

/**
 * Picks the best store the current browser actually allows.
 *
 * Reading `localStorage` throws outright when storage is blocked — iOS private
 * browsing and hardened cookie settings both do it — so the probe below is
 * what stops the whole app from failing to boot on those devices. Falling back
 * to memory costs the player their persisted session, not their session.
 */
export function createBrowserKeyValueStore(): KeyValueStore {
  try {
    const probeKey = '__littlegames.storage-probe__';
    window.localStorage.setItem(probeKey, probeKey);
    window.localStorage.removeItem(probeKey);
    return createWebKeyValueStore(window.localStorage);
  } catch {
    return createMemoryKeyValueStore();
  }
}
