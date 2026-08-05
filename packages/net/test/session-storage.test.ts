import { describe, expect, it } from 'vitest';
import { createMemoryKeyValueStore } from '../src/key-value-store';
import { clearStoredSession, readStoredSession, writeStoredSession } from '../src/session-storage';

const SESSION_KEY = 'littlegames.session';

describe('session storage', () => {
  it('reads back what it wrote', () => {
    const store = createMemoryKeyValueStore();
    writeStoredSession(store, { token: 'token-a', refreshToken: 'refresh-a' });

    expect(readStoredSession(store)).toEqual({ token: 'token-a', refreshToken: 'refresh-a' });
  });

  it('reports nothing when no session was ever stored', () => {
    expect(readStoredSession(createMemoryKeyValueStore())).toBeNull();
  });

  it('discards a malformed entry instead of throwing', () => {
    const store = createMemoryKeyValueStore();
    store.write(SESSION_KEY, 'not json at all');

    // Throwing here would break the app on every load until the user cleared
    // their storage by hand, so a corrupted entry has to degrade to a sign-in.
    expect(readStoredSession(store)).toBeNull();
    expect(store.read(SESSION_KEY)).toBeNull();
  });

  it('discards an entry that is missing the refresh token', () => {
    const store = createMemoryKeyValueStore();
    store.write(SESSION_KEY, JSON.stringify({ token: 'token-a' }));

    expect(readStoredSession(store)).toBeNull();
    expect(store.read(SESSION_KEY)).toBeNull();
  });

  it('discards an entry holding empty tokens', () => {
    const store = createMemoryKeyValueStore();
    store.write(SESSION_KEY, JSON.stringify({ token: '', refreshToken: '' }));

    expect(readStoredSession(store)).toBeNull();
  });

  it('clears the stored session', () => {
    const store = createMemoryKeyValueStore();
    writeStoredSession(store, { token: 'token-a', refreshToken: 'refresh-a' });

    clearStoredSession(store);

    expect(readStoredSession(store)).toBeNull();
  });
});
