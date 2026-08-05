import type { KeyValueStore } from './key-value-store';

const SESSION_KEY = 'littlegames.session';

/** The pair of tokens a Nakama session can be rebuilt from. */
export interface StoredSession {
  readonly token: string;
  readonly refreshToken: string;
}

/**
 * Reads the persisted session, or `null` when there is nothing usable.
 *
 * Anything malformed is treated as absent and erased rather than thrown, so a
 * corrupted entry — an interrupted write, or a leftover from an older token
 * format — degrades into a fresh sign-in instead of a permanently broken app.
 */
export function readStoredSession(store: KeyValueStore): StoredSession | null {
  const raw = store.read(SESSION_KEY);
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'token' in parsed &&
      'refreshToken' in parsed &&
      typeof parsed.token === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      parsed.token.length > 0 &&
      parsed.refreshToken.length > 0
    ) {
      return { token: parsed.token, refreshToken: parsed.refreshToken };
    }
  } catch {
    // Fall through to the cleanup below.
  }

  store.remove(SESSION_KEY);
  return null;
}

/** Persists the tokens needed to restore this session on the next visit. */
export function writeStoredSession(store: KeyValueStore, session: StoredSession): void {
  store.write(SESSION_KEY, JSON.stringify(session));
}

/** Erases the persisted session. */
export function clearStoredSession(store: KeyValueStore): void {
  store.remove(SESSION_KEY);
}
